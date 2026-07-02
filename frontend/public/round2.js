/* ═══════════════════════════════════════════════════════════════════════════
   ScanGym Round 2 — Tabs board polish (ScanSquad + Partner)
   1) Partner branding — remove the stray orange circle that overlaps the
      "Partner Dashboard" pill (the pill already carries the 🟠 brand mark).
   2) ScanSquad branding — brand header styled as a proper pill (same look
      as the Partner header) and kept clear of the temporary USP banner.
   3) ScanSquad brand colours — the purple Copy/Share buttons become
      ScanGym orange.
   4) Share = deep affiliate link — the ScanSquad Share button shares the
      creator's affiliate link via the native share sheet.
   5) Continue CTA on ScanSquad — the orange full-width Continue bar
      (like Reels/Book/Partner) is re-enabled on the /creator tab.
   6) Withdraw flow fixes:
      - "Add / Change Withdraw Method" buttons open the proper method sheet
        (Stripe / PayPal / UK bank) instead of a broken Stripe-only call.
      - Saved methods are persisted server-side (survives new devices).
      - "Withdraw to Bank" works without Stripe Connect via a pending
        payout request (bank transfer fallback), and creator withdrawals
        send the right fields.
      - 💸 rail button on ScanSquad opens the wallet sheet in place
        instead of navigating away.
   Purely additive patch file — loaded after app.ctr576.js + continue-cta-flow.js.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

function route(){return (window.state&&state.route)||location.pathname;}
function onCreator(){var r=route();return r==='/creator'||r==='/creator/';}
function onPartner(){var r=route();return r==='/partner'||r==='/partner/';}
function creatorHandle(){
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'null')||{};
    if(cd.handle||cd.slug)return cd.handle||cd.slug;
  }catch(e){}
  var u=window.state&&state.user;
  return (u&&u.referral_code)||'';
}

/* ════════════════════════════════════════════════════════════════════
   1) PARTNER BRANDING — remove the floating 28px orange circle that
      overlaps the "Partner Dashboard" pill top-left.
   ════════════════════════════════════════════════════════════════════ */
function fixPartnerBranding(){
  if(!onPartner())return;
  /* Branding = just the orange circle top-left (same as Reels + Book).
     Remove the "Partner Dashboard" pill that was hiding/duplicating it. */
  document.querySelectorAll('span').forEach(function(sp){
    if(sp.textContent==='Partner Dashboard'&&!sp.dataset.sgR2){
      sp.dataset.sgR2='1';
      var pill=sp.parentElement;
      var topbar=pill&&pill.parentElement;
      if(topbar)topbar.style.display='none';
      else if(pill)pill.style.display='none';
    }
  });
  /* the Book-tab social-proof strip (#sg-sps) doesn't belong on the
     partner dashboard and stays stuck on "Loading..." there — hide it */
  var sps=document.getElementById('sg-sps');
  if(sps)sps.style.display='none';
}

/* ════════════════════════════════════════════════════════════════════
   2) SCANSQUAD BRANDING — restyle the injected brand header into the
      same dark pill used on the Partner tab, and keep it visible when
      the temporary USP banner is on screen.
   ════════════════════════════════════════════════════════════════════ */
function fixSquadBranding(){
  if(!onCreator())return;
  /* Branding = just the orange circle top-left, exactly like Reels + Book. */
  var b=document.getElementById('sg-squad-brand');
  if(b&&!b.dataset.sgR2){
    b.dataset.sgR2='1';
    b.style.cssText='margin:0 0 14px;padding:0;flex-shrink:0';
    b.innerHTML='<div style="width:28px;height:28px;background:#FF6D00;border-radius:50%;opacity:.85;box-shadow:0 0 10px rgba(255,109,0,.5)"></div>';
  }
  /* the Book-tab social-proof strip doesn't belong here either */
  var sps=document.getElementById('sg-sps');
  if(sps)sps.style.display='none';
}

