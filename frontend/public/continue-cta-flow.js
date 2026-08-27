/* ═══════════════════════════════════════════════════════════════════════════
   CONTINUE CTA FLOW — Partner Tab + Creator Tab
   Progressive "Continue" button that guides users through:
     Partner: Sign In → Connect Smart Access → Wallet/Withdraw
     Creator: Sign In → Add Withdraw Method → Confirm & Withdraw
   
   Purely additive — no existing functions touched.
   ═══════════════════════════════════════════════════════════════════════════ */

(function(){
'use strict';

// ══════════════════════════════════════════════════════════════════════
// SHARED: Half-page bottom sheet system (reusable for both tabs)
// ══════════════════════════════════════════════════════════════════════

var _ctaSheetEl=null;
var _ctaOverlayEl=null;

function _ctaCreateSheet(){
  if(_ctaSheetEl)return;
  // Overlay
  _ctaOverlayEl=document.createElement('div');
  _ctaOverlayEl.id='sg-cta-overlay';
  _ctaOverlayEl.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9499;opacity:0;transition:opacity .3s;pointer-events:none';
  _ctaOverlayEl.onclick=function(){_ctaCloseSheet();};
  document.body.appendChild(_ctaOverlayEl);
  // Sheet
  _ctaSheetEl=document.createElement('div');
  _ctaSheetEl.id='sg-cta-sheet';
  _ctaSheetEl.style.cssText='position:fixed;bottom:0;left:0;right:0;height:55vh;background:rgba(18,18,32,.98);backdrop-filter:blur(24px);border-radius:20px 20px 0 0;z-index:9500;transform:translateY(100%);transition:transform .35s cubic-bezier(.32,.72,0,1);box-shadow:0 -8px 40px rgba(0,0,0,.5);overflow:hidden;display:flex;flex-direction:column';
  document.body.appendChild(_ctaSheetEl);
}

function _ctaOpenSheet(html){
  _ctaCreateSheet();
  _ctaSheetEl.innerHTML='<div style="width:40px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin:10px auto;flex-shrink:0"></div>'
    +'<div style="padding:0 20px 20px;overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch">'+html+'</div>';
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    _ctaSheetEl.style.transform='translateY(0)';
    _ctaOverlayEl.style.opacity='1';
    _ctaOverlayEl.style.pointerEvents='auto';
  });});
}

window._ctaOpenSheet=_ctaOpenSheet; // export for partner-editable.js sheets (was IIFE-private — all pe- sheets silently no-op'd)

function _ctaCloseSheet(){
  if(_ctaSheetEl)_ctaSheetEl.style.transform='translateY(100%)';
  if(_ctaOverlayEl){_ctaOverlayEl.style.opacity='0';_ctaOverlayEl.style.pointerEvents='none';}
}
window._ctaCloseSheet=_ctaCloseSheet;


// ══════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════
// SHARED: Check if partner has smart access connected
// ══════════════════════════════════════════════════════════════════════

function _hasSeamConnected(){
  try{
    var pd=JSON.parse(localStorage.getItem('sg_partner')||'null');
    if(pd&&pd.seamConnected)return true;
  }catch(e){}
  return false;
}


// ══════════════════════════════════════════════════════════════════════
// PARTNER: "Connect Smart Access" half-page popup
// Two options: connect existing account OR create new one
// ══════════════════════════════════════════════════════════════════════

