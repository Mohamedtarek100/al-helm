import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/index.css'
import App from './App.tsx'
import { initStore } from './services/store'
import { registerServiceWorker } from './services/pwa/registerServiceWorker'

// Hydrate from the persistence adapter first so no empty state flashes.
void initStore().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})

// Phase 1 ships a minimal, non-push service worker so the app is installable
// and offline-tolerant. Phase 2 adds real push delivery.
void registerServiceWorker()

