-- DIAGNOSTIC (read-only, safe): evidence gathering for Security Advisor findings.
--
-- PURPOSE
--   These queries produce the evidence needed to approve or reject the pending
--   privilege migrations. They change NOTHING: no grant, revoke, DDL or DML.
--
-- RUN WITH:  psql "$SUPABASE_DB_URL" -f supabase/diagnostics/security-advisor-evidence.sql
--   (or the Supabase SQL editor, read-only)
--
-- WHAT EACH BLOCK ANSWERS
--   1. Who owns handle_new_user(), is it SECURITY DEFINER, and what is its
--      search_path?
--   2. What EXECUTE privileges does it currently have — i.e. can `anon` or
--      `authenticated` actually call it today?
--   3. Does the trigger still exist and reference the same function?
--   4. Is rls_auto_enable() a Supabase-managed function (and therefore out of
--      scope for us to alter)?
--   5. Current grants + RLS status on admin_allowlist and announcements.

\echo '=== 1. handle_new_user definition/ownership ==='
select
  p.proname                                        as function,
  pg_get_userbyid(p.proowner)                      as owner,
  p.prosecdef                                      as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '(none)') as proconfig_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

\echo '=== 2. EXECUTE privileges on handle_new_user ==='
select
  coalesce(r.rolname, 'PUBLIC') as grantee,
  has_function_privilege(coalesce(r.rolname, 'public'), 'public.handle_new_user()', 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral (
  select null::name as rolname
) r on true
where n.nspname = 'public' and p.proname = 'handle_new_user'
union all
select rolname,
       has_function_privilege(rolname, 'public.handle_new_user()', 'EXECUTE')
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
order by 1;

\echo '=== 3. Trigger wiring on auth.users ==='
select tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal;

\echo '=== 4. rls_auto_enable origin (Supabase-managed?) ==='
select
  n.nspname as schema,
  p.proname as function,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '(none)') as proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'rls_auto_enable';

\echo '=== 5. admin_allowlist / announcements privileges and RLS ==='
select c.relname as table, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('admin_allowlist', 'announcements', 'admin_audit_log');

select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('admin_allowlist', 'announcements', 'admin_audit_log')
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by table_name, grantee
order by table_name, grantee;

\echo '=== 6. Policies present on those tables ==='
select tablename, policyname, roles::text, cmd
from pg_policies
where schemaname = 'public' and tablename in ('admin_allowlist', 'announcements', 'admin_audit_log')
order by tablename, policyname;

\echo '=== 7. Row-count baseline (for the backup comparison) ==='
select 'profiles' as table, count(*) from public.profiles
union all select 'user_preferences', count(*) from public.user_preferences
union all select 'subjects', count(*) from public.subjects
union all select 'tasks', count(*) from public.tasks
union all select 'study_sessions', count(*) from public.study_sessions
union all select 'focus_sessions', count(*) from public.focus_sessions
union all select 'journal_entries', count(*) from public.journal_entries
union all select 'artistic_goals', count(*) from public.artistic_goals
union all select 'artwork_metadata', count(*) from public.artwork_metadata
union all select 'drawing_challenges', count(*) from public.drawing_challenges
union all select 'future_letters', count(*) from public.future_letters
union all select 'exam_dates', count(*) from public.exam_dates
union all select 'user_activity', count(*) from public.user_activity
union all select 'push_subscriptions', count(*) from public.push_subscriptions
union all select 'announcements', count(*) from public.announcements
union all select 'announcement_delivery', count(*) from public.announcement_delivery
order by 1;
