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

// #75/#76: AI Trainer Tab
function addAITrainerTab(){
  if(document.getElementById('sg-ait-btn'))return;
  injectStyle('sg-ait-s','.sg-ait-c{display:flex;flex-direction:column;height:100%;background:#0a0a14}.sg-ait-hd{padding:16px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:12px;flex-shrink:0}.sg-ait-ar{width:48px;height:48px;border-radius:50%;border:2px solid #FF6D00;display:flex;align-items:center;justify-content:center;font-size:24px;background:rgba(255,109,0,.1);animation:sgCasinoGlow 2s infinite;flex-shrink:0}.sg-ait-hd h3{color:#fff;font-size:15px;font-weight:700;margin:0}.sg-ait-hd p{color:rgba(255,255,255,.45);font-size:11px;margin:2px 0 0}.sg-ait-dot{width:8px;height:8px;background:#22c55e;border-radius:50%;display:inline-block;margin-right:4px}.sg-ait-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch;scrollbar-width:none}.sg-ait-msgs::-webkit-scrollbar{display:none}.sg-ait-m{max-width:85%;display:flex;flex-direction:column;gap:4px}.sg-ait-m.tr{align-self:flex-start}.sg-ait-m.us{align-self:flex-end}.sg-ait-b{padding:10px 14px;border-radius:18px;font-size:13px;line-height:1.5}.sg-ait-m.tr .sg-ait-b{background:rgba(255,255,255,.06);color:#e2e8f0;border-bottom-left-radius:4px}.sg-ait-m.us .sg-ait-b{background:#FF6D00;color:#fff;border-bottom-right-radius:4px}.sg-ait-t{font-size:10px;color:rgba(255,255,255,.3);padding:0 4px}.sg-ait-m.us .sg-ait-t{text-align:right}.sg-ait-pills{display:flex;gap:8px;overflow-x:auto;padding:8px 16px;flex-shrink:0;scrollbar-width:none}.sg-ait-pills::-webkit-scrollbar{display:none}.sg-ait-pill{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:7px 14px;font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent}.sg-ait-pill:active{background:rgba(255,109,0,.2);color:#FF6D00}.sg-ait-ir{display:flex;gap:10px;padding:12px 16px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(255,255,255,.06);flex-shrink:0;background:#0a0a14}.sg-ait-in{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:10px 16px;color:#fff;font-size:13px;outline:none;resize:none}.sg-ait-snd{width:40px;height:40px;background:#FF6D00;border:none;border-radius:50%;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}.sg-ait-snd:active{transform:scale(.9)}.sg-ait-typing{display:flex;gap:4px;align-items:center;padding:8px 14px;background:rgba(255,255,255,.06);border-radius:18px}.sg-ait-typing span{width:6px;height:6px;background:rgba(255,255,255,.4);border-radius:50%;animation:sgT .8s ease-in-out infinite}.sg-ait-typing span:nth-child(2){animation-delay:.15s}.sg-ait-typing span:nth-child(3){animation-delay:.3s}@keyframes sgT{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}');
  function injectTab(){
    var tb=document.querySelector('.sg-tab-bar');if(!tb||tb.querySelector('#sg-ait-btn'))return;
    var tab=document.createElement('div');tab.className='sg-tab-item';tab.id='sg-ait-btn';tab.setAttribute('role','tab');tab.setAttribute('aria-label','AI Trainer');
    tab.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M8 16c0-2.2 1.8-4 4-4s4 1.8 4 4"/><path d="M17 8c1.1 0 2 .9 2 2s-.9 2-2 2"/><path d="M7 8c-1.1 0-2 .9-2 2s.9 2 2 2"/></svg><span class="sg-tab-label">Trainer</span>';
    tab.addEventListener('click',function(){document.querySelectorAll('.sg-tab-item').forEach(function(t){t.classList.remove('active');});tab.classList.add('active');document.querySelectorAll('.sg-tab-content').forEach(function(c){c.style.display='none';});var rf=document.querySelector('.sg-reels-frame,#sg-reels-iframe');if(rf)rf.style.display='none';showAIT();});
    tb.appendChild(tab);
  }
  var _h=[],_ty=false;
  function showAIT(){
    var ex=document.getElementById('sg-ait-c2');if(ex){ex.style.display='flex';return;}
    var c=document.createElement('div');c.id='sg-ait-c2';c.className='sg-tab-content';c.style.cssText='display:flex!important;position:fixed;top:0;left:0;right:0;bottom:calc(56px + env(safe-area-inset-bottom,0px));z-index:10;';
    c.innerHTML='<div class="sg-ait-c"><div class="sg-ait-hd"><div class="sg-ait-ar">\u{1F916}</div><div><h3>ScanGym AI Trainer</h3><p><span class="sg-ait-dot"></span>Online \u00b7 Gemini AI</p></div></div><div class="sg-ait-msgs" id="sg-ait-msgs2"><div class="sg-ait-m tr"><div class="sg-ait-b">\u{1F4AA} Hey! I\'m your personal AI trainer. I create workout plans, tell you what weight to lift, and can book a gym for you. What\'s your main goal?</div><div class="sg-ait-t">Now</div></div></div><div class="sg-ait-pills"><div class="sg-ait-pill" onclick="sgAITS2(\'Build muscle\')">Build muscle</div><div class="sg-ait-pill" onclick="sgAITS2(\'Lose fat \u2014 what to do?\')">Lose fat</div><div class="sg-ait-pill" onclick="sgAITS2(\'How much weight should I lift?\')">Weight guide</div><div class="sg-ait-pill" onclick="sgAITS2(\'Why not progressing?\')">\'\u{1F4C9} Progress</div><div class="sg-ait-pill" onclick="sgAITS2(\'Book me a gym near Manchester\')">\'\u{1F4CD} Book gym</div></div><div class="sg-ait-ir"><textarea class="sg-ait-in" id="sg-ait-in2" placeholder="Ask anything..." rows="1"></textarea><button class="sg-ait-snd" onclick="sgAITSubmit2()">\u27A4</button></div></div>';
    document.body.appendChild(c);
    var inp=document.getElementById('sg-ait-in2');if(inp)inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sgAITSubmit2();}});
  }
  window.sgAITS2=function(msg){var i=document.getElementById('sg-ait-in2');if(i){i.value=msg;sgAITSubmit2();}};
  window.sgAITSubmit2=async function(){
    if(_ty)return;var inp=document.getElementById('sg-ait-in2'),msgs=document.getElementById('sg-ait-msgs2');if(!inp||!msgs)return;
    var text=inp.value.trim();if(!text)return;inp.value='';
    var now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    var um=document.createElement('div');um.className='sg-ait-m us';um.innerHTML='<div class="sg-ait-b">'+text.replace(/</g,'&lt;')+'</div><div class="sg-ait-t">'+now+'</div>';msgs.appendChild(um);
    var te=document.createElement('div');te.className='sg-ait-m tr';te.id='sg-ait-ty2';te.innerHTML='<div class="sg-ait-typing"><span></span><span></span><span></span></div>';msgs.appendChild(te);msgs.scrollTop=msgs.scrollHeight;
    _ty=true;_h.push({role:'user',content:text});
    try{
      var r=await fetch('/api/ai-trainer/chat',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({message:text,history:_h.slice(-6)})});
      var d=await r.json();var reply=d.reply||'Tell me your goal! \u{1F4AA}';
      _h.push({role:'assistant',content:reply});
      var ty=document.getElementById('sg-ait-ty2');if(ty)ty.remove();
      var tm=document.createElement('div');tm.className='sg-ait-m tr';tm.innerHTML='<div class="sg-ait-b">'+reply.replace(/</g,'&lt;').replace(/\n/g,'<br>')+'</div><div class="sg-ait-t">'+now+'</div>';
      msgs.appendChild(tm);msgs.scrollTop=msgs.scrollHeight;
      if(d.actions&&d.actions.includes('book_gym')){var ab=document.createElement('div');ab.style.cssText='margin-top:8px;padding:10px 16px;background:#FF6D00;border-radius:12px;color:#fff;font-weight:700;font-size:13px;cursor:pointer;text-align:center';ab.textContent='\u{1F3CB}\uFE0F Book a Gym \u2192';ab.addEventListener('click',function(){var bt=document.querySelector('.sg-tab-item:nth-child(2)');if(bt)bt.click();});msgs.appendChild(ab);msgs.scrollTop=msgs.scrollHeight;}
    }catch(e){
      var ty2=document.getElementById('sg-ait-ty2');if(ty2)ty2.remove();
      var em=document.createElement('div');em.className='sg-ait-m tr';em.innerHTML='<div class="sg-ait-b">Quick hiccup \u2014 try again! Tip: progressive overload (add 2.5kg/week) = guaranteed results. \u{1F4AA}</div>';
      msgs.appendChild(em);msgs.scrollTop=msgs.scrollHeight;
    }
    _ty=false;
  };
  injectTab();var obs=new MutationObserver(injectTab);obs.observe(document.body,{childList:true,subtree:false});setTimeout(function(){obs.disconnect();},20000);
}

