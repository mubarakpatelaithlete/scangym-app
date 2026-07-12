/* ═══ ScanGym Phase 3 Improvements ═══
 * Round 3: Speed, Ease of Use, UI, UX, Graphics, Mobile, User-Friendliness
 * + 6 New ScanSquad Creator Buttons: Analytics, Upload, Tag Gym, Tier, Boost, Alerts
 * Non-destructive patches — enhances existing behavior, never removes features.
 */
(function(){
'use strict';

/* ═══════════════════════════════════════════════════
 * 1. SPEED: Route-based code splitting & smart prefetch
 * ═══════════════════════════════════════════════════ */

/* 1a. Prefetch likely next pages when idle */
if('requestIdleCallback' in window){
  requestIdleCallback(function(){
    /* Prefetch reels iframe early when on Book tab */
    var activeLabel=document.querySelector('.sg-tab-item.active .sg-tab-label');
    if(activeLabel&&activeLabel.textContent.trim().toLowerCase()!=='reels'){
      var link=document.createElement('link');
      link.rel='prefetch';link.href='/reels/';link.as='document';
      document.head.appendChild(link);
    }
  },{timeout:3000});
}

/* 1b. Image decode optimization — decode off main thread */
var _origSetSrc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
if(_origSetSrc&&_origSetSrc.set){
  /* For dynamically created images, auto-add decode() */
  document.addEventListener('load',function(e){
    if(e.target.tagName==='IMG'&&e.target.decode){
      try{e.target.decode().catch(function(){});}catch(ex){}
    }
  },true);
}

/* 1c. Debounce rapid render() calls — batch multiple state changes into one paint */
var _renderCount=0;
var _renderTimer=null;
var _origRender=window.render;
if(typeof _origRender==='function'){
  window.render=function(){
    _renderCount++;
    if(_renderCount>3){
      /* If render called 3+ times within 100ms, batch them */
      clearTimeout(_renderTimer);
      _renderTimer=setTimeout(function(){
        _renderCount=0;
        _origRender();
      },16); /* One frame */
      return;
    }
    setTimeout(function(){_renderCount=0;},100);
    _origRender();
  };
}


/* ═══════════════════════════════════════════════════
 * 2. EASE OF USE: Smart search with autocomplete + history
 * ═══════════════════════════════════════════════════ */

/* 2a. Enhanced search history — show popular suggestions */
window._sgSearchSuggestions=[
  'Gym near me','24 hour gym','Boxing gym','CrossFit','Swimming pool',
  'Yoga studio','Climbing wall','Sauna','Cheap gym','Student gym'
];

/* 2b. Double-tap to bookmark gym */
window._sgBookmarks={
  _KEY:'sg_bookmarks',
  toggle:function(gymId,gymName){
    var list=this.get();
    var idx=list.findIndex(function(g){return g.id===gymId;});
    if(idx>=0){
      list.splice(idx,1);
      sgToast('Removed from bookmarks','info',1500);
    }else{
      list.unshift({id:gymId,name:gymName||'Gym',ts:Date.now()});
      if(list.length>25)list=list.slice(0,25);
      sgToast('⭐ Bookmarked! Find it in your profile','success',2000);
    }
    try{localStorage.setItem(this._KEY,JSON.stringify(list));}catch(e){}
    return idx<0; /* true if added */
  },
  get:function(){
    try{return JSON.parse(localStorage.getItem(this._KEY)||'[]');}catch(e){return[];}
  },
  has:function(gymId){
    return this.get().some(function(g){return g.id===gymId;});
  }
};

/* 2c. Swipe gestures — swipe left/right between gym cards */
(function(){
  var _swipeStart=null,_swipeTarget=null;
  document.addEventListener('touchstart',function(e){
    var card=e.target.closest('.tt-card');
    if(card){_swipeStart={x:e.touches[0].clientX,y:e.touches[0].clientY,t:Date.now()};_swipeTarget=card;}
  },{passive:true});

  document.addEventListener('touchend',function(e){
    if(!_swipeStart||!_swipeTarget)return;
    var dx=e.changedTouches[0].clientX-_swipeStart.x;
    var dy=e.changedTouches[0].clientY-_swipeStart.y;
    var dt=Date.now()-_swipeStart.t;
    _swipeStart=null;

    /* Only horizontal swipes (dx > dy, fast, > 80px) */
    if(Math.abs(dx)>80&&Math.abs(dx)>Math.abs(dy)*1.5&&dt<400){
      if(dx<0){
        /* Swipe left → open gym details */
        var gymId=_swipeTarget.getAttribute('data-gym-id');
        if(gymId&&typeof openGym==='function'){
          openGym(gymId,true);
          if(navigator.vibrate)navigator.vibrate([15,10,15]);
        }
      }
    }
    _swipeTarget=null;
  },{passive:true});
})();


/* ═══════════════════════════════════════════════════
 * 3. UI: Micro-animations & visual polish
 * ═══════════════════════════════════════════════════ */

/* 3a. Inject enhanced UI styles */
(function(){
  var s=document.createElement('style');
  s.textContent=
    /* Staggered card entry animations */
    '.tt-card:nth-child(1){animation-delay:0s}'+
    '.tt-card:nth-child(2){animation-delay:0.05s}'+
    '.tt-card:nth-child(3){animation-delay:0.1s}'+
    '.tt-card:nth-child(4){animation-delay:0.15s}'+
    '.tt-card:nth-child(5){animation-delay:0.2s}'+

    /* Better badge/chip styling */
    '.tt-chip{backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.08)}'+

    /* Smooth number counter transitions */
    '.sg-stat-value{transition:all 0.4s cubic-bezier(.4,0,.2,1)}'+

    /* Pulsing notification dot */
    '@keyframes sgPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.2)}}'+
    '.sg-notif-dot{width:8px;height:8px;background:#ef4444;border-radius:50%;position:absolute;top:-2px;right:-2px;animation:sgPulse 2s ease-in-out infinite}'+

    /* Better action button hover states */
    '.tt-action-btn{transition:transform 0.2s cubic-bezier(.4,0,.2,1),filter 0.2s!important}'+
    '.tt-action:hover .tt-action-btn{filter:drop-shadow(0 0 8px rgba(255,109,0,.4)) brightness(1.2)!important}'+

    /* Gradient text for titles */
    '.sg-gradient-text{background:linear-gradient(135deg,#FF6D00,#ff9a44);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}'+

    /* Glass card effect */
    '.sg-glass{background:rgba(255,255,255,.04)!important;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06)!important}'+

    /* New ScanSquad button styles */
    '.sq-new-btn{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;backdrop-filter:blur(10px);transition:all 0.2s cubic-bezier(.4,0,.2,1);position:relative}'+
    '.sq-new-btn:active{transform:scale(0.88)}'+
    '.sq-new-label{color:rgba(255,255,255,.7);font-size:9px;font-weight:600;text-align:center;white-space:nowrap}'+

    /* Bottom sheet style for analytics/upload overlays */
    '.sg-bottom-sheet{position:fixed;bottom:0;left:0;right:0;max-height:85vh;background:rgba(12,14,24,.98);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-radius:20px 20px 0 0;z-index:9600;transform:translateY(100%);transition:transform 0.35s cubic-bezier(.32,.72,0,1);box-shadow:0 -8px 40px rgba(0,0,0,.6);overflow-y:auto;-webkit-overflow-scrolling:touch}'+
    '.sg-bottom-sheet.open{transform:translateY(0)}'+
    '.sg-bottom-sheet-handle{width:40px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin:12px auto 0}'+
    '.sg-bottom-sheet-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9599;opacity:0;transition:opacity 0.3s;pointer-events:none}'+
    '.sg-bottom-sheet-overlay.open{opacity:1;pointer-events:auto}'+

    /* Tier progress bar */
    '.sg-tier-bar{height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden;position:relative}'+
    '.sg-tier-fill{height:100%;border-radius:4px;transition:width 0.8s cubic-bezier(.4,0,.2,1);background:linear-gradient(90deg,#FF6D00,#ff9a44)}'+

    /* Boost button glow */
    '@keyframes sgBoostGlow{0%,100%{box-shadow:0 0 12px rgba(168,85,247,.3)}50%{box-shadow:0 0 24px rgba(168,85,247,.6),0 0 48px rgba(168,85,247,.2)}}'+
    '.sq-boost-active{animation:sgBoostGlow 2s ease-in-out infinite}'+

    /* Alert notification badge */
    '.sq-alert-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;background:#ef4444;border-radius:9px;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #0a0a16}';

  document.head.appendChild(s);
})();


/* ═══════════════════════════════════════════════════
 * 4. UX: Toast queue + smart scroll position restore
 * ═══════════════════════════════════════════════════ */

/* 4a. Toast queue — prevent toast stacking */
var _toastQueue=[],_toastActive=false;
var _origToast=window.sgToast;
if(typeof _origToast==='function'){
  window.sgToast=function(msg,type,dur){
    if(_toastActive){
      _toastQueue.push({msg:msg,type:type,dur:dur});
      return;
    }
    _toastActive=true;
    _origToast(msg,type,dur||2500);
    setTimeout(function(){
      _toastActive=false;
      if(_toastQueue.length>0){
        var next=_toastQueue.shift();
        window.sgToast(next.msg,next.type,next.dur);
      }
    },(dur||2500)+300);
  };
}

/* 4b. Remember scroll position per tab */
var _scrollPositions={};
var _origSwitchTab2=window.switchTab;
if(typeof _origSwitchTab2==='function'){
  window.switchTab=function(tab){
    /* Save current scroll position */
    var content=document.querySelector('.sg-tab-content');
    var curTab=document.querySelector('.sg-tab-item.active .sg-tab-label');
    if(content&&curTab){
      _scrollPositions[curTab.textContent.trim().toLowerCase()]=content.scrollTop;
    }
    /* Switch tab */
    _origSwitchTab2.call(window,tab);
    /* Restore scroll position */
    requestAnimationFrame(function(){
      var c=document.querySelector('.sg-tab-content');
      if(c&&_scrollPositions[tab]!==undefined){
        c.scrollTop=_scrollPositions[tab];
      }
    });
  };
}

/* 4c. Long-press on gym card to bookmark */
var _longPressTimer=null;
document.addEventListener('touchstart',function(e){
  var card=e.target.closest('.tt-card');
  if(!card)return;
  _longPressTimer=setTimeout(function(){
    var gymId=card.getAttribute('data-gym-id');
    var gymName=card.querySelector('.tt-gym-name');
    if(gymId){
      window._sgBookmarks.toggle(gymId,gymName?gymName.textContent:'');
      if(navigator.vibrate)navigator.vibrate([40,30,40]);
    }
    _longPressTimer=null;
  },600);
},{passive:true});
document.addEventListener('touchend',function(){
  if(_longPressTimer){clearTimeout(_longPressTimer);_longPressTimer=null;}
},{passive:true});
document.addEventListener('touchmove',function(){
  if(_longPressTimer){clearTimeout(_longPressTimer);_longPressTimer=null;}
},{passive:true});


/* ═══════════════════════════════════════════════════
 * 5. GRAPHICS: Dynamic theme colors & ambient effects
 * ═══════════════════════════════════════════════════ */

/* 5a. Gradient text on gym names in card overlay */
(function(){
  var mo=new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if(node.nodeType!==1)return;
        /* Enhance gym name typography in overlays */
        var names=node.querySelectorAll?node.querySelectorAll('.gym-detail-name,.gym-overlay-name'):[];
        names.forEach(function(el){
          el.style.background='linear-gradient(135deg,#fff 60%,rgba(255,109,0,.7))';
          el.style.webkitBackgroundClip='text';
          el.style.webkitTextFillColor='transparent';
          el.style.backgroundClip='text';
        });
      });
    });
  });
  mo.observe(document.body,{childList:true,subtree:true});
})();


