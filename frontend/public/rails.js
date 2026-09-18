/**
 * rails.js — one right-edge rail on screen at a time.
 *
 * The Book and Partner carousels are 579px tall cards inside an 844px screen,
 * so the NEXT card's rail (measured at y775, buttons "Filter" y791 and
 * "Near Me" y803) is on screen at the same time as the current card's rail
 * (y197–y741). Two columns of the same buttons, the lower one half behind the
 * tab bar — read as "double buttons overlapping each other".
 *
 * The app's existing IntersectionObserver cannot answer this: it runs with
 * rootMargin 600px so it can pre-load photos, which means three cards are
 * "intersecting" at once by design. This observer asks the narrower question —
 * which card owns the screen right now — and marks only that one.
 *
 * It also tags a rail that had to scroll (`sg-rail-scrollable`) so the CSS can
 * show a small chevron instead of silently cutting buttons off.
 *
 * Deliberately does nothing until it has an answer: the hiding rule in
 * rails.css only applies to a carousel carrying `sg-rails-arbitrated`, so a
 * failure here leaves today's behaviour rather than a tab with no buttons.
 */
(function () {
  'use strict';

  var LIVE = 'sg-card-live';
  var ON = 'sg-rails-arbitrated';
  var SCROLLABLE = 'sg-rail-scrollable';

  if (typeof IntersectionObserver === 'undefined') return;

  var seen = [];

  /** Of the cards currently intersecting, the one showing the most of itself. */
  function pick() {
    var best = null;
    for (var i = 0; i < seen.length; i++) {
      var e = seen[i];
      if (!e.isIntersecting) continue;
      if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
    }
    return best ? best.target : null;
  }

  var observer = new IntersectionObserver(function (entries) {
    // Keep the latest entry per card, then decide once.
    entries.forEach(function (e) {
      for (var i = 0; i < seen.length; i++) {
        if (seen[i].target === e.target) { seen[i] = e; return; }
      }
      seen.push(e);
    });
    var winner = pick();
    if (!winner) return;
    var view = winner.closest('.tt-view') || winner.parentNode;
    var cards = (view || document).querySelectorAll('.tt-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].classList.toggle(LIVE, cards[j] === winner);
    }
    if (view && view.classList) view.classList.add(ON);
    markScroll(winner);
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

  /* The rails are a horizontal row now (see rails.css), so "there is more" is a
     question about width, and it changes as the row is scrolled: the arrow has
     to disappear at the end, or it points at nothing. */
  /* `.sg-pr-host-capped` is the app's own Profile rail, which profile-rail.js
     extends instead of floating its own when it exists (see rails.css). */
  var ROWS = '.tt-actions, .reel-actions, #sg-reels-rail, #sg-sv-rail.sv-float, #sg-profile-rail, .sg-pr-host-capped';
  function markRow(row) {
    if (!row) return;
    var more = row.scrollWidth - row.clientWidth - row.scrollLeft > 8;
    if (more !== row.classList.contains(SCROLLABLE)) row.classList.toggle(SCROLLABLE, more);
    if (!row.getAttribute('data-sg-scroll-watch')) {
      row.setAttribute('data-sg-scroll-watch', '1');
      row.addEventListener('scroll', function () { markRow(row); }, { passive: true });
    }
  }
  function markScroll(card) {
    markRow(card.querySelector('.tt-actions'));
  }
  /** Every row on screen, card or floating. */
  function markAllRows() {
    var rows = document.querySelectorAll(ROWS);
    for (var i = 0; i < rows.length; i++) markRow(rows[i]);
  }

  var known = [];
  function scan() {
    var cards = document.querySelectorAll('.tt-card');
    for (var i = 0; i < cards.length; i++) {
      if (known.indexOf(cards[i]) !== -1) continue;
      known.push(cards[i]);
      observer.observe(cards[i]);
    }
    // Cards are replaced wholesale on re-render; drop the ones that left.
    for (var k = known.length - 1; k >= 0; k--) {
      if (!known[k].isConnected) { observer.unobserve(known[k]); known.splice(k, 1); }
    }
    var live = document.querySelector('.tt-card.' + LIVE);
    if (live) markScroll(live);
    syncCta();          // before markAllRows: the inset decides what overflows
    markAllRows();
  }

  function init() {
    scan();
    setInterval(scan, 800); // same heartbeat the other rail scripts use
    window.addEventListener('resize', function () { syncCta(); markAllRows(); });
    /* The label — and so the pill's width — changes with the tab. */
    document.addEventListener('sg:tabchange', function () {
      requestAnimationFrame(function () { syncCta(); markAllRows(); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ── The orange CTA as the row's first item (owner, 2026-09-18) ───────────
     rails.css parks `#sg-continue-banner` at the left end of the band as a
     pill and insets the rows by `--sg-cta-w`. Only this file knows how wide
     the pill actually is — the label changes per tab ("Book this gym · £5.49"
     is far wider than "Continue") — so it measures it every pass and
     publishes the number.

     The class lives here rather than in the stylesheet so the decision can be
     reverted in one line if bookings dip: drop CTA_IN_ROW and the bar goes
     back to full width, untouched.

     The Reels tab is a separate document, so the framed copy of this script
     cannot see the pill at all. The top window posts the width in; the framed
     branch below applies it. */
  var CTA_IN_ROW = 'sg-cta-in-row';
  var CTA = '#sg-continue-banner';
  /* One Talk pill per chat personality; only one is ever on screen. Same list
     as sg-dock.js FABS — a pill missing here keeps its own `right: 14px` and
     floats over the row instead of joining it. */
  var TALK = '#bchat-fab, #pchat-fab, #schat-fab, #rchat-fab, #mchat-fab, #chat-fab';
  var FRAMED = (function () { try { return window.top !== window.self; } catch (e) { return true; } })();

  /* --sg-cta-w is the whole inset the rows must leave: main button + Talk.
     --sg-talk-left is where the Talk pill starts, so it lands between them. */
  function publish(ctaW, talkW) {
    var pad = 12, gap = 14;                    // --sg-band-pad, the row's gap
    var rs = document.documentElement.style;
    var talkLeft = pad + (ctaW ? ctaW + gap : 0);
    rs.setProperty('--sg-talk-left', Math.round(talkLeft) + 'px');
    rs.setProperty('--sg-cta-w',
      Math.round(ctaW + (talkW ? (ctaW ? gap : 0) + talkW : 0)) + 'px');
  }

  function widthOf(el) {
    if (!el) return 0;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return 0;
    return el.getBoundingClientRect().width;
  }

  function measureTalk() {
    var els = document.querySelectorAll(TALK);
    for (var i = 0; i < els.length; i++) {
      var w = widthOf(els[i]);
      if (w) return w;                          // only one is ever visible
    }
    return 0;
  }

  function measureCta() {
    var cta = document.querySelector(CTA);
    /* Hidden (`sg-cb-hidden`) or absent — e.g. a tab with no primary action.
       Inset 0 so the row uses the full width instead of holding a gap open
       for a button that is not there.

       Do NOT test `offsetParent` here: the CTA is `position: fixed`, and a
       fixed element's offsetParent is null even when it is plainly on screen.
       The first deploy did exactly that, published --sg-cta-w: 0px, and the
       row's first buttons rendered UNDER a 217px pill. Measured, plus the
       properties that actually mean "not painted". */
    if (!cta || cta.classList.contains('sg-cb-hidden')) return 0;
    var cs = getComputedStyle(cta);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return 0;
    return cta.getBoundingClientRect().width;
  }

  function syncCta() {
    if (FRAMED) return;               // the parent owns the pill
    document.body.classList.add(CTA_IN_ROW);
    var w = measureCta();
    publish(w, measureTalk());
    var total = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--sg-cta-w')) || 0;
    /* Tell every Reels frame, so its row starts after the pill drawn over it. */
    var frames = document.querySelectorAll('#sg-reels-iframe, .sg-reels-frame, iframe[src*="reels"]');
    for (var i = 0; i < frames.length; i++) {
      try {
        frames[i].contentWindow.postMessage({ sg: 'cta-in-row', width: Math.round(total) }, '*');
      } catch (e) { /* cross-origin or not loaded yet: next pass */ }
    }
  }

  if (FRAMED) {
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || d.sg !== 'cta-in-row') return;
      if (document.body) document.body.classList.add(CTA_IN_ROW);
      document.documentElement.style.setProperty('--sg-cta-w', (d.width || 0) + 'px');
      markAllRows();                  // the inset changed how much overflows
    });
  }

  window.sgRails = { scan: scan, LIVE_CLASS: LIVE, syncCta: syncCta };
})();
