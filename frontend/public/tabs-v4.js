/**
 * ScanGym Tabs Batch v4 — Trello board "1. Tabs" pending items
 *
 *  A) Right-side buttons → half-screen popup from bottom (Book / ScanSquad / Partner / Profile)
 *     Same UX as Reels: tap a right-rail button, content slides up in a half sheet
 *     instead of navigating away to a full page.
 *  B) Book tab speed — boot-time nearby prefetch that seeds the sg_gc_* session cache,
 *     so the first tap on Book renders instantly (cache-hit path in loadGyms).
 *  C) ScanSquad tab branding — same top-left brand header style as Reels/Book/Partner.
 *  D) Deep affiliate links — creators can link straight to a specific gym:
 *     scangym.com/r/{handle}?gym={placeId} (landing auto-forwards to that gym).
 *  E) Continue CTA orange button on the Profile tab (Partner already has one).
 */
(function(){
'use strict';

function curRoute(){
  // state is a top-level `let` in app.ctr576.js (not on window); the SPA keeps
  // the URL in sync via history.pushState, so pathname is the reliable source.
  try{if(typeof state!=='undefined'&&state&&state.route)return state.route;}catch(e){}
  return location.pathname||'';
}
function curUser(){
  try{if(typeof state!=='undefined'&&state)return state.user||null;}catch(e){}
  return null;
}

function injectStyle(id,css){
  if(document.getElementById(id))return;
  var s=document.createElement('style');s.id=id;s.textContent=css;document.head.appendChild(s);
}

/* ════════════════════════════════════════════════════════════════════
   A1) SHEET-EMBED MODE — when a page is loaded inside the half sheet
       (?sg_sheet=1) hide app chrome: tab bar, banners, right rails.
   ════════════════════════════════════════════════════════════════════ */
var IS_SHEET_EMBED=false;
try{IS_SHEET_EMBED=new URLSearchParams(location.search).get('sg_sheet')==='1';}catch(e){}
if(IS_SHEET_EMBED){
  document.documentElement.classList.add('sg-sheet-embed');
  injectStyle('sg-sheet-embed-style',
    '.sg-sheet-embed .sg-tab-bar,'+
    '.sg-sheet-embed #sg-continue-banner,'+
    '.sg-sheet-embed #sg-sps,'+
    '.sg-sheet-embed #sg-reels-persistent{display:none!important}'+
    '.sg-sheet-embed .sg-tab-content{bottom:0!important}'+
    '.sg-sheet-embed .sg-dashboard{bottom:0!important}'
  );
  // Links opened from inside the sheet that leave the SPA should escape the iframe
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[target="_blank"]');
    if(a)a.setAttribute('rel','noopener');
  },true);
}

/* ════════════════════════════════════════════════════════════════════
   A2) HALF-SCREEN PAGE SHEET — generic "open any route as a bottom
       popup" using the existing _sgOpenSheet system.
   ════════════════════════════════════════════════════════════════════ */
window._sgOpenPageSheet=function(path,title){
  if(typeof window._sgOpenSheet!=='function'){ // fallback: old behaviour
    if(typeof navigate==='function')navigate(path);
    return;
  }
  var sep=path.indexOf('?')>=0?'&':'?';
  var src=path+sep+'sg_sheet=1';
  var html=''
    +(title?'<p style="color:#fff;font-size:16px;font-weight:800;margin:0 0 8px 2px">'+title+'</p>':'')
    +'<div style="margin:0 -8px">'
    +'<iframe title="ScanGym content" src="'+src+'" style="display:block;width:100%;height:52vh;border:none;border-radius:14px;background:#0a0a16"></iframe>'
    +'</div>'
    +'<div onclick="_sgCloseSheet(\'sg-page-sheet\');navigate(\''+path+'\')" style="text-align:center;color:rgba(255,255,255,.45);font-size:12px;font-weight:600;padding:10px 0 2px;cursor:pointer">Open full page ↗</div>';
  window._sgOpenSheet('sg-page-sheet',html);
};

