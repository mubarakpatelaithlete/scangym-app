/* ═══ ScanGym Phase 2 Improvements ═══
 * Covers: Speed, Ease of Use, UI, UX, Graphics, Mobile, User-Friendliness
 * Non-destructive patches — enhances existing behavior, never removes features.
 */
(function(){
'use strict';

/* ── 1. SPEED: Lazy-load images with IntersectionObserver ── */
/* Upgrade all future img[loading=lazy] to use native IO for better perf */
if('IntersectionObserver' in window){
  var _imgObserver=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){
        var img=e.target;
        if(img.dataset.src){
          img.src=img.dataset.src;
          img.removeAttribute('data-src');
        }
        _imgObserver.unobserve(img);
      }
    });
  },{rootMargin:'200px'});

  /* Observe images added dynamically */
  var _mo=new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(node){
        if(node.nodeType===1){
          if(node.tagName==='IMG'&&node.dataset.src)_imgObserver.observe(node);
          var imgs=node.querySelectorAll?node.querySelectorAll('img[data-src]'):[];
          imgs.forEach(function(i){_imgObserver.observe(i);});
        }
      });
    });
  });
  _mo.observe(document.body,{childList:true,subtree:true});
}

/* ── 1b. SPEED: Preconnect to critical third-party origins ── */
['https://cdn.scangym.com','https://lh3.googleusercontent.com','https://places.googleapis.com'].forEach(function(origin){
  if(!document.querySelector('link[rel=preconnect][href="'+origin+'"]')){
    var l=document.createElement('link');
    l.rel='preconnect';l.href=origin;l.crossOrigin='anonymous';
    document.head.appendChild(l);
  }
});

/* ── 1c. SPEED: Abort stale fetch requests on tab switch ── */
/* When user switches tabs rapidly, abort pending gym-search fetches to free bandwidth */
var _activeSearchController=null;
var _origFetch=window.fetch;
window.fetch=function(url,opts){
  /* live search endpoints (/api/gyms/* never existed on the server) */
  if(typeof url==='string'&&(url.includes('/api/live/search')||url.includes('/api/live/nearby'))){
    if(_activeSearchController){try{_activeSearchController.abort();}catch(e){}}
    _activeSearchController=new AbortController();
    opts=opts||{};
    opts.signal=_activeSearchController.signal;
  }
  return _origFetch.call(this,url,opts);
};


/* ── 2. EASE OF USE: Recently viewed gyms ── */
window._sgRecentGyms={
  _KEY:'sg_recent_gyms',
  _MAX:10,
  add:function(gym){
    if(!gym||!gym.id)return;
    var list=this.get();
    list=list.filter(function(g){return g.id!==gym.id;});
    list.unshift({
      id:gym.id,
      name:gym.name||gym.displayName||'Gym',
      photo:gym.photo||gym.photo_url||'',
      rating:gym.rating||0,
      addr:gym.vicinity||gym.address||'',
      ts:Date.now()
    });
    if(list.length>this._MAX)list=list.slice(0,this._MAX);
    try{localStorage.setItem(this._KEY,JSON.stringify(list));}catch(e){}
  },
  get:function(){
    try{return JSON.parse(localStorage.getItem(this._KEY)||'[]');}catch(e){return [];}
  },
  clear:function(){
    try{localStorage.removeItem(this._KEY);}catch(e){}
  }
};

/* Hook into openGym to track recently viewed */
var _origOpenGym=window.openGym;
if(typeof _origOpenGym==='function'){
  window.openGym=function(id,isPlace){
    /* Find gym data from current state */
    if(window.state&&window.state.gyms){
      var g=window.state.gyms.find(function(gym){return gym.id===id||gym.place_id===id;});
      if(g)window._sgRecentGyms.add(g);
    }
    return _origOpenGym.apply(this,arguments);
  };
}


/* ── 3. UI: Smooth page transitions ── */
/* Add fade transition when switching between tabs */
var _origSwitchTab=window.switchTab;
if(typeof _origSwitchTab==='function'){
  window.switchTab=function(tab){
    var content=document.querySelector('.sg-tab-content');
    if(content){
      content.style.transition='opacity 0.15s ease';
      content.style.opacity='0.7';
      setTimeout(function(){
        _origSwitchTab.call(window,tab);
        requestAnimationFrame(function(){
          content.style.opacity='1';
        });
      },80);
    }else{
      _origSwitchTab.call(window,tab);
    }
  };
}


/* ── 4. UX: Enhanced haptic feedback for all interactive elements ── */
function sgHaptic(pattern){
  if(navigator.vibrate){
    navigator.vibrate(pattern||[10]);
  }
}

