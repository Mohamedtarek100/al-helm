/* Phase 1 service worker — intentionally minimal.
 *
 * Responsibilities here are limited to installability and a basic offline
 * shell. Phase 2 will own push subscriptions, background sync, and a real
 * cache-versioning strategy. No UI feature depends on this worker.
 */

const CACHE = 'alhelm-shell-v5'
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
]
const shellUrl = (path) => new URL(path, self.registration.scope).href
const shellRequest = (path) => new Request(shellUrl(path))

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => shellRequest(path))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// Network-first for all same-origin GETs so deployed HTML/CSS/JS changes are
// checked on each request. Cached assets remain an offline fallback.
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(
    fetch(new Request(request, { cache: 'no-store' }))
      .then((response) => {
        if (response.ok) {
          const cacheKey = request.mode === 'navigate' ? shellUrl('./index.html') : request
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(cacheKey, copy)))
        }
        return response
      })
      .catch(async () => {
        const cacheKey = request.mode === 'navigate' ? shellUrl('./index.html') : request
        const cached = await caches.match(cacheKey)
        return cached ?? Response.error()
      }),
  )
})

// Phase 2 placeholder: real push handling lands with the Supabase backend.
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload = { title: 'الحُلم', body: 'فاكرة مذاكرتك النهاردة؟' }
  try {
    payload = { ...payload, ...event.data.json() }
  } catch {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(`${self.registration.scope}#/notifications`))
})
