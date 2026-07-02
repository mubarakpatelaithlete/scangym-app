/**
 * ScanGym Batch 3 — ownership proof, identity check, withdrawals
 *
 *  1) Zomato-style ownership proof — after claiming a gym, verify by OTP
 *     texted to the gym's registered business number; fallback = document
 *     proof to support. Verified badge on the Partner tab.
 *  2) Uber-style identity check — phone OTP login is level 1 (silent);
 *     step-up "Get ID verified" via Stripe Identity (photo ID + selfie)
 *     from the Profile tab. Shows a ✅ ID verified badge.
 *  3) Withdrawals — fixes the creator withdraw call (was sending the wrong
 *     field name, so it always failed) and adds amount feedback.
 */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('sg_sheet')==='1')return;

function curRoute(){
  try{if(typeof state!=='undefined'&&state&&state.route)return state.route;}catch(e){}
  return location.pathname||'';
}
function toast(m,t,d){if(window.sgToast)sgToast(m,t||'success',d||2500);}
function post(u,b){return fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(b||{})}).then(function(r){return r.json().then(function(d){d.__ok=r.ok;return d;});});}

async function myGymId(){
  if(window._partnerGymId)return window._partnerGymId;
  try{
    var r=await fetch('/api/gym-partner/dashboard',{credentials:'include'});
    if(!r.ok)return null;
    var d=await r.json();
    if(d.gyms&&d.gyms.length){window._partnerGymId=d.gyms[0].id;return d.gyms[0].id;}
  }catch(e){}
  return null;
}

/* ════════════════════════════════════════════════════════════════════
   1) OWNERSHIP PROOF (Zomato-style OTP to registered business number)
   ════════════════════════════════════════════════════════════════════ */