/* Add subtle haptic on tab bar taps */
document.addEventListener('click',function(e){
  var tabItem=e.target.closest('.sg-tab-item');
  if(tabItem)sgHaptic([15]);

  var btn=e.target.closest('button,.gym-book-btn,.tt-cta-btn,.sg-more-item');
  if(btn)sgHaptic([8]);
},true);


/* ── 4b. UX: Pull-to-refresh on gym list (Book tab) ── */
(function(){
  var _pullStart=0,_pulling=false,_pullIndicator=null;

  function _createPullIndicator(){
    if(_pullIndicator)return _pullIndicator;
    _pullIndicator=document.createElement('div');
    _pullIndicator.id='sg-pull-refresh';
    _pullIndicator.style.cssText='position:fixed;top:-50px;left:50%;transform:translateX(-50%);width:40px;height:40px;border-radius:50%;background:rgba(255,109,0,.15);border:2px solid #FF6D00;display:flex;align-items:center;justify-content:center;z-index:var(--sg-z-overlay,10000);transition:top 0.2s ease;font-size:18px;';
    _pullIndicator.textContent='↻';
    document.body.appendChild(_pullIndicator);
    return _pullIndicator;
  }

  document.addEventListener('touchstart',function(e){
    var content=document.querySelector('.sg-tab-content');
    var activeTab=document.querySelector('.sg-tab-item.active .sg-tab-label');
    if(!activeTab||activeTab.textContent.trim().toLowerCase()!=='book')return;
    if(content&&content.scrollTop<=0){
      _pullStart=e.touches[0].clientY;
      _pulling=true;
    }
  },{passive:true});

  document.addEventListener('touchmove',function(e){
    if(!_pulling)return;
    var dy=e.touches[0].clientY-_pullStart;
    if(dy>0&&dy<120){
      var ind=_createPullIndicator();
      ind.style.top=Math.min(dy-30,60)+'px';
      ind.style.opacity=Math.min(dy/80,1);
      ind.style.transform='translateX(-50%) rotate('+dy*3+'deg)';
    }
  },{passive:true});

  document.addEventListener('touchend',function(){
    if(!_pulling)return;
    _pulling=false;
    if(_pullIndicator){
      var top=parseInt(_pullIndicator.style.top);
      if(top>40){
        /* Trigger refresh */
        _pullIndicator.style.top='20px';
        _pullIndicator.textContent='⟳';
        _pullIndicator.style.animation='spin 0.8s linear infinite';
        sgHaptic([30,20,30]);
        /* Re-render current view */
        if(typeof render==='function'){
          render();
        }
        setTimeout(function(){
          if(_pullIndicator){
            _pullIndicator.style.top='-50px';
            _pullIndicator.style.animation='';
            _pullIndicator.textContent='↻';
          }
        },1200);
      }else{
        _pullIndicator.style.top='-50px';
      }
    }
  },{passive:true});
})();


/* ── 5. GRAPHICS: Better skeleton loading with gradient shimmer ── */
(function(){
  var style=document.createElement('style');
  style.textContent=
    /* Enhanced skeleton shimmer — Apple-style gradient */
    '.skel-card,.skeleton{background:linear-gradient(90deg,rgba(30,41,59,.8) 0%,rgba(51,65,85,.6) 40%,rgba(30,41,59,.8) 80%)!important;background-size:300% 100%!important;animation:sgShimmer 1.8s ease-in-out infinite!important;border-radius:14px}'+
    '@keyframes sgShimmer{0%{background-position:300% 0}100%{background-position:-100% 0}}'+

    /* Improved empty state */
    '.sg-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;gap:12px}'+
    '.sg-empty-state-icon{font-size:48px;opacity:.6;animation:sgFloat 3s ease-in-out infinite}'+
    '@keyframes sgFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}'+
    '.sg-empty-state-title{color:#fff;font-size:18px;font-weight:700}'+
    '.sg-empty-state-desc{color:rgba(255,255,255,.4);font-size:13px;line-height:1.6;max-width:280px}'+

    /* Improved gym card image gradient overlay */
    '.tt-gradient{background:linear-gradient(to bottom,rgba(0,0,0,.4) 0%,transparent 20%,transparent 50%,rgba(0,0,0,.35) 65%,rgba(0,0,0,.75) 85%,rgba(0,0,0,.92) 100%)!important}'+

    /* Better focus outlines for accessibility */
    '*:focus-visible{outline:2px solid #FF6D00;outline-offset:2px;border-radius:4px}'+

    /* Smooth image loading */
    'img{transition:opacity 0.3s ease}'+
    'img[data-src]{opacity:0}'+
    'img.sg-loaded{opacity:1}'+

    /* Better button press states */
    '.gym-book-btn:active,.tt-cta-btn:active,.sg-filter-pill:active{transform:scale(0.95)!important;transition:transform 0.08s!important}'+

    /* Card hover/press micro-interaction */
    '.gym-card{transition:transform 0.2s cubic-bezier(0.4,0,0.2,1),box-shadow 0.2s!important}'+
    '.gym-card:active{transform:scale(0.98)!important}'+

    /* Smooth overlay entry */
    '.gym-overlay-panel{transition:transform 0.3s cubic-bezier(0.32,0.72,0,1)!important}'+

    /* Improved toast styling */
    '#sg-toast-container .sg-toast{backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08)}';

  document.head.appendChild(style);
})();


