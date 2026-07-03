/* ════════════════════════════════════════════════════════════════════
   ROUND 3 PATCHES — loaded AFTER round2.js so overrides here win.
   1) Move Music / Photos / Chat / Trainer out of the bottom tab bar
      into a right-side rail on the Reels tab (TikTok style).
      NOTE: purely additive overlay — does not touch the Reels renderer
      or its loading path, so Reels speed is unchanged.
   ════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* 1a. Hide the four tabs in the bottom bar via CSS (survives re-renders). */
(function(){
  var s=document.createElement('style');
  s.textContent='.sg-tab-item[aria-label="Music"],.sg-tab-item[aria-label="Photos"],.sg-tab-item[aria-label="Chat"],.sg-tab-item[aria-label="AI Trainer"]{display:none!important}'
    +'#sg-reels-rail{position:fixed;right:10px;top:96px;z-index:8998;display:none;flex-direction:column;gap:14px;pointer-events:none}'
    +'#sg-reels-rail.visible{display:flex}'
    +'.sg-rr-btn{pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}'
    +'.sg-rr-btn:active .sg-rr-circle{transform:scale(.9)}'
    +'.sg-rr-circle{width:44px;height:44px;border-radius:50%;background:rgba(20,20,35,.72);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;font-size:20px;transition:transform .15s;box-shadow:0 2px 10px rgba(0,0,0,.35)}'
    +'.sg-rr-label{font-size:9px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8);letter-spacing:.2px}';
  document.head.appendChild(s);
})();

/* 1b. Build the rail once. */
function ensureRail(){
  var rail=document.getElementById('sg-reels-rail');
  if(rail)return rail;
  rail=document.createElement('div');
  rail.id='sg-reels-rail';
  var items=[
    {tab:'music',route:'/music',icon:'\uD83C\uDFB5',label:'Music'},
    {tab:'photos',route:'/photos',icon:'\uD83D\uDCF8',label:'Photos'},
    {tab:'chat',route:'/chat',icon:'\uD83D\uDCAC',label:'Chat'},
    {tab:'trainer',route:'/ai-trainer',icon:'\uD83E\uDD16',label:'Trainer'}
  ];
  items.forEach(function(it){
    var b=document.createElement('div');
    b.className='sg-rr-btn';
    b.innerHTML='<div class="sg-rr-circle">'+it.icon+'</div><span class="sg-rr-label">'+it.label+'</span>';
    b.onclick=function(){
      /* Trello #Reels: right-side buttons open a half-screen popup from the
         bottom (with \u2715 close + swipe-down) instead of switching tabs. */
      if(typeof window._sgOpenPageSheet==='function'){window._sgOpenPageSheet(it.route,it.label);}
      else if(typeof switchTab==='function'){switchTab(it.tab);}
    };
    rail.appendChild(b);
  });
  document.body.appendChild(rail);
  return rail;
}

/* 1c. Show the rail only while the Reels tab is active (and no sheet/page
   covering it). Light 400ms class toggle — no reels code touched. */
function isReelsActive(){
  var el=document.querySelector('.sg-tab-item.active[aria-label="Reels"]');
  if(!el)return false;
  var bar=document.querySelector('.sg-tab-bar');
  if(bar&&bar.classList.contains('hidden'))return false;
  return true;
}
setInterval(function(){
  var rail=ensureRail();
  var show=isReelsActive();
  if(show!==rail.classList.contains('visible'))rail.classList.toggle('visible',show);
},400);

})();
