/**
 * ScanGym — layout dock (single source of truth for pinned overlays).
 *
 * WHY THIS EXISTS
 * Before this file, every script that pinned something to an edge hardcoded its
 * own guess at what was underneath it: `bottom:16px`, `bottom:56px`, and even
 * hand-computed stacks like `calc(56px + 52px + env(safe-area-inset-bottom))`.
 * Whenever two of those guesses disagreed the bars overlapped and buried real
 * content — e.g. on Profile the "Get ID verified" row (689-768) sat underneath
 * the Continue bar (736-788), and on Book the "Ask AI" pill (678-724) cut
 * through the price summary (710-736).
 *
 * WHAT IT DOES
 * Owns the bottom edge. Every pass it measures the overlays that are actually
 * visible and stacks them in a fixed order, so nothing can ever overlap
 * regardless of which script injected what or when. Same for the two promo
 * strips at the top. It also reserves real padding on <main> so page content is
 * never hidden behind the stack.
 *
 * CONTRACT: to dock a new element, add it to BOTTOM_STACK. Do not set `bottom`
 * on it yourself.
 */
(function () {
  'use strict';

  var GAP = 8;               // breathing room between stacked bars
  var FAB_GAP = 12;          // extra clearance under a floating pill

  /* Bottom-docked elements, listed nearest-the-nav first and working upward.
     Anything not present or not visible is simply skipped. */
  var BOTTOM_STACK = [
    '#sg-continue-banner',   // primary CTA ("Book this gym", "Continue")
    '#sg-book-summary',      // price/date line that explains the CTA
    '#sg-id-row'             // secondary prompt (ID verification)
  ];

  /* Floating pills — they ride above the whole stack rather than joining it. */
  var FABS = ['#bchat-fab', '#pchat-fab', '#schat-fab', '#chat-fab'];

  var NAV = 'nav.sg-tab-bar';
  var CONTENT = 'main.sg-tab-content';
  var TOP_PRIMARY = '#sg-usp-banner';
  var TOP_SECONDARY = '#sg-sps';

  function $(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }

  function visible(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return el.getBoundingClientRect().height > 1;
  }

  function heightOf(el) {
    return el ? Math.round(el.getBoundingClientRect().height) : 0;
  }

  /* The safe-area inset, resolved to a number we can add up. */
  function safeBottom() {
    var probe = document.getElementById('sg-safe-probe');
    if (!probe) {
      probe = document.createElement('div');
      probe.id = 'sg-safe-probe';
      probe.style.cssText =
        'position:fixed;bottom:0;left:0;width:0;pointer-events:none;visibility:hidden;' +
        'height:env(safe-area-inset-bottom,0px)';
      document.body.appendChild(probe);
    }
    return Math.round(probe.getBoundingClientRect().height) || 0;
  }

  function layout() {
    if (!document.body) return;

    var nav = $(NAV);
    var safe = safeBottom();
    var navH = visible(nav) ? heightOf(nav) : 0;

    /* ---- bottom edge: stack upward from the nav ---- */
    var cursor = navH + (navH ? 0 : safe);
    var i, el, h;

    for (i = 0; i < BOTTOM_STACK.length; i++) {
      el = $(BOTTOM_STACK[i]);
      if (!visible(el)) continue;
      h = heightOf(el);
      el.style.setProperty('bottom', cursor + 'px', 'important');
      cursor += h + GAP;
    }

    /* Floating pills clear everything already stacked. */
    for (i = 0; i < FABS.length; i++) {
      el = $(FABS[i]);
      if (!visible(el)) continue;
      el.style.setProperty('bottom', (cursor + FAB_GAP) + 'px', 'important');
    }

    /* Reserve space so content is never hidden behind the stack — but only when
       the tab actually flows. Full-bleed tabs (the Book hero fills the viewport)
       would otherwise gain a dead band where the image used to be. Measure with
       the padding removed so the decision is based on the content's own height. */
    var content = $(CONTENT);
    if (content) {
      content.style.removeProperty('padding-bottom');
      var scrolls = content.scrollHeight > content.clientHeight + 4;
      if (scrolls) {
        content.style.setProperty(
          'padding-bottom', (cursor + FAB_GAP + GAP) + 'px', 'important');
      }
    }

    /* ---- top edge: the two promo strips must not share pixels ---- */
    var top1 = $(TOP_PRIMARY);
    var top2 = $(TOP_SECONDARY);
    var topCursor = 0;
    if (visible(top1)) {
      top1.style.setProperty('top', '0px', 'important');
      topCursor = heightOf(top1);
    }
    if (visible(top2)) {
      top2.style.setProperty('top', topCursor + 'px', 'important');
      topCursor += heightOf(top2);
    }
    if (content) {
      content.style.setProperty('padding-top', topCursor + 'px', 'important');
    }

    /* Publish the numbers so other code can read them instead of guessing. */
    var rs = document.documentElement.style;
    rs.setProperty('--sg-nav-h', navH + 'px');
    rs.setProperty('--sg-safe-b', safe + 'px');
    rs.setProperty('--sg-dock-h', cursor + 'px');
    rs.setProperty('--sg-top-h', topCursor + 'px');
  }

  /* Coalesce bursts of mutations into one layout pass per frame. */
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; layout(); });
  }

  function start() {
    layout();
    try {
      new MutationObserver(schedule).observe(document.body, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
      });
    } catch (e) { /* observer unsupported: the interval below still covers us */ }

    addEventListener('resize', schedule);
    addEventListener('orientationchange', schedule);
    addEventListener('load', schedule);
    /* Several bars are injected on timers well after load. */
    setInterval(schedule, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.sgDockLayout = layout;   // exposed for tests and debugging
})();
