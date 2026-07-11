/**
 * ScanGym Batch 2 — reviews, gym on/off, rebook
 *
 *  1) Uber-style review prompt — stars first, then quick-tap chips
 *     (5★ → compliments, <5★ → issue list), and a catch-up prompt at boot
 *     for the latest unrated visit (rate before your next booking).
 *  2) Zomato-style gym Online/Offline switch — big toggle at the top of the
 *     Partner dashboard (PATCH /api/gym-partner/toggle-active).
 *  3) One-tap rebook — "Book again at {your usual gym}" chip on the Book tab
 *     (GET /api/rebook/suggestions), straight to the gym's booking page.
 *  4) Zomato-style review replies — Partner "Reviews" sheet shows real
 *     guest reviews with one public owner reply per review
 *     (GET /api/reviews/gym/:id + POST /api/reviews/:id/respond).
 */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('sg_sheet')==='1')return; // skip inside popup sheets

function curRoute(){
  try{if(typeof state!=='undefined'&&state&&state.route)return state.route;}catch(e){}
  return location.pathname||'';
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function toast(msg,type,ms){if(window.sgToast)sgToast(msg,type||'success',ms||2500);}

/* ════════════════════════════════════════════════════════════════════
   1) UBER-STYLE REVIEW PROMPT
      a) chips after star selection (compliments for 5★, issues below)
      b) boot catch-up: latest ended, unrated visit → show the prompt
   ════════════════════════════════════════════════════════════════════ */
var COMPLIMENTS=['\uD83E\uDDFC Spotless','\uD83C\uDFCB\uFE0F Great equipment','\uD83D\uDE0A Friendly staff','\u26A1 Easy entry','\uD83D\uDCAA Good vibe'];
var ISSUES=['\uD83D\uDC65 Too crowded','\uD83D\uDD27 Equipment issues','\uD83E\uDDFD Cleanliness','\uD83D\uDEAA Entry problems','\uD83D\uDCB0 Not worth it'];
window._sgB2Tags=[];
window._sgB2ToggleTag=function(el,tag){
  var i=window._sgB2Tags.indexOf(tag);
  if(i>=0){window._sgB2Tags.splice(i,1);el.style.background='rgba(255,255,255,.06)';el.style.borderColor='rgba(255,255,255,.1)';el.style.color='rgba(255,255,255,.6)';}
  else{window._sgB2Tags.push(tag);el.style.background='rgba(255,109,0,.15)';el.style.borderColor='rgba(255,109,0,.5)';el.style.color='#FF6D00';}
};
function renderChips(){
  var box=document.getElementById('sg-b2-chips');
  if(!box)return;
  var n=window._sgSelectedRating||0;
  if(!n){box.innerHTML='';return;}
  var list=n===5?COMPLIMENTS:ISSUES;
  var title=n===5?'Give a compliment':'What went wrong?';
  window._sgB2Tags=[];
  box.innerHTML='<p style="color:rgba(255,255,255,.4);font-size:12px;font-weight:600;margin:0 0 8px">'+title+'</p>'
    +'<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:14px">'
    +list.map(function(t){return '<span onclick="_sgB2ToggleTag(this,\''+t.replace(/'/g,'')+'\')" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:7px 12px;color:rgba(255,255,255,.6);font-size:12px;font-weight:600;cursor:pointer;user-select:none">'+t+'</span>';}).join('')
    +'</div>';
}
// hook the existing star selector + submit to add chips/tags
function hookRatePrompt(){
  if(typeof window._sgSelectStar!=='function'||window._sgSelectStar.__b2)return;
  var origSel=window._sgSelectStar;
  window._sgSelectStar=function(n){
    origSel(n);
    var stars=document.getElementById('sg-rate-stars');
    if(stars&&!document.getElementById('sg-b2-chips')){
      var d=document.createElement('div');d.id='sg-b2-chips';
      stars.parentNode.insertBefore(d,stars.nextSibling);
    }
    renderChips();
  };
  window._sgSelectStar.__b2=true;
  var origSub=window._sgSubmitRating;
  if(typeof origSub==='function'){
    window._sgSubmitRating=function(gymId,bookingId){
      try{
        var c=document.getElementById('sg-rate-comment');
        if(c&&window._sgB2Tags.length){
          var tagTxt=window._sgB2Tags.join(', ');
          c.value=c.value?c.value+' \u2014 '+tagTxt:tagTxt;
        }
        if(bookingId)try{localStorage.setItem('sg_rated_'+bookingId,'1');}catch(e){}
      }catch(e){}
      return origSub(gymId,bookingId);
    };
  }
}
setInterval(hookRatePrompt,800);

// boot catch-up: latest ended visit without a rating → prompt once
function catchUpPrompt(){
  fetch('/api/bookings',{credentials:'include'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      if(!d||!d.bookings||!d.bookings.length)return;
      var now=Date.now();
      for(var i=0;i<d.bookings.length;i++){
        var b=d.bookings[i];
        if(!b.id||b.status==='cancelled')continue;
        var t=b.date?new Date(b.date).getTime():0;
        if(!t||t>now||now-t>72*3600*1000)continue;      // visit within last 3 days
        var seen=null;
        try{seen=localStorage.getItem('sg_rated_'+b.id)||localStorage.getItem('sg_rateskip_'+b.id);}catch(e){}
        if(seen)continue;
        if(document.getElementById('sg-rate-overlay'))return;
        try{localStorage.setItem('sg_rateskip_'+b.id,'1');}catch(e){} // ask once per visit
        if(typeof window._sgShowRatePrompt==='function')window._sgShowRatePrompt(b.gymName,'',b.id);
        return;
      }
    }).catch(function(){});
}
setTimeout(catchUpPrompt,6000);

/* ════════════════════════════════════════════════════════════════════
   2) ZOMATO-STYLE GYM ONLINE/OFFLINE SWITCH (Partner tab)
   ════════════════════════════════════════════════════════════════════ */
async function partnerGymId(){
  if(window._partnerGymId)return window._partnerGymId;
  try{
    var r=await fetch('/api/gym-partner/dashboard',{credentials:'include'});
    if(!r.ok)return null;
    var d=await r.json();
    if(d.gyms&&d.gyms.length){window._partnerGymId=d.gyms[0].id;window._sgB2GymActive=d.gyms[0].is_active!==false;return d.gyms[0].id;}
  }catch(e){}
  return null;
}
window._sgB2ToggleGym=async function(){
  var el=document.getElementById('sg-gym-switch');
  var gymId=await partnerGymId();
  if(!gymId){toast('Claim your gym first to use this','info',2500);return;}
  var next=window._sgB2GymActive===false; // currently off → turn on, else turn off
  try{
    var r=await fetch('/api/gym-partner/toggle-active',{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({gymId:gymId,isActive:next})});
    var d=await r.json();
    if(d&&d.success){window._sgB2GymActive=next;toast(d.message||(next?'Gym is live \u2705':'Gym paused'),next?'success':'info',2500);paintSwitch();}
    else toast((d&&d.error)||'Could not update','error',2500);
  }catch(e){toast('Could not update','error',2500);}
};
function paintSwitch(){
  var el=document.getElementById('sg-gym-switch');
  if(!el)return;
  var on=window._sgB2GymActive!==false;
  var ic=el.querySelector('.sw-icon');var lb=el.querySelector('.sw-label');
  if(ic)ic.textContent=on?'\uD83D\uDFE2':'\u26AA';
  if(lb){lb.textContent=on?'Online':'Offline';lb.style.color=on?'#22c55e':'rgba(255,255,255,.45)';}
}
// TikTok-style right rail host — the buttons live ONLY inside the Partner tab's
// existing .pe-actions owner rail (Set Price, Hours, …). No separate rail.
window._sgB2RailHost=function(){
  var stray=document.getElementById('sg-partner-rail');
  if(stray)stray.remove();
  // Native Partner Dashboard (PartnerFullPage) now renders its own Verify +
  // On/Off buttons directly in .tt-actions (fixed order: Search, Verify,
  // On/Off, Earnings, ...), so injected chips only target the pre-claim
  // .pe-actions rail to avoid duplicates.
  return document.querySelector('.pe-actions')||null;
};
function injectGymSwitch(){
  var route=curRoute();
  var host=(route.indexOf('/partner')===0)?window._sgB2RailHost():null;
  if(!host){
    var old=document.getElementById('sg-gym-switch');if(old)old.remove();
    return;
  }
  var el=document.getElementById('sg-gym-switch');
  if(el&&el.parentNode===host)return;
  if(el)el.remove();
  el=document.createElement('div');
  el.id='sg-gym-switch';
  el.style.cssText='display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;-webkit-tap-highlight-color:transparent';
  el.innerHTML='<div class="sw-icon" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:24px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));opacity:.9">\uD83D\uDFE2</div>'
    +'<div class="sw-label" style="font-size:9px;color:#22c55e;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8);text-align:center;white-space:nowrap;max-width:52px;overflow:hidden;text-overflow:ellipsis;line-height:1.1">Online</div>';
  el.onclick=function(ev){ev.stopPropagation();window._sgB2ToggleGym();};
  host.insertBefore(el,host.firstChild);
  partnerGymId().then(function(){paintSwitch();});
}
setInterval(injectGymSwitch,700);

/* ════════════════════════════════════════════════════════════════════
   3) ONE-TAP REBOOK — "Book again" chip on the Book tab
   ════════════════════════════════════════════════════════════════════ */
var _rebookLoaded=false,_rebookGym=null;
function loadRebook(){
  if(_rebookLoaded)return;_rebookLoaded=true;
  fetch('/api/rebook/suggestions',{credentials:'include'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(rows){
      if(rows&&rows.length&&rows[0].gym_id){_rebookGym={id:rows[0].gym_id,name:rows[0].name||'your gym'};injectRebook();}
    }).catch(function(){});
}
function injectRebook(){
  var route=curRoute();
  var onBook=route==='/explore'||route.indexOf('/explore')===0;
  var old=document.getElementById('sg-rebook-chip');
  if(!onBook||!_rebookGym){if(old)old.remove();return;}
  if(old)return;
  var b=document.createElement('div');
  b.id='sg-rebook-chip';
  b.style.cssText='position:fixed;top:calc(env(safe-area-inset-top,0px) + 56px);left:12px;right:12px;z-index:8998;pointer-events:none';
  b.innerHTML='<div onclick="navigate(\'/gym/'+_rebookGym.id+'\')" style="pointer-events:auto;display:inline-flex;align-items:center;gap:8px;background:rgba(10,12,20,.92);border:1px solid rgba(255,109,0,.4);border-radius:24px;padding:9px 16px;cursor:pointer;backdrop-filter:blur(10px);box-shadow:0 4px 16px rgba(0,0,0,.4)">'
    +'<span style="font-size:14px">\uD83D\uDD01</span>'
    +'<span style="color:#fff;font-size:13px;font-weight:700">Book again at '+esc(_rebookGym.name)+'</span>'
    +'<span style="color:#FF6D00;font-weight:800">\u2192</span></div>';
  document.body.appendChild(b);
}
setInterval(function(){loadRebook();injectRebook();},900);

/* ════════════════════════════════════════════════════════════════════
   4) ZOMATO-STYLE REVIEW REPLIES — real Partner reviews sheet
   ════════════════════════════════════════════════════════════════════ */
window._sgB2Reply=async function(reviewId){
  var inp=document.getElementById('sg-rr-input-'+reviewId);
  if(!inp||!inp.value.trim())return;
  var txt=inp.value.trim();
  try{
    var r=await fetch('/api/reviews/'+reviewId+'/respond',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({response:txt})});
    var d=await r.json();
    if(r.ok){toast('Reply posted \u2705','success',2000);window._partnerViewReviews();}
    else toast((d&&d.error)||'Could not post reply','error',2500);
  }catch(e){toast('Could not post reply','error',2500);}
};
window._sgB2SuggestReply=function(reviewId,rating){
  var inp=document.getElementById('sg-rr-input-'+reviewId);
  if(!inp)return;
  inp.value=rating>=4
    ?'Thank you so much for the kind words! We\u2019d love to see you again soon. \uD83D\uDCAA'
    :'Thanks for the honest feedback \u2014 we\u2019re sorry we fell short. We\u2019re working on this and hope you\u2019ll give us another try.';
  inp.focus();
};
function reviewRow(rv){
  var stars='';
  for(var i=1;i<=5;i++)stars+=i<=rv.rating?'\u2B50':'\u2606';
  var when=rv.created_at?new Date(rv.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'';
  var h='<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:12px 14px;margin-bottom:10px;text-align:left">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
    +'<span style="font-size:12px">'+stars+'</span>'
    +'<span style="color:rgba(255,255,255,.3);font-size:10px">'+(rv.verified_visit?'\u2705 Verified visit \u00b7 ':'')+when+'</span></div>'
    +(rv.comment?'<p style="color:rgba(255,255,255,.75);font-size:13px;margin:0 0 8px;line-height:1.4">'+esc(rv.comment)+'</p>':'');
  if(rv.owner_response){
    h+='<div style="border-left:2px solid #FF6D00;padding:6px 10px;background:rgba(255,109,0,.06);border-radius:0 10px 10px 0">'
      +'<p style="color:#FF6D00;font-size:10px;font-weight:700;margin:0 0 2px">YOUR REPLY</p>'
      +'<p style="color:rgba(255,255,255,.6);font-size:12px;margin:0;line-height:1.4">'+esc(rv.owner_response)+'</p></div>';
  }else{
    h+='<div style="display:flex;gap:6px;align-items:center">'
      +'<input id="sg-rr-input-'+rv.id+'" placeholder="Reply publicly\u2026" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:9px 12px;color:#fff;font-size:12px;outline:none;min-width:0">'
      +'<span onclick="_sgB2SuggestReply('+rv.id+','+rv.rating+')" title="Suggest a reply" style="cursor:pointer;font-size:15px">\u2728</span>'
      +'<button onclick="_sgB2Reply('+rv.id+')" style="background:#FF6D00;color:#fff;border:none;border-radius:10px;padding:9px 12px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">Reply</button></div>';
  }
  return h+'</div>';
}
function installReviewsSheet(){
  if(window._partnerViewReviews&&window._partnerViewReviews.__b2)return;
  if(typeof window._sgOpenSheet!=='function')return;
  window._partnerViewReviews=async function(){
    var gymId=await partnerGymId();
    var head='<p style="font-size:18px;font-weight:800;color:#fff;margin:0 0 12px;text-align:left">\u2b50 Guest reviews</p>';
    if(!gymId){
      window._sgOpenSheet('partner-reviews',head+'<p style="color:rgba(255,255,255,.5);font-size:13px;text-align:left">Claim your gym first \u2014 reviews from your guests will appear here.</p>');
      return;
    }
    window._sgOpenSheet('partner-reviews',head+'<p style="color:rgba(255,255,255,.4);font-size:13px">Loading\u2026</p>');
    try{
      var r=await fetch('/api/reviews/gym/'+gymId+'?limit=20',{credentials:'include'});
      var d=await r.json();
      var body;
      if(!d.reviews||!d.reviews.length){
        body='<div style="text-align:center;padding:12px 0"><div style="font-size:42px;margin-bottom:10px">\uD83C\uDF1F</div><p style="color:rgba(255,255,255,.5);font-size:13px">No reviews yet \u2014 they\u2019ll appear here after your first guest visits.</p></div>';
      }else{
        var s=d.stats||{};
        body='<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;text-align:left">'
          +'<span style="font-size:26px;font-weight:900;color:#fff">'+(s.averageRating||0)+'</span>'
          +'<span style="color:rgba(255,255,255,.4);font-size:12px">'+(s.totalReviews||d.reviews.length)+' review'+((s.totalReviews||0)===1?'':'s')+' \u00b7 reply publicly like the pros do</span></div>'
          +d.reviews.map(reviewRow).join('');
      }
      window._sgOpenSheet('partner-reviews',head+body);
    }catch(e){
      window._sgOpenSheet('partner-reviews',head+'<p style="color:rgba(255,255,255,.5);font-size:13px">Could not load reviews \u2014 try again.</p>');
    }
  };
  window._partnerViewReviews.__b2=true;
}
setInterval(installReviewsSheet,900);

console.log('[Batch2] review chips + catch-up, gym on/off switch, rebook chip, review replies');
})();
