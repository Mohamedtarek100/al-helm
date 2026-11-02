# AGENTS.md — instructions for coding agents working on 4uLife

**Read `PROJECT_MASTER_CONTEXT.md` FIRST.** It is the canonical reference for
identity, architecture, production configuration, security decisions and
release procedure. Do not ask the owner to re-explain anything that is already
documented there.

---

## 1. Non-negotiable rules

1. **Never delete, rename, replace or reset `PROJECT_MASTER_CONTEXT.md`.**
   Update the relevant section and **append** to its change history.
2. Keep documentation current: any change to architecture, production config,
   security, release procedure or known status must be reflected in that file.
3. Work on a **feature branch**, never force-push, never reset the repository,
   never discard uncommitted work.
4. **Never commit secrets**: keystores (`.jks`/`.keystore`), `keystore.properties`,
   `google-services.json`, `.env*`, service-role keys, Firebase service-account
   JSON, recovery keys.
5. **Never publish to `Mohamedtarek100/al-helm-app` from this repo directly** —
   that repository holds public artifacts only. Source lives in
   `Mohamedtarek100/al-helm`.
6. **Never destroy production data.** No `DROP`, `TRUNCATE`, `DELETE` without a
   scoped `user_id` filter, no RLS disabling, no resetting Supabase.
7. Migrations are **additive** and must preserve existing records.
8. **Never generate a replacement Android signing key.** See
   `docs/ANDROID_SIGNING_AND_RELEASE.md`.
9. **Never add a backdoor** to the app lock: no master PIN, universal recovery
   code, support override, or "just clear the lock" button.
10. Do not claim a feature works because a unit test passed. Verify in the
    running application where possible, and state clearly what was **not**
    verified (physical device, credentials, owner approval).

## 2. Before you change code

```powershell
git status --short
git branch --show-current
git log -5 --oneline
cd "D:\EL 7lm"; npm run check:types; npm test
```

Read the specific service you are touching. Persistence lives in
`src/services/persistence/`; the store in `src/services/store.ts` is the only
module allowed to talk to it.

## 3. Quality gates (all must pass before commit)

```powershell
npm run check:types      # TypeScript, app + node
npm test                 # Vitest
npm run lint
npm run check:edge       # Edge Function TypeScript
npm run test:i18n        # EN/AR translation parity
npm run check:migrations # local vs applied migrations
npm run check:secrets    # secret scan
npm run build            # production web bundle
```

## 4. Verify UI work in a real browser

Use the `browser-automation` skill rather than reading source and guessing. Take
a screenshot **and read it**. The Dream Studio has three target viewports:
1440×900, 412×915 and 915×412.

Beware two traps already hit here:
- a selector that silently matches nothing looks exactly like a missing element —
  confirm with `--snapshot` / `--eval` before "fixing" CSS;
- `page.goto()` reloads the document; use a hash change to test in-app
  navigation.

## 5. Security boundaries that must stay intact

| Boundary | Rule |
|---|---|
| RLS | Always enabled; policies scoped to `auth.uid()`. |
| Admin | Identity checked **server-side** against `ADMIN_EMAILS`; client claims are never trusted. |
| App lock | Removed only by a verified ceremony + single-use token. |
| Lock rendering | When locked, protected screens are **not rendered**. |
| Guest data | Never uploaded to an account except through explicit migration. |
| Writes | `cloud` is reported only after the server confirms. |

## 6. Releasing

Follow `docs/ANDROID_SIGNING_AND_RELEASE.md` step by step. Do not publish an APK
merely because a build succeeded, and never overwrite historical release assets.

## 7. Reporting

When you finish, state: files changed, what was verified and **how**, test
counts, what remains **unverified** and why (device / credentials / approval).
Never fabricate evidence.
