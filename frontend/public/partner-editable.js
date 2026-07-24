/* ═══════════════════════════════════════════════════════════════════════════
   PARTNER TAB = BOOK TAB BUT EDITABLE (Task 2)
   
   Redesigns PartnerFullPage to render exactly like the Book tab's 
   TikTok-style vertical card carousel — but every field is editable
   because you're the gym owner.
   
   - Same full-screen photo background, gradient, right-side action buttons
   - Gym name, address, pricing, hours — all inline-editable
   - Owner-specific action buttons: Edit Photos, Set Price, Hours, 
     Toggle Active, Analytics, Earnings, Access, Settings
   - Loads gym data from /api/gym-partner/dashboard
   - Falls back to "Claim Your Gym" card if no gyms claimed
   
   Purely additive drop-in script. Book tab code NOT touched.
   ═══════════════════════════════════════════════════════════════════════════ */

(function(){
'use strict';

// ══════════════════════════════════════════════════════════════════════
// CSS (injected once)
// ══════════════════════════════════════════════════════════════════════

if(!document.getElementById('pe-css')){
  var s=document.createElement('style');s.id='pe-css';
  s.textContent=''
    +'.pe-view{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;position:relative}'
    +'.pe-carousel{display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;scroll-behavior:smooth;flex:1;min-height:0}'
    +'.pe-carousel::-webkit-scrollbar{display:none}'
    +'.pe-card{width:100%;min-height:100%;max-height:100%;scroll-snap-align:start;position:relative;display:flex;flex-direction:column;overflow:hidden}'
    +'.pe-photo{position:absolute;inset:0;background-size:cover;background-position:center;background-color:#1a1f2e}'
    +'.pe-photo-placeholder{position:absolute;inset:0;background:#1a1f2e;display:flex;align-items:center;justify-content:center}'
    +'.pe-photo-placeholder::after{content:"🏋️";font-size:56px;opacity:.15}'
    +'.pe-gradient{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.35) 0%,transparent 22%,transparent 55%,rgba(0,0,0,.55) 75%,rgba(0,0,0,.82) 100%);pointer-events:none;z-index:1}'
    +'.pe-actions{position:absolute;right:10px;top:65px;display:flex;flex-direction:column;gap:6px;z-index:25;align-items:center}'
    +'.pe-action{display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;-webkit-tap-highlight-color:transparent}'
    +'.pe-action-btn{width:44px;height:44px;background:transparent;border:none;border-radius:0;display:flex;align-items:center;justify-content:center;font-size:24px;transition:all .15s;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));opacity:.75}'
    +'.pe-action-btn:active{transform:scale(.85);transition:transform .05s}'
    +'.pe-action-label{display:block;font-size:9px;color:rgba(255,255,255,.7);font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8);text-align:center;white-space:nowrap;max-width:52px;overflow:hidden;text-overflow:ellipsis;line-height:1.1}'
    +'.pe-info{position:absolute;bottom:0;left:0;right:60px;padding:0 14px 14px;z-index:15;pointer-events:none}'
    +'.pe-info>*{pointer-events:auto}'
    +'.pe-gym-name{color:#fff;font-size:28px;font-weight:900;text-shadow:0 2px 10px rgba(0,0,0,.6);line-height:1.15;margin-bottom:4px;letter-spacing:-.3px}'
    +'.pe-gym-addr{color:rgba(255,255,255,.7);font-size:12px;margin-bottom:6px;text-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;gap:4px;flex-wrap:wrap}'
    +'.pe-chips{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}'
    +'.pe-chip{display:flex;align-items:center;gap:5px;background:rgba(30,33,45,.85);border-radius:10px;padding:6px 12px;font-size:12px;color:rgba(255,255,255,.92);font-weight:700}'
    +'.pe-edit-badge{position:absolute;top:12px;left:14px;z-index:20;display:flex;align-items:center;gap:6px;background:rgba(255,109,0,.9);border-radius:20px;padding:6px 14px;font-size:11px;font-weight:700;color:#fff;letter-spacing:.3px;box-shadow:0 2px 12px rgba(255,109,0,.4)}'
    +'.pe-editable{cursor:pointer;position:relative;transition:all .15s;border-radius:8px;padding:2px 4px;margin:-2px -4px}'
    +'.pe-editable:hover,.pe-editable:active{background:rgba(255,109,0,.15);outline:1px dashed rgba(255,109,0,.5)}'
    +'.pe-editable::after{content:"✏️";font-size:10px;margin-left:4px;opacity:.5}'
    +'.pe-status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px}'
    +'.pe-counter{font-size:10px;color:rgba(255,255,255,.4);margin-bottom:4px;font-weight:500}'
    +'.pe-logo{position:relative;width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;z-index:15;border:2px solid rgba(255,255,255,.15);box-shadow:0 2px 8px rgba(0,0,0,.3);margin-bottom:6px}'
    +'.pe-toast{position:fixed;top:env(safe-area-inset-top,12px);left:50%;transform:translateX(-50%) translateY(-100%);z-index:9999;background:#22c55e;color:#fff;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:700;box-shadow:0 4px 20px rgba(0,0,0,.3);transition:transform .35s cubic-bezier(.32,.72,0,1);pointer-events:none}'
    +'.pe-toast.show{transform:translateX(-50%) translateY(12px)}'
    +'.pe-search{position:absolute;top:0;left:0;right:0;z-index:20;display:flex;gap:8px;padding:8px 12px;padding-top:calc(env(safe-area-inset-top,8px) + 4px)}'
    ;
  document.head.appendChild(s);
}

// ══════════════════════════════════════════════════════════════════════
// Helper: Toast notification
// ══════════════════════════════════════════════════════════════════════

function _peToast(msg,color,ms){
  var t=document.createElement('div');t.className='pe-toast';t.textContent=msg;
  if(color)t.style.background=color;
  document.body.appendChild(t);
  requestAnimationFrame(function(){requestAnimationFrame(function(){t.classList.add('show');});});
  setTimeout(function(){t.classList.remove('show');setTimeout(function(){t.remove();},400);},ms||2500);
}

// ══════════════════════════════════════════════════════════════════════
// Helper: Inline edit popup (bottom sheet)
// ══════════════════════════════════════════════════════════════════════

function _peEditField(title,currentValue,placeholder,onSave){
  if(typeof _ctaOpenSheet!=='function')return;
  var html=''
    +'<div style="text-align:center;margin-bottom:16px">'
    +'<h2 style="color:#fff;font-size:18px;font-weight:800;margin:0 0 4px">Edit '+title+'</h2>'
    +'</div>'
    +'<input id="pe-edit-input" type="text" value="'+(currentValue||'').replace(/"/g,'&quot;')+'" placeholder="'+(placeholder||'')+'" '
    +'style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:14px 16px;color:#fff;font-size:16px;outline:none;box-sizing:border-box;margin-bottom:16px" '
    +'onfocus="this.style.borderColor=\'rgba(255,109,0,.5)\'" onblur="this.style.borderColor=\'rgba(255,255,255,.15)\'">'
    +'<button id="pe-edit-save" onclick="window._peSaveField()" style="width:100%;background:#FF6D00;color:#fff;border:none;border-radius:14px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(255,109,0,.3)">Save →</button>';
  _ctaOpenSheet(html);
  window._peSaveField=function(){
    var val=document.getElementById('pe-edit-input').value.trim();
    if(val){
      onSave(val);
      _ctaCloseSheet();
      _peToast(title+' updated ✅');
    }
  };
  setTimeout(function(){var inp=document.getElementById('pe-edit-input');if(inp)inp.focus();},400);
}

// ══════════════════════════════════════════════════════════════════════
// Helper: Price edit popup
// ══════════════════════════════════════════════════════════════════════

function _peEditPrice(gymId,currentPrice){
  if(typeof _ctaOpenSheet!=='function')return;
  var html=''
    +'<div style="text-align:center;margin-bottom:20px">'
    +'<div style="font-size:40px;margin-bottom:8px">💰</div>'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Set Day Pass Price</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">24-hour access · 2-scan QR (in + out)</p>'
    +'</div>'

    // Quick templates
    +'<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">'
    +'<div onclick="document.getElementById(\'pe-price-input\').value=\'5.00\'" style="flex:1;min-width:70px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px;text-align:center;cursor:pointer"><div style="color:#fff;font-size:16px;font-weight:800">£5</div><div style="color:rgba(255,255,255,.35);font-size:9px">Budget</div></div>'
    +'<div onclick="document.getElementById(\'pe-price-input\').value=\'10.00\'" style="flex:1;min-width:70px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px;text-align:center;cursor:pointer"><div style="color:#fff;font-size:16px;font-weight:800">£10</div><div style="color:rgba(255,255,255,.35);font-size:9px">Standard</div></div>'
    +'<div onclick="document.getElementById(\'pe-price-input\').value=\'15.00\'" style="flex:1;min-width:70px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px;text-align:center;cursor:pointer"><div style="color:#fff;font-size:16px;font-weight:800">£15</div><div style="color:rgba(255,255,255,.35);font-size:9px">Premium</div></div>'
    +'<div onclick="document.getElementById(\'pe-price-input\').value=\'25.00\'" style="flex:1;min-width:70px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px;text-align:center;cursor:pointer"><div style="color:#fff;font-size:16px;font-weight:800">£25</div><div style="color:rgba(255,255,255,.35);font-size:9px">Boutique</div></div>'
    +'</div>'

    // Custom amount
    +'<label style="color:rgba(255,255,255,.5);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Custom Price</label>'
    +'<div style="display:flex;align-items:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;overflow:hidden;margin-bottom:16px">'
    +'<span style="padding:0 14px;color:rgba(255,255,255,.4);font-size:18px;font-weight:700">£</span>'
    +'<input id="pe-price-input" type="number" step="0.01" min="1" value="'+(currentPrice||5).toFixed(2)+'" style="flex:1;background:none;border:none;padding:14px 14px 14px 0;color:#fff;font-size:20px;font-weight:700;outline:none">'
    +'<span style="padding:0 14px;color:rgba(255,255,255,.3);font-size:12px;font-weight:600">/24hr</span>'
    +'</div>'

    // Commission info
    +'<div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);border-radius:12px;padding:12px;margin-bottom:16px;display:flex;align-items:center;gap:10px">'
    +'<span style="font-size:20px">💚</span>'
    +'<div><span style="color:#4ade80;font-size:13px;font-weight:700">You keep 85%</span><span style="color:rgba(255,255,255,.35);font-size:11px"> · ScanGym takes 15%</span></div>'
    +'</div>'

    +'<button onclick="window._peSavePrice('+gymId+')" style="width:100%;background:#FF6D00;color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(255,109,0,.3)">Update Price →</button>';

  _ctaOpenSheet(html);
}

window._peSavePrice=async function(gymId){
  var inp=document.getElementById('pe-price-input');
  if(!inp)return;
  var price=parseFloat(inp.value);
  if(isNaN(price)||price<1){_peToast('Min price is £1','#ef4444');return;}
  try{
    var r=await fetch('/api/owner/pricing/'+gymId+'/quick',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:price<=5?'budget':price<=10?'standard':price<=15?'premium':'boutique'})});
    // Also direct update
    await fetch('/api/owner/pricing/'+gymId,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({dayPassPrice:price})}).catch(function(){});
    _ctaCloseSheet();
    _peToast('Price set to £'+price.toFixed(2)+'/day ✅');
    // Update the card
    var el=document.getElementById('pe-price-'+gymId);
    if(el)el.textContent='£'+price.toFixed(2)+'/day';
    // Store for re-renders
    if(window._peGymsCache){
      window._peGymsCache.forEach(function(g){if(g.id==gymId)g.dayPassPrice=price;});
    }
  }catch(e){_peToast('Failed to update price','#ef4444');}
};

