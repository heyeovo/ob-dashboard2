// Ombre Brain Service Worker
// Strategy: Cache static assets aggressively, network-first for API + HTML

const CACHE_VERSION = 'ombre-v1'
const STATIC_CACHE = `ombre-static-${CACHE_VERSION}`
const IMAGE_CACHE = `ombre-images-${CACHE_VERSION}`

// --- Install: pre-cache nothing (Next.js has its own hashed filenames) ---
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

// --- Activate: clean old caches ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('ombre-') && !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

// --- Fetch: route by request type ---
self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle GET requests; POST/PATCH/DELETE pass through untouched
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Only handle same-origin
  if (url.origin !== self.location.origin) return

  // API calls: don't cache
  if (url.pathname.startsWith('/api/')) {
    return // let browser handle normally
  }

  // Static assets (Next.js + Polaris): Cache First
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/chat/assets/') ||
    url.pathname.match(/\.(js|css|woff2?|ttf|otf)$/)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Images & icons: Stale While Revalidate
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/chat/icons/') ||
    url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp)$/)
  ) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  // HTML pages: Network First with offline fallback
  event.respondWith(networkFirst(request, STATIC_CACHE))
})

// --- Strategies ---

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.open(cacheName).then((c) => c.match(request))
    return cached || new Response('Offline', { status: 503 })
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone())
    return response
  })
  return cached || fetchPromise
}
