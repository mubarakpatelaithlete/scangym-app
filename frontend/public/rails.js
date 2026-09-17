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
  var ROWS = '.tt-actions, .reel-actions, #sg-reels-rail, #sg-sv-rail.sv-float, #sg-profile-rail';
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
    markAllRows();
  }

  function init() {
    scan();
    setInterval(scan, 800); // same heartbeat the other rail scripts use
    window.addEventListener('resize', markAllRows);
    document.addEventListener('sg:tabchange', function () { requestAnimationFrame(markAllRows); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.sgRails = { scan: scan, LIVE_CLASS: LIVE };
})();