// ══════════════════════════════════════════════════════════════════════
// Helper: Hours override popup
// ══════════════════════════════════════════════════════════════════════

function _peEditHours(gymId){
  if(typeof _ctaOpenSheet!=='function')return;
  // Gym on/off toggle lives here now (moved from top bar per user request)
  var isActive=true;
  try{(window._peGymsCache||[]).forEach(function(g){if(g.id==gymId)isActive=g.isActive!==false;});}catch(e){}
  var html=''
    +'<div style="text-align:center;margin-bottom:20px">'
    +'<div style="font-size:40px;margin-bottom:8px">🕐</div>'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Opening Hours</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Override Google hours for your gym</p>'
    +'</div>'

    // Gym LIVE/PAUSED master toggle
    +'<div onclick="window._peToggleActive('+gymId+','+isActive+');if(typeof _ctaCloseSheet===\'function\')_ctaCloseSheet();" style="display:flex;align-items:center;gap:14px;padding:16px;background:'+(isActive?'rgba(34,197,94,.06)':'rgba(239,68,68,.06)')+';border:2px solid '+(isActive?'rgba(34,197,94,.25)':'rgba(239,68,68,.25)')+';border-radius:16px;cursor:pointer;margin-bottom:14px">'
    +'<div style="width:48px;height:48px;background:'+(isActive?'rgba(34,197,94,.15)':'rgba(239,68,68,.12)')+';border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px">'+(isActive?'🟢':'🔴')+'</div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">Gym is '+(isActive?'LIVE':'PAUSED')+'</div><div style="color:rgba(255,255,255,.35);font-size:11px">'+(isActive?'Visible on ScanGym and accepting bookings — tap to pause':'Hidden from search, bookings paused — tap to go live')+'</div></div>'
    +'<div style="position:relative;width:44px;height:24px;flex-shrink:0"><div style="position:absolute;inset:0;background:'+(isActive?'#22c55e':'rgba(255,255,255,.15)')+';border-radius:12px"></div><div style="position:absolute;top:2px;left:'+(isActive?'22px':'2px')+';width:20px;height:20px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div></div>'
    +'</div>'

    +'<div style="height:1px;background:rgba(255,255,255,.07);margin:2px 0 14px"></div>'

    // Quick actions
    +'<div onclick="window._peSetHours('+gymId+',\'open_now\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:rgba(34,197,94,.06);border:2px solid rgba(34,197,94,.2);border-radius:16px;cursor:pointer;margin-bottom:10px">'
    +'<div style="width:48px;height:48px;background:rgba(34,197,94,.15);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px">🟢</div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">Mark as Open Now</div><div style="color:rgba(255,255,255,.35);font-size:11px">Override — show as open regardless of Google hours</div></div>'
    +'</div>'

    +'<div onclick="window._peSetHours('+gymId+',\'closed_now\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:rgba(239,68,68,.06);border:2px solid rgba(239,68,68,.15);border-radius:16px;cursor:pointer;margin-bottom:10px">'
    +'<div style="width:48px;height:48px;background:rgba(239,68,68,.12);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px">🔴</div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">Mark as Closed Now</div><div style="color:rgba(255,255,255,.35);font-size:11px">Temporarily close — visitors see a closed notice</div></div>'
    +'</div>'

    +'<div onclick="window._peSetHours('+gymId+',\'use_google_hours\')" style="display:flex;align-items:center;gap:14px;padding:16px;background:rgba(255,255,255,.03);border:2px solid rgba(255,255,255,.08);border-radius:16px;cursor:pointer;margin-bottom:10px">'
    +'<div style="width:48px;height:48px;background:rgba(255,255,255,.06);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px">🌐</div>'
    +'<div style="flex:1"><div style="color:#fff;font-size:15px;font-weight:700">Use Google Hours</div><div style="color:rgba(255,255,255,.35);font-size:11px">Automatic — syncs with your Google Business listing</div></div>'
    +'</div>';

  _ctaOpenSheet(html);
}