// #98/#99/#100: Gym Owner Quick Controls
function addOwnerControls(){
  injectStyle('sg-oq-s','.sg-oq-p{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-bottom:12px}.sg-oq-tb{width:100%;padding:16px;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:all .2s}.sg-oq-tb.open{background:rgba(34,197,94,.15);border:2px solid rgba(34,197,94,.4);color:#22c55e}.sg-oq-tb.closed{background:rgba(239,68,68,.1);border:2px solid rgba(239,68,68,.3);color:#f87171}.sg-oq-pr{display:flex;gap:10px;margin-top:12px;align-items:center}.sg-oq-pi{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;color:#fff;font-size:16px;font-weight:700;text-align:center;outline:none}.sg-oq-pb{padding:10px 18px;background:#FF6D00;border:none;border-radius:10px;color:#fff;font-weight:700;font-size:14px;cursor:pointer}');
  window.sgOwnerQuickToggle=async function(id,btn){var open=btn.classList.contains('closed');try{var r=await fetch('/api/gym-mgmt/'+id+'/quick-toggle',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({isOpen:open})});var d=await r.json();if(d.success){btn.className='sg-oq-tb '+(open?'open':'closed');btn.textContent=open?'\u{1F7E2} GYM IS OPEN':'\u{1F534} GYM IS CLOSED';if(window.sgToast)sgToast(d.message,'success');}else{if(window.sgToast)sgToast(d.error||'Failed','error');}}catch(e){if(window.sgToast)sgToast('Connection error','error');};};
  window.sgOwnerQuickPrice=async function(id){var inp=document.getElementById('sg-oq-pi-'+id);if(!inp)return;var price=parseFloat(inp.value);if(!price||isNaN(price)){if(window.sgToast)sgToast('Enter valid price','error');return;}try{var r=await fetch('/api/gym-mgmt/'+id+'/quick-price',{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({price})});var d=await r.json();if(d.success){if(window.sgToast)sgToast(d.message,'success');}else{if(window.sgToast)sgToast(d.error||'Failed','error');}}catch(e){if(window.sgToast)sgToast('Connection error','error');};};
  function inj(){var os=document.querySelector('#sg-owner-controls,[class*="owner-controls"]');if(!os||os.querySelector('.sg-oq-p'))return;var id=(window.state&&(window.state.currentGym||window.state.ownedGym)&&((window.state.currentGym||window.state.ownedGym).id||''))||'';if(!id)return;var isO=(window.state.currentGym||window.state.ownedGym||{}).openNow!==false;var p=document.createElement('div');p.className='sg-oq-p';p.innerHTML='<div style="color:rgba(255,255,255,.5);font-size:10px;font-weight:700;margin-bottom:8px">QUICK CONTROLS</div><button class="sg-oq-tb '+(isO?'open':'closed')+'" onclick="sgOwnerQuickToggle(\''+id+'\',this)">'+(isO?'\u{1F7E2} GYM IS OPEN':'\u{1F534} GYM IS CLOSED')+'</button><div class="sg-oq-pr"><span style="color:rgba(255,255,255,.5);font-size:14px">\u00a3</span><input class="sg-oq-pi" id="sg-oq-pi-'+id+'" type="number" min="3" max="50" step="0.5" placeholder="Day pass price"><button class="sg-oq-pb" onclick="sgOwnerQuickPrice(\''+id+'\')" >Set Price</button></div>';os.insertBefore(p,os.firstChild);}
  inj();new MutationObserver(inj).observe(document.body,{childList:true,subtree:true});
}

function init(){initVisitorCounter();addAITrainerTab();addOwnerControls();console.log('[ScanGym Patches v3] #62 #75 #76 #98 #99 #100');}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{setTimeout(init,600);}
})();