function _showSeamConnectSheet(onComplete){
  var html=''
    // Header
    +'<div style="text-align:center;margin-bottom:20px">'
    +'<div style="font-size:40px;margin-bottom:8px">🔐</div>'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Connect Smart Locks</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Let customers unlock your gym doors automatically</p>'
    +'</div>'

    // Progress dots (Step 2 of 3)
    +'<div style="display:flex;justify-content:center;gap:6px;margin-bottom:20px">'
    +'<div style="width:6px;height:6px;border-radius:3px;background:#22c55e"></div>'
    +'<div style="width:10px;height:6px;border-radius:3px;background:#fff"></div>'
    +'<div style="width:6px;height:6px;border-radius:3px;background:rgba(255,255,255,.3)"></div>'
    +'</div>'

    // Option 1: I have a smart access account
    +'<div id="sg-seam-opt-existing" onclick="window._ctaSelectSeamOpt(\'existing\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:rgba(255,109,0,.06);border:2px solid rgba(255,109,0,.3);border-radius:16px;cursor:pointer;margin-bottom:10px;transition:all .15s">'
    +'<div style="width:48px;height:48px;background:linear-gradient(135deg,#6366f1,#818cf8);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#fff;font-size:20px">🔑</span></div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">I have a smart access account</div><div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">Connect your existing access system API key</div></div>'
    +'<div style="width:20px;height:20px;border:2px solid #FF6D00;border-radius:50%;display:flex;align-items:center;justify-content:center"><div id="sg-seam-dot-existing" style="width:10px;height:10px;background:#FF6D00;border-radius:50%"></div></div>'
    +'</div>'

    // Option 2: Create new smart access account
    +'<div id="sg-seam-opt-new" onclick="window._ctaSelectSeamOpt(\'new\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:rgba(255,255,255,.03);border:2px solid rgba(255,255,255,.08);border-radius:16px;cursor:pointer;margin-bottom:10px;transition:all .15s">'
    +'<div style="width:48px;height:48px;background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#fff;font-size:20px">✨</span></div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">Create new smart access account</div><div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">Free sign-up · Connect any smart lock brand</div></div>'
    +'<div style="width:20px;height:20px;border:2px solid rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center"><div id="sg-seam-dot-new" style="width:10px;height:10px;background:transparent;border-radius:50%"></div></div>'
    +'</div>'

    // Dynamic form area
    +'<div id="sg-seam-form-area" style="margin-top:16px"></div>'

    // Error
    +'<p id="sg-seam-error" style="color:#ef4444;font-size:13px;margin-top:8px;display:none"></p>'

    // Connect button
    +'<button id="sg-seam-connect-btn" onclick="window._ctaConnectSeam()" style="width:100%;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px;transition:all .2s;box-shadow:0 4px 20px rgba(255,109,0,.3)">Connect Smart Access →</button>'

    // Skip option
    +'<button onclick="window._ctaSkipSeam()" style="width:100%;background:none;border:none;color:rgba(255,255,255,.35);font-size:13px;font-weight:500;cursor:pointer;padding:12px;margin-top:4px">Skip for now — I\'ll set up later</button>';

  _ctaOpenSheet(html);
  window._ctaSeamCallback=onComplete;
  window._ctaSelectedSeamOpt='existing';
  _renderSeamForm('existing');
}

window._ctaSelectSeamOpt=function(type){
  window._ctaSelectedSeamOpt=type;
  var types=['existing','new'];
  types.forEach(function(t){
    var opt=document.getElementById('sg-seam-opt-'+t);
    var dot=document.getElementById('sg-seam-dot-'+t);
    if(opt){
      opt.style.borderColor=t===type?'rgba(255,109,0,.3)':'rgba(255,255,255,.08)';
      opt.style.background=t===type?'rgba(255,109,0,.06)':'rgba(255,255,255,.03)';
    }
    if(dot){
      dot.style.background=t===type?'#FF6D00':'transparent';
      dot.parentElement.style.borderColor=t===type?'#FF6D00':'rgba(255,255,255,.2)';
    }
  });
  _renderSeamForm(type);
};

