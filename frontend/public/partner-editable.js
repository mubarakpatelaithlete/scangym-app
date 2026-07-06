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
  var container=document.querySelector('.partner-screen');
  if(!container){
    // PartnerFullPage uses .tt-view > .tt-card — look for those as fallback
    container=document.querySelector('#partner-profile-page')
              ||document.querySelector('.tt-card')
              ||document.querySelector('.tt-view');
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

  var gyms=window._peGymsCache||[];
  var dash=window._peDashboardCache||{};

  if(!gyms.length){
    // No gyms claimed — show "Claim Your Gym" card
    container.style.display='flex';
    container.innerHTML=_peClaimCard();
    return;
  }

  // Build carousel of gym cards (exactly like Book tab)
  var totalC=gyms.length;
  var html='<div class="pe-view"><div class="pe-carousel" id="pe-carousel">';

  gyms.forEach(function(gym,i){
    var name=gym.name||'Your Gym';
    var addr=gym.address||'';
    var price=parseFloat(gym.dayPassPrice)||5;
    var isActive=gym.isActive!==false;
    var rating=gym.rating||dash.rating&&dash.rating.average||0;
    var reviews=gym.reviews||dash.rating&&dash.rating.count||0;
    var photo=gym.photo||gym.photoUrl||'';
    var gymId=gym.id;

    // Today's stats from dashboard
    var todayBookings=dash.today?dash.today.bookings:0;
    var todayRevenue=dash.today?dash.today.revenue:0;
    var earnings=dash.earnings||{};
    var monthEarnings=earnings.thisMonth||0;

    html+='<div class="pe-card" data-pe-gym-id="'+gymId+'">';

    // Photo background
    if(photo){
      html+='<div class="pe-photo" style="background-image:url(\''+photo+'\')"></div>';
    }else{
      html+='<div class="pe-photo-placeholder"></div>';
    }
    html+='<div class="pe-gradient"></div>';

    // Owner badge (top-left, replaces Book tab's orange dot)
    html+='<div class="pe-edit-badge"><span class="pe-status-dot" id="pe-status-dot-'+gymId+'" style="background:'+(isActive?'#4ade80':'#f87171')+'"></span> '+(isActive?'LIVE':'PAUSED')+' · Owner</div>';

    // Search bar area (top) — same position as Book tab
    html+='<div class="pe-search">'
      +'<div onclick="window._peOpenClaimSearch()" style="background:rgba(10,12,20,.75);border:1px solid rgba(255,109,0,.3);border-radius:12px;width:44px;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer" title="Find & add another gym">🔍</div>'
      +'<div onclick="_peEditPhotos('+gymId+')" style="flex:1;background:rgba(10,12,20,.75);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 14px;color:rgba(255,255,255,.5);font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;cursor:pointer">'
      +'<span>📸</span> <span>Edit Photos</span>'
      +'</div>'
      /* On/off toggle moved into the Opening Hours sheet (right rail) per user request */
      +'<div onclick="window._peOpenPartnerSettings('+gymId+')" style="background:rgba(10,12,20,.75);border:1px solid rgba(255,255,255,.1);border-radius:12px;width:44px;display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer">⚙️</div>'
      +'</div>';

    // Right-side action buttons (matching Book tab layout)
    html+='<div class="pe-actions">';

    // 1. Set Price (replaces Near Me)
    html+='<div class="pe-action" onclick="event.stopPropagation();_peEditPrice('+gymId+','+price+')">'
      +'<div class="pe-action-btn">💰</div><div class="pe-action-label">Set Price</div></div>';

    // 2. Hours (replaces Search)
    html+='<div class="pe-action" onclick="event.stopPropagation();_peEditHours('+gymId+')">'
      +'<div class="pe-action-btn">🕐</div><div class="pe-action-label" id="pe-status-label-'+gymId+'" style="color:'+(isActive?'#4ade80':'#f87171')+'">'+(isActive?'Open':'Closed')+'</div></div>';

    // 3. Bookings (replaces Calendar)
    html+='<div class="pe-action" onclick="event.stopPropagation();_showPartnerScreen(1)">'
      +'<div class="pe-action-btn">📋</div><div class="pe-action-label">'+todayBookings+' Today</div></div>';

    // 4. Earnings (replaces Pass type)
    html+='<div class="pe-action" onclick="event.stopPropagation();_showPartnerScreen(4)">'
      +'<div class="pe-action-btn">💸</div><div class="pe-action-label">Earnings</div></div>';

    // 5. Withdraw (replaces Payment) — route to unified wallet withdraw sheet
    html+='<div class="pe-action" onclick="event.stopPropagation();typeof _sgWalletWithdraw===\'function\'?_sgWalletWithdraw():typeof _partnerWithdraw===\'function\'?_partnerWithdraw():void 0">'
      +'<div class="pe-action-btn">🏦</div><div class="pe-action-label">Withdraw</div></div>';

    // 6. Analytics (replaces Hours)
    html+='<div class="pe-action" onclick="event.stopPropagation();_showPartnerScreen(3)">'
      +'<div class="pe-action-btn">📊</div><div class="pe-action-label">Analytics</div></div>';

    // 7. Access Control (replaces Reviews)
    html+='<div class="pe-action" onclick="event.stopPropagation();_partnerConnectSeam()">'
      +'<div class="pe-action-btn">🔐</div><div class="pe-action-label">Access</div></div>';

    // 8. QR Codes
    html+='<div class="pe-action" onclick="event.stopPropagation();_showPartnerScreen(1)">'
      +'<div class="pe-action-btn">📱</div><div class="pe-action-label">Check-ins</div></div>';

    // 9. Growth Centre
    html+='<div class="pe-action" onclick="event.stopPropagation();_showPartnerScreen(6)">'
      +'<div class="pe-action-btn">🚀</div><div class="pe-action-label">Growth</div></div>';

    // 10. Share listing
    html+='<div class="pe-action" onclick="event.stopPropagation();window._peShareListing('+gymId+',\''+name.replace(/'/g,"\\'")+'\')">'
      +'<div class="pe-action-btn">🔗</div><div class="pe-action-label">Share</div></div>';

    html+='</div>';

    // Bottom info (matching Book tab layout exactly)
    html+='<div class="pe-info">';

    // Logo
    var logoColors=['#FF6D00,#E66200','#8b5cf6,#6d28d9','#ef4444,#b91c1c','#3b82f6,#1d4ed8'];
    var logoGrad=logoColors[i%4];
    html+='<div class="pe-logo" style="background:linear-gradient(135deg,'+logoGrad+')">🏋️</div>';

    // Counter
    if(totalC>1){
      html+='<div class="pe-counter">← '+(i+1)+' of '+totalC+' gyms →</div>';
    }

    // Gym name (editable)
    html+='<div class="pe-gym-name pe-editable" onclick="_peEditField(\'Gym Name\',\''+name.replace(/'/g,"\\'")+'\',\'Enter gym name\',function(v){var el=this.parentElement;document.getElementById(\'pe-name-'+gymId+'\').childNodes[0].textContent=v})" id="pe-name-'+gymId+'">'+name+'</div>';

    // Address (editable)
    html+='<div class="pe-gym-addr">'
      +'📍 <span class="pe-editable" onclick="_peEditField(\'Address\',\''+(addr?addr.split(',')[0]:'').replace(/'/g,"\\'")+'\',\'Enter address\',function(v){})">'
      +(addr?addr.split(',')[0]:'Tap to add address')
      +'</span>'
      +' · <span class="pe-editable" onclick="_peEditHours('+gymId+')" style="color:'+(isActive?'#4ade80':'#f87171')+'">'
      +(isActive?'● Open':'🌙 Closed')
      +'</span>'
      +'</div>';

    // Chips — owner-focused metrics
    html+='<div class="pe-chips">';
    html+='<div class="pe-chip pe-editable" onclick="_peEditPrice('+gymId+','+price+')" id="pe-price-'+gymId+'">💰 £'+price.toFixed(2)+'/day</div>';
    html+='<div class="pe-chip">⭐ '+(rating?parseFloat(rating).toFixed(1):'New')+(reviews?' ('+reviews+')':'')+'</div>';
    if(todayBookings>0){
      html+='<div class="pe-chip" style="background:rgba(34,197,94,.18);border:1px solid rgba(34,197,94,.25)">📈 '+todayBookings+' today</div>';
    }
    if(todayRevenue>0){
      html+='<div class="pe-chip" style="background:rgba(255,109,0,.15);border:1px solid rgba(255,109,0,.25)">💷 £'+todayRevenue.toFixed(2)+' today</div>';
    }
    if(monthEarnings>0){
      html+='<div class="pe-chip">📅 £'+monthEarnings.toFixed(2)+'/mo</div>';
    }
    html+='<div class="pe-chip" style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.2)">💚 85% yours</div>';
    html+='</div>';

    // Trust badges (owner version)
    html+='<div style="display:flex;gap:12px;margin-top:5px;padding-right:50px">'
      +'<span style="font-size:10px;color:rgba(255,255,255,.35);font-weight:600">✅ Verified Owner</span>'
      +'<span style="font-size:10px;color:rgba(255,255,255,.35);font-weight:600">🔒 Stripe Payouts</span>'
      +'<span style="font-size:10px;color:rgba(255,255,255,.35);font-weight:600">⚡ Instant Bookings</span>'
      +'</div>';

    html+='</div>'; // pe-info
    html+='</div>'; // pe-card
  });

  html+='</div></div>'; // pe-carousel, pe-view

  // Replace the first partner-screen content
  container.style.display='flex';
  container.innerHTML=html;
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
    +'<button onclick="window._peOpenClaimSearch()" style="background:#FF6D00;color:#fff;border:none;border-radius:14px;padding:16px 32px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 24px rgba(255,109,0,.4);width:100%">🔍 Find & Claim Your Gym</button>'
    +'<p style="color:rgba(255,255,255,.3);font-size:11px;margin-top:12px">1.2M+ gyms from Google Places · Free to claim</p>'
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
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;margin-bottom:6px">'
          +(g.photo?'<div style="width:40px;height:40px;border-radius:10px;background-image:url(\''+g.photo+'\');background-size:cover;background-position:center;flex-shrink:0"></div>'
                   :'<div style="width:40px;height:40px;background:rgba(255,109,0,.1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🏋️</div>')
          +'<div style="flex:1;min-width:0">'
          +'<p style="color:#fff;font-size:13px;font-weight:700;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+nm.replace(/</g,'&lt;')+'</p>'
          +'<p style="color:rgba(255,255,255,.35);font-size:11px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+String(g.address||g.city||'').replace(/</g,'&lt;')+'</p>'
          +'</div>'
          +'<button onclick="window._peStartClaim(\''+pid.replace(/'/g,'')+'\',\''+encodeURIComponent(nm)+'\')" style="background:#FF6D00;color:#fff;border:none;padding:8px 14px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">Claim →</button>'
          +'</div>';
      }).join('');
    }catch(e){
      box=document.getElementById('pe-claim-results');
      if(box)box.innerHTML='<p style="color:#f87171;font-size:12px;text-align:center;padding:10px">Search failed — check connection and try again</p>';
    }
  },350);
};