/* ════════════════════════════════════════════════════════════════════
   A3) REWIRE RIGHT-SIDE RAIL BUTTONS on Book / ScanSquad / Partner /
       Profile tabs: navigate('/x') → half-screen popup from bottom.
       Rails are the vertical TikTok-style button columns pinned to the
       right edge (style contains right:<n>px + flex-direction:column).
   ════════════════════════════════════════════════════════════════════ */
var RAIL_TAB_ROUTES=['/more','/partner','/creator','/explore']; // Profile, Partner, ScanSquad, Book
function _inRail(el){
  var p=el.parentElement;
  if(!p)return false;
  var st=p.getAttribute('style')||'';
  return /right:\s*(6|8|10|12|14|16)px/.test(st)&&/flex-direction:\s*column/.test(st);
}
function rewireRails(){
  if(IS_SHEET_EMBED)return; // never nest sheets inside sheets
  var route=curRoute();
  var tabOk=RAIL_TAB_ROUTES.some(function(r){return route===r||route.indexOf(r)===0;});
  // Profile tab can sit on a remembered sub-route (state._lastMoreRoute), so
  // also trust the active tab itself.
  try{if(!tabOk&&typeof state!=='undefined'&&state&&['more','partner','creator','book'].indexOf(state.activeTab)>=0)tabOk=true;}catch(e){}
  if(!tabOk&&route!=='/creator/')return;
  var els=document.querySelectorAll('div[onclick]');
  for(var i=0;i<els.length;i++){
    var el=els[i];
    if(el.__sgSheetWired)continue;
    var oc=el.getAttribute('onclick')||'';
    var m=oc.match(/^\s*navigate\('([^']+)'\)\s*$/);
    if(!m)continue;
    if(!_inRail(el))continue;
    var path=m[1];
    var lbl='';
    var sp=el.querySelector('span');
    if(sp)lbl=(sp.textContent||'').replace(/'/g,'');
    el.__sgSheetWired=true;
    el.setAttribute('onclick','_sgOpenPageSheet(\''+path+'\',\''+lbl+'\')');
  }
}
setInterval(rewireRails,700);

/* ════════════════════════════════════════════════════════════════════
   B) BOOK TAB SPEED — prefetch nearby gyms at boot idle, seed the
      sg_gc_* sessionStorage cache used by loadGyms (Perf #120 path).
      First tap on Book then renders instantly from cache while a
      background refresh keeps data current.
   ════════════════════════════════════════════════════════════════════ */
function prefetchNearby(){
  if(IS_SHEET_EMBED)return;
  try{
    var lat=null,lng=null;
    var d=window.sgLocation?window.sgLocation.cached():null;
    if(d){lat=d.lat;lng=d.lng;}
    if(typeof lat!=='number'||typeof lng!=='number')return;
    var k='sg_gc_'+Math.round(lat*1000)+','+Math.round(lng*1000);
    var ex=sessionStorage.getItem(k);
    if(ex){try{var p=JSON.parse(ex);if(Date.now()-p.t<600000)return;}catch(e){}}
    fetch('/api/live/nearby?lat='+lat+'&lng='+lng+'&radius=10000')
      .then(function(r){return r.json();})
      .then(function(data){
        if(data&&data.gyms&&data.gyms.length){
          try{sessionStorage.setItem(k,JSON.stringify({g:data.gyms,t:Date.now()}));}catch(e){}
          console.log('[TabsV4] Book prefetch: '+data.gyms.length+' gyms cached');
        }
      }).catch(function(){});
  }catch(e){}
}
function idle(fn,t){('requestIdleCallback' in window)?requestIdleCallback(fn,{timeout:t||4000}):setTimeout(fn,t||2500);}

/* ════════════════════════════════════════════════════════════════════
   C) SCANSQUAD TAB BRANDING — top-left brand header, identical layout
      to the Partner tab header (which mirrors Reels/Book), in ScanGym
      orange with the ScanSquad identity.
   ════════════════════════════════════════════════════════════════════ */
function injectSquadBranding(){
  if(IS_SHEET_EMBED)return;
  var route=curRoute();
  if(route!=='/creator'&&route!=='/creator/'){
    var old=document.getElementById('sg-squad-brand');
    if(old)old.remove();
    return;
  }
  if(document.getElementById('sg-squad-brand'))return;
  // Insert in-flow at the top of the first creator screen (above the greeting)
  var host=document.querySelector('.creator-screen');
  if(!host)return;
  var b=document.createElement('div');
  b.id='sg-squad-brand';
  b.style.cssText='display:flex;align-items:center;gap:8px;margin:0 0 12px;flex-shrink:0';
  b.innerHTML=''
    +'<div style="width:28px;height:28px;border-radius:50%;background:#FF6D00;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:#fff;flex-shrink:0">S</div>'
    +'<div>'
    +'<span style="font-size:15px;font-weight:800;color:#fff;letter-spacing:-.3px">ScanSquad</span>'
    +'<p style="color:rgba(255,255,255,.4);font-size:10px;margin:0">Share gyms \u00b7 Earn 25% commission</p>'
    +'</div>';
  host.insertBefore(b,host.firstChild);
}
setInterval(injectSquadBranding,600);

/* ════════════════════════════════════════════════════════════════════
   D) DEEP AFFILIATE LINKS — share a specific gym, not just the homepage.
      D1: on scangym.com/r/{handle}?gym={placeId}, auto-forward to that
          gym after the referral is captured (booking page in 1 tap).
      D2: the creator affiliate sheet gets a "Link a specific gym"
          search — picking a gym builds the deep link + copies it.
   ════════════════════════════════════════════════════════════════════ */
// D1: deep-link receiver
(function(){
  try{
    var params=new URLSearchParams(location.search);
    var gym=params.get('gym');
    if(gym&&location.pathname.indexOf('/r/')===0){
      setTimeout(function(){
        if(typeof navigate==='function')navigate('/gym/'+gym);
      },900);
    }
  }catch(e){}
})();

// D2: extend the affiliate sheet with a gym search
var _deepLinkTimer=null;
window._sgDeepLinkSearch=function(q,handle){
  clearTimeout(_deepLinkTimer);
  var box=document.getElementById('sg-dl-results');
  if(!box)return;
  if(!q||q.length<2){box.innerHTML='';return;}
  _deepLinkTimer=setTimeout(function(){
    /* /api/gyms/search never existed on the server: it returned index.html, r.json()
       threw and the .catch() below left this box blank forever. Use the live search. */
    fetch('/api/live/search?q='+encodeURIComponent(q)+'&limit=5')
      .then(function(r){
        if(!r.ok)throw new Error('search failed: '+r.status);
        return r.json();
      })
      .then(function(d){
        var list=(d&&(d.gyms||d.results)||[]).slice(0,5).map(function(g){
          return {place_id:g.placeId||g.place_id||g.id,name:g.name,address:g.address||g.vicinity||g.formatted_address};
        }).filter(function(g){return g.place_id;});
        if(!list.length){box.innerHTML='<p style="color:rgba(255,255,255,.35);font-size:12px;padding:8px 2px">No gyms found</p>';return;}
        box.innerHTML=list.map(function(g){
          var name=(g.name||'Gym').replace(/'/g,'');
          return '<div onclick="_sgCopyDeepLink(\''+g.place_id+'\',\''+handle+'\',\''+name+'\')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:12px;margin-top:6px;cursor:pointer">'
            +'<span style="font-size:16px">\uD83C\uDFCB\uFE0F</span>'
            +'<div style="flex:1;min-width:0"><p style="color:#fff;font-size:13px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+name+'</p>'
            +'<p style="color:rgba(255,255,255,.3);font-size:10px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(g.address||g.vicinity||'')+'</p></div>'
            +'<span style="color:#FF6D00;font-size:11px;font-weight:700;flex-shrink:0">Copy link</span></div>';
        }).join('');
      }).catch(function(e){
        console.error('[tabs-v4] deep-link gym search failed',e);
        box.innerHTML='<p style="color:rgba(255,255,255,.45);font-size:12px;padding:8px 2px">Couldn\'t search right now — please try again.</p>';
      });
  },350);
};
window._sgCopyDeepLink=function(placeId,handle,name){
  var link='https://scangym.com/r/'+handle+'?gym='+placeId;
  var done=function(){
    if(window.sgToast)sgToast('\uD83D\uDD17 Deep link for '+name+' copied!','success',2500);
    var box=document.getElementById('sg-dl-results');
    if(box)box.innerHTML='<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.25);border-radius:12px;padding:10px 12px;margin-top:6px"><p style="color:#22c55e;font-size:12px;font-weight:700;margin:0">\u2705 Copied — sends fans straight to '+name+'</p><p style="color:rgba(255,255,255,.4);font-size:11px;margin:4px 0 0;word-break:break-all">'+link+'</p></div>';
  };
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(link).then(done).catch(done);}
  else{try{var t=document.createElement('textarea');t.value=link;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();}catch(e){}done();}
  if(navigator.share){try{navigator.share({title:'Train at '+name,text:'Book '+name+' on ScanGym — day passes, no membership',url:link}).catch(function(){});}catch(e){}}
};
function injectDeepLinkSection(){
  var sheet=document.getElementById('sg-affiliate-sheet');
  if(!sheet||document.getElementById('sg-dl-section'))return;
  var handle='';
  var m=(sheet.textContent||'').match(/scangym\.com\/r\/([a-z0-9_-]+)/i);
  if(m)handle=m[1];
  if(!handle)return;
  var wrap=sheet.querySelector('div[style*="padding"]')||sheet;
  var sec=document.createElement('div');
  sec.id='sg-dl-section';
  sec.innerHTML=''
    +'<div style="border-top:1px solid rgba(255,255,255,.08);margin-top:14px;padding-top:14px">'
    +'<p style="color:#fff;font-size:13px;font-weight:700;margin:0 0 2px">\uD83C\uDFAF Link a specific gym</p>'
    +'<p style="color:rgba(255,255,255,.4);font-size:11px;margin:0 0 8px">Deep links convert better — fans land straight on the gym\u2019s booking page</p>'
    +'<input id="sg-dl-input" placeholder="Search a gym to link\u2026" oninput="_sgDeepLinkSearch(this.value,\''+handle+'\')" style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:11px 14px;color:#fff;font-size:14px;outline:none;box-sizing:border-box">'
    +'<div id="sg-dl-results"></div>'
    +'</div>';
  wrap.appendChild(sec);
}
setInterval(injectDeepLinkSection,600);

/* ════════════════════════════════════════════════════════════════════
   E) PROFILE TAB CONTINUE CTA — orange button above the tab bar,
      same design language as the Partner tab continue banner.
   ════════════════════════════════════════════════════════════════════ */
window._profileContinueFlow=function(){
  var u=curUser();
  if(!u){
    if(typeof window._sgShowAuthSheet==='function')window._sgShowAuthSheet('book');
    else if(typeof navigate==='function')navigate('/login');
    return;
  }
  if(typeof switchTab==='function')switchTab('book');
};
function injectProfileCTA(){
  if(IS_SHEET_EMBED)return;
  if(!window.sgBottomBar)return;
  var route=curRoute();
  var isProfile=(route==='/more'||route==='/more/'||route==='/more/profile');
  try{if(!isProfile&&typeof state!=='undefined'&&state&&state.activeTab==='more')isProfile=true;}catch(e){}
  /* ONE BAR: this used to append its own fixed #profile-continue-banner at
   * bottom:56px;z-index:var(--sg-z-bottom-bar,8999) (a second orange bar, with its own body.sg-profile-cta
   * spacing rule). It now borrows the single shared bar, which already reserves
   * space via body.sg-cb-active. */
  if(!isProfile){window.sgBottomBar.hide('profile');return;}
  var u=curUser();
  window.sgBottomBar.show('profile',{
    label:u?'Book a Gym':'Continue',
    sub:u?'Your QR pass is ready after booking':'Sign in to unlock your QR pass',
    arrow:'\u2192',
    onClick:function(){window._profileContinueFlow();}
  });
}
setInterval(injectProfileCTA,400);

/* ════════════════════════════════════════════════ boot ═══ */
function init(){
  idle(prefetchNearby,3000);
  console.log('[TabsV4] rails\u2192sheets, book prefetch, squad branding, deep links, profile CTA'+(IS_SHEET_EMBED?' (sheet-embed mode)':''));
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{setTimeout(init,400);}
})();
