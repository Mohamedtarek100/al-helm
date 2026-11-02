-- Migration 012: announcement recall (owner can revoke a sent announcement).
--
-- STATUS: PROPOSED — NOT APPLIED. Requires owner approval.
--
-- ── WHY A COLUMN AND NOT A DELETE ────────────────────────────────────────
--   Recalling a sent announcement must make it disappear from recipients'
--   inboxes. The tempting implementation is `delete from announcement_delivery
--   where announcement_id = ...`. That is wrong here:
--
--     * The delivery row is the PROOF that the announcement was delivered. It
--       is what the admin "delivery" and "opened" counts are computed from.
--       Deleting it would silently rewrite history — an announcement that went
--       to 400 people would read as "sent to 0".
--     * A recall is not a retraction of fact; it is a new event ("the owner
--       withdrew this"). Recording it preserves both truths.
--     * Deletion is irreversible and destroys the audit trail we built in 010.
--
--   So recall sets `revoked_at`; the recipient feed filters it out; the admin
--   history shows it as recalled with the original delivered count intact.
--
-- ── SAFETY ───────────────────────────────────────────────────────────────
--   Purely additive: one nullable column + one partial index. No existing
--   column, row or policy is modified. Existing rows get NULL (= not revoked),
--   which is exactly their current meaning, so nothing changes behaviourally
--   until an owner recalls something.
--
-- ── RLS ──────────────────────────────────────────────────────────────────
--   The existing recipient policies already scope rows by `auth.uid() =
--   user_id`. Reading `revoked_at` needs no new grant. No new policy is added:
--   a user must not be able to clear their own revocation.
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────
--   alter table public.announcement_delivery drop column if exists revoked_at;
--   drop index if exists public.idx_announcement_delivery_active;
--   (Drops only the recall marker; delivery history is untouched.)

alter table public.announcement_delivery
  add column if not exists revoked_at timestamptz;

-- Announcements the owner has also withdrawn wholesale (optional, for the case
-- where a delivery row was never created — e.g. a send that failed mid-fan-out).
alter table public.announcements
  add column if not exists revoked_at timestamptz;

-- The recipient feed filters on `revoked_at is null`; this keeps that cheap on
-- large delivery tables without affecting anything else.
create index if not exists idx_announcement_delivery_active
  on public.announcement_delivery (announcement_id)
  where revoked_at is null;

-- The Edge Function (service_role) needs UPDATE on the delivery table to stamp
-- a recall. Migration 009 already granted it; this is stated for clarity.
grant update on public.announcement_delivery to service_role;
grant update on public.announcements to service_role;

comment on column public.announcement_delivery.revoked_at is
  'Set when the owner recalls the announcement. Non-null rows are hidden from the recipient feed; the row is retained so delivery counts stay truthful.';
comment on column public.announcements.revoked_at is
  'Set when the owner recalls an announcement that may have undelivered rows.';
