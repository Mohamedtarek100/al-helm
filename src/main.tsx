import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/index.css'
import App from './App.tsx'
import { authenticateCloudUser, initStore } from './services/store'
import { installNativeAuthListener } from './services/nativeAuth'
import { refreshAdminGate } from './services/edge/adminGate'
import { initAdminGate } from './services/edge/adminGate'
import { LaunchGate } from './app/LaunchGate'
import { registerServiceWorker } from './services/pwa/registerServiceWorker'
import { I18nProvider } from './i18n/I18nProvider'
import { ErrorBoundary } from './components/ErrorBoundary'

// Hydrate from the persistence adapter before mounting, so I18nProvider reads
// real settings on its first render and no empty/RTL-flashing state is shown.
// `.finally` guarantees a mount even when hydration fails (initStore has its own
// internal recovery), so a storage problem can never leave a permanently blank
// page.
let mounted = false
function mount() {
  // Guard against a double mount (HMR or a duplicated init) creating two roots.
  if (mounted) return
  mounted = true
  const container = document.getElementById('root')
  if (!container) return
  createRoot(container).render(
    <StrictMode>
      <HashRouter>
        {/*
         * I18nProvider sits ABOVE LaunchGate on purpose.
         *
         * The first-launch welcome screen is rendered by LaunchGate, OUTSIDE
         * App, and it calls useI18n(). When the provider lived inside App, a
         * first-time visitor threw "useI18n must be used within I18nProvider"
         * during the very first render and saw a blank page. One provider here
         * covers both the welcome path and every route.
         *
         * initStore() has already resolved before this render (see below), so
         * the provider's useSettings() reads hydrated settings rather than
         * defaults — that is what keeps language/RTL stable on first paint.
         */}
        {/* A boundary around the LAUNCH path too: a failure inside the welcome
            screen or the gate must show a recovery panel, never a blank page. */}
        <ErrorBoundary>
          <I18nProvider>
            <LaunchGate>
              <App />
            </LaunchGate>
          </I18nProvider>
        </ErrorBoundary>
      </HashRouter>
    </StrictMode>,
  )
}

void initStore().then(mount, mount)

// Minimal, non-push service worker so the app is installable and
// offline-tolerant.
void registerServiceWorker()

// Best-effort activity heartbeat for signed-in users (throttled server-side
// and locally to at most one call per 15 minutes).
void import('./services/activity').then((m) => void m.maybeHeartbeat())

// Connectivity/sync status: installs online/offline listeners and performs one
// throttled reachability probe. Never blocks startup.
void import('./services/syncStatus').then((m) => m.initConnectivity())

// Resolve (and keep resolving, across sign-in/out and account switches) whether
// the signed-in account is on the server-side admin allowlist. Navigation only.
initAdminGate()

// Android: complete the Google OAuth return leg. Chrome hands the callback URL
// back to the app via the custom scheme; this exchanges it for a session and
// refreshes persistence + admin state exactly once. No-op on web.
installNativeAuthListener((userId) => {
  void authenticateCloudUser(userId).then(() => refreshAdminGate()).catch(() => undefined)
})


// OTA update check: manual-mode Capacitor updater. Runs once at launch on
// native builds only; on web this is a no-op. Activation is deferred so it
// never interrupts an active study session — the bundle becomes active on
// the next reload/restart.
void (async () => {
  try {
    const { checkAndDownload, confirmBundleHealthy, currentBundle } = await import('./services/ota')
    await confirmBundleHealthy()
    const version = await checkAndDownload()
    if (version) {
      // Persist for the next launch; do not hard-reload mid-session.
      localStorage.setItem('alhelm:pending-ota', version)
    }
    // Activate a previously downloaded bundle at launch (safe point).
    const pending = localStorage.getItem('alhelm:pending-ota')
    if (pending) {
      const { applyPendingUpdate } = await import('./services/ota')
      const ok = await applyPendingUpdate(pending)
      localStorage.removeItem('alhelm:pending-ota')
      if (ok) return // bundle replaced; app reloaded with new frontend
    }
    void currentBundle()
  } catch {
    /* updater is best-effort; never block app startup */
  }
})()