window._sgB3VerifyOwnership=async function(){
  var gymId=await myGymId();
  if(!gymId){toast('Claim your gym first','info',2500);return;}
  var head='<p style="font-size:18px;font-weight:800;color:#fff;margin:0 0 6px;text-align:left">\uD83D\uDEE1\uFE0F Verify ownership</p>';
  window._sgOpenSheet('sg-own-sheet',head
    +'<p style="color:rgba(255,255,255,.55);font-size:13px;text-align:left;line-height:1.5;margin:0 0 16px">We\u2019ll text a 6-digit code to your gym\u2019s <b style="color:#fff">registered business number</b>. Only someone at the gym can read it \u2014 that proves you\u2019re the owner.</p>'
    +'<button onclick="_sgB3SendOwnOtp('+gymId+')" id="sg-own-send" style="width:100%;background:#FF6D00;color:#fff;border:none;padding:14px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer">Text code to registered number</button>'
    +'<div id="sg-own-step2" style="display:none;margin-top:14px">'
    +'<input id="sg-own-code" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit code" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:13px;color:#fff;font-size:16px;letter-spacing:4px;text-align:center;outline:none;margin-bottom:10px">'
    +'<button onclick="_sgB3CheckOwnOtp('+gymId+')" style="width:100%;background:#22c55e;color:#fff;border:none;padding:13px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer">Confirm code</button></div>'
    +'<div id="sg-own-fallback" style="margin-top:14px;text-align:left"><p style="color:rgba(255,255,255,.35);font-size:12px;line-height:1.5;margin:0">Can\u2019t access that number? Email proof of ownership (utility bill, lease or business registration) to <a href="mailto:support@scangym.com" style="color:#FF6D00">support@scangym.com</a> and we\u2019ll verify manually.</p></div>');
};
window._sgB3SendOwnOtp=async function(gymId){
  var btn=document.getElementById('sg-own-send');
  if(btn){btn.textContent='Sending\u2026';btn.style.opacity='.6';}
  try{
    var d=await post('/api/gym-partner/claim/send-otp',{gymId:gymId});
    if(d.alreadyVerified){toast('Already verified \u2705','success',2500);return;}
    if(d.success){
      if(btn){btn.textContent='Code sent to '+(d.maskedPhone||'registered number')+' \u2713';btn.style.opacity='.8';btn.style.background='rgba(255,255,255,.1)';}
      var s2=document.getElementById('sg-own-step2');if(s2)s2.style.display='block';
      var c=document.getElementById('sg-own-code');if(c)c.focus();
    }else{
      if(btn){btn.textContent='Text code to registered number';btn.style.opacity='1';}
      toast(d.message||d.error||'Could not send code \u2014 use the email fallback below','info',4000);
    }
  }catch(e){if(btn){btn.textContent='Text code to registered number';btn.style.opacity='1';}toast('Could not send code','error',2500);}
};
window._sgB3CheckOwnOtp=async function(gymId){
  var c=document.getElementById('sg-own-code');
  if(!c||c.value.trim().length<4){toast('Enter the 6-digit code','info',2000);return;}
  try{
    var d=await post('/api/gym-partner/claim/verify-otp',{gymId:gymId,code:c.value.trim()});
    if(d.success){
      try{localStorage.setItem('sg_own_verified_'+gymId,'1');}catch(e){}
      toast(d.message||'Ownership verified \u2705','success',3000);
      if(typeof window._sgCloseSheet==='function')window._sgCloseSheet('sg-own-sheet');
      paintOwnBadge(true);
    }else toast(d.error||'Invalid code','error',2500);
  }catch(e){toast('Verification failed','error',2500);}
};
// Badge / entry chip on Partner tab
var _ownState=null; // null unknown, true verified, false not
async function checkOwnState(){
  if(_ownState!==null)return;
  var gymId=await myGymId();
  if(!gymId){_ownState=false;return;}
  try{if(localStorage.getItem('sg_own_verified_'+gymId)){_ownState=true;return;}}catch(e){}
  try{
    var r=await fetch('/api/gym-partner/claim/verification-status?gymId='+gymId,{credentials:'include'});
    if(r.ok){var d=await r.json();_ownState=d.verified===true;return;}
  }catch(e){}
  _ownState=false;
}
function paintOwnBadge(verified){
  var el=document.getElementById('sg-own-chip');
  if(!el)return;
  if(verified){el.innerHTML='<span style="color:#22c55e;font-weight:700">\u2705 Verified owner</span>';el.onclick=null;el.style.cursor='default';el.style.borderColor='rgba(34,197,94,.35)';}
}
function injectOwnChip(){
  var route=curRoute();
  var old=document.getElementById('sg-own-chip');
  if(route.indexOf('/partner')!==0){if(old)old.remove();return;}
  if(old){if(_ownState===true)paintOwnBadge(true);return;}
  var host=document.getElementById('sg-gym-switch'); // sits right under the on/off switch from batch 2
  var b=document.createElement('div');
  b.id='sg-own-chip';
  b.style.cssText='position:fixed;top:calc(env(safe-area-inset-top,0px) + '+(host?'112px':'52px')+');left:12px;z-index:8997;background:rgba(10,12,20,.92);border:1px solid rgba(255,109,0,.35);border-radius:20px;padding:8px 14px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;backdrop-filter:blur(10px)';
  b.innerHTML='\uD83D\uDEE1\uFE0F Verify ownership \u2192';
  b.onclick=function(){window._sgB3VerifyOwnership();};
  document.body.appendChild(b);
  checkOwnState().then(function(){if(_ownState===true)paintOwnBadge(true);});
}
setInterval(injectOwnChip,800);

/* ════════════════════════════════════════════════════════════════════
   2) IDENTITY CHECK (Uber-style step-up via Stripe Identity)
   ════════════════════════════════════════════════════════════════════ */
