/* ═══════════════════════════════════════════════════════════════════════════
   CONTINUE CTA FLOW — Partner Tab + Creator Tab
   Progressive "Continue" button that guides users through:
     1. Sign In (half-page auth popup)
     2. Add Withdraw Method (half-page popup)
     3. Partner: Search/claim gym → Wallet → Withdraw
        Creator: Confirm & Withdraw popup
   
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

function _ctaCloseSheet(){
  if(_ctaSheetEl)_ctaSheetEl.style.transform='translateY(100%)';
  if(_ctaOverlayEl){_ctaOverlayEl.style.opacity='0';_ctaOverlayEl.style.pointerEvents='none';}
}
window._ctaCloseSheet=_ctaCloseSheet;


// ══════════════════════════════════════════════════════════════════════
// SHARED: Check if user has a withdraw method set up
// ══════════════════════════════════════════════════════════════════════

function _hasWithdrawMethod(){
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'null');
    if(cd&&cd.withdrawMethod)return true;
  }catch(e){}
  // Also check if partner has Stripe Connect
  try{
    var pd=JSON.parse(localStorage.getItem('sg_partner')||'null');
    if(pd&&pd.stripeConnected)return true;
  }catch(e){}
  return false;
}

// ══════════════════════════════════════════════════════════════════════
// SHARED: "Add Withdraw Method" half-page popup
// ══════════════════════════════════════════════════════════════════════

function _showAddWithdrawSheet(onComplete){
  var html=''
    +'<div style="text-align:center;margin-bottom:20px">'
    +'<div style="font-size:40px;margin-bottom:8px">💰</div>'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Add Withdraw Method</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Choose how you want to receive your earnings</p>'
    +'</div>'

    // Option 1: Stripe Connect (recommended for partners)
    +'<div id="sg-wd-opt-stripe" onclick="window._ctaSelectWithdrawOpt(\'stripe\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:rgba(255,109,0,.06);border:2px solid rgba(255,109,0,.3);border-radius:16px;cursor:pointer;margin-bottom:10px;transition:all .15s">'
    +'<div style="width:48px;height:48px;background:linear-gradient(135deg,#635BFF,#7A73FF);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#fff;font-size:18px;font-weight:800">S</span></div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">Stripe Connect</div><div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">Direct bank deposits · Recommended</div></div>'
    +'<div style="width:20px;height:20px;border:2px solid #FF6D00;border-radius:50%;display:flex;align-items:center;justify-content:center"><div id="sg-wd-dot-stripe" style="width:10px;height:10px;background:#FF6D00;border-radius:50%"></div></div>'
    +'</div>'

    // Option 2: PayPal
    +'<div id="sg-wd-opt-paypal" onclick="window._ctaSelectWithdrawOpt(\'paypal\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:rgba(255,255,255,.03);border:2px solid rgba(255,255,255,.08);border-radius:16px;cursor:pointer;margin-bottom:10px;transition:all .15s">'
    +'<div style="width:48px;height:48px;background:linear-gradient(135deg,#003087,#009cde);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#fff;font-size:14px;font-weight:800">PP</span></div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">PayPal</div><div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">Withdraw to your PayPal account</div></div>'
    +'<div style="width:20px;height:20px;border:2px solid rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center"><div id="sg-wd-dot-paypal" style="width:10px;height:10px;background:transparent;border-radius:50%"></div></div>'
    +'</div>'

    // Option 3: Bank Transfer
    +'<div id="sg-wd-opt-bank" onclick="window._ctaSelectWithdrawOpt(\'bank\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:rgba(255,255,255,.03);border:2px solid rgba(255,255,255,.08);border-radius:16px;cursor:pointer;margin-bottom:10px;transition:all .15s">'
    +'<div style="width:48px;height:48px;background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#fff;font-size:18px">🏦</span></div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">Bank Transfer</div><div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">UK sort code & account number</div></div>'
    +'<div style="width:20px;height:20px;border:2px solid rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center"><div id="sg-wd-dot-bank" style="width:10px;height:10px;background:transparent;border-radius:50%"></div></div>'
    +'</div>'

    // Dynamic form area
    +'<div id="sg-wd-form-area" style="margin-top:16px"></div>'

    // Error
    +'<p id="sg-wd-error" style="color:#ef4444;font-size:13px;margin-top:8px;display:none"></p>'

    // Save button
    +'<button id="sg-wd-save-btn" onclick="window._ctaSaveWithdrawMethod()" style="width:100%;background:#FF6D00;color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px;transition:all .2s;box-shadow:0 4px 20px rgba(255,109,0,.3)">Connect & Continue →</button>';

  _ctaOpenSheet(html);
  // Store callback
  window._ctaWithdrawCallback=onComplete;
  window._ctaSelectedWithdraw='stripe';
  _renderWithdrawForm('stripe');
}

window._ctaSelectWithdrawOpt=function(type){
  window._ctaSelectedWithdraw=type;
  var types=['stripe','paypal','bank'];
  types.forEach(function(t){
    var opt=document.getElementById('sg-wd-opt-'+t);
    var dot=document.getElementById('sg-wd-dot-'+t);
    if(opt){
      opt.style.borderColor=t===type?'rgba(255,109,0,.3)':'rgba(255,255,255,.08)';
      opt.style.background=t===type?'rgba(255,109,0,.06)':'rgba(255,255,255,.03)';
    }
    if(dot){
      dot.style.background=t===type?'#FF6D00':'transparent';
      dot.parentElement.style.borderColor=t===type?'#FF6D00':'rgba(255,255,255,.2)';
    }
  });
  _renderWithdrawForm(type);
};

function _renderWithdrawForm(type){
  var area=document.getElementById('sg-wd-form-area');
  if(!area)return;
  var btn=document.getElementById('sg-wd-save-btn');
  if(type==='stripe'){
    area.innerHTML='<div style="background:rgba(99,91,255,.06);border:1px solid rgba(99,91,255,.15);border-radius:14px;padding:14px;display:flex;align-items:center;gap:12px">'
      +'<span style="font-size:24px">⚡</span>'
      +'<div><p style="color:#fff;font-size:13px;font-weight:600;margin:0">Stripe Connect</p>'
      +'<p style="color:rgba(255,255,255,.4);font-size:11px;margin:2px 0 0">You\'ll be redirected to Stripe to set up secure payouts. Takes ~2 minutes.</p></div>'
      +'</div>';
    if(btn)btn.textContent='Connect with Stripe →';
  }else if(type==='paypal'){
    area.innerHTML='<div style="margin-top:4px">'
      +'<label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">PayPal Email</label>'
      +'<input id="sg-wd-paypal-email" type="email" placeholder="your@email.com" style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:15px;outline:none;transition:border-color .15s;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'">'
      +'</div>';
    if(btn)btn.textContent='Save PayPal & Continue →';
  }else{
    area.innerHTML='<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">'
      +'<div><label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Account Holder Name</label>'
      +'<input id="sg-wd-bank-name" type="text" placeholder="John Smith" style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:15px;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'"></div>'
      +'<div style="display:flex;gap:10px">'
      +'<div style="flex:1"><label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Sort Code</label>'
      +'<input id="sg-wd-bank-sort" type="text" placeholder="12-34-56" maxlength="8" style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:15px;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'"></div>'
      +'<div style="flex:1"><label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Account Number</label>'
      +'<input id="sg-wd-bank-acct" type="text" placeholder="12345678" maxlength="8" style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:15px;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'"></div>'
      +'</div></div>';
    if(btn)btn.textContent='Save Bank Details & Continue →';
  }
}

window._ctaSaveWithdrawMethod=async function(){
  var type=window._ctaSelectedWithdraw;
  var btn=document.getElementById('sg-wd-save-btn');
  var err=document.getElementById('sg-wd-error');
  if(err)err.style.display='none';

  if(type==='stripe'){
    // Redirect to Stripe Connect onboarding
    if(btn){btn.textContent='⚡ Redirecting…';btn.style.opacity='.6';btn.style.pointerEvents='none';}
    try{
      var u=state&&state.user;
      var email=u?u.email:'';
      var handle=(u&&u.referral_code)||'';
      var res=await fetch('/api/referrals/stripe-connect',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({creatorHandle:handle,email:email})});
      var d=await res.json();
      if(d.success&&d.onboardingUrl){
        // Store method locally
        _saveWithdrawLocal('stripe_connect',{});
        window.location.href=d.onboardingUrl;
        return;
      }else{
        if(err){err.textContent=d.error||'Stripe Connect setup failed';err.style.display='block';}
        if(btn){btn.textContent='Connect with Stripe →';btn.style.opacity='1';btn.style.pointerEvents='auto';}
      }
    }catch(e){
      if(err){err.textContent='Network error — try again';err.style.display='block';}
      if(btn){btn.textContent='Connect with Stripe →';btn.style.opacity='1';btn.style.pointerEvents='auto';}
    }
    return;
  }

  var details={};
  if(type==='paypal'){
    var emailEl=document.getElementById('sg-wd-paypal-email');
    if(!emailEl||!emailEl.value.trim()||!emailEl.value.includes('@')){
      if(err){err.textContent='Enter a valid PayPal email';err.style.display='block';}return;
    }
    details={paypalEmail:emailEl.value.trim()};
  }else if(type==='bank'){
    var nameEl=document.getElementById('sg-wd-bank-name');
    var sortEl=document.getElementById('sg-wd-bank-sort');
    var acctEl=document.getElementById('sg-wd-bank-acct');
    if(!nameEl||!nameEl.value.trim()||!sortEl||!sortEl.value.trim()||!acctEl||!acctEl.value.trim()){
      if(err){err.textContent='Fill in all bank details';err.style.display='block';}return;
    }
    details={accountName:nameEl.value.trim(),sortCode:sortEl.value.trim(),accountNumber:acctEl.value.trim()};
  }

  if(btn){btn.textContent='Saving…';btn.style.opacity='.6';btn.style.pointerEvents='none';}
  try{
    _saveWithdrawLocal(type,details);
    // Also save to server if creator has a handle
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'null')||{};
    if(cd.handle||cd.slug){
      var payMethod=type==='paypal'?'paypal':'bank_transfer';
      await fetch('/api/referrals/update-payout',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({creatorHandle:cd.handle||cd.slug,paymentMethod:payMethod,paymentDetails:details})}).catch(function(){});
    }
    if(btn){btn.textContent='✅ Connected!';btn.style.background='#22c55e';btn.style.opacity='1';}
    if(navigator.vibrate)navigator.vibrate(50);
    setTimeout(function(){
      _ctaCloseSheet();
      if(window._ctaWithdrawCallback)window._ctaWithdrawCallback();
    },400);
  }catch(e){
    if(err){err.textContent='Failed to save — try again';err.style.display='block';}
    if(btn){btn.textContent='Save & Continue →';btn.style.opacity='1';btn.style.pointerEvents='auto';}
  }
};

function _saveWithdrawLocal(type,details){
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
    cd.withdrawMethod=type;cd.withdrawDetails=details;
    localStorage.setItem('sg_creator',JSON.stringify(cd));
    // Also mark partner
    var pd=JSON.parse(localStorage.getItem('sg_partner')||'{}');
    pd.withdrawMethod=type;pd.withdrawDetails=details;
    if(type==='stripe_connect')pd.stripeConnected=true;
    localStorage.setItem('sg_partner',JSON.stringify(pd));
  }catch(e){}
}


// ══════════════════════════════════════════════════════════════════════
// SHARED: "Confirm & Withdraw" half-page popup
// ══════════════════════════════════════════════════════════════════════

function _showConfirmWithdrawSheet(tabType){
  var isPartner=tabType==='partner';
  var title=isPartner?'Partner Earnings':'Creator Earnings';
  var commission=isPartner?'85%':'25%';

  var html=''
    +'<div style="text-align:center;margin-bottom:20px">'
    +'<div style="font-size:40px;margin-bottom:8px">💸</div>'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Withdraw '+title+'</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">You earn '+commission+' of every booking</p>'
    +'</div>'

    // Balance card
    +'<div style="background:linear-gradient(135deg,#FF6D00,#E66200);border-radius:16px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden">'
    +'<div style="position:absolute;top:-20px;right:-20px;width:80px;height:80px;background:rgba(255,255,255,.1);border-radius:50%"></div>'
    +'<p style="color:rgba(255,255,255,.7);font-size:12px;font-weight:500;margin:0 0 4px">Available Balance</p>'
    +'<p id="sg-cta-wd-balance" style="color:#fff;font-size:32px;font-weight:900;letter-spacing:-1px;margin:0">Loading…</p>'
    +'<p style="color:rgba(255,255,255,.5);font-size:11px;margin:6px 0 0">ScanGym Wallet</p>'
    +'</div>'

    // Withdraw method summary
    +'<div id="sg-cta-wd-method" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin-bottom:16px;display:flex;align-items:center;gap:12px">'
    +'<div style="font-size:20px">🏦</div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:13px;font-weight:600">Loading withdraw method…</div></div>'
    +'</div>'

    // Amount input
    +'<div style="margin-bottom:16px">'
    +'<label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Withdraw Amount</label>'
    +'<div style="display:flex;align-items:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;overflow:hidden">'
    +'<span style="padding:0 14px;color:rgba(255,255,255,.4);font-size:18px;font-weight:700">£</span>'
    +'<input id="sg-cta-wd-amount" type="number" placeholder="0.00" step="0.01" min="10" style="flex:1;background:none;border:none;padding:14px 14px 14px 0;color:#fff;font-size:20px;font-weight:700;outline:none">'
    +'<button onclick="window._ctaWithdrawMax()" style="background:rgba(255,109,0,.15);border:1px solid rgba(255,109,0,.3);color:#FF6D00;font-weight:700;font-size:11px;padding:8px 14px;margin:6px;border-radius:8px;cursor:pointer">MAX</button>'
    +'</div>'
    +'<p style="color:rgba(255,255,255,.3);font-size:11px;margin-top:4px">Minimum withdrawal: £10.00</p>'
    +'</div>'

    // Error
    +'<p id="sg-cta-wd-error" style="color:#ef4444;font-size:13px;display:none"></p>'

    // Confirm button
    +'<button id="sg-cta-wd-confirm" onclick="window._ctaConfirmWithdraw(\''+tabType+'\')" style="width:100%;background:#22c55e;color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;transition:all .2s;box-shadow:0 4px 20px rgba(34,197,94,.3)">Confirm Withdrawal →</button>';

  _ctaOpenSheet(html);

  // Load wallet balance
  _loadWithdrawBalance(tabType);
  _loadWithdrawMethodSummary();
}

window._ctaWithdrawMax=function(){
  var inp=document.getElementById('sg-cta-wd-amount');
  if(inp&&window._ctaAvailableBalance){
    inp.value=window._ctaAvailableBalance.toFixed(2);
  }
};

async function _loadWithdrawBalance(tabType){
  window._ctaAvailableBalance=0;
  try{
    var balEl=document.getElementById('sg-cta-wd-balance');
    // Try wallet balance first
    var wr=await fetch('/api/wallet',{credentials:'include'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});
    var walletBal=wr?parseFloat(wr.balance||0):0;

    // Also try partner/creator earnings
    if(tabType==='partner'){
      var pr=await fetch('/api/gym-partner/dashboard',{credentials:'include'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});
      var earnings=pr?parseFloat(pr.availableBalance||pr.totalEarnings||0):0;
      var total=Math.max(walletBal,earnings);
      window._ctaAvailableBalance=total;
      if(balEl)balEl.textContent='£'+total.toFixed(2);
    }else{
      var cd=JSON.parse(localStorage.getItem('sg_creator')||'null')||{};
      var handle=cd.handle||cd.slug||'';
      if(handle){
        var cr=await fetch('/api/referrals/'+encodeURIComponent(handle)+'/balance',{credentials:'include'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});
        var creatorBal=cr?parseFloat(cr.available||cr.balance||0):0;
        var total=Math.max(walletBal,creatorBal);
        window._ctaAvailableBalance=total;
        if(balEl)balEl.textContent='£'+total.toFixed(2);
      }else{
        window._ctaAvailableBalance=walletBal;
        if(balEl)balEl.textContent='£'+walletBal.toFixed(2);
      }
    }
  }catch(e){
    var balEl=document.getElementById('sg-cta-wd-balance');
    if(balEl)balEl.textContent='£0.00';
  }
}

function _loadWithdrawMethodSummary(){
  var el=document.getElementById('sg-cta-wd-method');
  if(!el)return;
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'null')||{};
    var pd=JSON.parse(localStorage.getItem('sg_partner')||'null')||{};
    var method=cd.withdrawMethod||pd.withdrawMethod||'none';
    var details=cd.withdrawDetails||pd.withdrawDetails||{};
    if(method==='stripe_connect'||method==='stripe'){
      el.innerHTML='<div style="font-size:20px">⚡</div><div style="flex:1"><div style="color:#fff;font-size:13px;font-weight:600">Stripe Connect</div><div style="color:rgba(255,255,255,.35);font-size:11px">Direct bank deposit</div></div><div style="color:#22c55e;font-size:11px;font-weight:700">Connected ✓</div>';
    }else if(method==='paypal'){
      el.innerHTML='<div style="font-size:20px">💳</div><div style="flex:1"><div style="color:#fff;font-size:13px;font-weight:600">PayPal</div><div style="color:rgba(255,255,255,.35);font-size:11px">'+(details.paypalEmail||'Connected')+'</div></div><div style="color:#22c55e;font-size:11px;font-weight:700">Connected ✓</div>';
    }else if(method==='bank'||method==='bank_transfer'){
      el.innerHTML='<div style="font-size:20px">🏦</div><div style="flex:1"><div style="color:#fff;font-size:13px;font-weight:600">Bank Transfer</div><div style="color:rgba(255,255,255,.35);font-size:11px">'+(details.accountName||'UK Bank')+'</div></div><div style="color:#22c55e;font-size:11px;font-weight:700">Connected ✓</div>';
    }else{
      el.innerHTML='<div style="font-size:20px">⚠️</div><div style="flex:1"><div style="color:#fff;font-size:13px;font-weight:600">No method set</div><div style="color:rgba(255,255,255,.35);font-size:11px">Go back and add one</div></div>';
    }
  }catch(e){}
}

window._ctaConfirmWithdraw=async function(tabType){
  var btn=document.getElementById('sg-cta-wd-confirm');
  var err=document.getElementById('sg-cta-wd-error');
  var amtEl=document.getElementById('sg-cta-wd-amount');
  if(!amtEl)return;
  var amount=parseFloat(amtEl.value);
  if(isNaN(amount)||amount<10){
    if(err){err.textContent='Minimum withdrawal is £10.00';err.style.display='block';}return;
  }
  if(amount>window._ctaAvailableBalance){
    if(err){err.textContent='Insufficient balance (£'+window._ctaAvailableBalance.toFixed(2)+' available)';err.style.display='block';}return;
  }
  if(err)err.style.display='none';
  if(btn){btn.textContent='Processing…';btn.style.opacity='.6';btn.style.pointerEvents='none';}

  try{
    var endpoint=tabType==='partner'?'/api/gym-partner/request-payout':'/api/referrals/withdraw';
    var body=tabType==='partner'?{amount:amount}:{amount:amount};
    var res=await fetch(endpoint,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await res.json();
    if(d.success||d.payout){
      if(btn){btn.textContent='✅ Withdrawal Requested!';btn.style.background='#22c55e';btn.style.opacity='1';}
      if(navigator.vibrate)navigator.vibrate([50,50,50]);
      // Update balance display
      var balEl=document.getElementById('sg-cta-wd-balance');
      if(balEl)balEl.textContent='£'+(window._ctaAvailableBalance-amount).toFixed(2);
      if(typeof sgToast==='function')sgToast('£'+amount.toFixed(2)+' withdrawal requested! 🎉','success',4000);
      setTimeout(function(){_ctaCloseSheet();},1500);
    }else{
      if(err){err.textContent=d.error||'Withdrawal failed — try again';err.style.display='block';}
      if(btn){btn.textContent='Confirm Withdrawal →';btn.style.opacity='1';btn.style.pointerEvents='auto';}
    }
  }catch(e){
    if(err){err.textContent='Network error — try again';err.style.display='block';}
    if(btn){btn.textContent='Confirm Withdrawal →';btn.style.opacity='1';btn.style.pointerEvents='auto';}
  }
};


// ══════════════════════════════════════════════════════════════════════
// PARTNER TAB: Continue CTA Flow
// Flow: Sign In → Add Withdraw Method → Search/Claim Gym → Wallet → Withdraw
// ══════════════════════════════════════════════════════════════════════

window._partnerContinueFlow=function(){
  var u=state&&state.user;

  // Step 1: Not signed in → show auth sheet
  if(!u){
    if(typeof window._sgShowAuthSheet==='function'){
      // Set callback so after auth we re-trigger the flow
      window._partnerPostAuth=true;
      window._sgShowAuthSheet('book');
    }else{
      navigate('/login');
    }
    return;
  }

  // Step 2: No withdraw method → show add withdraw sheet
  if(!_hasWithdrawMethod()){
    _showAddWithdrawSheet(function(){
      // After adding method, continue to step 3
      window._partnerContinueFlow();
    });
    return;
  }

  // Step 3: Has gym? → Show wallet/withdraw. No gym? → Search to claim
  var hasGym=window._partnerGymId||false;
  if(!hasGym){
    // Check if they have a claimed gym
    fetch('/api/gym-partner/dashboard',{credentials:'include'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
      if(d&&d.gyms&&d.gyms.length>0){
        window._partnerGymId=d.gyms[0].id;
        // Gym found → go to withdraw
        _showConfirmWithdrawSheet('partner');
      }else{
        // No gym → show search to claim
        if(typeof sgToast==='function')sgToast('Search for your gym to claim it 🔍','info',3000);
        if(typeof window._openSearchOverlay==='function'){
          window._openSearchOverlay();
        }else{
          navigate('/list-your-gym');
        }
      }
    }).catch(function(){
      // Fallback to wallet
      _showConfirmWithdrawSheet('partner');
    });
    return;
  }

  // Step 4: Everything ready → show confirm & withdraw
  _showConfirmWithdrawSheet('partner');
};

// Hook into auth success to continue partner flow
var _origAuthAfterSuccess=window._sgAuthAfterSuccess;
window._sgAuthAfterSuccess=function(){
  if(_origAuthAfterSuccess)_origAuthAfterSuccess();
  // If partner flow was in progress, continue it
  if(window._partnerPostAuth){
    window._partnerPostAuth=false;
    setTimeout(function(){window._partnerContinueFlow();},500);
  }
  // If creator flow was in progress, continue it
  if(window._creatorPostAuth){
    window._creatorPostAuth=false;
    setTimeout(function(){window._creatorContinueFlow();},500);
  }
};


// ══════════════════════════════════════════════════════════════════════
// CREATOR TAB: Continue CTA Flow
// Flow: Sign In → Add Withdraw Method → Confirm & Withdraw
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

  // Step 2: No withdraw method → show add withdraw sheet
  if(!_hasWithdrawMethod()){
    _showAddWithdrawSheet(function(){
      // After adding method, continue to step 3
      window._creatorContinueFlow();
    });
    return;
  }

  // Step 3: Everything ready → show confirm & withdraw
  _showConfirmWithdrawSheet('creator');
};


// ══════════════════════════════════════════════════════════════════════
// CONTINUE BANNER: Inject into Partner and Creator tabs
// The orange CTA bar shown at the bottom of the tab, above the tab bar
// ══════════════════════════════════════════════════════════════════════

// Compute what step the user is on and set the CTA label
function _getCTAState(tabType){
  var u=state&&state.user;
  if(!u)return{step:1,label:'Continue',sublabel:'Sign in to get started'};
  if(!_hasWithdrawMethod())return{step:2,label:'Continue',sublabel:'Add your withdraw method'};
  if(tabType==='partner'){
    var hasGym=window._partnerGymId||false;
    if(!hasGym)return{step:3,label:'Continue',sublabel:'Search & claim your gym'};
    return{step:4,label:'Withdraw Earnings →',sublabel:'Your gym is live!'};
  }
  return{step:3,label:'Withdraw Earnings →',sublabel:'You\'re all set!'};
}

// Inject the Continue CTA into Partner/Creator tab HTML
// Called from the patched PartnerFullPage / CreatorFullPage
function _injectContinueBanner(tabType){
  var containerId=tabType+'-continue-banner';
  setTimeout(function(){
    // Remove old banner if exists
    var old=document.getElementById(containerId);
    if(old)old.remove();

    var ctaState=_getCTAState(tabType);
    var banner=document.createElement('div');
    banner.id=containerId;
    banner.style.cssText='position:fixed;bottom:calc(56px + env(safe-area-inset-bottom,0px));left:0;right:0;z-index:8999;padding:0 12px 0;pointer-events:none';
    banner.innerHTML=''
      +'<div onclick="window._'+(tabType==='partner'?'partnerContinueFlow':'creatorContinueFlow')+'()" style="pointer-events:auto;background:linear-gradient(135deg,#FF6D00 0%,#E66200 100%);border-radius:16px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;box-shadow:0 4px 24px rgba(255,109,0,.35),0 0 0 1px rgba(255,109,0,.15);margin:8px 0;transition:transform .1s" ontouchstart="this.style.transform=\'scale(.98)\'" ontouchend="this.style.transform=\'scale(1)\'">'
      +'<div>'
      +'<div style="color:#fff;font-size:16px;font-weight:800;letter-spacing:.3px">'+ctaState.label+'</div>'
      +'<div style="color:rgba(255,255,255,.65);font-size:11px;font-weight:500;margin-top:1px">'+ctaState.sublabel+'</div>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:8px">'
      // Step dots (show progress)
      +'<div style="display:flex;gap:4px">'
      +_stepDots(ctaState.step,tabType==='partner'?4:3)
      +'</div>'
      +'<div style="color:#fff;font-size:20px;font-weight:700">→</div>'
      +'</div>'
      +'</div>';
    document.body.appendChild(banner);
  },100);
}

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

// Make injection available globally
window._injectContinueBanner=_injectContinueBanner;


// ══════════════════════════════════════════════════════════════════════
// PATCH: Override PartnerFullPage and CreatorFullPage to add Continue CTA
// ══════════════════════════════════════════════════════════════════════

// Wait for the original functions to be defined, then patch
var _patchInterval=setInterval(function(){
  if(typeof PartnerFullPage==='function'&&typeof CreatorFullPage==='function'){
    clearInterval(_patchInterval);

    // Patch _showPartnerScreen to refresh banner when switching screens
    var _origShowPartnerScreen=window._showPartnerScreen;
    window._showPartnerScreen=function(idx){
      _origShowPartnerScreen(idx);
      _injectContinueBanner('partner');
    };

    // Patch _showCreatorScreen to refresh banner
    var _origShowCreatorScreen=window._showCreatorScreen;
    if(_origShowCreatorScreen){
      window._showCreatorScreen=function(idx){
        _origShowCreatorScreen(idx);
        _injectContinueBanner('creator');
      };
    }

    // Listen for route switches to inject/remove banner
    // Note: /partner and /creator map to activeTab='more', so check route instead
    var _lastRoute='';
    setInterval(function(){
      var route=state&&state.route;
      var isPartner=(route==='/partner'||route==='/partner/');
      var isCreator=(route==='/creator'||route==='/creator/');
      if(route!==_lastRoute){
        _lastRoute=route;
        // Clean up banners from other routes
        if(!isPartner){
          var pb=document.getElementById('partner-continue-banner');
          if(pb)pb.remove();
        }
        if(!isCreator){
          var cb=document.getElementById('creator-continue-banner');
          if(cb)cb.remove();
        }
        // Inject banner for current route
        if(isPartner)_injectContinueBanner('partner');
        if(isCreator)_injectContinueBanner('creator');
      }
    },300);
  }
},200);

// ══════════════════════════════════════════════════════════════════════
// ALSO: Patch tab bar bottom offset when banner is visible
// ══════════════════════════════════════════════════════════════════════

var _bannerStyle=document.createElement('style');
_bannerStyle.textContent=''
  +'#partner-continue-banner,#creator-continue-banner{'
  +'animation:ctaBannerIn .4s cubic-bezier(.32,.72,0,1) both;'
  +'}'
  +'@keyframes ctaBannerIn{'
  +'from{opacity:0;transform:translateY(20px)}'
  +'to{opacity:1;transform:translateY(0)}'
  +'}';
document.head.appendChild(_bannerStyle);

})();
