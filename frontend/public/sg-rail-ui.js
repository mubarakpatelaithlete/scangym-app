/* ═══════════════════════════════════════════════════════════════════════════
   sg-rail-ui.js — the right-rail / gym-card UI enhancers, in ONE file with ONE tick.

   Merged 2026-09-14 from four patch files that each ran their own setInterval:
     round3.js     (400ms)  Reels right rail: Music / Photos / Chat / Trainer
     ui-polish.js  (600ms)  Line icons on the rails, "More" collapse, card declutter
     round4-ui.js  (600ms)  Logo square removal, booking summary bar, Book-tap spinner
     round5-ui.js  (600ms)  Rail labels, duplicate-button merges, clearer labels
   Behaviour is unchanged; the code of each module is byte-for-byte the original
   body. Only the wrappers changed: each module now returns its tick() and the
   shared scheduler below runs the four ticks together every 600ms instead of
   four independent timers (~9 ticks/s → ~1.7 ticks/s).
   Module order == the original load order, so CSS overrides still cascade the
   same way (round4 overrides ui-polish's "More" colour, etc.).

   Next step (PATCH-CHAIN-REMOVAL-PLAN.md phase 4): fold each enhancer into the
   template that draws the element, then delete this file.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';


/* ─────────────── round3.js ─────────────── */
/* ════════════════════════════════════════════════════════════════════
   ROUND 3 PATCHES — loaded AFTER round2.js so overrides here win.
   1) Move Music / Photos / Chat / Trainer out of the bottom tab bar
      into a right-side rail on the Reels tab (TikTok style).
      NOTE: purely additive overlay — does not touch the Reels renderer
      or its loading path, so Reels speed is unchanged.
   ════════════════════════════════════════════════════════════════════ */
var reelsRail=(function(){

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
function tick(){
  var rail=ensureRail();
  var show=isReelsActive();
  if(show!==rail.classList.contains('visible'))rail.classList.toggle('visible',show);
}
return tick;
})();

/* ─────────────── ui-polish.js ─────────────── */
/* ═══ ScanGym UI Polish (Round 3) ═══
 * Design pass on the right-side action rails:
 *   1. Consistent icon system — replaces mixed emoji (📍🔍📅🎟💳🕐⭐🔗💰⚡🎵📸💬🤖)
 *      with a single monochrome line-icon set in frosted circles (TikTok-style),
 *      matching the Share/Save buttons on Reels.
 *   2. Declutter — the Book rail had 9-10 stacked buttons. Keep the 4 primary
 *      actions (Near Me, Search, Date, Pass) + a "More" toggle that expands the
 *      rest (Pay, Hours, Reviews, Share, Earn, Filter) in place.
 * Implementation: post-render DOM enhancer (cards are rebuilt by two separate
 * template paths in the app bundle — patching the DOM covers both and survives
 * re-renders). Idempotent via data-sgi markers; runs on a light interval like
 * the app's other enhancers.
 */
