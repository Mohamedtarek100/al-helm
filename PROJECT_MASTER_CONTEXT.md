# PROJECT_MASTER_CONTEXT.md — 4uLife (canonical project reference)

> **PERMANENT FILE — DO NOT DELETE, RENAME, REPLACE OR RESET.**
>
> Read this file before changing anything. Update the relevant section when
> architecture, production configuration, security decisions, release procedure
> or production status changes. **Append to the change history — never rewrite
> the whole document.** This is the single source of truth for every future
> developer and coding agent.

**Last updated:** 2026-11-02 (1.5.10 security + sync release)

---

## 1. Project identity

| Item | Value |
|---|---|
| Product name | **4uLife** — Study & Art Companion (formerly AL-HELM) |
| Development repository | `Mohamedtarek100/al-helm` (source of truth for all code) |
| Distribution repository | `Mohamedtarek100/al-helm-app` (public artifacts only — never source) |
| Main development branch | `master` |
| Android application ID | `com.alhelm.studyplanner` |
| Current version | **1.5.9** (versionCode **15**) — see §8 for the release state |
| Production Supabase project ref | `warepmhybetvjzgvpuqf` |
| Production Supabase URL | `https://warepmhybetvjzgvpuqf.supabase.co` |
| Firebase project | `ulife-e4b04` — **Android FCM only** (see §3.8) |
| Official website | https://mohamedtarek100.github.io/al-helm-app/ |
| Release notes | https://github.com/Mohamedtarek100/al-helm-app/releases |

### Technology stack

- **Frontend:** React 19 + TypeScript + Vite, `HashRouter` (required for GitHub Pages + Android WebView deep links), custom CSS design system.
- **Native shell:** Capacitor 7 (Android only today).
- **Primary backend:** Supabase (Postgres + Auth + Storage + Edge Functions).
- **Push (Android):** Firebase Cloud Messaging via `@capacitor/push-notifications`.
- **Push (web):** Web Push / VAPID through a service worker.
- **Local alarms:** `@capacitor/local-notifications` with bundled audio assets.
- **Testing:** Vitest (unit/integration), Playwright via the `browser-automation` skill (real browser QA).

---

## 2. Architecture

### 2.1 Frontend

```
src/
  app/            App shell, routing, LockGate (app-lock lifecycle)
  pages/          Route screens (Home, Tasks, Studio, Settings, Admin, …)
  components/     Shared UI, plus studio/ (StudioShell, brushes, layers)
  services/       All state, persistence, auth, push, alarms, domain logic
  services/persistence/   adapter.ts, coordinator.ts, supabase.ts
  styles/         index.css imports every stylesheet; studio.css is last
  i18n/           translations.ts (EN + AR) — parity is a tested gate
supabase/
  migrations/     Additive SQL, applied in order
  functions/      Deno Edge Functions (currently: admin)
```

The store (`src/services/store.ts`) is the only module that talks to persistence.
Components read through `useAppData()` / `useCollection()` / `useSettings()`.

### 2.2 Persistence and cloud synchronisation

Two layers, always written in this order:

1. **Local device copy** (`LocalStorageAdapter`, key prefix `alhelm.v1.`) — written **first**, so a failed cloud write never loses the customer's edit.
2. **Cloud copy** (`SupabaseAdapter`) — only when an authenticated session exists.

`PersistenceCoordinator` decides between local and cloud mode and owns
`authenticate()` / `persist()` / `migrateLocalToCloud()`.

**Write outcome vocabulary** (used by every form):

| Value | Meaning shown to the user |
|---|---|
| `cloud` | Saved to the account (server confirmed) |
| `local-only` | Saved on this device; account copy pending |
| error | Not saved anywhere — the form keeps the draft |

Never report `cloud` for a write the server did not confirm.

### 2.3 Authentication and guest mode

- **Supabase Auth** (email/password + Google OAuth via `services/nativeAuth.ts` on Android). PKCE redirect: `com.alhelm.studyplanner://auth-callback`.
- **Guest mode** (`services/guestMode.ts`) is an *unauthenticated local* session. Guest data lives only in local storage and **must never be uploaded into an authenticated account without the explicit migration flow** (`migrateLocalToCloud`).
- Signing in **ends the guest session**; announcements and other account-scoped server data are dropped on `authenticate()` and `logout()` so one account's inbox can never appear for another.

### 2.4 Supabase database and RLS

- 24 public tables, **RLS enabled on all 24** (verified live against production).
- Every customer-owned table is scoped to `auth.uid() = user_id` for SELECT, INSERT, UPDATE and DELETE.
- `tasks.due_time` etc. are `TIME WITHOUT TIME ZONE`; **optional times must be sent as `NULL`, never `''`** (this caused SQLSTATE 22007 — see §8, 1.5.9).
- Migrations are **additive only**. Never drop columns, truncate, or rewrite applied migrations.

### 2.5 Edge Functions

| Function | Responsibility | Notes |
|---|---|---|
| `admin` | Admin gate, metrics, user directory, announcements (send/history/recall/retry push), audit log, `feed`, `dismiss`, `read`, `heartbeat` | JWT verification ON; admin identity checked against `ADMIN_EMAILS` **server-side**. The user-facing inbox and dismissal calls also go through this function. |

