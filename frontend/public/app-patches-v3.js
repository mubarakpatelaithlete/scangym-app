/**
 * ScanGym App Patches v3 Additions
 * New features: #62 live visitors, #75/#76 AI Trainer tab, #98-100 owner controls
 */
(function(){
'use strict';
function injectStyle(id,css){if(document.getElementById(id))return;var s=document.createElement('style');s.id=id;s.textContent=css;document.head.appendChild(s);}

// #62: Live Visitor Counter
function initVisitorCounter(){
  injectStyle('sg-sps-s','#sg-sps{position:sticky;top:0;z-index:100;background:rgba(255,109,0,.08);border-bottom:1px solid rgba(255,109,0,.15);padding:6px 16px;display:flex;align-items:center;gap:8px;font-size:11px;color:rgba(255,255,255,.7);font-weight:600}');
  async function f(){try{var r=await fetch('/api/stats/live-visitors');var d=await r.json();var el=document.getElementById('sg-lvt');if(el)el.textContent=d.label||(d.count+' here now');}catch(e){}}
  setTimeout(function(){var bc=document.querySelector('.sg-tab-content');if(!bc||document.getElementById('sg-sps'))return;var s=document.createElement('div');s.id='sg-sps';s.innerHTML='\u{1F525} <span id="sg-lvt">Loading...</span> \u00b7 \u26A1 Instant QR \u00b7 \u2705 Free cancel';bc.insertBefore(s,bc.firstChild);},3000);
  f();setInterval(f,30000);
}

// #75/#76: AI Trainer Tab — REMOVED (now integrated as proper tab in app.ctr576.js TrainerTabPage)
// The old patch injected a DOM tab that bypassed SPA routing and broke the webapp.
// Trainer tab is now a native tab in the bottom nav, between Chat and Profile.

// #98/#99/#100: Gym Owner Quick Controls
function addOwnerControls(){
  injectStyle('sg-oq-s','.sg-oq-p{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-bottom:12px}.sg-oq-tb{width:100%;padding:16px;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:all .2s}.sg-oq-tb.open{background:rgba(34,197,94,.15);border:2px solid rgba(34,197,94,.4);color:#22c55e}.sg-oq-tb.closed{background:rgba(239,68,68,.1);border:2px solid rgba(239,68,68,.3);color:#f87171}.sg-oq-pr{display:flex;gap:10px;margin-top:12px;align-items:center}.sg-oq-pi{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;color:#fff;font-size:16px;font-weight:700;text-align:center;outline:none}.sg-oq-pb{padding:10px 18px;background:#FF6D00;border:none;border-radius:10px;color:#fff;font-weight:700;font-size:14px;cursor:pointer}');
  window.sgOwnerQuickToggle=async function(id,btn){var open=btn.classList.contains('closed');try{var r=await fetch('/api/gym-mgmt/'+id+'/quick-toggle',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({isOpen:open})});var d=await r.json();if(d.success){btn.className='sg-oq-tb '+(open?'open':'closed');btn.textContent=open?'\u{1F7E2} GYM IS OPEN':'\u{1F534} GYM IS CLOSED';if(window.sgToast)sgToast(d.message,'success');}else{if(window.sgToast)sgToast(d.error||'Failed','error');}}catch(e){if(window.sgToast)sgToast('Connection error','error');};};
  window.sgOwnerQuickPrice=async function(id){var inp=document.getElementById('sg-oq-pi-'+id);if(!inp)return;var price=parseFloat(inp.value);if(!price||isNaN(price)){if(window.sgToast)sgToast('Enter valid price','error');return;}try{var r=await fetch('/api/gym-mgmt/'+id+'/quick-price',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({price})});var d=await r.json();if(d.success){if(window.sgToast)sgToast(d.message,'success');}else{if(window.sgToast)sgToast(d.error||'Failed','error');}}catch(e){if(window.sgToast)sgToast('Connection error','error');};};
  function inj(){var os=document.querySelector('#sg-owner-controls,[class*="owner-controls"]');if(!os||os.querySelector('.sg-oq-p'))return;var id=(window.state&&(window.state.currentGym||window.state.ownedGym)&&((window.state.currentGym||window.state.ownedGym).id||''))||'';if(!id)return;var isO=(window.state.currentGym||window.state.ownedGym||{}).openNow!==false;var p=document.createElement('div');p.className='sg-oq-p';p.innerHTML='<div style="color:rgba(255,255,255,.5);font-size:10px;font-weight:700;margin-bottom:8px">QUICK CONTROLS</div><button class="sg-oq-tb '+(isO?'open':'closed')+'" onclick="sgOwnerQuickToggle(\''+id+'\',this)">'+(isO?'\u{1F7E2} GYM IS OPEN':'\u{1F534} GYM IS CLOSED')+'</button><div class="sg-oq-pr"><span style="color:rgba(255,255,255,.5);font-size:14px">\u00a3</span><input class="sg-oq-pi" id="sg-oq-pi-'+id+'" type="number" min="3" max="50" step="0.5" placeholder="Day pass price"><button class="sg-oq-pb" onclick="sgOwnerQuickPrice(\''+id+'\')" >Set Price</button></div>';os.insertBefore(p,os.firstChild);}
  inj();new MutationObserver(inj).observe(document.body,{childList:true,subtree:true});
}

function init(){initVisitorCounter();addOwnerControls();console.log('[ScanGym Patches v3] #62 #98 #99 #100 (Trainer tab moved to native)');}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{setTimeout(init,600);}
})();
