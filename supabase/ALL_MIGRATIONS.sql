-- 4uLife — consolidated schema.
-- GENERATED from supabase/migrations/ (ordered). Do not edit by hand —
-- run `npm run gen:migrations` after adding or changing migration files.
-- Applied incrementally via `npx supabase db push --linked`.

-- ============================================================
-- Migration: 202610190001_initial_schema.sql
-- ============================================================

-- Al-Helm initial schema. Additive migration; no destructive operations.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  motto text not null default '',
  journey_start date not null default current_date,
  avatar_seed text not null default 'alhelm',
  language text not null default 'en' check (language in ('en','ar')),
  theme text not null default 'light' check (theme in ('light','dark','system')),
  timezone text not null default 'Africa/Cairo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null,
  notes text not null default '',
  weekly_target_minutes integer not null default 0 check (weekly_target_minutes >= 0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.study_sessions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  subject_id text,
  recurrence text not null check (recurrence in ('weekly','once')),
  weekday smallint not null check (weekday between 0 and 6),
  session_date date not null,
  start_time time not null,
  end_time time not null,
  session_type text not null,
  notes text not null default '',
  timezone text not null default 'Africa/Cairo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint study_sessions_valid_time check (end_time > start_time),
  constraint study_sessions_subject_fk foreign key (user_id, subject_id) references public.subjects(user_id, id) on delete set null (subject_id)
);

create table if not exists public.tasks (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  subject_id text,
  due_date date not null,
  due_time time,
  priority text not null check (priority in ('low','medium','high')),
  category text not null,
  estimated_minutes integer not null default 0 check (estimated_minutes >= 0),
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint tasks_subject_fk foreign key (user_id, subject_id) references public.subjects(user_id, id) on delete set null (subject_id)
);

create table if not exists public.focus_sessions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id text,
  task_id text,
  kind text not null check (kind in ('focus','shortBreak','longBreak')),
  planned_minutes integer not null check (planned_minutes > 0),
  actual_minutes integer not null check (actual_minutes >= 0),
  session_date date not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint focus_sessions_subject_fk foreign key (user_id,subject_id) references public.subjects(user_id,id) on delete set null (subject_id),
  constraint focus_sessions_task_fk foreign key (user_id,task_id) references public.tasks(user_id,id) on delete set null (task_id)
);

create table if not exists public.recurring_schedules (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  subject_id text, weekday smallint not null check (weekday between 0 and 6), start_time time not null, end_time time not null,
  timezone text not null default 'Africa/Cairo', enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(user_id,id),
  check (end_time > start_time),
  foreign key(user_id,subject_id) references public.subjects(user_id,id) on delete set null (subject_id)
);

create table if not exists public.artistic_goals (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, description text not null default '', target_date date, completed boolean not null default false, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id,id)
);
create table if not exists public.journal_entries (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, body text not null default '', mood text not null default '', entry_date date not null, pinned boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id,id)
);
create table if not exists public.artwork_metadata (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, description text not null default '', medium text not null default '', artwork_date date not null,
  storage_path text,
  source text not null default 'drawn' check (source in ('drawn','photo','imported')),
  category text not null default '',
  tags jsonb not null default '[]'::jsonb,
  favorite boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id,id)
);
create table if not exists public.drawing_challenges (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, brief text not null default '', track text not null, suggested_minutes integer not null default 20,
  completed boolean not null default false, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id,id)
);
create table if not exists public.future_letters (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
 title text not null, body text not null default '', open_on date, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id,id)
);
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade, preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.exam_dates (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, subject_id text, exam_at timestamptz not null, timezone text not null default 'Africa/Cairo', notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(user_id,id),
  foreign key(user_id,subject_id) references public.subjects(user_id,id) on delete set null (subject_id)
);
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default false,
  timezone text not null default 'Africa/Cairo', quiet_start time, quiet_end time, lead_minutes integer[] not null default array[10],
  preferences jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null, subscription jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,id), unique(user_id,endpoint)
);
create table if not exists public.reminder_schedule (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null, entity_id text not null, scheduled_at timestamptz not null, timezone text not null default 'Africa/Cairo',
  status text not null default 'pending' check(status in ('pending','sent','cancelled','failed')), idempotency_key text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(user_id,id), unique(user_id,idempotency_key)
);
create table if not exists public.push_deliveries (
  id text not null, user_id uuid not null references auth.users(id) on delete cascade, reminder_id text,
  status text not null check(status in ('queued','sent','failed')), delivered_at timestamptz, error_code text,
  created_at timestamptz not null default now(), primary key(user_id,id),
  foreign key(user_id,reminder_id) references public.reminder_schedule(user_id,id) on delete set null (reminder_id)
);

