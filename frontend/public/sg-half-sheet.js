/**
 * sg-half-sheet.js — the one half-screen sheet every button opens.
 *
 * Owner's rule (2026-09-30): every button on Home, Create and Shop opens a
 * half-screen sheet from the bottom — the page stays visible behind it, a red
 * ✕ closes it, so does a swipe down, so does the phone's back button, and a
 * ← back arrow sits on the left when there is somewhere to go back to. The
 * chat sheet (Talk / Ask AI) was the reference; this reproduces its shape so
 * the app has one sheet instead of six.
 *
 *   window.sgOpenSheet(html, opts) → { root, body, close }
 *     opts.title / opts.sub / opts.icon — header (optional; no header if none)
 *     opts.onBack  — shows ← and calls it (after closing) when tapped
 *     opts.onClose — called once, however the sheet was dismissed
 *     opts.height  — css max-height, default 62vh
 *   window.sgCloseSheet()             — closes whatever this file opened
 *   window.sgSheetDrag(panel, close, scrim) — swipe-down for a sheet built
 *     elsewhere (the Create model sheet keeps its own DOM and borrows this).
 *
 * One history entry per open sheet: back closes the sheet, not the page.
 * Loaded standalone in the Reels frame too, where it draws inside the frame.
 */
(function () {
  'use strict';
  if (window.sgOpenSheet) return;

  var ID = 'sg-half-sheet';
  var CSS = [
    '#' + ID + '-scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:var(--sg-z-sheet,9500);opacity:0;transition:opacity .25s;}',
    '#' + ID + '-scrim.open{opacity:1;}',
    '#' + ID + '{position:fixed;left:0;right:0;bottom:var(--sg-tab-height,56px);max-height:62vh;display:flex;flex-direction:column;background:#0b0f1a;color:#fff;border-radius:22px 22px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.6);z-index:calc(var(--sg-z-sheet,9500) + 1);transform:translateY(105%);transition:transform .3s cubic-bezier(.32,.72,0,1);box-sizing:border-box;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));font-family:inherit;}',
    '#' + ID + '.open{transform:translateY(0);}',
    '#' + ID + ' .shs-handle{width:44px;height:5px;border-radius:3px;background:rgba(255,255,255,.28);margin:10px auto 6px;flex:0 0 auto;}',
    '#' + ID + ' .shs-head{display:flex;align-items:center;gap:12px;padding:6px 14px 10px;border-bottom:1px solid rgba(255,255,255,.07);flex:0 0 auto;}',
    '#' + ID + ' .shs-back{width:36px;height:36px;border-radius:50%;background:#141b2b;border:1px solid #223050;color:#e5e7eb;font-size:20px;line-height:34px;text-align:center;cursor:pointer;flex:0 0 auto;-webkit-tap-highlight-color:transparent;}',
    '#' + ID + ' .shs-icon{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#FF6D00,#E66200);display:flex;align-items:center;justify-content:center;font-size:22px;flex:0 0 auto;}',
    '#' + ID + ' .shs-t{flex:1;min-width:0;}',
    '#' + ID + ' .shs-t b{display:block;font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#' + ID + ' .shs-t span{display:block;font-size:12.5px;color:#9fb0c8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#' + ID + ' .shs-x{width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.45);color:#ef4444;font-size:22px;line-height:34px;text-align:center;cursor:pointer;flex:0 0 auto;margin-left:auto;-webkit-tap-highlight-color:transparent;}',
    '#' + ID + ' .shs-body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 16px 4px;scrollbar-width:none;}',
    '#' + ID + ' .shs-body::-webkit-scrollbar{display:none;}',
    '.shs-opt{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;padding:14px;margin:0 0 8px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.05);color:#fff;font-size:15px;font-weight:700;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '.shs-opt .shs-oi{font-size:20px;width:28px;text-align:center;}',
    '.shs-opt.shs-primary{background:#FF6D00;border-color:#FF6D00;justify-content:center;}',
    '.shs-note{color:rgba(255,255,255,.55);font-size:12.5px;line-height:1.5;margin:0 0 12px;}'
  ].join('');

  function css() {
    if (document.getElementById(ID + '-css')) return;
    var s = document.createElement('style');
    s.id = ID + '-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var current = null;      // { root, scrim, onClose, entry }
  var closingFromPop = false;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** Swipe-down that follows the finger, from the top 72px of the panel. */
  function sheetDrag(panel, close, scrim) {
    if (!panel || panel.__sgDrag) return;
    panel.__sgDrag = true;
    var startY = 0, lastY = 0, startT = 0, dragging = false, base = '';
    panel.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      var y = e.touches[0].clientY;
      var r = panel.getBoundingClientRect();
      var grab = (y - r.top <= 72) || !!(e.target.closest && e.target.closest('[class*=handle]'));
      if (!grab) return;
      dragging = true; startY = lastY = y; startT = Date.now();
      base = panel.style.transition; panel.style.transition = 'none';
    }, { passive: true });
    panel.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      lastY = e.touches[0].clientY;
      var dy = Math.max(0, lastY - startY);
      panel.style.transform = 'translateY(' + dy + 'px)';
      if (scrim) scrim.style.opacity = String(Math.max(0, 1 - (dy / (panel.getBoundingClientRect().height || 1)) * 1.4));
    }, { passive: true });
    panel.addEventListener('touchend', function () {
      if (!dragging) return;
      dragging = false;
      var dy = Math.max(0, lastY - startY);
      var h = panel.getBoundingClientRect().height || 1;
      var speed = dy / Math.max(1, Date.now() - startT);
      panel.style.transition = base || 'transform .25s cubic-bezier(.32,.72,0,1)';
      panel.style.transform = '';
      if (scrim) scrim.style.opacity = '';
      if (dy > h * 0.25 || (dy > 60 && speed > 0.7)) close();
    });
  }

  function closeSheet(fromPop) {
    var c = current;
    if (!c) return;
    current = null;
    c.root.classList.remove('open');
    c.scrim.classList.remove('open');
    setTimeout(function () { c.root.remove(); c.scrim.remove(); }, 300);
    if (c.entry && !fromPop && !closingFromPop) { try { history.back(); } catch (e) {} }
    c.entry = false;
    if (typeof c.onClose === 'function') { var f = c.onClose; c.onClose = null; try { f(); } catch (e) {} }
  }

  function openSheet(html, opts) {
    opts = opts || {};
    css();
    if (current) { current.entry = false; closeSheet(true); }   // swap, keep one entry

    var scrim = document.createElement('div');
    scrim.id = ID + '-scrim';
    scrim.addEventListener('click', function () { closeSheet(); });

    var root = document.createElement('div');
    root.id = ID;
    root.setAttribute('role', 'dialog');
    if (opts.height) root.style.maxHeight = opts.height;
    var h = '<div class="shs-handle"></div>';
    var hasHead = opts.title || opts.onBack || opts.icon;
    h += '<div class="shs-head">'
      + (opts.onBack ? '<div class="shs-back" role="button" aria-label="Back">\u2190</div>' : '')
      + (opts.icon ? '<div class="shs-icon">' + opts.icon + '</div>' : '')
      + (opts.title ? '<div class="shs-t"><b>' + esc(opts.title) + '</b>' + (opts.sub ? '<span>' + esc(opts.sub) + '</span>' : '') + '</div>' : '<div class="shs-t"></div>')
      + '<div class="shs-x" role="button" aria-label="Close">\u00d7</div>'
      + '</div>';
    if (!hasHead) h = h.replace('class="shs-head"', 'class="shs-head" style="border-bottom:0;padding-bottom:0"');
    h += '<div class="shs-body"></div>';
    root.innerHTML = h;
    var body = root.querySelector('.shs-body');
    if (typeof html === 'string') body.innerHTML = html; else if (html) body.appendChild(html);

    root.querySelector('.shs-x').addEventListener('click', function () { closeSheet(); });
    var back = root.querySelector('.shs-back');
    if (back) back.addEventListener('click', function () { closeSheet(); setTimeout(function () { try { opts.onBack(); } catch (e) {} }, 0); });

    document.body.appendChild(scrim);
    document.body.appendChild(root);
    current = { root: root, scrim: scrim, onClose: opts.onClose, entry: false };
    if (!history.state || !history.state.sgHalfSheet) {
      try { history.pushState({ sgHalfSheet: 1 }, '', location.href); current.entry = true; } catch (e) {}
    } else current.entry = true;
    sheetDrag(root, function () { closeSheet(); }, scrim);
    requestAnimationFrame(function () { scrim.classList.add('open'); root.classList.add('open'); });
    return { root: root, body: body, close: function () { closeSheet(); } };
  }

  window.addEventListener('popstate', function () {
    if (!current) return;
    closingFromPop = true;
    try { closeSheet(true); } finally { closingFromPop = false; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && current) closeSheet();
  });

  window.sgOpenSheet = openSheet;
  window.sgCloseSheet = function () { closeSheet(); };
  window.sgSheetDrag = sheetDrag;
  window.sgSheetOption = function (icon, label, primary) {
    return '<button type="button" class="shs-opt' + (primary ? ' shs-primary' : '') + '"><span class="shs-oi">' + icon + '</span><span>' + esc(label) + '</span></button>';
  };
})();
