/* Phase 1 service worker — intentionally minimal.
 *
 * Responsibilities here are limited to installability and a basic offline
 * shell. Phase 2 will own push subscriptions, background sync, and a real
 * cache-versioning strategy. No UI feature depends on this worker.
 */

const CACHE = 'alhelm-shell-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
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

// Network-first for navigations so a deploy is picked up immediately; cached
// shell is only a fallback when the network is unavailable.
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy)).catch(() => undefined)
          return response
        })
        .catch(() => caches.match('./index.html').then((cached) => cached ?? Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
            }
            return response
          })
          .catch(() => cached ?? Response.error()),
    ),
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
  event.waitUntil(self.clients.openWindow('./#/notifications'))
})
