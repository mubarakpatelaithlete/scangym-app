/**
 * ScanGym Partner Wizard — Guided 5-Step Onboarding Flow
 * ══════════════════════════════════════════════════════════
 * Replaces scattered side buttons with ONE smart "Next Step" button
 * that auto-detects partner state and guides them through:
 *
 *   Step 1: Sign In
 *   Step 2: Add My Gym (claim)
 *   Step 3: Connect Seam (smart locks)
 *   Step 4: Add Withdraw Method (Stripe Connect)
 *   Step 5: Withdraw Money
 *
 * Drop-in file — loads after app.ctr576.js, patches PartnerFullPage.
 * All backend APIs remain unchanged.
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  //  CONSTANTS
  // ═══════════════════════════════════════════════════════════════
  var BRAND = '#FF6D00';
  var GREEN = '#22c55e';
  var PURPLE = '#a855f7';
  var BLUE = '#3b82f6';
  var RED = '#ef4444';

  var STEPS = [
    { id: 'signin',  icon: '🔑', label: 'Sign In',       color: BRAND,  bg: 'rgba(255,109,0,.15)' },
    { id: 'addgym',  icon: '🏢', label: 'Add My Gym',    color: GREEN,  bg: 'rgba(34,197,94,.15)' },
    { id: 'seam',    icon: '🔗', label: 'Connect Locks',  color: PURPLE, bg: 'rgba(168,85,247,.15)' },
    { id: 'bank',    icon: '🏦', label: 'Add Bank',       color: BLUE,   bg: 'rgba(59,130,246,.15)' },
    { id: 'withdraw',icon: '💸', label: 'Withdraw',       color: GREEN,  bg: 'rgba(34,197,94,.15)' },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  STATE DETECTION
  // ═══════════════════════════════════════════════════════════════
  var _wizardState = {
    user: null,
    gymId: null,
    gymName: null,
    seamConnected: false,
    stripeConnected: false,
    stripeOnboarded: false,
    balance: 0,
    currentStep: 0,
    loading: false,
  };

  /** Detect what step the partner is on by checking backend state */
  async function detectPartnerState() {
    var s = _wizardState;
    s.user = (typeof state !== 'undefined' && state && state.user) ? state.user : null;

    // Step 1: Not signed in
    if (!s.user) {
      s.currentStep = 0;
      return s;
    }

    // Fetch dashboard data (single API call tells us gym + earnings state)
    try {
      var r = await fetch('/api/gym-partner/dashboard', { credentials: 'include' });
      if (r.ok) {
        var d = await r.json();
        if (d.gyms && d.gyms.length > 0) {
          s.gymId = d.gyms[0].id;
          s.gymName = d.gyms[0].name;
          window._partnerGymId = s.gymId;
          window._partnerGymName = s.gymName;
        }
      }
    } catch (e) { /* offline or no gyms */ }

    // Step 2: No gym claimed
    if (!s.gymId) {
      s.currentStep = 1;
      return s;
    }

    // Step 3: Check Seam connection
    try {
      var sr = await fetch('/api/access/owner/connection-status/' + s.gymId, { credentials: 'include' });
      if (sr.ok) {
        var sd = await sr.json();
        s.seamConnected = sd.connected === true;
      }
    } catch (e) { /* no access control data */ }

    if (!s.seamConnected) {
      s.currentStep = 2;
      return s;
    }

    // Step 4: Check Stripe Connect
    try {
      var str = await fetch('/api/gym-partner/stripe-connect/status', { credentials: 'include' });
      if (str.ok) {
        var std = await str.json();
        s.stripeConnected = std.connected === true;
        s.stripeOnboarded = std.onboardingComplete === true;
      }
    } catch (e) { /* stripe not set up */ }

    if (!s.stripeConnected || !s.stripeOnboarded) {
      s.currentStep = 3;
      return s;
    }

    // Step 5: All set — can withdraw
    try {
      var er = await fetch('/api/gym-partner/earnings', { credentials: 'include' });
      if (er.ok) {
        var ed = await er.json();
        var grossPence = parseInt(ed.totalRevenuePence) || 0;
        s.balance = Math.max(0, (grossPence * 0.85 / 100));
      }
    } catch (e) { /* no earnings data */ }

    s.currentStep = 4;
    return s;
  }

  // ═══════════════════════════════════════════════════════════════
  //  WIZARD UI
  // ═══════════════════════════════════════════════════════════════

  /** Build the persistent "Next Step" floating button */
  function renderNextStepButton() {
    var existing = document.getElementById('sg-wizard-fab');
    if (existing) existing.remove();

    var s = _wizardState;
    var step = STEPS[s.currentStep];
    var isComplete = s.currentStep === 4 && s.stripeOnboarded;

    var fab = document.createElement('div');
    fab.id = 'sg-wizard-fab';
    fab.onclick = function () { openWizardSheet(); };
    fab.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 18px 10px 14px;' +
      'background:linear-gradient(135deg,' + step.bg + ',' + step.bg.replace('.15', '.08') + ');' +
      'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
      'border:1px solid ' + step.color + '40;border-radius:20px;cursor:pointer;' +
      'box-shadow:0 4px 24px ' + step.color + '30;transition:all .2s;white-space:nowrap">' +
        '<span style="font-size:18px">' + step.icon + '</span>' +
        '<div>' +
          '<div style="color:' + step.color + ';font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;opacity:.8">' +
            (isComplete ? 'READY' : 'STEP ' + (s.currentStep + 1) + '/5') +
          '</div>' +
          '<div style="color:#fff;font-size:13px;font-weight:700">' + step.label + '</div>' +
        '</div>' +
        '<span style="color:' + step.color + ';font-size:14px;margin-left:4px">→</span>' +
      '</div>';

    fab.style.cssText =
      'position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:20;' +
      'transition:all .25s ease';

    // Add hover effect
    fab.onmouseover = function () { this.style.transform = 'translateY(-50%) scale(1.05)'; };
    fab.onmouseout = function () { this.style.transform = 'translateY(-50%) scale(1)'; };

    return fab;
  }

  /** Render the progress dots below the FAB */
  function renderProgressDots() {
    var existing = document.getElementById('sg-wizard-dots');
    if (existing) existing.remove();

    var dots = document.createElement('div');
    dots.id = 'sg-wizard-dots';
    dots.style.cssText =
      'position:absolute;right:8px;top:calc(50% + 32px);transform:translateY(-50%);z-index:20;' +
      'display:flex;flex-direction:column;gap:6px;align-items:center;padding-top:14px';

    for (var i = 0; i < STEPS.length; i++) {
      var isActive = i === _wizardState.currentStep;
      var isDone = i < _wizardState.currentStep;
      var dot = document.createElement('div');
      dot.style.cssText =
        'width:' + (isActive ? '10px' : '6px') + ';height:' + (isActive ? '10px' : '6px') + ';' +
        'border-radius:50%;transition:all .3s;' +
        'background:' + (isDone ? GREEN : (isActive ? STEPS[i].color : 'rgba(255,255,255,.15)')) + ';' +
        'box-shadow:' + (isActive ? '0 0 8px ' + STEPS[i].color + '60' : 'none') + ';' +
        'cursor:pointer';
      dot.title = STEPS[i].label + (isDone ? ' ✓' : '');
      dots.appendChild(dot);
    }

    return dots;
  }

  /** Open the wizard bottom sheet */
  function openWizardSheet() {
    var existing = document.getElementById('sg-wizard-sheet');
    if (existing) { closeWizardSheet(); return; }

    var s = _wizardState;
    var step = STEPS[s.currentStep];

    // Backdrop
    var backdrop = document.createElement('div');
    backdrop.id = 'sg-wizard-backdrop';
    backdrop.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:998;' +
      'opacity:0;transition:opacity .25s';
    backdrop.onclick = closeWizardSheet;

    // Sheet
    var sheet = document.createElement('div');
    sheet.id = 'sg-wizard-sheet';
    sheet.style.cssText =
      'position:fixed;bottom:56px;left:0;right:0;z-index:999;' +
      'background:linear-gradient(180deg,#12122a,#0a0a16);' +
      'border-top:1px solid rgba(255,255,255,.1);' +
      'border-radius:24px 24px 0 0;padding:0;' +
      'transform:translateY(100%);transition:transform .35s cubic-bezier(.32,.72,.24,1);' +
      'max-height:80vh;overflow-y:auto;' +
      'box-shadow:0 -8px 40px rgba(0,0,0,.5)';

    sheet.innerHTML = buildSheetContent(s);

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    // Animate in
    requestAnimationFrame(function () {
      backdrop.style.opacity = '1';
      sheet.style.transform = 'translateY(0)';
    });
  }

  function closeWizardSheet() {
    var sheet = document.getElementById('sg-wizard-sheet');
    var backdrop = document.getElementById('sg-wizard-backdrop');
    if (sheet) {
      sheet.style.transform = 'translateY(100%)';
      setTimeout(function () { sheet.remove(); }, 350);
    }
    if (backdrop) {
      backdrop.style.opacity = '0';
      setTimeout(function () { backdrop.remove(); }, 300);
    }
  }
  window._sgCloseWizard = closeWizardSheet;

  /** Build sheet inner HTML based on current step */
  function buildSheetContent(s) {
    var html = '';

    // ── Handle bar ──
    html += '<div style="display:flex;justify-content:center;padding:10px 0 6px">' +
      '<div style="width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.15)"></div></div>';

    // ── Progress bar ──
    html += '<div style="padding:0 20px 12px">';
    html += '<div style="display:flex;align-items:center;gap:0;margin-bottom:8px">';
    for (var i = 0; i < STEPS.length; i++) {
      var isDone = i < s.currentStep;
      var isActive = i === s.currentStep;
      // Step circle
      html += '<div style="width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
        'font-size:12px;font-weight:800;transition:all .3s;' +
        'background:' + (isDone ? GREEN : (isActive ? STEPS[i].color : 'rgba(255,255,255,.06)')) + ';' +
        'color:' + (isDone || isActive ? '#fff' : 'rgba(255,255,255,.3)') + ';' +
        'border:2px solid ' + (isDone ? GREEN : (isActive ? STEPS[i].color : 'rgba(255,255,255,.08)')) + ';' +
        'box-shadow:' + (isActive ? '0 0 12px ' + STEPS[i].color + '40' : 'none') + '">' +
        (isDone ? '✓' : (i + 1)) + '</div>';
      // Connector line
      if (i < STEPS.length - 1) {
        html += '<div style="flex:1;height:2px;background:' +
          (isDone ? GREEN : 'rgba(255,255,255,.06)') + ';margin:0 2px"></div>';
      }
    }
    html += '</div>';

    // Step labels
    html += '<div style="display:flex;justify-content:space-between">';
    for (var j = 0; j < STEPS.length; j++) {
      var jActive = j === s.currentStep;
      var jDone = j < s.currentStep;
      html += '<div style="text-align:center;width:' + (100 / STEPS.length) + '%;font-size:8px;font-weight:600;' +
        'color:' + (jDone ? GREEN : (jActive ? STEPS[j].color : 'rgba(255,255,255,.25)')) + '">' +
        STEPS[j].label + '</div>';
    }
    html += '</div></div>';

    // ── Step content ──
    html += '<div style="padding:0 20px 24px">';

    switch (s.currentStep) {
      case 0: html += stepSignIn(); break;
      case 1: html += stepAddGym(s); break;
      case 2: html += stepConnectSeam(s); break;
      case 3: html += stepAddBank(s); break;
      case 4: html += stepWithdraw(s); break;
    }

    html += '</div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════════
  //  STEP CONTENT BUILDERS
  // ═══════════════════════════════════════════════════════════════

  function stepSignIn() {
    return '' +
      '<div style="text-align:center;padding:16px 0">' +
        '<div style="width:64px;height:64px;border-radius:50%;background:rgba(255,109,0,.12);' +
          'display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px;' +
          'border:2px solid rgba(255,109,0,.25)">🔑</div>' +
        '<h3 style="color:#fff;font-size:18px;font-weight:800;margin-bottom:4px">Sign In to Get Started</h3>' +
        '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:20px">' +
          'Log in or create an account to manage your gym on ScanGym</p>' +
        '<button onclick="_sgWizardSignIn()" style="width:100%;padding:14px;border-radius:14px;border:none;' +
          'background:linear-gradient(135deg,' + BRAND + ',#e55d00);color:#fff;font-size:15px;font-weight:800;' +
          'cursor:pointer;box-shadow:0 4px 20px rgba(255,109,0,.35);transition:transform .15s"' +
          ' ontouchstart="this.style.transform=\'scale(.97)\'" ontouchend="this.style.transform=\'\'">' +
          '🔑 Sign In / Create Account →</button>' +
        '<p style="color:rgba(255,255,255,.25);font-size:11px;margin-top:12px">Takes less than 30 seconds</p>' +
      '</div>';
  }

  function stepAddGym(s) {
    return '' +
      '<div>' +
        '<div style="text-align:center;margin-bottom:16px">' +
          '<div style="width:64px;height:64px;border-radius:50%;background:rgba(34,197,94,.12);' +
            'display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px;' +
            'border:2px solid rgba(34,197,94,.25)">🏢</div>' +
          '<h3 style="color:#fff;font-size:18px;font-weight:800;margin-bottom:4px">Add Your Gym</h3>' +
          '<p style="color:rgba(255,255,255,.4);font-size:13px">' +
            'Search and claim your gym to start earning</p>' +
        '</div>' +
        '<div style="position:relative;margin-bottom:12px">' +
          '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:16px;opacity:.4">🔍</span>' +
          '<input id="sg-wizard-gym-search" type="text" placeholder="Type your gym name..." ' +
            'oninput="window._sgWizardSearchGym(this.value)" ' +
            'style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);' +
            'border-radius:14px;padding:14px 14px 14px 38px;color:#fff;font-size:14px;outline:none;' +
            'box-sizing:border-box;transition:border-color .2s" ' +
            'onfocus="this.style.borderColor=\'rgba(34,197,94,.4)\'" ' +
            'onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'">' +
        '</div>' +
        '<div id="sg-wizard-gym-results" style="max-height:220px;overflow-y:auto;' +
          'border-radius:12px;margin-bottom:12px"></div>' +
        '<div style="text-align:center">' +
          '<p style="color:rgba(255,255,255,.25);font-size:11px">Can\'t find your gym? ' +
            '<span onclick="navigate(\'/list-your-gym\');_sgCloseWizard()" ' +
            'style="color:' + BRAND + ';cursor:pointer;font-weight:600">List it manually →</span></p>' +
        '</div>' +
      '</div>';
  }

  function stepConnectSeam(s) {
    return '' +
      '<div style="text-align:center;padding:8px 0">' +
        '<div style="width:64px;height:64px;border-radius:50%;background:rgba(168,85,247,.12);' +
          'display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px;' +
          'border:2px solid rgba(168,85,247,.25)">🔗</div>' +
        '<h3 style="color:#fff;font-size:18px;font-weight:800;margin-bottom:4px">Connect Smart Locks</h3>' +
        '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:6px">' +
          'Let customers unlock your doors with a QR code</p>' +
        '<div style="background:rgba(168,85,247,.08);border:1px solid rgba(168,85,247,.15);border-radius:12px;' +
          'padding:10px 14px;margin-bottom:16px;display:inline-flex;align-items:center;gap:8px">' +
          '<span style="font-size:14px">🏢</span>' +
          '<span style="color:#fff;font-size:13px;font-weight:600">' + (s.gymName || 'Your Gym') + '</span>' +
          '<span style="color:rgba(255,255,255,.3);font-size:11px">auto-detected</span>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;text-align:left;margin-bottom:16px">' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.03);' +
            'border:1px solid rgba(255,255,255,.05);border-radius:10px">' +
            '<span style="font-size:16px">🔐</span>' +
            '<div><div style="color:#fff;font-size:12px;font-weight:600">Kisi</div>' +
            '<div style="color:rgba(255,255,255,.3);font-size:10px">QR code door unlock</div></div></div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.03);' +
            'border:1px solid rgba(255,255,255,.05);border-radius:10px">' +
            '<span style="font-size:16px">🏢</span>' +
            '<div><div style="color:#fff;font-size:12px;font-weight:600">Salto KS</div>' +
            '<div style="color:rgba(255,255,255,.3);font-size:10px">PIN code or mobile key</div></div></div>' +
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.03);' +
            'border:1px solid rgba(255,255,255,.05);border-radius:10px">' +
            '<span style="font-size:16px">🔑</span>' +
            '<div><div style="color:#fff;font-size:12px;font-weight:600">Brivo / Others</div>' +
            '<div style="color:rgba(255,255,255,.3);font-size:10px">Connected via Seam</div></div></div>' +
        '</div>' +
        '<button onclick="_sgWizardConnectSeam()" id="sg-wizard-seam-btn" style="width:100%;padding:14px;border-radius:14px;border:none;' +
          'background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;font-size:15px;font-weight:800;' +
          'cursor:pointer;box-shadow:0 4px 20px rgba(168,85,247,.35);transition:transform .15s;margin-bottom:10px"' +
          ' ontouchstart="this.style.transform=\'scale(.97)\'" ontouchend="this.style.transform=\'\'">' +
          '🔗 Connect Seam Account →</button>' +
        '<button onclick="_sgWizardSkipSeam()" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.08);' +
          'background:transparent;color:rgba(255,255,255,.4);font-size:12px;font-weight:600;cursor:pointer">' +
          'Skip for now — I\'ll use staff QR verification</button>' +
      '</div>';
  }

  function stepAddBank(s) {
    return '' +
      '<div style="text-align:center;padding:8px 0">' +
        '<div style="width:64px;height:64px;border-radius:50%;background:rgba(59,130,246,.12);' +
          'display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px;' +
          'border:2px solid rgba(59,130,246,.25)">🏦</div>' +
        '<h3 style="color:#fff;font-size:18px;font-weight:800;margin-bottom:4px">Add Your Bank Account</h3>' +
        '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:20px">' +
          'Connect via Stripe to receive your 85% revenue share</p>' +
        '<div style="background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.1);border-radius:14px;' +
          'padding:14px;margin-bottom:16px;text-align:left">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
            '<span style="color:rgba(255,255,255,.5);font-size:12px">Revenue split</span>' +
            '<span style="color:#fff;font-size:12px;font-weight:700">You 85% · ScanGym 15%</span></div>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
            '<span style="color:rgba(255,255,255,.5);font-size:12px">Min. payout</span>' +
            '<span style="color:#fff;font-size:12px;font-weight:700">£10.00</span></div>' +
          '<div style="display:flex;justify-content:space-between">' +
            '<span style="color:rgba(255,255,255,.5);font-size:12px">Payout speed</span>' +
            '<span style="color:#fff;font-size:12px;font-weight:700">2–3 business days</span></div>' +
        '</div>' +
        '<button onclick="_sgWizardConnectStripe()" id="sg-wizard-stripe-btn" style="width:100%;padding:14px;border-radius:14px;border:none;' +
          'background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-size:15px;font-weight:800;' +
          'cursor:pointer;box-shadow:0 4px 20px rgba(59,130,246,.35);transition:transform .15s"' +
          ' ontouchstart="this.style.transform=\'scale(.97)\'" ontouchend="this.style.transform=\'\'">' +
          '🏦 Connect Stripe →</button>' +
        '<p style="color:rgba(255,255,255,.2);font-size:10px;margin-top:10px">Powered by Stripe · Bank-level security</p>' +
      '</div>';
  }

  function stepWithdraw(s) {
    var balance = s.balance || 0;
    var canWithdraw = balance >= 10;
    return '' +
      '<div style="text-align:center;padding:8px 0">' +
        '<div style="width:64px;height:64px;border-radius:50%;background:rgba(34,197,94,.12);' +
          'display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px;' +
          'border:2px solid rgba(34,197,94,.25)">💸</div>' +
        '<h3 style="color:#fff;font-size:18px;font-weight:800;margin-bottom:4px">Withdraw Money</h3>' +
        '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:16px">' +
          'Transfer your earnings to your bank account</p>' +
        '<!-- Balance Card -->' +
        '<div style="background:linear-gradient(135deg,rgba(34,197,94,.12),rgba(34,197,94,.04));' +
          'border:1px solid rgba(34,197,94,.2);border-radius:18px;padding:20px;margin-bottom:16px">' +
          '<div style="color:rgba(255,255,255,.4);font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">AVAILABLE BALANCE</div>' +
          '<div style="font-size:38px;font-weight:900;color:' + GREEN + ';margin-bottom:4px">£' + balance.toFixed(2) + '</div>' +
          '<div style="color:rgba(255,255,255,.3);font-size:11px">After 85% revenue share</div>' +
        '</div>' +
        (canWithdraw
          ? '<button onclick="_sgWizardWithdraw()" id="sg-wizard-withdraw-btn" style="width:100%;padding:14px;border-radius:14px;border:none;' +
            'background:linear-gradient(135deg,' + GREEN + ',#16a34a);color:#fff;font-size:15px;font-weight:800;' +
            'cursor:pointer;box-shadow:0 4px 20px rgba(34,197,94,.35);transition:transform .15s"' +
            ' ontouchstart="this.style.transform=\'scale(.97)\'" ontouchend="this.style.transform=\'\'">' +
            '💸 Withdraw £' + balance.toFixed(2) + ' →</button>'
          : '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;' +
            'padding:14px;margin-bottom:8px">' +
            '<p style="color:rgba(255,255,255,.5);font-size:13px;font-weight:600">Minimum payout: £10.00</p>' +
            '<p style="color:rgba(255,255,255,.3);font-size:11px;margin-top:4px">You need £' +
            (10 - balance).toFixed(2) + ' more to withdraw</p></div>') +
        '<div style="margin-top:12px">' +
          '<button onclick="navigate(\'/partner/payouts\');_sgCloseWizard()" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.08);' +
            'background:transparent;color:rgba(255,255,255,.5);font-size:12px;font-weight:600;cursor:pointer">' +
            '📋 View Payout History</button>' +
        '</div>' +
        '<!-- All steps complete badge -->' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;' +
          'padding:10px 16px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.15);border-radius:12px">' +
          '<span style="color:' + GREEN + ';font-size:14px">✅</span>' +
          '<span style="color:' + GREEN + ';font-size:12px;font-weight:700">Setup Complete — All 5 steps done!</span>' +
        '</div>' +
      '</div>';
  }

  // ═══════════════════════════════════════════════════════════════
  //  STEP ACTION HANDLERS
  // ═══════════════════════════════════════════════════════════════

  window._sgWizardSignIn = function () {
    closeWizardSheet();
    if (typeof window._sgShowAuthSheet === 'function') {
      window._sgShowAuthSheet('book');
    } else {
      navigate('/login');
    }
    // Poll for auth completion and auto-advance
    var checkAuth = setInterval(function () {
      if (typeof state !== 'undefined' && state && state.user) {
        clearInterval(checkAuth);
        sgToast('Signed in! ✅ Let\'s add your gym next', 'success', 2500);
        setTimeout(function () { initWizard(); }, 500);
      }
    }, 1000);
    // Stop polling after 2 minutes
    setTimeout(function () { clearInterval(checkAuth); }, 120000);
  };

  var _wizardSearchTimeout;
  window._sgWizardSearchGym = function (q) {
    clearTimeout(_wizardSearchTimeout);
    var results = document.getElementById('sg-wizard-gym-results');
    if (!results) return;
    if (!q || q.length < 2) { results.innerHTML = ''; return; }

    results.innerHTML = '<div style="padding:12px;text-align:center;color:rgba(255,255,255,.3);font-size:12px">Searching...</div>';

    _wizardSearchTimeout = setTimeout(async function () {
      try {
        // Try multiple search endpoints
        var r = await fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=5', { credentials: 'include' })
          .catch(function () { return null; });

        if (!r || !r.ok) {
          r = await fetch('/api/gyms/search?q=' + encodeURIComponent(q) + '&limit=5', { credentials: 'include' })
            .catch(function () { return null; });
        }

        var d = (r && r.ok) ? await r.json().catch(function () { return {}; }) : {};
        var gyms = d.gyms || d.results || [];

        if (!gyms.length) {
          results.innerHTML =
            '<div style="padding:16px;text-align:center">' +
              '<p style="color:rgba(255,255,255,.3);font-size:13px;margin-bottom:6px">No gyms found for "' + q + '"</p>' +
              '<p style="color:rgba(255,255,255,.2);font-size:11px">Try a different name or ' +
              '<span onclick="navigate(\'/list-your-gym\');_sgCloseWizard()" style="color:' + BRAND + ';cursor:pointer;font-weight:600">list manually</span></p>' +
            '</div>';
          return;
        }

        results.innerHTML = gyms.slice(0, 5).map(function (g) {
          var claimed = g.claimed_by ? true : false;
          var id = g.id || g.place_id || '';
          var name = g.name || 'Gym';
          return '' +
            '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;' +
              'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);' +
              'border-radius:10px;margin-bottom:4px;cursor:' + (claimed ? 'default' : 'pointer') + ';' +
              'transition:background .15s"' +
              (claimed ? '' : ' onclick="_sgWizardClaimGym(' + id + ',\'' + encodeURIComponent(name) + '\')"') +
              ' onmouseover="this.style.background=\'rgba(255,255,255,.06)\'"' +
              ' onmouseout="this.style.background=\'rgba(255,255,255,.03)\'">' +
              '<div style="width:36px;height:36px;border-radius:10px;background:rgba(34,197,94,.1);' +
                'display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">🏢</div>' +
              '<div style="flex:1;min-width:0">' +
                '<p style="color:#fff;font-size:13px;font-weight:600;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + name + '</p>' +
                '<p style="color:rgba(255,255,255,.3);font-size:10px;margin:0">' + (g.city || g.address || g.vicinity || '') + '</p>' +
              '</div>' +
              (claimed
                ? '<span style="color:rgba(255,255,255,.25);font-size:10px;font-weight:600">Claimed</span>'
                : '<span style="color:' + GREEN + ';font-size:12px;font-weight:700;flex-shrink:0">Claim →</span>') +
            '</div>';
        }).join('');
      } catch (e) {
        results.innerHTML =
          '<div style="padding:12px;text-align:center;color:rgba(239,68,68,.6);font-size:12px">Search error — try again</div>';
      }
    }, 400);
  };

  window._sgWizardClaimGym = async function (gymId, encodedName) {
    var gymName = decodeURIComponent(encodedName || '');
    var results = document.getElementById('sg-wizard-gym-results');

    if (results) {
      results.innerHTML =
        '<div style="padding:16px;text-align:center">' +
          '<div class="sg-wizard-spinner" style="width:24px;height:24px;border:3px solid rgba(255,255,255,.1);' +
            'border-top-color:' + GREEN + ';border-radius:50%;animation:sgSpin .6s linear infinite;margin:0 auto 8px"></div>' +
          '<p style="color:rgba(255,255,255,.5);font-size:12px">Claiming ' + (gymName || 'gym') + '...</p>' +
        '</div>';
    }

    try {
      var r = await fetch('/api/gym-partner/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gymId: gymId }),
      });
      var d = await r.json();

      if (d.success) {
        _wizardState.gymId = gymId;
        _wizardState.gymName = gymName;
        window._partnerGymId = gymId;

        // Auto-confirm claim (step 3)
        await fetch('/api/gym-partner/claim/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ gymId: gymId }),
        }).catch(function () {});

        sgToast('🎉 ' + (gymName || 'Gym') + ' claimed! Now let\'s connect smart locks', 'success', 3000);
        closeWizardSheet();
        setTimeout(function () { initWizard(); }, 600);
      } else {
        sgToast(d.error || 'Claim failed — try again', 'error', 3000);
        if (results) results.innerHTML = '';
      }
    } catch (e) {
      sgToast('Network error — check your connection', 'error', 3000);
      if (results) results.innerHTML = '';
    }
  };

  window._sgWizardConnectSeam = async function () {
    var btn = document.getElementById('sg-wizard-seam-btn');
    if (btn) {
      btn.textContent = 'Connecting...';
      btn.style.opacity = '0.7';
      btn.style.pointerEvents = 'none';
    }

    var gymId = _wizardState.gymId || window._partnerGymId;
    if (!gymId) {
      sgToast('Claim a gym first', 'info', 2500);
      return;
    }

    try {
      // Try Seam Connect Webview first (best UX — OAuth-style)
      var r = await fetch('/api/access/owner/create-connect-webview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gymId: gymId }),
      });
      var d = await r.json();

      if (d.url) {
        window.open(d.url, '_blank');
        sgToast('Complete the Seam setup in the new tab, then come back here', 'info', 5000);
        closeWizardSheet();

        // Poll for completion
        var pollSeam = setInterval(async function () {
          try {
            var sr = await fetch('/api/access/owner/connection-status/' + gymId, { credentials: 'include' });
            var sd = await sr.json();
            if (sd.connected) {
              clearInterval(pollSeam);
              _wizardState.seamConnected = true;
              sgToast('🔗 Smart locks connected! Now add your bank account', 'success', 3000);
              initWizard();
            }
          } catch (e) { /* keep polling */ }
        }, 5000);
        setTimeout(function () { clearInterval(pollSeam); }, 300000); // 5 min timeout
        return;
      }

      // Fallback: direct Seam API key connection
      var apiKey = prompt('Enter your Seam API key (from console.seam.co):');
      if (!apiKey) {
        if (btn) { btn.textContent = '🔗 Connect Seam Account →'; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
        return;
      }

      r = await fetch('/api/access/owner/connect-seam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ gymId: gymId, seamApiKey: apiKey }),
      });
      d = await r.json();

      if (d.connected) {
        _wizardState.seamConnected = true;
        sgToast('🔗 Connected! Now add your bank account', 'success', 3000);
        closeWizardSheet();
        setTimeout(function () { initWizard(); }, 600);
      } else {
        sgToast(d.error || d.message || 'Connection failed', 'error', 3000);
        if (btn) { btn.textContent = '🔗 Connect Seam Account →'; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
      }
    } catch (e) {
      sgToast('Network error — try again', 'error', 3000);
      if (btn) { btn.textContent = '🔗 Connect Seam Account →'; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
    }
  };

  window._sgWizardSkipSeam = function () {
    _wizardState.seamConnected = true; // Mark as "skipped" to advance
    sgToast('Skipped — you can connect locks later from Access Control', 'info', 3000);
    closeWizardSheet();
    setTimeout(function () { initWizard(); }, 400);
  };

  window._sgWizardConnectStripe = async function () {
    var btn = document.getElementById('sg-wizard-stripe-btn');
    if (btn) {
      btn.textContent = 'Setting up Stripe...';
      btn.style.opacity = '0.7';
      btn.style.pointerEvents = 'none';
    }

    try {
      var r = await fetch('/api/gym-partner/stripe-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      var d = await r.json();

      if (d.onboardingUrl) {
        window.open(d.onboardingUrl, '_blank');
        sgToast('Complete Stripe setup in the new tab, then come back', 'info', 5000);
        closeWizardSheet();

        // Poll for Stripe completion
        var pollStripe = setInterval(async function () {
          try {
            var sr = await fetch('/api/gym-partner/stripe-connect/status', { credentials: 'include' });
            var sd = await sr.json();
            if (sd.onboardingComplete) {
              clearInterval(pollStripe);
              _wizardState.stripeConnected = true;
              _wizardState.stripeOnboarded = true;
              sgToast('🏦 Bank connected! You can now withdraw your earnings', 'success', 3000);
              initWizard();
            }
          } catch (e) { /* keep polling */ }
        }, 5000);
        setTimeout(function () { clearInterval(pollStripe); }, 300000);
      } else if (d.onboardingComplete) {
        _wizardState.stripeConnected = true;
        _wizardState.stripeOnboarded = true;
        sgToast('Stripe already connected! ✅', 'success', 2500);
        closeWizardSheet();
        setTimeout(function () { initWizard(); }, 600);
      } else {
        sgToast(d.error || 'Stripe setup failed', 'error', 3000);
        if (btn) { btn.textContent = '🏦 Connect Stripe →'; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
      }
    } catch (e) {
      sgToast('Network error — try again', 'error', 3000);
      if (btn) { btn.textContent = '🏦 Connect Stripe →'; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
    }
  };

  window._sgWizardWithdraw = async function () {
    var btn = document.getElementById('sg-wizard-withdraw-btn');
    if (btn) {
      btn.textContent = 'Processing...';
      btn.style.opacity = '0.7';
      btn.style.pointerEvents = 'none';
    }

    try {
      var r = await fetch('/api/gym-partner/request-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      var d = await r.json();

      if (d.success) {
        sgToast('💸 Payout of £' + d.amount + ' initiated! Arriving in 2-3 business days', 'success', 5000);
        closeWizardSheet();
        setTimeout(function () { initWizard(); }, 1000);
      } else {
        sgToast(d.error || 'Payout failed', 'error', 3000);
        if (btn) {
          btn.textContent = '💸 Withdraw £' + (_wizardState.balance || 0).toFixed(2) + ' →';
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
        }
      }
    } catch (e) {
      sgToast('Network error — try again', 'error', 3000);
      if (btn) { btn.textContent = '💸 Try Again'; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
    }
  };

  // ═══════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /** Add spinner animation style */
  function addWizardStyles() {
    if (document.getElementById('sg-wizard-styles')) return;
    var style = document.createElement('style');
    style.id = 'sg-wizard-styles';
    style.textContent =
      '@keyframes sgSpin{to{transform:rotate(360deg)}}' +
      '@keyframes sgWizardPulse{0%,100%{box-shadow:0 4px 24px var(--sg-glow)}50%{box-shadow:0 4px 36px var(--sg-glow)}}' +
      '#sg-wizard-fab{animation:sgWizardPulse 3s ease-in-out infinite}' +
      '#sg-wizard-sheet::-webkit-scrollbar{width:4px}' +
      '#sg-wizard-sheet::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}';
    document.head.appendChild(style);
  }

  /** Main init — detect state, render button */
  async function initWizard() {
    addWizardStyles();
    await detectPartnerState();

    // Set CSS variable for pulse glow color
    var step = STEPS[_wizardState.currentStep];
    document.documentElement.style.setProperty('--sg-glow', step.color + '30');

    // Insert into the partner page
    var partnerPage = document.querySelector('[style*="position:fixed"][style*="bottom:56px"]');
    if (!partnerPage) {
      // Fallback: find partner screen container
      var screens = document.querySelectorAll('.partner-screen');
      if (screens.length > 0) partnerPage = screens[0].parentElement;
    }
    if (!partnerPage) return;

    // Remove old wizard elements
    var oldFab = document.getElementById('sg-wizard-fab');
    var oldDots = document.getElementById('sg-wizard-dots');
    if (oldFab) oldFab.remove();
    if (oldDots) oldDots.remove();

    // Remove the original 3 side buttons (Sign In, Connect Seam, Withdraw, More)
    var sideBtns = partnerPage.querySelectorAll('.partner-side-btn');
    sideBtns.forEach(function (btn) { btn.style.display = 'none'; });

    // Also hide the more menu
    var moreMenu = document.getElementById('partner-more-menu');
    if (moreMenu) moreMenu.style.display = 'none';

    // Add new wizard FAB and dots
    partnerPage.appendChild(renderNextStepButton());
    partnerPage.appendChild(renderProgressDots());
  }

  // ═══════════════════════════════════════════════════════════════
  //  BOOT — Hook into partner page load
  // ═══════════════════════════════════════════════════════════════

  // Re-run wizard init whenever partner page is rendered
  var _origPartnerFullPage = window.PartnerFullPage;
  if (typeof _origPartnerFullPage === 'function') {
    window.PartnerFullPage = function () {
      var html = _origPartnerFullPage();
      // Init wizard after DOM update
      setTimeout(initWizard, 300);
      return html;
    };
  }

  // Also hook into navigation
  var _origNavigate = window.navigate;
  if (typeof _origNavigate === 'function') {
    window.navigate = function (path) {
      _origNavigate(path);
      if (path === '/partner' || path === '/partner/') {
        setTimeout(initWizard, 500);
      }
    };
  }

  // Init on first load if already on partner page
  if (window.location.pathname === '/partner' || window.location.pathname === '/partner/') {
    setTimeout(initWizard, 500);
  }

  // Expose for external use
  window._sgPartnerWizard = {
    init: initWizard,
    getState: function () { return _wizardState; },
    open: openWizardSheet,
    close: closeWizardSheet,
  };

  console.log('[ScanGym] Partner Wizard loaded — 5-step guided flow active');
})();
