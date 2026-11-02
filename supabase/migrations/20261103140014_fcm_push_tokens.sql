-- Store authenticated Android FCM registrations separately from browser
-- Web Push subscriptions. Raw device tokens are never available to clients.

create table if not exists public.fcm_push_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 1 and 128),
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists fcm_push_tokens_user_id_idx
  on public.fcm_push_tokens (user_id);

alter table public.fcm_push_tokens enable row level security;
revoke all on table public.fcm_push_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.fcm_push_tokens to service_role;
