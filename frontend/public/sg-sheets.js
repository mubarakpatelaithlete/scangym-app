/**
 * sg-sheets.js — one behaviour for every bottom sheet in the app.
 *
 * Measured on production, 2026-09-19, 412x915:
 *
 *   • **The Android back button did not close a single sheet.** Open Passes,
 *     Payment, Hours, Reviews, Calendar or Search, press back, and the browser
 *     left ScanGym entirely — because no sheet is a history entry. On a phone
 *     that is the most-used dismissal gesture there is, and ours dropped the
 *     customer out of the app mid-booking.
 *   • **The drag handle was decoration.** `.gym-overlay-drag` is styled with
 *     `cursor:grab` and has no touch handlers, so the one affordance that says
 *     "drag me down" did nothing. Calendar and Search had no handle at all.
 *   • Escape did nothing on desktop.
 *
 * Every sheet already had a working ✕ and a backdrop tap, so those are left
 * exactly as they are. This file adds the three missing ones, in one place,
 * for all of them:
 *
 *   1. a history entry per open sheet, so back closes the top sheet and only
 *      leaves the page once nothing is open (Airbnb, Booking and Uber all
 *      behave this way on mobile web);
 *   2. drag-to-dismiss that follows the finger and fades the scrim as it goes,
 *      so you can see it letting go before you commit — dismiss past a quarter
 *      of the sheet's height, or on a fast flick, otherwise it springs back;
 *   3. Escape on desktop.
 *
 * Purely additive: it wraps the existing open/close functions rather than
 * editing them, so a sheet that is later rewritten keeps this behaviour, and
 * anything this file cannot find it simply skips.
 *
 * Why not sheet-dismiss.js (sgMakeSheetDismissible): that helper is for a sheet
 * with *no* way out — it injects a ✕ and closes on a 60px flick. Every sheet
 * here already has a working ✕ and backdrop tap, so calling it would add a
 * second ✕ to each one. What these sheets are missing is the history entry and
 * a drag that follows the finger, which is what this file adds. Its Escape
 * handling closes the top of its own registry; the two registries do not
 * overlap (the auth sheet is not listed here).
 */