window._peSetHours=async function(gymId,status){
  try{
    await fetch('/api/gym-partner/hours-override',{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({gymId:gymId,overrideStatus:status})});
    _ctaCloseSheet();
    var labels={open_now:'Marked as Open 🟢',closed_now:'Marked as Closed 🔴',use_google_hours:'Using Google Hours 🌐'};
    _peToast(labels[status]||'Hours updated ✅');
    // Update card
    var dot=document.getElementById('pe-status-dot-'+gymId);
    var lbl=document.getElementById('pe-status-label-'+gymId);
    if(status==='open_now'){
      if(dot){dot.style.background='#4ade80';}
      if(lbl){lbl.textContent='Open';lbl.style.color='#4ade80';}
    }else if(status==='closed_now'){
      if(dot){dot.style.background='#f87171';}
      if(lbl){lbl.textContent='Closed';lbl.style.color='#f87171';}
    }else{
      if(dot){dot.style.background='#60a5fa';}
      if(lbl){lbl.textContent='Auto';lbl.style.color='#60a5fa';}
    }
  }catch(e){_peToast('Failed to update hours','#ef4444');}
};

// ══════════════════════════════════════════════════════════════════════
// Helper: Toggle gym active/paused
// ══════════════════════════════════════════════════════════════════════

window._peToggleActive=async function(gymId,currentlyActive){
  var newState=!currentlyActive;
  try{
    await fetch('/api/gym-partner/toggle-active',{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({gymId:gymId,isActive:newState})});
    _peToast(newState?'Gym is LIVE on ScanGym 🟢':'Gym PAUSED — hidden from search 🔴');
    // Update cache
    if(window._peGymsCache){
      window._peGymsCache.forEach(function(g){if(g.id==gymId)g.isActive=newState;});
    }
    // Re-render
    _peRenderCards();
  }catch(e){_peToast('Toggle failed','#ef4444');}
};