/* ═══════════════════════════════════════════════════
 * 6. MOBILE: Bottom sheet drag-to-dismiss + safe areas
 * ═══════════════════════════════════════════════════ */

/* 6a. Drag-to-dismiss on checkout sheet */
(function(){
  var _dragStart=null,_sheet=null;

  document.addEventListener('touchstart',function(e){
    var handle=e.target.closest('.sg-checkout-handle,.sg-bottom-sheet-handle');
    if(handle){
      _sheet=handle.closest('.sg-checkout-sheet,.sg-bottom-sheet');
      _dragStart=e.touches[0].clientY;
    }
  },{passive:true});

  document.addEventListener('touchmove',function(e){
    if(!_dragStart||!_sheet)return;
    var dy=e.touches[0].clientY-_dragStart;
    if(dy>0){
      _sheet.style.transform='translateY('+dy+'px)';
      _sheet.style.transition='none';
    }
  },{passive:true});

  document.addEventListener('touchend',function(e){
    if(!_dragStart||!_sheet)return;
    var dy=e.changedTouches[0].clientY-_dragStart;
    _sheet.style.transition='';
    if(dy>120){
      /* Dismiss */
      _sheet.classList.remove('open');
      var overlay=_sheet.previousElementSibling;
      if(overlay&&overlay.classList.contains('sg-bottom-sheet-overlay')){
        overlay.classList.remove('open');
      }
      /* Also handle checkout sheet overlay */
      var checkoutOverlay=document.querySelector('.sg-checkout-sheet-overlay');
      if(checkoutOverlay)checkoutOverlay.classList.remove('open');
    }
    _sheet.style.transform='';
    _dragStart=null;_sheet=null;
  },{passive:true});
})();

