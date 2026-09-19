/* ═══════════════════════════════════════════════════════════════════════════
   sg-rail-ui.js — the tab / rail / gym-card UI enhancers, in ONE file with ONE tick.

   Merged 2026-09-14 (PR 2) from three more patch files, kept in load order:
     app-patches-v3.js (once)          USP strip under the tab content
     tabs-v4.js  (700/600/600/400ms)   rails→half sheets, Book prefetch, Squad brand, deep links, Profile CTA
     round2.js   (400/1000/700ms)      Squad Ask-AI bar, payout-method hydrate, Squad/Partner branding
   and earlier (PR 1) from four patch files that each ran their own setInterval:
     round3.js     (400ms)  Reels right rail: Music / Photos / Chat / Trainer
     ui-polish.js  (600ms)  Line icons on the rails, "More" collapse, card declutter
     round4-ui.js  (600ms)  Logo square removal, booking summary bar, Book-tap spinner
     round5-ui.js  (600ms)  Rail labels, duplicate-button merges, clearer labels
   Behaviour is unchanged; the code of each module is byte-for-byte the original
   body. Only the wrappers changed: each module now returns its tick() and the
   shared scheduler below runs all ticks together every 600ms instead of
   eleven independent timers (~20 ticks/s → ~1.7 ticks/s).
   Module order == the original load order, so CSS overrides still cascade the
   same way (round4 overrides ui-polish's "More" colour, etc.).

   Next step (PATCH-CHAIN-REMOVAL-PLAN.md phase 4): fold each enhancer into the
   template that draws the element, then delete this file.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ─────────────── app-patches-v3.js ─────────────── */
var uspStrip=(function(){
'use strict';
/**
 * ScanGym App Patches v3 — USP strip.
 *
 * What is left of this file: the one-line trust strip under the tab bar
 * ("No membership needed · Instant QR · Free cancel").
 *
 * What used to be here, and why it is gone:
 *
 *  - #62 live visitor counter: the poller called /api/stats/live-visitors, which
 *    has never existed on the server. Removed earlier; the strip it lived in is
 *    kept because the static copy is the part that was doing the work.
 *
 *  - #75/#76 AI Trainer tab: injected a DOM tab that bypassed SPA routing.
 *    Replaced by the native TrainerTabPage in app.ctr576.js.
 *
 *  - #98/#99/#100 owner quick controls: injected a panel into
 *    `#sg-owner-controls` / `[class*="owner-controls"]` and called
 *    `PUT /api/gym-mgmt/:id/quick-toggle` and `/quick-price`. None of those four
 *    things exist — not the element, not either route. So the panel could never
 *    appear and the buttons could only ever 404. The cost of keeping it was not
 *    zero: it ran a MutationObserver over document.body with subtree:true for
 *    every visitor on every page, for the entire session, waiting for an element
 *    that is never created. Deleted. tests/no-dead-patches.test.js keeps it out.
 *    (If gym owners do want a quick open/closed + price control, the working
 *    version already exists: the Partner tab toggle in batch2.js, which posts to
 *    the real PATCH /api/gym-partner/toggle-active.)
 */
function injectStyle(id,css){if(document.getElementById(id))return;var s=document.createElement('style');s.id=id;s.textContent=css;document.head.appendChild(s);}

function initUspStrip(){
  injectStyle('sg-sps-s','#sg-sps{position:relative;z-index:100;background:rgba(255,109,0,.08);border-bottom:1px solid rgba(255,109,0,.15);padding:6px 16px;display:flex;align-items:center;gap:8px;font-size:11px;color:rgba(255,255,255,.7);font-weight:600}');
  setTimeout(function(){var bc=document.querySelector('.sg-tab-content');if(!bc||document.getElementById('sg-sps'))return;var s=document.createElement('div');s.id='sg-sps';s.innerHTML='\u{1F525} <span id="sg-lvt">No membership needed</span> \u00b7 \u26A1 Instant QR \u00b7 \u2705 Free cancel';bc.insertBefore(s,bc.firstChild);},3000);
}

var _done=false;
function tick(){if(_done)return;_done=true;initUspStrip();}
return tick;
})();

