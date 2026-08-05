/**
 * ═══════════════════════════════════════════════════════════════
 *  LOCATION — the one location engine for ScanGym
 * ═══════════════════════════════════════════════════════════════
 *
 * There used to be three: this file's waterfall, a cache in
 * app.ctr576.js and a third GPS call in ux-v6-speed.js, each with its own
 * localStorage key ('scangym_last_location', 'sg_location_cache', 'sg_gps').
 * They could hold three different positions at once, so "where am I" depended
 * on which one the screen you were looking at happened to read.
 *
 * Everything now goes through window.sgLocation:
 *
 *   await sgLocation.get()      → { lat, lng, ... } or null   (5-layer waterfall)
 *   sgLocation.cached()         → the last known fix or null  (24h)
 *   sgLocation.save(loc)        → remember a fix
 *   sgLocation.clear()          → forget it
 *   sgLocation.CACHE_KEY        → 'sg_gps', the only key
 *
 * window.getLocation() is kept as an alias: the app calls it in many places.
 *
 * The 5 layers, in order, first success wins:
 *   1 GPS high accuracy (5s)   2 GPS low accuracy (5s, 60s cached)
 *   3 /api/geolocation (WiFi/cell/IP via the server)
 *   4 the cached fix (24h)     5 /api/geolocation/ip (city level)
 * If all five fail it returns null — never a made-up position.
 * GPS is never asked for before the user interacts with the page.
 * ═══════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  // R3 #1: Do NOT trigger the GPS permission prompt on page load (hurts conversion
  // + fails Lighthouse best-practices). Wait until the user actually interacts;
  // until then the waterfall falls through to server/IP location (no prompt).
  var _sgUserEngaged = false;
  function _sgMarkEngaged(){ _sgUserEngaged = true; }
  if (typeof document !== 'undefined') {
    ['pointerdown','touchstart','click','keydown'].forEach(function(ev){
      document.addEventListener(ev, _sgMarkEngaged, { once:true, passive:true, capture:true });
    });
  }

  // Global guard: wrap the browser geolocation API so ANY caller (not just this
  // file's waterfall) is deferred until the user interacts. On-load callers get a
  // graceful permission-style error and fall back to server/IP location.
  try {
    if (navigator.geolocation && !navigator.geolocation.__sgWrapped) {
      var _origGCP = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      var _origWP  = navigator.geolocation.watchPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = function(success, error, opts){
        if (!_sgUserEngaged) { if (typeof error === 'function') { try { error({ code:1, message:'GPS deferred until user interaction' }); } catch(e){} } return; }
        return _origGCP(success, error, opts);
      };
      navigator.geolocation.watchPosition = function(success, error, opts){
        if (!_sgUserEngaged) { if (typeof error === 'function') { try { error({ code:1, message:'GPS deferred until user interaction' }); } catch(e){} } return -1; }
        return _origWP(success, error, opts);
      };
      try { navigator.geolocation.__sgWrapped = true; } catch(e){}
    }
  } catch(e){}

  // ─── The one cache ───

  var CACHE_KEY = 'sg_gps';
  var CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  var LEGACY_KEYS = ['scangym_last_location', 'sg_location_cache'];

  function saveToCache(coords) {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return;
    try {
      var prev = readCache() || {};
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        lat: coords.lat,
        lng: coords.lng,
        city: coords.city || prev.city || '',
        query: coords.query || prev.query || '',
        accuracy: coords.accuracy || null,
        source: coords.source || 'gps',
        ts: Date.now()
      }));
    } catch (e) {}
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return null;
      // 'ts' is this file's field; 'timestamp' came from the old app cache.
      var ts = p.ts || p.timestamp || 0;
      if (Date.now() - ts > CACHE_MAX_AGE) { localStorage.removeItem(CACHE_KEY); return null; }
      p.ts = ts;
      p.age_ms = Date.now() - ts;
      return p;
    } catch (e) { return null; }
  }

  // One-off: fold whatever the two old keys were holding into the one key,
  // newest wins, then delete them so they can never disagree again.
  (function migrateLegacyKeys() {
    try {
      var best = readCache();
      LEGACY_KEYS.forEach(function (key) {
        var raw = localStorage.getItem(key);
        if (!raw) return;
        try {
          var p = JSON.parse(raw);
          var ts = p && (p.ts || p.timestamp || 0);
          if (p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
              Date.now() - ts < CACHE_MAX_AGE && (!best || ts > best.ts)) {
            best = { lat: p.lat, lng: p.lng, city: p.city || '', query: p.query || '', ts: ts };
          }
        } catch (e) {}
        localStorage.removeItem(key);
      });
      if (best) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          lat: best.lat, lng: best.lng, city: best.city || '', query: best.query || '',
          source: best.source || 'migrated', ts: best.ts || Date.now()
        }));
      }
    } catch (e) {}
  })();

  // ─── Layer 1 & 2: Browser GPS ───

  function tryGPS(highAccuracy, timeoutMs) {
    return new Promise(function(resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('No geolocation support'));
        return;
      }
      // R3 #1: defer the GPS prompt until the user has interacted
      if (!_sgUserEngaged) {
        reject(new Error('GPS deferred until user interaction'));
        return;
      }

      var settled = false;

      // Safety timeout (browser timeout can be unreliable)
      var timer = setTimeout(function() {
        if (!settled) {
          settled = true;
          reject(new Error('GPS timeout'));
        }
      }, timeoutMs + 1000);

      navigator.geolocation.getCurrentPosition(
        function(position) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({
              lat: position.coords.latitude,
              lng: position.coords.longitude
            });
          }
        },
        function(err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: timeoutMs,
          maximumAge: highAccuracy ? 0 : 60000 // Low accuracy allows 60s cache
        }
      );
    });
  }

  // ─── Layer 3: Google Geolocation API (full — WiFi/cell/IP) ───

  function tryGoogleGeo() {
    return new Promise(function(resolve, reject) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function() {
        if (controller) controller.abort();
        reject(new Error('Google geo timeout'));
      }, 2000);

      var fetchOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      };
      if (controller) fetchOptions.signal = controller.signal;

      fetch('/api/geolocation', fetchOptions)
        .then(function(res) {
          clearTimeout(timer);
          if (!res.ok) throw new Error('Google geo failed: ' + res.status);
          return res.json();
        })
        .then(function(data) {
          if (data.lat && data.lng) {
            resolve({ lat: data.lat, lng: data.lng });
          } else {
            reject(new Error('No coordinates in response'));
          }
        })
        .catch(function(err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // ─── Layer 5: Google Geolocation API (IP only) ───

  function tryGoogleIPGeo() {
    return new Promise(function(resolve, reject) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function() {
        if (controller) controller.abort();
        reject(new Error('Google IP geo timeout'));
      }, 3000);

      var fetchOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      };
      if (controller) fetchOptions.signal = controller.signal;

      fetch('/api/geolocation/ip', fetchOptions)
        .then(function(res) {
          clearTimeout(timer);
          if (!res.ok) throw new Error('Google IP geo failed: ' + res.status);
          return res.json();
        })
        .then(function(data) {
          if (data.lat && data.lng) {
            resolve({ lat: data.lat, lng: data.lng });
          } else {
            reject(new Error('No coordinates'));
          }
        })
        .catch(function(err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // ─── The waterfall ───

  var _inFlight = null;

  async function getLocation() {
    if (_inFlight) return _inFlight;            // never run two waterfalls at once
    _inFlight = (async function () {
      var coords;
      // Layer 1 + 2: browser GPS, high then low accuracy
      for (var i = 0; i < 2; i++) {
        try {
          coords = await tryGPS(i === 0, 5000);
          coords.source = i === 0 ? 'gps-high' : 'gps-low';
          saveToCache(coords);
          return coords;
        } catch (e) {
          console.log('[Location] GPS layer ' + (i + 1) + ' failed:', e.message);
        }
      }
      // Layer 3: server-side Google geolocation (WiFi/cell/IP)
      try {
        coords = await tryGoogleGeo();
        coords.source = 'server';
        saveToCache(coords);
        return coords;
      } catch (e) { console.log('[Location] server geo failed:', e.message); }
      // Layer 4: the cached fix
      var cached = readCache();
      if (cached) { console.log('[Location] using cached fix'); return cached; }
      // Layer 5: IP only (city level)
      try {
        coords = await tryGoogleIPGeo();
        coords.source = 'ip';
        saveToCache(coords);
        return coords;
      } catch (e) { console.log('[Location] IP geo failed:', e.message); }
      console.warn('[Location] all 5 layers failed, returning null');
      return null;
    })();
    try { return await _inFlight; } finally { _inFlight = null; }
  }

  window.sgLocation = {
    CACHE_KEY: CACHE_KEY,
    MAX_AGE: CACHE_MAX_AGE,
    get: getLocation,
    cached: readCache,
    save: saveToCache,
    clear: function () { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} },
    engaged: function () { return _sgUserEngaged; }
  };

  // The app calls getLocation() from many places — keep the name working.
  window.getLocation = getLocation;

  console.log('[Location] one location engine ready (cache key: ' + CACHE_KEY + ')');

})();