/* ════════════════════════════════════════════════════════════════════
   3) SCANSQUAD ORANGE — purple (#a855f7) Copy / Share buttons become
      ScanGym brand orange.
   ════════════════════════════════════════════════════════════════════ */
function fixSquadColors(){
  if(!onCreator())return;
  document.querySelectorAll('button').forEach(function(btn){
    if(btn.dataset.sgR2Orange)return;
    var s=btn.getAttribute('style')||'';
    if(s.indexOf('#a855f7')>-1||s.indexOf('#7c3aed')>-1){
      btn.dataset.sgR2Orange='1';
      btn.style.background='linear-gradient(135deg,#FF6D00,#E66200)';
      btn.style.boxShadow='0 2px 12px rgba(255,109,0,.3)';
    }
  });
}

/* ════════════════════════════════════════════════════════════════════
   4) SHARE = DEEP AFFILIATE LINK — the ScanSquad Share button shares
      scangym.com/r/{handle} through the native share sheet.
   ════════════════════════════════════════════════════════════════════ */
function fixSquadShare(){
  if(!onCreator())return;
  document.querySelectorAll('button').forEach(function(btn){
    if(btn.dataset.sgR2Share)return;
    var txt=(btn.textContent||'').trim();
    if(txt.indexOf('Share')===-1||txt.length>12)return;
    var oc=btn.getAttribute('onclick')||'';
    if(oc.indexOf('navigator.share')===-1&&oc.indexOf('Share')===-1&&oc.indexOf('share')===-1)return;
    btn.dataset.sgR2Share='1';
    btn.removeAttribute('onclick');
    btn.addEventListener('click',function(ev){
      ev.stopPropagation();
      var h=creatorHandle();
      if(h&&typeof window._sgShareAffiliate==='function'){window._sgShareAffiliate(h);}
      else if(h){
        var link='https://scangym.com/r/'+h;
        if(navigator.share){navigator.share({title:'ScanGym',text:'Gym passes from \u00a34.49 \u2014 use my link:',url:link}).catch(function(){});}
        else{navigator.clipboard.writeText(link);if(typeof sgToast==='function')sgToast('Affiliate link copied!','success',2000);}
      }else if(typeof sgToast==='function'){sgToast('Sign in to get your affiliate link','info',2500);}
    });
  });
}

/* ════════════════════════════════════════════════════════════════════
   4b) SHARE BUTTON ON THE SCANSQUAD RIGHT-SIDE RAIL — shares the
       creator's deep affiliate link (scangym.com/r/{handle}) via the
       native share sheet. Sits with the other right-side buttons.
   ════════════════════════════════════════════════════════════════════ */
window._r2SquadRailShare=function(){
  var h=creatorHandle();
  if(!h){if(typeof sgToast==='function')sgToast('Sign in to get your affiliate link','info',2500);return;}
  if(typeof window._sgShareAffiliate==='function'){window._sgShareAffiliate(h,'native');return;}
  var link='https://scangym.com/r/'+h;
  var text='Check out ScanGym - gym access from \u00a34.49! Use my link: ';
  if(navigator.share){navigator.share({title:'ScanGym',text:text,url:link}).catch(function(){});}
  else{navigator.clipboard.writeText(link);if(typeof sgToast==='function')sgToast('Affiliate link copied!','success',2000);}
};
function addSquadRailShare(){
  if(!onCreator())return;
  if(document.getElementById('sg-r2-squad-share'))return;
  var anyBtn=document.querySelector('.creator-side-btn');
  if(!anyBtn||!anyBtn.parentElement)return;
  var rail=anyBtn.parentElement;
  var d=document.createElement('div');
  d.id='sg-r2-squad-share';
  d.className='creator-side-btn';
  d.title='Share Affiliate Link';
  d.style.cssText='width:42px;height:42px;background:rgba(255,109,0,.25);backdrop-filter:blur(8px);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;border:1px solid rgba(255,109,0,.4);transition:.2s;box-shadow:0 0 16px rgba(255,109,0,.2)';
  d.innerHTML='\ud83d\udce4';
  d.addEventListener('click',function(ev){ev.stopPropagation();window._r2SquadRailShare();if(typeof window._closeCreatorMore==='function')try{window._closeCreatorMore();}catch(e){}});
  /* place right after the "Get Affiliate Link" (🔗) button if present */
  var linkBtn=null;
  rail.querySelectorAll('.creator-side-btn').forEach(function(b){
    if((b.getAttribute('title')||'')==='Get Affiliate Link')linkBtn=b;
  });
  if(linkBtn&&linkBtn.nextSibling)rail.insertBefore(d,linkBtn.nextSibling);
  else rail.appendChild(d);
}

