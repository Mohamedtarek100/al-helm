# TODO — 4uLife / Al-Helm takeover (v1.5.8 candidate)

Legend: `[x]` verified and completed · `[ ]` pending · `[!]` blocked (device / credentials / owner approval)
Branch: `fix/1.5.8-p0-persistence-alarms-studio` · Base: `master` · Dev repo: `Mohamedtarek100/al-helm`
Distribution repo (artifacts only): `Mohamedtarek100/al-helm-app`

Evidence for every `[x]` is in `IMPLEMENTATION_REPORT.md`.

---

## 0. Quality gates (all green)

- [x] TypeScript: app + node projects, 0 errors.
- [x] Vitest: 899 tests, 0 failed.
- [x] Lint: 0 errors.
- [x] Edge Function TypeScript, translation parity, migration consistency, secret scan: pass.
- [x] Production web build: pass.
- [x] Browser run: 0 console errors, 0 failed requests.

## 1. Tasks and data persistence (P0)

- [x] Device-write failure in cloud mode is a real error (was reported as "saved on this device").
- [x] Regression test for that branch (`taskCreation.test.ts`).
- [x] Home + My Tasks report the real `WriteResult` (`cloud` / `local-only` / error).
- [x] Cloud writes verify account ownership before and after every write.
- [x] Production schema inspected read-only: 16 migrations in sync, dismissal RLS present, Edge Function v8.
- [!] Live end-to-end cloud write needs an approved isolated test account (no production user data was touched).

## 2. Audible Android alarms (P0)

- [x] Root cause: `content://settings/system/...` URIs can resolve to silence.
- [x] Bundled synthesised WAVs in `res/raw` + `public/tones`.
- [x] Versioned channel ids (`-v2`); legacy 1.5.7 ids re-created with audio.
- [x] Test/audition path posts a real notification on the selected channel.
- [x] Manifest: `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `VIBRATE`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`.
- [x] Create / rename / time / tone / preview / enable / disable / delete; past one-time alarms rejected; retries idempotent — covered by unit tests.
- [!] **Audible output on a physical Android device — blocked (owner device).**

## 3. In-app notifications (P0)

- [x] Header badge derived from the store and fed by a mount/focus/interval sync.
- [x] Inbox polls (45 s) + on focus/visibility.
- [x] Dismissal is account-scoped and idempotent; queued dismissals filter incoming rows.
- [x] Dismissal survives reload; queue is per account in device storage.
- [x] Account isolation: announcements dropped on logout/authenticate; cross-account error leak fixed.
- [x] New `announcementDismissal.test.ts` (9 tests) covers retry, resurrection, isolation, read state.

## 4. Admin console (P0)

- [x] Overlay stacking root-caused and fixed (backdrop painted over the dialog).
- [x] Send flow: validation, server recipient count, confirmation, single in-flight request, honest outcome.
- [x] Recall / retry-push / history wired to real Edge Function calls with error surfacing.
- [!] Live send/recall against production — deliberately not run; needs an approved isolated test recipient.

## 5. Dream Studio (P0/P1)

- [x] New workspace architecture (top bar, layer column, canvas, tool rail, colour dock, mobile rail + bottom sheet).
- [x] Viewport-locked on the studio route: no page scrolling at 1440×900, 412×915, 390×844, 915×412.
- [x] Canvas fills the stage and keeps the document ratio (verified 1.442–1.454 ≈ 900/620).
- [x] Brush engine: pencil, ink, hard, soft, calligraphy, eraser; size/opacity/flow/hardness/spacing all affect output (tested).
- [x] Layers: add/delete (preserves artwork)/reorder/visibility/lock/rename; engine enforces lock.
- [x] Document model v4 with backward-compatible v2/v3 parsing.
- [x] Drawing verified end-to-end in the browser; autosave writes the draft.
- [x] Mobile bar and panel tabs fit without horizontal scrolling; secondary actions moved off the phone bar.
- [!] PNG export not re-clicked in this session's automation; the code path is unchanged from 1.5.7 and covered by the existing build.

## 6. Push notifications

- [x] `android/app/google-services.json` **exists** and is git-ignored: project `ulife-e4b04`, package `com.alhelm.studyplanner`.
- [x] Push status reported honestly (in-app is never described as delivered push).
- [!] Remote FCM delivery: needs the service-account JSON in Supabase Edge Function secrets, then a real delivery test.

## 7. Release — 1.5.9 shipped

- [x] Confirmed production defect fixed: empty `due_time` is now `NULL` (SQLSTATE 22007 was failing the whole snapshot).
- [x] Recovery: device-only records preserved across cloud restore (server always wins on shared ids).
- [x] 914 tests pass, including 15 new regression tests; both fixes proven load-bearing by reverting them.
- [x] Production Postgres proof (rolled back): `''` → ERROR 22007, `NULL` → accepted, `14:30` verbatim, 0 rows left behind, unauthenticated write → 42501.
- [x] APK: 1.5.9 / versionCode 15, `com.alhelm.studyplanner`, signature identical to 1.5.7.
- [x] Published: release `v1.5.9`, site + APK live, downloaded APK checksum matches the manifest.
- [!] **Physical-device cold-restart verification (Tests A/B/C) — no device attached.**
- [!] Remote FCM/Web Push — server secrets absent (`FCM_SERVICE_ACCOUNT_JSON`, `VAPID_*`).

Stopped publication because these release gates are unmet:

1. Alarm audibility unverified on a device.
2. No production signing keystore available → cannot produce an upgrade-compatible signed APK.
3. Admin send/recall not exercised against the live backend.
