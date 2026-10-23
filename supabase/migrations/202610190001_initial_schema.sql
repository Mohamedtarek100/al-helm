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
