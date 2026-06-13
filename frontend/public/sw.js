// ScanGym Service Worker v4.0 — App Shell + Photo Cache + Stale-While-Revalidate
// Instant first paint on repeat visits via cached shell + background refresh
const CACHE_NAME = 'scangym-v6';
const PHOTO_CACHE = 'scangym-photos-v1';
const PHOTO_CACHE_MAX = 100; // Keep max 100 gym photos cached
const APP_SHELL = [
  '/',
  '/styles.css',
  '/app.ctr576.js',
  '/robust-location.js'
];

// Install: pre-cache the entire app shell (nav, skeleton, CSS, JS)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting(); // Activate immediately
});

// Activate: clean all old caches (keep current app + photo cache)
self.addEventListener('activate', event => {
  const keep = [CACHE_NAME, PHOTO_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // Take control immediately
});

// Fetch strategy: different strategies per resource type
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // Photo proxy: cache-first — gym photos rarely change, saves bandwidth + instant on revisit
  if (url.pathname.startsWith('/api/photo')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(PHOTO_CACHE).then(cache => {
              cache.put(event.request, clone);
              // Evict oldest if over limit
              cache.keys().then(keys => {
                if (keys.length > PHOTO_CACHE_MAX) {
                  cache.delete(keys[0]);
                }
              });
            });
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // API calls: network-first (never serve stale API data)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache config + nearby for offline fallback
          if (response.ok && (url.pathname === '/api/config' || url.pathname.startsWith('/api/live/nearby'))) {
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


// ═══════════════════════════════════════════════════════════════
//  Push Notifications (Fix #7C — Session reminders & updates)
// ═══════════════════════════════════════════════════════════════

// Handle push events
self.addEventListener('push', event => {
  let data = { title: 'ScanGym', body: 'You have a notification', icon: '/icons/icon-192.png' };
  
  try {
    if (event.data) {
      const payload = event.data.json();
      data = {
        title: payload.title || 'ScanGym',
        body: payload.body || '',
        icon: payload.icon || '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: payload.tag || 'scangym-notification',
        data: payload.data || {},
        actions: payload.actions || [],
        vibrate: [200, 100, 200],
        requireInteraction: payload.requireInteraction || false
      };
    }
  } catch (e) {
    // If not JSON, use text
    data.body = event.data ? event.data.text() : 'New notification';
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      data: data.data,
      actions: data.actions,
      vibrate: data.vibrate,
      requireInteraction: data.requireInteraction
    })
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const urlMap = {
    'session-reminder': '/explore',
    'session-active': '/session',
    'session-complete': '/bookings',
    'booking-confirmed': '/bookings'
  };
  
  const tag = event.notification.tag || '';
  const targetUrl = urlMap[tag] || '/';
  
  // Handle action buttons
  if (event.action === 'view-session') {
    event.waitUntil(clients.openWindow('/session'));
    return;
  }
  if (event.action === 'rate') {
    event.waitUntil(clients.openWindow('/bookings'));
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing window if available
      for (const client of windowClients) {
        if (client.url.includes('scangym.com') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Open new window
      return clients.openWindow(targetUrl);
    })
  );
});