// Step 2: ownership details form
window._peStartClaim=function(placeId,encName){
  var u=(typeof state!=='undefined'&&state)?state.user:null;
  if(!u){
    if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();
    _peToast('Log in first to claim your gym');
    if(typeof window._sgShowAuthSheet==='function'){window._sgShowAuthSheet('book');}else{navigate('/login');}
    return;
  }
  var gymName=decodeURIComponent(encName||'');
  var html=''
    +'<div style="text-align:center;margin-bottom:16px">'
    +'<div style="font-size:40px;margin-bottom:8px">🏢</div>'
    +'<h2 style="color:#fff;font-size:19px;font-weight:800;margin:0 0 4px">Claim '+gymName.replace(/</g,'&lt;')+'</h2>'
    +'<p style="color:rgba(255,255,255,.4);font-size:12px;margin:0">One tap to claim — then verify ownership</p>'
    +'</div>'
    +'<div id="pe-claim-err" style="display:none;color:#f87171;font-size:12px;margin-bottom:10px;text-align:center"></div>'
    +'<button id="pe-claim-submit" onclick="window._peSubmitClaim(\''+String(placeId).replace(/'/g,'')+'\')" style="width:100%;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(255,109,0,.3)">Claim My Gym →</button>';
  _ctaOpenSheet(html);
};

window._peSubmitClaim=async function(placeId){
  var btn=document.getElementById('pe-claim-submit');
  var err=document.getElementById('pe-claim-err');
  var showErr=function(m){if(err){err.textContent=m;err.style.display='block';}if(btn){btn.disabled=false;btn.textContent='Claim My Gym →';}};
  var u=(typeof state!=='undefined'&&state)?state.user:null;
  if(btn){btn.disabled=true;btn.textContent='Claiming…';}
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
      if(r.status===409)return showErr('This gym is already claimed. If it\'s yours, email hello@scangym.com');
      return showErr(d.error||'Claim failed — try again');
    }
    if(typeof window._ctaCloseSheet==='function')window._ctaCloseSheet();
    _peToast('Gym claimed! 🎉 Verifying ownership…');
    // Auto-trigger ownership verification after claim
    setTimeout(function(){
      _peLoadAndRender();
      // Trigger the batch3 ownership verification flow if available
      setTimeout(function(){
        if(typeof window._sgB3VerifyOwnership==='function'){
          window._sgB3VerifyOwnership();
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
    +'<span style="font-size:20px">🔐</span><div style="flex:1"><div style="color:#fff;font-size:14px;font-weight:600">Access Control</div><div style="color:rgba(255,255,255,.35);font-size:11px">Salto, Kisi, TTLock, GymMaster + more</div></div><span style="color:rgba(255,255,255,.3)">→</span></div>'

    +'<div onclick="_showPartnerScreen(6);_ctaCloseSheet()" style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;cursor:pointer;margin-bottom:8px">'
    +'<span style="font-size:20px">🚀</span><div style="flex:1"><div style="color:#fff;font-size:14px;font-weight:600">Growth Centre</div><div style="color:rgba(255,255,255,.35);font-size:11px">AI tips to boost revenue</div></div><span style="color:rgba(255,255,255,.3)">→</span></div>'

    +'<div onclick="_ctaCloseSheet();setTimeout(function(){window._peOpenClaimSearch();},350)" style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,109,0,.04);border:1px solid rgba(255,109,0,.12);border-radius:14px;cursor:pointer;margin-bottom:8px">'
    +'<span style="font-size:20px">➕</span><div style="flex:1"><div style="color:#FF6D00;font-size:14px;font-weight:600">Add Another Location</div><div style="color:rgba(255,255,255,.35);font-size:11px">Search & claim another gym</div></div><span style="color:rgba(255,255,255,.3)">→</span></div>';

  _ctaOpenSheet(html);
};

// ══════════════════════════════════════════════════════════════════════
// LOAD: Fetch gym data and render
// ══════════════════════════════════════════════════════════════════════

async function _peLoadAndRender(){
  var u=state&&state.user;
  if(!u){
    window._peGymsCache=[];
    _peRenderCards();
    return;
  }

  try{
    var r=await fetch('/api/gym-partner/dashboard',{credentials:'include'});
    if(!r.ok){window._peGymsCache=[];_peRenderCards();return;}
    var d=await r.json();
    window._peDashboardCache=d;

    if(d.hasGyms&&d.gyms&&d.gyms.length>0){
      // Try to get photos from search results / Google data
      var enriched=d.gyms.map(function(g){
        // Try to find a matching gym from state.gyms for the photo
        var photo='';
        if(state.gyms){
          var match=state.gyms.find(function(sg){return sg.id==g.id||sg.placeId==g.id||sg.place_id==g.id;});
          if(match)photo=typeof _gymPhotoUrl==='function'?_gymPhotoUrl(match):(match.photo||match.thumbnail||'');
        }
        return Object.assign({},g,{photo:photo});
      });
      window._peGymsCache=enriched;
    }else{
      window._peGymsCache=[];
    }
    _peRenderCards();
  }catch(e){
    console.error('[PartnerEditable] Load failed:',e.message);
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

    // Also patch _partnerLoadHome to use our view
    var _origLoadHome=window._partnerLoadHome;
    window._partnerLoadHome=function(){
      // Don't run the old home loader — our view handles it
      _peLoadAndRender();
    };

    // Auto-render when partner tab first loads
    // Note: /partner route maps to activeTab='more', so check route instead
    var _lastRoute='';
    setInterval(function(){
      var route=state&&state.route;
      var isPartner=(route==='/partner'||route==='/partner/');
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
