/**
 * ScanGym Reels Service Worker — Phase 3 Infrastructure
 * ─────────────────────────────────────────────────────
 * Strategies:
 *   - Feed API:  stale-while-revalidate (show cached, refresh in background)
 *   - Videos:    cache-first (once downloaded, serve from cache)
 *   - Static:    cache-first with network fallback
 *
 * Cache limits:
 *   - Feed cache: last 2 responses
 *   - Video cache: last 20 videos (~200MB max)
 *   - Static cache: HTML, CSS, JS, images
 */

var CACHE_VERSION = 'reels-v4';
var FEED_CACHE    = CACHE_VERSION + '-feed';
var VIDEO_CACHE   = CACHE_VERSION + '-video';
var STATIC_CACHE  = CACHE_VERSION + '-static';

var VIDEO_CACHE_LIMIT = 20;

// Static assets to pre-cache on install
var PRECACHE = [
  '/reels/',
  '/reels/index.html',
  '/reels/favicon.png'
];

// ── Install: pre-cache static assets ──
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function() {
        // Non-fatal: some assets may not exist
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── Activate: clean old caches ──
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) {
          return name.startsWith('reels-') && name !== FEED_CACHE && name !== VIDEO_CACHE && name !== STATIC_CACHE;
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch handler ──
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Feed API: stale-while-revalidate
  if (url.pathname.startsWith('/api/reels/feed')) {
    e.respondWith(staleWhileRevalidate(e.request, FEED_CACHE));
    return;
  }

  // Video files (Convex proxy or future CDN): cache-first
  if (url.hostname.includes('convex.site') && url.pathname.includes('/video')) {
    e.respondWith(cacheFirst(e.request, VIDEO_CACHE, true));
    return;
  }

  // Reels static assets: cache-first with network fallback
  if (url.pathname.startsWith('/reels/')) {
    e.respondWith(cacheFirst(e.request, STATIC_CACHE, false));
    return;
  }
});

// ── Stale-while-revalidate ──
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var fetchPromise = fetch(request).then(function(response) {
        if (response.ok) {
          cache.put(request, response.clone());
          // Trim cache to last 2 entries
          trimCache(cacheName, 2);
        }
        return response;
      }).catch(function() {
        return cached; // Network failed, return stale
      });

      return cached || fetchPromise;
    });
  });
}

// ── Cache-first ──
function cacheFirst(request, cacheName, isVideo) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;

      return fetch(request).then(function(response) {
        if (response.ok) {
          cache.put(request, response.clone());
          if (isVideo) trimCache(cacheName, VIDEO_CACHE_LIMIT);
        }
        return response;
      });
    });
  });
}

// ── Trim cache to N entries (FIFO) ──
function trimCache(cacheName, max) {
  caches.open(cacheName).then(function(cache) {
    cache.keys().then(function(keys) {
      if (keys.length > max) {
        cache.delete(keys[0]).then(function() {
          if (keys.length - 1 > max) trimCache(cacheName, max);
        });
      }
    });
  });
}

// ── Message handler for cache control ──
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'PRECACHE_VIDEOS') {
    var urls = e.data.urls || [];
    caches.open(VIDEO_CACHE).then(function(cache) {
      urls.forEach(function(url) {
        cache.match(url).then(function(existing) {
          if (!existing) {
            fetch(url, { mode: 'cors' }).then(function(response) {
              if (response.ok) cache.put(url, response);
            }).catch(function() {});
          }
        });
      });
    });
  }

  if (e.data && e.data.type === 'CLEAR_CACHES') {
    Promise.all([
      caches.delete(FEED_CACHE),
      caches.delete(VIDEO_CACHE),
      caches.delete(STATIC_CACHE)
    ]).then(function() {
      if (e.ports && e.ports[0]) e.ports[0].postMessage({ cleared: true });
    });
  }
});