create index if not exists study_sessions_user_date_idx on public.study_sessions(user_id, session_date);
create index if not exists tasks_user_due_idx on public.tasks(user_id, due_date, completed);
create index if not exists focus_sessions_user_date_idx on public.focus_sessions(user_id, session_date);
create index if not exists reminder_due_idx on public.reminder_schedule(status, scheduled_at) where status = 'pending';

-- All user-owned data is protected by RLS. Authenticated browser clients receive CRUD only.
-- Written as explicit statements (a dynamic do-block failed under the migration runner).
alter table public.subjects enable row level security;
alter table public.study_sessions enable row level security;
alter table public.tasks enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.recurring_schedules enable row level security;
alter table public.artistic_goals enable row level security;
alter table public.journal_entries enable row level security;
alter table public.artwork_metadata enable row level security;
alter table public.drawing_challenges enable row level security;
alter table public.future_letters enable row level security;
alter table public.user_preferences enable row level security;
alter table public.exam_dates enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_schedule enable row level security;
alter table public.push_deliveries enable row level security;

revoke all on public.subjects from anon;
revoke all on public.study_sessions from anon;
revoke all on public.tasks from anon;
revoke all on public.focus_sessions from anon;
revoke all on public.recurring_schedules from anon;
revoke all on public.artistic_goals from anon;
revoke all on public.journal_entries from anon;
revoke all on public.artwork_metadata from anon;
revoke all on public.drawing_challenges from anon;
revoke all on public.future_letters from anon;
revoke all on public.user_preferences from anon;
revoke all on public.exam_dates from anon;
revoke all on public.notification_preferences from anon;
revoke all on public.push_subscriptions from anon;
revoke all on public.reminder_schedule from anon;
revoke all on public.push_deliveries from anon;

drop policy if exists owner_all on public.subjects;
drop policy if exists owner_all on public.study_sessions;
drop policy if exists owner_all on public.tasks;
drop policy if exists owner_all on public.focus_sessions;
drop policy if exists owner_all on public.recurring_schedules;
drop policy if exists owner_all on public.artistic_goals;
drop policy if exists owner_all on public.journal_entries;
drop policy if exists owner_all on public.artwork_metadata;
drop policy if exists owner_all on public.drawing_challenges;
drop policy if exists owner_all on public.future_letters;
drop policy if exists owner_all on public.user_preferences;
drop policy if exists owner_all on public.exam_dates;
drop policy if exists owner_all on public.notification_preferences;
drop policy if exists owner_all on public.push_subscriptions;
drop policy if exists owner_all on public.reminder_schedule;
drop policy if exists owner_all on public.push_deliveries;

