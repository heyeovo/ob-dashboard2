// Ombre Brain Service Worker
// Strategy: cache immutable code assets only. Private HTML and images always use the network.

const CACHE_VERSION = 'ombre-v3'
const STATIC_CACHE = `ombre-static-${CACHE_VERSION}`

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

  // API calls and HTML/private files: don't intercept or cache.
  if (url.pathname.startsWith('/api/')) {
    return // let browser handle normally
  }

  // Static assets: Cache First
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(js|css|woff2?|ttf|otf)$/)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Everything else, including HTML and images, passes through to Dashboard auth.
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
