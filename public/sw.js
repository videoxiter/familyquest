// Минимальный service worker: оболочка приложения и офлайн-экран.
// Стратегии:
//   переходы по страницам — сначала сеть (чтобы обновления приезжали сразу),
//   статические файлы     — из кэша, с фоновым обновлением.
const CACHE = 'familyquest-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
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

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy))
          return response
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request)
          .then((response) => {
            if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
          })
          .catch(() => undefined)
        return cached
      }
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})

// ───────────────────────────── уведомления ─────────────────────────────────

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || 'FamilyQuest'
  const options = {
    body: payload.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/favicon-32.png',
    lang: 'ru',
    vibrate: [80, 40, 80],
    data: { url: payload.url || './#/today' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || './#/today'

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) {
            try {
              await client.navigate(target)
            } catch {
              /* старая версия браузера — просто фокусируемся */
            }
          }
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })(),
  )
})
