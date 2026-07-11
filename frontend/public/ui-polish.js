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
(function(){
'use strict';

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

function tick(){enhanceBookRails();enhanceReelsRail();}
function init(){injectCSS();tick();setInterval(tick,600);}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{init();}
})();
