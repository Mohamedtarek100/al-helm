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

- Android: local notifications via `@capacitor/local-notifications`; scheduled
  from Settings, with a Test-notification button. Physical-device verification
  is still outstanding.
- Web push: requires VAPID keys stored as server-side secrets plus a trusted
  scheduler; not yet operational — the UI does not claim otherwise.

## Android release

`ANDROID_RELEASES.md` documents the build and signing notes. Debug APKs are
not production releases.

## Deployment

The web build is published through the `al-helm-app` distribution repository
(`.github/workflows/pages.yml`). A workflow here must not assume variables
configured in the other repository are available.
