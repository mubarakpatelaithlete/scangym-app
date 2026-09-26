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

  /* The action row (rails.css) is the first thing above the nav — the owner's
     call: "between bottom navigation and Ask AI orange CTA button". It is NOT
     in BOTTOM_STACK because this file does not position it: rails.css pins it
     to the nav, since a card rail is `absolute` inside a contained card and a
     screen-space `bottom` written here would land in the wrong frame. What the
     dock does is RESERVE it, so the CTA, the summary and the Talk pill stack
     above the row and can never cover it (the old vertical rail was covered by
     the pill at y665 precisely because nothing reserved it).
     Listed most-specific first; only the visible one counts, and card rails are
     arbitrated to one by rails.js. */
  var ROW_SELECTORS = [
    '.tt-view .tt-card.sg-card-live .tt-actions',
    '.tt-view .tt-card .tt-actions',
    '.reel-actions',
    '#sg-reels-rail',
    '#sg-sv-rail.sv-float',
    '#sg-profile-rail',
    '.sg-pr-host-capped'     // the app's own Profile rail, extended in place
  ];

  /* Floating pills — they ride above the whole stack rather than joining it. */
  /* One per chat personality. chat-agent.js builds the id from the personality's
     `ns` (T('pchat-fab') swaps in the namespace), so every ns in use must appear
     here — a pill missing from this list is not docked, falls back to its own
     hardcoded `bottom`, and lands on top of the stack this file exists to keep
     apart. rchat = Reels, mchat = Profile. */
  var FABS = ['#bchat-fab', '#pchat-fab', '#schat-fab', '#rchat-fab', '#mchat-fab', '#chat-fab'];

  var NAV = 'nav.sg-tab-bar';
  var REELS_FRAME = '.sg-reels-frame, #sg-reels-iframe';
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

  /* The row's height, read from rails.css rather than repeated here. */
  function bandHeight() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--sg-band-height');
    return parseInt(v, 10) || 72;
  }

  /* Is rails.js running the CTA as the row's first item? Read defensively:
     this file is also loaded into minimal DOM stubs (tests/dock-no-overlap),
     and a missing classList must mean "no", not a thrown layout pass. */
  function ctaInRow() {
    try { return !!(document.body && document.body.classList &&
                    document.body.classList.contains('sg-cta-in-row')); }
    catch (e) { return false; }
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

    /* Reserve the action row's strip first, so everything else clears it. */
    var rowH = 0;
    for (i = 0; i < ROW_SELECTORS.length; i++) {
      el = $(ROW_SELECTORS[i]);
      if (!visible(el)) continue;
      rowH = heightOf(el);
      break;
    }
    /* The Reels tab is an iframe (.sg-reels-frame), so its row lives in another
       document and none of the selectors above can measure it. Reserve the
       band's own height instead — rails.css inside the frame uses exactly that
       number, and the frame is made to reach the nav below. Without this the
       orange CTA took the strip and the row rendered ABOVE it (measured on
       production 2026-09-18: row y660-730, CTA y736-788 — the wrong order). */
    if (!rowH && visible($(REELS_FRAME))) {
      rowH = bandHeight();
    }
    if (rowH) cursor += rowH + GAP;

    for (i = 0; i < BOTTOM_STACK.length; i++) {
      el = $(BOTTOM_STACK[i]);
      if (!visible(el)) continue;
      /* The orange CTA is IN the row now (owner, 2026-09-18): rails.css parks
         it as a pill at the left end of the band, which this file has already
         reserved. Docking it as its own layer would both fight that rule with
         an inline `bottom` and reserve a second 52px strip for a bar that is
         no longer full-width — the 52px the owner asked to get back. So while
         rails.js has the class on, the dock lets go of it: the inline value
         from earlier passes is removed, not just skipped, or it would stick. */
      if (el.id === 'sg-continue-banner' && ctaInRow()) {
        el.style.removeProperty('bottom');
        continue;
      }
      h = heightOf(el);
      el.style.setProperty('bottom', cursor + 'px', 'important');
      cursor += h + GAP;
    }

    /* ---- the row's own pinning, verified rather than assumed ----
       rails.css pins the body-level rails with `bottom: var(--sg-band-bottom)`,
       which is correct only if their containing block is the viewport. On
       Profile it is not: the app's native rail (`.sg-pr-host-capped`) sits
       inside the tab content, and some ancestor there establishes a containing
       block for fixed children, so a computed `bottom: 60px` put the row at
       y676-748 instead of y712-784 — 36px too high, measured on production
       2026-09-18. Rather than hunt the ancestor (backdrop-filter, will-change
       and containment all do this, and the app uses all three), measure where
       the row actually landed and correct by the difference. A rail already in
       the right place is left alone. */
    /* Once corrected, never strip the inline value: that dropped the row back
       to its wrong spot, the next pass fixed it again, and the Profile rail
       jumped ~36px every 500ms ("double/shadow buttons", 2026-09-26). */
    var wantBottom = navH + safe + 4;          // --sg-band-gap
    for (i = 0; i < ROW_SELECTORS.length; i++) {
      el = $(ROW_SELECTORS[i]);
      if (!visible(el)) continue;
      if (getComputedStyle(el).position !== 'fixed') continue;
      var rect = el.getBoundingClientRect();
      var landed = Math.round(innerHeight - rect.bottom);
      // already right: keep the inline fix (removing it made the rail jump)
      if (Math.abs(landed - wantBottom) <= 1) continue;
      var current = parseFloat(getComputedStyle(el).bottom) || 0;
      el.style.setProperty('bottom', (current + (wantBottom - landed)) + 'px', 'important');
      break;
    }

    /* Floating pills clear everything already stacked — unless they are IN the
       row (owner, 2026-09-18): rails.css places the Talk pill next to the main
       button inside the band, so docking it above the stack would pull it back
       out. Release it, inline value and all, exactly like the CTA. */
    for (i = 0; i < FABS.length; i++) {
      el = $(FABS[i]);
      if (!visible(el)) continue;
      if (ctaInRow()) { el.style.removeProperty('bottom'); continue; }
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
    /* #sg-sps is an in-flow strip, not a pinned one. Offsetting it here on top
       of the container padding pushed it down onto whatever followed it — on
       Book that was the "Showing gyms in ..." location banner. Leave it alone
       and let it flow; only the fixed banner needs space reserved. */
    if (top2) { top2.style.removeProperty('top'); }
    if (content) {
      content.style.setProperty('padding-top', topCursor + 'px', 'important');
    }

    /* Publish the numbers so other code can read them instead of guessing. */
    var rs = document.documentElement.style;
    rs.setProperty('--sg-nav-h', navH + 'px');
    rs.setProperty('--sg-safe-b', safe + 'px');
    rs.setProperty('--sg-dock-h', cursor + 'px');
    rs.setProperty('--sg-row-h', rowH + 'px');
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