function _renderSeamForm(type){
  var area=document.getElementById('sg-seam-form-area');
  if(!area)return;
  var btn=document.getElementById('sg-seam-connect-btn');

  if(type==='existing'){
    // Existing smart access account — enter API key
    area.innerHTML=''
      +'<div style="margin-bottom:12px">'
      +'<label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Access System API Key</label>'
      +'<input id="sg-seam-api-key" type="text" placeholder="seam_apikey1_..." style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:14px;font-family:monospace;outline:none;transition:border-color .15s;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'">'
      +'</div>'

      // How to find your API key
      +'<div style="background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15);border-radius:14px;padding:14px">'
      +'<p style="color:#a5b4fc;font-size:11px;font-weight:600;margin:0 0 6px">💡 Where to find your API key</p>'
      +'<ol style="color:rgba(255,255,255,.4);font-size:11px;line-height:1.6;margin:0;padding-left:16px">'
      +'<li>Log into <b style="color:#a5b4fc">console.seam.co</b></li>'
      +'<li>Go to <b style="color:#a5b4fc">API Keys</b> in sidebar</li>'
      +'<li>Copy your API key</li>'
      +'<li>Paste it above</li>'
      +'</ol>'
      +'</div>';
    if(btn)btn.textContent='Connect Smart Access →';

  }else{
    // New smart access account — guide to create
    area.innerHTML=''
      // Step-by-step guide
      +'<div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);border-radius:14px;padding:16px;margin-bottom:14px">'
      +'<p style="color:#4ade80;font-size:12px;font-weight:700;margin:0 0 10px">🚀 Create your free smart access account</p>'
      +'<div style="display:flex;flex-direction:column;gap:10px">'
      +'<div style="display:flex;gap:10px;align-items:flex-start">'
      +'<div style="width:22px;height:22px;border-radius:50%;background:rgba(34,197,94,.2);color:#22c55e;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">1</div>'
      +'<div style="flex:1"><p style="color:#fff;font-size:12px;font-weight:600;margin:0">Create your smart access account</p><p style="color:rgba(255,255,255,.35);font-size:11px;margin:2px 0 0">Free account — no credit card needed</p></div>'
      +'</div>'
      +'<div style="display:flex;gap:10px;align-items:flex-start">'
      +'<div style="width:22px;height:22px;border-radius:50%;background:rgba(34,197,94,.2);color:#22c55e;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">2</div>'
      +'<div style="flex:1"><p style="color:#fff;font-size:12px;font-weight:600;margin:0">Connect your lock brand</p><p style="color:rgba(255,255,255,.35);font-size:11px;margin:2px 0 0">Salto, Brivo, Yale, August, Schlage & 30+ more</p></div>'
      +'</div>'
      +'<div style="display:flex;gap:10px;align-items:flex-start">'
      +'<div style="width:22px;height:22px;border-radius:50%;background:rgba(34,197,94,.2);color:#22c55e;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">3</div>'
      +'<div style="flex:1"><p style="color:#fff;font-size:12px;font-weight:600;margin:0">Copy your API key</p><p style="color:rgba(255,255,255,.35);font-size:11px;margin:2px 0 0">Found in console.seam.co → API Keys</p></div>'
      +'</div>'
      +'</div>'
      +'</div>'

      // Open access console button
      +'<a href="https://console.seam.co/signup" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);border-radius:12px;padding:14px;color:#a5b4fc;font-size:14px;font-weight:700;text-decoration:none;cursor:pointer;margin-bottom:14px;transition:all .15s" ontouchstart="this.style.transform=\'scale(.98)\'" ontouchend="this.style.transform=\'scale(1)\'">'
      +'🌐 Create Access Account →'
      +'</a>'

      // After creating account, paste API key
      +'<div style="margin-bottom:0">'
      +'<label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Then paste your API Key here</label>'
      +'<input id="sg-seam-api-key" type="text" placeholder="seam_apikey1_..." style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:14px;font-family:monospace;outline:none;transition:border-color .15s;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'">'
      +'</div>';
    if(btn)btn.textContent='Connect & Continue →';
  }
}

window._ctaConnectSeam=async function(){
  var btn=document.getElementById('sg-seam-connect-btn');
  var err=document.getElementById('sg-seam-error');
  var keyEl=document.getElementById('sg-seam-api-key');
  if(err)err.style.display='none';

  var apiKey=(keyEl&&keyEl.value)?keyEl.value.trim():'';
  if(!apiKey){
    if(err){err.textContent='Please enter your access system API key';err.style.display='block';}
    return;
  }

  if(btn){btn.textContent='🔐 Connecting…';btn.style.opacity='.6';btn.style.pointerEvents='none';}

  try{
    // Auto-detect partner's claimed gym
    var gymId=window._partnerGymId||0;
    if(!gymId){
      try{
        var dr=await fetch('/api/gym-partner/dashboard',{credentials:'include'});
        var dd=await dr.json();
        if(dd.gyms&&dd.gyms.length>0){gymId=dd.gyms[0].id;window._partnerGymId=gymId;}
      }catch(e){}
    }

    var res=await fetch('/api/access/owner/connect-seam',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:JSON.stringify({gymId:gymId||0,seamApiKey:apiKey})
    });
    var d=await res.json();

    if(d.connected||d.success){
      // Save smart access state locally
      _saveSeamLocal(apiKey,d);
      if(btn){btn.textContent='✅ Smart Access Connected!';btn.style.background='#22c55e';btn.style.opacity='1';}
      if(navigator.vibrate)navigator.vibrate(50);
      if(typeof sgToast==='function')sgToast(d.message||'Smart access connected successfully! 🔐','success',3000);
      setTimeout(function(){
        _ctaCloseSheet();
        if(window._ctaSeamCallback)window._ctaSeamCallback();
      },500);
    }else{
      // API responded but couldn't connect
      if(err){err.textContent=d.error||d.message||'Could not connect smart access — check your API key';err.style.display='block';}
      if(btn){btn.textContent='Connect Smart Access →';btn.style.opacity='1';btn.style.pointerEvents='auto';}
    }
  }catch(e){
    if(err){err.textContent='Network error — try again';err.style.display='block';}
    if(btn){btn.textContent='Connect Smart Access →';btn.style.opacity='1';btn.style.pointerEvents='auto';}
  }
};

