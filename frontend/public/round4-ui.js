/* ═══════════════════════════════════════════════════════════════════════════
   ROUND 4 — UI polish (approved by Ankoor, science-backed)
   #1 Remove the unlabeled orange logo square on gym cards (.tt-logo)
   #3 Make the rail "More" button neutral grey like its neighbours
      (Von Restorff: orange should mean only ONE thing — Book)
   #4 Add a slim "Today · Day Pass · £X" booking summary directly above the
      Book button on the Book tab (Uber/Booking confirmation pattern)
   Purely additive: one new file + CSS overrides. Easily reverted.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

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

function init(){tick();setInterval(tick,600);}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{init();}
})();
