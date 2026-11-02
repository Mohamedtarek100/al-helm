# 4uLife (formerly Al-Helm) — Study & Art Companion

React + TypeScript + Vite + Capacitor + Supabase study planner with an art
studio. Web build deploys to GitHub Pages; Android uses Capacitor with an OTA
updater.

**Public site:** https://mohamedtarek100.github.io/al-helm-app/

## Quick start

```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Serve the production build locally |
| `npm run test` | Vitest unit tests |
| `npm run test:i18n` | English/Arabic translation key parity check |
| `npm run check:types` | `tsc --noEmit` only |
| `npm run check:migrations` | Migration ordering + ALL_MIGRATIONS.sql consistency |
| `npm run check` | types + i18n + tests + lint + build in one pass |
| `npm run lint` | oxlint over `src/` |
| `npm run android:sync` | Build web assets and sync into the Capacitor project |
| `npm run android:debug` | Assemble a debug APK (not a production release) |

## Quality gates (CI runs these)

TypeScript, i18n parity, migration consistency, unit tests, oxlint, and the
production build must all pass. See `.github/workflows/ci.yml`.

## Supabase setup

See `SUPABASE_SETUP.md` for the full walkthrough. Short version:

1. Create a Supabase project (free tier is enough).
2. Apply the ordered files in `supabase/migrations/` in the SQL editor —
   `supabase/ALL_MIGRATIONS.sql` is the concatenated equivalent, generated from
   those files and verified by `npm run check:migrations`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`
   (browser-safe values only; **never** a service-role key).

### Admin dashboard

The owner dashboard lives at `#/admin` and is authorized **server-side only**
by the `admin` edge function against the `ADMIN_EMAILS` secret:

```bash
supabase functions deploy admin
supabase secrets set ADMIN_EMAILS=you@example.com   # comma-separated list
```

Until that secret is set the function denies every request — there is no
frontend-only bypass. Ordinary users cannot enumerate accounts or send
announcements.

### Push / reminders

- Android reminders use `@capacitor/local-notifications`; scheduled from
  Settings, with a Test-notification button. Physical-device verification is
  still outstanding.
- Browser Web Push is implemented in source: users explicitly opt in, their
  subscription is tied to their authenticated account, the admin sender records
  provider outcomes, and failed endpoints can be retried. Production operation
  still requires migration `20261102140013_announcement_web_push.sql`, the
  matching `VITE_VAPID_PUBLIC_KEY` build variable, and server-only
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` secrets. Reconcile
  the live schema first and get owner approval before applying the migration or
  changing production configuration. Provider acceptance is not proof that a
  device displayed a notification.
- Android remote push is separate from local reminders and Web Push. The
  Android client now supports explicit permission, authenticated token
  registration/rotation, disable, and announcement-tap routing. The locally
  supplied `google-services.json` matches `com.alhelm.studyplanner` and remains
ignored; never commit it. Production FCM still requires migrations
`20261102140013_announcement_web_push.sql` and
`20261103140014_fcm_push_tokens.sql`, migration
`20261103150015_harden_announcement_privileges.sql`, a deployed Edge
Function, the Firebase Cloud Messaging API, and a least-privilege service
account stored only as the Edge secret `FCM_SERVICE_ACCOUNT_JSON`. No
service-account credential has been created or deployed. Provider acceptance
does not prove device display; physical-device delivery remains unverified.

## Android release

`ANDROID_RELEASES.md` documents the build and signing notes. Debug APKs are
not production releases.

## Deployment

The web build is published through the `al-helm-app` distribution repository
(`.github/workflows/pages.yml`). A workflow here must not assume variables
configured in the other repository are available.
