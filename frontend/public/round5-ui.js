/* ═══════════════════════════════════════════════════════════════════════════
   ROUND 5 — Button cleanup (approved by Ankoor). Isolated & resilient:
   adjusts the live DOM every 600ms so it survives other teams' template edits.
   #1 Label the 4 ScanSquad rail icons (were icon-only)
   #2 Merge the two affiliate-link buttons (hide 'Deep Link', keep 'Share Link')
   #3 Merge gym-card 'Share' + 'Earn' (hide 'Earn', keep universal 'Share')
   #4 Remove the duplicate per-card '⚡ Book' button (keep sticky 'Book this gym')
   #5 Clarify vague labels: Pay→Payment, Trainer→AI Coach, Chat→Messages
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

var css=document.createElement('style');
css.id='sg-r5-css';
css.textContent=
  /* #1 visible labels for the ScanSquad creator rail icons */
  '.creator-side-btn{position:relative;overflow:visible}'+
  '.creator-side-btn[data-r5lbl]::after{content:attr(data-r5lbl);position:absolute;top:calc(100% + 1px);left:50%;transform:translateX(-50%);font-size:9px;font-weight:700;color:#fff;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.95);letter-spacing:.2px;pointer-events:none}'+
  /* #4 hide the duplicate per-card quick-book button */
  '.sg-quick-book{display:none!important}';
document.head.appendChild(css);

function labelCreatorRail(){
  var btns=document.querySelectorAll('.creator-side-btn');
  if(btns.length && btns[0].parentNode && btns[0].parentNode.getAttribute('data-r5gap')!=='1'){
    btns[0].parentNode.style.gap='24px';
    btns[0].parentNode.style.right='10px';
    btns[0].parentNode.setAttribute('data-r5gap','1');
  }
  for(var i=0;i<btns.length;i++){
    var b=btns[i];
    var oc=b.getAttribute('onclick')||'';
    // #2 merge: hide the gym-specific "Deep Affiliate Link"
    if(oc.indexOf('_sgCreatorDeepLink')>-1){ b.style.display='none'; continue; }
    var lbl=null;
    if(oc.indexOf('Already signed')>-1) lbl='Account';
    else if(oc.indexOf('_sgShowAuthSheet')>-1||oc.indexOf("navigate('/login')")>-1||oc.indexOf('/login')>-1) lbl='Sign in';
    else if(oc.indexOf('_creatorGetLink')>-1){ b.style.display='none'; continue; } // R2: consolidate share (link is on the card via Copy+Share)
    else if(oc.indexOf('_creatorWithdraw')>-1) lbl='Withdraw';
    else if(oc.indexOf('_toggleCreatorMore')>-1) lbl='More';
    if(lbl && b.getAttribute('data-r5lbl')!==lbl) b.setAttribute('data-r5lbl',lbl);
  }
}

function hideRailFilter(){
  // R2 #2: remove the gym-card rail 'Filter' button (duplicates the filter chips)
  var acts=document.querySelectorAll('.tt-action');
  for(var i=0;i<acts.length;i++){
    var oc=acts[i].getAttribute('onclick')||'';
    if(oc.indexOf('_sgToggleBookFilters')>-1) acts[i].style.display='none';
  }
}
function mergeShareEarn(){
  // #3 hide the affiliate "Earn" on the gym card; keep the universal "Share"
  var acts=document.querySelectorAll('.tt-action');
  for(var i=0;i<acts.length;i++){
    var a=acts[i];
    var oc=a.getAttribute('onclick')||'';
    if(oc.indexOf('_sgShareAffiliateLink')>-1){ a.style.display='none'; }
  }
}

var RELABEL={'Pay':'Payment','Trainer':'AI Coach','Chat':'Messages'};
function clarifyLabels(){
  // #5 rename vague rail labels (gym-card rail + reels rail)
  var labels=document.querySelectorAll('.tt-action-label, .sg-rr-label');
  for(var i=0;i<labels.length;i++){
    var t=(labels[i].textContent||'').trim();
    if(RELABEL[t]) labels[i].textContent=RELABEL[t];
  }
}

function tick(){
  try{labelCreatorRail();}catch(e){}
  try{mergeShareEarn();}catch(e){}
  try{hideRailFilter();}catch(e){}
  try{clarifyLabels();}catch(e){}
}
function init(){tick();setInterval(tick,600);}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{init();}
})();