/* ── 6. MOBILE: Enhanced touch handling ── */
/* Ensure minimum 44px touch targets (WCAG 2.5.5) */
(function(){
  var style=document.createElement('style');
  style.textContent=
    /* Minimum touch target sizes */
    '.sg-tab-item{min-width:44px;min-height:44px}'+
    '.sg-more-item{min-height:48px}'+
    '.tt-action-btn{min-width:44px;min-height:44px}'+
    '.sg-filter-pill{min-height:36px;padding:8px 16px!important}'+
    'button{min-height:36px}'+

    /* Prevent text selection on interactive elements */
    '.sg-tab-item,.sg-more-item,.tt-action,.gym-card,.tt-cta-btn,.gym-book-btn{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}'+

    /* Prevent zoom on input focus (iOS) */
    'input,select,textarea{font-size:16px!important}'+

    /* Better scroll momentum */
    '.sg-tab-content,.gym-overlay-body,.sg-checkout-sheet-body{-webkit-overflow-scrolling:touch;scroll-behavior:smooth}'+

    /* Prevent horizontal overflow on mobile */
    'body,#app{overflow-x:hidden;max-width:100vw}'+

    /* Safe area padding for notched devices */
    '.sg-tab-bar{padding-bottom:max(env(safe-area-inset-bottom,0px),4px)!important}';

  document.head.appendChild(style);
})();


/* ── 7. USER FRIENDLY: Offline detection banner ── */
(function(){
  var _offlineBanner=null;

  function _showOffline(){
    if(_offlineBanner)return;
    _offlineBanner=document.createElement('div');
    _offlineBanner.id='sg-offline-banner';
    _offlineBanner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:var(--sg-z-toast,11000);background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-align:center;padding:10px 16px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;animation:slideDown 0.3s ease;';
    _offlineBanner.innerHTML='<span style="font-size:16px">📡</span> You\'re offline — some features may be limited <span onclick="location.reload()" style="margin-left:8px;background:rgba(255,255,255,.2);padding:4px 12px;border-radius:8px;cursor:pointer;font-size:12px">Retry</span>';
    document.body.appendChild(_offlineBanner);

    /* Push content down */
    var tabContent=document.querySelector('.sg-tab-content');
    if(tabContent)tabContent.style.paddingTop='44px';
  }

  function _hideOffline(){
    if(!_offlineBanner)return;
    _offlineBanner.style.animation='slideUp 0.3s ease forwards';
    setTimeout(function(){
      if(_offlineBanner){_offlineBanner.remove();_offlineBanner=null;}
      var tabContent=document.querySelector('.sg-tab-content');
      if(tabContent)tabContent.style.paddingTop='';
    },300);
  }

  window.addEventListener('offline',_showOffline);
  window.addEventListener('online',_hideOffline);

  /* Check on load */
  if(!navigator.onLine)_showOffline();
})();


/* ── 7b. USER FRIENDLY: Better loading states ── */
/* Show spinner on fetch-heavy actions */
window._sgLoadingOverlay={
  _el:null,
  show:function(msg){
    if(this._el)return;
    this._el=document.createElement('div');
    this._el.style.cssText='position:fixed;inset:0;z-index:var(--sg-z-overlay,10000);background:rgba(8,8,18,.6);backdrop-filter:blur(4px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;animation:fadeIn 0.2s ease';
    this._el.innerHTML='<div class="sg-spinner" style="width:32px;height:32px;border-width:3px"></div><span style="color:rgba(255,255,255,.7);font-size:14px;font-weight:600">'+(msg||'Loading...')+'</span>';
    document.body.appendChild(this._el);
  },
  hide:function(){
    if(!this._el)return;
    this._el.style.opacity='0';
    this._el.style.transition='opacity 0.2s';
    var el=this._el;
    this._el=null;
    setTimeout(function(){el.remove();},200);
  }
};


