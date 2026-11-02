# Architecture — 4uLife

> Summary of the system. The authoritative description, including production
> decisions and current status, is `PROJECT_MASTER_CONTEXT.md`; read that first.
> This page is the deeper reference for how the pieces fit together.

---

## 1. Layers

```
┌──────────────────────────────────────────────────────────────┐
│ UI (React)  pages/ · components/ · app/                      │
│   reads: useAppData / useCollection / useSettings            │
└───────────────┬──────────────────────────────────────────────┘
                │ actions only (no direct persistence)
┌───────────────▼──────────────────────────────────────────────┐
│ store.ts — single source of in-memory truth                  │
│   · write queue (serialises snapshots)                       │
│   · save outcome: 'cloud' | 'local-only' | error             │
│   · pending-intent recording (diff against last write)        │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ persistence/                                                 │
│   coordinator.ts — local vs cloud mode, migration, restore    │
│   adapter.ts     — LocalStorageAdapter (device copy)          │
│   supabase.ts    — SupabaseAdapter (cloud copy)               │
│   pendingQueue.ts— durable per-account upsert/delete queue    │
└───────┬───────────────────────────────┬──────────────────────┘
        │                               │
  localStorage                    Supabase (Postgres + Auth
  `alhelm.v1.*`                    + Storage + Edge Functions)
```

## 2. Write path

1. A page calls a store action (`createTask`, `updateTask`, …).
2. `store` computes the next full `AppData` snapshot.
3. `commitAndPersist` → `persistCloudSnapshot`:
   - **device copy first** (always), then
   - **cloud copy** if an authenticated session exists.
4. Outcomes:
   - both succeed → `'cloud'`, baseline advanced, matching queue entries cleared;
   - cloud fails but device succeeds → `'local-only'`, **intent queued**;
   - device fails → error, state rolled back.

A snapshot is written whole, so one invalid column fails the entire write. That
is why serialisation correctness matters (`due_time` NULL vs `''`).

## 3. Restore path

`initStore()` → `coordinator.initialize()` (local snapshot) →
`authenticateCloudUser()` (if a session exists):

1. Load the device recovery snapshot.
2. Load the cloud snapshot.
3. If the account has cloud content, merge: **server rows are the base**;
   pending tombstones are removed; pending upserts absent from the server are
   re-added from the device copy; records present on both keep the server value.
4. Records awaiting upload are counted (`pendingUploadCount`) so the UI can show
   "waiting to sync" honestly.

## 4. The app lock

```
LockGate (above the router)
  ├─ lock live? ──► render AppLockScreen ONLY (protected screens not mounted)
  │                   ├─ PIN → PBKDF2 verify
  │                   ├─ biometrics → OS/Keystore
  │                   └─ Forgot → recovery ceremony
  │                         ├─ account: Supabase password re-auth, id must match
  │                         └─ guest:   one-time recovery key
  │                         → single-use token → resetLockAfterOwnershipProof
  └─ unlocked ──► <Routes>
```

The gate is mounted above `Routes`, so no navigation path can skip it. The lock
record is re-read on route change, focus, visibility and a custom event, because
`storage` events do not fire in the document that made the change.

## 5. Notifications (four separate systems)

| System | Transport | Server dependency |
|---|---|---|
| In-app announcements | `admin` Edge Function `feed` | `ADMIN_EMAILS` |
| Android FCM | Firebase | `FCM_SERVICE_ACCOUNT_JSON` (absent) |
| Web Push | service worker + VAPID | `VAPID_*` (absent) |
| Local alarms | `@capacitor/local-notifications` | none |

The UI must never describe an in-app row as a delivered push.

## 6. Data model

`AppData` is a flat object of collections: `profile`, `settings`, `subjects`,
`sessions`, `tasks`, `focusSessions`, `journal`, `goals`, `artworks`,
`challenges`, `letters`, `exams`, `notifications`. Each collection maps to a
Postgres table; rows are scoped by `user_id` with RLS.

Drawing documents are vector JSON (`DrawingDocument` v4). Rendering, brushes and
hit-testing are pure functions in `services/drawing.ts`, `services/brushes.ts`
and `services/inkLayers.ts`, which is what makes them unit-testable.

## 7. Trust boundaries

| Boundary | Enforced by |
|---|---|
| Client → database | RLS policies (`auth.uid()`) |
| Client → admin actions | `admin` Edge Function + JWT + `ADMIN_EMAILS` |
| Device → protected UI | `LockGate` (renders or does not render) |
| Guest → account | explicit migration only |
| Session → account data | user-id check before and after every write |
