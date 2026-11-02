# Customer launch checklist — 4uLife

> Read `PROJECT_MASTER_CONTEXT.md` first. This checklist is the gate for letting
> **real customers** use 4uLife. Each line must be evidenced, not assumed.

Status legend: `[x]` verified with evidence · `[!]` blocked on owner action · `[ ]` not yet done

---

## 1. Access and accounts

- [x] Registration and sign-in work (Supabase Auth; email/password + Google OAuth).
- [x] Email confirmation is enforced by the project (observed: a fresh signup returns no session).
- [x] Sign-out clears the session and drops the previous account's server data from the device store.
- [x] Account switching cannot show one account's announcements to another.
- [ ] Password reset by **email** verified end-to-end — `[!] needs an inbox the owner controls`.
- [x] Guest mode works and is clearly device-local.
- [x] Guest → account migration is explicit and user-confirmed.

## 2. Application lock (P0 security)

- [x] A configured PIN locks the app on start and on return from background.
- [x] "Forgot PIN" does **not** unlock the app (verified in a real browser run).
- [x] The old "Remove lock and sign out" button no longer exists.
- [x] Direct navigation to a protected route while locked renders **only** the lock screen.
- [x] Unlocking requires either the PIN, biometrics, the account password (re-authenticated through Supabase) or the guest recovery key.
- [x] Recovery tokens are single-use, expire in 10 minutes, and are bound to the lock record.
- [x] Forged recovery keys are rejected.
- [x] Recovery never deletes customer data.
- [x] No master PIN / universal code / support backdoor exists in the codebase.
- [!] Biometric unlock on a physical Android device.
- [!] Android deep link into the app while locked (device required).

## 3. Data persistence and sync

- [x] Task without a time saves (production Postgres proof, rolled back: `''` → 22007, `NULL` → accepted).
- [x] Task with a time saves verbatim (`14:30`).
- [x] A failed cloud write is recorded in the durable pending queue (integration test through the real store).
- [x] Pending work survives a new store session and is per-account.
- [x] Server wins over a stale local copy; tombstones prevent deleted records from returning.
- [x] The user is told "saved on this device / waiting to sync" rather than "saved".
- [!] Cold-restart on a real phone (device required).

## 4. Alarms and notifications

- [x] Bundled alarm tones are compiled into the APK (`res/` + `assets/public/tones`).
- [x] Versioned notification channels; legacy 1.5.7 channels repaired.
- [x] Alarm CRUD, preview, enable/disable, and past-one-time rejection covered by tests.
- [x] In-app announcements, unread badge, read state, dismissal (account-scoped, idempotent).
- [x] Remote push reported honestly as **not configured** (FCM/VAPID secrets absent).
- [!] Audible alarm on a physical Android device.
- [!] Reboot restoration on a physical Android device.

## 5. Release and infrastructure

- [x] Web build, signed APK, checksum, manifests published to `al-helm-app`.
- [x] APK signature matches the permanent key (certificate identical to 1.5.7).
- [x] Published APK re-downloaded and its SHA-256 matched.
- [x] RLS enabled on all 24 public tables.
- [!] Automated database backups confirmed in the Supabase dashboard (owner action).

## 6. Business and legal (OWNER ACTION — not started)

These cannot be invented by an engineer; they must come from you:

- [!] **Privacy policy** — published and linked from the app and the website.
- [!] **Terms of use** — published.
- [!] **Support contact** — a real address or inbox that customers can reach.
- [!] **Data retention / deletion policy** — what is kept and for how long; how a customer requests deletion.
- [!] **Store listing** (if distributing via Play): description, screenshots, content rating, data-safety form.

Do not launch to the public without at minimum a privacy policy and a support contact.

## 7. Monitoring

- [ ] Error tracking configured (Sentry or equivalent).
- [ ] A named person receives Supabase authentication and Postgres error alerts.
- [ ] Uptime check on the website.

## 8. Recommended rollout

**Start controlled, not public.** Invite a small group (5–20 people) for one
week, watch the error logs, then widen. Specifically watch for:

1. Tasks failing to sync (Postgres `22P02`/`22007`, HTTP 4xx on `/rest/v1/tasks`).
2. Lock-screen reports ("I can't get back in") — recovery flow friction.
3. Alarm reports from Android users.

Only after that week should the app be promoted publicly.
