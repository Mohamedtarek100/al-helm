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
do $$ declare t text; begin
  foreach t in array['subjects','study_sessions','tasks','focus_sessions','recurring_schedules','artistic_goals','journal_entries','artwork_metadata','drawing_challenges','future_letters','user_preferences','exam_dates','notification_preferences','push_subscriptions','reminder_schedule','push_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
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
alter table storage.objects enable row level security;
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


-- ============ MIGRATION 2 (deduplicated) ============

-- Harden ownership, cross-user relationships, profile policies and private artwork access.
-- NOTE: equivalent composite owner-scoped subject FKs are already declared in
-- 202610190001 on focus_sessions (named), recurring_schedules and exam_dates
-- (inline). Re-adding them here would raise a duplicate-constraint error, so
-- no constraint changes are made in this migration.

-- Replace permissive generic policies with operation-specific owner policies; profile key is id, not user_id.
do $$ declare t text; begin
  foreach t in array['subjects','study_sessions','tasks','focus_sessions','recurring_schedules','artistic_goals','journal_entries','artwork_metadata','drawing_challenges','future_letters','user_preferences','exam_dates','notification_preferences','push_subscriptions','reminder_schedule','push_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('drop policy if exists owner_all on public.%I',t);
    execute format('revoke all on public.%I from authenticated',t);
    execute format('drop policy if exists owner_select on public.%I',t);
    execute format('drop policy if exists owner_insert on public.%I',t);
    execute format('drop policy if exists owner_update on public.%I',t);
    execute format('drop policy if exists owner_delete on public.%I',t);
    execute format('create policy owner_select on public.%I for select to authenticated using(user_id=auth.uid())',t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check(user_id=auth.uid())',t);
    execute format('create policy owner_update on public.%I for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using(user_id=auth.uid())',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  end loop;
end $$;
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
alter table storage.objects enable row level security;
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