/* ── 7c. USER FRIENDLY: Confirm destructive actions ── */
window._sgConfirm=function(msg,onYes,onNo){
  var overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:var(--sg-z-overlay,10000);background:rgba(0,0,0,.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;padding:24px';
  overlay.innerHTML=
    '<div style="background:rgba(20,22,36,.98);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:28px 24px;max-width:320px;width:100%;text-align:center">'+
      '<p style="color:#fff;font-size:16px;font-weight:700;margin-bottom:6px">'+msg+'</p>'+
      '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:24px">This action cannot be undone.</p>'+
      '<div style="display:flex;gap:10px">'+
        '<button id="sg-confirm-no" style="flex:1;padding:12px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.7);font-size:14px;font-weight:600;cursor:pointer">Cancel</button>'+
        '<button id="sg-confirm-yes" style="flex:1;padding:12px;border-radius:12px;background:#FF6D00;border:none;color:#fff;font-size:14px;font-weight:700;cursor:pointer">Confirm</button>'+
      '</div>'+
    '</div>';

  document.body.appendChild(overlay);
  overlay.querySelector('#sg-confirm-yes').onclick=function(){overlay.remove();if(onYes)onYes();};
  overlay.querySelector('#sg-confirm-no').onclick=function(){overlay.remove();if(onNo)onNo();};
  overlay.addEventListener('click',function(e){if(e.target===overlay){overlay.remove();if(onNo)onNo();}});
};


/* 7d. Network-aware error messages: folded into the one sgToast() in
   app.ctr576.js — this file no longer re-defines it. */


/* ── 3b. UI: Scrollbar-free horizontal scroll indicators ── */
/* Add edge fade gradients on horizontally scrollable containers */
(function(){
  var style=document.createElement('style');
  style.textContent=
    '.sg-hscroll-wrap{position:relative}'+
    '.sg-hscroll-wrap::after{content:"";position:absolute;top:0;right:0;bottom:0;width:32px;background:linear-gradient(to right,transparent,var(--sg-bg,#080812));pointer-events:none;opacity:0;transition:opacity 0.3s}'+
    '.sg-hscroll-wrap.has-overflow::after{opacity:1}';
  document.head.appendChild(style);
})();


/* ── 2b. EASE OF USE: Keyboard shortcut hints ── */
/* Desktop users: Escape to close overlays, / to search */
document.addEventListener('keydown',function(e){
  /* Escape closes any open overlay */
  if(e.key==='Escape'){
    var overlay=document.querySelector('.gym-overlay.open,.gym-pay-sheet.open,.sg-checkout-sheet.open,.sg-auth-overlay.open');
    if(overlay){
      var closeBtn=overlay.querySelector('.gym-overlay-close,[onclick*="close"]');
      if(closeBtn)closeBtn.click();
      e.preventDefault();
    }
    /* Close search overlay */
    var searchOv=document.getElementById('sg-search-overlay');
    if(searchOv&&searchOv.style.display!=='none'){
      searchOv.style.display='none';
      e.preventDefault();
    }
  }

  /* / key opens search (when not in input) */
  if(e.key==='/'&&!e.target.closest('input,textarea,select,[contenteditable]')){
    var searchTrigger=document.querySelector('.tt-search-input');
    if(searchTrigger){searchTrigger.click();e.preventDefault();}
  }
});


/* ── PERFORMANCE: Report Web Vitals to console (dev aid) ── */
if(window.PerformanceObserver){
  try{
    /* LCP */
    new PerformanceObserver(function(list){
      var entries=list.getEntries();
      var last=entries[entries.length-1];
      if(last)console.log('[ScanGym Perf] LCP:',Math.round(last.startTime)+'ms');
    }).observe({type:'largest-contentful-paint',buffered:true});

    /* CLS */
    var _cls=0;
    new PerformanceObserver(function(list){
      list.getEntries().forEach(function(e){if(!e.hadRecentInput)_cls+=e.value;});
      console.log('[ScanGym Perf] CLS:',_cls.toFixed(3));
    }).observe({type:'layout-shift',buffered:true});

    /* FID / INP */
    new PerformanceObserver(function(list){
      list.getEntries().forEach(function(e){
        if(e.duration>100)console.warn('[ScanGym Perf] Slow interaction:',e.name,Math.round(e.duration)+'ms');
      });
    }).observe({type:'event',buffered:true,durationThreshold:100});
  }catch(e){}
}

console.log('[ScanGym] Phase 2 improvements loaded ✅');
})();