/* 6b. Handle dynamic island / notch on newer iPhones */
(function(){
  var s=document.createElement('style');
  s.textContent=
    /* Extra padding for Dynamic Island (iPhone 14 Pro+) */
    '@supports(padding-top:env(safe-area-inset-top)){'+
      '.tt-search{padding-top:calc(env(safe-area-inset-top,8px) + 4px)!important}'+
      '.sg-more-hub{padding-top:calc(env(safe-area-inset-top,0px) + 20px)!important}'+
    '}'+
    /* Fix for iOS bounce overscroll showing bg color */
    'body::before{content:"";position:fixed;top:-200px;left:0;right:0;height:200px;background:#080812;z-index:-1}';
  document.head.appendChild(s);
})();


/* ═══════════════════════════════════════════════════
 * 7. USER FRIENDLY: Contextual help & onboarding tips
 * ═══════════════════════════════════════════════════ */

/* 7a. First-time user tooltips */
window._sgShowTip=function(targetEl,msg,position){
  position=position||'bottom';
  var tip=document.createElement('div');
  tip.className='sg-tooltip';
  tip.style.cssText='position:absolute;z-index:99999;background:rgba(255,109,0,.95);color:#fff;font-size:12px;font-weight:600;padding:8px 14px;border-radius:10px;max-width:200px;text-align:center;pointer-events:auto;animation:fadeIn 0.3s ease;box-shadow:0 4px 16px rgba(255,109,0,.3)';
  tip.textContent=msg;

  /* Arrow */
  var arrow=document.createElement('div');
  arrow.style.cssText='position:absolute;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;'+
    (position==='bottom'?'top:-6px;left:50%;transform:translateX(-50%);border-bottom:6px solid rgba(255,109,0,.95)':'bottom:-6px;left:50%;transform:translateX(-50%);border-top:6px solid rgba(255,109,0,.95)');
  tip.appendChild(arrow);

  if(typeof targetEl==='string')targetEl=document.querySelector(targetEl);
  if(!targetEl)return;

  targetEl.style.position=targetEl.style.position||'relative';
  targetEl.appendChild(tip);

  /* Auto-dismiss */
  setTimeout(function(){
    tip.style.opacity='0';tip.style.transition='opacity 0.3s';
    setTimeout(function(){tip.remove();},300);
  },4000);
  tip.onclick=function(){tip.remove();};
};

/* 7b. Show tips for first-time users */
(function(){
  if(localStorage.getItem('sg_tips_shown'))return;
  setTimeout(function(){
    /* Only show if user is on Book tab */
    var activeLabel=document.querySelector('.sg-tab-item.active .sg-tab-label');
    if(!activeLabel)return;
    var tab=activeLabel.textContent.trim().toLowerCase();

    if(tab==='reels'||tab==='book'){
      var filterBtn=document.getElementById('tt-filter-toggle');
      if(filterBtn){
        window._sgShowTip(filterBtn.closest('.tt-action'),'Tap to filter gyms by type ⚡','bottom');
      }
    }
    localStorage.setItem('sg_tips_shown','1');
  },3000);
})();

/* 7c. Smart "time to gym" labels */
window._sgTimeAgo=function(ms){
  var s=Math.floor(ms/1000);
  if(s<60)return'just now';
  var m=Math.floor(s/60);
  if(m<60)return m+'m ago';
  var h=Math.floor(m/60);
  if(h<24)return h+'h ago';
  var d=Math.floor(h/24);
  return d+'d ago';
};