// ══════════════════════════════════════════════════════════════════════
// Helper: Edit photo (open file picker)
// ══════════════════════════════════════════════════════════════════════

function _peEditPhotos(gymId){
  _peToast('📸 Photo upload coming soon!');
  // TODO: Wire up to gym photo upload API
}

// ══════════════════════════════════════════════════════════════════════
// MAIN: Build the Partner-as-Book-Tab card view
// ══════════════════════════════════════════════════════════════════════

window._peGymsCache=null;
window._peDashboardCache=null;

// Render the gym cards in the partner tab container  
function _peRenderCards(){
  var gyms=window._peGymsCache||[];
  var dash=window._peDashboardCache||{};

  // ── ONE PARTNER SCREEN RULE ──────────────────────────────────────────
  // Owners with claimed gyms use the native Partner Dashboard
  // (PartnerFullPage) exclusively. The old pe-carousel takeover rendered a
  // SECOND near-identical screen on top of it — never do that again.
  if(gyms.length){
    if(typeof window._partnerLoadGymProfile==='function')window._partnerLoadGymProfile();
    return;
  }

  var container=document.querySelector('.partner-screen');
  if(!container){
    // PartnerFullPage uses .tt-view > .tt-card — replace the VIEW, not the
    // card. Replacing the card's innerHTML nested a pe-card inside the
    // native tt-card (a card-in-card duplicate screen).
    container=document.querySelector('.tt-view')
              ||document.querySelector('#partner-profile-page')
              ||document.querySelector('.tt-card');
    // Last resort: old layout fixed container
    if(!container){
      var partnerRoot=document.querySelector('[style*="position:fixed"][style*="bottom:56px"]');
      if(partnerRoot){
        var screens=partnerRoot.querySelectorAll('.partner-screen');
        if(screens.length>0)container=screens[0];
      }
    }
    if(!container)return;
  }

  // No gyms claimed — show "Claim Your Gym" card (remove stray copies first)
  document.querySelectorAll('.pe-view').forEach(function(v){if(!container.contains(v)||v.parentElement!==container)v.remove();});
  container.style.display='flex';
  container.innerHTML=_peClaimCard();
}

// ══════════════════════════════════════════════════════════════════════
// "Claim Your Gym" card (shown when no gyms are claimed)
// ══════════════════════════════════════════════════════════════════════

