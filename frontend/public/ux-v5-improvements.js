/* ═══════════════════════════════════════════════════════════════════════════
   UX V5 IMPROVEMENTS — 5 fixes for faster, easier lock setup
   ═══════════════════════════════════════════════════════════════════════════
   1. ✅ Locks button → Smart Lock Finder (already done in smart-lock-finder.js)
   2. Auto-open lock finder after claiming (skip extra clicks)
   3. Request brands → better messaging with Staff QR fallback
   4. Seam Connect → in-app iframe instead of new tab
   5. PIN delivery → loading spinner + auto-refresh
   
   Loaded AFTER smart-lock-finder.js and batch3.js
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

// ═════════════════════════════════════════════════════════════════════
// FIX #2: After verification → open Smart Lock Finder directly
// ═════════════════════════════════════════════════════════════════════
// Old: navigated to /gympartners-dashboard/connect-access (dead page)
// New: opens the Smart Lock Finder sheet right here

var _waitLockSetup = setInterval(function(){
  // Wait for batch3's _sgB3GoToLockSetup to exist, then override
  if(typeof window._sgB3GoToLockSetup !== 'function') return;
  clearInterval(_waitLockSetup);

  window._sgB3GoToLockSetup = function(gymId){
    // Close the verification sheet
    if(typeof window._sgCloseSheet === 'function') window._sgCloseSheet('sg-own-sheet');
    // Store gymId so the Smart Lock Finder knows which gym
    if(gymId) window._partnerGymId = gymId;
    // Small delay for sheet close animation, then open the finder
    setTimeout(function(){
      if(typeof window._slfOpenFinder === 'function'){
        window._slfOpenFinder();
      } else if(typeof window._partnerConnectSeam === 'function'){
        window._partnerConnectSeam();
      }
    }, 350);
  };
}, 200);

// Also patch: if the "Connect Lock System →" CTA in showLockSetupPrompt
// hasn't loaded yet, keep checking
var _waitLockSetup2 = setInterval(function(){
  if(typeof window._sgB3GoToLockSetup !== 'function') return;
  // Already patched above, just clear
  clearInterval(_waitLockSetup2);
}, 500);


// ═════════════════════════════════════════════════════════════════════
// FIX #3: Better "Request" brands messaging
// ═════════════════════════════════════════════════════════════════════
// Override _slfShowRequestForm with more prominent Staff QR fallback

var _waitRequest = setInterval(function(){
  if(typeof window._slfSubmitRequest !== 'function') return;
  clearInterval(_waitRequest);

  // Save original submit handler
  var _origSubmitRequest = window._slfSubmitRequest;

  // Override the request form to add better messaging
  var _origSlfSelectProvider = window._slfSelectProvider;
  if(!_origSlfSelectProvider) return;

  // We'll inject a better message into the request form after it renders
  // by overriding the request provider's form display
  var _origOpenFinder = window._slfOpenFinder;

  // Enhance: after any request form opens, inject a prominent staff verify CTA
  var _checkRequestForm = setInterval(function(){
    var reqBtn = document.querySelector('#slf-req-btn');
    if(!reqBtn) return;
    // Check if we already enhanced
    if(reqBtn.getAttribute('data-v5-enhanced')) return;
    reqBtn.setAttribute('data-v5-enhanced','1');

    // Find the staff QR button and make it more prominent
    var staffBtns = document.querySelectorAll('.slf-btn-secondary');
    staffBtns.forEach(function(btn){
      if(btn.textContent.indexOf('Staff QR') !== -1){
        // Make it more prominent with green styling
        btn.style.background = 'rgba(34,197,94,.1)';
        btn.style.border = '2px solid rgba(34,197,94,.3)';
        btn.style.color = '#4ade80';
        btn.style.fontWeight = '700';
        btn.innerHTML = '👤 Use Staff QR Verification Now →<br><span style="font-size:10px;color:rgba(255,255,255,.4);font-weight:400">Works immediately — visitors show QR, staff verifies</span>';
      }
    });
  }, 300);

}, 300);


// ═════════════════════════════════════════════════════════════════════
// FIX #4: Seam Connect → in-app iframe overlay instead of new tab
// ═════════════════════════════════════════════════════════════════════
// Inject CSS for the iframe overlay
if(!document.getElementById('ux-v5-css')){
  var s = document.createElement('style'); s.id = 'ux-v5-css';
  s.textContent = ''
    + '#sg-seam-iframe-overlay{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;flex-direction:column;animation:slfFadeIn .2s}'
    + '#sg-seam-iframe-overlay.active{display:flex}'
    + '#sg-seam-iframe-wrap{width:100%;max-width:460px;height:85vh;max-height:700px;background:#fff;border-radius:20px;overflow:hidden;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.5)}'
    + '#sg-seam-iframe{width:100%;height:100%;border:none}'
    + '#sg-seam-iframe-close{position:absolute;top:12px;right:12px;width:36px;height:36px;background:rgba(0,0,0,.5);border:none;border-radius:50%;color:#fff;font-size:18px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;transition:.15s}'
    + '#sg-seam-iframe-close:hover{background:rgba(0,0,0,.7)}'
    + '#sg-seam-iframe-header{background:#111;color:#fff;padding:14px 16px;font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px}'
    + '#sg-seam-iframe-spinner{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#fff}'
    + '@keyframes slfFadeIn{from{opacity:0}to{opacity:1}}'
    // PIN polling spinner
    + '@keyframes sgPinPulse{0%,100%{opacity:.6}50%{opacity:1}}'
    + '.sg-pin-polling{animation:sgPinPulse 1.5s ease-in-out infinite}'
    ;
  document.head.appendChild(s);
}

// Create the overlay element once
var overlay = document.createElement('div');
overlay.id = 'sg-seam-iframe-overlay';
overlay.innerHTML = ''
  + '<div id="sg-seam-iframe-wrap">'
  + '<div id="sg-seam-iframe-header"><span>🔐</span> <span id="sg-seam-iframe-title">Connecting your lock system…</span></div>'
  + '<button id="sg-seam-iframe-close" onclick="window._sgCloseSeamIframe()">✕</button>'
  + '<div id="sg-seam-iframe-spinner"><div class="slf-spinner" style="width:32px;height:32px;border-width:3px"></div></div>'
  + '<iframe id="sg-seam-iframe" allow="camera;microphone" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"></iframe>'
  + '</div>';
document.body.appendChild(overlay);

window._sgOpenSeamIframe = function(url, providerName, gymId, webviewId){
  var ov = document.getElementById('sg-seam-iframe-overlay');
  var iframe = document.getElementById('sg-seam-iframe');
  var title = document.getElementById('sg-seam-iframe-title');
  var spinner = document.getElementById('sg-seam-iframe-spinner');

  if(title) title.textContent = 'Connect ' + (providerName || 'Lock System');
  if(spinner) spinner.style.display = 'flex';
  if(iframe){
    iframe.src = url;
    iframe.onload = function(){ if(spinner) spinner.style.display = 'none'; };
  }
  if(ov) ov.classList.add('active');

  // Start polling for completion
  if(webviewId && gymId){
    window._sgSeamIframePoll = setInterval(async function(){
      try{
        var r = await fetch('/api/access/owner/complete-connect', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          credentials: 'include',
          body: JSON.stringify({ gymId: gymId, connectWebviewId: webviewId })
        });
        var d = await r.json();
        if(d.connected){
          clearInterval(window._sgSeamIframePoll);
          window._sgSeamIframePoll = null;
          window._sgSeamIframeConnected = true; // flag so SLF poll skips duplicate toast
          window._sgCloseSeamIframe();
          if(typeof _slfToast === 'function') _slfToast('🎉 ' + (providerName||'Lock') + ' connected! Visitors will get auto door access.', 'success', 5000);
          else if(typeof sgToast === 'function') sgToast('🎉 ' + (providerName||'Lock') + ' connected!', 'success', 5000);
        }
      } catch(e){}
    }, 3000);
  }
};

window._sgCloseSeamIframe = function(){
  var ov = document.getElementById('sg-seam-iframe-overlay');
  var iframe = document.getElementById('sg-seam-iframe');
  if(ov) ov.classList.remove('active');
  if(iframe) iframe.src = 'about:blank';
  if(window._sgSeamIframePoll) clearInterval(window._sgSeamIframePoll);
};

// Close on backdrop click
overlay.addEventListener('click', function(e){
  if(e.target === overlay) window._sgCloseSeamIframe();
});

// Override the Seam Connect flow to use iframe instead of window.open
var _waitSeamOverride = setInterval(function(){
  // Wait for _slfStartSeamConnect to be overridable (it's a local function in smart-lock-finder.js)
  // Since it's not on window, we override _slfSelectProvider instead
  if(typeof window._slfSelectProvider !== 'function') return;
  clearInterval(_waitSeamOverride);

  // Override the connect webview opener on the existing button handlers
  // The connect flow goes through _sgSeamConnectExisting which does window.open
  // Override that:
  var _origConnectExisting = window._sgSeamConnectExisting;
  window._sgSeamConnectExisting = async function(){
    var gymId = window._partnerGymId || 0;
    if(!gymId){
      try{
        var dr = await fetch('/api/gym-partner/dashboard', {credentials:'include'});
        var dd = await dr.json();
        if(dd.gyms && dd.gyms.length > 0){ gymId = dd.gyms[0].id; window._partnerGymId = gymId; }
      }catch(e){}
    }
    if(!gymId){
      if(typeof sgToast === 'function') sgToast('Claim a gym first before connecting smart access','info',3000);
      return;
    }
    if(typeof sgToast === 'function') sgToast('Connecting smart access...','info',2000);
    try{
      var r = await fetch('/api/access/owner/create-connect-webview', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        credentials: 'include', body: JSON.stringify({gymId: gymId})
      });
      var d = await r.json();
      var url = d.url || d.connectUrl || d.connect_url;
      if(url){
        // Use iframe instead of new tab
        window._sgOpenSeamIframe(url, 'Smart Access', gymId, d.connect_webview_id);
      } else {
        if(typeof sgToast === 'function') sgToast('Could not create connection — try again','error',3000);
      }
    }catch(ex){
      if(typeof sgToast === 'function') sgToast('Could not reach access system','error',3000);
    }
  };

  // Also override the Smart Lock Finder's Seam connect to use iframe
  // We need to intercept the fetch call that creates the webview and redirect to iframe
  // The _slfStartSeamConnect function is inside smart-lock-finder.js IIFE
  // So we monkey-patch the fetch to intercept window.open calls
  var _origWindowOpen = window.open;
  window.open = function(url, target){
    // Check if this is a Seam Connect Webview URL
    if(url && typeof url === 'string' && url.indexOf('connect.getseam.com/connect_webviews') !== -1){
      // Intercept and open in iframe instead
      var gymId = window._partnerGymId || 0;
      // Extract connect_webview_id from URL so iframe polling can detect auth completion
      var webviewId = null;
      try {
        var u = new URL(url);
        webviewId = u.searchParams.get('connect_webview_id');
      } catch(e) {
        var match = url.match(/connect_webview_id=([^&]+)/);
        if(match) webviewId = match[1];
      }
      window._sgOpenSeamIframe(url, 'Smart Lock', gymId, webviewId);
      return null; // Don't open new tab
    }
    // For all other window.open calls, use the original
    return _origWindowOpen.apply(window, arguments);
  };

}, 300);


// ═════════════════════════════════════════════════════════════════════
// FIX #5: PIN delivery → loading spinner + auto-refresh
// ═════════════════════════════════════════════════════════════════════
// After booking, if access credential isn't ready yet, show a spinner
// and poll every few seconds until the PIN/QR/key appears

var _pinPollInterval = null;

function startPinPolling(bookingId){
  if(_pinPollInterval) clearInterval(_pinPollInterval);
  var attempts = 0;
  var maxAttempts = 40; // 40 × 3s = 2 minutes max

  _pinPollInterval = setInterval(async function(){
    attempts++;
    if(attempts > maxAttempts){
      clearInterval(_pinPollInterval);
      // Show fallback message
      var container = document.getElementById('sg-access-polling');
      if(container){
        container.innerHTML = ''
          + '<div style="text-align:center;padding:16px">'
          + '<p style="color:rgba(255,255,255,.5);font-size:13px">Access code is taking longer than expected.</p>'
          + '<p style="color:rgba(255,255,255,.3);font-size:11px;margin-top:4px">Please show your QR code at reception instead.</p>'
          + '</div>';
      }
      return;
    }

    try{
      var r = await fetch('/api/access/credential/' + bookingId, {credentials: 'include'});
      if(!r.ok) return;
      var d = await r.json();
      // Map credential response to the access format the UI expects
      var cred = d.credential;
      if(cred){
        var ac = {
          type: cred.credential_type || cred.type || '',
          pin: cred.pin_code || cred.pin || null,
          access_url: cred.access_url || null,
          access_qr_url: cred.access_qr_url || null,
          mobile_key: cred.mobile_key || null,
          instructions: cred.instructions || null,
          starts_at: cred.starts_at || cred.valid_from || null,
          ends_at: cred.ends_at || cred.valid_until || null,
        };
        if(ac.pin || ac.access_url || ac.mobile_key){
          clearInterval(_pinPollInterval);
          state.lastAccess = ac;
          renderAccessCredential(ac);
        }
      }
    } catch(e){}
  }, 3000);
}

function renderAccessCredential(ac){
  var container = document.getElementById('sg-access-polling');
  if(!container) return;

  var html = '';
  if(ac.type === 'kisi_access_link' && ac.access_url){
    html = ''
      + '<div style="background:linear-gradient(135deg,rgba(34,197,94,.1),rgba(16,185,129,.05));border-radius:16px;border:1px solid rgba(34,197,94,.3);padding:20px;text-align:center">'
      + '<p style="color:#4ade80;font-weight:700;font-size:16px;margin:0 0 4px">🔓 Door Access Ready</p>'
      + '<p style="color:rgba(255,255,255,.5);font-size:12px;margin:0 0 12px">' + (ac.instructions || 'Scan this at the gym door reader to unlock') + '</p>'
      + (ac.access_qr_url ? '<div style="background:#fff;border-radius:14px;padding:12px;display:inline-block;margin-bottom:10px"><img src="' + ac.access_qr_url + '" style="width:140px;height:140px"></div>' : '')
      + '<a href="' + ac.access_url + '" target="_blank" style="display:block;width:100%;background:#22c55e;color:#fff;font-weight:700;padding:14px;border-radius:12px;text-align:center;text-decoration:none;font-size:15px;box-sizing:border-box">🚪 Tap to Unlock Door</a>'
      + '<p style="color:rgba(255,255,255,.3);font-size:10px;margin-top:8px">Valid: ' + new Date(ac.starts_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' — ' + new Date(ac.ends_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</p>'
      + '</div>';
  } else if(ac.pin){
    html = ''
      + '<div style="background:linear-gradient(135deg,rgba(59,130,246,.1),rgba(99,102,241,.05));border-radius:16px;border:1px solid rgba(59,130,246,.3);padding:20px;text-align:center">'
      + '<p style="color:#60a5fa;font-weight:700;font-size:16px;margin:0 0 4px">🔢 Your Door PIN</p>'
      + '<p style="color:rgba(255,255,255,.5);font-size:12px;margin:0 0 12px">' + (ac.instructions || 'Enter this PIN at the gym keypad') + '</p>'
      + '<div style="background:rgba(0,0,0,.3);border-radius:12px;padding:16px 24px;display:inline-block"><p style="font-size:36px;font-family:monospace;font-weight:800;color:#fff;letter-spacing:0.3em;margin:0">' + ac.pin + '</p></div>'
      + '<p style="color:rgba(255,255,255,.3);font-size:10px;margin-top:8px">Valid: ' + new Date(ac.starts_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' — ' + new Date(ac.ends_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</p>'
      + '<p onclick="navigator.clipboard.writeText(\'' + ac.pin + '\');if(typeof sgToast===\'function\')sgToast(\'PIN copied!\',\'success\',1500)" style="color:#60a5fa;font-size:12px;font-weight:600;cursor:pointer;margin-top:6px">📋 Copy PIN</p>'
      + '</div>';
  } else if(ac.mobile_key){
    html = ''
      + '<div style="background:linear-gradient(135deg,rgba(168,85,247,.1),rgba(139,92,246,.05));border-radius:16px;border:1px solid rgba(168,85,247,.3);padding:20px;text-align:center">'
      + '<p style="color:#a78bfa;font-weight:700;font-size:16px;margin:0 0 4px">📱 Mobile Key Sent</p>'
      + '<p style="color:rgba(255,255,255,.5);font-size:12px;margin:0">' + (ac.instructions || 'Check your phone — hold it near the door reader to unlock.') + '</p>'
      + '</div>';
  }

  if(html){
    container.innerHTML = html;
    container.style.animation = 'slfFadeIn .3s';
    // Haptic feedback
    if(navigator.vibrate) navigator.vibrate([50, 30, 80]);
    if(typeof sgToast === 'function') sgToast('🔑 Your door access is ready!', 'success', 3000);
  }
}

// Inject polling container into booking success page when access isn't ready yet
function checkAndInjectPinPolling(){
  // Only on booking-success page
  var path = window.location.pathname || '';
  if(path.indexOf('/booking-success') === -1) return;

  // If access already loaded, skip
  if(state && state.lastAccess && (state.lastAccess.pin || state.lastAccess.access_url || state.lastAccess.mobile_key)) return;

  // Check if polling container already exists
  if(document.getElementById('sg-access-polling')) return;

  // Find the "What happens next" section or QR code section
  var qrSection = document.querySelector('.bg-card.rounded-2xl.border.border-slate-700.p-6.mb-4.text-center');
  if(!qrSection) return;

  // Get booking ID from URL
  var params = new URLSearchParams(window.location.search);
  var bookingId = params.get('booking_id');
  if(!bookingId) return;

  // Check if gym has access control before showing the spinner
  // Only show polling if the gym actually has smart locks connected
  (async function(){
    try{
      var r = await fetch('/api/access/credential/' + bookingId, {credentials: 'include'});
      if(!r.ok) return;
      var d = await r.json();
      // If gym has no access control, don't show spinner
      if(!d.has_access_control) return;
      // If credential already ready, render it directly
      if(d.credential && (d.credential.pin_code || d.credential.pin || d.credential.access_url || d.credential.mobile_key)){
        var ac = {
          type: d.credential.credential_type || d.credential.type || '',
          pin: d.credential.pin_code || d.credential.pin || null,
          access_url: d.credential.access_url || null,
          access_qr_url: d.credential.access_qr_url || null,
          mobile_key: d.credential.mobile_key || null,
          instructions: d.credential.instructions || null,
          starts_at: d.credential.starts_at || d.credential.valid_from || null,
          ends_at: d.credential.ends_at || d.credential.valid_until || null,
        };
        state.lastAccess = ac;
        var pollingDiv = document.createElement('div');
        pollingDiv.id = 'sg-access-polling';
        qrSection.parentNode.insertBefore(pollingDiv, qrSection.nextSibling);
        renderAccessCredential(ac);
        return;
      }
      // Gym has access control but credential not ready yet — show spinner
      var pollingDiv = document.createElement('div');
      pollingDiv.id = 'sg-access-polling';
      pollingDiv.innerHTML = ''
        + '<div style="background:linear-gradient(135deg,rgba(255,109,0,.06),rgba(255,109,0,.02));border-radius:16px;border:1px solid rgba(255,109,0,.15);padding:20px;text-align:center;margin-bottom:16px">'
        + '<div class="sg-pin-polling" style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px">'
        + '<div class="slf-spinner" style="width:20px;height:20px;border-width:2px"></div>'
        + '<p style="color:#FF6D00;font-weight:700;font-size:14px;margin:0">Getting your door access…</p>'
        + '</div>'
        + '<p style="color:rgba(255,255,255,.4);font-size:12px;margin:0">Your PIN or access code is being set up. This usually takes a few seconds.</p>'
        + '</div>';
      qrSection.parentNode.insertBefore(pollingDiv, qrSection.nextSibling);
      startPinPolling(bookingId);
    }catch(e){}
  })();
}

// Check periodically for the booking success page
setInterval(checkAndInjectPinPolling, 1000);


// ═════════════════════════════════════════════════════════════════════
// BONUS: Ensure Smart Lock Finder overrides the old _partnerConnectSeam
// even if script load order changes
// ═════════════════════════════════════════════════════════════════════
var _waitFinalOverride = setInterval(function(){
  if(typeof window._slfOpenFinder !== 'function') return;
  clearInterval(_waitFinalOverride);

  // Ensure _partnerConnectSeam always opens the Smart Lock Finder
  window._partnerConnectSeam = function(){
    var u = (typeof state !== 'undefined' && state) ? state.user : null;
    if(!u){
      if(typeof sgToast === 'function') sgToast('Sign in to connect your lock system', 'info', 2000);
      if(typeof window._sgShowAuthSheet === 'function') window._sgShowAuthSheet('book');
      else if(typeof navigate === 'function') navigate('/login');
      return;
    }
    window._slfOpenFinder();
  };
}, 200);


// ═════════════════════════════════════════════════════════════════════
// UX V6: Post-connect celebration panel
// ═════════════════════════════════════════════════════════════════════
// After lock connect success → close finder, show celebration with
// next steps instead of just a toast.

window._slfShowConnectSuccess = function(gymId, providerName) {
  // Close the lock finder sheet first
  if(typeof window._sgCloseSheet === 'function') window._sgCloseSheet('slf-finder-sheet');
  if(typeof _ctaCloseSheet === 'function') _ctaCloseSheet();

  // Small delay for sheet close animation
  setTimeout(function(){
    var html = ''
      + '<div style="text-align:center;padding:8px 0 0">'
      + '<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,rgba(34,197,94,.2),rgba(16,185,129,.1));display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 16px;animation:sgLockPop .5s cubic-bezier(.17,.67,.21,1.28)">\uD83C\uDF89</div>'
      + '<p style="font-size:22px;font-weight:900;color:#fff;margin:0 0 6px">All Set!</p>'
      + '<p style="color:rgba(255,255,255,.5);font-size:14px;line-height:1.5;margin:0 0 24px">'
      + '<strong style="color:#4ade80">' + (providerName || 'Smart Lock') + '</strong> is connected. Visitors now get auto door access with every booking.</p>'
      + '</div>'

      // How it works
      + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px;margin-bottom:20px">'
      + '<p style="font-size:13px;font-weight:700;color:#fff;margin:0 0 14px">\u26A1 What happens now</p>'
      + '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px">'
      + '<div style="width:24px;height:24px;border-radius:50%;background:rgba(34,197,94,.15);color:#22c55e;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">1</div>'
      + '<p style="color:rgba(255,255,255,.6);font-size:12px;line-height:1.4;margin:0"><b style="color:#fff">Customer books a day pass</b> \u2014 pays through ScanGym</p>'
      + '</div>'
      + '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px">'
      + '<div style="width:24px;height:24px;border-radius:50%;background:rgba(34,197,94,.15);color:#22c55e;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">2</div>'
      + '<p style="color:rgba(255,255,255,.6);font-size:12px;line-height:1.4;margin:0"><b style="color:#fff">Auto PIN/QR generated</b> \u2014 works only during booked time</p>'
      + '</div>'
      + '<div style="display:flex;gap:10px;align-items:flex-start">'
      + '<div style="width:24px;height:24px;border-radius:50%;background:rgba(34,197,94,.15);color:#22c55e;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">3</div>'
      + '<p style="color:rgba(255,255,255,.6);font-size:12px;line-height:1.4;margin:0"><b style="color:#fff">You earn 85%</b> \u2014 auto-deposited to your wallet</p>'
      + '</div>'
      + '</div>'

      // Quick action buttons
      + '<button onclick="window._slfSuccessAction(\'price\', ' + gymId + ')" style="width:100%;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;padding:15px;border-radius:14px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 20px rgba(255,109,0,.3);margin-bottom:10px">\uD83D\uDCB0 Set Day Pass Price \u2192</button>'
      + '<button onclick="window._slfSuccessAction(\'dashboard\', ' + gymId + ')" style="width:100%;background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.12);padding:14px;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px">\uD83D\uDCCA Go to Dashboard</button>'
      + '<button onclick="if(typeof _ctaCloseSheet===\'function\')_ctaCloseSheet();if(typeof window._sgCloseSheet===\'function\')window._sgCloseSheet(\'sg-connect-success\');" style="width:100%;background:none;color:rgba(255,255,255,.4);border:none;padding:10px;font-size:13px;font-weight:600;cursor:pointer">Done</button>';

    if(typeof window._sgOpenSheet === 'function') {
      window._sgOpenSheet('sg-connect-success', html);
    } else if(typeof _ctaOpenSheet === 'function') {
      _ctaOpenSheet(html);
    }

    // Add animation keyframes if not present
    if(!document.getElementById('sg-lock-pop-css')){
      var st=document.createElement('style');st.id='sg-lock-pop-css';
      st.textContent='@keyframes sgLockPop{0%{transform:scale(0)}100%{transform:scale(1)}}';
      document.head.appendChild(st);
    }

    // Haptic feedback on mobile
    if(navigator.vibrate) navigator.vibrate([50, 30, 80, 30, 100]);

    // Refresh dashboard data in background
    if(typeof window._peLoadAndRender === 'function') window._peLoadAndRender();
    if(typeof window._partnerLoadGymProfile === 'function') window._partnerLoadGymProfile();
  }, 400);
};

// Success action handlers
window._slfSuccessAction = function(action, gymId) {
  if(typeof window._sgCloseSheet === 'function') window._sgCloseSheet('sg-connect-success');
  if(typeof _ctaCloseSheet === 'function') _ctaCloseSheet();

  if(action === 'price') {
    // Open price editor
    setTimeout(function(){
      if(typeof window._peEditPrice === 'function') {
        window._peEditPrice(gymId, 5.00);
      }
    }, 350);
  } else if(action === 'dashboard') {
    // Reload dashboard
    if(typeof window._partnerLoadGymProfile === 'function') window._partnerLoadGymProfile();
  }
};


// ═════════════════════════════════════════════════════════════════════
// UX V6: Live lock status on dashboard
// ═════════════════════════════════════════════════════════════════════
// Replace static lock button label with live Connected/Not Connected
// status. Check on dashboard load.

window._sgUpdateLockStatus = async function(gymId) {
  if(!gymId) return;
  try {
    var r = await fetch('/api/access/owner/connection-status/' + gymId, {credentials: 'include'});
    if(!r.ok) return;
    var d = await r.json();
    window._sgLockConnected = d.connected;
    window._sgLockSystem = d.system || null;

    // Update the Locks action button label if it exists
    var lockLabels = document.querySelectorAll('.pe-action-label');
    lockLabels.forEach(function(el) {
      if(el.textContent.trim() === 'Locks' || el.textContent.trim() === 'Connected \u2705' || el.textContent.trim() === 'Locks \u2192') {
        if(d.connected) {
          el.textContent = 'Connected \u2705';
          el.style.color = '#4ade80';
        } else {
          el.textContent = 'Locks \u2192';
        }
      }
    });

    // Update lock button icon
    var lockBtns = document.querySelectorAll('.pe-action-btn');
    lockBtns.forEach(function(btn) {
      if(btn.textContent.trim() === '\uD83D\uDD10' || btn.textContent.trim() === '\u2705\uD83D\uDD10') {
        if(d.connected) {
          btn.style.filter = 'drop-shadow(0 2px 4px rgba(34,197,94,.5))';
          btn.style.opacity = '1';
        }
      }
    });
  } catch(e) {}
};

// Auto-check lock status when partner page loads
var _lockStatusCheckInterval = setInterval(function(){
  // Wait for dashboard to be loaded and a gym to be available
  if(!window._partnerGymId) return;
  clearInterval(_lockStatusCheckInterval);
  window._sgUpdateLockStatus(window._partnerGymId);
}, 1500);


// ═════════════════════════════════════════════════════════════════════
// UX V6: Seam iframe auto-close + celebration integration
// ═════════════════════════════════════════════════════════════════════
// Patch the iframe poll to trigger the celebration panel too

var _waitIframePatch = setInterval(function(){
  if(typeof window._sgOpenSeamIframe !== 'function') return;
  clearInterval(_waitIframePatch);

  var _origOpenSeamIframe = window._sgOpenSeamIframe;
  window._sgOpenSeamIframe = function(url, providerName, gymId, webviewId) {
    // Call original to set up iframe + polling
    _origOpenSeamIframe(url, providerName, gymId, webviewId);

    // Patch the existing poll to also trigger celebration
    if(window._sgSeamIframePoll) {
      // The original poll already handles success. We add a second
      // listener that watches for the connected flag and shows celebration.
      var _celebrationPoll = setInterval(function(){
        if(window._sgSeamIframeConnected) {
          clearInterval(_celebrationPoll);
          // Celebration shown after a small delay so toast appears first
          setTimeout(function(){
            if(typeof window._slfShowConnectSuccess === 'function') {
              window._slfShowConnectSuccess(gymId, providerName);
            }
          }, 1500);
        }
        // Stop polling if iframe is closed without connecting
        var ov = document.getElementById('sg-seam-iframe-overlay');
        if(ov && !ov.classList.contains('active') && !window._sgSeamIframeConnected) {
          clearInterval(_celebrationPoll);
        }
      }, 1000);
    }
  };
}, 300);


console.log('[UX-V6] Post-connect celebration + live lock status loaded');
})();
