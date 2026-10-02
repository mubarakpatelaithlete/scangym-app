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
      var c = document.getElementById('sg-aff-copy');
      if (c) c.onclick = function () {
        var done = function () { c.textContent = 'Copied \u2713'; };
        if (navigator.clipboard) navigator.clipboard.writeText(d.refLink).then(done, done); else done();
      };
    }).catch(function () {});
  }
  var mo = new MutationObserver(function () { build(); });
  function start() { build(); mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