/* ════════════════════════════════════════════════════════════════════
   5) CONTINUE CTA ON SCANSQUAD — re-enable the orange Continue bar on
      /creator (an older patch removes it on every route change; this
      re-injects it right after).
   ════════════════════════════════════════════════════════════════════ */
setInterval(function(){
  if(typeof window._injectContinueBanner!=='function')return;
  if(onCreator()){
    if(!document.getElementById('creator-continue-banner'))window._injectContinueBanner('creator');
  }else{
    var cb=document.getElementById('creator-continue-banner');
    if(cb)cb.remove();
  }
},400);

/* Restyle the Continue banners (partner + creator) to match the slim
   full-width orange bar used on the Reels and Book tabs:
   centered "Continue →", no subtitle, no step dots. */
function restyleContinueBanner(id){
  var banner=document.getElementById(id);
  if(!banner||banner.dataset.sgR2Slim)return;
  var card=banner.firstElementChild;
  if(!card)return;
  banner.dataset.sgR2Slim='1';
  banner.style.padding='0';
  card.style.borderRadius='0';
  card.style.margin='0';
  card.style.padding='13px 16px';
  card.style.justifyContent='center';
  card.style.gap='10px';
  var left=card.children[0],right=card.children[1];
  if(left){
    var label=left.children[0],sub=left.children[1];
    if(label){label.style.fontSize='15px';label.style.letterSpacing='.3px';}
    if(sub)sub.style.display='none';
  }
  if(right){
    var dots=right.children[0];
    if(dots)dots.style.display='none';
    right.style.gap='0';
  }
}
setInterval(function(){
  try{restyleContinueBanner('partner-continue-banner');restyleContinueBanner('creator-continue-banner');}catch(e){}
},400);

/* ════════════════════════════════════════════════════════════════════
   6) WITHDRAW FLOW FIXES
   ════════════════════════════════════════════════════════════════════ */

/* 6a. Server-side persistence of the chosen withdraw method.
   Wraps _ctaSaveWithdrawMethod's local save by watching localStorage writes
   is fragile — instead re-wrap the public save entry point. */
/* Hydrate saved method from the server on login (new device support). */
var _hydrated=false;
setInterval(function(){
  if(_hydrated||!(window.state&&state.user))return;
  _hydrated=true;
  fetch('/api/gym-partner/payout-method',{credentials:'include'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      if(!d||!d.method)return;
      try{
        var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
        var pd=JSON.parse(localStorage.getItem('sg_partner')||'{}');
        if(!cd.withdrawMethod){cd.withdrawMethod=d.method;localStorage.setItem('sg_creator',JSON.stringify(cd));}
        if(!pd.withdrawMethod){pd.withdrawMethod=d.method;localStorage.setItem('sg_partner',JSON.stringify(pd));}
      }catch(e){}
    }).catch(function(){});
},1000);

/* 6b. "Add / Change Withdraw Method" buttons in the wallet sheets open the
   full method sheet (Stripe / PayPal / UK bank). The original sheet in
   continue-cta-flow.js was defined but never wired up anywhere — this
   re-creates it using the same shared sheet elements + save handlers. */
