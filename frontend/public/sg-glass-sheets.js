/* sg-glass-sheets.js — owner 2026-10-03 (Tango/TikTok screenshots):
   "every half screen from bottom should be transparent / see-through" and
   "every button should be a horizontal row, transparent / see-through" — on
   ALL tabs, not just Home.

   Sheets across the app are built in many files, mostly with inline styles,
   so one class rule cannot reach them. This script finds bottom sheets at the
   moment they are added (fixed, pinned to the bottom, full width, rounded top
   corners) and re-skins them as frosted glass: the same colour at low alpha
   plus blur, so whatever is behind (video, feed, map) stays visible.
   Inside a sheet, solid button/row backgrounds become see-through glass;
   coloured calls to action (orange/green/red) keep their hue, just translucent.
   Dimming backdrops are lightened so the page behind is not blacked out.
   Light sheets stay light (white glass) so dark text stays readable. */
(function () {
  if (window.__sgGlassSheets) return; window.__sgGlassSheets = 1;
  var DONE = 'sgGlass';
  var HINT = /sheet|modal|menu|drawer|popup|overlay|backdrop|panel|picker|dialog|share|comment|cmt|attach|action/i;
  var css = document.createElement('style');
  css.id = 'sg-glass-sheets-css';
  css.textContent =
    '[data-sg-glass="sheet"]{-webkit-backdrop-filter:blur(18px) saturate(150%)!important;backdrop-filter:blur(18px) saturate(150%)!important;' +
    'border-top:1px solid rgba(255,255,255,.16)!important;box-shadow:0 -8px 30px rgba(0,0,0,.25)!important}' +
    '[data-sg-glass="sheet"] input,[data-sg-glass="sheet"] textarea,[data-sg-glass="sheet"] select{background-color:rgba(255,255,255,.08)!important;border-color:rgba(255,255,255,.18)!important}' +
    '[data-sg-glass-tone="light"] input,[data-sg-glass-tone="light"] textarea,[data-sg-glass-tone="light"] select{background-color:rgba(255,255,255,.55)!important;border-color:rgba(0,0,0,.12)!important}' +
    '[data-sg-glass="btn"]{border:1px solid rgba(255,255,255,.22)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.10)!important}' +
    '[data-sg-glass-tone="light"] [data-sg-glass="btn"]{border-color:rgba(0,0,0,.10)!important}';
  (document.head || document.documentElement).appendChild(css);

  function rgba(str) {
    var m = /rgba?\(([^)]+)\)/.exec(str || ''); if (!m) return null;
    var p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) { return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255; }
  function sat(c) { var mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx ? (mx - mn) / mx : 0; }
  function set(el, k, v) { el.style.setProperty(k, v, 'important'); }

  function coversScreen(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    var s = getComputedStyle(el);
    return s.position === 'fixed' && el.offsetHeight >= window.innerHeight * 0.9 && el.offsetWidth >= window.innerWidth * 0.9;
  }
  /* Geometry from layout (offset* and computed insets), not getBoundingClientRect,
     so a sheet parked off-screen with translateY(100%) is still recognised. */
  function isSheet(el, s) {
    if (s.position !== 'fixed' && s.position !== 'absolute') return false;
    if (el.classList.contains('sg-tab-bar') || el.id === 'sg-continue-banner') return false;
    if (s.position === 'absolute' && !coversScreen(el.offsetParent)) return false;
    var vw = window.innerWidth, vh = window.innerHeight;
    var bottom = parseFloat(s.bottom), w = el.offsetWidth, h = el.offsetHeight;
    if (isNaN(bottom) || bottom < -2 || bottom > 90) return false;      // pinned to the bottom (or just above the tab bar)
    if (w < Math.min(vw * 0.85, 340)) return false;
    if (h > vh * 0.97 || (h && h < 80)) return false;                    // full pages and slim bars are not sheets
    return parseFloat(s.borderTopLeftRadius) >= 8 && !(parseFloat(s.borderBottomLeftRadius) >= 8);
  }
  function isBackdrop(el, s) {
    if (s.position !== 'fixed') return false;
    var c = rgba(s.backgroundColor); if (!c || c.a < 0.35 || lum(c) > 0.2) return false;
    var r = el.getBoundingClientRect();
    return parseFloat(s.top) <= 1 && parseFloat(s.left) <= 1 && parseFloat(s.right) <= 1 && parseFloat(s.bottom) <= 1 &&
      el.children.length <= 1 && (r.width === 0 || r.width >= window.innerWidth * 0.95) && el.textContent.trim().length < 2;
  }

  function glassSheet(el, s) {
    var c = rgba(s.backgroundColor) || { r: 18, g: 20, b: 29, a: 0 };
    var light = c.a > 0 && lum(c) > 0.6;
    el.dataset.sgGlass = 'sheet'; el.dataset.sgGlassTone = light ? 'light' : 'dark';
    if (c.a < 0.05 && s.backgroundImage === 'none') { glassInside(el, false); return; }   // already clear: only its rows

    set(el, 'background-image', 'none');
    set(el, 'background-color', light ? 'rgba(255,255,255,.62)' : 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',.68)');
    glassInside(el, light);
  }
  function glassInside(sheet, light) {
    var kids = sheet.querySelectorAll('button,a,[role="button"],li,div,label');
    for (var i = 0, n = 0; i < kids.length && n < 400; i++) {
      var k = kids[i]; if (k.dataset.sgGlass) continue; n++;
      var t = k.tagName;
      var s = getComputedStyle(k), c = rgba(s.backgroundColor);
      if (!c || c.a < 0.3 || s.backgroundImage.indexOf('url(') >= 0) continue;
      if (k.offsetWidth < 44 || k.offsetHeight < 24) continue;           // dots, badges, avatars
      if (/^(IMG|VIDEO|CANVAS|SVG)$/.test(t) || k.querySelector('video,canvas')) continue;
      var btn = t === 'BUTTON' || t === 'A' || k.getAttribute('role') === 'button' || t === 'LABEL' || t === 'LI';
      if (sat(c) > 0.45 && lum(c) > 0.2) {                               // coloured CTA keeps its hue
        set(k, 'background-color', 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',.72)');
        set(k, 'background-image', 'none');
      } else {
        set(k, 'background-color', light ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.07)');
        set(k, 'background-image', 'none');
      }
      k.dataset.sgGlass = btn ? 'btn' : 'row';
    }
  }

  function check(el) {
    if (!el || el.nodeType !== 1 || el.dataset[DONE]) return;
    var hint = HINT.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '')) || /fixed/.test(el.getAttribute('style') || '');
    if (!hint) return;
    var s = getComputedStyle(el);
    if (isSheet(el, s)) { el.dataset[DONE] = '1'; glassSheet(el, s); }
    else if (isBackdrop(el, s)) { el.dataset[DONE] = '1'; set(el, 'background-color', 'rgba(0,0,0,.28)'); }
  }
  function scan(root) {
    check(root);
    if (root.querySelectorAll) {
      var all = root.querySelectorAll('[class],[id],[style]');
      for (var i = 0; i < all.length && i < 600; i++) check(all[i]);
    }
  }

  var queue = [], queued = false;
  function flush() {
    queued = false; var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) {
      var el = q[i][0], deep = q[i][1]; if (!el.isConnected) continue;
      var sh = el.closest && el.closest('[data-sg-glass="sheet"]');
      if (sh) { if (deep) glassInside(sh, sh.dataset.sgGlassTone === 'light'); continue; }   // new rows in an open sheet
      /* attribute change: a sheet (or its wrapper) being opened — re-check it and, if it looks like a sheet container, its subtree */
      if (deep || HINT.test((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : ''))) scan(el); else check(el);
    }
  }
  function push(el, deep) { if (el && el.nodeType === 1) { queue.push([el, deep]); if (!queued) { queued = true; requestAnimationFrame(flush); } } }
  new MutationObserver(function (ms) {
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) push(m.addedNodes[j], true); }
      else if (!m.target.dataset[DONE]) push(m.target, false);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  function first() { scan(document.body); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', first); else first();
  window.sgGlassSheets = { scan: scan };
})();
