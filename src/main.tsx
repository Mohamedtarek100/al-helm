import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/index.css'
import App from './App.tsx'
import { initStore } from './services/store'
import { registerServiceWorker } from './services/pwa/registerServiceWorker'

// Hydrate from the persistence adapter first so no empty state flashes.
void initStore().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  )
})

// Phase 1 ships a minimal, non-push service worker so the app is installable
// and offline-tolerant. Phase 2 adds real push delivery.
void registerServiceWorker()


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