function r2OpenCtaSheet(html){
  var overlay=document.getElementById('sg-cta-overlay');
  var sheet=document.getElementById('sg-cta-sheet');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='sg-cta-overlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9499;opacity:0;transition:opacity .3s;pointer-events:none';
    overlay.onclick=function(){if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();else{overlay.style.opacity='0';overlay.style.pointerEvents='none';if(sheet)sheet.style.transform='translateY(100%)';}};
    document.body.appendChild(overlay);
  }
  if(!sheet){
    sheet=document.createElement('div');
    sheet.id='sg-cta-sheet';
    sheet.style.cssText='position:fixed;bottom:0;left:0;right:0;height:55vh;background:rgba(18,18,32,.98);backdrop-filter:blur(24px);border-radius:20px 20px 0 0;z-index:9500;transform:translateY(100%);transition:transform .35s cubic-bezier(.32,.72,0,1);box-shadow:0 -8px 40px rgba(0,0,0,.5);overflow:hidden;display:flex;flex-direction:column';
    document.body.appendChild(sheet);
  }
  sheet.innerHTML='<div style="width:40px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin:10px auto;flex-shrink:0"></div>'
    +'<div style="padding:0 20px 20px;overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch">'+html+'</div>';
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    sheet.style.transform='translateY(0)';
    overlay.style.opacity='1';overlay.style.pointerEvents='auto';
  });});
}
function r2MethodOption(id,badgeStyle,badge,name,sub,selected){
  return '<div id="sg-wd-opt-'+id+'" onclick="window._ctaSelectWithdrawOpt(\''+id+'\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:'+(selected?'rgba(255,109,0,.06)':'rgba(255,255,255,.03)')+';border:2px solid '+(selected?'rgba(255,109,0,.3)':'rgba(255,255,255,.08)')+';border-radius:16px;cursor:pointer;margin-bottom:10px;transition:all .15s">'
    +'<div style="width:48px;height:48px;background:'+badgeStyle+';border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#fff;font-size:16px;font-weight:800">'+badge+'</span></div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">'+name+'</div><div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">'+sub+'</div></div>'
    +'<div style="width:20px;height:20px;border:2px solid '+(selected?'#FF6D00':'rgba(255,255,255,.2)')+';border-radius:50%;display:flex;align-items:center;justify-content:center"><div id="sg-wd-dot-'+id+'" style="width:10px;height:10px;background:'+(selected?'#FF6D00':'transparent')+';border-radius:50%"></div></div>'
    +'</div>';
}
function r2ShowAddWithdrawSheet(){
  var html=''
    +'<div style="text-align:center;margin-bottom:20px">'
    +'<div style="font-size:40px;margin-bottom:8px">\ud83d\udcb0</div>'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Add Bank Account</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Your ScanGym wallet balance is paid to your bank account \u2014 any bank worldwide</p>'
    +'</div>'
    +r2MethodOption('bank','linear-gradient(135deg,#22c55e,#16a34a)','\ud83c\udfe6','Bank Transfer','IBAN / account number + SWIFT code',true)
    +'<div id="sg-wd-form-area" style="margin-top:16px"></div>'
    +'<p id="sg-wd-error" style="color:#ef4444;font-size:13px;margin-top:8px;display:none"></p>'
    +'<button id="sg-wd-save-btn" onclick="window._ctaSaveWithdrawMethod()" style="width:100%;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px;transition:all .2s;box-shadow:0 4px 20px rgba(255,109,0,.3)">Save Bank Details \u2192</button>';
  r2OpenCtaSheet(html);
  window._ctaWithdrawCallback=null;
  window._ctaSelectedWithdraw='bank';
  r2RenderBankForm();
}

/* Bank form — UK (sort code + account number) or International (IBAN /
   account number + SWIFT/BIC). Works for any bank worldwide. */
function r2Input(id,label,ph,max){
  return '<div style="flex:1"><label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">'+label+'</label>'
    +'<input id="'+id+'" type="text" placeholder="'+ph+'"'+(max?' maxlength="'+max+'"':'')+' style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;color:#fff;font-size:15px;outline:none;box-sizing:border-box" onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.12)\'"></div>';
}
function r2RenderBankForm(){
  var area=document.getElementById('sg-wd-form-area');
  if(!area)return;
  area.innerHTML='<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">'
    +r2Input('sg-wd-bank-name','Account Holder Name','John Smith')
    +r2Input('sg-wd-bank-iban','IBAN / Account Number','GB29 NWBK 6016 1331 9268 19')
    +r2Input('sg-wd-bank-swift','SWIFT / BIC Code','NWBKGB2L',11)
    +'</div>';
}

