/**
 * ScanGym Wallet Withdraw — Trello board "1. Tabs" items
 *
 *  ScanSquad tab: ⏱ Add withdraw method for ScanGym wallet balance
 *  ScanSquad tab: ⏱ Withdraw from ScanGym wallet
 *  Partner tab:   ⏱ Add withdraw method for ScanGym wallet balance
 *  Partner tab:   ⏱ Withdraw from ScanGym wallet
 *
 *  End-to-end flow backed by the real wallet API:
 *    GET  /api/wallet                  → live balance
 *    GET  /api/wallet/withdraw-method  → which payout rail is set up
 *    POST /api/wallet/withdraw         → Stripe Connect transfer (or queued
 *                                        bank/PayPal payout as fallback)
 *
 *  Purely additive — uses the existing _sgOpenSheet half-sheet system
 *  (✕ close + swipe-down) and injects buttons into the existing right rails.
 */
(function(){
'use strict';

var IS_SHEET_EMBED=false;
try{IS_SHEET_EMBED=new URLSearchParams(location.search).get('sg_sheet')==='1';}catch(e){}

function curUser(){
  try{if(typeof state!=='undefined'&&state)return state.user||null;}catch(e){}
  return null;
}
function curRoute(){
  try{if(typeof state!=='undefined'&&state&&state.route)return state.route;}catch(e){}
  return location.pathname||'';
}
function curTab(){
  try{if(typeof state!=='undefined'&&state&&state.activeTab)return state.activeTab;}catch(e){}
  var r=curRoute();
  if(r.indexOf('/partner')===0)return 'partner';
  if(r.indexOf('/creator')===0)return 'creator';
  return '';
}
function creatorHandle(){
  try{
    var u=curUser();
    if(u&&u.referral_code)return u.referral_code;
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'null');
    if(cd&&(cd.handle||cd.slug))return cd.handle||cd.slug;
  }catch(e){}
  return '';
}
function toast(msg,type,ms){if(window.sgToast)sgToast(msg,type||'info',ms||2500);}
function requireAuth(){
  var u=curUser();
  if(u)return true;
  toast('Sign in to manage withdrawals','info',2500);
  if(typeof window._sgShowAuthSheet==='function')window._sgShowAuthSheet('book');
  else if(typeof navigate==='function')navigate('/login');
  return false;
}
function openSheet(id,html){
  if(typeof window._sgOpenSheet==='function'){window._sgOpenSheet(id,html);return true;}
  return false;
}
function closeSheet(id){if(typeof window._sgCloseSheet==='function')window._sgCloseSheet(id);}

/* ════════════════════════════════════════════════════════════════════
   1) WITHDRAW SHEET — balance card, amount input, MAX, confirm
   ════════════════════════════════════════════════════════════════════ */
window._sgWalletWithdraw=async function(){
  if(!requireAuth())return;
  var html=''
    +'<h2 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 14px">💸 Withdraw from ScanGym Wallet</h2>'
    +'<div style="background:linear-gradient(135deg,#FF6D00,#ff8f3f);border-radius:16px;padding:18px;margin-bottom:14px;text-align:center">'
    +'<div style="font-size:12px;color:rgba(255,255,255,.8);margin-bottom:4px">ScanGym Wallet Balance</div>'
    +'<div id="sg-ww-balance" style="font-size:34px;font-weight:800;color:#fff;font-family:Sora,Inter,sans-serif">—</div>'
    +'</div>'
    +'<div id="sg-ww-method" style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px 14px;margin-bottom:14px">'
    +'<span style="font-size:18px">🏦</span><span style="color:rgba(255,255,255,.5);font-size:12px">Checking withdraw method…</span>'
    +'</div>'
    +'<label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Amount (£)</label>'
    +'<div style="display:flex;gap:8px;margin-bottom:8px">'
    +'<input id="sg-ww-amount" type="number" min="1" step="0.01" placeholder="0.00" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:18px;font-weight:700;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'">'
    +'<button onclick="window._sgWWMax()" style="background:rgba(255,109,0,.12);border:1px solid rgba(255,109,0,.3);color:#FF6D00;padding:0 18px;border-radius:12px;font-size:13px;font-weight:800;cursor:pointer">MAX</button>'
    +'</div>'
    +'<p style="color:rgba(255,255,255,.3);font-size:11px;margin:0 0 12px">Min £1 · Max £1,000 per request</p>'
    +'<p id="sg-ww-error" style="color:#ef4444;font-size:13px;margin:0 0 8px;display:none"></p>'
    +'<button id="sg-ww-confirm" onclick="window._sgWWConfirm()" style="width:100%;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(34,197,94,.3)">Withdraw →</button>'
    +'<button onclick="window._sgWalletAddMethod()" style="width:100%;background:none;border:none;color:rgba(255,255,255,.4);font-size:13px;font-weight:600;cursor:pointer;padding:12px;margin-top:4px">🏦 Add / change withdraw method</button>';
  if(!openSheet('sg-wallet-withdraw-sheet',html)){toast('Withdrawals unavailable right now','error');return;}

  // Load live balance + method state
  window._sgWWBalance=0;
  try{
    var w=await fetch('/api/wallet',{credentials:'include'}).then(function(r){return r.json();});
    window._sgWWBalance=parseInt(w.balancePence)||Math.round((parseFloat(w.balance)||0)*100);
    var el=document.getElementById('sg-ww-balance');
    if(el)el.textContent='£'+(window._sgWWBalance/100).toFixed(2);
  }catch(e){}
  try{
    var qs=creatorHandle()?('?creatorHandle='+encodeURIComponent(creatorHandle())):'';
    var m=await fetch('/api/wallet/withdraw-method'+qs,{credentials:'include'}).then(function(r){return r.json();});
    var box=document.getElementById('sg-ww-method');
    if(box){
      if(m.stripeReady){
        box.innerHTML='<span style="font-size:18px">⚡</span><div><p style="color:#fff;font-size:13px;font-weight:700;margin:0">Stripe Connect</p><p style="color:#4ade80;font-size:11px;margin:2px 0 0">Instant payouts enabled ✓</p></div>';
      }else if(m.saved){
        var s=m.summary||{};
        var desc=s.type==='paypal'?('PayPal · '+(s.email||'')):('Bank ····'+(s.last4||''));
        box.innerHTML='<span style="font-size:18px">🏦</span><div><p style="color:#fff;font-size:13px;font-weight:700;margin:0">'+desc+'</p><p style="color:rgba(255,255,255,.4);font-size:11px;margin:2px 0 0">Payouts arrive in 2-5 business days</p></div>';
      }else{
        box.innerHTML='<span style="font-size:18px">⚠️</span><div><p style="color:#fbbf24;font-size:13px;font-weight:700;margin:0">No withdraw method yet</p><p style="color:rgba(255,255,255,.4);font-size:11px;margin:2px 0 0">Add one below to withdraw your balance</p></div>';
      }
    }
  }catch(e){}
};
window._sgWWMax=function(){
  var i=document.getElementById('sg-ww-amount');
  if(!i)return;
  var maxPence=Math.min(window._sgWWBalance||0,100000);
  i.value=(maxPence/100).toFixed(2);
};
window._sgWWConfirm=async function(){
  var i=document.getElementById('sg-ww-amount');
  var err=document.getElementById('sg-ww-error');
  var btn=document.getElementById('sg-ww-confirm');
  if(err)err.style.display='none';
  var amount=parseFloat(i&&i.value);
  if(!amount||amount<1){if(err){err.textContent='Enter an amount of at least £1';err.style.display='block';}return;}
  if(btn){btn.textContent='Processing…';btn.style.opacity='.6';btn.style.pointerEvents='none';}
  try{
    var body={amount:amount};
    var h=creatorHandle();if(h)body.creatorHandle=h;
    var r=await fetch('/api/wallet/withdraw',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(d.success){
      closeSheet('sg-wallet-withdraw-sheet');
      toast(d.message||('£'+amount.toFixed(2)+' withdrawal on its way!'),'success',4500);
      return;
    }
    if(d.needsMethod||d.needsOnboarding){
      closeSheet('sg-wallet-withdraw-sheet');
      toast(d.error||'Set up a withdraw method first','info',3000);
      window._sgWalletAddMethod();
      return;
    }
    if(err){err.textContent=d.error||'Withdrawal failed — try again';err.style.display='block';}
  }catch(e){
    if(err){err.textContent='Network error — try again';err.style.display='block';}
  }
  if(btn){btn.textContent='Withdraw →';btn.style.opacity='1';btn.style.pointerEvents='auto';}
};

/* ════════════════════════════════════════════════════════════════════
   2) ADD WITHDRAW METHOD SHEET — Stripe Connect / PayPal / UK bank
      Bank + PayPal persist server-side via /api/gym-partner/payout-method
      (shared payout_methods table); Stripe goes through Connect onboarding.
   ════════════════════════════════════════════════════════════════════ */
window._sgWalletAddMethod=function(){
  if(!requireAuth())return;
  function opt(id,icon,iconBg,title,sub,checked){
    return '<div id="sg-wm-opt-'+id+'" onclick="window._sgWMSelect(\''+id+'\')" style="display:flex;align-items:center;gap:14px;padding:14px;background:'+(checked?'rgba(255,109,0,.06)':'rgba(255,255,255,.03)')+';border:2px solid '+(checked?'rgba(255,109,0,.3)':'rgba(255,255,255,.08)')+';border-radius:16px;cursor:pointer;margin-bottom:10px">'
      +'<div style="width:44px;height:44px;background:'+iconBg+';border-radius:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;font-size:18px;font-weight:800">'+icon+'</div>'
      +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">'+title+'</div><div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">'+sub+'</div></div>'
      +'<div style="width:20px;height:20px;border:2px solid '+(checked?'#FF6D00':'rgba(255,255,255,.2)')+';border-radius:50%;display:flex;align-items:center;justify-content:center"><div id="sg-wm-dot-'+id+'" style="width:10px;height:10px;background:'+(checked?'#FF6D00':'transparent')+';border-radius:50%"></div></div>'
      +'</div>';
  }
  var html=''
    +'<h2 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 4px">🏦 Add Withdraw Method</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0 0 16px">Choose how your ScanGym wallet balance gets paid out</p>'
    +opt('stripe','S','linear-gradient(135deg,#635BFF,#7A73FF)','Stripe Connect','Instant transfers to your bank · Recommended',true)
    +opt('paypal','PP','linear-gradient(135deg,#003087,#009cde)','PayPal','Withdraw to your PayPal account',false)
    +opt('bank','🏦','linear-gradient(135deg,#22c55e,#16a34a)','Bank Transfer','UK sort code & account number',false)
    +'<div id="sg-wm-form" style="margin-top:14px"></div>'
    +'<p id="sg-wm-error" style="color:#ef4444;font-size:13px;margin:8px 0 0;display:none"></p>'
    +'<button id="sg-wm-save" onclick="window._sgWMSave()" style="width:100%;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;margin-top:14px;box-shadow:0 4px 20px rgba(255,109,0,.3)">Connect with Stripe →</button>';
  if(!openSheet('sg-wallet-method-sheet',html)){toast('Unavailable right now','error');return;}
  window._sgWMType='stripe';
  renderMethodForm('stripe');
};
window._sgWMSelect=function(type){
  window._sgWMType=type;
  ['stripe','paypal','bank'].forEach(function(t){
    var o=document.getElementById('sg-wm-opt-'+t),d=document.getElementById('sg-wm-dot-'+t);
    var on=t===type;
    if(o){o.style.borderColor=on?'rgba(255,109,0,.3)':'rgba(255,255,255,.08)';o.style.background=on?'rgba(255,109,0,.06)':'rgba(255,255,255,.03)';}
    if(d){d.style.background=on?'#FF6D00':'transparent';d.parentElement.style.borderColor=on?'#FF6D00':'rgba(255,255,255,.2)';}
  });
  renderMethodForm(type);
};
function renderMethodForm(type){
  var area=document.getElementById('sg-wm-form');
  var btn=document.getElementById('sg-wm-save');
  if(!area)return;
  function input(id,label,ph,extra){
    return '<div style="flex:1"><label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">'+label+'</label>'
      +'<input id="'+id+'" type="text" placeholder="'+ph+'" '+(extra||'')+' style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:13px 15px;color:#fff;font-size:15px;outline:none;box-sizing:border-box"></div>';
  }
  if(type==='stripe'){
    area.innerHTML='<div style="background:rgba(99,91,255,.06);border:1px solid rgba(99,91,255,.15);border-radius:14px;padding:14px;display:flex;align-items:center;gap:12px">'
      +'<span style="font-size:24px">⚡</span><div><p style="color:#fff;font-size:13px;font-weight:600;margin:0">Stripe Connect</p>'
      +'<p style="color:rgba(255,255,255,.4);font-size:11px;margin:2px 0 0">Verify your bank details right here. Takes ~2 minutes, then withdrawals are instant.</p></div></div>';
    if(btn)btn.textContent='Connect with Stripe →';
  }else if(type==='paypal'){
    area.innerHTML=input('sg-wm-paypal','PayPal Email','your@email.com','inputmode="email"');
    if(btn)btn.textContent='Save PayPal →';
  }else{
    area.innerHTML='<div style="display:flex;flex-direction:column;gap:10px">'
      +input('sg-wm-name','Account Holder Name','John Smith')
      +'<div style="display:flex;gap:10px">'
      +input('sg-wm-sort','Sort Code','12-34-56','maxlength="8" inputmode="numeric"')
      +input('sg-wm-acct','Account Number','12345678','maxlength="8" inputmode="numeric"')
      +'</div></div>';
    if(btn)btn.textContent='Save Bank Details →';
  }
}
window._sgWMSave=async function(){
  var type=window._sgWMType;
  var btn=document.getElementById('sg-wm-save');
  var err=document.getElementById('sg-wm-error');
  if(err)err.style.display='none';
  function fail(msg){if(err){err.textContent=msg;err.style.display='block';}if(btn){btn.style.opacity='1';btn.style.pointerEvents='auto';renderBtn();}}
  function renderBtn(){if(btn)btn.textContent=type==='stripe'?'Connect with Stripe →':type==='paypal'?'Save PayPal →':'Save Bank Details →';}
  if(btn){btn.textContent='Saving…';btn.style.opacity='.6';btn.style.pointerEvents='none';}

  if(type==='stripe'){
    // Embedded Stripe Connect onboarding — renders inside the app
    try{
      var d;
      if(curTab()==='partner'){
        d=await fetch('/api/gym-partner/stripe-connect',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json();});
      }else{
        d=await fetch('/api/wallet/stripe-connect',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({creatorHandle:creatorHandle()})}).then(function(r){return r.json();});
      }
      if(d.onboardingComplete||d.stripeConnected){closeSheet('sg-wallet-method-sheet');toast('Stripe already connected ✓','success',3000);return;}
      if(!d.clientSecret){fail(d.error||d.message||'Stripe Connect setup failed');return;}
      // Open embedded onboarding in a full-screen overlay
      window._sgOpenEmbeddedOnboarding(d.clientSecret, d.accountId);
    }catch(e){fail('Network error — try again');}
    return;
  }

  var method,details={};
  if(type==='paypal'){
    var pe=document.getElementById('sg-wm-paypal');
    if(!pe||!(pe.value||'').includes('@'))return fail('Enter a valid PayPal email');
    method='paypal';details={paypalEmail:pe.value.trim()};
  }else{
    var n=document.getElementById('sg-wm-name'),s=document.getElementById('sg-wm-sort'),a=document.getElementById('sg-wm-acct');
    if(!n||!n.value.trim()||!s||!s.value.trim()||!a||!a.value.trim())return fail('Fill in all bank details');
    method='bank';details={accountName:n.value.trim(),sortCode:s.value.trim(),accountNumber:a.value.trim()};
  }
  try{
    var r=await fetch('/api/gym-partner/payout-method',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:method,details:details})});
    var res=await r.json();
    if(res.success){
      closeSheet('sg-wallet-method-sheet');
      toast('Withdraw method saved ✓','success',3000);
      return;
    }
    fail(res.error||'Could not save method');
  }catch(e){fail('Network error — try again');}
};

