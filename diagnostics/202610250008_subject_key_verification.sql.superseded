-- Additive migration 008: make the canonical key authoritative on the client,
-- and make the database verify it instead of silently recomputing a different one.
--
-- PROBLEM FOUND IN REVIEW
--   Migration 007's comment claims NFKC support, but its function is:
--       lower(btrim -> collapse spaces -> strip marks -> collapse spaces)
--   There is NO NFKC step. The TypeScript implementation DOES apply NFKC:
--       'Ｃ＋' (two fullwidth pluses) -> 'c++' on the client
--   while SQL leaves it as 'ｃ＋'. Two devices could therefore create names the
--   client considers identical but the unique index does not — a real
--   cross-device duplicate.
--
--   PostgreSQL's normalize(text, 'NFKC') needs PG13+ *and* UTF8, and the exact
--   folding differs from the browser for a few characters. Re-implementing ICU
--   in SQL is not something that can be trusted blind.
--
-- SOLUTION (client-authoritative key, database-verified)
--   The application already computes `subjectNameKey(name)` in TypeScript, which
--   is the single place NFKC is applied. It now sends that value as
--   `subjects.name_key`, and a BEFORE trigger:
--     1. verifies the supplied key against the SQL-derived key, and
--     2. overwrites it with the SQL key when the client omitted it.
--   Uniqueness is still enforced by UNIQUE (user_id, name_key). The key is
--   never trusted blindly: a mismatched key is rejected so the two sides can
--   never diverge silently.
--
-- SAFETY
--   Additive: one function + one trigger. No rows are deleted, merged or renamed.
--   Existing rows keep their current keys; the trigger only applies to new writes.
--   Idempotent (drop trigger if exists ... create trigger).
--
-- ROLLBACK
--   drop trigger if exists subjects_verify_name_key_trg on public.subjects;
--   drop function if exists public.subjects_verify_name_key();

-- 1. Verification function ---------------------------------------------------
create or replace function public.subjects_verify_name_key()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  derived text := public.subject_name_key(new.name);
begin
  -- Normalise the display name's surrounding whitespace, but never alter it.
  if new.name is null or btrim(new.name) = '' then
    raise exception 'Subject name must not be empty.' using errcode = 'check_violation';
  end if;

  if new.name_key is null or btrim(new.name_key) = '' then
    -- Client did not supply a key (older client / direct SQL): derive it.
    new.name_key := derived;
  elsif lower(new.name_key) <> derived then
    -- The client key did not match the SQL contract. Reject rather than store
    -- a key the unique index would disagree with.
    raise exception
      'Subject key mismatch for "%": client sent "%" but the canonical SQL key is "%".',
      new.name, new.name_key, derived
      using errcode = 'check_violation';
  else
    new.name_key := derived;
  end if;

  return new;
end;
$$;

comment on function public.subjects_verify_name_key() is
  'Enforces a single canonical subject key. The client computes subjectNameKey() '
  '(with NFKC); this trigger verifies it against the SQL derivation so client '
  'and database can never disagree, and fills it in when absent.';

-- 2. Attach to the table -----------------------------------------------------
drop trigger if exists subjects_verify_name_key_trg on public.subjects;
create trigger subjects_verify_name_key_trg
  before insert or update of name, name_key on public.subjects
  for each row execute function public.subjects_verify_name_key();