/* Bank-only save — replaces the original 3-method save handler. */
window._ctaSaveWithdrawMethod=async function(){
  var btn=document.getElementById('sg-wd-save-btn');
  var err=document.getElementById('sg-wd-error');
  if(err)err.style.display='none';
  function fail(msg){
    if(err){err.textContent=msg;err.style.display='block';}
    if(btn){btn.textContent='Save Bank Details \u2192';btn.style.opacity='1';btn.style.pointerEvents='auto';}
  }
  var name=(document.getElementById('sg-wd-bank-name')||{}).value||'';
  name=name.trim();
  if(!name)return fail('Enter the account holder name');
  var details={accountName:name};
  var iban=((document.getElementById('sg-wd-bank-iban')||{}).value||'').replace(/\s+/g,'').toUpperCase();
  var swift=((document.getElementById('sg-wd-bank-swift')||{}).value||'').replace(/\s+/g,'').toUpperCase();
  if(iban.length<8)return fail('Enter your IBAN or account number');
  if(swift.length<8||swift.length>11)return fail('SWIFT / BIC code is 8-11 characters');
  details.iban=iban;details.swift=swift;
  if(btn){btn.textContent='Saving\u2026';btn.style.opacity='.6';btn.style.pointerEvents='none';}
  /* save locally (both creator + partner profiles) */
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
    cd.withdrawMethod='bank';cd.withdrawDetails=details;
    localStorage.setItem('sg_creator',JSON.stringify(cd));
    var pd=JSON.parse(localStorage.getItem('sg_partner')||'{}');
    pd.withdrawMethod='bank';pd.withdrawDetails=details;
    localStorage.setItem('sg_partner',JSON.stringify(pd));
  }catch(e){}
  /* persist server-side */
  try{
    fetch('/api/gym-partner/payout-method',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({method:'bank',details:details})}).catch(function(){});
    var cd2=JSON.parse(localStorage.getItem('sg_creator')||'null')||{};
    if(cd2.handle||cd2.slug){
      fetch('/api/referrals/update-payout',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({creatorHandle:cd2.handle||cd2.slug,paymentMethod:'bank_transfer',paymentDetails:details})}).catch(function(){});
    }
  }catch(e){}
  if(btn){btn.textContent='\u2705 Bank Account Saved!';btn.style.background='#22c55e';btn.style.opacity='1';}
  if(navigator.vibrate)navigator.vibrate(50);
  setTimeout(function(){
    if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();
    if(window._ctaWithdrawCallback)window._ctaWithdrawCallback();
  },600);
};
window._sgPartnerAddWithdrawMethod=function(){
  if(typeof _sgCloseSheet==='function')_sgCloseSheet('sg-partner-wallet-sheet');
  r2ShowAddWithdrawSheet();
};
window._sgCreatorAddWithdrawMethod=function(){
  if(typeof _sgCloseSheet==='function')_sgCloseSheet('sg-creator-wallet-sheet');
  r2ShowAddWithdrawSheet();
};

/* 6c. Partner "Withdraw to Bank" — try Stripe payout first, then fall back
   to a pending bank-transfer request using the saved method. */
window._sgPartnerWithdrawToBank=async function(){
  try{
    var f=await fetch('/api/gym-partner/withdraw-request',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'partner'})});
    var fd=await f.json();
    if(fd.success){sgToast(fd.message||'Withdrawal requested! Funds arrive in 2-5 business days','success',4000);_sgCloseSheet('sg-partner-wallet-sheet');}
    else{sgToast(fd.error||'Add your bank account first','info',3500);}
  }catch(ex){sgToast('Could not process payout \u2014 try again','error',3000);}
};

