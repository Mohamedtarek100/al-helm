-- Additive migration 010: append-only owner audit log.
--
-- WHY
--   Phases 2–4 add privileged actions (CSV export, announcement sends, owner
--   preference changes, recipient opens). Owners need a record of what was done
--   and by whom. Without a dedicated table this would either not exist or be
--   reconstructed from mutable rows, which is not an audit trail.
--
-- WHAT "APPEND-ONLY" MEANS HERE — ENFORCED, NOT JUST DOCUMENTED
--   1. No privilege is granted to `PUBLIC`, `anon` or `authenticated`; all are
--      explicitly revoked. A signed-in user cannot write an entry, so entries
--      cannot be forged, altered or removed client-side.
--   2. RLS is enabled with NO client policies at all. Even if a grant were
--      added by mistake later, the absence of a policy still denies every row
--      for non-service roles.
--   3. `service_role` receives INSERT + SELECT only. UPDATE / DELETE / TRUNCATE
--      are never granted, so an application bug cannot rewrite history through
--      the role the Edge Function actually uses.
--   4. Row-level triggers reject UPDATE and DELETE; a statement-level trigger
--      rejects TRUNCATE (which fires no row triggers and is NOT subject to RLS).
--      Together they close every mutation path short of dropping the table.
--
-- PROTECTION BOUNDARY — STATED ACCURATELY
--   This is strong immutability against the roles this application uses, not
--   absolute immutability. A PostgreSQL superuser, or the table owner, can
--   disable triggers, revoke nothing from itself, or DROP the table. No SQL
--   construct can prevent the owner of the database from changing it. What is
--   guaranteed is that no client role, and no code path in the Edge Function,
--   can mutate or erase an entry.
--
-- NO PII BEYOND IDENTITY
--   `actor_email` and `target` are the record itself. `detail` is CONSTRUCTED
--   SERVER-SIDE by the Edge Function from a fixed per-action shape (widths,
--   counts, column names); client-supplied JSON is never stored. No token,
--   secret, password or user content is written here.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- Newest-first listing is the only read pattern.
create index if not exists idx_admin_audit_log_created_at
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

-- Privilege model, asserted rather than assumed.
--
-- `from public` comes FIRST and matters: PostgreSQL can carry default privileges
-- that apply to every new table, and a table meant to be append-only must not
-- inherit them. Revoking from each concrete role after PUBLIC makes the intended
-- end state explicit instead of dependent on what PUBLIC happened to hold.
revoke all on table public.admin_audit_log from public;
revoke all on table public.admin_audit_log from anon, authenticated;
grant insert, select on public.admin_audit_log to service_role;

-- TRUNCATE is a TABLE-level privilege and a separate hole from UPDATE/DELETE:
--   - it does NOT fire FOR EACH ROW triggers,
--   - it is NOT subject to row-level security.
-- So it must be revoked explicitly. `PUBLIC` is included because it is the role
-- that actually holds the un-revoked default; service_role never had it, and
-- revoking a privilege the role does not hold is a harmless no-op.
revoke truncate on table public.admin_audit_log from public;
revoke truncate on table public.admin_audit_log from anon, authenticated, service_role;

-- Defence in depth: the table refuses row mutation even from the service role.
--
-- SECURITY INVOKER is deliberate: raising an exception needs no privileges, so
-- there is no reason to elevate. `search_path` is pinned so the function cannot
-- be hijacked by a shadowing object if it is ever edited to resolve a name.
create or replace function public.admin_audit_log_block_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'admin_audit_log is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists admin_audit_log_no_update on public.admin_audit_log;
create trigger admin_audit_log_no_update
  before update on public.admin_audit_log
  for each row execute function public.admin_audit_log_block_mutation();

drop trigger if exists admin_audit_log_no_delete on public.admin_audit_log;
create trigger admin_audit_log_no_delete
  before delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_block_mutation();

-- Statement-level: row triggers never fire for TRUNCATE.
drop trigger if exists admin_audit_log_no_truncate on public.admin_audit_log;
create trigger admin_audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_log_block_mutation();

-- The grants the admin Edge Function needs on the tables it already reads.
-- Re-stated here so this migration is self-contained and idempotent; 009
-- granted these, and re-granting is a no-op.
grant select, insert, update, delete on public.announcements to service_role;
grant select, insert, update, delete on public.announcement_delivery to service_role;
grant select, insert, update, delete on public.user_activity to service_role;
grant select on public.push_subscriptions to service_role;

-- ============================================================================
-- RECOVERY — ARCHIVE FIRST, NEVER DROP FIRST
-- ============================================================================
-- There is NO rollback statement for this migration, by design. The table is
-- append-only, so it is the only copy of the history it holds; `drop table`
-- would destroy exactly what it exists to protect.
--
-- 1. A behaviour must change (e.g. a trigger is wrong): fix it additively.
--      create or replace function public.admin_audit_log_block_mutation() ...
--      drop trigger if exists ... ; create trigger ...
--    Columns are added with `alter table ... add column if not exists`, never
--    by recreating the table.
--
-- 2. Writing must stop temporarily: redeploy the Edge Function without the audit
--    writes. The table and its rows stay intact and readable.
--
-- 3. The table must be decommissioned (rare, and only with an export):
--      create table public.admin_audit_log_archive as
--        select * from public.admin_audit_log;
--      -- verify the archive is complete before going further:
--      select (select count(*) from public.admin_audit_log) as live,
--             (select count(*) from public.admin_audit_log_archive) as archived;
--      -- both counts MUST be equal; then, and only then:
--      drop table if exists public.admin_audit_log;
--      drop function if exists public.admin_audit_log_block_mutation();
--    The archive is a plain table and can be dumped to storage for long-term
--    retention; it is not wrapped in the append-only triggers on purpose, so it
--    can itself be archived and removed later.
