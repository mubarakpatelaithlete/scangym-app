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
  }
  var mo = new MutationObserver(function () { build(); });
  function start() { build(); mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
