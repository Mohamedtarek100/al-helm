# Supabase setup (free tier; no paid services required)

Cloud sync is optional until a real Supabase project is configured. The browser uses only the project's URL and anon/publishable key; RLS is mandatory. Never use a service-role key in the browser.

1. Create a Supabase project using its Free plan; do not enable paid billing or overages.
2. In SQL Editor, apply `supabase/migrations/202610190001_initial_schema.sql` (additive; it does not drop user data).
3. Copy `.env.example` to an ignored local `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then rebuild.
4. In Authentication → URL Configuration, add the local app and actual deployed HTTPS URL to allowed redirects. Configure email delivery/settings as desired.
5. For Google: configure Google OAuth consent/client in Google Cloud, add the client ID/secret in Supabase Authentication → Providers → Google, and list exact callback/redirect URLs there. Do not place the OAuth client secret in `.env` or frontend code.
6. Verify email sign-up, login, reload/session restoration and RLS using two separate test accounts before enabling production cloud use.

The migration enables RLS and owner-scoped policies. Push scheduling is not enabled by this schema alone: a trusted server-side scheduler and VAPID private key are still required. Do not claim push delivery until those components and a device subscription are tested.