function _peClaimCard(){
  return ''
    +'<div class="pe-view"><div class="pe-carousel">'
    +'<div class="pe-card">'
    +'<div class="pe-photo-placeholder"></div>'
    +'<div class="pe-gradient"></div>'
    // Search bar
    +'<div class="pe-search">'
    +'<div onclick="window._peOpenClaimSearch()" style="flex:1;background:rgba(10,12,20,.75);border:1px solid rgba(255,109,0,.3);border-radius:12px;padding:10px 14px;color:rgba(255,255,255,.5);font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;cursor:pointer">'
    +'<span>🔍</span> <span>Search for your gym to claim it</span>'
    +'</div>'
    +'</div>'
    // Center CTA
    +'<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;z-index:20;width:85%">'
    +'<div style="font-size:64px;margin-bottom:16px">🏋️</div>'
    +'<h2 style="color:#fff;font-size:24px;font-weight:900;margin:0 0 8px;text-shadow:0 2px 10px rgba(0,0,0,.5)">Your Gym Goes Here</h2>'
    +'<p style="color:rgba(255,255,255,.5);font-size:14px;margin:0 0 24px">Claim your gym to see it exactly like your customers do — but with full editing power</p>'
    +'<p style="color:rgba(255,255,255,.3);font-size:11px;margin-top:12px">1.2M+ gyms · Free to claim</p>'
    +'</div>'
    // Bottom info (mimicking Book tab)
    +'<div class="pe-info">'
    +'<div class="pe-logo" style="background:linear-gradient(135deg,#FF6D00,#E66200)">🏋️</div>'
    +'<div class="pe-gym-name">Claim Your Gym</div>'
    +'<div class="pe-gym-addr">📍 Search from 1.2M+ gyms worldwide</div>'
    +'<div class="pe-chips">'
    +'<div class="pe-chip">💚 Keep 85%</div>'
    +'<div class="pe-chip">⚡ Instant Setup</div>'
    +'<div class="pe-chip">🔐 Smart Lock Ready</div>'
    +'</div>'
    +'</div>'
    +'</div>'
    +'</div></div>';
}

// ══════════════════════════════════════════════════════════════════════
// FIND & CLAIM YOUR GYM — search sheet (uses /api/live/search, the real
// search endpoint). Previously the claim card sent owners to the Book-tab
// search (which books, not claims) or /list-your-gym (a dead end).
// ══════════════════════════════════════════════════════════════════════

var _peClaimSearchTimer=null;

