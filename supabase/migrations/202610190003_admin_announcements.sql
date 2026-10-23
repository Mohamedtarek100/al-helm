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