window._ctaSkipSeam=function(){
  // Mark as skipped so they can come back later
  _saveSeamLocal(null,{skipped:true});
  _ctaCloseSheet();
  if(window._ctaSeamCallback)window._ctaSeamCallback();
};

function _saveSeamLocal(apiKey,response){
  try{
    var pd=JSON.parse(localStorage.getItem('sg_partner')||'{}');
    pd.seamConnected=!!(response&&(response.connected||response.success));
    pd.seamSkipped=!!(response&&response.skipped);
    pd.seamVerified=!!(response&&response.verified);
    pd.seamSystem=response&&response.system||null;
    pd.seamConnectedAt=Date.now();
    localStorage.setItem('sg_partner',JSON.stringify(pd));
  }catch(e){}
}


// ══════════════════════════════════════════════════════════════════════




// ══════════════════════════════════════════════════════════════════════
// PARTNER TAB: Continue CTA Flow
// Flow: Sign In → Connect Smart Access → Wallet/Withdraw
// ══════════════════════════════════════════════════════════════════════

window._partnerContinueFlow=function(){
  var u=state&&state.user;

  // Step 1: Not signed in → half-page auth sheet (same as Book/Reels)
  if(!u){
    if(typeof window._sgShowAuthSheet==='function'){
      window._partnerPostAuth=true;
      window._sgShowAuthSheet('book');
    }else{
      navigate('/login');
    }
    return;
  }

  // Step 2: Go straight to the unified wallet withdraw sheet.
  // Smart access connection is optional — don't block withdrawals on it.
  window._sgUnifiedWithdraw();
};

// Hook into auth success to continue partner/creator flow
var _origAuthAfterSuccess=window._sgAuthAfterSuccess;
window._sgAuthAfterSuccess=function(){
  // If partner, creator, or verify flow is pending, skip the card/Stripe step
  // entirely — close the auth sheet and resume the correct flow.
  // This prevents Stripe "Pay with" + Wallet modals stacking on top of each other.
  var isPartnerFlow=window._partnerPostAuth;
  var isCreatorFlow=window._creatorPostAuth;
  var isVerifyFlow=window._pePostAuthData;

  if(isPartnerFlow||isCreatorFlow||isVerifyFlow){
    // Close auth sheet immediately (prevents _renderCardStep from showing)
    if(typeof window._sgCloseAuthSheet==='function')window._sgCloseAuthSheet();
    // Still show the welcome toast
    if(typeof state!=='undefined'&&state&&state.user){
      sgToast('Welcome, '+(state.user.name||'there')+'! 🎉','success',1500);
    }

    if(isPartnerFlow){
      window._partnerPostAuth=false;
      setTimeout(function(){window._partnerContinueFlow();},400);
    }
    if(isCreatorFlow){
      window._creatorPostAuth=false;
      setTimeout(function(){window._creatorContinueFlow();},400);
    }
    if(isVerifyFlow){
      var vd=window._pePostAuthData;
      window._pePostAuthData=null;
      setTimeout(function(){window._peVerifyGym(vd.placeId,vd.encName);},400);
    }
    return; // Don't call _origAuthAfterSuccess (which would show Stripe card step)
  }

  // Default: run original auth flow (card step for book mode, etc.)
  if(_origAuthAfterSuccess)_origAuthAfterSuccess();
};


// ══════════════════════════════════════════════════════════════════════
// CREATOR: "Copy Affiliate Link" half-page popup
// Regular affiliate link + deep link generator
// ══════════════════════════════════════════════════════════════════════