### 2.6 Artwork storage

Drawings are vector JSON (`DrawingDocument`, model v4) stored as artwork
metadata; PNG renders go to the private `artworks` Supabase Storage bucket under
`<user-id>/<artwork-id>.<ext>`, plus an IndexedDB blob locally for offline
display. Storage policies are owner-scoped.

### 2.7 Android / Capacitor

`npx cap sync android` after every web build. `android/app/build.gradle` reads
signing material from `android/keystore.properties` (git-ignored).

### 2.8 Firebase FCM vs in-app notifications

**These are four separate systems — never conflate them in UI or reports:**

1. **In-app announcements** — rows fetched from the `admin` Edge Function `feed` action. Work regardless of push configuration.
2. **Android FCM** — remote push to the app. Requires `android/app/google-services.json` (present locally, git-ignored) **and** the `FCM_SERVICE_ACCOUNT_JSON` Edge Function secret. That secret is currently **absent**, so remote FCM is **not operational** and the app must say so.
3. **Web Push** — service worker + VAPID. Requires `VAPID_*` secrets; currently **absent**, so **not operational**.
4. **Local Android alarms** — `@capacitor/local-notifications`, scheduled on device with bundled WAV tones. Independent of any server.

### 2.9 Application lock and recovery

See §4 — this is a security boundary and has its own section.

---

## 3. Critical engineering decisions (do not reverse)

1. **Supabase is the primary database and auth provider.** Do not replace it with Firestore or any other store.
2. **Firebase is used only for Android push.** No application data in Firestore.
3. **RLS stays enabled.** Never disable it, and never widen a policy to make a test pass.
4. **Every user-owned record is scoped to the authenticated user.** Server-side checks are authoritative; never trust a client-supplied email or user id.
5. **Cloud success is never reported before server confirmation.**
6. **Guest data never leaks into an authenticated account.** Migration is explicit and user-confirmed.
7. **A failed cloud write keeps recoverable local data**, and the device copy is written before the cloud copy.
8. **Migrations are additive and preserve existing records.**
9. **The permanent Android signing key is the release identity.** Never generate a replacement key; see `docs/ANDROID_SIGNING_AND_RELEASE.md`.
10. **The app lock can be removed only by verified ownership.** No backdoor, master PIN, universal recovery code, or "support override" — ever.
11. **When locked, protected screens are not rendered at all** (not merely covered).
12. **Optional `TIME` columns are sent as `NULL`, never `''`.**

---

## 4. Security architecture — application lock (P0, fixed 1.5.9 → next release)

The lock is **device-local**, independent of the account password. Three distinct
concepts that must stay separate:

| Concept | What it protects | How it is proven |
|---|---|---|
| Supabase account password | The customer's cloud account | Supabase Auth |
| App lock PIN | This installation | Local PBKDF2 hash (150 000 iterations, per-device salt) |
| Guest recovery key | A guest's local data on this device | One-time 20-char key, only its hash stored |

### 4.0 Status: CLOSED in 1.5.10

Both vulnerabilities below are fixed and verified. The browser security suite
(`shots/security2.mjs`) confirms, on the built application: lock on start,
Forgot-PIN does not unlock, no email-as-proof field, forged key rejected,
direct route to `#/tasks` stays locked with no Tasks DOM, storage tampering does
not unlock, force-close/reopen stays locked, and the correct PIN still unlocks.

### 4.1 Confirmed vulnerabilities (both fixed)

**A. One-click lock removal.** `AppLockScreen.forgetPin()` called
`clearLockRecord()` and `onForgotPin()` on a single button press. Nothing proved
ownership, so anyone holding a locked device could read a guest's tasks,
subjects and drawings (all in `localStorage`) without knowing the PIN.

**B. Lock not applied to a running app.** `LockGate` snapshotted the lock at
mount, so a PIN enabled in Settings was invisible until the next reload, and a
hash navigation to a protected route rendered the app unlocked. Verified in the
running app before the fix: reload → locked; hash navigation with the same record
→ fully interactive Tasks page.

### 4.2 Current contract

- The lock is removed only via a **recovery ceremony** producing a **single-use,
  10-minute, record-bound token** spent by `resetLockAfterOwnershipProof()`.
- **Account path:** re-authenticate with the account password through Supabase;
  the returned session's user id must match the account that owns the device.
  Typing an email address is never proof.
- **Guest path:** the one-time recovery key issued when the lock is created.
- Rate limiting: escalating delay after repeated failures, capped (never a
  permanent lockout — that would be a self-inflicted denial of service).
- Recovery **never deletes customer data**.
- The lock gate sits **above the router**, so no route, deep link or back
  navigation can render a protected screen while locked.

### 4.3 Known limitations

- The PIN hash lives in `localStorage`, because no secure-storage plugin is
  installed. A local convenience lock is therefore **not** protection against an
  attacker with the unlocked device and developer tooling. Biometric unlock is
  delegated to the OS and protected by Android Keystore.
