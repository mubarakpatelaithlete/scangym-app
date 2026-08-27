/**
 * Lazy chunk loader.
 *
 * app.ctr576.js shipped every tab's code to every visitor: 1.6MB of source
 * parsed before the Book tab could paint, most of it for tabs the visitor was
 * not looking at. The heavy, area-isolated page functions now live in separate
 * chunk files that load when their area is actually rendered, and get
 * prefetched at idle after first paint so a tab switch is still instant.
 *
 * Loads before app.ctr576.js (plain <script defer>, so execution order is
 * document order) because _renderInner() calls sgChunkReady() on every render.
 *
 * Contracts this file keeps:
 *
 *  - Chunks declare the same globals they declared inside the monolith, so
 *    every existing inline onclick="_creatorFoo()" keeps working untouched.
 *  - A chunk is fetched at most once, no matter how many callers ask.
 *  - Nothing here throws into a caller. A chunk that fails to load leaves the
 *    app on the page it was already showing; the visitor can retry by
 *    navigating again. A missing optimisation is invisible, a thrown error is
 *    a blank site.
 *  - Filenames are content-hashed at build time, so URLs come from
 *    window.__sgChunks (injected by the server from .asset-manifest.json).
 *    The unhashed name is the fallback for dev.
 */
'use strict';

(function () {
  var loaded = {};   // name -> true once the script has executed
  var pending = {};  // name -> Promise, so concurrent callers share one fetch
  var waiters = {};  // name -> [fn], callbacks registered before the chunk landed

  /** Resolve a chunk name to its (possibly content-hashed) URL. */
  function urlFor(name) {
    var map = window.__sgChunks || {};
    return map[name] || '/' + name + '.js';
  }

  function sgChunkReady(name) {
    return loaded[name] === true;
  }

  /**
   * Load a chunk. Returns a promise that resolves true on success, false on
   * failure — it never rejects, so callers do not need a .catch().
   */
  function sgChunk(name) {
    if (loaded[name]) return Promise.resolve(true);
    if (pending[name]) return pending[name];

    pending[name] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = urlFor(name);
      s.async = true;
      s.onload = function () {
        loaded[name] = true;
        pending[name] = null;
        var list = waiters[name] || [];
        waiters[name] = [];
        for (var i = 0; i < list.length; i++) {
          try { list[i](); } catch (e) { /* one bad callback must not block the rest */ }
        }
        resolve(true);
      };
      s.onerror = function () {
        // Allow a later navigation to try again rather than caching the failure.
        pending[name] = null;
        console.warn('[sgChunk] failed to load ' + name);
        resolve(false);
      };
      document.head.appendChild(s);
    });
    return pending[name];
  }

  /**
   * Run fn once a chunk's globals exist — immediately if already loaded.
   *
   * This is the replacement for `setInterval(function(){ if(typeof Foo===
   * 'function'){...} }, 200)`. Those polling ladders assumed every function
   * existed shortly after boot; with chunks that is no longer true, and a
   * ladder waiting on a chunk the visitor never loads spins forever.
   * Registering here costs nothing and fires exactly once.
   */
  function sgOnChunk(name, fn) {
    if (loaded[name]) { try { fn(); } catch (e) {} return; }
    (waiters[name] = waiters[name] || []).push(fn);
  }

  /**
   * A core-side placeholder for a function that now lives in a chunk.
   *
   * Used for the handful of entry points reachable from code that stayed in
   * core (a Google sign-in callback, an inline onclick rendered by a core
   * page). The stub loads the chunk, then calls the real implementation, which
   * has by then overwritten this stub on window. Arguments and `this` are
   * preserved; the return value is not, because the call becomes asynchronous
   * — only use this for handlers whose result is already ignored.
   */
  function sgChunkStub(name, fnName) {
    var stub = function () {
      var self = this, args = arguments;
      sgChunk(name).then(function (ok) {
        if (!ok) return;
        var fn = window[fnName];
        // The chunk's own declaration replaces this stub on window when it
        // executes. Still seeing the stub means the chunk loaded but does not
        // define the function — a split that lost a symbol.
        if (typeof fn !== 'function' || fn === stub) {
          console.warn('[sgChunk] ' + name + ' loaded but did not define ' + fnName);
          return;
        }
        try { fn.apply(self, args); } catch (e) { console.warn('[sgChunk] ' + fnName + ' threw', e); }
      });
    };
    stub.__sgStub = true;
    return stub;
  }

  /**
   * Load an arbitrary first-party script once, on demand.
   *
   * Unlike sgChunk this takes a URL rather than a manifest name, for the
   * pre-existing standalone scripts (admin-dashboard.js and friends) that are
   * not build-time chunks but also do not belong on every visitor's boot path.
   * Same contracts: at most one fetch, never rejects, a failure is not cached.
   */
  function sgLoadScript(url) {
    var key = 'url:' + url;
    if (loaded[key]) return Promise.resolve(true);
    if (pending[key]) return pending[key];

    pending[key] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = function () { loaded[key] = true; pending[key] = null; resolve(true); };
      s.onerror = function () {
        pending[key] = null;
        console.warn('[sgLoadScript] failed to load ' + url);
        resolve(false);
      };
      document.head.appendChild(s);
    });
    return pending[key];
  }

  /**
   * Prefetch chunks at idle, after first paint, lowest priority.
   *
   * This is what keeps tab switches instant: by the time a visitor taps
   * ScanSquad, its chunk is usually already parsed. Deliberately not a
   * <link rel=prefetch> — executing the chunk (not just caching the bytes)
   * is what makes the switch synchronous.
   */
  function sgPrefetchChunks(names) {
    function go() {
      names.forEach(function (n, i) {
        // Stagger so several chunks cannot compete with each other or with
        // late first-party requests still in flight.
        setTimeout(function () { sgChunk(n); }, i * 300);
      });
    }
    function idle() {
      if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 });
      else setTimeout(go, 1200);
    }
    if (document.readyState === 'complete') idle();
    else window.addEventListener('load', idle);
  }

  /* ── A 2px top progress bar for a navigation waiting on a chunk ──────────
   * Shown instead of wiping the page to a skeleton. On a deep link the
   * server-rendered boot skeleton for that route is already on screen and
   * stays; on a tab switch the page the visitor was reading stays until the
   * new one can actually be drawn. Either way nothing flashes empty. */
  function bar(show) {
    var id = 'sg-chunk-progress';
    var el = document.getElementById(id);
    if (!show) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;top:0;left:0;height:2px;width:0;z-index:11200;' +
      'background:#FF6D00;box-shadow:0 0 8px rgba(255,109,0,.6);' +
      'transition:width .3s ease-out;pointer-events:none';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.width = '70%'; });
  }

  window.sgChunk = sgChunk;
  window.sgChunkReady = sgChunkReady;
  window.sgOnChunk = sgOnChunk;
  window.sgChunkStub = sgChunkStub;
  window.sgLoadScript = sgLoadScript;
  window.sgPrefetchChunks = sgPrefetchChunks;
  window.sgChunkProgress = bar;
})();
