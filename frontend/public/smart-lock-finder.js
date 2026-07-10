/* ═══════════════════════════════════════════════════════════════════════════
   SMART LOCK FINDER v2 — "Find Your Lock System" wizard for gym owners
   ═══════════════════════════════════════════════════════════════════════════
   Complete catalogue of smart lock & access control brands with open APIs.
   Gym owners pick their brand → connect in one tap.

   Connection types:
     direct → Custom form (QR access API key, GymMaster site+key)
     seam   → Seam Connect Webview (auto-detect via 60+ brands)
     request → "Request Integration" (we log interest + reach out)

   Injected via <script src="/smart-lock-finder.js"></script>
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
    + '.slf-card.slf-hidden{display:none}'
    + '.slf-logo{font-size:32px;margin-bottom:6px;display:block}'
    + '.slf-name{font-size:13px;font-weight:700;color:#fff;margin-bottom:2px}'
    + '.slf-desc{font-size:10px;color:rgba(255,255,255,.4);line-height:1.3}'
    + '.slf-tag{position:absolute;top:8px;right:8px;font-size:8px;padding:2px 6px;border-radius:4px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}'
    + '.slf-tag-popular{background:rgba(255,109,0,.2);color:#FF6D00}'
    + '.slf-tag-seam{background:rgba(59,130,246,.15);color:#60a5fa}'
    + '.slf-tag-direct{background:rgba(34,197,94,.15);color:#22c55e}'
    + '.slf-tag-gym{background:rgba(168,85,247,.15);color:#c084fc}'
    + '.slf-tag-request{background:rgba(251,191,36,.15);color:#fbbf24}'
    + '.slf-tag-new{background:rgba(16,185,129,.2);color:#34d399}'
    + '.slf-section{font-size:12px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.8px;margin:18px 0 8px;padding-left:2px}'
    + '.slf-section.slf-hidden{display:none}'
    + '.slf-search-wrap{position:relative;margin-bottom:16px}'
    + '.slf-search{width:100%;padding:12px 14px 12px 40px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;transition:.2s}'
    + '.slf-search:focus{border-color:#FF6D00;box-shadow:0 0 0 3px rgba(255,109,0,.15)}'
    + '.slf-search::placeholder{color:rgba(255,255,255,.25)}'
    + '.slf-search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:16px;color:rgba(255,255,255,.3);pointer-events:none}'
    + '.slf-no-results{text-align:center;padding:24px;color:rgba(255,255,255,.4);font-size:13px;display:none}'
    + '.slf-toggle{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.5);transition:.15s;margin:0 4px 6px 0}'
    + '.slf-toggle.active{border-color:rgba(255,109,0,.35);background:rgba(255,109,0,.08);color:#FF6D00}'
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
    + '.slf-count{display:inline-block;font-size:10px;background:rgba(255,255,255,.1);padding:1px 6px;border-radius:8px;margin-left:6px;color:rgba(255,255,255,.4)}'
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

// ═════════════════════════════════════════════════════════════════════
// FULL PROVIDER CATALOGUE
// ═════════════════════════════════════════════════════════════════════
// conn: 'direct' = custom API form | 'seam' = Seam Connect | 'request' = request integration
// cat:  'gym' | 'popular' | 'smart' | 'commercial' | 'other'

var PROVIDERS = [
  // ── ⭐ GYM FAVOURITES ──────────────────────────────────────────
  { id:'seam',        name:'Seam',                      logo:'🌐', desc:'Universal connector — 40+ lock brands, one login', conn:'seam', cat:'gym', pop:true, tag:'Universal',  tagClass:'slf-tag-popular' },
  { id:'kisi',        name:'Kisi',                     logo:'🔐', desc:'QR code door unlock — #1 for gyms',              conn:'direct',  cat:'gym', pop:true,  tag:'Direct API',  tagClass:'slf-tag-direct' },
  { id:'salto',       name:'Salto KS',                 logo:'🏢', desc:'Cloud smart locks — UK/EU gyms',                 conn:'seam',    cat:'gym', pop:true,  tag:'Popular',     tagClass:'slf-tag-popular' },
  { id:'brivo',       name:'Brivo',                     logo:'🔑', desc:'Enterprise cloud access — US gyms',              conn:'seam',    cat:'gym', pop:true,  tag:'Popular',     tagClass:'slf-tag-popular' },
  { id:'gymmaster',   name:'GymMaster',                 logo:'🏋️', desc:'Gym software + Gatekeeper door access',         conn:'direct',  cat:'gym', pop:true,  tag:'Direct API',  tagClass:'slf-tag-direct' },
  { id:'paxton',      name:'Paxton',                    logo:'🇬🇧', desc:'Very popular in UK gyms — Net2/10',             conn:'seam',    cat:'gym', pop:true,  tag:'Popular',     tagClass:'slf-tag-popular' },
  { id:'dormakaba',   name:'Dormakaba',                 logo:'🔓', desc:'Commercial locks — popular in gyms',             conn:'seam',    cat:'gym', pop:true,  tag:'Popular',     tagClass:'slf-tag-popular' },

  // ── 🔒 SMART LOCKS ────────────────────────────────────────────
  { id:'ttlock',      name:'TTLock / Sifely',           logo:'🔒', desc:'Budget-friendly smart locks — PIN codes',        conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'yale',        name:'Yale',                      logo:'🔐', desc:'Smart locks — Yale Assure, Linus, Conexis',      conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'schlage',     name:'Schlage',                   logo:'🔒', desc:'Encode WiFi smart deadbolts',                    conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'august',      name:'August',                    logo:'🏠', desc:'WiFi smart locks — retrofit friendly',           conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'nuki',        name:'Nuki',                      logo:'🇦🇹', desc:'European smart locks — BLE + WiFi',             conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'tedee',       name:'Tedee',                     logo:'🔘', desc:'Compact smart locks — Bluetooth/WiFi',           conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'lockly',      name:'Lockly',                    logo:'🔢', desc:'PIN Genie rotating keypad',                      conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'ultraloq',    name:'Ultraloq',                  logo:'🖐️', desc:'Fingerprint + keypad smart locks',              conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'igloohome',   name:'igloohome',                 logo:'🏔️', desc:'Offline-capable — works without WiFi',          conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'kwikset',     name:'Kwikset',                   logo:'🔑', desc:'Halo WiFi smart locks',                          conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'level',       name:'Level',                     logo:'🚪', desc:'Invisible smart lock — hidden inside door',      conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'wyze',        name:'Wyze',                      logo:'📦', desc:'Affordable smart home locks',                    conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'smonet',      name:'Smonet',                    logo:'🔒', desc:'Keyless entry smart locks — fingerprint',        conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'welock',      name:'Welock',                    logo:'🔐', desc:'European fingerprint + card smart locks',        conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'33lock',      name:'33 Lock',                   logo:'🔒', desc:'Smart locks with remote access',                 conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'4suites',     name:'4SUITES',                   logo:'🏨', desc:'Hospitality smart locks',                        conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'smartthings', name:'SmartThings',               logo:'📱', desc:'Samsung smart home — locks & sensors',           conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'switchbot',   name:'SwitchBot',                 logo:'🤖', desc:'Smart home locks — BLE + WiFi',                  conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'ring',        name:'Ring',                      logo:'🔔', desc:'Video doorbell + smart locks',                   conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'nest',        name:'Google Nest',               logo:'🏠', desc:'Nest × Yale smart locks',                        conn:'seam',    cat:'smart', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'tapkey',      name:'Tapkey',                    logo:'📲', desc:'NFC + Bluetooth — digital keys for cylinders',   conn:'request', cat:'smart', pop:false, tag:'Open API',  tagClass:'slf-tag-request' },

  // ── 🏢 COMMERCIAL ACCESS CONTROL ──────────────────────────────
  { id:'avigilon',    name:'Avigilon Alta / Openpath',  logo:'📱', desc:'Touchless wave-to-unlock — REST API',            conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'latch',       name:'Latch',                     logo:'🚪', desc:'Smart access for multi-tenant buildings',        conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'assaabloy',   name:'ASSA ABLOY',                logo:'🏛️', desc:'Global leader — Aperio, Incedo, HID',           conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'hid',         name:'HID Global',                logo:'🪪', desc:'Enterprise card readers & mobile access',        conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'allegion',    name:'Allegion',                   logo:'🏢', desc:'Schlage, Von Duprin — commercial hardware',      conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'honeywell',   name:'Honeywell',                 logo:'🔴', desc:'Building automation + access control',           conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'2n',          name:'2N',                        logo:'📞', desc:'IP intercoms + access — Axis company',           conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'akiles',      name:'Akiles',                    logo:'🇪🇸', desc:'Smart access — popular in Spain',               conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'verkada',     name:'Verkada',                   logo:'📹', desc:'Cloud security — cameras + access in one',       conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'genetec',     name:'Genetec',                   logo:'🖥️', desc:'Enterprise unified security platform',          conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'lenel',       name:'Lenel S2 / LenelS2',       logo:'🏢', desc:'Enterprise access — Carrier company',            conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'pdk',         name:'ProdataKey (PDK)',          logo:'☁️', desc:'Cloud access control — open REST API',           conn:'request', cat:'commercial', pop:false, tag:'Open API',  tagClass:'slf-tag-request' },
  { id:'swiftlane',   name:'Swiftlane',                 logo:'👤', desc:'Facial recognition + mobile access',             conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'pti',         name:'PTI Security',              logo:'🔧', desc:'Self-storage & facility access',                 conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'kantech',     name:'Kantech',                   logo:'🏢', desc:'Tyco/Johnson Controls access',                   conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'keyincode',   name:'KEYINCODE',                 logo:'🔢', desc:'Commercial keypad locks',                        conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'controlbyweb',name:'ControlByWeb',              logo:'🌐', desc:'IP relay controllers for doors',                 conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'doorking',    name:'DoorKing',                  logo:'🚧', desc:'Gate & door entry systems',                      conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'doorbird',    name:'DoorBird',                  logo:'🐦', desc:'IP video door stations + access',                conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },
  { id:'iloq',        name:'iLOQ',                      logo:'🔋', desc:'Self-powered digital locks — no batteries',      conn:'seam',    cat:'commercial', pop:false, tag:'Cloud',     tagClass:'slf-tag-seam' },

  // ── 🏋️ GYM SOFTWARE ───────────────────────────────────────────
  { id:'perfectgym',  name:'PerfectGym',                logo:'💪', desc:'Gym software with OpenAPI 3.0 — access + CRM',   conn:'request', cat:'gymsw', pop:false, tag:'Open API',  tagClass:'slf-tag-request' },
  { id:'gymdesk',     name:'Gymdesk',                   logo:'🖥️', desc:'Gym management with door access integrations',  conn:'request', cat:'gymsw', pop:false, tag:'Open API',  tagClass:'slf-tag-request' },
  { id:'glofox',      name:'Glofox / ABC Fitness',      logo:'🦊', desc:'Member apps + smart lock access integration',    conn:'request', cat:'gymsw', pop:false, tag:'Open API',  tagClass:'slf-tag-request' },
  { id:'clubready',   name:'ClubReady',                 logo:'💼', desc:'Club management with access control APIs',       conn:'request', cat:'gymsw', pop:false, tag:'Open API',  tagClass:'slf-tag-request' },
  { id:'mindbody',    name:'Mindbody',                  logo:'🧘', desc:'Fitness & wellness platform with access APIs',   conn:'request', cat:'gymsw', pop:false, tag:'Open API',  tagClass:'slf-tag-request' },
  { id:'ezfacility',  name:'EZFacility',                logo:'🏃', desc:'Facility management with door integrations',     conn:'request', cat:'gymsw', pop:false, tag:'Open API',  tagClass:'slf-tag-request' },

  // ── 🔗 CATCH-ALL ──────────────────────────────────────────────
  { id:'seam',        name:'Other / Not Listed',        logo:'🔗', desc:'60+ more brands — auto-detect via Seam Connect', conn:'seam',    cat:'other', pop:false, tag:'Auto-detect', tagClass:'slf-tag-seam' },
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

  // Build cards grouped by category
  var cats = [
    { key:'gym',        label:'⭐ Gym Favourites',         items:[] },
    { key:'smart',      label:'🔒 Smart Locks',            items:[] },
    { key:'commercial', label:'🏢 Commercial Access Control', items:[] },
    { key:'gymsw',      label:'🏋️ Gym Software (Open APIs)', items:[] },
    { key:'other',      label:'🔗 Other',                  items:[] },
  ];
  var catMap = {};
  cats.forEach(function(c) { catMap[c.key] = c; });

  PROVIDERS.forEach(function (p) {
    var bucket = catMap[p.cat] || catMap['other'];
    bucket.items.push(p);
  });

  // Build HTML
  var html = ''
    + '<div style="text-align:center;margin-bottom:16px">'
    + '<div style="font-size:40px;margin-bottom:8px">🔐</div>'
    + '<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Find Your Lock System</h2>'
    + '<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Tap your brand — visitors will get auto door access</p>'
    + '<p style="color:rgba(255,255,255,.25);font-size:11px;margin:6px 0 0">' + PROVIDERS.length + ' brands with open APIs supported</p>'
    + '</div>'

    // Search bar
    + '<div class="slf-search-wrap">'
    + '<span class="slf-search-icon">🔍</span>'
    + '<input id="slf-search" class="slf-search" type="text" placeholder="Search brands... (e.g. Yale, Salto, Brivo)" oninput="window._slfFilter(this.value)">'
    + '</div>';

  // Category grids
  cats.forEach(function (cat) {
    if (cat.items.length === 0) return;
    var cards = '';
    cat.items.forEach(function (p) {
      cards += '<div class="slf-card" onclick="window._slfSelectProvider(\'' + p.id + '\')" data-slf-id="' + p.id + '" data-slf-search="' + (p.name + ' ' + p.desc).toLowerCase() + '">'
        + (p.tag ? '<span class="slf-tag ' + p.tagClass + '">' + p.tag + '</span>' : '')
        + '<span class="slf-logo">' + p.logo + '</span>'
        + '<div class="slf-name">' + p.name + '</div>'
        + '<div class="slf-desc">' + p.desc + '</div>'
        + '</div>';
    });
    html += '<div class="slf-section" data-slf-cat="' + cat.key + '">' + cat.label + '<span class="slf-count">' + cat.items.length + '</span></div>'
      + '<div class="slf-grid" data-slf-cat="' + cat.key + '">' + cards + '</div>';
  });

  // No results message
  html += '<div id="slf-no-results" class="slf-no-results">No matching brands found. Try <strong>Other / Not Listed</strong> below — auto-detect from 60+ brands.</div>';

  // Help options
  html += '<div class="slf-help" onclick="window._slfNotSure()">'
    + '<div class="slf-help-icon">🤔</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Not sure what you have?</div><div class="slf-help-sub">We\'ll help you identify your lock system</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfNoLock()">'
    + '<div class="slf-help-icon">👤</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">No smart lock / Staff at front desk</div><div class="slf-help-sub">Visitors show QR code — staff verifies</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>';

  // Open the sheet
  if (typeof _sgOpenSheet === 'function') _sgOpenSheet('slf-finder-sheet', html);
  else if (typeof _ctaOpenSheet === 'function') _ctaOpenSheet(html);
  else window.location.href = '/gympartners-dashboard/connect-access';
};

// ═════════════════════════════════════════════════════════════════════
// Search / filter
// ═════════════════════════════════════════════════════════════════════

window._slfFilter = function (q) {
  var query = (q || '').toLowerCase().trim();
  var cards = document.querySelectorAll('.slf-card[data-slf-search]');
  var sections = document.querySelectorAll('.slf-section[data-slf-cat]');
  var grids = document.querySelectorAll('.slf-grid[data-slf-cat]');
  var visiblePerCat = {};

  cards.forEach(function (card) {
    var match = !query || card.getAttribute('data-slf-search').indexOf(query) !== -1;
    card.classList.toggle('slf-hidden', !match);
    if (match) {
      var grid = card.parentElement;
      var cat = grid ? grid.getAttribute('data-slf-cat') : '';
      visiblePerCat[cat] = (visiblePerCat[cat] || 0) + 1;
    }
  });

  // Hide empty category headers
  sections.forEach(function (sec) {
    var cat = sec.getAttribute('data-slf-cat');
    sec.classList.toggle('slf-hidden', !visiblePerCat[cat]);
  });
  grids.forEach(function (grid) {
    var cat = grid.getAttribute('data-slf-cat');
    grid.style.display = visiblePerCat[cat] ? '' : 'none';
  });

  // Show "no results" if nothing matches
  var noResults = document.getElementById('slf-no-results');
  var totalVisible = Object.values(visiblePerCat).reduce(function (a, b) { return a + b; }, 0);
  if (noResults) noResults.style.display = totalVisible === 0 ? 'block' : 'none';
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

  switch (provider.conn) {
    case 'direct':
      if (providerId === 'kisi') _slfShowKisiForm(gymId);
      else if (providerId === 'gymmaster') _slfShowGymMasterForm(gymId);
      break;
    case 'request':
      _slfShowRequestForm(gymId, provider);
      break;
    default:
      // Seam-routed
      _slfStartSeamConnect(gymId, providerId, provider.name);
      break;
  }
};

// ═════════════════════════════════════════════════════════════════════
// Seam Connect Webview
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
      body: JSON.stringify({ gymId: gymId, provider: providerId }),
    });
    var d = await r.json();
    var url = d.url || d.connectUrl || d.connect_url;

    if (url) {
      closeSheet();
      window.open(url, '_blank');
      _slfToast('Complete ' + providerName + ' login in the new tab ✅', 'success', 5000);
      if (d.connect_webview_id) {
        _slfPollSeamComplete(gymId, d.connect_webview_id, providerName);
      }
    } else {
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

async function _slfPollSeamComplete(gymId, webviewId, providerName) {
  var attempts = 0;
  var maxAttempts = 60;
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
    + '<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Connect QR Access System</h2>'
    + '<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">QR code unlock — no app needed for visitors</p>'
    + '</div>'

    + '<div class="slf-form-group">'
    + '<label class="slf-label">Access System API Key</label>'
    + '<input id="slf-kisi-key" class="slf-input" type="text" placeholder="Paste your API key from Kisi dashboard">'
    + '</div>'

    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;margin-bottom:16px">'
    + '<div style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.5">'
    + '📋 <strong>Where to find it:</strong> Log into <a href="https://web.kisi.io" target="_blank" style="color:#FF6D00">web.kisi.io</a> → Organization Settings → API → Create API key'
    + '</div>'
    + '</div>'

    + '<button id="slf-kisi-btn" class="slf-btn slf-btn-primary" onclick="window._slfConnectKisi(' + gymId + ')">Connect Kisi →</button>'
    + '<button class="slf-btn slf-btn-secondary" style="margin-top:8px" onclick="window._slfOpenFinder()">← Back to all brands</button>';

  if (typeof _sgOpenSheet === 'function') _sgOpenSheet('slf-kisi-sheet', html);
  else if (typeof _ctaOpenSheet === 'function') _ctaOpenSheet(html);
  setTimeout(function () { var el = document.getElementById('slf-kisi-key'); if (el) el.focus(); }, 400);
}

window._slfConnectKisi = async function (gymId) {
  var key = (document.getElementById('slf-kisi-key') || {}).value;
  if (!key || key.trim().length < 10) { _slfToast('Please enter a valid API key', 'error'); return; }

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
      _slfToast('🎉 QR access connected! Visitors get QR code door access.', 'success', 5000);
    } else {
      _slfToast(d.error || 'Connection failed — check your API key', 'error', 4000);
      if (btn) { btn.disabled = false; btn.textContent = 'Connect →'; }
    }
  } catch (ex) {
    _slfToast('Connection failed — try again', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Connect →'; }
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

    + '<button id="slf-gm-btn" class="slf-btn slf-btn-primary" onclick="window._slfConnectGymMaster(' + gymId + ')">Connect GymMaster →</button>'
    + '<button class="slf-btn slf-btn-secondary" style="margin-top:8px" onclick="window._slfOpenFinder()">← Back to all brands</button>';

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
    var r = await fetch('/api/access/owner/connect-gymmaster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ gymId: gymId, gmSite: site.trim(), gmApiKey: key.trim() }),
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
// Request Integration — for brands with open APIs not yet built
// ═════════════════════════════════════════════════════════════════════

function _slfShowRequestForm(gymId, provider) {
  var html = ''
    + '<div style="text-align:center;margin-bottom:16px">'
    + '<div style="font-size:40px;margin-bottom:8px">' + provider.logo + '</div>'
    + '<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">' + provider.name + '</h2>'
    + '<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">' + provider.desc + '</p>'
    + '</div>'

    + '<div style="background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.15);border-radius:12px;padding:14px;margin-bottom:16px">'
    + '<div style="font-size:13px;color:rgba(255,255,255,.7);line-height:1.5">'
    + '🔧 <strong>' + provider.name + ' has an open API</strong> — we\'re building this integration. '
    + 'Request it now and we\'ll notify you when it\'s live. In the meantime, you can use <strong>staff QR verification</strong>.'
    + '</div>'
    + '</div>'

    + '<div class="slf-form-group">'
    + '<label class="slf-label">Your email (for notification)</label>'
    + '<input id="slf-req-email" class="slf-input" type="email" placeholder="you@gym.com">'
    + '</div>'

    + '<div class="slf-form-group">'
    + '<label class="slf-label">Anything we should know? (optional)</label>'
    + '<input id="slf-req-note" class="slf-input" type="text" placeholder="e.g. we have 3 doors, use PerfectGym for billing">'
    + '</div>'

    + '<button id="slf-req-btn" class="slf-btn slf-btn-primary" onclick="window._slfSubmitRequest(' + gymId + ',\'' + provider.id + '\',\'' + provider.name + '\')">🔔 Request ' + provider.name + ' Integration</button>'
    + '<button class="slf-btn slf-btn-secondary" style="margin-top:8px" onclick="window._slfNoLock()">Use Staff QR Verification for now →</button>'
    + '<button class="slf-btn slf-btn-secondary" style="margin-top:8px" onclick="window._slfOpenFinder()">← Back to all brands</button>';

  if (typeof _sgOpenSheet === 'function') _sgOpenSheet('slf-request-sheet', html);
  else if (typeof _ctaOpenSheet === 'function') _ctaOpenSheet(html);
  setTimeout(function () { var el = document.getElementById('slf-req-email'); if (el) el.focus(); }, 400);
}

window._slfSubmitRequest = async function (gymId, providerId, providerName) {
  var email = (document.getElementById('slf-req-email') || {}).value;
  var note = (document.getElementById('slf-req-note') || {}).value;

  var btn = document.getElementById('slf-req-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="slf-spinner"></span> Sending request…'; }

  try {
    var r = await fetch('/api/access/owner/request-integration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ gymId: gymId, system: providerId, email: email || '', note: note || '' }),
    });
    var d = await r.json();
    var closeSheet = typeof _sgCloseSheet === 'function' ? _sgCloseSheet
      : typeof _ctaCloseSheet === 'function' ? _ctaCloseSheet : function () {};
    closeSheet();
    _slfToast('🔔 ' + providerName + ' integration requested! We\'ll be in touch.', 'success', 5000);
  } catch (ex) {
    _slfToast('Request saved — we\'ll be in touch!', 'success', 4000);
    var closeSheet = typeof _sgCloseSheet === 'function' ? _sgCloseSheet
      : typeof _ctaCloseSheet === 'function' ? _ctaCloseSheet : function () {};
    closeSheet();
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
    + '<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">What does your gym door entry look like?</p>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'kisi\')">'
    + '<div class="slf-help-icon">📱</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Tablet/reader on the wall with QR scanner</div><div class="slf-help-sub">Likely QR-based system — tap to connect</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'ttlock\')">'
    + '<div class="slf-help-icon">🔢</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Keypad with PIN entry on the door handle</div><div class="slf-help-sub">Likely TTLock, Yale, Schlage, or Lockly</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'brivo\')">'
    + '<div class="slf-help-icon">💳</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Card reader / fob tap next to the door</div><div class="slf-help-sub">Likely Brivo, Paxton, Avigilon, or ASSA ABLOY</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'august\')">'
    + '<div class="slf-help-icon">🔒</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Smart deadbolt lock — controlled by phone app</div><div class="slf-help-sub">Likely August, Yale, Nuki, or Schlage</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'ultraloq\')">'
    + '<div class="slf-help-icon">🖐️</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Fingerprint scanner on the lock</div><div class="slf-help-sub">Likely Ultraloq, Lockly, or Samsung</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'paxton\')">'
    + '<div class="slf-help-icon">🚪</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Buzzer/intercom entry system at the building</div><div class="slf-help-sub">Likely Paxton, 2N, DoorBird, or DoorKing</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'gymmaster\')">'
    + '<div class="slf-help-icon">🏋️</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">We use gym software for member check-ins</div><div class="slf-help-sub">GymMaster, PerfectGym, Gymdesk, Glofox, or Mindbody</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfSelectProvider(\'seam\')">'
    + '<div class="slf-help-icon">🔗</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">Something else / I have an app for it</div><div class="slf-help-sub">Auto-detect from 60+ brands</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<div class="slf-help" onclick="window._slfNoLock()">'
    + '<div class="slf-help-icon">🚪</div>'
    + '<div class="slf-help-text"><div class="slf-help-title">No smart lock — staff handles the door</div><div class="slf-help-sub">Visitors show QR code at reception</div></div>'
    + '<div class="slf-arrow">›</div>'
    + '</div>'

    + '<button class="slf-btn slf-btn-secondary" style="margin-top:12px" onclick="window._slfOpenFinder()">← Back to all brands</button>';

  if (typeof _sgOpenSheet === 'function') _sgOpenSheet('slf-identify-sheet', html);
  else if (typeof _ctaOpenSheet === 'function') _ctaOpenSheet(html);
};

})();