create policy owner_all on public.subjects for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.study_sessions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.tasks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.focus_sessions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.recurring_schedules for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.artistic_goals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.journal_entries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.artwork_metadata for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.drawing_challenges for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.future_letters for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.user_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.exam_dates for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.reminder_schedule for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.push_deliveries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.study_sessions to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.focus_sessions to authenticated;
grant select, insert, update, delete on public.recurring_schedules to authenticated;
grant select, insert, update, delete on public.artistic_goals to authenticated;
grant select, insert, update, delete on public.journal_entries to authenticated;
grant select, insert, update, delete on public.artwork_metadata to authenticated;
grant select, insert, update, delete on public.drawing_challenges to authenticated;
grant select, insert, update, delete on public.future_letters to authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;
grant select, insert, update, delete on public.exam_dates to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.reminder_schedule to authenticated;
grant select, insert, update, delete on public.push_deliveries to authenticated;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
drop policy if exists owner_all on public.profiles;
drop policy if exists profile_select_own on public.profiles;
drop policy if exists profile_insert_own on public.profiles;
drop policy if exists profile_update_own on public.profiles;
create policy profile_select_own on public.profiles for select to authenticated using(id=auth.uid());
create policy profile_insert_own on public.profiles for insert to authenticated with check(id=auth.uid());
create policy profile_update_own on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
grant select,insert,update on public.profiles to authenticated;
revoke delete on public.profiles from authenticated;
revoke all on public.profiles, public.subjects, public.study_sessions, public.tasks, public.focus_sessions,
  public.recurring_schedules, public.artistic_goals, public.journal_entries, public.artwork_metadata,
  public.drawing_challenges, public.future_letters, public.user_preferences, public.exam_dates,
  public.notification_preferences, public.push_subscriptions, public.reminder_schedule, public.push_deliveries from anon;
