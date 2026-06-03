// ScanGym Service Worker v3.0 — App Shell + Stale-While-Revalidate
// Instant first paint on repeat visits via cached shell + background refresh
const CACHE_NAME = 'scangym-v4';
const APP_SHELL = [
  '/',
  '/styles.css',
  '/app.ctr575.js',
  '/robust-location.js'
];

// Install: pre-cache the entire app shell (nav, skeleton, CSS, JS)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting(); // Activate immediately
});

// Activate: clean all old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // Take control immediately
});

// Fetch strategy: different strategies per resource type
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // API calls: network-first (never serve stale API data)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache config for offline fallback
          if (response.ok && url.pathname === '/api/config') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // HTML pages (SPA routes): network-first (server injects geo hints)
  // We want the fresh HTML with geo hints, but fall back to cache for offline
  if (event.request.headers.get('accept')?.includes('text/html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request) || caches.match('/'))
    );
    return;
  }

  // Static assets (CSS, JS, images): stale-while-revalidate
  // Show cached version INSTANTLY, update in background for next visit
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      // Return cached immediately if available (instant!), network fetch updates cache
      return cached || fetchPromise;
    })
  );
});
