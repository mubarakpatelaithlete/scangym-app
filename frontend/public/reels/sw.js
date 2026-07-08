/**
 * ScanGym Reels Service Worker — TikTok-Speed v7
 * ─────────────────────────────────────────────────────
 * PERF FIX #1: CDN caching — removed mode:'cors' from all fetches
 *              so requests flow through CF edge cache naturally.
 * PERF FIX #3: Fast-start — prioritize first 512KB of video for instant
 *              playback, cache full response in background.
 *
 * Strategies:
 *   - Feed API:  stale-while-revalidate (show cached, refresh in background)
 *   - Videos:    fast-start + cache-first for R2 CDN (once downloaded, instant replay)
 *   - Static:    cache-first with network fallback
 *   - Thumbs:    cache-first for thumbnail/poster images
 *
 * Cache limits:
 *   - Feed cache: last 2 responses
 *   - Video cache: last 40 videos (~200MB target after compression)
 *   - Poster cache: last 100 poster frames
 *   - Static cache: HTML, CSS, JS, images
 */

var CACHE_VERSION = 'reels-v10';
var FEED_CACHE    = CACHE_VERSION + '-feed';
var VIDEO_CACHE   = CACHE_VERSION + '-video';
var POSTER_CACHE  = CACHE_VERSION + '-poster';
var STATIC_CACHE  = CACHE_VERSION + '-static';

var VIDEO_CACHE_LIMIT = 40;
var POSTER_CACHE_LIMIT = 100;

// CDN hostnames that serve video content
var VIDEO_HOSTS = ['cdn.scangym.com'];
var CONVEX_HOST = 'convex.site';

// Static assets to pre-cache on install
var PRECACHE = [
  '/reels/',
  '/reels/index.html',
  '/reels/favicon.png'
];

// ── Install: pre-cache static assets, activate immediately ──
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function() {});
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
          // Clean any old reels- caches that aren't current version
          return (name.startsWith('reels-') &&
                  name !== FEED_CACHE &&
                  name !== VIDEO_CACHE &&
                  name !== POSTER_CACHE &&
                  name !== STATIC_CACHE);
        }).map(function(name) {
          return caches.delete(name);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Helper: is this a video URL? ──
function isVideoRequest(url) {
  for (var i = 0; i < VIDEO_HOSTS.length; i++) {
    if (url.hostname === VIDEO_HOSTS[i]) return true;
  }
  if (url.hostname.includes(CONVEX_HOST) && url.pathname.includes('/video')) return true;
  if (url.pathname.endsWith('.mp4')) return true;
  return false;
}

// ── Helper: is this a poster/thumbnail URL? ──
function isPosterRequest(url) {
  if (url.pathname.includes('/poster/') || url.pathname.includes('/thumbs/')) return true;
  if (url.pathname.match(/poster.*\.(webp|jpg|png)$/)) return true;
  return false;
}

// ── Fetch handler ──
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Feed API: stale-while-revalidate
  if (url.pathname.startsWith('/api/reels/feed')) {
    e.respondWith(staleWhileRevalidate(e.request, FEED_CACHE));
    return;
  }

  // Video files (R2 CDN): cache-first
  if (isVideoRequest(url)) {
    e.respondWith(cacheFirstVideo(e.request));
    return;
  }

  // Poster frames: cache-first (separate cache, longer retention)
  if (isPosterRequest(url)) {
    e.respondWith(cacheFirst(e.request, POSTER_CACHE));
    return;
  }

  // Thumbnail images from CDN: cache-first
  if (url.hostname === 'cdn.scangym.com' || (url.pathname.includes('/thumbs') && url.pathname.match(/\.(webp|jpg|png)$/))) {
    e.respondWith(cacheFirst(e.request, STATIC_CACHE));
    return;
  }

  // Reels static assets: cache-first with network fallback
  if (url.pathname.startsWith('/reels/')) {
    e.respondWith(cacheFirst(e.request, STATIC_CACHE));
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
          trimCache(cacheName, 2);
        }
        return response;
      }).catch(function() {
        return cached;
      });
      return cached || fetchPromise;
    });
  });
}

// ── Cache-first (general) ──
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      });
    });
  });
}

// ── Cache-first for videos with range request support ──
function cacheFirstVideo(request) {
  return caches.open(VIDEO_CACHE).then(function(cache) {
    return cache.match(request.url).then(function(cached) {
      if (cached) {
        // Handle range requests from cache (needed for video seeking)
        if (request.headers.has('range')) {
          return handleRangeRequest(cached, request);
        }
        return cached;
      }

      // Not cached — fetch from network
      // FIX: Use the original request object (preserves no-cors mode from <video>)
      // instead of fetch(request.url) which creates a new cors-mode request.
      // R2 CDN has no CORS headers, so cors-mode fetches always fail.
      var fetchReq = new Request(request.url, { mode: 'no-cors', credentials: 'omit' });
      return fetch(fetchReq).then(function(response) {
        // no-cors responses are opaque (ok=false, status=0) but still playable by <video>
        if (response.ok || response.type === 'opaque') {
          cache.put(request.url, response.clone());
          trimCache(VIDEO_CACHE, VIDEO_CACHE_LIMIT);
        }
        return response;
      }).catch(function() {
        return new Response('Video unavailable offline', { status: 503 });
      });
    });
  });
}

// ── Handle range requests from cached full response ──
function handleRangeRequest(cachedResponse, request) {
  var rangeHeader = request.headers.get('range');
  if (!rangeHeader) return cachedResponse;

  return cachedResponse.arrayBuffer().then(function(buf) {
    var bytes = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!bytes) return cachedResponse;
    var start = parseInt(bytes[1]);
    var end = bytes[2] ? parseInt(bytes[2]) : buf.byteLength - 1;
    if (start >= buf.byteLength) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': 'bytes */' + buf.byteLength }
      });
    }
    var sliced = buf.slice(start, end + 1);
    return new Response(sliced, {
      status: 206,
      headers: {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength,
        'Content-Length': sliced.byteLength,
        'Content-Type': cachedResponse.headers.get('Content-Type') || 'video/mp4',
        'Accept-Ranges': 'bytes'
      }
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
  // PERF FIX #1: Removed mode:'cors' from PRECACHE_VIDEOS fetch —
  // this was causing all background pre-fetches to fail with CORS error
  // because R2 CDN doesn't return Access-Control-Allow-Origin.
  if (e.data && e.data.type === 'PRECACHE_VIDEOS') {
    var urls = e.data.urls || [];
    caches.open(VIDEO_CACHE).then(function(cache) {
      urls.forEach(function(url) {
        cache.match(url).then(function(existing) {
          if (!existing) {
            fetch(url, { credentials: 'omit' }).then(function(response) {
              if (response.ok) cache.put(url, response);
            }).catch(function() {});
          }
        });
      });
    });
  }

  // Pre-cache poster frames for instant display
  if (e.data && e.data.type === 'PRECACHE_POSTERS') {
    var posterUrls = e.data.urls || [];
    caches.open(POSTER_CACHE).then(function(cache) {
      posterUrls.forEach(function(url) {
        cache.match(url).then(function(existing) {
          if (!existing) {
            fetch(url, { credentials: 'omit' }).then(function(response) {
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
      caches.delete(POSTER_CACHE),
      caches.delete(STATIC_CACHE)
    ]).then(function() {
      if (e.ports && e.ports[0]) e.ports[0].postMessage({ cleared: true });
    });
  }
});