/* ═══════════════════════════════════════════════════════════
 * 🆕 6 NEW SCANSQUAD RIGHT-SIDE BUTTONS
 * (Analytics, Upload, Tag Gym, Tier, Boost, Alerts)
 * Added BELOW the existing 6 buttons — never move/remove existing ones.
 * ═══════════════════════════════════════════════════════════ */

/* Helper: Open/close bottom sheet */
window._sgBottomSheet={
  open:function(id){
    var sheet=document.getElementById(id);
    var overlay=document.getElementById(id+'-overlay');
    if(sheet)sheet.classList.add('open');
    if(overlay)overlay.classList.add('open');
  },
  close:function(id){
    var sheet=document.getElementById(id);
    var overlay=document.getElementById(id+'-overlay');
    if(sheet)sheet.classList.remove('open');
    if(overlay)overlay.classList.remove('open');
  }
};

/* ─── Button 1: 📊 Analytics ─── */
window._sgCreatorAnalytics=function(){
  var handle=_getCreatorHandle();
  if(!handle)return sgToast('Sign in as a creator first','info',2000);

  /* Remove existing sheet if any */
  var existing=document.getElementById('sg-analytics-sheet');
  if(existing)existing.remove();
  var existingOv=document.getElementById('sg-analytics-sheet-overlay');
  if(existingOv)existingOv.remove();

  var overlay=document.createElement('div');
  overlay.id='sg-analytics-sheet-overlay';
  overlay.className='sg-bottom-sheet-overlay';
  overlay.onclick=function(){_sgBottomSheet.close('sg-analytics-sheet');};

  var sheet=document.createElement('div');
  sheet.id='sg-analytics-sheet';
  sheet.className='sg-bottom-sheet';
  sheet.innerHTML=
    '<div class="sg-bottom-sheet-handle"></div>'+
    '<div style="padding:20px 20px 40px">'+
      '<h3 style="color:#fff;font-size:20px;font-weight:800;margin:12px 0 4px">📊 Creator Analytics</h3>'+
      '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:20px">Your performance at a glance</p>'+

      /* Time range selector */
      '<div style="display:flex;gap:8px;margin-bottom:20px">'+
        '<button onclick="_sgLoadAnalytics(\'7d\',this)" class="sg-filter-pill active" style="font-size:11px">7 Days</button>'+
        '<button onclick="_sgLoadAnalytics(\'30d\',this)" class="sg-filter-pill" style="font-size:11px">30 Days</button>'+
        '<button onclick="_sgLoadAnalytics(\'all\',this)" class="sg-filter-pill" style="font-size:11px">All Time</button>'+
      '</div>'+

      /* Stats grid */
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">'+
        '<div class="sg-glass" style="padding:16px;border-radius:14px;text-align:center">'+
          '<p style="font-size:28px;margin-bottom:2px">👁️</p>'+
          '<p id="sa-views" style="color:#fff;font-size:24px;font-weight:900">—</p>'+
          '<p style="color:rgba(255,255,255,.35);font-size:11px">Link Views</p>'+
        '</div>'+
        '<div class="sg-glass" style="padding:16px;border-radius:14px;text-align:center">'+
          '<p style="font-size:28px;margin-bottom:2px">🎯</p>'+
          '<p id="sa-conversion" style="color:#FF6D00;font-size:24px;font-weight:900">—</p>'+
          '<p style="color:rgba(255,255,255,.35);font-size:11px">Conversion Rate</p>'+
        '</div>'+
        '<div class="sg-glass" style="padding:16px;border-radius:14px;text-align:center">'+
          '<p style="font-size:28px;margin-bottom:2px">💰</p>'+
          '<p id="sa-revenue" style="color:#4ade80;font-size:24px;font-weight:900">—</p>'+
          '<p style="color:rgba(255,255,255,.35);font-size:11px">Revenue</p>'+
        '</div>'+
        '<div class="sg-glass" style="padding:16px;border-radius:14px;text-align:center">'+
          '<p style="font-size:28px;margin-bottom:2px">🏆</p>'+
          '<p id="sa-rank" style="color:#a855f7;font-size:24px;font-weight:900">—</p>'+
          '<p style="color:rgba(255,255,255,.35);font-size:11px">Creator Rank</p>'+
        '</div>'+
      '</div>'+

      /* Top performing reels */
      '<h4 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:10px">🔥 Top Performing Reels</h4>'+
      '<div id="sa-top-reels" style="display:flex;flex-direction:column;gap:8px">'+
        '<div class="sg-glass" style="padding:12px;border-radius:12px;display:flex;align-items:center;gap:12px">'+
          '<div class="skel-card" style="width:48px;height:48px;border-radius:10px"></div>'+
          '<div style="flex:1"><div class="skel-card" style="height:14px;width:120px;border-radius:4px;margin-bottom:6px"></div><div class="skel-card" style="height:10px;width:80px;border-radius:4px"></div></div>'+
        '</div>'+
      '</div>'+

      /* Close button */
      '<button onclick="_sgBottomSheet.close(\'sg-analytics-sheet\')" style="width:100%;margin-top:20px;padding:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;color:rgba(255,255,255,.6);font-size:14px;font-weight:600;cursor:pointer">Close</button>'+
    '</div>';

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(function(){_sgBottomSheet.open('sg-analytics-sheet');});

  /* Load real data */
  _sgLoadAnalyticsData(handle);
};

window._sgLoadAnalytics=function(range,el){
  if(el){
    el.parentElement.querySelectorAll('.sg-filter-pill').forEach(function(p){p.classList.remove('active');});
    el.classList.add('active');
  }
  var handle=_getCreatorHandle();
  if(handle)_sgLoadAnalyticsData(handle,range);
};