window._peOpenClaimSearch=function(prefill){
  if(typeof _ctaOpenSheet!=='function'){navigate('/list-your-gym');return;}
  var html=''
    +'<div style="text-align:center;margin-bottom:16px">'
    +'<div style="font-size:40px;margin-bottom:8px">🔍</div>'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">Find &amp; Claim Your Gym</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Search 1.2M+ gyms · Free to claim</p>'
    +'</div>'
    +'<input id="pe-claim-search-input" type="text" placeholder="Gym name + city (e.g. PureGym Leeds)" value="'+String(prefill||'').replace(/"/g,'&quot;')+'" '
    +'oninput="window._peClaimSearchInput(this.value)" '
    +'style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,109,0,.3);border-radius:12px;padding:14px 16px;color:#fff;font-size:15px;outline:none;box-sizing:border-box;margin-bottom:12px">'
    +'<div id="pe-claim-results" style="max-height:280px;overflow-y:auto"></div>'
    +'<p style="color:rgba(255,255,255,.25);font-size:11px;text-align:center;margin-top:10px">Can\'t find your gym? Email <span style="color:#FF6D00">hello@scangym.com</span> and we\'ll add it</p>';
  _ctaOpenSheet(html);
  setTimeout(function(){
    var inp=document.getElementById('pe-claim-search-input');
    if(inp){inp.focus();if(inp.value&&inp.value.length>=2)window._peClaimSearchInput(inp.value);}
  },400);
};

window._peClaimSearchInput=function(q){
  clearTimeout(_peClaimSearchTimer);
  var box=document.getElementById('pe-claim-results');
  if(!box)return;
  if(!q||q.length<2){box.innerHTML='';return;}
  box.innerHTML='<p style="color:rgba(255,255,255,.3);font-size:12px;text-align:center;padding:10px">Searching…</p>';
  _peClaimSearchTimer=setTimeout(async function(){
    try{
      var r=await fetch('/api/live/search?q='+encodeURIComponent(q));
      if(!r.ok)throw new Error('search '+r.status);
      var d=await r.json();
      var gyms=(d.gyms||[]).slice(0,8);
      box=document.getElementById('pe-claim-results');
      if(!box)return;
      if(!gyms.length){box.innerHTML='<p style="color:rgba(255,255,255,.3);font-size:12px;text-align:center;padding:10px">No gyms found — try adding your city</p>';return;}
      box.innerHTML=gyms.map(function(g){
        var pid=String(g.placeId||g.id||'');
        var nm=String(g.name||'Gym');
        // All results show "Verify →" — claim happens silently behind the scenes
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;margin-bottom:6px">'
          +(g.photo?'<div style="width:40px;height:40px;border-radius:10px;background-image:url(\''+g.photo+'\');background-size:cover;background-position:center;flex-shrink:0"></div>'
                   :'<div style="width:40px;height:40px;background:rgba(255,109,0,.1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🏋️</div>')
          +'<div style="flex:1;min-width:0">'
          +'<p style="color:#fff;font-size:13px;font-weight:700;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+nm.replace(/</g,'&lt;')+'</p>'
          +'<p style="color:rgba(255,255,255,.35);font-size:11px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+String(g.address||g.city||'').replace(/</g,'&lt;')+'</p>'
          +'</div>'
          +'<button onclick="window._peVerifyGym(\''+pid.replace(/'/g,'')+'\',\''+encodeURIComponent(nm)+'\')" style="background:#22c55e;color:#fff;border:none;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">Verify →</button>'
          +'</div>';
      }).join('');
    }catch(e){
      box=document.getElementById('pe-claim-results');
      if(box)box.innerHTML='<p style="color:#f87171;font-size:12px;text-align:center;padding:10px">Search failed — check connection and try again</p>';
    }
  },350);
};

// ── Verify flow: auto-claim silently + open verify sheet directly ──
// No "Claim" step visible to the user — claim happens behind the scenes.
window._peVerifyGym=async function(placeId,encName){
  var u=(typeof state!=='undefined'&&state)?state.user:null;
  if(!u){
    if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();
    _peToast('Log in first to verify your gym');
    if(typeof window._sgShowAuthSheet==='function'){window._sgShowAuthSheet('book');}else{navigate('/login');}
    return;
  }
  // Don't close the search sheet yet — wait for API result
  try{
    // 1. Resolve placeId → gymId
    var gymId=null;
    var m=String(placeId).match(/^db-(\d+)$/);
    if(m){gymId=parseInt(m[1],10);}
    else{
      var er=await fetch('/api/live/ensure-gym',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({placeId:placeId})});
      var ed=await er.json().catch(function(){return{};});
      if(!er.ok||!ed.gymId){_peToast('Could not load this gym','#ef4444');return;}
      gymId=ed.gymId;
    }
    // 2. Silent claim (idempotent — succeeds whether new or already yours)
    var r=await fetch('/api/gym-partner/claim',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({gymId:gymId,ownerName:u?(u.name||u.first_name||null):null,ownerEmail:u?(u.email||null):null,ownerPhone:u?(u.phone||null):null})});
    var d=await r.json().catch(function(){return{};});
    if(!r.ok&&r.status===409){
      // Show a visible error sheet instead of a brief toast
      var gymName=decodeURIComponent(encName||'This gym');
      if(typeof _ctaOpenSheet==='function'){
        _ctaOpenSheet(''
          +'<div style="text-align:center;padding:8px 0 16px">'
          +'<div style="font-size:48px;margin-bottom:12px">\u26a0\ufe0f</div>'
          +'<h2 style="color:#fff;font-size:18px;font-weight:800;margin:0 0 8px">Already Verified</h2>'
          +'<p style="color:rgba(255,255,255,.5);font-size:13px;margin:0 0 20px;line-height:1.5"><strong style="color:#f87171">'+gymName.replace(/</g,'&lt;')+'</strong> has already been verified by another owner.</p>'
          +'<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;margin-bottom:16px;text-align:left">'
          +'<p style="color:rgba(255,255,255,.6);font-size:12px;margin:0;line-height:1.6">\ud83d\udce7 If this is your gym, email <strong style="color:#FF6D00">hello@scangym.com</strong> with proof of ownership and we\'ll transfer it to you.</p>'
          +'</div>'
          +'<button onclick="if(typeof _ctaCloseSheet===\'function\')_ctaCloseSheet();setTimeout(function(){var s=document.getElementById(\'pe-claim-search\');if(s){s.value=\'\';s.focus();}},300);" style="width:100%;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(255,109,0,.3)">\ud83d\udd0d Search for a different gym</button>'
          +'</div>');
      }else{
        _peToast('This gym is already verified by another owner — email hello@scangym.com','#ef4444',5000);
      }
      return;
    }
    // 3. Close search sheet on success
    if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();
    // 4. Reload dashboard in background
    _peLoadAndRender();
    // 5. Go straight to verify
    setTimeout(function(){
      if(typeof window._sgB3VerifyOwnership==='function'){
        window._sgB3VerifyOwnership(gymId);
      }
    },400);
  }catch(e){_peToast('Network error — try again','#ef4444');}
};