var railIcons=(function(){

/* Feather-style 24px line icons (stroke=currentColor). */
var I=function(paths){return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';};
var ICONS={
  pin:I('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  search:I('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  calendar:I('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  ticket:I('<path d="M2 9a3 3 0 0 1 0 6v3a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-3a3 3 0 0 1 0-6V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z"/><line x1="13" y1="5" x2="13" y2="7"/><line x1="13" y1="11" x2="13" y2="13"/><line x1="13" y1="17" x2="13" y2="19"/>'),
  card:I('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),
  clock:I('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  star:I('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
  share:I('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>'),
  earn:I('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  filter:I('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
  more:I('<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>'),
  close:I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  music:I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  camera:I('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  chat:I('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  trainer:I('<rect x="4" y="7" width="16" height="13" rx="2"/><line x1="12" y1="3" x2="12" y2="7"/><circle cx="12" cy="2.5" r="1"/><circle cx="9" cy="12.5" r="1"/><circle cx="15" cy="12.5" r="1"/><path d="M9 16.5h6"/>')
};
/* Book-rail label → icon (date labels like "11 Jul" fall back to calendar). */
function iconForLabel(t){
  t=(t||'').trim().toLowerCase();
  if(t==='near me')return 'pin';
  if(t==='search')return 'search';
  if(t==='share')return 'share';
  if(t==='earn')return 'earn';
  if(t==='filter')return 'filter';
  if(t==='pay'||/^\u2022/.test(t))return 'card';
  if(t==='open'||t==='closed'||/24\/7|am|pm/.test(t))return 'clock';
  if(/^day$|^3-day$|^weekly$|^monthly$/.test(t))return 'ticket';
  if(/^\d+(\.\d+)?(\s*\(\d+\))?$/.test(t)||t.indexOf('review')>-1)return 'star';
  if(/\d/.test(t)||t==='today')return 'calendar';
  return null;
}
var KEEP=4; // primary actions always visible on the Book rail

function injectCSS(){
  if(document.getElementById('sg-uip-css'))return;
  var s=document.createElement('style');s.id='sg-uip-css';
  s.textContent=
    '.tt-action-btn.sgi{width:42px;height:42px;border-radius:50%;background:rgba(13,16,25,.62);border:1px solid rgba(255,255,255,.09);color:#fff;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:1;filter:none;box-shadow:0 2px 8px rgba(0,0,0,.35)}'+
    '.tt-action-btn.sgi svg{opacity:.92}'+
    '.tt-actions .tt-action.sgi-x{display:none}'+
    '.tt-actions.sgi-open .tt-action.sgi-x{display:flex}'+
    '.tt-actions.sgi-open{max-height:calc(100vh - 300px);overflow-y:auto;overflow-x:visible;scrollbar-width:none;-ms-overflow-style:none;padding-bottom:8px}'+
    '.tt-actions.sgi-open::-webkit-scrollbar{display:none}'+
    /* Round 4 — card declutter: tighter chips, hide redundant trust row */
    '.tt-chips{gap:5px!important;margin-bottom:6px!important}'+
    '.tt-chip{padding:4px 9px!important;font-size:11px!important;border-radius:8px!important}'+
    '.sgi-trust-x{display:none!important}'+
    '.tt-action.sgi-more .tt-action-btn{background:rgba(255,109,0,.2);border-color:rgba(255,109,0,.35)}'+
    '.tt-actions{gap:8px}'+
    '#sg-reels-rail .sg-rr-circle.sgi{color:#fff;font-size:0}#sg-reels-rail .sg-rr-circle.sgi svg{opacity:.92}';
  document.head.appendChild(s);
}

function enhanceBookRails(){
  var rails=document.querySelectorAll('.tt-actions:not([data-sgi])');
  for(var r=0;r<rails.length;r++){
    var rail=rails[r];
    rail.setAttribute('data-sgi','1');
    var actions=rail.querySelectorAll('.tt-action');
    for(var i=0;i<actions.length;i++){
      var a=actions[i];
      var btn=a.querySelector('.tt-action-btn');
      var lbl=a.querySelector('.tt-action-label');
      var key=iconForLabel(lbl?lbl.textContent:'');
      if(btn&&key&&ICONS[key]){btn.innerHTML=ICONS[key];btn.classList.add('sgi');}
      if(i>=KEEP)a.classList.add('sgi-x');
    }
    if(actions.length>KEEP+1){
      var more=document.createElement('div');
      more.className='tt-action sgi-more';
      more.innerHTML='<div class="tt-action-btn sgi">'+ICONS.more+'</div><div class="tt-action-label">More</div>';
      more.addEventListener('click',function(e){
        e.stopPropagation();
        var host=this.parentNode;
        var open=host.classList.toggle('sgi-open');
        this.querySelector('.tt-action-btn').innerHTML=open?ICONS.close:ICONS.more;
        this.querySelector('.tt-action-label').textContent=open?'Less':'More';
      });
      /* Insert right after the primary group so it reads Find → When → What → More */
      var anchor=actions[KEEP]||null;
      rail.insertBefore(more,anchor);
    }
  }
}

function enhanceReelsRail(){
  var map={Music:'music',Photos:'camera',Chat:'chat',Trainer:'trainer'};
  var btns=document.querySelectorAll('#sg-reels-rail .sg-rr-btn');
  for(var i=0;i<btns.length;i++){
    var c=btns[i].querySelector('.sg-rr-circle');
    var l=btns[i].querySelector('.sg-rr-label');
    if(!c||c.classList.contains('sgi'))continue;
    var key=map[(l?l.textContent:'').trim()];
    if(key&&ICONS[key]){c.innerHTML=ICONS[key];c.classList.add('sgi');}
  }
}

/* Round 4 — hide the per-card "Free Cancel · Secure · Instant QR" mini-row:
   it duplicates the global top ticker and adds noise under the chips. */
function declutterCards(){
  var infos=document.querySelectorAll('.tt-info');
  for(var i=0;i<infos.length;i++){
    if(infos[i].getAttribute('data-sgi-c'))continue;
    infos[i].setAttribute('data-sgi-c','1');
    var divs=infos[i].querySelectorAll(':scope > div');
    for(var j=0;j<divs.length;j++){
      var t=divs[j].textContent||'';
      if(t.indexOf('Free Cancel')>-1&&t.indexOf('Instant QR')>-1){divs[j].classList.add('sgi-trust-x');}
    }
  }
}

function tick(){enhanceBookRails();enhanceReelsRail();declutterCards();}
injectCSS();
return tick;
})();

/* ─────────────── round4-ui.js ─────────────── */
/* ═══════════════════════════════════════════════════════════════════════════
   ROUND 4 — UI polish (approved by Ankoor, science-backed)
   #1 Remove the unlabeled orange logo square on gym cards (.tt-logo)
   #3 Make the rail "More" button neutral grey like its neighbours
      (Von Restorff: orange should mean only ONE thing — Book)
   #4 Add a slim "Today · Day Pass · £X" booking summary directly above the
      Book button on the Book tab (Uber/Booking confirmation pattern)
   Purely additive: one new file + CSS overrides. Easily reverted.
   ═══════════════════════════════════════════════════════════════════════════ */
var bookSummary=(function(){

var css=document.createElement('style');
css.id='sg-r4-css';
css.textContent=
  /* #1 */ '.tt-logo{display:none!important}'+
  /* #3 */ '.tt-action.sgi-more .tt-action-btn{background:rgba(13,16,25,.62)!important;border-color:rgba(255,255,255,.09)!important}'+
  /* #4 */ '#sg-book-summary{position:fixed;left:0;right:0;bottom:calc(56px + 52px + env(safe-area-inset-bottom,0px));z-index:8998;display:none;align-items:center;justify-content:center;height:26px;background:rgba(10,10,18,.96);border-top:1px solid rgba(255,255,255,.06);color:rgba(255,255,255,.78);font-size:12px;font-weight:600;letter-spacing:.2px;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);pointer-events:none}'+
  'body.sg-r4-summary #sg-book-summary{display:flex}'+
  'body.sg-r4-summary.sg-cb-active .sg-tab-content{bottom:calc(56px + 52px + 26px + env(safe-area-inset-bottom,0px))!important}'+
  /* #1 Book-tap loading feedback */
  '#sg-r4-book-spin{position:absolute;inset:0;display:none;align-items:center;justify-content:center;gap:10px;color:#fff;font-size:16px;font-weight:700;z-index:3}'+
  '#sg-continue-banner.sg-r4-loading .sg-cb-text,#sg-continue-banner.sg-r4-loading .sg-cb-price,#sg-continue-banner.sg-r4-loading .sg-cb-arrow{opacity:0}'+
  '#sg-continue-banner.sg-r4-loading #sg-r4-book-spin{display:flex}'+
  '.sg-r4-spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;border-radius:50%;animation:sgR4Spin .6s linear infinite}'+
  '@keyframes sgR4Spin{to{transform:rotate(360deg)}}'+
  /* #2 success celebration ring */
  '.sg-r4-ring{position:absolute;inset:-7px;border-radius:50%;border:3px solid rgba(34,197,94,.6);pointer-events:none;animation:sgR4Ring 1.1s ease-out 2}'+
  '@keyframes sgR4Ring{0%{transform:scale(.85);opacity:.85}100%{transform:scale(1.7);opacity:0}}';
document.head.appendChild(css);

var bar=document.createElement('div');
bar.id='sg-book-summary';
document.body.appendChild(bar);

function currentTab(){
  var a=document.querySelector('.sg-tab-item.active .sg-tab-label');
  return a?a.textContent.trim().toLowerCase():'';
}

function visibleCardPrice(){
  var c=document.getElementById('bm-carousel');
  if(!c)return null;
  var cards=c.querySelectorAll('.tt-card[data-price]');
  if(!cards.length)return null;
  var st=c.scrollTop,vh=c.clientHeight,best=null,bo=0;
  cards.forEach(function(k){
    var t=k.offsetTop,h=k.offsetHeight;
    var o=Math.max(0,Math.min(t+h,st+vh)-Math.max(t,st));
    if(o>bo){bo=o;best=k;}
  });
  var p=best&&best.getAttribute('data-price');
  return (p&&p!=='undefined'&&p!=='null')?p:null;
}

function summaryText(){
  var gbs=window._gymBookingState||{};
  var date=gbs.selectedDate;
  var dLabel='Today';
  if(date&&date!=='Today'){
    var dp=String(date).split('-');
    if(dp.length===3){
      var mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      dLabel=parseInt(dp[2])+' '+(mo[parseInt(dp[1])-1]||dp[1]);
    }else{dLabel=date;}
  }
  // Show friendly 'Today' when the selected date is today
  (function(){
    var d=new Date();
    var mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var todayLbl=d.getDate()+' '+mo[d.getMonth()];
    if(dLabel===todayLbl||!date)dLabel='Today';
  })();
  var passMap={day:'Day Pass','3day':'3-Day Pass',weekly:'Weekly Pass',monthly:'Monthly Pass'};
  var pass=passMap[gbs.selectedPass||'day']||'Day Pass';
  var price=visibleCardPrice();
  if(!price&&typeof window.sgPrice==='function'){try{var dpr=window.sgPrice('day');price=dpr&&dpr.display;}catch(e){}}
  return dLabel+' \u00b7 '+pass+(price?(' \u00b7 '+price):'');
}

function ensureBookSpin(){
  var b=document.getElementById('sg-continue-banner');
  if(b&&!document.getElementById('sg-r4-book-spin')){
    var s=document.createElement('div');s.id='sg-r4-book-spin';
    s.innerHTML='<span class="sg-r4-spinner"></span>Opening\u2026';
    b.appendChild(s);
  }
}
function showBookLoading(){var b=document.getElementById('sg-continue-banner');if(b){ensureBookSpin();b.classList.add('sg-r4-loading');}if(navigator.vibrate){try{navigator.vibrate(15);}catch(e){}}}
function hideBookLoading(){var b=document.getElementById('sg-continue-banner');if(b)b.classList.remove('sg-r4-loading');}
function wrapBookingCheckout(){
  if(window.__r4SBC)return;
  if(typeof window.showBookingCheckout!=='function')return;
  window.__r4SBC=true;
  var orig=window.showBookingCheckout;
  window.showBookingCheckout=function(){
    showBookLoading();
    var res;
    try{res=orig.apply(this,arguments);}catch(e){hideBookLoading();throw e;}
    Promise.resolve(res).then(hideBookLoading,hideBookLoading);
    setTimeout(hideBookLoading,6000);
    return res;
  };
}
function wrapPay(){
  ['ubConfirmPay','confirmPay'].forEach(function(fn){
    var f=window[fn];
    if(typeof f==='function'&&!f.__r4hap){
      var o=f;
      window[fn]=function(){if(navigator.vibrate){try{navigator.vibrate(15);}catch(e){}}return o.apply(this,arguments);};
      window[fn].__r4hap=true;
    }
  });
}
function celebrateSuccess(){
  var circle=document.querySelector('.w-20.h-20.bg-green-500.rounded-full');
  if(!circle||circle.getAttribute('data-r4-celebrated'))return;
  circle.setAttribute('data-r4-celebrated','1');
  circle.style.position='relative';
  var ring=document.createElement('span');ring.className='sg-r4-ring';
  circle.appendChild(ring);
  if(navigator.vibrate){try{navigator.vibrate([18,60,18,60,40]);}catch(e){}}
}
function tick(){
  ensureBookSpin();
  wrapBookingCheckout();
  wrapPay();
  celebrateSuccess();
  if(currentTab()==='book'){
    var t=summaryText();
    if(bar.textContent!==t)bar.textContent=t;
    document.body.classList.add('sg-r4-summary');
  }else{
    document.body.classList.remove('sg-r4-summary');
  }
}

return tick;
})();

/* ─────────────── round5-ui.js ─────────────── */
/* ═══════════════════════════════════════════════════════════════════════════
   ROUND 5 — Button cleanup (approved by Ankoor). Isolated & resilient:
   adjusts the live DOM every 600ms so it survives other teams' template edits.
   #1 Label the 4 ScanSquad rail icons (were icon-only)
   #2 Merge the two affiliate-link buttons (hide 'Deep Link', keep 'Share Link')
   #3 Merge gym-card 'Share' + 'Earn' (hide 'Earn', keep universal 'Share')
   #4 Remove the duplicate per-card '⚡ Book' button (keep sticky 'Book this gym')
   #5 Clarify vague labels: Pay→Payment, Trainer→AI Coach, Chat→Messages
   ═══════════════════════════════════════════════════════════════════════════ */
var buttonCleanup=(function(){

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
return tick;
})();

/* ── shared scheduler ─────────────────────────────────────────────────────── */
var ENHANCERS=[reelsRail,railIcons,bookSummary,buttonCleanup];
function tick(){
  for(var i=0;i<ENHANCERS.length;i++){try{ENHANCERS[i]();}catch(e){}}
}
function init(){tick();setInterval(tick,600);}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{init();}
})();