window._sgB3StartIdentity=async function(){
  try{
    var d=await post('/api/identity/start',{});
    if(d.alreadyVerified){toast('You\u2019re already ID verified \u2705','success',2500);return;}
    if(d.url){location.href=d.url;return;}
    toast(d.error||'Could not start ID check','error',3000);
  }catch(e){toast('Could not start ID check','error',3000);}
};
var _idVerified=null;
async function checkIdentity(){
  if(_idVerified!==null)return;
  try{
    var r=await fetch('/api/identity/status',{credentials:'include'});
    if(!r.ok){_idVerified=false;return;}
    var d=await r.json();
    _idVerified=d.verified===true;
    if(_idVerified&&new URLSearchParams(location.search).get('identity')==='done')toast('\u2705 ID verified \u2014 badge added to your profile','success',3500);
  }catch(e){_idVerified=false;}
}
function injectIdRow(){
  var route=curRoute();
  var old=document.getElementById('sg-id-row');
  if(route.indexOf('/profile')!==0&&route.indexOf('/more/profile')!==0){if(old)old.remove();return;}
  if(old)return;
  var b=document.createElement('div');
  b.id='sg-id-row';
  b.style.cssText='position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 76px);left:12px;right:12px;z-index:8996';
  var verified=_idVerified===true;
  b.innerHTML='<div onclick="'+(verified?'':'_sgB3StartIdentity()')+'" style="display:flex;align-items:center;gap:10px;background:rgba(10,12,20,.94);border:1px solid '+(verified?'rgba(34,197,94,.4)':'rgba(255,255,255,.12)')+';border-radius:14px;padding:12px 14px;cursor:'+(verified?'default':'pointer')+';backdrop-filter:blur(10px)">'
    +'<span style="font-size:18px">'+(verified?'\u2705':'\uD83E\uDEAA')+'</span>'
    +'<div style="flex:1;min-width:0"><p style="color:#fff;font-size:13px;font-weight:800;margin:0">'+(verified?'ID verified':'Get ID verified')+'</p>'
    +'<p style="color:rgba(255,255,255,.4);font-size:11px;margin:1px 0 0">'+(verified?'Photo ID + selfie confirmed':'Photo ID + selfie \u00b7 takes ~2 min \u00b7 unlocks trusted badge')+'</p></div>'
    +(verified?'':'<span style="color:#FF6D00;font-weight:800">\u2192</span>')+'</div>';
  document.body.appendChild(b);
}
setInterval(function(){checkIdentity().then(injectIdRow);},900);

/* ════════════════════════════════════════════════════════════════════
   3) WITHDRAWALS — fix creator withdraw field name + better feedback
   ════════════════════════════════════════════════════════════════════ */
function fixWithdraw(){
  if(typeof window._sgCreatorWithdrawToBank!=='function'||window._sgCreatorWithdrawToBank.__b3)return;
  window._sgCreatorWithdrawToBank=async function(){
    var u=(typeof state!=='undefined'&&state)?state.user:null;
    var refCode=u&&u.referral_code;
    if(!refCode){try{var c=JSON.parse(localStorage.getItem('sg_creator')||'null');if(c&&c.handle)refCode=c.handle;}catch(e){}}
    if(!refCode){toast('Get your affiliate link first','info',2000);return;}
    try{
      var d=await post('/api/referrals/withdraw',{creatorHandle:refCode});
      if(d.success){
        toast('Withdrawal of '+((d.withdrawal&&d.withdrawal.amountDisplay)||'your balance')+' requested \u2014 funds arrive in 2\u20135 business days \uD83D\uDCB8','success',4000);
        if(typeof window._sgCloseSheet==='function')window._sgCloseSheet('sg-creator-wallet-sheet');
      }else toast(d.error||'Set up a withdraw method first','info',3500);
    }catch(e){toast('Could not process withdrawal','error',2500);}
  };
  window._sgCreatorWithdrawToBank.__b3=true;
}
setInterval(fixWithdraw,900);

console.log('[Batch3] ownership OTP, ID verification, withdraw fix');
})();