- App lock does **not** encrypt local data at rest.

---

## 5. Current production status

### 5.1 Confirmed working (with evidence)

- Task create / edit / complete / delete persisted locally and in Supabase.
- `due_time` serialisation fix verified against production Postgres.
- Announcement inbox, unread badge, read state, dismissal (account-scoped, idempotent).
- Admin Edge Function v8 deployed and byte-identical to the merged source; JWT verification on; unauthenticated call → 401, anon-key call → 403.
- RLS on all 24 public tables.
- Dream Studio: viewport-locked workspace, working brush engine, layers, undo/redo, autosave.

### 5.2 Implemented but NOT verified on a physical device

- Audible alarm output on real Android hardware.
- Alarm behaviour across reboot.
- Cold-restart persistence on a real phone.
- Android deep links into the app while locked.

### 5.3 Disabled / not configured

- **Remote FCM** — `FCM_SERVICE_ACCOUNT_JSON` secret absent.
- **Web Push** — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` absent.
- The client-side Firebase configuration exists; server-side sending does not.

### 5.4 Outstanding production risks

- 7-day bound on recovering device-only records (§6) — being replaced by a durable queue.
- No automated off-device database backups configured (see `docs/PRODUCTION_OPERATIONS.md`).
- No privacy policy / terms published (owner action).

---

## 6. Pending synchronisation (current implementation and its weakness)

Local edits whose cloud write failed are retained and merged back on restore by
`mergePendingIntoRemote()`, which:
- keeps device-only records,
- prefers the **server** value for ids present on both sides,
- never duplicates an id,
- is bounded to records updated within **7 days**.

**That 7-day bound is a known weakness** for a customer who is offline longer;
it must be replaced by a durable pending queue rather than extended.

---

## 7. Release history

### 1.5.7 — versionCode 13
Baseline established by the previous agent. Known defects: silent alarms, unreliable task saving, admin overlay dimming, studio layout.

### 1.5.8 — versionCode 14
- Bundled synthesised alarm tones on versioned channels (`4ulife-reminders-*-v2`).
- Device-write failures no longer reported as "saved on this device".
- Deleted announcements no longer resurrect; cross-account leak fixed.
- Admin dialog stacking fixed.
- Dream Studio rebuilt: viewport-locked shell, brush engine, layers, model v4.
- Release: https://github.com/Mohamedtarek100/al-helm-app/releases/tag/v1.5.8

### 1.5.9 — versionCode 15
- **Task persistence root cause fixed:** empty optional `due_time` was sent as
  `''`, rejected by Postgres with SQLSTATE 22007, which failed the entire
  snapshot write.
- Locally saved but server-rejected records preserved across a cold start.
- 15 regression tests; both fixes proven load-bearing by reverting them.
- Release: https://github.com/Mohamedtarek100/al-helm-app/releases/tag/v1.5.9

*(Each release above used the same permanent signing certificate.)*

---

## 8. Where everything else is documented

| Topic | File |
|---|---|
| Signing identity, keystore, release procedure | `docs/ANDROID_SIGNING_AND_RELEASE.md` |
| Deploy, migrations, functions, secrets, backups | `docs/PRODUCTION_OPERATIONS.md` |
| Customer launch gates and owner actions | `docs/CUSTOMER_LAUNCH_CHECKLIST.md` |
| Architecture detail | `docs/ARCHITECTURE.md` |
| Agent rules | `AGENTS.md` |
| Release notes | `CHANGELOG.md` |

---

## 9. Change history (append-only)

- **2026-11-02** — Document created. Recorded 1.5.7–1.5.9 history, architecture,
  production status, and the two confirmed app-lock vulnerabilities with their
  security contract.
### 7.1 1.5.10 — versionCode 16 (security + synchronisation)

- **App-lock bypass closed.** "Forgot PIN" previously cleared the lock on one
  confirmation press; removal now requires a verified ceremony token.
- **Lock gate moved above the router**, and protected screens are not rendered
  while locked. Lock state is observed continuously (a PIN set in Settings was
  invisible to the gate until reload).
- **Durable pending queue** replaces the 7-day heuristic; deletions are stored
  as tombstones so they cannot be resurrected.

- **2026-11-02** — 1.5.10. App-lock bypass CLOSED (verified in a real browser:
  8/8 attack checks blocked). Lock gate moved above the router; protected screens
  are no longer rendered while locked; lock state observed continuously via an
  in-document event (a PIN enabled in Settings was previously invisible until
  reload). Durable pending queue (`pendingQueue.ts`) replaces the 7-day
  heuristic: intent is recorded per account on every failed cloud write and on
  every signed-in local-mode write, cleared only after server confirmation.
  Integration tests (`pendingSync.integration.test.ts`) prove the store feeds
  it. Docs: AGENTS.md, docs/ARCHITECTURE.md, docs/PRODUCTION_OPERATIONS.md,
  docs/ANDROID_SIGNING_AND_RELEASE.md, docs/CUSTOMER_LAUNCH_CHECKLIST.md,
  CHANGELOG.md.