/* ─────────────── tabs-v4.js ─────────────── */
var tabsV4=(function(){
'use strict';
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
    var raw=localStorage.getItem('sg_gps')||localStorage.getItem('sg_location_cache');
    if(raw){var d=JSON.parse(raw);lat=d.lat;lng=d.lng;}
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

/* ════════════════════════════════════════════════ boot ═══ */
function init(){
  idle(prefetchNearby,3000);
  console.log('[TabsV4] rails\u2192sheets, book prefetch, squad branding, deep links, profile CTA'+(IS_SHEET_EMBED?' (sheet-embed mode)':''));
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{setTimeout(init,400);}
function tick(){
  try{rewireRails();}catch(e){}
  try{injectSquadBranding();}catch(e){}
  try{injectDeepLinkSection();}catch(e){}
  try{injectProfileCTA();}catch(e){}
}
return tick;
})();

/* ─────────────── round2.js ─────────────── */
var squadPartnerPolish=(function(){
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   ScanGym Round 2 — Tabs board polish (ScanSquad + Partner)
   1) Partner branding — remove the stray orange circle that overlaps the
      "Partner Dashboard" pill (the pill already carries the 🟠 brand mark).
   2) ScanSquad branding — brand header styled as a proper pill (same look
      as the Partner header) and kept clear of the temporary USP banner.
   3) ScanSquad brand colours — the purple Copy/Share buttons become
      ScanGym orange.
   4) Share = deep affiliate link — the ScanSquad Share button shares the
      creator's affiliate link via the native share sheet.
   5) Continue CTA on ScanSquad — the orange full-width Continue bar
      (like Reels/Book/Partner) is re-enabled on the /creator tab.
   6) Withdraw flow fixes:
      - "Add / Change Withdraw Method" buttons open the proper method sheet
        (Stripe / PayPal / UK bank) instead of a broken Stripe-only call.
      - Saved methods are persisted server-side (survives new devices).
      - "Withdraw to Bank" works without Stripe Connect via a pending
        payout request (bank transfer fallback), and creator withdrawals
        send the right fields.
      - 💸 rail button on ScanSquad opens the wallet sheet in place
        instead of navigating away.
   Purely additive patch file — loaded after app.ctr576.js + continue-cta-flow.js.
   ═══════════════════════════════════════════════════════════════════════════ */

function route(){return (window.state&&state.route)||location.pathname;}
function onCreator(){var r=route();return r==='/creator'||r==='/creator/';}
function onPartner(){var r=route();return r==='/partner'||r==='/partner/';}
function creatorHandle(){
  try{
    var cd=JSON.parse(localStorage.getItem('sg_creator')||'null')||{};
    if(cd.handle||cd.slug)return cd.handle||cd.slug;
  }catch(e){}
  var u=window.state&&state.user;
  return (u&&u.referral_code)||'';
}

/* ════════════════════════════════════════════════════════════════════
   1) PARTNER BRANDING — remove the floating 28px orange circle that
      overlaps the "Partner Dashboard" pill top-left.
   ════════════════════════════════════════════════════════════════════ */
function fixPartnerBranding(){
  if(!onPartner())return;
  /* Branding = just the orange circle top-left (same as Reels + Book).
     Remove the "Partner Dashboard" pill that was hiding/duplicating it. */
  document.querySelectorAll('span').forEach(function(sp){
    if(sp.textContent==='Partner Dashboard'&&!sp.dataset.sgR2){
      sp.dataset.sgR2='1';
      var pill=sp.parentElement;
      var topbar=pill&&pill.parentElement;
      if(topbar)topbar.style.display='none';
      else if(pill)pill.style.display='none';
    }
  });
  /* the Book-tab social-proof strip (#sg-sps) doesn't belong on the
     partner dashboard and stays stuck on "Loading..." there — hide it */
  var sps=document.getElementById('sg-sps');
  if(sps)sps.style.display='none';
}

/* ════════════════════════════════════════════════════════════════════
   2) SCANSQUAD BRANDING — restyle the injected brand header into the
      same dark pill used on the Partner tab, and keep it visible when
      the temporary USP banner is on screen.
   ════════════════════════════════════════════════════════════════════ */