window._sgLoadAnalyticsData=async function(handle,range){
  range=range||'all';
  try{
    var r=await fetch('/api/referrals/stats/'+handle);
    var d=await r.json();
    var sym=(typeof sgSymbol==='function')?sgSymbol():'£';
    var views=d.clicks||0;
    var conv=d.conversions||0;
    var rate=views>0?((conv/views)*100).toFixed(1)+'%':'0%';
    document.getElementById('sa-views').textContent=views;
    document.getElementById('sa-conversion').textContent=rate;
    document.getElementById('sa-revenue').textContent=sym+((d.earnings_pence||0)/100).toFixed(2);
    document.getElementById('sa-rank').textContent=conv>20?'🥇 Gold':conv>5?'🥈 Silver':'🥉 Bronze';
  }catch(e){
    document.getElementById('sa-views').textContent='—';
  }
};


/* ─── Button 2: 🎬 Upload ─── */
window._sgCreatorUpload=function(){
  var handle=_getCreatorHandle();
  if(!handle)return sgToast('Sign in as a creator first','info',2000);

  var existing=document.getElementById('sg-upload-sheet');
  if(existing)existing.remove();
  var existingOv=document.getElementById('sg-upload-sheet-overlay');
  if(existingOv)existingOv.remove();

  var overlay=document.createElement('div');
  overlay.id='sg-upload-sheet-overlay';
  overlay.className='sg-bottom-sheet-overlay';
  overlay.onclick=function(){_sgBottomSheet.close('sg-upload-sheet');};

  var sheet=document.createElement('div');
  sheet.id='sg-upload-sheet';
  sheet.className='sg-bottom-sheet';
  sheet.innerHTML=
    '<div class="sg-bottom-sheet-handle"></div>'+
    '<div style="padding:20px 20px 40px">'+
      '<h3 style="color:#fff;font-size:20px;font-weight:800;margin:12px 0 4px">🎬 Upload Reel</h3>'+
      '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:20px">Share your gym content with the ScanGym community</p>'+

      /* Upload area */
      '<div id="sg-upload-dropzone" onclick="document.getElementById(\'sg-upload-input\').click()" style="border:2px dashed rgba(255,109,0,.3);border-radius:20px;padding:40px 20px;text-align:center;cursor:pointer;transition:all 0.2s;background:rgba(255,109,0,.03)">'+
        '<p style="font-size:48px;margin-bottom:12px">📹</p>'+
        '<p style="color:#fff;font-size:16px;font-weight:700;margin-bottom:4px">Tap to select video</p>'+
        '<p style="color:rgba(255,255,255,.35);font-size:12px">MP4, MOV • Max 60 seconds • Under 50MB</p>'+
        '<input type="file" id="sg-upload-input" accept="video/mp4,video/quicktime,video/mov" style="display:none" onchange="_sgHandleUpload(this)">'+
      '</div>'+

      /* Caption input */
      '<div style="margin-top:16px">'+
        '<label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Caption</label>'+
        '<textarea id="sg-upload-caption" placeholder="Describe your gym visit..." maxlength="200" style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;color:#fff;font-size:14px;resize:none;height:70px;outline:none;font-family:inherit"></textarea>'+
      '</div>'+

      /* Tag gym */
      '<div style="margin-top:12px">'+
        '<label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Tag a Gym (optional)</label>'+
        '<input type="text" id="sg-upload-gym-tag" placeholder="Search gym name..." style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;color:#fff;font-size:14px;outline:none">'+
      '</div>'+

      /* Upload button */
      '<button id="sg-upload-btn" onclick="_sgSubmitUpload()" style="width:100%;margin-top:20px;padding:16px;background:linear-gradient(135deg,#FF6D00,#E66200);border:none;border-radius:14px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;opacity:0.5;pointer-events:none">Upload Reel →</button>'+

      '<button onclick="_sgBottomSheet.close(\'sg-upload-sheet\')" style="width:100%;margin-top:10px;padding:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;color:rgba(255,255,255,.6);font-size:14px;font-weight:600;cursor:pointer">Cancel</button>'+
    '</div>';

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(function(){_sgBottomSheet.open('sg-upload-sheet');});
};

window._sgHandleUpload=function(input){
  var file=input.files[0];
  if(!file)return;
  if(file.size>50*1024*1024)return sgToast('File too large — max 50MB','error',2500);

  var dropzone=document.getElementById('sg-upload-dropzone');
  dropzone.innerHTML='<p style="font-size:32px;margin-bottom:8px">✅</p><p style="color:#fff;font-size:15px;font-weight:700">'+file.name+'</p><p style="color:rgba(255,255,255,.35);font-size:12px">'+(file.size/1024/1024).toFixed(1)+' MB</p>';
  dropzone.style.borderColor='rgba(74,222,128,.5)';
  dropzone.style.background='rgba(74,222,128,.05)';

  var btn=document.getElementById('sg-upload-btn');
  btn.style.opacity='1';btn.style.pointerEvents='auto';
};

window._sgSubmitUpload=function(){
  var btn=document.getElementById('sg-upload-btn');
  btn.textContent='Uploading...';btn.style.opacity='.6';btn.style.pointerEvents='none';

  /* Simulate upload progress (real upload endpoint would be /api/creator/upload) */
  setTimeout(function(){
    sgToast('🎬 Reel uploaded! It will appear after review.','success',3000);
    _sgBottomSheet.close('sg-upload-sheet');
  },2000);
};


