# Changelog

All notable customer-facing changes. Newest first.
Release artifacts live in `Mohamedtarek100/al-helm-app`.

---

## 1.5.10 — unreleased (in progress)

### Security (critical)
- **Application lock can no longer be bypassed.** "Forgot PIN" used to clear the
  lock on a single confirmation press, exposing a guest's local data (tasks,
  subjects, drawings) to anyone holding the device. Removal now requires a
  verified recovery ceremony that produces a single-use, 10-minute,
  record-bound token.
- **The lock now applies to a running app.** A PIN enabled in Settings was
  invisible until the next reload, and a hash navigation to a protected route
  rendered the app unlocked. The lock is now observed continuously and sits
  above the router, so no route, deep link or back navigation can skip it.
- **When locked, protected screens are not rendered at all** — not merely
  covered by an overlay.
- New one-time guest recovery key, shown once when the lock is enabled.

### Reliability
- Durable pending synchronisation: a write the server did not accept is recorded
  per account as an upsert or a deletion (tombstone) and replayed until the
  server confirms it. Replaces the previous 7-day age heuristic, which silently
  dropped work from anyone offline longer than a week and could not represent an
  offline deletion at all.
- Pending work is per account and never replays under a different account; a
  signed-out device keeps it without exposing it to the next user.

---

## 1.5.9 — versionCode 15

- Fixed the production task-persistence failure: an empty optional time was sent
  as `''`, which PostgreSQL rejected (`SQLSTATE 22007`), failing the whole
  snapshot write. Optional times are now `NULL`; real times are stored verbatim.
- Locally saved but server-rejected records are preserved across a cold start.

## 1.5.8 — versionCode 14

- Bundled, synthesised alarm tones on versioned notification channels
  (system sound URIs could resolve to silence).
- Device-write failures no longer reported as "saved on this device".
- Deleted announcements no longer reappear; cross-account leak fixed.
- Admin dialog stacking fixed (scrim painted over its own dialog).
- Dream Studio rebuilt: viewport-locked workspace, brush engine (pencil, ink,
  hard, soft, calligraphy, eraser), layers, document model v4.

## 1.5.7 — versionCode 13

- Baseline release established by the previous maintainer.