function fixSquadBranding(){
  if(!onCreator())return;
  /* Branding = just the orange circle top-left, exactly like Reels + Book. */
  var b=document.getElementById('sg-squad-brand');
  if(b&&!b.dataset.sgR2){
    b.dataset.sgR2='1';
    b.style.cssText='margin:0 0 14px;padding:0;flex-shrink:0';
    b.innerHTML='<div style="width:28px;height:28px;background:#FF6D00;border-radius:50%;opacity:.85;box-shadow:0 0 10px rgba(255,109,0,.5);display:flex;align-items:center;justify-content:center;font:900 15px/1 system-ui,-apple-system,sans-serif;color:#fff;">S</div>';
  }
  /* the Book-tab social-proof strip doesn't belong here either */
  var sps=document.getElementById('sg-sps');
  if(sps)sps.style.display='none';
}

/* ════════════════════════════════════════════════════════════════════
   3) SCANSQUAD ORANGE — purple (#a855f7) Copy / Share buttons become
      ScanGym brand orange.
   ════════════════════════════════════════════════════════════════════ */
function fixSquadColors(){
  if(!onCreator())return;
  document.querySelectorAll('button').forEach(function(btn){
    if(btn.dataset.sgR2Orange)return;
    var s=btn.getAttribute('style')||'';
    if(s.indexOf('#a855f7')>-1||s.indexOf('#7c3aed')>-1){
      btn.dataset.sgR2Orange='1';
      btn.style.background='linear-gradient(135deg,#FF6D00,#E66200)';
      btn.style.boxShadow='0 2px 12px rgba(255,109,0,.3)';
    }
  });
}

/* ════════════════════════════════════════════════════════════════════
   4) SHARE = DEEP AFFILIATE LINK — the ScanSquad Share button shares
      scangym.com/r/{handle} through the native share sheet.
   ════════════════════════════════════════════════════════════════════ */
function fixSquadShare(){
  if(!onCreator())return;
  document.querySelectorAll('button').forEach(function(btn){
    if(btn.dataset.sgR2Share)return;
    var txt=(btn.textContent||'').trim();
    if(txt.indexOf('Share')===-1||txt.length>12)return;
    var oc=btn.getAttribute('onclick')||'';
    if(oc.indexOf('navigator.share')===-1&&oc.indexOf('Share')===-1&&oc.indexOf('share')===-1)return;
    btn.dataset.sgR2Share='1';
    btn.removeAttribute('onclick');
    btn.addEventListener('click',function(ev){
      ev.stopPropagation();
      var h=creatorHandle();
      if(h&&typeof window._sgShareAffiliate==='function'){window._sgShareAffiliate(h);}
      else if(h){
        var link='https://scangym.com/r/'+h;
        if(navigator.share){navigator.share({title:'ScanGym',text:'Gym passes from \u00a34.49 \u2014 use my link:',url:link}).catch(function(){});}
        else{navigator.clipboard.writeText(link);if(typeof sgToast==='function')sgToast('Affiliate link copied!','success',2000);}
      }else if(typeof sgToast==='function'){sgToast('Sign in to get your affiliate link','info',2500);}
    });
  });
}

/* ONE BAR: the ScanSquad/creator tab used to re-inject its own #creator-continue-banner
   here every 400ms, and a second timer restyled it (and #partner-continue-banner) to look
   like the core bar. Both elements are gone: there is one shared bottom bar
   (window.sgBottomBar, owned by app.js) which is already the slim full-width style.
   The ScanSquad Ask AI bar itself is kept — it now renders into that shared bar. */
function squadContinueBar(){
  if(typeof window._injectContinueBanner!=='function'||!window.sgBottomBar)return;
  if(onCreator())window._injectContinueBanner('creator');
  else if(window.sgBottomBar.owner()==='creator')window.sgBottomBar.hide('creator');
}

/* Partner tab: moved here from continue-cta-flow.js, which used to poll state.route
   every 300ms on its own timer. Same logic: inject on entering /partner, remove on
   leaving. (/partner maps to activeTab='more', so the route is what to check.) */