(function () {
  'use strict';

  /* Registry: one row per sheet. `open`/`close` are the names of the global
     functions the app already uses, so nothing here needs to know how a given
     sheet is built. `panel` is what the finger drags. */
  var SHEETS = [
    { id: 'gym', open: 'openGymDirectOverlay', close: 'closeGymOverlay',
      root: '#gym-overlay', panel: '.gym-overlay-panel', scrim: '.gym-overlay-bg', openClass: 'open' },
    { id: 'pay', open: 'openPaySheet', close: 'closePaySheet',
      root: '#gym-pay-sheet', panel: '.gym-pay-sheet-panel', scrim: '.gym-pay-sheet-bg', openClass: 'open' },
    { id: 'cal', open: 'showCalendarPicker', close: '_calPickerClose',
      root: '.sg-cal-overlay', panel: '.sg-cal-sheet', scrim: null, openClass: null },
    { id: 'search', open: '_openSearchOverlay', close: '_closeSearchOverlay',
      root: '#sg-search-overlay-v2', panel: '.sso-overlay', scrim: null, openClass: 'active' },
  ];

  var stack = [];          // ids of open sheets, innermost last
  var closingFromPop = false;

  function byId(id) {
    for (var i = 0; i < SHEETS.length; i++) if (SHEETS[i].id === id) return SHEETS[i];
    return null;
  }

  function rootOf(cfg) { return document.querySelector(cfg.root); }

  function isOpen(cfg) {
    var el = rootOf(cfg);
    if (!el) return false;
    if (cfg.openClass) return el.classList.contains(cfg.openClass);
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.opacity !== '0';
  }

  // ── History: one entry per sheet ─────────────────────────────────────────
  function pushEntry(id) {
    stack.push(id);
    try {
      // Same url on purpose: this is a layer over the page, not a new page, so
      // a reload or a shared link must still land on the page underneath.
      history.pushState({ sgSheet: id, depth: stack.length }, '', location.href);
    } catch (e) {}
  }

  function dropEntry(id) {
    var at = stack.lastIndexOf(id);
    if (at === -1) return;
    stack.splice(at, 1);
    if (closingFromPop) return;      // the pop already consumed the entry
    try { history.back(); } catch (e) {}
  }

  window.addEventListener('popstate', function () {
    if (!stack.length) return;       // nothing of ours open: let the app route
    var id = stack[stack.length - 1];
    var cfg = byId(id);
    closingFromPop = true;
    try {
      if (cfg && typeof window[cfg.close] === 'function') window[cfg.close]();
      else stack.pop();
    } finally {
      closingFromPop = false;
    }
  });

  // ── Wrap the app's own open/close so nothing else has to change ──────────
  function wrap(cfg) {
    var openFn = window[cfg.open];
    var closeFn = window[cfg.close];
    if (typeof openFn !== 'function' || typeof closeFn !== 'function') return false;

    window[cfg.open] = function () {
      var r = openFn.apply(this, arguments);
      // After the sheet has had a frame to mount: only count it if it opened.
      setTimeout(function () {
        if (isOpen(cfg) && stack.lastIndexOf(cfg.id) === -1) {
          pushEntry(cfg.id);
          attachDrag(cfg);
        }
      }, 60);
      return r;
    };

    window[cfg.close] = function () {
      var r = closeFn.apply(this, arguments);
      dropEntry(cfg.id);
      return r;
    };
    return true;
  }

  // ── Drag to dismiss ─────────────────────────────────────────────────────
  function attachDrag(cfg) {
    var panel = document.querySelector(cfg.panel);
    if (!panel || panel.__sgDrag) return;
    panel.__sgDrag = true;

    var scrim = cfg.scrim ? document.querySelector(cfg.scrim) : null;
    var startY = 0, lastY = 0, startT = 0, dragging = false, baseTransition = '';

    /* Only from the top of the sheet. Starting a drag anywhere would fight the
       scrollable body inside every one of these sheets (the reviews list, the
       pass grid), and a sheet that closes when you meant to scroll is worse
       than one that does not close at all. */
    function fromGrabZone(target, y) {
      var r = panel.getBoundingClientRect();
      if (y - r.top <= 72) return true;                      // handle + header
      return !!(target.closest && target.closest('[class*=drag],[class*=handle]'));
    }

    panel.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      var y = e.touches[0].clientY;
      if (!fromGrabZone(e.target, y)) return;
      dragging = true; startY = lastY = y; startT = Date.now();
      baseTransition = panel.style.transition;
      panel.style.transition = 'none';
    }, { passive: true });

    panel.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      lastY = e.touches[0].clientY;
      var dy = Math.max(0, lastY - startY);
      panel.style.transform = 'translateY(' + dy + 'px)';
      if (scrim) {
        var h = panel.getBoundingClientRect().height || 1;
        scrim.style.opacity = String(Math.max(0, 1 - (dy / h) * 1.4));
      }
    }, { passive: true });

    panel.addEventListener('touchend', function () {
      if (!dragging) return;
      dragging = false;
      var dy = Math.max(0, lastY - startY);
      var h = panel.getBoundingClientRect().height || 1;
      var speed = dy / Math.max(1, Date.now() - startT);     // px per ms
      panel.style.transition = baseTransition || 'transform .25s cubic-bezier(.32,.72,0,1)';
      /* A flick dismisses early, but only once it has actually travelled: a
         fast 20px twitch at the top of a sheet is someone starting to scroll,
         not throwing it away. */
      if (dy > h * 0.25 || (dy > 60 && speed > 0.7)) {
        panel.style.transform = '';
        if (scrim) scrim.style.opacity = '';
        var cfgClose = window[cfg.close];
        if (typeof cfgClose === 'function') cfgClose();
      } else {
        panel.style.transform = '';                           // spring back
        if (scrim) scrim.style.opacity = '';
      }
    });
  }

  // ── A grabber on the sheets that never had one ───────────────────────────
  function ensureGrabber(cfg) {
    var panel = document.querySelector(cfg.panel);
    if (!panel || panel.querySelector('.sg-grabber')) return;
    if (panel.querySelector('[class*=drag],[class*=handle]')) return;
    var g = document.createElement('div');
    g.className = 'sg-grabber';
    g.style.cssText = 'width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.25);margin:10px auto 2px;flex-shrink:0';
    panel.insertBefore(g, panel.firstChild);
  }

  // ── Escape, for the desktop site ─────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !stack.length) return;
    var cfg = byId(stack[stack.length - 1]);
    if (cfg && typeof window[cfg.close] === 'function') window[cfg.close]();
  });

  // ── Boot: wrap what exists now, and keep looking for the lazy ones ───────
  var pending = SHEETS.slice();
  function tryWrap() {
    pending = pending.filter(function (cfg) { return !wrap(cfg); });
    return pending.length === 0;
  }
  function boot() {
    if (tryWrap()) return;
    // The Create sheet and the calendar are defined in chunks that load on
    // demand, so retry for a while rather than giving up at load.
    var tries = 0;
    var iv = setInterval(function () {
      if (tryWrap() || ++tries > 40) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Sheets that build their DOM only when opened need the grabber and the drag
     handlers attached after that. attachDrag() is called on open; this covers
     the grabber for the two that lacked one. */
  var mo = new MutationObserver(function () {
    SHEETS.forEach(function (cfg) {
      if ((cfg.id === 'cal' || cfg.id === 'search') && isOpen(cfg)) ensureGrabber(cfg);
    });
  });
  mo.observe(document.body || document.documentElement, { childList: true, subtree: true });

  window._sgSheets = { stack: stack, sheets: SHEETS, isOpen: isOpen };
})();
