-- Remove inherited table-level privileges that bypass RLS, while preserving
-- the authenticated recipient feed and the server-side admin operations.

revoke all on table public.announcements from public, anon, authenticated, service_role;
grant select on public.announcements to authenticated;
grant select, insert, update, delete on public.announcements to service_role;

revoke all on table public.announcement_delivery from public, anon, authenticated, service_role;
grant select, update on public.announcement_delivery to authenticated;
grant select, insert, update, delete on public.announcement_delivery to service_role;
