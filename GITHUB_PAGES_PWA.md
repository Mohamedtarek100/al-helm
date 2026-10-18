# GitHub Pages PWA deployment
This project builds the existing React/Vite app with the Pages repository name as `VITE_BASE_PATH` (for a repository named `al-helm`, Vite emits `/al-helm/` asset URLs). Ordinary local and Capacitor builds retain `base: './'`. The app uses hash-based routes so every app destination works on static GitHub Pages without custom URL rewrites.

## Connect a repository and enable Pages
1. Create or select a GitHub repository for this project. For a public, zero-cost PWA, make the deployment repository public. Never include `.env` files, private user data, keystores or signing credentials.
2. Add this local Git repository as the `origin` remote, then push the desired branch named `main`.
3. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
4. Push to `main` or use **Actions → Deploy Al-Helm PWA to GitHub Pages → Run workflow**. The workflow builds `dist` and deploys it over GitHub Pages HTTPS.
5. Copy the actual published URL from the successful deployment in the Actions job summary. A project site is normally under `https://<owner>.github.io/<repository>/`; do not construct or distribute a URL until deployment succeeds.

## How website updates reach the PWA
Every successful Pages deployment publishes a new Vite `dist` bundle at the same origin. The service worker uses network-first requests with `cache: 'no-store'` for same-origin GETs and writes successful responses to its cache. Thus, when online, new HTML/CSS/JS is fetched from the deployed site, and the cache is an offline fallback. A cache version bump activates the new worker and removes prior app-shell caches.

The app bundle is not downloaded in the background while it is closed. On the next page load/navigation while online it fetches the deployed bundle. Offline operation can only use previously cached resources. The browser/TWA update experience must be verified against the actual published site; it is not yet verified because this checkout has no Git remote and no deployment URL.

## TWA is a later step
A Trusted Web Activity needs a real public HTTPS PWA URL and Digital Asset Links at `/.well-known/assetlinks.json` tied to the final Android application ID and the release certificate fingerprint. The Capacitor debug APK uses the debug signing key and is not suitable as the TWA's production identity. Do not build or publish a TWA until the public site, release signing key and asset-links verification are ready.