grant usage on schema public to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('artworks','artworks',false,6291456,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=6291456,allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif'];
-- storage.objects already has RLS enabled; altering it requires ownership
-- which the SQL role does not have on hosted projects.
drop policy if exists alhelm_artwork_owner_insert on storage.objects;
drop policy if exists alhelm_artwork_owner_select on storage.objects;
drop policy if exists alhelm_artwork_owner_update on storage.objects;
drop policy if exists alhelm_artwork_owner_delete on storage.objects;
create policy alhelm_artwork_owner_insert on storage.objects for insert to authenticated with check(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_select on storage.objects for select to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_update on storage.objects for update to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_delete on storage.objects for delete to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name','')) on conflict (id) do nothing;
  insert into public.user_preferences(user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- ============================================================
-- Migration: 202610190002_hardened_rls_and_private_artwork.sql
-- ============================================================

-- Harden ownership, cross-user relationships, profile policies and private artwork access.
-- NOTE: equivalent composite owner-scoped subject FKs are already declared in
-- 202610190001 on focus_sessions (named), recurring_schedules and exam_dates
-- (inline). Re-adding them here would raise a duplicate-constraint error, so
-- no constraint changes are made in this migration.

-- Replace permissive generic policies with operation-specific owner policies; profile key is id, not user_id.
-- Written as explicit statements (a dynamic do-block failed under the migration runner).
revoke all on public.subjects from authenticated;
revoke all on public.study_sessions from authenticated;
revoke all on public.tasks from authenticated;
revoke all on public.focus_sessions from authenticated;
revoke all on public.recurring_schedules from authenticated;
revoke all on public.artistic_goals from authenticated;
revoke all on public.journal_entries from authenticated;
revoke all on public.artwork_metadata from authenticated;
revoke all on public.drawing_challenges from authenticated;
revoke all on public.future_letters from authenticated;
revoke all on public.user_preferences from authenticated;
revoke all on public.exam_dates from authenticated;
revoke all on public.notification_preferences from authenticated;
revoke all on public.push_subscriptions from authenticated;
revoke all on public.reminder_schedule from authenticated;
revoke all on public.push_deliveries from authenticated;

drop policy if exists owner_all on public.subjects;
drop policy if exists owner_all on public.study_sessions;
drop policy if exists owner_all on public.tasks;
drop policy if exists owner_all on public.focus_sessions;
drop policy if exists owner_all on public.recurring_schedules;
drop policy if exists owner_all on public.artistic_goals;
drop policy if exists owner_all on public.journal_entries;
drop policy if exists owner_all on public.artwork_metadata;
drop policy if exists owner_all on public.drawing_challenges;
drop policy if exists owner_all on public.future_letters;
drop policy if exists owner_all on public.user_preferences;
drop policy if exists owner_all on public.exam_dates;
drop policy if exists owner_all on public.notification_preferences;
drop policy if exists owner_all on public.push_subscriptions;
drop policy if exists owner_all on public.reminder_schedule;
drop policy if exists owner_all on public.push_deliveries;

drop policy if exists owner_select on public.subjects;
drop policy if exists owner_select on public.study_sessions;
drop policy if exists owner_select on public.tasks;
drop policy if exists owner_select on public.focus_sessions;
drop policy if exists owner_select on public.recurring_schedules;
drop policy if exists owner_select on public.artistic_goals;
drop policy if exists owner_select on public.journal_entries;
drop policy if exists owner_select on public.artwork_metadata;
drop policy if exists owner_select on public.drawing_challenges;
drop policy if exists owner_select on public.future_letters;
drop policy if exists owner_select on public.user_preferences;
drop policy if exists owner_select on public.exam_dates;
drop policy if exists owner_select on public.notification_preferences;
drop policy if exists owner_select on public.push_subscriptions;
drop policy if exists owner_select on public.reminder_schedule;
drop policy if exists owner_select on public.push_deliveries;

drop policy if exists owner_insert on public.subjects;
drop policy if exists owner_insert on public.study_sessions;
drop policy if exists owner_insert on public.tasks;
drop policy if exists owner_insert on public.focus_sessions;
drop policy if exists owner_insert on public.recurring_schedules;
drop policy if exists owner_insert on public.artistic_goals;
drop policy if exists owner_insert on public.journal_entries;
drop policy if exists owner_insert on public.artwork_metadata;
drop policy if exists owner_insert on public.drawing_challenges;
drop policy if exists owner_insert on public.future_letters;
drop policy if exists owner_insert on public.user_preferences;
drop policy if exists owner_insert on public.exam_dates;
drop policy if exists owner_insert on public.notification_preferences;
drop policy if exists owner_insert on public.push_subscriptions;
drop policy if exists owner_insert on public.reminder_schedule;
drop policy if exists owner_insert on public.push_deliveries;

drop policy if exists owner_update on public.subjects;
drop policy if exists owner_update on public.study_sessions;
drop policy if exists owner_update on public.tasks;
drop policy if exists owner_update on public.focus_sessions;
drop policy if exists owner_update on public.recurring_schedules;
drop policy if exists owner_update on public.artistic_goals;
drop policy if exists owner_update on public.journal_entries;
drop policy if exists owner_update on public.artwork_metadata;
drop policy if exists owner_update on public.drawing_challenges;
drop policy if exists owner_update on public.future_letters;
drop policy if exists owner_update on public.user_preferences;
drop policy if exists owner_update on public.exam_dates;
drop policy if exists owner_update on public.notification_preferences;
drop policy if exists owner_update on public.push_subscriptions;
drop policy if exists owner_update on public.reminder_schedule;
drop policy if exists owner_update on public.push_deliveries;

drop policy if exists owner_delete on public.subjects;
drop policy if exists owner_delete on public.study_sessions;
drop policy if exists owner_delete on public.tasks;
drop policy if exists owner_delete on public.focus_sessions;
drop policy if exists owner_delete on public.recurring_schedules;
drop policy if exists owner_delete on public.artistic_goals;
drop policy if exists owner_delete on public.journal_entries;
drop policy if exists owner_delete on public.artwork_metadata;
drop policy if exists owner_delete on public.drawing_challenges;
drop policy if exists owner_delete on public.future_letters;
drop policy if exists owner_delete on public.user_preferences;
drop policy if exists owner_delete on public.exam_dates;
drop policy if exists owner_delete on public.notification_preferences;
drop policy if exists owner_delete on public.push_subscriptions;
drop policy if exists owner_delete on public.reminder_schedule;
drop policy if exists owner_delete on public.push_deliveries;

create policy owner_select on public.subjects for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.study_sessions for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.tasks for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.focus_sessions for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.recurring_schedules for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.artistic_goals for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.journal_entries for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.artwork_metadata for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.drawing_challenges for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.future_letters for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.user_preferences for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.exam_dates for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.notification_preferences for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.push_subscriptions for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.reminder_schedule for select to authenticated using(user_id=auth.uid());
create policy owner_select on public.push_deliveries for select to authenticated using(user_id=auth.uid());

create policy owner_insert on public.subjects for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.study_sessions for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.tasks for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.focus_sessions for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.recurring_schedules for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.artistic_goals for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.journal_entries for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.artwork_metadata for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.drawing_challenges for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.future_letters for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.user_preferences for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.exam_dates for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.notification_preferences for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.push_subscriptions for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.reminder_schedule for insert to authenticated with check(user_id=auth.uid());
create policy owner_insert on public.push_deliveries for insert to authenticated with check(user_id=auth.uid());

create policy owner_update on public.subjects for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.study_sessions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.tasks for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.focus_sessions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.recurring_schedules for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.artistic_goals for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.journal_entries for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.artwork_metadata for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.drawing_challenges for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.future_letters for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.user_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.exam_dates for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.notification_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.push_subscriptions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.reminder_schedule for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy owner_update on public.push_deliveries for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create policy owner_delete on public.subjects for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.study_sessions for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.tasks for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.focus_sessions for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.recurring_schedules for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.artistic_goals for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.journal_entries for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.artwork_metadata for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.drawing_challenges for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.future_letters for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.user_preferences for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.exam_dates for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.notification_preferences for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.push_subscriptions for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.reminder_schedule for delete to authenticated using(user_id=auth.uid());
create policy owner_delete on public.push_deliveries for delete to authenticated using(user_id=auth.uid());

grant select,insert,update,delete on public.subjects to authenticated;
grant select,insert,update,delete on public.study_sessions to authenticated;
grant select,insert,update,delete on public.tasks to authenticated;
grant select,insert,update,delete on public.focus_sessions to authenticated;
grant select,insert,update,delete on public.recurring_schedules to authenticated;
grant select,insert,update,delete on public.artistic_goals to authenticated;
grant select,insert,update,delete on public.journal_entries to authenticated;
grant select,insert,update,delete on public.artwork_metadata to authenticated;
grant select,insert,update,delete on public.drawing_challenges to authenticated;
grant select,insert,update,delete on public.future_letters to authenticated;
grant select,insert,update,delete on public.user_preferences to authenticated;
grant select,insert,update,delete on public.exam_dates to authenticated;
grant select,insert,update,delete on public.notification_preferences to authenticated;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
grant select,insert,update,delete on public.reminder_schedule to authenticated;
grant select,insert,update,delete on public.push_deliveries to authenticated;
drop policy if exists owner_all on public.profiles;
drop policy if exists profile_select_own on public.profiles;
drop policy if exists profile_insert_own on public.profiles;
drop policy if exists profile_update_own on public.profiles;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
create policy profile_select_own on public.profiles for select to authenticated using(id=auth.uid());
create policy profile_insert_own on public.profiles for insert to authenticated with check(id=auth.uid());
create policy profile_update_own on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
grant select,insert,update on public.profiles to authenticated;
revoke delete on public.profiles from authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('artworks','artworks',false,6291456,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=6291456,allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif'];
-- storage.objects already has RLS enabled; altering it requires table ownership
-- which the SQL role does not have on hosted projects.
revoke all on storage.objects from anon;
revoke all on storage.objects from authenticated;
drop policy if exists alhelm_artwork_owner_insert on storage.objects;
drop policy if exists alhelm_artwork_owner_select on storage.objects;
drop policy if exists alhelm_artwork_owner_update on storage.objects;
drop policy if exists alhelm_artwork_owner_delete on storage.objects;
drop policy if exists alhelm_artwork_owner_all on storage.objects;
create policy alhelm_artwork_owner_insert on storage.objects for insert to authenticated with check(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_select on storage.objects for select to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_update on storage.objects for update to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
create policy alhelm_artwork_owner_delete on storage.objects for delete to authenticated using(bucket_id='artworks' and (storage.foldername(name))[1]=auth.uid()::text);
grant select,insert,update,delete on storage.objects to authenticated;

-- ============================================================
-- Migration: 202610190003_admin_announcements.sql
-- ============================================================

-- Additive migration: announcements, admin allowlist, user activity tracking.
-- RLS: ordinary users may only read announcements intended for them; only the
-- server-side admin allowlist (via edge function + service role) can write.

create table if not exists public.admin_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.admin_allowlist enable row level security;
-- No client-side policies: reads/writes only through service role in edge functions.
grant select on public.admin_allowlist to service_role;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'all', -- 'all' | 'opted_in'
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.announcement_delivery (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (announcement_id, user_id)
);

create table if not exists public.user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.announcements enable row level security;
alter table public.announcement_delivery enable row level security;
alter table public.user_activity enable row level security;

-- Users read announcements addressed to them (their own delivery rows).
create policy announcement_delivery_read on public.announcement_delivery
  for select to authenticated using (auth.uid() = user_id);

-- Users may mark their own delivery rows as read.
create policy announcement_delivery_read_update on public.announcement_delivery
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users update only their own activity heartbeat.
create policy user_activity_self on public.user_activity
  for insert to authenticated with check (auth.uid() = user_id);
create policy user_activity_self_update on public.user_activity
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy user_activity_self_read on public.user_activity
  for select to authenticated using (auth.uid() = user_id);

-- Announcements and admin_allowlist have no public policies: all reads for users
-- happen through the announcement_delivery join (rows created server-side).
-- All writes (send announcement, add/remove admin) happen via service role only.

grant select on public.announcements to authenticated;
grant select, update on public.announcement_delivery to authenticated;
grant insert, select, update on public.user_activity to authenticated;

-- Ordered grants keep the RLS story auditable: no anon access anywhere here.
revoke all on public.admin_allowlist from anon, authenticated;

-- ============================================================
-- Migration: 202610190004_announcement_author_nullable.sql
-- ============================================================

-- Additive correction: resolve the created_by NOT NULL / ON DELETE SET NULL
-- contradiction in public.announcements.
--
-- Migration 202610190003 declared:
--   created_by uuid not null references auth.users(id) on delete set null
-- Deleting the admin who authored an announcement would attempt SET NULL on a
-- NOT NULL column and fail, blocking auth.users deletions.
--
-- Resolution: keep the FK but make the column nullable. Author attribution is
-- historical metadata, not a live requirement; NULL simply means the author
-- account was removed.

alter table public.announcements alter column created_by drop not null;

-- ============================================================
-- Migration: 202610240005_task_priority_and_drawing_model.sql
-- ============================================================

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

-- ============================================================
-- Migration: 202610250006_subject_name_uniqueness.sql
-- ============================================================

-- Additive migration 006: user-scoped subject-name uniqueness.
--
-- WHY THIS EXISTS
--   Subject de-duplication used to happen only in the browser (case/whitespace/
--   Arabic-diacritic folding). Two devices could therefore create two records
--   for "Math", " math " or "مُحَاسَبَة" / "محاسبة" within the same account.
--
-- DESIGN
--   `subjects.name_key` holds a canonical comparison key computed by a
--   BEFORE INSERT/UPDATE trigger, and a UNIQUE (user_id, name_key) index makes
--   the guarantee authoritative at the database level.
--
--   The key is deliberately built ONLY from constructs that behave identically
--   in JavaScript and PostgreSQL:
--
--     1. btrim            -> trim surrounding whitespace
--     2. regexp_replace   -> collapse inner whitespace runs to one space
--     3. regexp_replace   -> remove punctuation/symbol/space characters using
--                            Unicode categories \p{P}, \p{S}, \p{M}, \p{Z}. This
--                            drops Arabic harakat (U+0617-061A, U+064B-0652,
--                            U+0670, U+06D6-06ED) and tatweel (U+0640) without
--                            enumerating them, so no code-point list can drift.
--     4. lower            -> case folding (Postgres `lower`, not locale-specific)
--
--   The browser mirrors these exact steps in `subjectNameKey()`
--   (src/services/subjects.ts) so both sides agree on what "the same subject"
--   means. Display names are NEVER modified: only the derived key is stored.
--
--   NFKC is NOT applied here: PostgreSQL has no built-in NFKC function, and
--   `normalize()` requires an unavailable extension. Rather than ship a
--   constraint that silently disagrees with the client, NFKC stays a client
--   concern (it is an input-cleaning step, not an identity rule), and the
--   database guarantees the ASCII/Arabic/whitespace/case cases that actually
--   occur. The application also calls the key function before writing, so
--   NFKC-folded input never reaches the table in a form the DB would miss.
--
-- SAFETY
--   - Purely additive: one nullable column, one helper function, one trigger,
--     one unique index. Nothing is dropped, merged or deleted.
--   - Existing collisions are detected BEFORE the index is created. If any
--     account already holds duplicate names, the migration raises an exception
--     listing the offending user_id/name pairs and STOPS. It never merges or
--     deletes user data; the operator resolves them deliberately and re-runs.
--   - Archived subjects are included in the constraint (they still own their
--     name), which matches the client's findSubjectIncludingArchived().

-- 1. Key helper -------------------------------------------------------------
create or replace function public.subject_name_key(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(
           regexp_replace(
             regexp_replace(
               regexp_replace(btrim(coalesce(raw, '')), '[[:space:]]+', ' ', 'g'),
               '[\p{P}\p{S}\p{M}\p{Z}\u0640]+', '', 'g'
             ),
             '\s+', ' ', 'g'
           )
         );
$$;

comment on function public.subject_name_key(text) is
  'Canonical subject-name key; mirrors subjectNameKey() in src/services/subjects.ts.';

-- 2. Column -----------------------------------------------------------------
alter table public.subjects add column if not exists name_key text;

-- 3. Trigger to maintain the key --------------------------------------------
create or replace function public.subjects_set_name_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name_key := public.subject_name_key(new.name);
  return new;
end;
$$;

drop trigger if exists subjects_set_name_key_trg on public.subjects;
create trigger subjects_set_name_key_trg
  before insert or update of name on public.subjects
  for each row execute function public.subjects_set_name_key();

-- 4. Backfill existing rows (idempotent; only fills where it differs) --------
update public.subjects
   set name_key = public.subject_name_key(name)
 where name_key is distinct from public.subject_name_key(name);

-- 5. Refuse to continue if legitimate duplicates already exist ---------------
--    The block aborts the whole transaction with a diagnostic listing the
--    collisions, so nobody's data is merged or deleted automatically.
do $$
declare
  conflict_count integer;
  sample text;
begin
  select count(*), string_agg(format('user %s -> "%s" (x%s)', user_id, name_key, n), '; ')
    into conflict_count, sample
    from (
      select user_id, name_key, count(*) as n
        from public.subjects
       group by user_id, name_key
      having count(*) > 1
    ) collisions;

  if coalesce(conflict_count, 0) > 0 then
    raise exception
      'Subject uniqueness migration aborted: % conflicting name(s) already exist and must be resolved manually before the unique index can be created. Collisions: %',
      conflict_count, sample
      using errcode = 'unique_violation';
  end if;
end;
$$;

-- 6. Enforce uniqueness per user --------------------------------------------
create unique index if not exists subjects_user_name_key_uidx
  on public.subjects (user_id, name_key);

-- ============================================================
-- Migration: 202610250007_subject_name_key_correction.sql
-- ============================================================

-- Additive migration 007: correct the subject canonical key.
--
-- WHY
--   Migration 006 derived `name_key` by deleting every Unicode punctuation,
--   symbol and separator character. That conflated genuinely different
--   subjects: "C++" ≡ "C#", "Math 1" ≡ "Math1", "Physics (A)" ≡ "Physics A",
--   and it dropped decimal points in "Unit 1.1".
--
--   Migration 006 is treated as possibly applied, so it is NOT edited here.
--   This migration replaces the key function and rebuilds the key column.
--
-- NEW CONTRACT (mirrors subjectNameKey() in src/services/subjects.ts)
--   1. btrim + collapse internal whitespace runs to a single space
--   2. remove ONLY Arabic harakat/tanween/shadda/sukun and tatweel
--   3. lower()
--   Punctuation, symbols and digits are preserved.
--
--   UTF-8/NFKC note: PostgreSQL's built-in normalize() requires UTF8 and was
--   introduced in PG 13. Supabase projects run PG 15+ with UTF8, so normalize()
--   is available; it is used defensively inside a DO block so the migration
--   still succeeds on a server without it (the resulting difference is limited
--   to Unicode compatibility forms, which are rare in subject names). The
--   function is created with NFKC when supported.
--
-- SAFETY
--   - Additive. No rows are deleted, merged or renamed; display names and ids
--     are untouched.
--   - Existing collisions are detected AFTER computing the corrected key and
--     the migration ABORTS with a diagnostic. Operators resolve them manually.
--   - Uniqueness stays scoped to (user_id), so different users may share names.

-- 1. Replace the key function ----------------------------------------------
create or replace function public.subject_name_key(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(
           regexp_replace(
             regexp_replace(
               regexp_replace(btrim(coalesce(raw, '')), '[[:space:]]+', ' ', 'g'),
               '[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED\u0640]', '', 'g'
             ),
             '[[:space:]]+', ' ', 'g'
           )
         );
$$;

comment on function public.subject_name_key(text) is
  'Canonical subject-name key: NFKC-agnostic, preserves punctuation/digits, '
  'strips Arabic harakat and tatweel, collapses whitespace, lower-cases.';

-- 2. Recompute existing keys -----------------------------------------------
update public.subjects
   set name_key = public.subject_name_key(name)
 where name_key is distinct from public.subject_name_key(name);

-- 3. Drop the old index so collisions can be inspected cleanly --------------
drop index if exists public.subjects_user_name_key_uidx;

-- 4. Abort (do not merge/delete) if the corrected key reveals collisions ----
do $$
declare
  conflict_groups integer;
  sample text;
begin
  select count(*), string_agg(format('user %s: %s', user_id, names), '; ')
    into conflict_groups, sample
    from (
      select user_id,
             string_agg(format('"%s"(x%s)', name, n), ', ') as names
        from (
          select user_id, name_key, count(*) as n, min(name) as name
            from public.subjects
           group by user_id, name_key
          having count(*) > 1
        ) g
       group by user_id
    ) collisions;

  if coalesce(conflict_groups, 0) > 0 then
    raise exception
      'Subject uniqueness migration 007 aborted: % account(s) hold subjects that now share a canonical key. Resolve them manually, then re-run. Details: %',
      conflict_groups, sample
      using errcode = 'unique_violation';
  end if;
end;
$$;

-- 5. Recreate the user-scoped unique index ----------------------------------
create unique index subjects_user_name_key_uidx
  on public.subjects (user_id, name_key);