var _lastPartnerRoute='';
function partnerContinueBanner(){
  if(typeof window._injectContinueBanner!=='function'||typeof window._removeContinueBanner!=='function')return;
  var r=route();
  if(r===_lastPartnerRoute)return;
  _lastPartnerRoute=r;
  if(onPartner())window._injectContinueBanner('partner');
  else window._removeContinueBanner('partner');
}

/* ════════════════════════════════════════════════════════════════════
   6) WITHDRAW FLOW FIXES
   ════════════════════════════════════════════════════════════════════ */

/* Hydrate the saved payout method from the server on login (new-device
   support). The withdraw UI itself lives only in wallet-withdraw.js. */
var _hydrated=false;
function hydratePayoutMethod(){
  if(_hydrated||!(window.state&&state.user))return;
  _hydrated=true;
  fetch('/api/gym-partner/payout-method',{credentials:'include'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      if(!d||!d.method)return;
      try{
        var cd=JSON.parse(localStorage.getItem('sg_creator')||'{}');
        var pd=JSON.parse(localStorage.getItem('sg_partner')||'{}');
        if(!cd.withdrawMethod){cd.withdrawMethod=d.method;localStorage.setItem('sg_creator',JSON.stringify(cd));}
        if(!pd.withdrawMethod){pd.withdrawMethod=d.method;localStorage.setItem('sg_partner',JSON.stringify(pd));}
      }catch(e){}
    }).catch(function(){});
}


/* ════════════════════════════════════════════════════════════════════
   Watchers
   ════════════════════════════════════════════════════════════════════ */
function tick(){
  try{squadContinueBar();}catch(e){}
  try{partnerContinueBanner();}catch(e){}
  try{hydratePayoutMethod();}catch(e){}
  try{fixPartnerBranding();fixSquadBranding();fixSquadColors();fixSquadShare();}catch(e){}
}

console.log('[Round2] ScanSquad + Partner polish loaded');
return tick;
})();


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
    /* right/top/bottom: rails.css */
    +'#sg-reels-rail{position:fixed;z-index:8998;display:none;flex-direction:column;gap:14px;pointer-events:none}'
    +'#sg-reels-rail.visible{display:flex}'
    +'.sg-rr-btn{pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:var(--sg-btn-gap,3px);cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none}'
    +'.sg-rr-btn:active .sg-rr-circle{transform:scale(.9)}'
    /* Look comes from one-button.css; the fallbacks are that file's values, so
       this row still matches every other row if the sheet is missing. */
    +'.sg-rr-circle{width:var(--sg-btn-size,44px);height:var(--sg-btn-size,44px);border-radius:50%;background:var(--sg-btn-bg,rgba(0,0,0,.40));backdrop-filter:var(--sg-btn-blur,blur(12px));-webkit-backdrop-filter:var(--sg-btn-blur,blur(12px));border:var(--sg-btn-border-width,1.5px) solid var(--sg-btn-border-color,rgba(255,255,255,.12));display:flex;align-items:center;justify-content:center;font-size:var(--sg-btn-icon,20px);transition:transform .15s;box-shadow:var(--sg-btn-shadow,0 2px 10px rgba(0,0,0,.25))}'
    +'.sg-rr-label{font-size:var(--sg-btn-label-size,10px);font-weight:var(--sg-btn-label-weight,600);color:var(--sg-btn-label-color,#fff);text-shadow:var(--sg-btn-label-shadow,0 1px 4px rgba(0,0,0,.8));letter-spacing:var(--sg-btn-label-tracking,.2px)}';
  document.head.appendChild(s);
})();