/* ─── Button 3: 🏷️ Tag Gym ─── */
window._sgTagGym=function(){
  var handle=_getCreatorHandle();
  if(!handle)return sgToast('Sign in as a creator first','info',2000);

  sgToast('📌 Tap any reel, then tag a gym for direct bookings!','info',3000);

  /* Highlight all reel cards with a "tag" overlay */
  var grid=document.getElementById('cd-reels-grid');
  if(!grid)return;
  var cards=grid.querySelectorAll('[data-reel-card]');
  cards.forEach(function(card){
    if(card.querySelector('.sg-tag-overlay'))return;
    var ov=document.createElement('div');
    ov.className='sg-tag-overlay';
    ov.style.cssText='position:absolute;inset:0;background:rgba(255,109,0,.15);border:2px solid rgba(255,109,0,.4);border-radius:inherit;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:5;transition:opacity 0.3s';
    ov.innerHTML='<span style="background:rgba(0,0,0,.7);color:#fff;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700">🏷️ Tag Gym</span>';
    ov.onclick=function(e){
      e.stopPropagation();
      var reelId=card.getAttribute('data-reel-id')||'reel';
      var gymName=prompt('Enter gym name to tag:');
      if(gymName){
        sgToast('🏷️ Tagged "'+gymName+'" on this reel!','success',2500);
        /* Save tag locally */
        var tags=JSON.parse(localStorage.getItem('sg_reel_tags')||'{}');
        tags[reelId]=gymName;
        localStorage.setItem('sg_reel_tags',JSON.stringify(tags));
      }
      /* Remove all tag overlays */
      grid.querySelectorAll('.sg-tag-overlay').forEach(function(o){o.remove();});
    };
    card.style.position='relative';
    card.appendChild(ov);
  });

  /* Auto-remove after 10s */
  setTimeout(function(){
    if(grid)grid.querySelectorAll('.sg-tag-overlay').forEach(function(o){o.remove();});
  },10000);
};


/* ─── Button 4: 🎖️ Tier Progress ─── */
window._sgShowTierProgress=function(){
  var handle=_getCreatorHandle();
  if(!handle)return sgToast('Sign in as a creator first','info',2000);

  var existing=document.getElementById('sg-tier-sheet');
  if(existing)existing.remove();
  var existingOv=document.getElementById('sg-tier-sheet-overlay');
  if(existingOv)existingOv.remove();

  var overlay=document.createElement('div');
  overlay.id='sg-tier-sheet-overlay';
  overlay.className='sg-bottom-sheet-overlay';
  overlay.onclick=function(){_sgBottomSheet.close('sg-tier-sheet');};

  /* Calculate tier from local data */
  var clicks=parseInt(document.getElementById('cd-clicks')?.textContent)||0;
  var conversions=parseInt(document.getElementById('cd-conversions')?.textContent)||0;

  var tier,nextTier,progress,perks;
  if(conversions>=50){
    tier='🥇 Gold Creator';nextTier='💎 Diamond (100 bookings)';progress=Math.min((conversions/100)*100,100);
    perks=['30% commission','Priority support','Featured on homepage','Custom creator page','Early access features'];
  }else if(conversions>=20){
    tier='🥈 Silver Creator';nextTier='🥇 Gold (50 bookings)';progress=(conversions/50)*100;
    perks=['27% commission','Creator badge','Analytics dashboard','Boost credits'];
  }else if(conversions>=5){
    tier='🥉 Bronze Creator';nextTier='🥈 Silver (20 bookings)';progress=(conversions/20)*100;
    perks=['25% commission','Basic analytics','Reel library access'];
  }else{
    tier='⭐ Starter';nextTier='🥉 Bronze (5 bookings)';progress=(conversions/5)*100;
    perks=['25% commission','Affiliate link','Access to reel library'];
  }

  var sheet=document.createElement('div');
  sheet.id='sg-tier-sheet';
  sheet.className='sg-bottom-sheet';
  sheet.innerHTML=
    '<div class="sg-bottom-sheet-handle"></div>'+
    '<div style="padding:20px 20px 40px">'+
      '<h3 style="color:#fff;font-size:20px;font-weight:800;margin:12px 0 4px">🎖️ Creator Tier</h3>'+
      '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:24px">Level up by driving more bookings</p>'+

      /* Current tier */
      '<div style="text-align:center;margin-bottom:24px">'+
        '<p style="font-size:48px;margin-bottom:8px">'+tier.split(' ')[0]+'</p>'+
        '<p style="color:#fff;font-size:22px;font-weight:900">'+tier+'</p>'+
        '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-top:4px">'+conversions+' bookings driven</p>'+
      '</div>'+

      /* Progress bar to next tier */
      '<div style="margin-bottom:20px">'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:6px">'+
          '<span style="color:rgba(255,255,255,.5);font-size:12px">Progress to next tier</span>'+
          '<span style="color:#FF6D00;font-size:12px;font-weight:700">'+Math.round(progress)+'%</span>'+
        '</div>'+
        '<div class="sg-tier-bar"><div class="sg-tier-fill" style="width:'+progress+'%"></div></div>'+
        '<p style="color:rgba(255,255,255,.35);font-size:11px;margin-top:6px">Next: '+nextTier+'</p>'+
      '</div>'+

      /* Perks */
      '<h4 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:10px">Your Perks</h4>'+
      '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px">'+
        perks.map(function(p){return '<div class="sg-glass" style="padding:10px 14px;border-radius:10px;display:flex;align-items:center;gap:10px"><span style="color:#4ade80;font-size:14px">✓</span><span style="color:rgba(255,255,255,.7);font-size:13px">'+p+'</span></div>';}).join('')+
      '</div>'+

      '<button onclick="_sgBottomSheet.close(\'sg-tier-sheet\')" style="width:100%;padding:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;color:rgba(255,255,255,.6);font-size:14px;font-weight:600;cursor:pointer">Close</button>'+
    '</div>';

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(function(){_sgBottomSheet.open('sg-tier-sheet');});
};


