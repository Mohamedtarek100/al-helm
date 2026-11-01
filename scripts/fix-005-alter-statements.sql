-- Corrected body for migration 005 (task priority + drawing model).
--
-- WHY THIS CHANGE IS NEEDED
--   The reviewed 005 used `alter table ... alter column priority drop
--   constraint if exists tasks_priority_check;`. PostgreSQL has no such form:
--   DROP CONSTRAINT is a TABLE-level operation, so the statement fails with
--   SQLSTATE 42601 (syntax error at or near "constraint"). The production push
--   therefore aborted on its first statement and rolled back cleanly.
--
--   Correct forms:
--     alter table public.tasks drop constraint if exists tasks_priority_check;
--     alter table public.tasks add constraint tasks_priority_check check (...);
--
-- SAFETY: identical intent to the reviewed migration. No column is dropped, no
-- row is deleted, no RLS change. The UPDATE only rewrites rows whose priority is
-- NULL or outside the four supported values (production currently has 0 such
-- rows).

begin;

-- 1. Task priority: widen the CHECK to include 'urgent' ---------------------
alter table public.tasks drop constraint if exists tasks_priority_check;
update public.tasks set priority = 'medium'
 where priority is null or priority not in ('urgent', 'high', 'medium', 'low');
alter table public.tasks alter column priority set default 'medium';
alter table public.tasks alter column priority set not null;
alter table public.tasks add constraint tasks_priority_check
  check (priority in ('urgent', 'high', 'medium', 'low'));

-- 2. Drawing model columns --------------------------------------------------
alter table public.artwork_metadata add column if not exists paper text default 'cream';
alter table public.artwork_metadata add column if not exists drawing_model text;
alter table public.artwork_metadata drop constraint if exists artwork_metadata_paper_check;
alter table public.artwork_metadata add constraint artwork_metadata_paper_check
  check (paper is null or paper in ('white', 'cream', 'grid'));

commit;
