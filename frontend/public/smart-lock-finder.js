/* ═══════════════════════════════════════════════════════════════════════════
   SMART LOCK FINDER — "Find Your Lock System" wizard for gym owners
   ═══════════════════════════════════════════════════════════════════════════
   Replaces the confusing "Connect Seam Account" sheet with a visual
   brand picker. Gym owners see recognisable lock brands and connect
   with one tap — no need to know what Seam is.

   Injected via <script src="/smart-lock-finder.js"></script> in partner
   pages (partner/index.html, gympartners-dashboard).

   Flow:
     1. Owner taps 🔐 Access / Smart Lock in the Partner tab
     2. This script opens a bottom-sheet with visual brand cards
     3. Owner picks their lock brand (or "Not sure?")
     4. → Seam Connect Webview (for Seam-routed brands)
     5. → Direct API form (for Kisi / GymMaster)
     6. → Done! Gym is connected.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
'use strict';

// ── CSS ─────────────────────────────────────────────────────────────
if (!document.getElementById('slf-css')) {
  var s = document.createElement('style'); s.id = 'slf-css';
  s.textContent = ''
    + '.slf-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}'
    + '@media(min-width:600px){.slf-grid{grid-template-columns:1fr 1fr 1fr}}'
    + '.slf-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px 12px;cursor:pointer;transition:.2s;position:relative;text-align:center}'
    + '.slf-card:hover{border-color:rgba(255,109,0,.35);background:rgba(255,109,0,.04)}'
    + '.slf-card:active{transform:scale(.96)}'
    + '.slf-card.selected{border-color:#FF6D00;background:rgba(255,109,0,.1);box-shadow:0 0 0 2px rgba(255,109,0,.25)}'
    + '.slf-logo{font-size:32px;margin-bottom:6px;display:block}'
    + '.slf-name{font-size:13px;font-weight:700;color:#fff;margin-bottom:2px}'
    + '.slf-desc{font-size:10px;color:rgba(255,255,255,.4);line-height:1.3}'
    + '.slf-tag{position:absolute;top:8px;right:8px;font-size:8px;padding:2px 6px;border-radius:4px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}'
    + '.slf-tag-popular{background:rgba(255,109,0,.2);color:#FF6D00}'
    + '.slf-tag-seam{background:rgba(59,130,246,.15);color:#60a5fa}'
    + '.slf-tag-direct{background:rgba(34,197,94,.15);color:#22c55e}'
    + '.slf-tag-gym{background:rgba(168,85,247,.15);color:#c084fc}'
    + '.slf-section{font-size:12px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.8px;margin:18px 0 8px;padding-left:2px}'
    + '.slf-features{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;justify-content:center}'
    + '.slf-feat{font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.5)}'
    + '.slf-help{display:flex;align-items:center;gap:12px;padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;cursor:pointer;transition:.15s;margin-top:10px}'
    + '.slf-help:hover{border-color:rgba(255,109,0,.2);background:rgba(255,109,0,.03)}'
    + '.slf-help-icon{font-size:24px;flex-shrink:0}'
    + '.slf-help-text{flex:1}'
    + '.slf-help-title{font-size:13px;font-weight:700;color:#fff}'
    + '.slf-help-sub{font-size:11px;color:rgba(255,255,255,.4);margin-top:1px}'
    + '.slf-arrow{color:rgba(255,255,255,.2);font-size:18px;flex-shrink:0}'
    + '.slf-form-group{margin-bottom:14px}'
    + '.slf-label{display:block;font-size:11px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}'
    + '.slf-input{width:100%;padding:12px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;transition:.2s}'
    + '.slf-input:focus{border-color:#FF6D00;box-shadow:0 0 0 3px rgba(255,109,0,.15)}'
    + '.slf-input::placeholder{color:rgba(255,255,255,.25)}'
    + '.slf-btn{width:100%;padding:14px;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;border:none;transition:.2s;text-align:center}'
    + '.slf-btn:active{transform:scale(.97)}'
    + '.slf-btn-primary{background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;box-shadow:0 4px 20px rgba(255,109,0,.3)}'
    + '.slf-btn-primary:disabled{opacity:.4;cursor:not-allowed;transform:none}'
    + '.slf-btn-secondary{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff}'
    + '.slf-toast{position:fixed;top:20px;right:20px;padding:14px 22px;border-radius:14px;font-weight:700;font-size:13px;z-index:10000;animation:slfSlideIn .3s;box-shadow:0 4px 24px rgba(0,0,0,.4)}'
    + '.slf-toast.success{background:#22c55e;color:#fff}'
    + '.slf-toast.error{background:#ef4444;color:#fff}'
    + '@keyframes slfSlideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}'
    + '.slf-spinner{width:20px;height:20px;border:2px solid rgba(255,255,255,.15);border-top-color:#FF6D00;border-radius:50%;animation:slfSpin .7s linear infinite;display:inline-block;vertical-align:middle;margin-right:8px}'
    + '@keyframes slfSpin{to{transform:rotate(360deg)}}'
    ;
  document.head.appendChild(s);
}

// ── Toast helper ────────────────────────────────────────────────────
function _slfToast(msg, type, ms) {
  var t = document.createElement('div');
  t.className = 'slf-toast ' + (type || 'success');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, ms || 3500);
}

// ── Provider catalogue (matches backend /api/access/owner/systems) ─
var PROVIDERS = [
  // Popular / Direct
  { id:'kisi',       name:'Kisi',                    logo:'🔐', desc:'QR code door unlock — best for gyms',            conn:'direct', pop:true,  tag:'Popular',  tagClass:'slf-tag-popular' },
  { id:'salto',      name:'Salto KS',                logo:'🏢', desc:'Cloud smart locks — UK/EU gyms',                 conn:'seam',   pop:true,  tag:'Popular',  tagClass:'slf-tag-popular' },
  { id:'brivo',      name:'Brivo',                    logo:'🔑', desc:'Enterprise cloud access — US gyms',              conn:'seam',   pop:true,  tag:'Popular',  tagClass:'slf-tag-popular' },
  { id:'ttlock',     name:'TTLock / Sifely',          logo:'🔒', desc:'Budget-friendly smart locks — PIN codes',        conn:'seam',   pop:true,  tag:'Popular',  tagClass:'slf-tag-popular' },
  // Via Seam
  { id:'latch',      name:'Latch',                    logo:'🚪', desc:'Smart access for multi-tenant buildings',        conn:'seam',   pop:false, tag:'Via Seam', tagClass:'slf-tag-seam' },
  { id:'avigilon',   name:'Avigilon Alta / Openpath', logo:'📱', desc:'Touchless wave-to-unlock mobile access',         conn:'seam',   pop:false, tag:'Via Seam', tagClass:'slf-tag-seam' },
  { id:'akiles',     name:'Akiles',                   logo:'🇪🇸', desc:'Smart access — popular in Spain',               conn:'seam',   pop:false, tag:'Via Seam', tagClass:'slf-tag-seam' },
  { id:'igloohome',  name:'igloohome',                logo:'🏔️', desc:'Offline-capable — works without WiFi',          conn:'seam',   pop:false, tag:'Via Seam', tagClass:'slf-tag-seam' },
  // Gym software
  { id:'gymmaster',  name:'GymMaster',                logo:'🏋️', desc:'All-in-one gym software + door access',         conn:'direct', pop:true,  tag:'Gym Software', tagClass:'slf-tag-gym' },
  // Catch-all
  { id:'seam',       name:'Other Lock (30+ brands)',  logo:'🔗', desc:'August, Yale, Schlage, Nuki, and more',          conn:'seam',   pop:false, tag:'Auto-detect', tagClass:'slf-tag-seam' },
];

// ── Get gym ID helper ───────────────────────────────────────────────
async function _slfGetGymId() {
  if (window._partnerGymId) return window._partnerGymId;
  try {
    var r = await fetch('/api/gym-partner/dashboard', { credentials: 'include' });
    var d = await r.json();
    if (d.gyms && d.gyms.length > 0) {
      window._partnerGymId = d.gyms[0].id;
      return d.gyms[0].id;
    }
  } catch (e) {}
  return null;
}

// ═════════════════════════════════════════════════════════════════════
// MAIN ENTRY: Smart Lock Finder sheet
// ═════════════════════════════════════════════════════════════════════

window._partnerConnectSeam = function () {
  window._slfOpenFinder();
};

window._slfOpenFinder = function () {
  var u = (typeof state !== 'undefined' && state) ? state.user : null;
  if (!u) {
    if (typeof sgToast === 'function') sgToast('Sign in to connect your lock system', 'info', 2000);
    if (typeof window._sgShowAuthSheet === 'function') window._sgShowAuthSheet('book');
    else if (typeof navigate === 'function') navigate('/login');
    return;
  }

  // Build the provider grid
  var popularCards = '';
  var seamCards = '';
  var otherCards = '';

  PROVIDERS.forEach(function (p) {
    var card = '<div class="slf-card" onclick="window._slfSelectProvider(\'' + p.id + '\')" data-slf-id="' + p.id + '">'
      + (p.tag ? '<span class="slf-tag ' + p.tagClass + '">' + p.tag + '</span>' : '')
      + '<span class="slf-logo">' + p.logo + '</span>'
      + '<div class="slf-name">' + p.name + '</div>'
      + '<div class="slf-desc">' + p.desc + '</div>'
      + '</div>';

    if (p.pop) popularCards += card;
    else if (p.conn === 'seam' && p.id !== 'seam') seamCards += card;
    else otherCards += card;
  });

  var html = ''
    + '<div style="text-align:center;margin-bottom:16px">'
    + '<div style="font-size:40px;margin-bottom:8px">🔐</div>'
    + '<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Find Your Lock System</h2>'
    + '<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Tap the brand you use — visitors will get auto door access</p>'
    + '</div>'

    // Popular
    + '<div class="slf-section">⭐ Popular</div>'
    + '<div class="slf-grid">' + popularCards + '</div>'

    // More brands
    + (seamCards ? '<div class="slf-section">🔗 More Brands (via Seam)</div>'
      + '<div class="slf-grid">' + seamCards + '</div>' : '')

    // Other / catch-all
    + '<div class="slf-grid">' + otherCards + '</div>'

    // Help options
    + '<div class="slf-help" onclick="window._slfNotSure()">'
    + '<div class="slf-help-icon">🤔</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Not sure what you have?</div><div class="slf-help-sub">We\'ll help you identify your lock system</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfNoLock()">'
    + '<div class="slf-help-icon">👤</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">No smart lock / Staff at front desk</div><div class="slf-help-sub">Visitors show QR code — staff verifies</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>';

  // Open the sheet — use the ScanGym sheet system if available, else fallback
  if (typeof _sgOpenSheet === 'function') {
    _sgOpenSheet('slf-finder-sheet', html);
  } else if (typeof _ctaOpenSheet === 'function') {
    _ctaOpenSheet(html);
  } else {
    // Full-page fallback
    window.location.href = '/gympartners-dashboard/connect-access';
  }
};

// ═════════════════════════════════════════════════════════════════════
// Provider selected → route to correct connection flow
// ═════════════════════════════════════════════════════════════════════

window._slfSelectProvider = async function (providerId) {
  var gymId = await _slfGetGymId();
  if (!gymId) {
    _slfToast('Claim a gym first before connecting a lock system', 'error');
    return;
  }

  var provider = PROVIDERS.find(function (p) { return p.id === providerId; });
  if (!provider) return;

  // Route based on connection type
  switch (providerId) {
    case 'kisi':
      _slfShowKisiForm(gymId);
      break;
    case 'gymmaster':
      _slfShowGymMasterForm(gymId);
      break;
    case 'manual':
      _slfSetManual(gymId);
      break;
    default:
      // All Seam-routed providers → Seam Connect Webview
      _slfStartSeamConnect(gymId, providerId, provider.name);
      break;
  }
};

// ═════════════════════════════════════════════════════════════════════
// Seam Connect Webview (for Seam-routed brands)
// ═════════════════════════════════════════════════════════════════════

async function _slfStartSeamConnect(gymId, providerId, providerName) {
  var closeSheet = typeof _sgCloseSheet === 'function' ? _sgCloseSheet
    : typeof _ctaCloseSheet === 'function' ? _ctaCloseSheet : function () {};

  _slfToast('Connecting ' + providerName + '…', 'success', 2000);

  try {
    var r = await fetch('/api/access/owner/create-connect-webview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ gymId: gymId }),
    });
    var d = await r.json();
    var url = d.url || d.connectUrl || d.connect_url;

    if (url) {
      closeSheet();
      // Open in new tab or iframe
      window.open(url, '_blank');
      _slfToast('Complete ' + providerName + ' login in the new tab ✅', 'success', 5000);

      // Poll for completion in background
      if (d.connect_webview_id) {
        _slfPollSeamComplete(gymId, d.connect_webview_id, providerName);
      }
    } else {
      // Fallback: try direct connect endpoint
      var r2 = await fetch('/api/access/owner/connect-seam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gymId: gymId }),
      });
      var d2 = await r2.json();
      if (d2.connected) {
        closeSheet();
        _slfToast(providerName + ' connected! ✅', 'success', 4000);
      } else {
        _slfToast(d2.error || 'Could not connect — try again', 'error', 4000);
      }
    }
  } catch (ex) {
    _slfToast('Connection failed — check your internet', 'error', 3000);
  }
}

// Poll Seam Connect Webview for completion
async function _slfPollSeamComplete(gymId, webviewId, providerName) {
  var attempts = 0;
  var maxAttempts = 60; // 3 minutes
  var poll = setInterval(async function () {
    attempts++;
    if (attempts > maxAttempts) { clearInterval(poll); return; }
    try {
      var r = await fetch('/api/access/owner/complete-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gymId: gymId, connectWebviewId: webviewId }),
      });
      var d = await r.json();
      if (d.connected) {
        clearInterval(poll);
        _slfToast('🎉 ' + providerName + ' connected! Visitors will get auto door access.', 'success', 5000);
      }
    } catch (e) {}
  }, 3000);
}

// ═════════════════════════════════════════════════════════════════════
// Kisi Direct — API key form
// ═════════════════════════════════════════════════════════════════════

function _slfShowKisiForm(gymId) {
  var html = ''
    + '<div style="text-align:center;margin-bottom:16px">'
    + '<div style="font-size:40px;margin-bottom:8px">🔐</div>'
    + '<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Connect Kisi</h2>'
    + '<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">QR code unlock — no app needed for visitors</p>'
    + '</div>'

    + '<div class="slf-form-group">'
    + '<label class="slf-label">Kisi API Key</label>'
    + '<input id="slf-kisi-key" class="slf-input" type="text" placeholder="Paste your API key from Kisi dashboard">'
    + '</div>'

    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;margin-bottom:16px">'
    + '<div style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.5">'
    + '📋 <strong>Where to find it:</strong> Log into <a href="https://web.kisi.io" target="_blank" style="color:#FF6D00">web.kisi.io</a> → Organization Settings → API → Create API key'
    + '</div>'
    + '</div>'

    + '<button id="slf-kisi-btn" class="slf-btn slf-btn-primary" onclick="window._slfConnectKisi(' + gymId + ')">Connect Kisi →</button>'
    + '<button class="slf-btn slf-btn-secondary" style="margin-top:8px" onclick="window._slfOpenFinder()">← Back to brands</button>';

  if (typeof _sgOpenSheet === 'function') _sgOpenSheet('slf-kisi-sheet', html);
  else if (typeof _ctaOpenSheet === 'function') _ctaOpenSheet(html);
  setTimeout(function () { var el = document.getElementById('slf-kisi-key'); if (el) el.focus(); }, 400);
}

window._slfConnectKisi = async function (gymId) {
  var key = (document.getElementById('slf-kisi-key') || {}).value;
  if (!key || key.trim().length < 10) { _slfToast('Please enter a valid Kisi API key', 'error'); return; }

  var btn = document.getElementById('slf-kisi-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="slf-spinner"></span> Connecting…'; }

  try {
    var r = await fetch('/api/access/owner/connect-kisi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ gymId: gymId, kisiApiKey: key.trim() }),
    });
    var d = await r.json();
    if (d.connected) {
      var closeSheet = typeof _sgCloseSheet === 'function' ? _sgCloseSheet
        : typeof _ctaCloseSheet === 'function' ? _ctaCloseSheet : function () {};
      closeSheet();
      _slfToast('🎉 Kisi connected! Visitors get QR code door access.', 'success', 5000);
    } else {
      _slfToast(d.error || 'Connection failed — check your API key', 'error', 4000);
      if (btn) { btn.disabled = false; btn.textContent = 'Connect Kisi →'; }
    }
  } catch (ex) {
    _slfToast('Connection failed — try again', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Connect Kisi →'; }
  }
};

// ═════════════════════════════════════════════════════════════════════
// GymMaster Direct — site name + API key form
// ═════════════════════════════════════════════════════════════════════

function _slfShowGymMasterForm(gymId) {
  var html = ''
    + '<div style="text-align:center;margin-bottom:16px">'
    + '<div style="font-size:40px;margin-bottom:8px">🏋️</div>'
    + '<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Connect GymMaster</h2>'
    + '<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Visit logging + swipe validation via Gatekeeper API</p>'
    + '</div>'

    + '<div class="slf-form-group">'
    + '<label class="slf-label">GymMaster Site Name</label>'
    + '<input id="slf-gm-site" class="slf-input" type="text" placeholder="e.g. mygym (from mygym.gymmasteronline.com)">'
    + '</div>'

    + '<div class="slf-form-group">'
    + '<label class="slf-label">Gatekeeper API Key</label>'
    + '<input id="slf-gm-key" class="slf-input" type="text" placeholder="Found in Settings > Integrations > Gatekeeper API">'
    + '</div>'

    + '<div style="background:rgba(168,85,247,.06);border:1px solid rgba(168,85,247,.15);border-radius:12px;padding:12px;margin-bottom:16px">'
    + '<div style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.5">'
    + '📋 <strong>Where to find these:</strong> Log into GymMaster → Settings → Integrations → Gatekeeper API. '
    + 'Your site name is the subdomain (e.g. <em>mygym</em>.gymmasteronline.com).'
    + '</div>'
    + '</div>'

    + '<div style="background:rgba(255,109,0,.06);border:1px solid rgba(255,109,0,.12);border-radius:12px;padding:12px;margin-bottom:16px">'
    + '<div style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.5">'
    + '⚠️ <strong>Note:</strong> Day-pass PIN auto-issuance is coming soon. '
    + 'For now, GymMaster gyms use QR staff verification + visit logging so attendance stays accurate.'
    + '</div>'
    + '</div>'

    + '<button id="slf-gm-btn" class="slf-btn slf-btn-primary" onclick="window._slfConnectGymMaster(' + gymId + ')">Connect GymMaster →</button>'
    + '<button class="slf-btn slf-btn-secondary" style="margin-top:8px" onclick="window._slfOpenFinder()">← Back to brands</button>';

  if (typeof _sgOpenSheet === 'function') _sgOpenSheet('slf-gm-sheet', html);
  else if (typeof _ctaOpenSheet === 'function') _ctaOpenSheet(html);
  setTimeout(function () { var el = document.getElementById('slf-gm-site'); if (el) el.focus(); }, 400);
}

window._slfConnectGymMaster = async function (gymId) {
  var site = (document.getElementById('slf-gm-site') || {}).value;
  var key = (document.getElementById('slf-gm-key') || {}).value;
  if (!site || !key) { _slfToast('Please fill in both fields', 'error'); return; }

  var btn = document.getElementById('slf-gm-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="slf-spinner"></span> Testing connection…'; }

  try {
    // Use the configure endpoint to store GymMaster creds
    var r = await fetch('/api/access/owner/connect-gymmaster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        gymId: gymId,
        gmSite: site.trim(),
        gmApiKey: key.trim(),
      }),
    });
    var d = await r.json();
    if (d.connected) {
      var closeSheet = typeof _sgCloseSheet === 'function' ? _sgCloseSheet
        : typeof _ctaCloseSheet === 'function' ? _ctaCloseSheet : function () {};
      closeSheet();
      _slfToast('🎉 GymMaster connected! Visit logging is active.', 'success', 5000);
    } else {
      _slfToast(d.error || 'Connection failed — check your credentials', 'error', 4000);
      if (btn) { btn.disabled = false; btn.textContent = 'Connect GymMaster →'; }
    }
  } catch (ex) {
    _slfToast('Connection failed — try again', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Connect GymMaster →'; }
  }
};

// ═════════════════════════════════════════════════════════════════════
// Manual / No smart lock
// ═════════════════════════════════════════════════════════════════════

window._slfNoLock = async function () {
  var gymId = await _slfGetGymId();
  if (!gymId) { _slfToast('Claim a gym first', 'error'); return; }
  _slfSetManual(gymId);
};

async function _slfSetManual(gymId) {
  try {
    await fetch('/api/access/owner/configure/' + gymId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accessType: 'staff_verify' }),
    });
    var closeSheet = typeof _sgCloseSheet === 'function' ? _sgCloseSheet
      : typeof _ctaCloseSheet === 'function' ? _ctaCloseSheet : function () {};
    closeSheet();
    _slfToast('✅ Staff verification mode set — visitors show QR at reception.', 'success', 4000);
  } catch (e) {
    _slfToast('Failed to update — try again', 'error');
  }
}

// ═════════════════════════════════════════════════════════════════════
// "Not sure?" — visual lock identification helper
// ═════════════════════════════════════════════════════════════════════

window._slfNotSure = function () {
  var html = ''
    + '<div style="text-align:center;margin-bottom:16px">'
    + '<div style="font-size:40px;margin-bottom:8px">🤔</div>'
    + '<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Identify Your Lock</h2>'
    + '<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Answer a few questions to find your system</p>'
    + '</div>'

    // Question 1: What does your door entry look like?
    + '<div class="slf-section">What does your gym door entry look like?</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'kisi\')">'
    + '<div class="slf-help-icon">📱</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Tablet/reader on the wall with QR scanner</div><div class="slf-help-sub">Likely Kisi — tap to connect</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'salto\')">'
    + '<div class="slf-help-icon">🔢</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Keypad with PIN entry on the door handle</div><div class="slf-help-sub">Likely Salto or TTLock — tap to connect</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'brivo\')">'
    + '<div class="slf-help-icon">💳</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Card reader / fob tap next to the door</div><div class="slf-help-sub">Likely Brivo or Avigilon — tap to connect</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'gymmaster\')">'
    + '<div class="slf-help-icon">🏋️</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">We use GymMaster gym software for check-ins</div><div class="slf-help-sub">GymMaster Gatekeeper API — tap to connect</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'seam\')">'
    + '<div class="slf-help-icon">🔗</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Something else / I have an app for it</div><div class="slf-help-sub">Auto-detect via Seam (30+ brands supported)</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfNoLock()">'
    + '<div class="slf-help-icon">🚪</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">No smart lock — staff handles the door</div><div class="slf-help-sub">Visitors show QR code at reception</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<button class="slf-btn slf-btn-secondary" style="margin-top:12px" onclick="window._slfOpenFinder()">← Back to brands</button>';

  if (typeof _sgOpenSheet === 'function') _sgOpenSheet('slf-identify-sheet', html);
  else if (typeof _ctaOpenSheet === 'function') _ctaOpenSheet(html);
};

})();