/* ════════════════════════════════════════════════════════════════════
   3) ENTRY POINTS — "Withdraw" + "Payout" buttons on the ScanSquad and
      Partner right rails (mimic sibling styling); re-injected after
      re-renders. Also upgrade _sgCreatorWithdraw to the real flow.
   ════════════════════════════════════════════════════════════════════ */
function railBtn(icon,label,onclick){
  var b=document.createElement('div');
  b.className='sg-wd-rail-btn';
  b.setAttribute('onclick',onclick);
  b.style.cssText='display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;-webkit-tap-highlight-color:transparent';
  b.innerHTML='<div style="width:46px;height:46px;background:rgba(34,197,94,.15);backdrop-filter:blur(16px);border:1px solid rgba(34,197,94,.3);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px">'+icon+'</div>'
    +'<span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.8)">'+label+'</span>';
  return b;
}
function findRail(){
  var divs=document.querySelectorAll('div[style]');
  for(var i=0;i<divs.length;i++){
    var st=divs[i].getAttribute('style')||'';
    if(/position:\s*(fixed|absolute)/.test(st)&&/right:\s*(8|10|12)px/.test(st)&&/flex-direction:\s*column/.test(st)&&divs[i].offsetParent!==null){
      if(divs[i].id==='sg-reels-rail')continue;
      return divs[i];
    }
  }
  return null;
}
function injectWalletButtons(){
  if(IS_SHEET_EMBED)return;
  var tab=curTab();
  var route=curRoute();
  var onTarget=(tab==='creator'||tab==='partner'||route.indexOf('/creator')===0||route.indexOf('/partner')===0);
  var existing=document.querySelectorAll('.sg-wd-rail-btn');
  if(!onTarget){existing.forEach(function(e){e.remove();});return;}
  if(existing.length)return;
  var rail=findRail();
  if(!rail)return;
  // ONE withdraw button per rail (user request) — recognise every existing
  // withdraw-ish handler, and no separate Payout button: add/change method
  // lives inside the withdraw sheet itself.
  var hasWithdraw=/_sgCreatorWithdraw|_sgWalletWithdraw|_creatorWithdraw|_partnerWithdraw|_partnerContinueFlow/.test(rail.innerHTML);
  if(!hasWithdraw)rail.appendChild(railBtn('💸','Withdraw','_sgWalletWithdraw()'));
}
setInterval(injectWalletButtons,700);

