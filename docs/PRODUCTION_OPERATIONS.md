# Production operations — 4uLife

> Companion to `PROJECT_MASTER_CONTEXT.md`. Supabase CLI must be authenticated as
> the project owner; do not paste tokens into chat.

---

## 1. Environments

| Environment | Where | Used for |
|---|---|---|
| **Development** | `D:\EL 7lm` + `npm run dev` (port 5173) | Feature work |
| **QA / staging** | `npm run build` + `vite preview` (4177) + the `browser-automation` skill | Real-browser verification |
| **Production** | GitHub Pages (`al-helm-app`) + Supabase `warepmhybetvjzgvpuqf` + published APK | Customers |

There is **no separate staging database**. QA writes therefore must either
(a) use a disposable account, or (b) be rejected by RLS. Never point QA at a
customer's records.

## 2. Identifying the production project

```powershell
npx supabase projects list                 # confirm warepmhybetvjzgvpuqf
Get-Content supabase\.temp\project-ref     # must print warepmhybetvjzgvpuqf
```

If the linked ref differs, **stop** — you are about to touch the wrong project.

## 3. Inspecting migrations safely

```powershell
npx supabase migration list                # local vs remote; all must match
npm run check:migrations
```

Read a migration before applying it. Requirements: additive, idempotent where
possible, no `DROP`/`TRUNCATE`, no policy widening, preserves existing rows.

```powershell
npx supabase db push          # applies PENDING migrations only
```

Verified state at handover: **15 migrations applied**, in sync, no pending.

Read-only queries against production:

```powershell
# write the SQL to a file, then:
npx supabase db query --linked --file .rls.sql
```

Wrap any exploratory INSERT/UPDATE in `begin; … rollback;`.

## 4. Edge Functions

```powershell
npx supabase functions list                                  # name, version, status, updated_at
npx supabase functions deploy admin --project-ref warepmhybetvjzgvpuqf
```

- JWT verification must remain **enabled**.
- Only deploy when local source genuinely differs from the deployed version.
  `functions download` overwrites local files — use it in a scratch copy to diff.
- Deployed at handover: `admin` v8, ACTIVE, byte-identical to `master`.

## 5. Secrets (names and purpose only)

```powershell
npx supabase secrets list      # shows a digest per secret — never values
```

| Secret | Purpose | Status at handover |
|---|---|---|
| `ADMIN_EMAILS` | Server-side admin allowlist | **configured** |
| `FCM_SERVICE_ACCOUNT_JSON` | Firebase service account for Android push | **missing** |
| `VAPID_PUBLIC_KEY` | Web Push public key | **missing** |
| `VAPID_PRIVATE_KEY` | Web Push private key | **missing** |
| `VAPID_SUBJECT` | Web Push contact (mailto:) | **missing** |

Missing push secrets mean remote push is **not operational**; the app reports
that honestly. Do not add placeholders.

## 6. Deploying the web application

1. `npm run build`
2. Clone `Mohamedtarek100/al-helm-app`, copy `dist/*` over `assets/` and `index.html`.
3. Commit + push to `main`; GitHub Pages serves it.

The distribution repo's `build-and-release.yml` currently **hard-codes `v1.5.7`**
and builds only the web bundle. Do **not** run it until that tag is parameterised —
it would attach new assets to the old release.

## 7. Diagnosing problems

| Symptom | Where to look |
|---|---|
| Auth failures | Supabase → Authentication → Logs; check redirect allow-list for `com.alhelm.studyplanner://auth-callback` and the Pages URL |
| RLS denials (`42501`) | Supabase → Logs → Postgres; the query is running as the wrong role or `auth.uid()` is null |
| Cloud writes rejected (`400`, `22P02`/`22007`) | Supabase → Logs → Postgres; inspect the failing column and the client payload |
| Edge Function 401/403 | Function logs; `ADMIN_EMAILS`; JWT verification setting |
| Tasks not syncing | DevTools → Network → `/rest/v1/tasks`; app toast "saved on this device" |
| Push not arriving | Check the secrets table above **first** |

```powershell
npx supabase functions logs admin --project-ref warepmhybetvjzgvpuqf
```

## 8. Backup and restore

Supabase free/paid plans include daily automatic backups (retention depends on
plan) — verify in Dashboard → Database → Backups.

Manual logical backup before a risky change:

```powershell
npx supabase db dump --linked -f backup-$(Get-Date -Format yyyyMMdd-HHmm).sql
```

Restore procedure (only with owner approval, never over live data):

1. Create a **new** Supabase project, restore the dump there, verify counts.
2. Only then consider a cut-over. Never restore over production in place.

Never use `reset`, `db reset`, or a truncate as a troubleshooting step.

## 9. Rollback of a bad deployment

| Component | Rollback |
|---|---|
| Web | `git revert` the bad commit in `al-helm-app` and push |
| Edge Function | redeploy the previous version from a known-good commit |
| Migration | **not** rolled back in place; ship a new forward fix |
| APK | cannot be withdrawn; ship a higher versionCode. Test first. |