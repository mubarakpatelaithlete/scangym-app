/**
 * Every sheet can be closed.
 *
 * The sign-in sheet slides over the whole app with one way out: a tap on the
 * strip of backdrop above it. When the panel is tall that strip is a few dozen
 * pixels, and on a phone it is invisible — there is no x, Escape does nothing,
 * the drag handle at the top is decoration, and the tab bar underneath is
 * covered. A customer who taps Book, changes their mind, and cannot get back to
 * the app does not conclude "I should sign in". They conclude the app is broken.
 *
 * This is the missing half of a bottom sheet, kept in one small file so any
 * future sheet gets it by calling one function:
 *
 *   sgMakeSheetDismissible({ panel, onClose })
 *
 * It adds a real close button, closes on Escape, and closes on a downward drag
 * — the three gestures people already try. Idempotent: calling it twice on the
 * same panel does not stack listeners or buttons.
 */
(function () {
  'use strict';

  var CLOSE_MARK = 'sgDismissWired';
  var SWIPE_PX = 60;          // shorter than this is a scroll, not a dismissal
  var SWIPE_MAX_MS = 800;     // slower than this is a rest, not a swipe

  var escBound = false;
  var openPanels = [];        // most recent last, so Escape closes the top sheet

  function injectStyle() {
    if (document.getElementById('sg-sheet-dismiss-style')) return;
    var s = document.createElement('style');
    s.id = 'sg-sheet-dismiss-style';
    s.textContent =
      '.sg-sheet-x{position:absolute;top:10px;right:12px;width:34px;height:34px;' +
      'border-radius:17px;border:none;background:rgba(255,255,255,.08);color:#fff;' +
      'font-size:17px;line-height:1;cursor:pointer;z-index:5;display:flex;' +
      'align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}' +
      '.sg-sheet-x:active{background:rgba(255,255,255,.16)}';
    document.head.appendChild(s);
  }

  function hasCloseButton(panel) {
    var existing = panel.querySelectorAll('.sg-sheet-x');
    return existing && existing.length > 0;
  }

  function addCloseButton(panel, close) {
    if (hasCloseButton(panel)) return;
    var b = document.createElement('button');
    b.className = 'sg-sheet-x';
    b.setAttribute('aria-label', 'Close');
    b.setAttribute('type', 'button');
    b.innerHTML = '&#10005;';
    b.onclick = function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      close();
    };
    if (panel.insertBefore && panel.firstChild) panel.insertBefore(b, panel.firstChild);
    else panel.appendChild(b);
  }

  function bindEscape() {
    if (escBound) return;
    escBound = true;
    document.addEventListener('keydown', function (e) {
      if (!e || (e.key !== 'Escape' && e.key !== 'Esc')) return;
      var top = openPanels[openPanels.length - 1];
      if (top && top.isOpen && top.isOpen()) top.close();
    });
  }

  /* A downward drag on the panel closes it — but only when the panel is not
     scrolled, otherwise flicking a long form down would throw the sheet away
     mid-read. */
  function bindSwipe(panel, close) {
    var startY = null;
    var startAt = 0;

    function point(e) {
      if (e && e.touches && e.touches.length) return e.touches[0].clientY;
      if (e && e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientY;
      return e && typeof e.clientY === 'number' ? e.clientY : null;
    }

    panel.addEventListener('touchstart', function (e) {
      startY = (panel.scrollTop || 0) <= 0 ? point(e) : null;
      startAt = Date.now();
    }, { passive: true });

    panel.addEventListener('touchend', function (e) {
      if (startY === null) return;
      var endY = point(e);
      var dy = endY === null ? 0 : endY - startY;
      var dt = Date.now() - startAt;
      startY = null;
      if (dy >= SWIPE_PX && dt <= SWIPE_MAX_MS) close();
    }, { passive: true });
  }

  /**
   * @param {object} opts
   * @param {HTMLElement} opts.panel    the sliding panel itself
   * @param {function} opts.onClose     what actually hides the sheet
   * @param {function} [opts.isOpen]    so Escape only closes a visible sheet
   */
  function sgMakeSheetDismissible(opts) {
    opts = opts || {};
    var panel = opts.panel;
    var onClose = opts.onClose;
    if (!panel || typeof onClose !== 'function') return false;
    if (panel[CLOSE_MARK]) return true;          // idempotent
    panel[CLOSE_MARK] = true;

    var close = function () { try { onClose(); } catch (e) {} };
    var isOpen = typeof opts.isOpen === 'function' ? opts.isOpen : function () { return true; };

    injectStyle();
    addCloseButton(panel, close);
    bindEscape();
    bindSwipe(panel, close);
    openPanels.push({ close: close, isOpen: isOpen, panel: panel });
    return true;
  }

  window.sgMakeSheetDismissible = sgMakeSheetDismissible;
  /* Exposed for tests: the thresholds are the behaviour. */
  window.sgMakeSheetDismissible.SWIPE_PX = SWIPE_PX;
})();
