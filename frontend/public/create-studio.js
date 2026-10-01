/**
 * Create Studio — the Create tab's landing surface on /creator.
 *
 * What it is: a model catalogue laid out the way Higgsfield and CapCut lay
 * theirs out (owner's reference screenshots, 2026-09-29) — filter chips, a
 * two-column grid of tiles, one tile per model, badge for tier, role and price
 * on every tile — followed by the creator's own history as a dated feed with
 * thumbnails and a visible state for jobs still running or failed.
 *
 * What it is not: a second Create pipeline. A tile opens the existing sheet
 * in squad-create.js with that model preselected (window.sgSquadCreate.open);
 * pricing, quotas, billing and the routes are untouched. The catalogue itself
 * comes from each mode's /health (server/lib/gen-models.js#catalogueFor), so
 * a model added there appears here without a deploy of this file.
 *
 * Honesty rules inherited from squad-create.js: a tile the server cannot run
 * is drawn dimmed with the reason, never as a working button; a job that
 * failed says so in the feed instead of vanishing.
 */
(function () {
  'use strict';

  var ROUTE = /^\/(creator|scansquad)(\/|$)/;
  var ID = 'sg-create-studio';
  var CACHE_MS = 60 * 1000;

  /* Modes in the order they appear, and the copy the tile leads with. `api`
     mirrors squad-create.js MODES; the server still decides what runs. */
  var KINDS = [
    { key: 'image', chip: 'Images', api: '/api/squad-image', verb: 'Create image', bg: 'linear-gradient(135deg,#1f3a5f,#0e1e36)', icon: '🖼️' },
    { key: 'video', chip: 'Videos', api: '/api/squad-video', verb: 'Create video', bg: 'linear-gradient(135deg,#3b1f5f,#160e36)', icon: '🎬' },
    { key: 'edit', chip: 'Edit', api: '/api/squad-edit', verb: 'Edit video', bg: 'linear-gradient(135deg,#1f4f4a,#0b2624)', icon: '🎞️' },
    { key: 'audio', chip: 'Audio', api: '/api/squad-audio', verb: 'Create voice', bg: 'linear-gradient(135deg,#5f3a1f,#361b0e)', icon: '🎙️' },
    { key: 'music', chip: 'Music', api: '/api/squad-music', verb: 'Create music', bg: 'linear-gradient(135deg,#5f1f3a,#360e1b)', icon: '🎵' },
    { key: 'text', chip: 'Text', api: '/api/squad-text', verb: 'Write caption', bg: 'linear-gradient(135deg,#2f3f4f,#141c24)', icon: '✍️' },
  ];
  function kindByKey(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].key === k) return KINDS[i]; return null; }

  var css = [
    '#' + ID + '{position:fixed;left:0;right:0;top:0;bottom:calc(var(--sg-tab-height,56px) + var(--sg-band-height,56px));z-index:8995;background:#070b14;color:#e5e7eb;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:max(env(safe-area-inset-top,0px),10px) 12px 24px;box-sizing:border-box;font-family:inherit;}',
    '#' + ID + '::-webkit-scrollbar{display:none;}',
    /* brand-mark.css pins the orange S top-left at ~44px; the title starts after it. */
    '.cs-head{display:flex;align-items:center;justify-content:space-between;margin:2px 2px 10px;padding-left:44px;}',
    /* Header and chips stay put while 30+ tiles scroll under them. */
    '.cs-sticky{position:sticky;top:-10px;z-index:2;background:#070b14;padding-top:10px;margin-top:-10px;}',
    '.cs-title{font-size:22px;font-weight:800;color:#fff;letter-spacing:-.2px;}',
    '.cs-close{width:32px;height:32px;border-radius:50%;background:#141b2b;border:1px solid #223050;color:#cbd5e1;font-size:18px;line-height:30px;text-align:center;cursor:pointer;}',
    '.cs-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:12px;padding-bottom:2px;}',
    '.cs-chips::-webkit-scrollbar{display:none;}',
    '.cs-chip{flex:0 0 auto;padding:7px 13px;border-radius:16px;background:#141b2b;border:1px solid #223050;color:#aab4c5;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;}',
    '.cs-chip.on{background:#fff;color:#0b1020;border-color:#fff;}',
    '.cs-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
    '.cs-tile{border-radius:14px;overflow:hidden;background:#101828;border:1px solid #1c2740;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '.cs-tile:active{transform:scale(.98);}',
    '.cs-tile.off{opacity:.5;}',
    '.cs-cover{position:relative;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;font-size:40px;}',
    '.cs-cover .cs-gif{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}',
    '.cs-badge{position:absolute;top:8px;left:8px;font-size:9.5px;font-weight:800;letter-spacing:.6px;padding:3px 7px;border-radius:6px;background:rgba(255,255,255,.92);color:#0b1020;text-transform:uppercase;}',
    '.cs-badge.pro{background:#7c3aed;color:#fff;}',
    '.cs-badge.kind{left:auto;right:8px;background:rgba(0,0,0,.55);color:#fff;}',
    '.cs-price{position:absolute;bottom:8px;right:8px;font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;}',
    '.cs-body{padding:9px 10px 11px;}',
    '.cs-name{font-size:12.5px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.cs-sub{font-size:11px;color:#c3cddc;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.cs-sec{display:flex;align-items:center;justify-content:space-between;margin:22px 2px 8px;}',
    /* Library: the creator's own work first, as a strip of thumbnails the way
       Higgsfield leads with "My assets". "See all" unfolds the dated feed. */
    '.cs-lib{margin:0 0 12px;}',
    '.cs-lib .cs-sec{margin:2px 2px 8px;}',
    '.cs-lib .cs-sec span{color:#FF6D00;font-weight:700;cursor:pointer;}',
    '.cs-strip{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;}',
    '.cs-strip::-webkit-scrollbar{display:none;}',
    '.cs-strip .cs-thumb{width:64px;height:64px;border-radius:12px;cursor:pointer;position:relative;}',
    '.cs-strip .cs-thumb.run::after{content:"";position:absolute;inset:0;border-radius:12px;border:2px solid #93c5fd;}',
    '.cs-lib .cs-feed{display:none;}',
    '.cs-lib.all .cs-feed{display:block;}',
    '.cs-lib.all .cs-strip{display:none;}',
    '.cs-sec b{font-size:15px;color:#fff;}',
    '.cs-sec span{font-size:12px;color:#94a3b8;}',
    '.cs-day{font-size:11.5px;color:#94a3b8;font-weight:700;margin:14px 2px 6px;text-transform:uppercase;letter-spacing:.5px;}',
    '.cs-row{display:flex;gap:10px;align-items:center;padding:8px 6px;border-radius:12px;cursor:pointer;}',
    '.cs-row:active{background:#101828;}',
    '.cs-thumb{width:56px;height:56px;border-radius:10px;background:#141b2b;flex:0 0 auto;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:22px;}',
    '.cs-thumb img,.cs-thumb video{width:100%;height:100%;object-fit:cover;display:block;}',
    '.cs-rt{flex:1;min-width:0;}',
    '.cs-rt b{display:block;font-size:13px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.cs-rt span{display:block;font-size:11px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.cs-state{font-size:11px;font-weight:700;padding:3px 8px;border-radius:8px;flex:0 0 auto;}',
    '.cs-state.run{background:rgba(59,130,246,.18);color:#93c5fd;}',
    '.cs-state.bad{background:rgba(239,68,68,.18);color:#fca5a5;}',
    '.cs-empty{font-size:12.5px;color:#94a3b8;padding:14px 6px;line-height:1.5;}',
    '.cs-spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.2);border-top-color:#93c5fd;border-radius:50%;animation:csspin .7s linear infinite;vertical-align:-2px;margin-right:5px;}',
    '@keyframes csspin{to{transform:rotate(360deg)}}',
  ].join('');

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getJSON(url) {
    return fetch(url, { credentials: 'include' }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    });
  }

  // ── data ──────────────────────────────────────────────────────────────────
  var cat = { at: 0, tiles: null, promise: null };
  var lib = { at: 0, items: null, signedOut: false, promise: null };

  /** Every runnable model across every configured mode, as tiles. */
  function loadCatalogue() {
    if (cat.tiles && Date.now() - cat.at < CACHE_MS) return Promise.resolve(cat.tiles);
    if (cat.promise) return cat.promise;
    cat.promise = getJSON('/api/squad-create/modes').then(function (res) {
      var modes = (res.d && res.d.modes) || {};
      return Promise.all(KINDS.map(function (k) {
        var st = modes[k.key];
        var configured = st ? (st.configured !== false) : true;
        return getJSON(k.api + '/health').then(function (h) {
          var d = h.d || {};
          var available = configured && d.available !== false && h.ok;
          var models = d.models || [];
          if (!models.length) {
            /* No catalogue rows: one tile for the mode itself, so the button
               is still findable, drawn as unavailable if it is. */
            return [{ kind: k, id: null, label: k.verb, role: null, price: null, tier: 'default', available: available, reason: (st && st.reason) || d.reason || null }];
          }
          if (k.key === 'text') {
            /* Every text model prices out at a penny a caption; six tiles that
               differ only by vendor name are noise (the sheet applies the same
               rule to its chips). One tile, the choice inside the sheet. */
            return [{ kind: k, id: null, label: k.verb, role: models.length + ' writers \u00b7 pick inside', price: (models[0] && models[0].price) ? models[0].price : null, tier: 'default', available: available, locked: false, note: null, reason: available ? null : ((st && st.reason) || d.reason || 'Not switched on yet') }];
          }
          return models.map(function (m) {
            return {
              kind: k, id: m.id, label: m.label, role: m.role || null,
              price: m.price ? m.price + (m.unit === 'per image' ? '/image' : m.unit === 'per clip' ? '/clip' : m.unit ? '/' + m.unit.replace(/^per /, '') : '') : null,
              tier: m.tier || 'standard', available: available, locked: m.affordable === false, lockedReason: m.lockedReason || null,
              note: m.note || null, reason: available ? null : ((st && st.reason) || d.reason || 'Not switched on yet'),
            };
          });
        }).catch(function () {
          return [{ kind: k, id: null, label: k.verb, role: null, price: null, tier: 'default', available: false, reason: 'Could not reach this mode' }];
        });
      }));
    }).then(function (lists) {
      var tiles = [];
      lists.forEach(function (l) { tiles = tiles.concat(l); });
      cat.tiles = tiles; cat.at = Date.now(); cat.promise = null;
      return tiles;
    }).catch(function () { cat.promise = null; return cat.tiles || []; });
    return cat.promise;
  }

  function loadLibrary(force) {
    if (!force && lib.items && Date.now() - lib.at < 15000) return Promise.resolve(lib.items);
    if (lib.promise) return lib.promise;
    lib.promise = getJSON('/api/squad-create/library?limit=40').then(function (res) {
      lib.signedOut = (res.status === 401 || res.status === 403);
      lib.items = res.ok ? (res.d.items || []) : [];
      lib.at = Date.now(); lib.promise = null;
      return lib.items;
    }).catch(function () { lib.promise = null; return lib.items || []; });
    return lib.promise;
  }

  // ── render ────────────────────────────────────────────────────────────────
  var filter = 'all';
  var dismissed = false; // the × hides the studio until the route changes

  function badgeFor(t) {
    if (t.tier === 'premium') return { txt: 'PRO', cls: 'pro' };
    if (t.tier === 'default') return { txt: 'CORE', cls: '' };
    return null;
  }

  function tile(t) {
    var d = el('div', 'cs-tile' + ((!t.available || t.locked) ? ' off' : ''));
    /* Task 53: every model card has its own animated GIF (img/model-gif/{id}.gif);
       a missing file falls back to the kind emoji. */
    var cover = el('div', 'cs-cover', '<img class="cs-gif" src="/img/model-gif/' + esc(t.id) + '.gif?v=1" alt="" loading="lazy" decoding="async" onerror="this.outerHTML=\'<span>' + t.kind.icon + '</span>\'">');
    cover.style.background = t.kind.bg;
    var b = badgeFor(t);
    if (b) cover.appendChild(el('span', 'cs-badge ' + b.cls, b.txt));
    cover.appendChild(el('span', 'cs-badge kind', esc(t.kind.chip)));
    if (t.price) cover.appendChild(el('span', 'cs-price', esc(t.price)));
    d.appendChild(cover);
    var body = el('div', 'cs-body');
    body.appendChild(el('div', 'cs-name', esc(t.label)));
    var sub = !t.available ? (t.reason || 'Not switched on yet')
      : t.locked ? (t.lockedReason === 'sign_in' ? 'Sign in to use' : 'Above today\u2019s credit')
      : (t.role || t.kind.verb);
    body.appendChild(el('div', 'cs-sub', esc(sub)));
    d.appendChild(body);
    d.setAttribute('role', 'button');
    d.setAttribute('aria-label', t.kind.verb + ' with ' + t.label);
    d.addEventListener('click', function () {
      if (!t.available) { toast(t.reason || 'This one is not switched on yet'); return; }
      if (t.locked) { toast(sub); return; }
      if (window.sgSquadCreate && typeof window.sgSquadCreate.open === 'function') {
        window.sgSquadCreate.open(t.kind.key, '', null, { model: t.id });
      }
    });
    return d;
  }

  function dayLabel(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var now = new Date();
    var one = 24 * 3600 * 1000;
    var dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var nn = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((nn - dd) / one);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function timeLabel(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function thumb(j) {
    var t = el('div', 'cs-thumb');
    var k = kindByKey(j.kind);
    if (j.status === 'done' && j.url && j.kind === 'image') t.innerHTML = '<img alt="" loading="lazy" src="' + esc(j.url) + '">';
    else if (j.status === 'done' && j.url && (j.kind === 'video' || j.kind === 'edit')) t.innerHTML = '<video muted playsinline preload="metadata" src="' + esc(j.url) + '#t=0.1"></video>';
    else t.textContent = k ? k.icon : '✨';
    return t;
  }

  function historyRow(j) {
    var r = el('div', 'cs-row');
    r.appendChild(thumb(j));
    var rt = el('div', 'cs-rt');
    var title = j.prompt || j.text || (kindByKey(j.kind) ? kindByKey(j.kind).verb : 'Creation');
    rt.appendChild(el('b', null, esc(title)));
    rt.appendChild(el('span', null, esc([kindByKey(j.kind) ? kindByKey(j.kind).chip : j.kind, j.model, timeLabel(j.createdAt)].filter(Boolean).join(' \u00b7 '))));
    r.appendChild(rt);
    var running = j.status === 'queued' || j.status === 'running' || j.status === 'processing' || j.status === 'pending';
    var failed = j.status === 'failed' || j.status === 'error';
    if (running) r.appendChild(el('span', 'cs-state run', '<i class="cs-spin"></i>Generating'));
    else if (failed) r.appendChild(el('span', 'cs-state bad', 'Couldn\u2019t generate'));
    r.addEventListener('click', function () {
      if (failed || running) {
        /* Retry / follow: reopen the mode with the same prompt and model. */
        if (window.sgSquadCreate) window.sgSquadCreate.open(j.kind, j.prompt || '', null, { model: j.model });
        return;
      }
      if (j.kind === 'text' && window.sgSquadCreate) { window.sgSquadCreate.open('text', j.prompt || '', j.text || null, { model: j.model }); return; }
      if (j.url) window.open(j.url, '_blank', 'noopener');
    });
    return r;
  }

  /* One tap on a thumbnail opens it; a running or failed one reopens the mode. */
  function stripItem(j) {
    var t = thumb(j);
    var running = j.status === 'queued' || j.status === 'running' || j.status === 'processing' || j.status === 'pending';
    if (running) t.classList.add('run');
    t.title = j.prompt || '';
    t.addEventListener('click', function () {
      if (j.status !== 'done' || j.kind === 'text') { if (window.sgSquadCreate) window.sgSquadCreate.open(j.kind, j.prompt || '', j.text || null, { model: j.model }); return; }
      if (j.url) window.open(j.url, '_blank', 'noopener');
    });
    return t;
  }

  function renderLibrary(root, items) {
    var strip = root.querySelector('.cs-strip');
    var feed = root.querySelector('#' + ID + '-history');
    if (strip) {
      strip.innerHTML = '';
      if (lib.signedOut) strip.appendChild(el('div', 'cs-empty', 'Sign in to see what you\u2019ve made.'));
      else if (!items.length) strip.appendChild(el('div', 'cs-empty', 'Nothing yet \u2014 tap a model below to make your first one.'));
      else items.slice(0, 20).forEach(function (j) { strip.appendChild(stripItem(j)); });
    }
    if (feed) renderHistory(feed, items);
  }

  function renderHistory(host, items) {
    host.innerHTML = '';
    if (lib.signedOut) { host.appendChild(el('div', 'cs-empty', 'Sign in to see everything you\u2019ve made here \u2014 every image, clip and caption in one place.')); return; }
    if (!items.length) { host.appendChild(el('div', 'cs-empty', 'Nothing yet. Pick a model above and your creations will show up here.')); return; }
    var lastDay = null;
    items.forEach(function (j) {
      var day = dayLabel(j.createdAt);
      if (day !== lastDay) { host.appendChild(el('div', 'cs-day', esc(day))); lastDay = day; }
      host.appendChild(historyRow(j));
    });
  }

  function build() {
    var root = el('div'); root.id = ID;
    var sticky = el('div', 'cs-sticky');
    root.appendChild(sticky);
    var head = el('div', 'cs-head');
    head.appendChild(el('div', 'cs-title', 'Create'));
    /* No ✕ (task 19, owner 2026-09-30): Create is a tab, not a popup — you leave
       it with the tab bar, like Home / Shop / Chats / Profile. */
    sticky.appendChild(head);

    var libBox = el('div', 'cs-lib');
    var libHead = el('div', 'cs-sec', '<b>Library</b><span role="button">See all \u203a</span>');
    libHead.querySelector('span').addEventListener('click', function () {
      var open = libBox.classList.toggle('all');
      libHead.querySelector('span').textContent = open ? 'Less \u2039' : 'See all \u203a';
    });
    libBox.appendChild(libHead);
    libBox.appendChild(el('div', 'cs-strip', '<div class="cs-empty">Loading\u2026</div>'));
    var hist = el('div', 'cs-feed'); hist.id = ID + '-history';
    libBox.appendChild(hist);
    root.appendChild(libBox);
    loadLibrary(true).then(function (items) { renderLibrary(root, items); });

    var chips = el('div', 'cs-chips');
    var all = [{ key: 'all', chip: 'All' }].concat(KINDS);
    all.forEach(function (k) {
      var c = el('div', 'cs-chip' + (filter === k.key ? ' on' : ''), esc(k.chip));
      c.addEventListener('click', function () {
        filter = k.key;
        Array.prototype.forEach.call(chips.children, function (x) { x.classList.remove('on'); });
        c.classList.add('on');
        paintGrid(grid);
      });
      chips.appendChild(c);
    });
    root.appendChild(chips);

    var grid = el('div', 'cs-grid');
    grid.appendChild(el('div', 'cs-empty', 'Loading models\u2026'));
    root.appendChild(grid);
    paintGrid(grid);
    return root;
  }

  function paintGrid(grid) {
    loadCatalogue().then(function (tiles) {
      var list = tiles.filter(function (t) { return filter === 'all' || t.kind.key === filter; });
      grid.innerHTML = '';
      if (!list.length) { grid.appendChild(el('div', 'cs-empty', 'No models here yet.')); return; }
      list.forEach(function (t) { grid.appendChild(tile(t)); });
    });
  }

  function toast(m) { if (typeof window.sgToast === 'function') window.sgToast(m, 'info', 3000); }

  // ── visibility (the app routes without popstate; poll like the rails do) ──
  var lastPath = null;
  var histTimer = null;
  function sync() {
    var on = ROUTE.test(location.pathname);
    var root = document.getElementById(ID);
    if (location.pathname !== lastPath) { dismissed = false; lastPath = location.pathname; }
    if (!on || dismissed) {
      if (root) root.remove();
      if (histTimer) { clearInterval(histTimer); histTimer = null; }
      return;
    }
    if (!root) {
      document.body.appendChild(build());
      /* A job still running when the feed was drawn finishes in the background;
         re-read while the studio is open so the row flips to a thumbnail. */
      if (!histTimer) histTimer = setInterval(function () {
        var r = document.getElementById(ID);
        if (!r) return;
        loadLibrary(true).then(function (items) { renderLibrary(r, items); });
      }, 8000);
    }
  }

  /* When the sheet closes after a generation, the feed should already show it. */
  document.addEventListener('sg-squad-create:done', function () { var r = document.getElementById(ID); if (r) loadLibrary(true).then(function (items) { renderLibrary(r, items); }); });

  function init() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    window.addEventListener('popstate', sync);
    /* The app routes with pushState; the 800ms poll alone let the page under
       the studio show first. Sync on the same tick instead. */
    ['pushState', 'replaceState'].forEach(function (k) {
      var orig = history[k];
      if (typeof orig !== 'function') return;
      history[k] = function () { var r = orig.apply(this, arguments); try { sync(); } catch (e) {} return r; };
    });
    setInterval(sync, 800);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.sgCreateStudio = {
    refresh: function () { cat.at = 0; lib.at = 0; var r = document.getElementById(ID); if (r) { r.remove(); sync(); } },
    /* "Change model ›" on the create page (squad-create.js#openGrid): bring the
       grid up, filtered to that type, even if the creator had closed it with ×. */
    show: function (kind) {
      dismissed = false;
      filter = kindByKey(kind) ? kind : 'all';
      var r = document.getElementById(ID); if (r) r.remove();
      sync();
      var root = document.getElementById(ID); if (root) root.scrollTop = 0;
    },
  };
})();