// Override ALL legacy withdraw functions from both Creator and Partner tabs
// to route through the unified wallet withdraw sheet (balance, method
// setup, Stripe Connect — all in one place).
function upgradeCreatorWithdraw(){
  window._sgCreatorWithdraw=function(){window._sgWalletWithdraw();};
  window._creatorWithdraw=function(){window._sgWalletWithdraw();};
  window._sgCreatorAddWithdrawMethod=function(){window._sgWalletAddMethod();};
  // Partner overrides — legacy sheets are Stripe-only; unified flow supports
  // Stripe + bank + PayPal and doesn't require Seam connection.
  window._partnerWithdraw=function(){window._sgWalletWithdraw();};
  window._sgPartnerWithdrawToBank=function(){window._sgWalletWithdraw();};
  window._sgPartnerAddWithdrawMethod=function(){window._sgWalletAddMethod();};
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(upgradeCreatorWithdraw,300);});}
else{setTimeout(upgradeCreatorWithdraw,300);}

/* ════════════════════════════════════════════════════════════════════
   4) EMBEDDED STRIPE CONNECT ONBOARDING — renders the Stripe
      <stripe-connect-account-onboarding> component in a full-screen
      overlay instead of redirecting to Stripe's hosted page.
   ════════════════════════════════════════════════════════════════════ */