function _hasAffiliateLinkCopied(){
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'null');
    if(cd&&cd.linkCopied)return true;
  }catch(e){}
  return false;
}

function _getCreatorHandle(){
  try{
    var u=state&&state.user;
    if(u&&u.referral_code)return u.referral_code;
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'null');
    if(cd&&cd.handle)return cd.handle;
    // Auto-generate handle from user info
    if(u){
      var h=(u.name||u.phone||u.email||'creator').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,15);
      return h||'creator';
    }
  }catch(e){}
  return 'creator';
}

function _showAffiliateLinkSheet(onComplete){
  var handle=_getCreatorHandle();
  var affLink='scangym.com/r/'+handle;
  var fullLink='https://scangym.com/r/'+handle;

  var html=''
    // Header
    +'<div style="text-align:center;margin-bottom:20px">'
    +'<div style="font-size:40px;margin-bottom:8px">🔗</div>'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Your Affiliate Link</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Share & earn 25% on every booking</p>'
    +'</div>'

    // Progress dots (Step 2 of 3)
    +'<div style="display:flex;justify-content:center;gap:6px;margin-bottom:20px">'
    +'<div style="width:6px;height:6px;border-radius:3px;background:#22c55e"></div>'
    +'<div style="width:10px;height:6px;border-radius:3px;background:#fff"></div>'
    +'<div style="width:6px;height:6px;border-radius:3px;background:rgba(255,255,255,.3)"></div>'
    +'</div>'

    // ── Affiliate Link Card ──
    +'<div style="background:rgba(255,109,0,.06);border:1px solid rgba(255,109,0,.2);border-radius:16px;padding:16px;margin-bottom:14px">'
    +'<p style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px">📋 Your Affiliate Link</p>'
    +'<div style="display:flex;gap:8px;align-items:center">'
    +'<div style="flex:1;background:rgba(0,0,0,.3);border:1px solid rgba(255,109,0,.15);border-radius:10px;padding:12px 14px;overflow:hidden">'
    +'<p id="sg-aff-link-text" style="color:#FF6D00;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0">'+affLink+'</p>'
    +'</div>'
    +'<button id="sg-aff-copy-btn" onclick="window._ctaCopyAffLink()" style="background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .15s">📋 Copy</button>'
    +'</div>'
    +'</div>'

    // ── Share Buttons ──
    +'<div style="display:flex;gap:8px;margin-bottom:16px">'
    +'<button onclick="window._ctaShareAff(\'whatsapp\')" style="flex:1;background:rgba(37,211,102,.08);border:1px solid rgba(37,211,102,.2);color:#25d366;padding:12px;border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">💬 WhatsApp</button>'
    +'<button onclick="window._ctaShareAff(\'twitter\')" style="flex:1;background:rgba(29,161,242,.08);border:1px solid rgba(29,161,242,.2);color:#1da1f2;padding:12px;border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">🐦 Twitter/X</button>'
    +'<button onclick="window._ctaShareAff(\'native\')" style="flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6);padding:12px;border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">📤 Share</button>'
    +'</div>'

    // ── Divider ──
    +'<div style="display:flex;align-items:center;gap:12px;margin:18px 0">'
    +'<div style="flex:1;height:1px;background:rgba(255,255,255,.08)"></div>'
    +'<span style="color:rgba(255,255,255,.25);font-size:11px;font-weight:600">OR</span>'
    +'<div style="flex:1;height:1px;background:rgba(255,255,255,.08)"></div>'
    +'</div>'

    // ── Deep Affiliate Link Generator ──
    +'<div style="background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15);border-radius:16px;padding:16px;margin-bottom:14px">'
    +'<p style="color:#a5b4fc;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px">🎯 Deep Affiliate Link</p>'
    +'<p style="color:rgba(255,255,255,.35);font-size:11px;margin:0 0 12px">Paste any ScanGym.com link to make it yours</p>'
    +'<div style="display:flex;gap:8px">'
    +'<input id="sg-deep-url-input" type="url" placeholder="Paste scangym.com/gym/... or any link" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:12px 14px;color:#fff;font-size:13px;outline:none;min-width:0;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(99,102,241,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'" oninput="window._ctaGenDeepLink()">'
    +'<button id="sg-deep-copy-btn" onclick="window._ctaCopyDeepLink()" style="background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.3);color:#a5b4fc;padding:12px 16px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0;opacity:.4;pointer-events:none;transition:all .15s">📋 Copy</button>'
    +'</div>'
    +'<div id="sg-deep-result" style="display:none;margin-top:8px;background:rgba(0,0,0,.3);border:1px solid rgba(99,102,241,.15);border-radius:8px;padding:10px 12px">'
    +'<p id="sg-deep-link-text" style="color:#a5b4fc;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0"></p>'
    +'</div>'
    +'</div>'

    // ── How it Works ──
    +'<div style="background:rgba(34,197,94,.04);border:1px solid rgba(34,197,94,.1);border-radius:14px;padding:14px;margin-bottom:16px">'
    +'<p style="color:#4ade80;font-size:11px;font-weight:700;margin:0 0 8px">💡 How it works</p>'
    +'<div style="display:flex;flex-direction:column;gap:6px">'
    +'<div style="display:flex;gap:8px;align-items:center"><span style="color:#22c55e;font-size:14px">1.</span><span style="color:rgba(255,255,255,.5);font-size:11px">Share your link on social media, stories, or DMs</span></div>'
    +'<div style="display:flex;gap:8px;align-items:center"><span style="color:#22c55e;font-size:14px">2.</span><span style="color:rgba(255,255,255,.5);font-size:11px">Someone clicks and books a gym session</span></div>'
    +'<div style="display:flex;gap:8px;align-items:center"><span style="color:#22c55e;font-size:14px">3.</span><span style="color:rgba(255,255,255,.5);font-size:11px">You earn <b style="color:#FF6D00">25% commission</b> — paid to your wallet!</span></div>'
    +'</div>'
    +'</div>'

    // Continue button
    +'<button id="sg-aff-continue-btn" onclick="window._ctaAffiliateDone()" style="width:100%;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;transition:all .2s;box-shadow:0 4px 20px rgba(255,109,0,.3)">Continue →</button>';

  _ctaOpenSheet(html);
  window._ctaAffiliateCallback=onComplete;
  window._ctaAffHandle=handle;

  // Auto-generate link on server
  _ensureCreatorLink(handle);
}