/* 1b. Build the rail once. */
function ensureRail(){
  var rail=document.getElementById('sg-reels-rail');
  if(rail)return rail;
  rail=document.createElement('div');
  rail.id='sg-reels-rail';
  /* Hidden for now (owner's call, 2026-09-17): Music, Photos, Chat/Messages and
     Trainer/AI Coach are routes without a product behind them yet, and a rail
     button is a promise. They stay in this list — flip `on` to true to bring one
     back — rather than being deleted, so turning them on is one edit. */
  var items=[
    {tab:'music',route:'/music',icon:'\uD83C\uDFB5',label:'Music',on:false},
    {tab:'photos',route:'/photos',icon:'\uD83D\uDCF8',label:'Photos',on:false},
    {tab:'chat',route:'/chat',icon:'\uD83D\uDCAC',label:'Chat',on:false},
    {tab:'trainer',route:'/ai-trainer',icon:'\uD83E\uDD16',label:'Trainer',on:false}
  ].filter(function(it){return it.on;});
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
  /* Every item is off: show nothing rather than an empty floating column. */
  var show=rail.children.length>0&&isReelsActive();
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
  shield:I('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  lock:I('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  power:I('<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>'),
  wallet:I('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>'),
  tag:I('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
  dumbbell:I('<path d="M6.5 6.5v11"/><path d="M17.5 6.5v11"/><path d="M3 9v6"/><path d="M21 9v6"/><line x1="6.5" y1="12" x2="17.5" y2="12"/>'),
  book:I('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  check:I('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  trainer:I('<rect x="4" y="7" width="16" height="13" rx="2"/><line x1="12" y1="3" x2="12" y2="7"/><circle cx="12" cy="2.5" r="1"/><circle cx="9" cy="12.5" r="1"/><circle cx="15" cy="12.5" r="1"/><path d="M9 16.5h6"/>'),
  /* Talk and Ask AI. rails.js drew these two as colour emoji (\uD83C\uDFA4 \u2728), which is
     why the strip never matched the row it sits in: one emoji beside nine line
     icons is a different colour and a different weight, on every tab. */
  mic:I('<path d="M12 1a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
  /* app.ctr576.js's own profile rails (Creator / Partner / Apps / Channels /
     Find Gym / Pricing / Help) were 46px circles holding colour emoji, two of
     them tinted orange and green. They are rail buttons like any other, so they
     read from here now. */
  grid:I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  help:I('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4"/><line x1="12" y1="17.5" x2="12" y2="17.51"/>'),
  person:I('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  film:I('<rect x="2" y="3" width="20" height="18" rx="2"/><line x1="7" y1="3" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="22" y2="15"/>'),
  sparkle:I('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><line x1="19" y1="17" x2="19" y2="21"/><line x1="17" y1="19" x2="21" y2="19"/>'),
  /* ScanSquad's create rail (squad-create.js) drew its eight modes as colour
     emoji, so that row stayed the odd one out even after the circles matched:
     \u270D\uFE0F \uD83D\uDDBC\uFE0F \uD83C\uDFAC beside white line icons is a different colour and weight. */
  pen:I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  image:I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
  scissors:I('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>'),
  phone:I('<rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/>')
};
/* The one icon table in the app. rails.js builds Book / Talk / Ask AI in a
   different file and could not reach it, so it used emoji instead; exported so
   there is one drawing per idea rather than one per file. */
try{window.SG_ICONS=ICONS;}catch(e){}
/* Book-rail label → icon (date labels like "11 Jul" fall back to calendar). */
function iconForLabel(t){
  t=(t||'').trim().toLowerCase();
  if(t==='near me')return 'pin';
  /* Partner tab — these had no mapping, so the raw emoji survived and the row
     showed as grey emoji next to Book's white line icons. */
  if(t==='verify'||t==='verified')return 'check';
  if(t==='locks'||t==='lock'||t==='smart lock')return 'lock';
  if(t==='on'||t==='off'||t==='on off'||t==='on/off')return 'power';
  if(t==='earnings'||t==='earned'||t==='payout'||t==='payouts')return 'wallet';
  if(t==='pricing'||t==='price')return 'tag';
  if(t==='hours')return 'clock';
  if(t==='facilities'||t==='gear'||t==='equipment')return 'dumbbell';
  if(t==='bookings')return 'book';
  if(t==='shield'||t==='trust')return 'shield';
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
    /* Same circle as the Reels rail and the strip: values live in
       one-button.css, fallbacks repeat them so this row never drifts. */
    '.tt-action-btn.sgi{width:var(--sg-btn-size,44px);height:var(--sg-btn-size,44px);border-radius:50%;background:var(--sg-btn-bg,rgba(0,0,0,.40));border:var(--sg-btn-border-width,1.5px) solid var(--sg-btn-border-color,rgba(255,255,255,.12));color:#fff;backdrop-filter:var(--sg-btn-blur,blur(12px));-webkit-backdrop-filter:var(--sg-btn-blur,blur(12px));opacity:1;filter:none;box-shadow:var(--sg-btn-shadow,0 2px 10px rgba(0,0,0,.25))}'+
    '.tt-action-btn.sgi svg{width:var(--sg-btn-icon,20px);height:var(--sg-btn-icon,20px)}'+
    '.tt-actions .tt-action-label{font-size:var(--sg-btn-label-size,10px);font-weight:var(--sg-btn-label-weight,600);color:var(--sg-btn-label-color,#fff);text-shadow:var(--sg-btn-label-shadow,0 1px 4px rgba(0,0,0,.8));letter-spacing:var(--sg-btn-label-tracking,.2px)}'+
    '.tt-actions .tt-action.sgi-x{display:none}'+
    '.tt-actions.sgi-open .tt-action.sgi-x{display:flex}'+
    /* max-height moved to rails.css: 100vh-300px ran under the Talk pill. */
    '.tt-actions.sgi-open{overflow-y:auto;overflow-x:visible;scrollbar-width:none;-ms-overflow-style:none;padding-bottom:8px}'+
    '.tt-actions.sgi-open::-webkit-scrollbar{display:none}'+
    /* Round 4 — card declutter: tighter chips, hide redundant trust row */
    '.tt-chips{gap:5px!important;margin-bottom:6px!important}'+
    '.tt-chip{padding:4px 9px!important;font-size:11px!important;border-radius:8px!important}'+
    '.sgi-trust-x{display:none!important}'+
    /* The "More" circle used to be painted orange here and neutralised again
       further down this same file. Both rules are gone: one-button.css says it
       once, and it says the same thing as every other strip button. */
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
  /* #3 the "More" circle is neutral — now stated once, in one-button.css */
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
  '.creator-side-btn[data-r5lbl]::after{content:attr(data-r5lbl);position:absolute;top:calc(100% + var(--sg-btn-gap,3px));left:50%;transform:translateX(-50%);font-size:var(--sg-btn-label-size,10px);font-weight:var(--sg-btn-label-weight,600);color:var(--sg-btn-label-color,#fff);white-space:nowrap;text-shadow:var(--sg-btn-label-shadow,0 1px 4px rgba(0,0,0,.8));letter-spacing:var(--sg-btn-label-tracking,.2px);pointer-events:none}'+
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
    /* Same drawing as every other strip button: the tab used \ud83d\udd11 \ud83d\udcb8 \u2022\u2022\u2022 as text,
       so ScanSquad was a row of colour emoji next to Reels' white line icons.
       Keyed off the label this function just decided, so there is no second
       place deciding what a button means. */
    var CREATOR_ICON={'Sign in':'lock','Account':'check','Withdraw':'wallet','More':'more'};
    var icons=window.SG_ICONS||{};            /* a different IIFE owns the table */
    var key=CREATOR_ICON[lbl];
    if(key&&icons[key]&&b.getAttribute('data-r5ico')!==key){
      b.innerHTML=icons[key];
      b.setAttribute('data-r5ico',key);
    }
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

/* ── rail label sync ──────────────────────────────────────────────────────────
   The Book rail's date, pass and payment labels are baked into the card's HTML
   when the card is rendered, from window._gymBookingState. Picking a different
   date in the calendar sheet, or a different pass in the passes sheet, only
   writes to that object — so the rail kept showing the old date and the old
   pass until something happened to re-render the card. Owner-visible as "the
   right side calendar/pass button doesn't update in real time".

   This keeps the labels honest from one place instead of patching the eight
   call sites that assign selectedDate/selectedPass. It runs on the shared tick,
   and, so it feels instant, immediately after any tap. */
var railLabelSync=(function(){
  var PASS={day:'Day','3day':'3-Day',weekly:'Weekly',monthly:'Monthly',couple:'Couple',group:'Group'};
  var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  /* Same shape the card renderer produces: "17 Sep", or "Today". */
  function dateLabel(v){
    if(!v)return null;
    if(v==='Today')return 'Today';
    var p=String(v).split('-');
    if(p.length===3){
      var d=parseInt(p[2],10),m=parseInt(p[1],10)-1;
      if(!isNaN(d)&&MONTHS[m])return d+' '+MONTHS[m];
    }
    return String(v);
  }
  function setLabel(rail,match,text){
    if(!text)return;
    var acts=rail.querySelectorAll('.tt-action');
    for(var i=0;i<acts.length;i++){
      var oc=acts[i].getAttribute('onclick')||'';
      if(oc.indexOf(match)===-1)continue;
      var lbl=acts[i].querySelector('.tt-action-label');
      if(lbl&&lbl.textContent!==text)lbl.textContent=text;
      return;
    }
  }
  function tick(){
    var gbs=window._gymBookingState;
    if(!gbs)return;
    var rails=document.querySelectorAll('.tt-actions');
    if(!rails.length)return;
    var dl=dateLabel(gbs.selectedDate);
    var pl=PASS[gbs.selectedPass||'day']||'Day';
    var pay=(gbs.paymentMethod==='saved'&&gbs.savedCard&&gbs.savedCard.last4)
      ? ('\u2022\u2022\u2022\u2022 '+gbs.savedCard.last4) : 'Payment';
    for(var i=0;i<rails.length;i++){
      setLabel(rails[i],'showCalendarPicker',dl);
      setLabel(rails[i],"'passes'",pl);
      setLabel(rails[i],"'payment'",pay);
    }
  }
  /* A sheet closes on the same tap that changes the selection, so run just after
     it — three cheap passes cover the animation without a second timer. */
  document.addEventListener('click',function(){
    setTimeout(tick,60);setTimeout(tick,220);setTimeout(tick,600);
  },true);
  return tick;
})();

var ENHANCERS=[uspStrip,tabsV4,squadPartnerPolish,reelsRail,railIcons,bookSummary,buttonCleanup,railLabelSync];
function tick(){
  for(var i=0;i<ENHANCERS.length;i++){try{ENHANCERS[i]();}catch(e){}}
  /* Tell the stylesheet this script is alive and has decorated at least one
     rail. rails.css keeps an *undecorated* rail invisible only while this class
     is present, so if this file ever fails to load nothing is hidden. */
  if(!READY&&document.querySelector('.tt-actions[data-sgi]')){
    READY=true;document.documentElement.classList.add('sg-rail-ui-ready');
  }
}
var READY=false;
/* The 600ms heartbeat below was the whole bug behind "double buttons, one white
   one emoji": a freshly rendered gym card carries the app's raw emoji rail with
   every item expanded, and it stayed that way for up to 600ms until the next
   tick swapped in the white icons and collapsed it to 4 + More. During a card
   swipe you therefore saw the decorated rail and an undecorated one together.
   Decorating in the same frame the card appears removes the window entirely;
   the interval stays as a safety net. */
function watch(){
  if(typeof MutationObserver==='undefined')return;
  var queued=false;
  new MutationObserver(function(){
    /* Only the rail decorator runs here, never the full tick: several other
       enhancers write to the DOM on every pass (hiding "Earn", rewriting the
       booking summary), which would re-trigger this observer every frame. The
       decorator is guarded by data-sgi, so it is a no-op once a rail is done
       and cannot feed itself. */
    if(queued||!document.querySelector('.tt-actions:not([data-sgi])'))return;
    queued=true;
    requestAnimationFrame(function(){
      queued=false;
      try{railIcons();}catch(e){}
      if(!READY&&document.querySelector('.tt-actions[data-sgi]')){
        READY=true;document.documentElement.classList.add('sg-rail-ui-ready');
      }
    });
  }).observe(document.body,{childList:true,subtree:true});
}
function init(){
  tick();watch();setInterval(tick,600);
  /* Tab changed: re-decide what this tab shows now, not up to 600ms later. */
  document.addEventListener('sg:tabchange',function(){tick();requestAnimationFrame(tick);});
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{init();}
})();