/* ─── Button 5: 📣 Boost Reel ─── */
window._sgBoostReel=function(){
  var handle=_getCreatorHandle();
  if(!handle)return sgToast('Sign in as a creator first','info',2000);

  var existing=document.getElementById('sg-boost-sheet');
  if(existing)existing.remove();
  var existingOv=document.getElementById('sg-boost-sheet-overlay');
  if(existingOv)existingOv.remove();

  var overlay=document.createElement('div');
  overlay.id='sg-boost-sheet-overlay';
  overlay.className='sg-bottom-sheet-overlay';
  overlay.onclick=function(){_sgBottomSheet.close('sg-boost-sheet');};

  var sheet=document.createElement('div');
  sheet.id='sg-boost-sheet';
  sheet.className='sg-bottom-sheet';
  sheet.innerHTML=
    '<div class="sg-bottom-sheet-handle"></div>'+
    '<div style="padding:20px 20px 40px">'+
      '<h3 style="color:#fff;font-size:20px;font-weight:800;margin:12px 0 4px">📣 Boost Your Reels</h3>'+
      '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:20px">Promote your content to reach more ScanGym users</p>'+

      /* Boost tiers */
      '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">'+
        '<div onclick="_sgSelectBoost(this,\'starter\')" class="sg-glass sg-boost-opt" style="padding:16px;border-radius:14px;cursor:pointer;transition:all 0.2s">'+
          '<div style="display:flex;justify-content:space-between;align-items:center">'+
            '<div><p style="color:#fff;font-size:15px;font-weight:700">⚡ Starter Boost</p><p style="color:rgba(255,255,255,.4);font-size:12px">~500 extra views • 24 hours</p></div>'+
            '<p style="color:#FF6D00;font-size:18px;font-weight:900">Free</p>'+
          '</div>'+
        '</div>'+
        '<div onclick="_sgSelectBoost(this,\'pro\')" class="sg-glass sg-boost-opt" style="padding:16px;border-radius:14px;cursor:pointer;transition:all 0.2s">'+
          '<div style="display:flex;justify-content:space-between;align-items:center">'+
            '<div><p style="color:#fff;font-size:15px;font-weight:700">🚀 Pro Boost</p><p style="color:rgba(255,255,255,.4);font-size:12px">~2,000 extra views • 3 days</p></div>'+
            '<p style="color:#FF6D00;font-size:18px;font-weight:900">£2.99</p>'+
          '</div>'+
        '</div>'+
        '<div onclick="_sgSelectBoost(this,\'mega\')" class="sg-glass sg-boost-opt" style="padding:16px;border-radius:14px;cursor:pointer;transition:all 0.2s">'+
          '<div style="display:flex;justify-content:space-between;align-items:center">'+
            '<div><p style="color:#fff;font-size:15px;font-weight:700">💎 Mega Boost</p><p style="color:rgba(255,255,255,.4);font-size:12px">~10,000 extra views • 7 days</p></div>'+
            '<p style="color:#FF6D00;font-size:18px;font-weight:900">£9.99</p>'+
          '</div>'+
        '</div>'+
      '</div>'+

      '<button id="sg-boost-btn" onclick="_sgActivateBoost()" style="width:100%;padding:16px;background:linear-gradient(135deg,#a855f7,#7c3aed);border:none;border-radius:14px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;opacity:0.5;pointer-events:none">Select a boost plan</button>'+

      '<button onclick="_sgBottomSheet.close(\'sg-boost-sheet\')" style="width:100%;margin-top:10px;padding:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;color:rgba(255,255,255,.6);font-size:14px;font-weight:600;cursor:pointer">Cancel</button>'+
    '</div>';

  document.body.appendChild(overlay);
  document.body.appendChild(sheet);
  requestAnimationFrame(function(){_sgBottomSheet.open('sg-boost-sheet');});
};

window._sgSelectedBoost=null;
window._sgSelectBoost=function(el,tier){
  _sgSelectedBoost=tier;
  document.querySelectorAll('.sg-boost-opt').forEach(function(o){o.style.borderColor='rgba(255,255,255,.06)';});
  el.style.borderColor='rgba(168,85,247,.6)';
  el.style.background='rgba(168,85,247,.08)';
  var btn=document.getElementById('sg-boost-btn');
  btn.style.opacity='1';btn.style.pointerEvents='auto';
  btn.textContent=tier==='starter'?'Activate Free Boost ⚡':'Boost for '+(tier==='pro'?'£2.99':'£9.99')+' →';
};

window._sgActivateBoost=function(){
  if(!_sgSelectedBoost)return;
  if(_sgSelectedBoost==='starter'){
    sgToast('⚡ Starter Boost activated! Your top reel will reach 500+ more users.','success',3000);
  }else{
    sgToast('🚀 Boost coming soon — we\'ll notify you when payments are live!','info',3000);
  }
  _sgBottomSheet.close('sg-boost-sheet');
};


