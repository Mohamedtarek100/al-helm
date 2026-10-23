/**
 * Service-worker registration.
 *
 * Deliberately minimal: the app registers an existing `sw.js` when present and
 * only in production builds. Real push subscriptions and cache strategies
 * live behind feature flags when introduced; nothing in the UI depends on
 * this file succeeding.
 */

export interface ServiceWorkerStatus {
  supported: boolean
  registered: boolean
  error: string | null
}

const SW_PATH = `${import.meta.env.BASE_URL}sw.js`

export async function registerServiceWorker(): Promise<ServiceWorkerStatus> {
  const base: ServiceWorkerStatus = { supported: false, registered: false, error: null }

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return base
  }
  if (!import.meta.env.PROD) {
    // Vite's dev server serves modules from memory; caching there causes stale
    // bundles. Registration is production-only by design.
    return { ...base, supported: true }
  }

  try {
    await navigator.serviceWorker.register(SW_PATH, { scope: import.meta.env.BASE_URL })
    return { supported: true, registered: true, error: null }
  } catch (error) {
    return {
      supported: true,
      registered: false,
      error: error instanceof Error ? error.message : 'تعذّر تسجيل عامل الخدمة.',
    }
  }
}

export function getServiceWorkerStatus(): ServiceWorkerStatus {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
  return { supported, registered: false, error: null }
}
