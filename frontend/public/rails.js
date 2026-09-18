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
    ride();             // the pills belong to the visible row, so move them first
    markAllRows();      // then measure what still overflows, pills included
  }

  /* One bad pass must not take the rails down. init() called scan() before
     setInterval, so a single throw in there meant no heartbeat at all and every
     tab silently fell back to the pre-rails layout — measured in production on
     2026-09-18, after a call to a function that had been renamed. */
  function safeScan() {
    try { scan(); } catch (e) { /* next pass */ }
  }

  function init() {
    if (document.body) watchRemovals();
    safeScan();
    setInterval(safeScan, 800); // same heartbeat the other rail scripts use
    window.addEventListener('resize', function () { syncCta(); markAllRows(); ride(); });
    /* The label — and so the pill's width — changes with the tab. */
    document.addEventListener('sg:tabchange', function () {
      requestAnimationFrame(function () { syncCta(); ride(); markAllRows(); });
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

  /* The glyph and caption that replace the button's own words. Matched on the
     label text rather than on the tab, because the same tab can show a
     different action (Profile shows "Continue" signed out and nothing signed
     in) and because the framed Reels document has no tab state at all. */
  var CAPTIONS = [
    [/^\s*book/i,      '\uD83D\uDCB3', 'Book'],
    [/ask ai/i,         '\u2728',       'Ask AI'],
    [/^\s*continue/i,  '\uD83D\uDD13', 'Sign in'],
    [/gym|near me/i,    '\uD83D\uDCCD', 'Gyms']
  ];

  /* Give the CTA the row's shape: a glyph in a circle with a caption under it.
     Called every pass because the label changes as the user moves around, and
     the caption has to follow it. */
  function iconify(cta) {
    if (!cta) return;
    /* Read the label elements, NOT cta.textContent: the caption this function
       appends is inside the button too, so textContent would feed last pass's
       caption back in and the glyph could stick on a stale action. */
    var parts = cta.querySelectorAll('.sg-cb-text, .sg-cb-sub, .sg-cb-price');
    var words = '';
    for (var p = 0; p < parts.length; p++) words += ' ' + (parts[p].textContent || '');
    words = words.replace(/\s+/g, ' ').trim();
    var ico = '\u2728', cap = 'Ask AI';
    for (var i = 0; i < CAPTIONS.length; i++) {
      if (CAPTIONS[i][0].test(words)) { ico = CAPTIONS[i][1]; cap = CAPTIONS[i][2]; break; }
    }
    var iel = cta.querySelector('.sg-cb-ico');
    if (!iel) {
      iel = document.createElement('span');
      iel.className = 'sg-cb-ico';
      cta.insertBefore(iel, cta.firstChild);
    }
    var cel = cta.querySelector('.sg-cb-cap');
    if (!cel) {
      cel = document.createElement('span');
      cel.className = 'sg-cb-cap';
      cta.appendChild(cel);
    }
    if (iel.textContent !== ico) iel.textContent = ico;
    if (cel.textContent !== cap) cel.textContent = cap;
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
    iconify(document.querySelector(CTA));
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
  } else {
    /* Book / Talk / Ask AI tapped inside the Reels frame: it has no chat of its
       own, so the tap is performed here, on the tab the customer is looking at. */
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || d.sg !== 'row-act' || !d.key) return;
      act(String(d.key));
    });
  }

  /* ── The pills moved INTO the row (owner, 2026-09-18, fourth decision) ───
     "These buttons are not moved in with other scrolling buttons." They were
     fixed pills parked at the left of the band: the circles scrolled past them
     and they held still, so the strip read as two separate sets of buttons.

     They are now real children of the row's scroller, inside a slot at its
     left end, so they scroll exactly like every other button and the scroller
     clips them at its edge. No per-frame maths and no second position to keep
     in sync — the browser does it.

     Same elements throughout: `#sg-continue-banner` and the chat pill are
     MOVED, never rebuilt, so the checkout flow, the per-tab label and every
     tap handler bound to them keep working. Drop RIDES and the parked layout
     in rails.css (pill at --sg-band-pad, rows inset by --sg-cta-w) is still
     there underneath, so the fallback is the shipped behaviour. */
  var RIDES = 'sg-cta-rides-row';
  var SLOT = 'sg-row-slot';

  function painted(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  /** The one row the user is actually looking at: live card first, then rails. */
  function activeRow() {
    var live = document.querySelector('.tt-card.' + LIVE + ' .tt-actions');
    if (painted(live)) return live;
    var rows = document.querySelectorAll(ROWS);
    for (var i = 0; i < rows.length; i++) if (painted(rows[i])) return rows[i];
    return null;
  }

  /* One slot per row, always its first child: a card can become live between
     passes, and the slot is where the pills go when it does. */
  function slotIn(row) {
    var first = row.firstElementChild;
    if (first && first.classList.contains(SLOT)) return first;
    var slot = document.createElement('span');
    slot.className = SLOT;
    row.insertBefore(slot, row.firstChild);
    return slot;
  }

  function talkEl() {
    var els = document.querySelectorAll(TALK);
    for (var i = 0; i < els.length; i++) if (widthOf(els[i])) return els[i];
    return null;
  }

  /* ── One strip, the same three buttons on every tab (owner, 2026-09-18) ──
     "Why all buttons are not in 1 row… why they're not same colour, same size,
     same design… why reels tab is missing ask AI and talk button."

     Before this there was one orange bar whose label changed per tab, plus a
     Talk pill that only appeared on the tab that owned its chat, plus the
     card's own circles: three different shapes, and which of them you got
     depended on the tab. Now every tab's row starts with the same three items,
     built from the app's own row markup (.tt-action > .tt-action-btn +
     .tt-action-label), so they are the same size, colour and shape as every
     circle beside them by construction, not by copied numbers.

     Nothing new is invented behind them: Book taps the card's own book button
     or moves to the Book tab, and Talk and Ask AI open the tab's existing chat
     (voice or typing), which is the same object its floating pill opened. */
  var TRIO = 'sg-row-trio';
  var ITEMS = [
    { key: 'book', ico: '\uD83D\uDCB3', cap: 'Book' },
    { key: 'talk', ico: '\uD83C\uDFA4', cap: 'Talk' },
    { key: 'ai',   ico: '\u2728',       cap: 'Ask AI' }
  ];

  /** The chat this tab owns. Built by its own script, so it is already there. */
  function chatFab() { return document.querySelector(TALK); }

  function openChat(mode) {
    var fab = chatFab();
    if (!fab) { if (typeof window.switchTab === 'function') window.switchTab('book'); return; }
    fab.click();                                  // the pill's own handler opens it
    var ns = (fab.id || '').replace('-fab', '');  // bchat-fab -> bchat
    /* Straight to the microphone for Talk, straight to the keyboard for Ask AI.
       Kept inside the tap so the browser still counts it as a user gesture,
       which the microphone needs. */
    setTimeout(function () {
      var el = document.getElementById(ns + (mode === 'talk' ? '-mic' : '-input'));
      if (!el) return;
      if (mode === 'talk') el.click(); else el.focus();
    }, 260);
  }

  function act(key) {
    /* The Reels tab is its own document: the chats and the tab switcher are in
       the parent, so the framed copy asks rather than does. */
    if (FRAMED) {
      try { window.parent.postMessage({ sg: 'row-act', key: key }, '*'); } catch (e) { /* closed */ }
      return;
    }
    if (key === 'talk') return openChat('talk');
    if (key === 'ai') return openChat('ai');
    /* Book: the card in front of the customer has its own book button, with the
       gym and the price already bound to it. Only when there is none — Profile,
       ScanSquad, Reels — does this become "go to the Book tab". */
    var live = document.querySelector('.tt-card.' + LIVE + ' .tt-cta-btn') ||
               document.querySelector('.tt-card.' + LIVE + ' .sg-cb-book');
    if (live) return live.click();
    var cta = document.querySelector(CTA);
    if (cta && /book/i.test(ctaWords(cta))) return cta.click();
    if (typeof window.switchTab === 'function') return window.switchTab('book');
    location.href = '/book';
  }

  function buildTrio(slot) {
    if (slot.querySelector('.' + TRIO)) return;
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      var item = document.createElement('div');
      item.className = 'tt-action ' + TRIO;
      item.setAttribute('data-sg-row-act', it.key);
      var btn = document.createElement('div');
      btn.className = 'tt-action-btn';
      btn.textContent = it.ico;
      var lab = document.createElement('div');
      lab.className = 'tt-action-label';
      lab.textContent = it.cap;
      item.appendChild(btn);
      item.appendChild(lab);
      item.addEventListener('click', (function (key) {
        return function (ev) { ev.stopPropagation(); act(key); };
      })(it.key));
      slot.appendChild(item);
    }
  }

  /* The old floating pills are the same doors as Talk and Ask AI, so they are
     taken out of the strip — except when the main bar is offering something the
     trio does not cover (signing in), where it stays as a row item of its own. */
  /* The bar's own label elements, never its textContent: iconify() appends a
     caption inside the same element, and reading that back makes the label look
     like whatever the last pass wrote. */
  function ctaWords(el) {
    var parts = el.querySelectorAll('.sg-cb-text, .sg-cb-sub, .sg-cb-price');
    var out = '';
    for (var i = 0; i < parts.length; i++) out += ' ' + (parts[i].textContent || '');
    return out.trim() || (el.getAttribute('data-sg-label') || '');
  }

  function parkOldPills(slot) {
    var cta = document.querySelector(CTA);
    if (cta) {
      remember(cta);
      var words = ctaWords(cta);
      var ownAction = /continue|sign in|log in/i.test(words);
      cta.classList.toggle('sg-cb-in-strip', ownAction);
      if (ownAction && cta.parentNode !== slot) slot.appendChild(cta);
      if (!ownAction && cta.parentNode === slot) document.body.appendChild(cta);
    }
    var talk = document.querySelector(TALK);
    if (talk) { remember(talk); if (talk.parentNode === slot) document.body.appendChild(talk); }
  }

  /* A card is replaced wholesale on re-render, and the main bar can be sitting
     inside one. The removed subtree is detached, not destroyed, so the element
     is still there to be rescued — and it has to be, because there is one of it
     and nothing rebuilds it: a lost bar means a tab with no way to sign in.
     Remembered in a list because `document.querySelector` cannot find a
     detached element. */
  var pills = [];
  function remember(el) { if (el && pills.indexOf(el) === -1) pills.push(el); }
  function rescue(el) {
    if (el && !el.isConnected && document.body) document.body.appendChild(el);
  }
  function watchRemovals() {
    if (typeof MutationObserver === 'undefined') return;
    new MutationObserver(function (recs) {
      var rescued = false;
      for (var i = 0; i < recs.length; i++) {
        var gone = recs[i].removedNodes;
        for (var j = 0; j < gone.length; j++) {
          if (!gone[j].querySelector) continue;
          for (var k = 0; k < pills.length; k++) {
            if (gone[j] === pills[k] || gone[j].contains(pills[k])) {
              rescue(pills[k]); rescued = true;
            }
          }
        }
      }
      if (rescued) ride();                  // straight into the row that replaced it
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* "Why all buttons are not in 1 row… why it is separate separate in a row?"
     Some tabs paint two rows in the same band — Profile has its own rail behind
     the app's chip host, measured live with Book/Talk/Ask AI drawn on top of
     Telegram/Discord/Slack. One row is the whole point of this file, so the
     second row's items are moved into the host and the empty row is taken out
     of the band. Only rows sharing the host's band are touched, so a card's own
     rail somewhere else on the screen is left alone. */
  var MERGED = 'sg-row-merged';
  function mergeInto(host) {
    var hostRect = host.getBoundingClientRect();
    var rows = document.querySelectorAll(ROWS);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row === host || row.contains(host) || host.contains(row)) continue;
      if (!painted(row)) continue;
      var r = row.getBoundingClientRect();
      if (Math.abs(r.top - hostRect.top) > 60) continue;   // a different band
      while (row.firstChild) host.appendChild(row.firstChild);
      row.classList.add(MERGED);
    }
  }

  function ride() {
    for (var i = 0; i < pills.length; i++) rescue(pills[i]);
    var row = activeRow();
    if (!row) return;
    var slot = slotIn(row);
    var fresh = !slot.querySelector('.' + TRIO);
    buildTrio(slot);
    /* The Reels frame loads the whole app, so it has its own copy of the bar
       and the chat pill — measured live: the frame's bar, iconified to "Gyms",
       sat on top of the strip's first item. Same treatment in both documents. */
    parkOldPills(slot);
    mergeInto(row);
    if (document.body) document.body.classList.add(RIDES);
    /* sg-rail-ui scrolls the active chip into view with an offset sized for a
       row that started after the pills. With these items inside the scroller
       the same offset hid them: measured live on Book and Partner, the first
       button sat at x-112 before the customer touched anything. Rewound once,
       when the items arrive, so a swipe of the user's own is never undone. */
    if (fresh && row.scrollLeft) row.scrollLeft = 0;
  }

  window.sgRails = { scan: scan, LIVE_CLASS: LIVE, syncCta: syncCta, ride: ride, act: act };
})();
