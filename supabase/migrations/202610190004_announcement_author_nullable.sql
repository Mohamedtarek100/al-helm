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