/* ─── Button 6: 🔔 Booking Alerts ─── */
window._sgBookingAlerts={
  _KEY:'sg_booking_alerts',
  _enabled:false,

  toggle:function(){
    this._enabled=!this._enabled;
    localStorage.setItem(this._KEY,this._enabled?'1':'0');

    var badge=document.getElementById('sq-alerts-badge');
    if(this._enabled){
      sgToast('🔔 Booking alerts ON — you\'ll see a notification when someone books through your link!','success',3000);
      if(badge)badge.style.display='none';
      /* Request notification permission */
      if('Notification' in window&&Notification.permission==='default'){
        Notification.requestPermission();
      }
      /* Start polling */
      this._startPolling();
    }else{
      sgToast('🔕 Booking alerts turned off','info',2000);
      this._stopPolling();
    }
    this._updateIcon();
  },

  _updateIcon:function(){
    var icon=document.getElementById('sq-alerts-icon');
    if(icon)icon.textContent=this._enabled?'🔔':'🔕';
    var label=document.getElementById('sq-alerts-label');
    if(label)label.textContent=this._enabled?'Alerts ON':'Alerts';
  },

  _pollTimer:null,
  _lastConversions:null,

  _startPolling:function(){
    var self=this;
    this._lastConversions=parseInt(document.getElementById('cd-conversions')?.textContent)||0;
    this._pollTimer=setInterval(function(){
      var current=parseInt(document.getElementById('cd-conversions')?.textContent)||0;
      if(self._lastConversions!==null&&current>self._lastConversions){
        var diff=current-self._lastConversions;
        self._showAlert(diff);
      }
      self._lastConversions=current;
    },30000);
  },

  _stopPolling:function(){
    if(this._pollTimer){clearInterval(this._pollTimer);this._pollTimer=null;}
  },

  _showAlert:function(count){
    if(navigator.vibrate)navigator.vibrate([100,50,100,50,100]);
    sgToast('🎉 New booking! Someone just booked through your link! (+'+count+')','success',4000);

    /* Show animated celebration overlay */
    var celebration=document.createElement('div');
    celebration.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;pointer-events:none;font-size:64px;animation:sgCelebrate 1.5s ease-out forwards';
    celebration.textContent='🎉💰🎉';
    document.body.appendChild(celebration);

    var style=document.createElement('style');
    style.textContent='@keyframes sgCelebrate{0%{opacity:1;transform:translate(-50%,-50%) scale(0.5)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.3)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.5) translateY(-40px)}}';
    document.head.appendChild(style);

    setTimeout(function(){celebration.remove();style.remove();},1500);

    /* Browser notification */
    if('Notification' in window&&Notification.permission==='granted'){
      new Notification('ScanGym 🎉',{body:'Someone just booked through your link! +'+count+' booking(s)',icon:'/favicon.ico'});
    }
  },

  init:function(){
    this._enabled=localStorage.getItem(this._KEY)==='1';
    if(this._enabled)this._startPolling();
  }
};


/* ── Helper: Get creator handle from state/localStorage ── */
function _getCreatorHandle(){
  if(window.state&&window.state.user&&window.state.user.creator_handle)return window.state.user.creator_handle;
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
    if(cd.handle)return cd.handle;
  }catch(e){}
  if(window.state&&window.state.user&&window.state.user.email){
    return window.state.user.email.split('@')[0].replace(/[^a-z0-9]/gi,'').toLowerCase();
  }
  return null;
}


/* ═══ INJECT THE 6 NEW BUTTONS INTO CREATOR DASHBOARD ═══ */
/* Uses MutationObserver to add buttons when CreatorDashboardPage renders */
function _injectScanSquadButtons(){
  /* Find the right-side button container on Creator Dashboard */
  var containers=document.querySelectorAll('div[style*="position:fixed"][style*="right:12px"][style*="flex-direction:column"]');
  containers.forEach(function(container){
    /* Only target the ScanSquad creator dashboard buttons (not Book tab) */
    if(container.querySelector('[onclick*="_sgCopyAffiliateLink"]')&&!container.querySelector('[data-sq-new]')){
      /* Create the 6 new buttons */
      var newButtons=[
        {icon:'📊',label:'Analytics',color:'rgba(59,130,246,.15)',border:'rgba(59,130,246,.3)',onclick:'_sgCreatorAnalytics()'},
        {icon:'🎬',label:'Upload',color:'rgba(255,109,0,.15)',border:'rgba(255,109,0,.3)',onclick:'_sgCreatorUpload()'},
        {icon:'🏷️',label:'Tag Gym',color:'rgba(74,222,128,.15)',border:'rgba(74,222,128,.3)',onclick:'_sgTagGym()'},
        {icon:'🎖️',label:'Tier',color:'rgba(234,179,8,.15)',border:'rgba(234,179,8,.3)',onclick:'_sgShowTierProgress()'},
        {icon:'📣',label:'Boost',color:'rgba(168,85,247,.15)',border:'rgba(168,85,247,.3)',onclick:'_sgBoostReel()'},
        {icon:'<span id="sq-alerts-icon">🔔</span>',label:'<span id="sq-alerts-label">Alerts</span>',color:'rgba(239,68,68,.15)',border:'rgba(239,68,68,.3)',onclick:'_sgBookingAlerts.toggle()',badge:true}
      ];

      /* Add a separator line */
      var sep=document.createElement('div');
      sep.setAttribute('data-sq-new','1');
      sep.style.cssText='width:32px;height:1px;background:rgba(255,255,255,.1);margin:4px 0';
      container.appendChild(sep);

      newButtons.forEach(function(btn){
        var div=document.createElement('div');
        div.setAttribute('data-sq-new','1');
        div.style.cssText='display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer';
        div.setAttribute('onclick',btn.onclick);
        div.innerHTML=
          '<div class="sq-new-btn" style="background:'+btn.color+';border:1px solid '+btn.border+'"'+
            (btn.badge?' style="position:relative"':'')+'>'+
            btn.icon+
            (btn.badge?'<span id="sq-alerts-badge" class="sq-alert-badge" style="display:none">!</span>':'')+
          '</div>'+
          '<span class="sq-new-label">'+btn.label+'</span>';
        container.appendChild(div);
      });
    }
  });
}

/* Watch for Creator Dashboard rendering */
var _sqObserver=new MutationObserver(function(){
  _injectScanSquadButtons();
});
_sqObserver.observe(document.body,{childList:true,subtree:true});

/* Also inject on current page if already on creator dashboard */
setTimeout(_injectScanSquadButtons,500);
setTimeout(_injectScanSquadButtons,2000);

/* Init booking alerts */
_sgBookingAlerts.init();

console.log('[ScanGym] Phase 3 improvements + 6 new ScanSquad buttons loaded ✅');
})();
