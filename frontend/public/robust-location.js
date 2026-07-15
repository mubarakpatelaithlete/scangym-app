/**
 * ═══════════════════════════════════════════════════════════════
 *  ROBUST LOCATION — 5-Layer Waterfall GPS (Vanilla JavaScript)
 * ═══════════════════════════════════════════════════════════════
 * 
 * Drop-in replacement for the current getLocation() in app.js.
 * No React, no TypeScript — pure vanilla JS for the GitHub codebase.
 * 
 * INSTALLATION:
 *   1. Copy this file to: frontend/public/robust-location.js
 *   2. Add <script src="/robust-location.js"></script> in index.html
 *      (BEFORE app.js)
 *   3. In app.js, delete the old getLocation() function (lines 81-89)
 *   4. That's it — the new getLocation() replaces the old one globally
 * 
 * THE 5 LAYERS:
 *   Layer 1: GPS High Accuracy (5s timeout)
 *   Layer 2: GPS Low Accuracy  (5s timeout, allows 60s cached)
 *   Layer 3: Google Geolocation API via server (WiFi/cell/IP)
 *   Layer 4: Cached location from localStorage (24hr TTL)
 *   Layer 5: Google Geolocation API — IP only (city-level fallback)
 * 
 * If ALL layers fail → returns null (not Bolton, not London)
 * Your app should show "Enter your location" when null is returned.
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

  var CACHE_KEY = 'scangym_last_location';
  var CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

  // ─── Cache Helpers ───

  function saveToCache(coords) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        lat: coords.lat,
        lng: coords.lng,
        timestamp: Date.now()
      }));
    } catch(e) {}
  }

  function getFromCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.timestamp > CACHE_MAX_AGE) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return { lat: parsed.lat, lng: parsed.lng };
    } catch(e) {
      return null;
    }
  }

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

  // ─── Main: 5-Layer Waterfall ───

  /**
   * getLocation() — drop-in replacement
   * 
   * Returns a Promise that resolves to { lat, lng } or null.
   * Tries 5 layers in order, stops at the first success.
   * 
   * OLD BEHAVIOR:  getLocation() → always returns {lat, lng} (Bolton if GPS fails)
   * NEW BEHAVIOR:  getLocation() → returns {lat, lng} or null (no fake location)
   */
  window.getLocation = async function getLocation() {
    console.log('[Location] Starting 5-layer waterfall...');

    // Layer 1: GPS High Accuracy
    try {
      console.log('[Location] Layer 1: GPS high accuracy...');
      var coords = await tryGPS(true, 5000);
      console.log('[Location] ✅ Layer 1 success:', coords.lat.toFixed(4), coords.lng.toFixed(4));
      saveToCache(coords);
      return coords;
    } catch(e) {
      console.log('[Location] Layer 1 failed:', e.message);
    }

    // Layer 2: GPS Low Accuracy (faster, allows cached position)
    try {
      console.log('[Location] Layer 2: GPS low accuracy...');
      var coords = await tryGPS(false, 5000);
      console.log('[Location] ✅ Layer 2 success:', coords.lat.toFixed(4), coords.lng.toFixed(4));
      saveToCache(coords);
      return coords;
    } catch(e) {
      console.log('[Location] Layer 2 failed:', e.message);
    }

    // Layer 3: Google Geolocation API (server-side, WiFi/cell/IP)
    try {
      console.log('[Location] Layer 3: Google Geolocation API...');
      var coords = await tryGoogleGeo();
      console.log('[Location] ✅ Layer 3 success:', coords.lat.toFixed(4), coords.lng.toFixed(4));
      saveToCache(coords);
      return coords;
    } catch(e) {
      console.log('[Location] Layer 3 failed:', e.message);
    }

    // Layer 4: Cached location from localStorage (24hr TTL)
    var cached = getFromCache();
    if (cached) {
      console.log('[Location] ✅ Layer 4 success (cached):', cached.lat.toFixed(4), cached.lng.toFixed(4));
      return cached;
    }
    console.log('[Location] Layer 4: No cached location');

    // Layer 5: Google Geolocation API — IP only (city-level)
    try {
      console.log('[Location] Layer 5: Google IP geolocation...');
      var coords = await tryGoogleIPGeo();
      console.log('[Location] ✅ Layer 5 success:', coords.lat.toFixed(4), coords.lng.toFixed(4));
      saveToCache(coords);
      return coords;
    } catch(e) {
      console.log('[Location] Layer 5 failed:', e.message);
    }

    // ALL LAYERS FAILED
    console.warn('[Location] ❌ All 5 layers failed. Returning null.');
    return null;
  };

  console.log('[Location] 🏋️ Robust 5-layer waterfall loaded');

})();