async function _ensureCreatorLink(handle){
  try{
    await fetch('/api/referrals/generate-link',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({handle:handle})});
  }catch(e){}
}

window._ctaCopyAffLink=function(){
  var handle=window._ctaAffHandle||'creator';
  var link='https://scangym.com/r/'+handle;
  var btn=document.getElementById('sg-aff-copy-btn');
  try{
    navigator.clipboard.writeText(link).then(function(){
      if(btn){btn.textContent='✅ Copied!';btn.style.background='#22c55e';}
      if(typeof sgToast==='function')sgToast('Affiliate link copied! 📋','success',2000);
      _markAffiliateCopied();
      setTimeout(function(){if(btn){btn.textContent='📋 Copy';btn.style.background='linear-gradient(135deg,#FF6D00,#E66200)';}},2000);
    }).catch(function(){_fallbackCopyAff(link,btn);});
  }catch(e){_fallbackCopyAff(link,btn);}
};

function _fallbackCopyAff(link,btn){
  var ta=document.createElement('textarea');
  ta.value=link;ta.style.cssText='position:fixed;opacity:0';
  document.body.appendChild(ta);ta.select();
  try{document.execCommand('copy');}catch(e){}
  document.body.removeChild(ta);
  if(btn){btn.textContent='✅ Copied!';btn.style.background='#22c55e';}
  _markAffiliateCopied();
  setTimeout(function(){if(btn){btn.textContent='📋 Copy';btn.style.background='linear-gradient(135deg,#FF6D00,#E66200)';}},2000);
}

function _markAffiliateCopied(){
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
    cd.linkCopied=true;cd.linkCopiedAt=Date.now();
    localStorage.setItem('sg_creator',JSON.stringify(cd));
  }catch(e){}
}

window._ctaShareAff=function(platform){
  var handle=window._ctaAffHandle||'creator';
  var link='https://scangym.com/r/'+handle;
  var text='Check out ScanGym — gym day passes from '+sgPriceDisplay('day')+'! Use my link: ';
  _markAffiliateCopied();
  if(platform==='whatsapp'){window.open('https://wa.me/?text='+encodeURIComponent(text+link),'_blank');}
  else if(platform==='twitter'){window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text)+' '+encodeURIComponent(link),'_blank');}
  else if(navigator.share){navigator.share({title:'ScanGym',text:text,url:link}).catch(function(){});}
  else{window._ctaCopyAffLink();}
};

