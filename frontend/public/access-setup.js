/* ═══════════════════════════════════════════════════════════════════════════
   SMART LOCK DROPDOWN — gym owner picks the access system they already use
   ─────────────────────────────────────────────────────────────────────────
   Replaces the old Seam-only sheet (_partnerConnectSeam) with a brand
   dropdown. Each brand routes to the right connect flow:
     • Seam brands (Salto KS, Brivo, Avigilon, TTLock, Sifely, igloohome,
       Akiles, Latch, Nuki)  → Seam Connect Webview (owner logs into their
       own lock account; we only see that one brand's login)
     • Kisi                  → API key form  → /owner/connect-kisi
     • GymMaster             → site + API key → /owner/connect-gymmaster
     • HybridAF / Tedee      → waitlist (choice saved for sales pipeline)
     • Other / none          → manual staff-verified QR
   Purely additive drop-in script. Loads catalog from
   GET /api/access/owner/providers (falls back to built-in list offline).
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

var FALLBACK_PROVIDERS=[
  {id:'salto',label:'Salto KS',method:'seam_webview',region:'UK / Europe'},
  {id:'kisi',label:'Kisi',method:'api_key_form',region:'US / Global'},
  {id:'brivo',label:'Brivo',method:'seam_webview',region:'US'},
  {id:'avigilon',label:'Avigilon Alta (Openpath)',method:'seam_webview',region:'US / Europe'},
  {id:'ttlock',label:'TTLock',method:'seam_webview',region:'Global'},
  {id:'sifely',label:'Sifely',method:'seam_webview',region:'US'},
  {id:'igloohome',label:'igloohome',method:'seam_webview',region:'Asia-Pacific'},
  {id:'akiles',label:'Akiles',method:'seam_webview',region:'Spain'},
  {id:'latch',label:'Latch',method:'seam_webview',region:'US'},
  {id:'nuki',label:'Nuki',method:'seam_webview',region:'Europe'},
  {id:'gymmaster',label:'GymMaster (Gatekeeper)',method:'gymmaster_form',region:'NZ / AU / UK'},
  {id:'hybridaf',label:'HybridAF',method:'waitlist',region:'US'},
  {id:'tedee',label:'Tedee',method:'waitlist',region:'Europe'},
  {id:'other',label:'Other / not sure',method:'manual'},
  {id:'none',label:'No smart lock yet',method:'manual'}
];
var _providers=null,_webviewId=null;

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

async function getGymId(){
  if(window._partnerGymId)return window._partnerGymId;
  try{
    var r=await fetch('/api/gym-partner/dashboard',{credentials:'include'});
    var d=await r.json();
    if(d.gyms&&d.gyms.length>0){window._partnerGymId=d.gyms[0].id;return d.gyms[0].id;}
  }catch(e){}
  return null;
}

async function loadProviders(){
  if(_providers)return _providers;
  try{
    var r=await fetch('/api/access/owner/providers',{credentials:'include'});
    var d=await r.json();
    if(d.providers&&d.providers.length)_providers=d.providers;
  }catch(e){}
  if(!_providers)_providers=FALLBACK_PROVIDERS;
  return _providers;
}

// ── Main sheet (overrides the old Seam-only one) ──
window._partnerConnectSeam=async function(){
  var u=window.state&&state.user;
  if(!u){
    sgToast('Sign in to connect your smart lock','info',2000);
    if(typeof window._sgShowAuthSheet==='function'){window._sgShowAuthSheet('book');}
    return;
  }
  var gymId=await getGymId();
  if(!gymId){sgToast('Claim your gym first, then connect your lock','info',3000);return;}

  var provs=await loadProviders();
  var opts='<option value="" disabled selected>Select your smart lock / access system…</option>';
  provs.forEach(function(p){
    var tag=p.region?(' — '+p.region):'';
    if(p.method==='waitlist')tag+=' (coming soon)';
    opts+='<option value="'+esc(p.id)+'">'+esc(p.label)+esc(tag)+'</option>';
  });

  _sgOpenSheet('sg-lock-sheet',
    '<h2 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 6px">\ud83d\udd10 Connect Your Door</h2>'
    +'<p style="color:rgba(255,255,255,.45);font-size:12.5px;line-height:1.5;margin:0 0 14px">Pick the smart lock or access system your gym already uses. ScanGym customers then get in automatically after booking \u2014 no staff needed.</p>'
    +'<div id="sg-lock-status" style="margin-bottom:12px"></div>'
    +'<select id="sg-lock-select" onchange="_sgLockPicked(this.value)" style="width:100%;background:#1a1a1a;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:14px;font-size:14px;font-weight:600;margin-bottom:12px;-webkit-appearance:none;appearance:none">'+opts+'</select>'
    +'<div id="sg-lock-panel"></div>'
  );
  refreshStatus(gymId);
};

async function refreshStatus(gymId){
  var el=document.getElementById('sg-lock-status');if(!el)return;
  try{
    var r=await fetch('/api/access/owner/connection-status/'+gymId,{credentials:'include'});
    var d=await r.json();
    var sys=d.access_system||d.system||(d.gym&&d.gym.access_system);
    var ok=d.access_verified||d.verified||(d.gym&&d.gym.access_verified);
    if(sys&&sys!=='manual'){
      el.innerHTML='<div style="display:flex;align-items:center;gap:10px;background:'+(ok?'rgba(34,197,94,.08)':'rgba(251,191,36,.08)')+';border:1px solid '+(ok?'rgba(34,197,94,.25)':'rgba(251,191,36,.25)')+';border-radius:12px;padding:12px">'
        +'<span style="font-size:18px">'+(ok?'\u2705':'\u23f3')+'</span>'
        +'<div style="flex:1"><div style="color:#fff;font-size:13px;font-weight:700">'+esc(sys.charAt(0).toUpperCase()+sys.slice(1))+(ok?' connected':' selected \u2014 setup pending')+'</div>'
        +'<div style="color:rgba(255,255,255,.4);font-size:11px">'+(ok?'Day-pass customers unlock your door automatically.':'Bookings use staff-verified QR until setup completes.')+'</div></div>'
        +'<button onclick="_sgLockDisconnect()" style="background:transparent;border:1px solid rgba(239,68,68,.4);color:#ef4444;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer">Remove</button></div>';
    }else{el.innerHTML='';}
  }catch(e){el.innerHTML='';}
}

window._sgLockDisconnect=async function(){
  var gymId=await getGymId();if(!gymId)return;
  try{
    var r=await fetch('/api/access/owner/disconnect/'+gymId,{method:'DELETE',credentials:'include'});
    var d=await r.json();
    sgToast(d.message||'Disconnected','success',3000);
    refreshStatus(gymId);
  }catch(e){sgToast('Could not disconnect','error',2500);}
};

// ── Dropdown choice → provider-specific panel ──
window._sgLockPicked=async function(id){
  var panel=document.getElementById('sg-lock-panel');if(!panel)return;
  var provs=await loadProviders();
  var p=null;provs.forEach(function(x){if(x.id===id)p=x;});
  if(!p)return;
  _webviewId=null;

  if(p.method==='seam_webview'){
    panel.innerHTML=card(
      'Connect your '+esc(p.label)+' account',
      'You\u2019ll log in to your own '+esc(p.label)+' account on a secure page (powered by Seam). ScanGym never sees your password.',
      '<button onclick="_sgLockSeamStart(\''+esc(p.id)+'\')" style="'+btnCss()+'">\ud83d\udd17 Connect '+esc(p.label)+'</button>'
      +'<div id="sg-lock-verify-wrap" style="display:none;margin-top:8px"><button onclick="_sgLockSeamVerify()" style="'+btnCss('outline')+'">\u2705 I\u2019ve logged in \u2014 verify connection</button></div>'
    );
  }else if(p.method==='api_key_form'){
    panel.innerHTML=card(
      'Connect Kisi',
      'In your Kisi dashboard: click your profile \u2192 My Account \u2192 API \u2192 generate an API key, then paste it here.',
      '<input id="sg-kisi-key" type="password" placeholder="Kisi API key" style="'+inputCss()+'">'
      +'<button onclick="_sgLockKisiConnect()" style="'+btnCss()+'">\ud83d\udd17 Connect Kisi</button>'
    );
  }else if(p.method==='gymmaster_form'){
    panel.innerHTML=card(
      'Connect GymMaster',
      'In GymMaster: Settings \u2192 Integrations \u2192 Gatekeeper API. Copy your site name and API key.',
      '<input id="sg-gm-site" type="text" autocapitalize="none" placeholder="Site name (yoursite.gymmasteronline.com)" style="'+inputCss()+'">'
      +'<input id="sg-gm-key" type="password" placeholder="Gatekeeper API key" style="'+inputCss()+'">'
      +'<button onclick="_sgLockGmConnect()" style="'+btnCss()+'">\ud83d\udd17 Connect GymMaster</button>'
    );
  }else if(p.method==='waitlist'){
    panel.innerHTML=card(
      esc(p.label)+' \u2014 coming soon',
      'We\u2019re finishing our '+esc(p.label)+' integration. Save your choice and we\u2019ll switch you to automatic entry the moment it\u2019s live. Until then bookings use staff-verified QR.',
      '<button onclick="_sgLockSaveChoice(\''+esc(p.id)+'\')" style="'+btnCss()+'">\ud83d\udcdd Save my choice</button>'
    );
  }else{
    panel.innerHTML=card(
      'Staff-verified QR check-in',
      'No problem \u2014 customers show a ScanGym QR code and your staff verify it at the door. You can add a smart lock any time to go fully 24/7.',
      '<button onclick="_sgLockSaveChoice(\''+esc(p.id)+'\')" style="'+btnCss()+'">\u2705 Use staff-verified QR</button>'
    );
  }
};

function card(title,body,inner){
  return '<div style="background:#1a1a1a;border-radius:16px;padding:16px;border:1px solid rgba(255,255,255,.08)">'
    +'<div style="font-weight:700;font-size:14px;color:#fff;margin-bottom:6px">'+title+'</div>'
    +'<div style="color:rgba(255,255,255,.5);font-size:12px;line-height:1.5;margin-bottom:12px">'+body+'</div>'+inner+'</div>';
}
function btnCss(variant){
  return variant==='outline'
    ?'width:100%;background:transparent;color:#FF6D00;border:2px solid #FF6D00;padding:13px;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer'
    :'width:100%;background:#FF6D00;color:#fff;border:none;padding:14px;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer';
}
function inputCss(){
  return 'width:100%;box-sizing:border-box;background:#111;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:12px;font-size:14px;margin-bottom:8px';
}

// ── Seam webview flow ──
window._sgLockSeamStart=async function(providerId){
  var gymId=await getGymId();if(!gymId)return;
  sgToast('Opening secure connection page\u2026','info',2000);
  try{
    var r=await fetch('/api/access/owner/create-connect-webview',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({gymId:gymId,provider:providerId})});
    var d=await r.json();
    if(d.url){
      _webviewId=d.connect_webview_id;
      window.open(d.url,'_blank');
      var w=document.getElementById('sg-lock-verify-wrap');if(w)w.style.display='block';
      sgToast('Log in to your lock account in the new tab, then come back and tap Verify','info',5000);
    }else{sgToast(d.error||'Could not start connection \u2014 contact support@scangym.com','error',4000);}
  }catch(e){sgToast('Could not reach the connection service','error',3000);}
};

window._sgLockSeamVerify=async function(){
  var gymId=await getGymId();if(!gymId||!_webviewId){sgToast('Start the connection first','info',2500);return;}
  sgToast('Verifying\u2026','info',1500);
  try{
    var r=await fetch('/api/access/owner/complete-connect',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({gymId:gymId,connectWebviewId:_webviewId})});
    var d=await r.json();
    if(d.connected||d.success){sgToast('\ud83c\udf89 Smart lock connected! Day-pass customers now get in automatically.','success',5000);refreshStatus(gymId);}
    else{sgToast(d.error||'Not finished yet \u2014 complete the login in the other tab first','info',4000);}
  }catch(e){sgToast('Verification failed \u2014 try again','error',3000);}
};

// ── Kisi ──
window._sgLockKisiConnect=async function(){
  var gymId=await getGymId();if(!gymId)return;
  var key=(document.getElementById('sg-kisi-key')||{}).value;
  if(!key){sgToast('Paste your Kisi API key first','info',2500);return;}
  sgToast('Connecting Kisi\u2026','info',2000);
  try{
    var r=await fetch('/api/access/owner/connect-kisi',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({gymId:gymId,kisiApiKey:key})});
    var d=await r.json();
    if(d.connected){sgToast('\ud83c\udf89 '+(d.message||'Kisi connected!'),'success',5000);refreshStatus(gymId);}
    else{sgToast(d.error||'Could not connect Kisi','error',4000);}
  }catch(e){sgToast('Could not reach Kisi','error',3000);}
};

// ── GymMaster ──
window._sgLockGmConnect=async function(){
  var gymId=await getGymId();if(!gymId)return;
  var site=(document.getElementById('sg-gm-site')||{}).value;
  var key=(document.getElementById('sg-gm-key')||{}).value;
  if(!site||!key){sgToast('Enter your GymMaster site name and API key','info',2500);return;}
  site=site.replace(/^https?:\/\//,'').replace(/\.gymmasteronline\.com.*/,'').trim();
  sgToast('Connecting GymMaster\u2026','info',2000);
  try{
    var r=await fetch('/api/access/owner/connect-gymmaster',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({gymId:gymId,gmSite:site,gmApiKey:key})});
    var d=await r.json();
    if(d.connected){sgToast('\ud83c\udf89 '+(d.message||'GymMaster connected!'),'success',6000);refreshStatus(gymId);}
    else{sgToast(d.error||'Could not connect GymMaster','error',5000);}
  }catch(e){sgToast('Could not reach GymMaster','error',3000);}
};

// ── Waitlist / manual ──
window._sgLockSaveChoice=async function(providerId){
  var gymId=await getGymId();if(!gymId)return;
  try{
    var r=await fetch('/api/access/owner/select-provider',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({gymId:gymId,provider:providerId})});
    var d=await r.json();
    if(d.saved){sgToast(d.message||'Saved!','success',5000);refreshStatus(gymId);}
    else{sgToast(d.error||'Could not save','error',3000);}
  }catch(e){sgToast('Could not save choice','error',3000);}
};

console.log('[AccessSetup] Smart lock dropdown loaded \u2014 _partnerConnectSeam upgraded');
})();
