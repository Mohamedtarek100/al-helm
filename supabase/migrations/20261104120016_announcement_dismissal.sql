-- Persist recipient-side announcement dismissal without deleting delivery
-- history or changing the owner's ability to recall an announcement.
alter table public.announcement_delivery
  add column if not exists dismissed_at timestamptz;

create index if not exists idx_announcement_delivery_hidden
  on public.announcement_delivery (user_id, announcement_id)
  where dismissed_at is not null or revoked_at is not null;

-- A recipient may update read_at through the existing RLS-scoped client path.
-- Dismissal is performed by the authenticated Edge Function using the verified
-- JWT user id, so clients cannot mutate recall/delivery metadata directly.
revoke update on public.announcement_delivery from authenticated;
grant update (read_at) on public.announcement_delivery to authenticated;

comment on column public.announcement_delivery.dismissed_at is
  'Set when this recipient dismisses the announcement. The delivery row is retained for audit and delivery counts.';