// Step 2: ownership details form (legacy — kept for backwards compat)
window._peStartClaim=function(placeId,encName){
  var u=(typeof state!=='undefined'&&state)?state.user:null;
  if(!u){
    if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();
    _peToast('Log in first to claim your gym');
    if(typeof window._sgShowAuthSheet==='function'){window._sgShowAuthSheet('book');}else{navigate('/login');}
    return;
  }
  var gymName=decodeURIComponent(encName||'');
  // No extra "Claim My Gym" tap — claim starts immediately and flows straight
  // into ownership verification. The button only appears as a retry on error.
  var html=''
    +'<div style="text-align:center;margin-bottom:16px">'
    +'<div style="font-size:40px;margin-bottom:8px">🏢</div>'
    +'<h2 style="color:#fff;font-size:19px;font-weight:800;margin:0 0 4px">Claim '+gymName.replace(/</g,'&lt;')+'</h2>'
    +'<p id="pe-claim-progress" style="color:rgba(255,255,255,.4);font-size:12px;margin:0">Claiming your gym — verification is next…</p>'
    +'</div>'
    +'<div id="pe-claim-err" style="display:none;color:#f87171;font-size:12px;margin-bottom:10px;text-align:center"></div>'
    +'<button id="pe-claim-submit" onclick="window._peSubmitClaim(\''+String(placeId).replace(/'/g,'')+'\')" style="display:none;width:100%;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(255,109,0,.3)">Try Again →</button>';
  _ctaOpenSheet(html);
  setTimeout(function(){window._peSubmitClaim(String(placeId));},250);
};

window._peSubmitClaim=async function(placeId){
  var btn=document.getElementById('pe-claim-submit');
  var err=document.getElementById('pe-claim-err');
  var prog=document.getElementById('pe-claim-progress');
  var showErr=function(m){if(err){err.textContent=m;err.style.display='block';}if(prog){prog.textContent='Something went wrong';}if(btn){btn.disabled=false;btn.style.display='block';btn.textContent='Try Again →';}};
  var u=(typeof state!=='undefined'&&state)?state.user:null;
  if(btn){btn.disabled=true;btn.style.display='none';}
  if(err){err.style.display='none';}
  if(prog){prog.textContent='Claiming your gym — verification is next…';}
  try{
    // Resolve to an internal gym id (db-123 rows are already internal; Places rows need ensure-gym)
    var gymId=null;
    var m=String(placeId).match(/^db-(\d+)$/);
    if(m){gymId=parseInt(m[1],10);}
    else{
      var er=await fetch('/api/live/ensure-gym',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({placeId:placeId})});
      var ed=await er.json().catch(function(){return{};});
      if(!er.ok||!ed.gymId)return showErr(ed.error||'Could not load this gym — try again');
      gymId=ed.gymId;
    }
    var r=await fetch('/api/gym-partner/claim',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({gymId:gymId,ownerName:u?(u.name||u.first_name||null):null,ownerEmail:u?(u.email||null):null,ownerPhone:u?(u.phone||null):null})});
    var d=await r.json().catch(function(){return{};});
    if(!r.ok||!d.success){
      if(r.status===409)return showErr('This gym is already verified by another owner. If it\'s yours, email hello@scangym.com');
      return showErr(d.error||'Claim failed — try again');
    }
    if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();
    _peToast(d.alreadyClaimed?'Already yours — verify ownership 🛡️':'Gym claimed! 🎉 Verifying ownership…');
    // Auto-trigger ownership verification after claim — always for THIS gym
    setTimeout(function(){
      _peLoadAndRender();
      // Trigger the batch3 ownership verification flow if available
      setTimeout(function(){
        if(typeof window._sgB3VerifyOwnership==='function'){
          window._sgB3VerifyOwnership(gymId);
        }
      },800);
    },600);
  }catch(e){showErr('Network error — try again');}
};

// ══════════════════════════════════════════════════════════════════════
// Share listing
// ══════════════════════════════════════════════════════════════════════

window._peShareListing=function(gymId,name){
  var url='https://scangym.com/gym/'+gymId;
  if(navigator.share){
    navigator.share({title:name+' on ScanGym',text:'Book a day pass at '+name,url:url}).catch(function(){});
  }else if(navigator.clipboard){
    navigator.clipboard.writeText(url).then(function(){_peToast('Link copied! 📋');});
  }else{
    _peToast('Link: '+url);
  }
};

// ══════════════════════════════════════════════════════════════════════
// Settings popup
// ══════════════════════════════════════════════════════════════════════

window._peOpenPartnerSettings=function(gymId){
  if(typeof _ctaOpenSheet!=='function')return;
  var html=''
    +'<div style="text-align:center;margin-bottom:16px">'
    +'<h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 4px">⚙️ Gym Settings</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Manage your gym listing</p>'
    +'</div>'

    +'<div onclick="_showPartnerScreen(5);_ctaCloseSheet()" style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;cursor:pointer;margin-bottom:8px">'
    +'<span style="font-size:20px">🏢</span><div style="flex:1"><div style="color:#fff;font-size:14px;font-weight:600">Manage Gym</div><div style="color:rgba(255,255,255,.35);font-size:11px">Edit details, amenities, capacity</div></div><span style="color:rgba(255,255,255,.3)">→</span></div>'

    +'<div onclick="_partnerConnectSeam();_ctaCloseSheet()" style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;cursor:pointer;margin-bottom:8px">'
    +'<span style="font-size:20px">🔐</span><div style="flex:1"><div style="color:#fff;font-size:14px;font-weight:600">Access Control</div><div style="color:rgba(255,255,255,.35);font-size:11px">Connect smart locks</div></div><span style="color:rgba(255,255,255,.3)">→</span></div>'

    +'<div onclick="_showPartnerScreen(6);_ctaCloseSheet()" style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;cursor:pointer;margin-bottom:8px">'
    +'<span style="font-size:20px">🚀</span><div style="flex:1"><div style="color:#fff;font-size:14px;font-weight:600">Growth Centre</div><div style="color:rgba(255,255,255,.35);font-size:11px">AI tips to boost revenue</div></div><span style="color:rgba(255,255,255,.3)">→</span></div>'

    +'<div onclick="_ctaCloseSheet();setTimeout(function(){window._peOpenClaimSearch();},350)" style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,109,0,.04);border:1px solid rgba(255,109,0,.12);border-radius:14px;cursor:pointer;margin-bottom:8px">'
    +'<span style="font-size:20px">➕</span><div style="flex:1"><div style="color:#FF6D00;font-size:14px;font-weight:600">Add Another Location</div><div style="color:rgba(255,255,255,.35);font-size:11px">Search & claim another gym</div></div><span style="color:rgba(255,255,255,.3)">→</span></div>';

  _ctaOpenSheet(html);
};

