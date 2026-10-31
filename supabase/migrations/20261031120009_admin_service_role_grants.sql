-- Additive migration 009: grant service_role the privileges the admin Edge
-- Function actually needs.
--
-- ROOT CAUSE OF THE PRODUCTION 500s
--   /admin/metrics and /admin/history returned 500 while /admin/users returned
--   200. Migration 003 created `announcements`, `announcement_delivery` and
--   `user_activity` and granted them to `authenticated`, but never granted
--   anything to `service_role` — which is the role the Edge Function uses.
--   Verified on the live database:
--
--     grantee=service_role, public.announcements         -> REFERENCES,TRIGGER,TRUNCATE only
--     grantee=service_role, public.announcement_delivery -> REFERENCES,TRIGGER,TRUNCATE only
--     grantee=service_role, public.user_activity         -> REFERENCES,TRIGGER,TRUNCATE only
--
--   `users` survived because it reads the auth directory via the Admin API
--   (which uses the service key, not table privileges). Everything that hits
--   these three tables failed with a permission error.
--
-- WHY THIS IS SAFE
--   - `service_role` bypasses RLS by design and is NEVER shipped to a browser;
--     it exists only inside the Edge Function after the JWT and the ADMIN_EMAILS
--     allowlist have been verified.
--   - Client-facing policies are untouched: `anon` and `authenticated` grants
--     are unchanged, and RLS stays enabled on every table.
--   - Purely additive: no table, row, column or policy is modified or dropped.
--
-- ROLLBACK
--   revoke select, insert, update, delete on public.announcements from service_role;
--   revoke select, insert, update, delete on public.announcement_delivery from service_role;
--   revoke select, insert, update, delete on public.user_activity from service_role;
--   (grants on push_subscriptions and profiles predate this migration and are NOT revoked.)

-- Announcements: the Edge Function reads history and inserts new rows.
grant select, insert, update, delete on public.announcements to service_role;

-- Delivery fan-out: inserted on send, read for the recipient feed and counts.
grant select, insert, update, delete on public.announcement_delivery to service_role;

-- Activity: read for metrics, and upserted by the signed-in heartbeat flow.
grant select, insert, update, delete on public.user_activity to service_role;

-- Defensive: the metrics action counts these too. `if not exists` semantics are
-- not available for grants, so re-granting is idempotent by nature.
grant select on public.push_subscriptions to service_role;
