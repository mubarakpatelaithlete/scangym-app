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
    b.innerHTML='<div style="width:28px;height:28px;background:#FF6D00;border-radius:50%;opacity:.85;box-shadow:0 0 10px rgba(255,109,0,.5);display:flex;align-items:center;justify-content:center;font:900 15px/1 system-ui,-apple-system,sans-serif;color:#fff;">S</div>';
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

/* ONE BAR: the ScanSquad/creator tab used to re-inject its own #creator-continue-banner
   here every 400ms, and a second timer restyled it (and #partner-continue-banner) to look
   like the core bar. Both elements are gone: there is one shared bottom bar
   (window.sgBottomBar, owned by app.js) which is already the slim full-width style.
   The ScanSquad Ask AI bar itself is kept — it now renders into that shared bar. */
setInterval(function(){
  if(typeof window._injectContinueBanner!=='function'||!window.sgBottomBar)return;
  if(onCreator())window._injectContinueBanner('creator');
  else if(window.sgBottomBar.owner()==='creator')window.sgBottomBar.hide('creator');
},400);

/* ════════════════════════════════════════════════════════════════════
   6) WITHDRAW FLOW FIXES
   ════════════════════════════════════════════════════════════════════ */

/* Hydrate the saved payout method from the server on login (new-device
   support). The withdraw UI itself lives only in wallet-withdraw.js. */
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


/* ════════════════════════════════════════════════════════════════════
   Watchers
   ════════════════════════════════════════════════════════════════════ */
setInterval(function(){
  try{fixPartnerBranding();fixSquadBranding();fixSquadColors();fixSquadShare();}catch(e){}
},700);

console.log('[Round2] ScanSquad + Partner polish loaded');
})();