window._ctaGenDeepLink=function(){
  var input=document.getElementById('sg-deep-url-input');
  var result=document.getElementById('sg-deep-result');
  var linkText=document.getElementById('sg-deep-link-text');
  var copyBtn=document.getElementById('sg-deep-copy-btn');
  if(!input||!result)return;
  var url=input.value.trim();
  if(!url||!url.includes('scangym.com')){
    result.style.display='none';
    if(copyBtn){copyBtn.style.opacity='.4';copyBtn.style.pointerEvents='none';}
    return;
  }
  var handle=window._ctaAffHandle||'creator';
  // Parse and append ref parameter
  var deepUrl=url;
  try{
    if(!deepUrl.startsWith('http'))deepUrl='https://'+deepUrl;
    var u=new URL(deepUrl);
    u.searchParams.set('ref',handle);
    deepUrl=u.toString();
  }catch(e){
    // Fallback: just append ?ref= or &ref=
    deepUrl+=(deepUrl.includes('?')?'&':'?')+'ref='+encodeURIComponent(handle);
  }
  window._ctaDeepLinkUrl=deepUrl;
  if(linkText)linkText.textContent=deepUrl;
  result.style.display='block';
  if(copyBtn){copyBtn.style.opacity='1';copyBtn.style.pointerEvents='auto';}
};

window._ctaCopyDeepLink=function(){
  var url=window._ctaDeepLinkUrl;
  if(!url)return;
  var btn=document.getElementById('sg-deep-copy-btn');
  try{
    navigator.clipboard.writeText(url).then(function(){
      if(btn){btn.textContent='✅ Copied!';btn.style.background='rgba(34,197,94,.2)';btn.style.borderColor='rgba(34,197,94,.3)';btn.style.color='#4ade80';}
      if(typeof sgToast==='function')sgToast('Deep affiliate link copied! 🎯','success',2000);
      _markAffiliateCopied();
      setTimeout(function(){if(btn){btn.textContent='📋 Copy';btn.style.background='rgba(99,102,241,.2)';btn.style.borderColor='rgba(99,102,241,.3)';btn.style.color='#a5b4fc';}},2000);
    }).catch(function(){});
  }catch(e){}
};

window._ctaAffiliateDone=function(){
  _markAffiliateCopied();
  _ctaCloseSheet();
  if(window._ctaAffiliateCallback)window._ctaAffiliateCallback();
};


// ══════════════════════════════════════════════════════════════════════
// CREATOR TAB: Continue CTA Flow
// Flow: Sign In → Copy Affiliate Link → Wallet/Withdraw
// ══════════════════════════════════════════════════════════════════════

window._creatorContinueFlow=function(){
  var u=state&&state.user;

  // Step 1: Not signed in → show auth sheet
  if(!u){
    if(typeof window._sgShowAuthSheet==='function'){
      window._creatorPostAuth=true;
      window._sgShowAuthSheet('book');
    }else{
      navigate('/login');
    }
    return;
  }

  // Step 2: Haven't copied affiliate link yet → show affiliate link sheet
  if(!_hasAffiliateLinkCopied()){
    _showAffiliateLinkSheet(function(){
      window._creatorContinueFlow();
    });
    return;
  }

  // Step 3: Wallet → Withdraw (use unified wallet withdraw sheet)
  window._sgUnifiedWithdraw();
};


// ══════════════════════════════════════════════════════════════════════
// CONTINUE BANNER: Inject into Partner and Creator tabs
// Orange CTA bar at the bottom, above the tab bar
// ══════════════════════════════════════════════════════════════════════

function _getCTAState(tabType){
  var u=state&&state.user;
  if(!u)return{step:1,label:'Continue',sublabel:'Sign in to get started'};

  if(tabType==='partner'){
    // Smart access is optional — don't block the CTA flow on it
    return{step:3,label:'Withdraw Earnings →',sublabel:'Your gym is live!'};
  }
  // Creator
  if(!_hasAffiliateLinkCopied())return{step:2,label:'Continue',sublabel:'Copy your affiliate link'};
  return{step:3,label:'Withdraw Earnings →',sublabel:'You\'re all set!'};
}

