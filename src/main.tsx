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

// Hydrate from the persistence adapter first so no empty state flashes.
void initStore().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <LaunchGate>
          <App />
        </LaunchGate>
      </HashRouter>
    </StrictMode>,
  )
})

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
