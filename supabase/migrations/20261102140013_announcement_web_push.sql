-- Add idempotent announcement requests and private Web Push outcome tracking.
-- These changes are additive; existing announcements and user subscriptions are preserved.

alter table public.announcements
  add column if not exists request_id uuid;

alter table public.announcements
  add column if not exists push_status text,
  add column if not exists push_attempted integer not null default 0,
  add column if not exists push_accepted integer not null default 0,
  add column if not exists push_failed integer not null default 0,
  add column if not exists push_expired integer not null default 0;

create unique index if not exists announcements_request_id_uidx
  on public.announcements (request_id)
  where request_id is not null;

create table if not exists public.announcement_push_deliveries (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id text not null,
  provider text not null check (provider in ('webpush', 'fcm')),
  status text not null check (status in ('pending', 'accepted', 'failed', 'expired')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_status integer,
  error_code text,
  attempted_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (announcement_id, provider, user_id, subscription_id)
);

create index if not exists announcement_push_deliveries_status_idx
  on public.announcement_push_deliveries (announcement_id, status);

alter table public.announcement_push_deliveries enable row level security;
revoke all on public.announcement_push_deliveries from anon, authenticated;
grant select, insert, update, delete on public.announcement_push_deliveries to service_role;

create or replace function public.record_announcement_push_summary(
  p_announcement_id uuid,
  p_status text,
  p_attempted integer,
  p_accepted integer,
  p_failed integer,
  p_expired integer,
  p_resolved_failed integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_status is null or p_status not in (
    'not_configured',
    'no_subscriptions',
    'sent',
    'partial',
    'failed',
    'recording_failed',
    'outcome_persistence_failed'
  ) or p_attempted < 0 or p_accepted < 0 or p_failed < 0
    or p_expired < 0 or p_resolved_failed < 0 then
    raise exception 'Invalid push summary input.';
  end if;

  update public.announcements
  set push_attempted = coalesce(push_attempted, 0) + p_attempted,
      push_accepted = coalesce(push_accepted, 0) + p_accepted,
      push_failed = greatest(0, coalesce(push_failed, 0) - p_resolved_failed + p_failed),
      push_expired = coalesce(push_expired, 0) + p_expired,
      push_status = case
        when p_status in ('not_configured', 'no_subscriptions', 'recording_failed', 'outcome_persistence_failed') then p_status
        when greatest(0, coalesce(push_failed, 0) - p_resolved_failed + p_failed)
          + coalesce(push_expired, 0) + p_expired > 0 then
            case
              when coalesce(push_accepted, 0) + p_accepted > 0 then 'partial'
              else 'failed'
            end
        when coalesce(push_accepted, 0) + p_accepted > 0 then 'sent'
        else p_status
      end
  where id = p_announcement_id;

  if not found then
    raise exception 'Announcement not found.';
  end if;
end;
$$;

revoke all on function public.record_announcement_push_summary(uuid, text, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_announcement_push_summary(uuid, text, integer, integer, integer, integer, integer)
  to service_role;