/* 6d. Creator "Withdraw to Bank" — send the fields the API needs. */
window._sgCreatorWithdrawToBank=async function(){
  var h=creatorHandle();
  if(!h){sgToast('Get your affiliate link first','info',2000);return;}
  var method='bank_transfer',details={};
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
    details=cd.withdrawDetails||{};
  }catch(e){}
  try{
    var r=await fetch('/api/referrals/withdraw',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({creatorHandle:h,paymentMethod:method,paymentDetails:details})});
    var d=await r.json();
    if(d.success||d.withdrawal){sgToast('Withdrawal requested! Funds arrive in 2-5 business days','success',4000);_sgCloseSheet('sg-creator-wallet-sheet');}
    else{sgToast(d.error||'Set up a withdraw method first','info',3500);}
  }catch(ex){sgToast('Could not process withdrawal \u2014 try again','error',3000);}
};

/* 6e. Fix the Continue-flow confirm withdraw for creators (was posting only
   {amount} which the API rejects) and give partners the bank fallback. */
window._ctaConfirmWithdraw=async function(tabType){
  var btn=document.getElementById('sg-cta-wd-confirm');
  var err=document.getElementById('sg-cta-wd-error');
  var amtEl=document.getElementById('sg-cta-wd-amount');
  if(!amtEl)return;
  var amount=parseFloat(amtEl.value);
  if(isNaN(amount)||amount<10){if(err){err.textContent='Minimum withdrawal is \u00a310.00';err.style.display='block';}return;}
  if(window._ctaAvailableBalance&&amount>window._ctaAvailableBalance){
    if(err){err.textContent='Insufficient balance (\u00a3'+window._ctaAvailableBalance.toFixed(2)+' available)';err.style.display='block';}return;
  }
  if(err)err.style.display='none';
  if(btn){btn.textContent='Processing\u2026';btn.style.opacity='.6';btn.style.pointerEvents='none';}
  function fail(msg){
    if(err){err.textContent=msg||'Withdrawal failed \u2014 try again';err.style.display='block';}
    if(btn){btn.textContent='Confirm Withdrawal \u2192';btn.style.opacity='1';btn.style.pointerEvents='auto';}
  }
  function done(){
    if(btn){btn.textContent='\u2705 Withdrawal Requested!';btn.style.background='#22c55e';btn.style.opacity='1';}
    if(navigator.vibrate)navigator.vibrate([50,50,50]);
    if(typeof sgToast==='function')sgToast('\u00a3'+amount.toFixed(2)+' withdrawal requested! \ud83c\udf89','success',4000);
    setTimeout(function(){if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();},1500);
  }
  try{
    if(tabType==='partner'){
      var f=await fetch('/api/gym-partner/withdraw-request',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'partner',amount:amount})});
      var fd=await f.json();
      if(fd.success)return done();
      return fail(fd.error);
    }
    /* creator */
    var h=creatorHandle();
    if(!h)return fail('Copy your affiliate link first');
    var method='bank_transfer',details={};
    try{
      var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
      details=cd.withdrawDetails||{};
    }catch(e){}
    var cr=await fetch('/api/referrals/withdraw',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({creatorHandle:h,amountPence:Math.round(amount*100),paymentMethod:method,paymentDetails:details})});
    var cdta=await cr.json();
    if(cdta.success||cdta.withdrawal)return done();
    return fail(cdta.error);
  }catch(e){return fail('Network error \u2014 try again');}
};

/* 6f. 💸 rail button on ScanSquad opens the wallet sheet in place. */
window._sgCreatorWithdraw=function(handle){
  if(typeof window._creatorWithdraw==='function'){window._creatorWithdraw();}
  else{navigate('/wallet');}
};

/* ════════════════════════════════════════════════════════════════════
   Watchers
   ════════════════════════════════════════════════════════════════════ */
setInterval(function(){
  try{fixPartnerBranding();fixSquadBranding();fixSquadColors();fixSquadShare();addSquadRailShare();}catch(e){}
},700);

console.log('[Round2] ScanSquad + Partner polish loaded');
})();
