-- Additive migration 005: task priority levels + re-editable drawings.
--
-- 1. tasks.priority gains the `urgent` level (ordered urgent > high > medium >
--    low). The original CHECK only allowed low/medium/high, so it is widened —
--    existing rows keep their value, and any legacy NULL/unexpected value is
--    normalised to 'medium' before the constraint is enforced.
-- 2. artwork_metadata gains the paper style and the vector drawing model so a
--    saved sketch can be reopened and edited (not only viewed as a PNG).
--
-- No column is dropped, no row is deleted, RLS is untouched.

-- 1. Priority ---------------------------------------------------------------
alter table public.tasks alter column priority drop constraint if exists tasks_priority_check;
update public.tasks set priority = 'medium' where priority is null or priority not in ('urgent','high','medium','low');
alter table public.tasks alter column priority set default 'medium';
alter table public.tasks alter column priority set not null;
alter table public.tasks add constraint tasks_priority_check check (priority in ('urgent','high','medium','low'));

-- 2. Drawing model ----------------------------------------------------------
alter table public.artwork_metadata add column if not exists paper text default 'cream';
alter table public.artwork_metadata add column if not exists drawing_model text;
alter table public.artwork_metadata drop constraint if exists artwork_metadata_paper_check;
alter table public.artwork_metadata add constraint artwork_metadata_paper_check check (paper is null or paper in ('white','cream','grid'));
