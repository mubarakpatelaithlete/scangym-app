/* Task 154 Profile 6 + 9: an Account section at the end of Edit Profile —
   Orders, Refund policy, Privacy, Help, Log out and Delete account (app store
   requirement). Delete sends a request to bookings@scangym.com (owner,
   2026-10-02); support confirms and removes the account. Kept out of
   app.ctr576.js, whose size budget is nearly full. */
(function () {
  var MAIL = 'bookings@scangym.com';
  function row(icon, label, attrs, color) {
    return '<a ' + attrs + ' style="display:flex;align-items:center;gap:12px;padding:13px 4px;border-bottom:1px solid rgba(255,255,255,.06);color:' + (color || '#fff') + ';text-decoration:none;font-size:14px;font-weight:600;cursor:pointer"><span style="width:22px;text-align:center">' + icon + '</span><span style="flex:1">' + label + '</span><span style="color:rgba(255,255,255,.3)">\u203a</span></a>';
  }
  function who() { var u = window.state && window.state.user; return u ? (u.email || u.phone || ('user ' + u.id)) : ''; }
  function build() {
    var save = document.getElementById('pf-save-btn');
    if (!save || document.getElementById('sg-account-sec')) return;
    var sub = encodeURIComponent('Delete my ScanGym account');
    var body = encodeURIComponent('Please delete my ScanGym account and personal data.\nAccount: ' + who() + '\n');
    var box = document.createElement('div');
    box.id = 'sg-account-sec';
    box.style.cssText = 'margin-top:24px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:6px 16px';
    box.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;padding:12px 0 4px">Account</div>'
      + row('\uD83D\uDCCB', 'My bookings', 'onclick="navigate(\'/bookings\')"')
      + row('\uD83D\uDCB0', 'Wallet & withdraw', 'onclick="navigate(\'/wallet\')"')
      + row('\uD83D\uDCE6', 'Shop orders & downloads', 'onclick="navigate(\'/shop\');setTimeout(function(){window._sgShopOpenOrders&&window._sgShopOpenOrders()},900)"')
      + '<div style="color:rgba(255,255,255,.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;padding:16px 0 4px">Help & legal</div>'
      + row('\u2709\uFE0F', 'Help: ' + MAIL, 'href="mailto:' + MAIL + '?subject=' + encodeURIComponent('ScanGym help') + '"')
      + row('\u21A9\uFE0F', 'Refund policy', 'href="/refunds" target="_blank"')
      + row('\uD83D\uDD12', 'Privacy policy', 'href="/privacy" target="_blank"')
      + row('\uD83D\uDEAA', 'Log out', 'id="sg-acct-logout" onclick="window.handleLogout&&window.handleLogout()"')
      + row('\uD83D\uDDD1\uFE0F', 'Delete account', 'id="sg-acct-delete" href="mailto:' + MAIL + '?subject=' + sub + '&body=' + body + '" onclick="return confirm(\'Delete your ScanGym account? This opens an email to ' + MAIL + '. We confirm and delete your account and data within 30 days.\')"', '#f87171');
    var host = save.parentNode;
    host.insertBefore(box, save.nextSibling);
    creations(box);
    topCard();
    connected(box);
  }
  /* Task 154 Profile 4 / Task 115: every connected account in one place, connect once, status ticks. */
  function connected(box) {
    var j = function (r) { return r.ok ? r.json() : null; };
    Promise.all([fetch('/api/post-everywhere/apps').then(j).catch(function () { return null; }),
      fetch('/api/post-everywhere/accounts', { credentials: 'include' }).then(j).catch(function () { return null; })]).then(function (r) {
      var apps = (r[0] && r[0].apps) || [];
      if (!apps.length || document.getElementById('sg-conn-sec') || !box.parentNode) return;
      var mine = {}; ((r[1] && r[1].accounts) || []).forEach(function (a) { mine[a.app] = a; });
      var sec = document.createElement('div');
      sec.id = 'sg-conn-sec';
      sec.style.cssText = 'margin-top:24px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:6px 16px';
      sec.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;padding:12px 0 4px">\uD83D\uDD17 Connected accounts</div>'
        + apps.map(function (a) {
          var m = mine[a.slug];
          return '<div style="display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid rgba(255,255,255,.06)"><span style="flex:1;color:#fff;font-size:14px;font-weight:600">' + esc(a.name) + (m && m.name ? ' <span style="color:rgba(255,255,255,.45);font-weight:400;font-size:12px">' + esc(m.name) + '</span>' : '') + '</span>'
            + (m ? '<span style="color:' + (m.healthy === false ? '#fbbf24' : '#86efac') + ';font-size:13px;font-weight:700">' + (m.healthy === false ? '\u26A0 Reconnect' : '\u2705 Connected') + '</span>'
              : '<button type="button" data-app="' + esc(a.slug) + '" class="sg-conn-go" style="border:0;border-radius:12px;padding:7px 12px;background:#FF6D00;color:#fff;font-weight:800;font-size:12px;cursor:pointer">Connect</button>') + '</div>';
        }).join('') + '<p style="margin:8px 0 10px;color:rgba(255,255,255,.45);font-size:11px">Connect once \u2014 1-tap Post sends your creations everywhere.</p>';
      box.parentNode.insertBefore(sec, box);
      Array.prototype.forEach.call(sec.querySelectorAll('.sg-conn-go'), function (b) { b.addEventListener('click', function () {
        b.disabled = true; b.textContent = '\u2026';
        fetch('/api/post-everywhere/connect', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: b.dataset.app }) })
          .then(j).then(function (d) { if (d && d.url) location.href = d.url; else { b.disabled = false; b.textContent = 'Connect'; if (window.sgToast) window.sgToast((d && d.error) || 'Could not connect right now'); } })
          .catch(function () { b.disabled = false; b.textContent = 'Connect'; });
      }); });
    });
  }
  /* Task 154 Profile 1: clear top section — photo, name, followers, earnings, creations. */
  function topCard() {
    var msg = document.getElementById('profile-msg');
    var u = window.state && window.state.user;
    if (!msg || !u || document.getElementById('sg-top-card')) return;
    var name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || (u.email || 'You');
    var pic = u.profile_image || u.avatar_url || u.picture || '';
    var c = document.createElement('div');
    c.id = 'sg-top-card';
    c.style.cssText = 'display:flex;align-items:center;gap:14px;margin:0 0 16px;padding:14px 16px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)';
    c.innerHTML = '<div style="flex:none;width:58px;height:58px;border-radius:50%;overflow:hidden;background:#FF6D00;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:24px">'
      + (pic ? '<img src="' + esc(pic) + '" alt="" style="width:100%;height:100%;object-fit:cover">' : esc(name.charAt(0).toUpperCase())) + '</div>'
      + '<div style="flex:1;min-width:0"><div style="color:#fff;font-size:17px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(name) + '</div>'
      + '<div id="sg-top-handle" style="color:rgba(255,255,255,.5);font-size:12px"></div>'
      + '<div style="display:flex;gap:16px;margin-top:6px">' + stat('sg-top-f', 'Followers') + stat('sg-top-e', 'Earnings') + stat('sg-top-c', 'Creations') + '</div></div>';
    msg.parentNode.insertBefore(c, msg);
    function set(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
    var j = function (r) { return r.ok ? r.json() : null; };
    fetch('/api/reels/social/me-stats', { credentials: 'include' }).then(j).then(function (d) { if (d) { set('sg-top-f', d.followers || 0); if (d.handle) set('sg-top-handle', '@' + d.handle); } }).catch(function () {});
    fetch('/api/wallet', { credentials: 'include' }).then(j).then(function (d) { if (d && d.balance != null) set('sg-top-e', '\u00a3' + Number(d.balance).toFixed(2)); }).catch(function () {});
    fetch('/api/squad-create/library?limit=100', { credentials: 'include' }).then(j).then(function (d) { if (d) set('sg-top-c', (d.items || []).filter(function (x) { return x.status === 'done'; }).length); }).catch(function () {});
  }
  function stat(id, label) {
    return '<div><div id="' + id + '" style="color:#fff;font-size:15px;font-weight:800">\u2013</div><div style="color:rgba(255,255,255,.45);font-size:11px">' + label + '</div></div>';
  }
  /* Task 154 Profile 5 + 8: My creations grid (like Instagram) and the
     affiliate link card, both from /api/squad-create/library. */
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function creations(before) {
    fetch('/api/squad-create/library?limit=12', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || document.getElementById('sg-creations-sec') || !before.parentNode) return;
      var items = (d.items || []).filter(function (j) { return j.status === 'done' && j.url && (j.kind === 'image' || j.kind === 'video'); }).slice(0, 9);
      var sec = document.createElement('div');
      sec.id = 'sg-creations-sec';
      sec.style.cssText = 'margin-top:24px';
      var h = '';
      if (d.refLink) {
        h += '<div style="background:rgba(168,85,247,.08);border:1px solid rgba(168,85,247,.25);border-radius:20px;padding:14px 16px;margin-bottom:16px">'
          + '<div style="color:#c084fc;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">\uD83D\uDCB8 Your affiliate link</div>'
          + '<div style="display:flex;gap:8px;align-items:center"><span style="flex:1;min-width:0;color:#fff;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(d.refLink) + '</span>'
          + '<button type="button" id="sg-aff-copy" style="flex:none;border:0;border-radius:12px;padding:8px 14px;background:#a855f7;color:#fff;font-weight:800;font-size:13px;cursor:pointer">Copy</button></div>'
          + '<p style="margin:6px 0 0;color:rgba(255,255,255,.45);font-size:11px">You earn when people join or buy from your link.</p></div>';
      }
      h += '<div style="color:rgba(255,255,255,.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">\u2728 My creations</div>';
      h += items.length
        ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">' + items.map(function (j) {
            var u = esc(j.url);
            return '<a href="' + u + '" target="_blank" rel="noopener" style="position:relative;display:block;aspect-ratio:9/16;border-radius:8px;overflow:hidden;background:#111">'
              + (j.kind === 'video' ? '<video src="' + u + '#t=0.1" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover"></video><span style="position:absolute;bottom:4px;left:6px;color:#fff;font-size:11px">\u25B6</span>'
                : '<img src="' + u + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">') + '</a>';
          }).join('') + '</div>'
        : '<p style="margin:0;color:rgba(255,255,255,.5);font-size:13px">Nothing yet. <a onclick="navigate(\'/create\')" style="color:#FF6D00;cursor:pointer">Make your first creation \u203a</a></p>';
      sec.innerHTML = h;
      before.parentNode.insertBefore(sec, before);
      myPosts(sec);
      var c = document.getElementById('sg-aff-copy');
      if (c) c.onclick = function () {
        var done = function () { c.textContent = 'Copied \u2713'; };
        if (navigator.clipboard) navigator.clipboard.writeText(d.refLink).then(done, done); else done();
      };
    }).catch(function () {});
  }
  /* Task 160/161: "is it in my studio?" — videos you posted to ScanGym Home,
     each with the Shop product it sells. */
  function myPosts(sec) {
    fetch('/api/post-everywhere/mine', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || document.getElementById('sg-posts-sec')) return;
      var ps = d.posts || [];
      var box = document.createElement('div');
      box.id = 'sg-posts-sec';
      box.style.cssText = 'margin-bottom:16px';
      var h = '<div style="color:rgba(255,255,255,.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">\uD83C\uDFAC My posts on ScanGym (' + ps.length + ')</div>';
      h += ps.length
        ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">' + ps.slice(0, 9).map(function (p) {
            var u = esc(p.url);
            return '<a href="/reels?v=' + p.id + '" style="position:relative;display:block;aspect-ratio:9/16;border-radius:8px;overflow:hidden;background:#111">'
              + '<video src="' + u + '#t=0.1" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover"></video>'
              + '<span style="position:absolute;top:4px;left:6px;font-size:10px;font-weight:800;color:#fff;background:rgba(34,197,94,.85);border-radius:8px;padding:1px 6px">' + (p.live ? 'Live' : 'Hidden') + '</span>'
              + (p.product ? '<span style="position:absolute;bottom:4px;left:4px;right:4px;font-size:10px;font-weight:800;color:#fff;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border-radius:8px;padding:2px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\uD83D\uDECD\uFE0F ' + esc(p.product.price) + ' ' + esc(p.product.title) + '</span>' : '')
              + '</a>';
          }).join('') + '</div>'
        : '<p style="margin:0;color:rgba(255,255,255,.5);font-size:13px">Nothing posted yet. Make something in Create and tap \uD83D\uDE80 Post.</p>';
      box.innerHTML = h;
      sec.insertBefore(box, sec.firstChild);
    }).catch(function () {});
  }
  var mo = new MutationObserver(function () { build(); });
  function start() { build(); mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