function _injectContinueBanner(tabType){
  /* ONE BAR: this used to create its own fixed #partner-continue-banner (and a
   * #creator-continue-banner) at bottom:56px;z-index:var(--sg-z-bottom-bar,8999) — a third and fourth
   * orange bar that could stack over the core one. It now renders into the single
   * shared bar owned by app.js (window.sgBottomBar).
   * The old flow is still reachable: window._partnerContinueFlow() is untouched
   * and _sgOpenAskAI falls back to it when the chat script has not loaded. */
  if(!window.sgBottomBar)return;
  void _getCTAState(tabType);
  window.sgBottomBar.show(tabType,{
    label:'Ask AI',
    sub:_askAIHint(tabType),
    arrow:'\u2192',
    onClick:function(){window._sgOpenAskAI(tabType);}
  });
}

function _removeContinueBanner(tabType){
  if(window.sgBottomBar)window.sgBottomBar.hide(tabType);
}
window._removeContinueBanner=_removeContinueBanner;

function _askAIHint(tabType){
  var partner=['"Change my day pass to \u00a35"','"How much have I made this week?"','"Close the gym today"','"Pay me out"'];
  var creator=['"How much have I earned?"','"What should I post next?"','"Boost my latest reel"','"Pay me out"'];
  var list=tabType==='partner'?partner:creator;
  return list[Math.floor(Date.now()/8000)%list.length];
}

/* One entry point for both assistants, so the bar works on either tab and degrades
 * to the old flow if the chat script has not loaded. */
window._sgOpenAskAI=function(tabType){
  var chat=tabType==='partner'?window.sgPartnerChat:window.sgSquadChat;
  if(chat&&typeof chat.open==='function'){chat.open();return;}
  var fallback=tabType==='partner'?window._partnerContinueFlow:window._creatorContinueFlow;
  if(typeof fallback==='function')fallback();
};

function _stepDots(current,total){
  var html='';
  for(var i=1;i<=total;i++){
    var done=i<current;
    var active=i===current;
    var color=done?'#22c55e':active?'#fff':'rgba(255,255,255,.3)';
    var size=active?'10px':'6px';
    html+='<div style="width:'+size+';height:6px;border-radius:3px;background:'+color+';transition:all .3s"></div>';
  }
  return html;
}

window._injectContinueBanner=_injectContinueBanner;


// ══════════════════════════════════════════════════════════════════════
// PATCH: Hook into tab navigation to inject/remove banners
// ══════════════════════════════════════════════════════════════════════

/* This waits for the app bundle to have defined the globals it patches.
 *
 * It used to also require CreatorFullPage, which was never used below — it was
 * only ever a second "has the app booted yet" proxy. CreatorFullPage now lives
 * in the lazy sg-scansquad chunk, so on a visitor who never opens ScanSquad
 * that condition would never come true: this interval would poll every 200ms
 * for the whole session and the Partner tab's Continue banner would never be
 * wired up. Only check what this block actually touches. */
var _patchInterval=setInterval(function(){
  if(typeof PartnerFullPage==='function'&&typeof window._showPartnerScreen==='function'){
    clearInterval(_patchInterval);

    // Patch _showPartnerScreen to refresh banner
    var _origShowPartnerScreen=window._showPartnerScreen;
    window._showPartnerScreen=function(idx){
      _origShowPartnerScreen(idx);
      _injectContinueBanner('partner');
    };

    // Listen for route switches to inject/remove partner banner
    // Note: /partner maps to activeTab='more', so check route
    var _lastRoute='';
    setInterval(function(){
      var route=state&&state.route;
      var isPartner=(route==='/partner'||route==='/partner/');
      if(route!==_lastRoute){
        _lastRoute=route;
        if(isPartner)_injectContinueBanner('partner');
        else _removeContinueBanner('partner');
      }
    },300);
  }
},200);

// Banner animation styles
var _bannerStyle=document.createElement('style');
_bannerStyle.textContent=''
  +'#sg-continue-banner:not(.sg-cb-hidden){'
  +'animation:ctaBannerIn .4s cubic-bezier(.32,.72,0,1) both;'
  +'}'
  +'@keyframes ctaBannerIn{'
  +'from{opacity:0;transform:translateY(20px)}'
  +'to{opacity:1;transform:translateY(0)}'
  +'}';
document.head.appendChild(_bannerStyle);

})();
