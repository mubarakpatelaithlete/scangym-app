/**
 * "Everything ScanGym" hub.
 *
 * Renders whatever /api/buttons returns and nothing else — no URL list lives in
 * this file. A destination that is not ready comes back without a href and is
 * rendered as a non-tappable "coming soon" tile, so the customer can see the
 * whole surface without ever hitting a dead link.
 *
 * Three destinations are client-side actions rather than links, because they
 * cannot be expressed as a URL: install (beforeinstallprompt), share
 * (navigator.share) and talk (the app's voice pill).
 */
(function () {
  'use strict';

  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
  });

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(0,0,0,.88);color:#fff;padding:11px 16px;border-radius:12px;font-size:13px;z-index:99999;max-width:88vw;text-align:center;';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  var ACTIONS = {
    install: function () {
      if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        toast('✅ ScanGym is already installed on this device.');
        return;
      }
      toast('📲 Install: browser menu → "Add to Home screen" (Android), or Share → "Add to Home Screen" (iPhone).');
    },
    share: function () {
      var data = { title: 'ScanGym', text: 'Book a gym day pass, anywhere.', url: 'https://scangym.com' };
      if (navigator.share) { navigator.share(data).catch(function () {}); return; }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(data.url).then(function () { toast('🔗 Link copied.'); });
        return;
      }
      toast('Copy this link: ' + data.url);
    },
    save: function () { location.href = '/more/passes'; },
    talk: function () { location.href = '/explore?talk=1'; },
  };

  function tile(item) {
    var isAction = item.type === 'action';
    var live = !!item.ready && (isAction || !!item.href);
    var el = document.createElement(live ? 'a' : 'div');
    el.className = 'item' + (live ? '' : ' pending');
    if (live && !isAction) {
      el.href = item.href;
      if (/^https?:/i.test(item.href)) { el.target = '_blank'; el.rel = 'noopener'; }
    }
    if (live && isAction) {
      el.href = 'javascript:void 0';
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        (ACTIONS[item.href] || function () { toast('Coming soon.'); })();
      });
    }
    el.setAttribute('aria-label', item.label + (live ? '' : ' — coming soon'));
    var name = document.createElement('div');
    name.className = 'name';
    name.innerHTML = '<span class="dot ' + (live ? 'live' : 'soon') + '"></span>';
    name.appendChild(document.createTextNode(item.label));
    el.appendChild(name);
    if (item.note) {
      var why = document.createElement('div');
      why.className = 'why';
      why.textContent = item.note;
      el.appendChild(why);
    }
    return el;
  }

  function render(data) {
    var root = document.getElementById('root');
    root.innerHTML = '';
    (data.groups || []).forEach(function (g) {
      if (!g.items || !g.items.length) return;
      var sec = document.createElement('section');
      var h = document.createElement('h2');
      h.textContent = g.name;
      sec.appendChild(h);
      var grid = document.createElement('div');
      grid.className = 'grid';
      g.items.forEach(function (i) { grid.appendChild(tile(i)); });
      sec.appendChild(grid);
      root.appendChild(sec);
    });
    var c = document.getElementById('count');
    if (c) c.textContent = data.ready + ' of ' + data.total + ' live today — the rest switch on automatically as they launch.';
  }

  fetch('/api/buttons')
    .then(function (r) { return r.json(); })
    .then(render)
    .catch(function () {
      document.getElementById('root').innerHTML =
        '<p style="color:rgba(255,255,255,.6)">Could not load right now. <a class="back" href="/explore">Go to ScanGym</a></p>';
    });
})();