window._sgOpenEmbeddedOnboarding=function(clientSecret, accountId){
  // Close the method sheet
  closeSheet('sg-wallet-method-sheet');

  // Build the overlay
  var overlay=document.createElement('div');
  overlay.id='sg-stripe-onboarding-overlay';
  overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#111;overflow-y:auto;display:flex;flex-direction:column;align-items:center';
  overlay.innerHTML=''
    +'<div style="width:100%;max-width:680px;padding:20px 16px;box-sizing:border-box">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">'
    +'<div><h2 style="color:#fff;font-size:20px;font-weight:800;margin:0">🏦 Connect Your Bank</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:4px 0 0">Complete verification to receive payouts</p></div>'
    +'<button id="sg-stripe-onb-close" style="background:rgba(255,255,255,.1);border:none;color:#fff;font-size:24px;width:40px;height:40px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>'
    +'</div>'
    +'<div id="sg-stripe-onb-container" style="background:#fff;border-radius:16px;overflow:hidden;min-height:400px;display:flex;align-items:center;justify-content:center">'
    +'<p style="color:#666;font-size:14px;padding:40px">Loading Stripe onboarding…</p>'
    +'</div>'
    +'</div>';

  document.body.appendChild(overlay);
  document.body.style.overflow='hidden';

  // Close button handler
  document.getElementById('sg-stripe-onb-close').onclick=function(){
    document.body.removeChild(overlay);
    document.body.style.overflow='';
  };

  // Wait for Connect.js to load, then initialise
  function initConnect(){
    if(typeof StripeConnect==='undefined'){
      setTimeout(initConnect,200);
      return;
    }
    try{
      window.__configPromise.then(function(cfg){
        var stripePublishableKey=cfg.stripeKey;
        if(!stripePublishableKey){
          document.getElementById('sg-stripe-onb-container').innerHTML='<p style="color:#ef4444;padding:40px">Stripe not configured — contact support</p>';
          return;
        }
        var instance=StripeConnect.init({
          publishableKey:stripePublishableKey,
          fetchClientSecret:function(){return Promise.resolve(clientSecret);},
          appearance:{
            colors:{
              primary:'#FF6D00',
              background:'#ffffff',
              formBackground:'#f9fafb',
            },
          },
        });
        var onboarding=instance.create('account-onboarding');
        onboarding.setOnExit(function(){
          toast('Bank details saved ✓','success',3000);
          document.body.removeChild(overlay);
          document.body.style.overflow='';
        });
        var container=document.getElementById('sg-stripe-onb-container');
        container.innerHTML='';
        container.appendChild(onboarding);
      });
    }catch(e){
      console.error('[EmbeddedOnboarding] Init error:',e);
      document.getElementById('sg-stripe-onb-container').innerHTML='<p style="color:#ef4444;padding:40px">Failed to load onboarding — try again</p>';
    }
  }
  initConnect();
};

console.log('[WalletWithdraw] ScanSquad/Partner wallet withdraw flows active (embedded onboarding v1.1)');
})();