// ══════════════════════════════════════════════════════════════════════
// LOAD: Fetch gym data and render
// ══════════════════════════════════════════════════════════════════════

var _peAuthRetries=0;
async function _peLoadAndRender(){
  var u=state&&state.user;
  if(!u){
    // Auth may still be resolving (/api/auth/me in flight). Rendering the
    // claim card now would WIPE the native Partner Dashboard for a logged-in
    // owner — the "two partner screens" bug. Retry briefly before deciding.
    if(_peAuthRetries<12){
      _peAuthRetries++;
      setTimeout(_peLoadAndRender,400);
      return;
    }
    window._peGymsCache=[];
    _peRenderCards();
    return;
  }
  _peAuthRetries=0;

  try{
    var r=await fetch('/api/gym-partner/dashboard',{credentials:'include'});
    if(!r.ok){
      // Transient API error — don't wipe an owner's native dashboard.
      if(window._peGymsCache&&window._peGymsCache.length>0)return;
      window._peGymsCache=[];_peRenderCards();return;
    }
    var d=await r.json();
    window._peDashboardCache=d;

    if(d.hasGyms&&d.gyms&&d.gyms.length>0){
      // Owner has claimed gyms — keep the native Partner Dashboard page
      // (PartnerFullPage in the main bundle) as the ONE partner screen.
      // The old editable carousel takeover caused two competing screens.
      // Just cache the gyms for the popups and refresh the native page data.
      window._peGymsCache=d.gyms;
      if(typeof window._partnerLoadGymProfile==='function')window._partnerLoadGymProfile();
      return;
    }
    // No gyms claimed — show the "Claim Your Gym" card
    window._peGymsCache=[];
    _peRenderCards();
  }catch(e){
    console.error('[PartnerEditable] Load failed:',e.message);
    // Network error — keep whatever screen is showing rather than wiping it.
    if(window._peGymsCache&&window._peGymsCache.length>0)return;
    window._peGymsCache=[];
    _peRenderCards();
  }
}

// ══════════════════════════════════════════════════════════════════════
// PATCH: Override _showPartnerScreen to show our editable view on screen 0
// ══════════════════════════════════════════════════════════════════════

var _waitPatch=setInterval(function(){
  if(typeof _showPartnerScreen==='function'){
    clearInterval(_waitPatch);

    var _origShowPS=window._showPartnerScreen;
    window._showPartnerScreen=function(idx){
      _origShowPS(idx);
      // When showing home screen (0), replace with our editable Book-tab view
      if(idx===0){
        setTimeout(function(){_peLoadAndRender();},50);
      }
    };

    // NOTE: _partnerLoadHome is no longer overridden — the native
    // Partner Dashboard page is the single partner screen now.

    // Auto-render when partner tab first loads
    // Note: /partner route maps to activeTab='more', so check route instead
    var _lastRoute='';
    setInterval(function(){
      var route=state&&state.route;
      var isPartner=(route==='/partner'||route==='/partner/');
      // ── ONE PARTNER SCREEN sweep ──────────────────────────────────────
      // If the native dashboard is present, any .pe-view is a stale
      // duplicate screen — remove it. Also drop duplicate .tt-view copies
      // (keep the one inside the live #app main).
      if(isPartner){
        var nativeCard=document.getElementById('partner-profile-page');
        if(nativeCard&&nativeCard.innerHTML.length>50){
          document.querySelectorAll('.pe-view').forEach(function(v){v.remove();});
        }
        var views=document.querySelectorAll('.tt-view');
        if(views.length>1){
          var keep=document.querySelector('#app .sg-tab-content .tt-view')||views[0];
          views.forEach(function(v){if(v!==keep)v.remove();});
        }
      }
      if(isPartner&&_lastRoute!==route){
        _lastRoute=route;
        setTimeout(function(){_peLoadAndRender();},100);
        // Patch: hijack any tt-actions "Search" button so it opens the
        // partner claim-search overlay, not the Book-tab visitor search.
        setTimeout(function(){
          var acts=document.querySelectorAll('.tt-action');
          acts.forEach(function(a){
            if(a.textContent.indexOf('Search')!==-1&&a.getAttribute('onclick')&&a.getAttribute('onclick').indexOf('_openSearchOverlay')!==-1){
              a.setAttribute('onclick','event.stopPropagation();window._peOpenClaimSearch()');
            }
          });
        },200);
      }else if(!isPartner){
        _lastRoute=route;
      }
    },300);
  }
},200);

})();
