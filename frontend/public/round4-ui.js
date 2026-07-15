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
  'body.sg-r4-summary.sg-cb-active .sg-tab-content{bottom:calc(56px + 52px + 26px + env(safe-area-inset-bottom,0px))!important}';
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

function tick(){
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
