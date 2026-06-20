// ═══════════════════════════════════════════════════════════════
// LAYER 2: MY CHANNELS — Connect messaging platforms to ScanGym
// ═══════════════════════════════════════════════════════════════

function ChannelsPage(){
  // Kick off data load
  setTimeout(function(){_loadChannels();},100);

  return`<div style="max-width:480px;margin:0 auto;padding:20px 16px 100px">
    <div class="sg-more-back" onclick="navigate('/more')">← Back</div>

    <!-- Header -->
    <div style="margin-bottom:24px">
      <h1 style="font-size:22px;font-weight:900;color:#fff;margin:0 0 4px">📡 My Channels</h1>
      <p style="color:rgba(255,255,255,.4);font-size:13px;margin:0">Connect your favourite apps to search & book gyms</p>
    </div>

    <!-- Stats bar -->
    <div id="ch-stats" style="display:flex;gap:10px;margin-bottom:20px">
      <div style="flex:1;background:rgba(255,109,0,.08);border:1px solid rgba(255,109,0,.15);border-radius:14px;padding:14px;text-align:center">
        <div style="color:#FF6D00;font-size:22px;font-weight:900" id="ch-connected-count">–</div>
        <div style="color:rgba(255,255,255,.35);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Connected</div>
      </div>
      <div style="flex:1;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.15);border-radius:14px;padding:14px;text-align:center">
        <div style="color:#22c55e;font-size:22px;font-weight:900" id="ch-available-count">–</div>
        <div style="color:rgba(255,255,255,.35);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Available</div>
      </div>
      <div style="flex:1;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.15);border-radius:14px;padding:14px;text-align:center">
        <div style="color:#3b82f6;font-size:22px;font-weight:900" id="ch-total-count">–</div>
        <div style="color:rgba(255,255,255,.35);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Total</div>
      </div>
    </div>

    <!-- Connected channels section -->
    <div id="ch-connected-section" style="display:none;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.3);margin-bottom:8px;padding-left:4px">✅ Connected</div>
      <div id="ch-connected-list"></div>
    </div>

    <!-- Available channels section -->
    <div id="ch-available-section" style="margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.3);margin-bottom:8px;padding-left:4px">🔗 Available to Connect</div>
      <div id="ch-available-list">
        <!-- Skeleton loaders -->
        <div style="background:rgba(255,255,255,.04);border-radius:14px;padding:16px;margin-bottom:8px;height:72px;animation:skeletonPulse 1.8s ease-in-out infinite"></div>
        <div style="background:rgba(255,255,255,.04);border-radius:14px;padding:16px;margin-bottom:8px;height:72px;animation:skeletonPulse 1.8s ease-in-out infinite;animation-delay:.2s"></div>
        <div style="background:rgba(255,255,255,.04);border-radius:14px;padding:16px;margin-bottom:8px;height:72px;animation:skeletonPulse 1.8s ease-in-out infinite;animation-delay:.4s"></div>
      </div>
    </div>

    <!-- Coming soon section -->
    <div id="ch-coming-section" style="display:none;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.3);margin-bottom:8px;padding-left:4px">🔮 Coming Soon</div>
      <div id="ch-coming-list"></div>
    </div>

    <!-- Info card -->
    <div style="background:rgba(255,109,0,.06);border:1px solid rgba(255,109,0,.12);border-radius:16px;padding:16px;display:flex;gap:12px;align-items:flex-start">
      <span style="font-size:24px">💡</span>
      <div>
        <p style="color:#FF6D00;font-size:13px;font-weight:700;margin:0 0 4px">How it works</p>
        <p style="color:rgba(255,255,255,.4);font-size:12px;line-height:1.6;margin:0">Connect a channel → get a welcome message → search & book gyms right from that app. Your conversations sync across all channels.</p>
      </div>
    </div>
  </div>`;
}

// ─── Load channels from API ─────────────────────────────────
window._loadChannels=async function(){
  try{
    var r=await fetch('/api/channels');
    var data=await r.json();
    if(!data.channels)return;

    // Update stats
    document.getElementById('ch-connected-count').textContent=data.stats.connected;
    document.getElementById('ch-available-count').textContent=data.stats.available;
    document.getElementById('ch-total-count').textContent=data.stats.total;

    var connected=data.channels.filter(function(c){return c.connected;});
    var available=data.channels.filter(function(c){return !c.connected&&c.status==='active';});
    var coming=data.channels.filter(function(c){return c.status==='coming_soon';});

    // Connected channels
    if(connected.length){
      document.getElementById('ch-connected-section').style.display='block';
      document.getElementById('ch-connected-list').innerHTML=connected.map(function(ch){
        var since=ch.connection&&ch.connection.connectedAt?new Date(ch.connection.connectedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'Just now';
        var username=ch.connection&&ch.connection.channelUsername?'@'+ch.connection.channelUsername:'';
        return'<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,.04);border-radius:14px;margin-bottom:6px;border:1px solid rgba(34,197,94,.15)">'
          +'<div style="width:44px;height:44px;background:'+ch.color+'18;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">'+ch.icon+'</div>'
          +'<div style="flex:1;min-width:0">'
          +'<div style="display:flex;align-items:center;gap:6px"><span style="color:#fff;font-size:14px;font-weight:700">'+ch.name+'</span><span style="background:rgba(34,197,94,.15);color:#22c55e;font-size:9px;font-weight:800;padding:2px 8px;border-radius:6px;text-transform:uppercase">Connected</span></div>'
          +'<p style="color:rgba(255,255,255,.35);font-size:11px;margin:2px 0 0">'+username+(username?' · ':'')+since+'</p>'
          +'</div>'
          +'<button onclick="_disconnectChannel(\''+ch.id+'\',this)" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:8px 12px;color:#ef4444;font-size:11px;font-weight:700;cursor:pointer">Disconnect</button>'
          +'</div>';
      }).join('');
    }

    // Available channels
    document.getElementById('ch-available-list').innerHTML=available.length?available.map(function(ch){
      return'<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,.04);border-radius:14px;margin-bottom:6px;border:1px solid rgba(255,255,255,.04);cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent" onclick="_connectChannel(\''+ch.id+'\',\''+ch.name+'\',\''+ch.icon+'\',\''+ch.color+'\')">'
        +'<div style="width:44px;height:44px;background:'+ch.color+'18;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">'+ch.icon+'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<p style="color:#fff;font-size:14px;font-weight:700;margin:0">'+ch.name+'</p>'
        +'<p style="color:rgba(255,255,255,.35);font-size:11px;margin:2px 0 0">'+ch.description+'</p>'
        +'</div>'
        +'<div style="background:'+ch.color+'20;border:1px solid '+ch.color+'40;border-radius:10px;padding:8px 14px;color:'+ch.color+';font-size:12px;font-weight:700;flex-shrink:0">Connect</div>'
        +'</div>';
    }).join(''):'<p style="color:rgba(255,255,255,.3);font-size:13px;text-align:center;padding:20px">All active channels connected! 🎉</p>';

    // Coming soon
    if(coming.length){
      document.getElementById('ch-coming-section').style.display='block';
      document.getElementById('ch-coming-list').innerHTML=coming.map(function(ch){
        return'<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,.02);border-radius:14px;margin-bottom:6px;border:1px solid rgba(255,255,255,.04);opacity:.6">'
          +'<div style="width:44px;height:44px;background:'+ch.color+'10;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">'+ch.icon+'</div>'
          +'<div style="flex:1;min-width:0">'
          +'<p style="color:#fff;font-size:14px;font-weight:700;margin:0">'+ch.name+'</p>'
          +'<p style="color:rgba(255,255,255,.35);font-size:11px;margin:2px 0 0">'+ch.description+'</p>'
          +'</div>'
          +'<span style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 12px;color:rgba(255,255,255,.3);font-size:11px;font-weight:600;flex-shrink:0">Soon</span>'
          +'</div>';
      }).join('');
    }

  }catch(e){
    console.error('[Channels] Load error:',e);
    document.getElementById('ch-available-list').innerHTML='<p style="color:rgba(255,255,255,.3);font-size:13px;text-align:center;padding:20px">Failed to load channels. Try again.</p>';
  }
};

// ─── Connect channel — show bottom sheet modal ──────────────
window._connectChannel=function(channelId,channelName,channelIcon,channelColor){
  if(!state.user){navigate('/login');return;}

  var instructions={
    telegram:{
      steps:['Tap the button below to open Telegram','Press START in the bot','Done! You\'re connected 🎉'],
      action:'_connectTelegram()',
      actionText:'Open Telegram Bot ✈️',
      note:'You\'ll be redirected to the ScanGym bot on Telegram'
    },
    whatsapp:{
      steps:['Tap the button below to open WhatsApp','Send "Hi" to the ScanGym number','Done! You\'re connected 🎉'],
      action:'_connectWhatsApp()',
      actionText:'Open WhatsApp Chat 💬',
      note:'You\'ll message the ScanGym WhatsApp number'
    },
    discord:{
      steps:['Tap the button below to add the bot','Select your Discord server','Send "help" to the bot'],
      action:'_connectDiscord()',
      actionText:'Add Discord Bot 🎮',
      note:'The bot will be added to your Discord server'
    },
    sms:{
      steps:['Your phone number is already linked','Send "help" to the ScanGym number','Start booking gyms via text!'],
      action:'_connectSMS()',
      actionText:'Connect SMS 📱',
      note:'Uses your registered phone number'
    },
    email:{
      steps:['Your email is already linked','Send an email to book@scangym.com','We\'ll reply with gym results!'],
      action:'_connectEmail()',
      actionText:'Connect Email 📧',
      note:'Uses your registered email address'
    }
  };

  var info=instructions[channelId]||{steps:['Tap Connect','Follow the setup wizard','Done!'],action:'',actionText:'Connect',note:''};

  sgBottomPopup('Connect '+channelName,
    '<div style="margin-bottom:20px">'
    // Channel icon + name
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">'
    +'<div style="width:56px;height:56px;background:'+channelColor+'18;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:28px">'+channelIcon+'</div>'
    +'<div><p style="color:#fff;font-size:18px;font-weight:800;margin:0">'+channelName+'</p><p style="color:rgba(255,255,255,.4);font-size:12px;margin:2px 0 0">3 easy steps</p></div>'
    +'</div>'
    // Steps
    +'<div style="margin-bottom:20px">'
    +info.steps.map(function(step,i){
      var stepColors=['#FF6D00','#3b82f6','#22c55e'];
      return'<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">'
        +'<div style="width:28px;height:28px;background:'+stepColors[i]+'20;border:1px solid '+stepColors[i]+'40;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:'+stepColors[i]+';flex-shrink:0">'+(i+1)+'</div>'
        +'<p style="color:#fff;font-size:14px;line-height:1.5;margin:0;padding-top:3px">'+step+'</p></div>';
    }).join('')
    +'</div>'
    // Note
    +(info.note?'<p style="color:rgba(255,255,255,.3);font-size:11px;margin:0 0 16px;padding-left:40px">'+info.note+'</p>':'')
    // Action button
    +'<button id="ch-connect-btn" onclick="'+info.action+'" style="width:100%;background:linear-gradient(135deg,'+channelColor+','+channelColor+'cc);color:#fff;border:none;padding:16px;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px '+channelColor+'40">'+info.actionText+'</button>'
    // Cancel
    +'<button onclick="document.getElementById(\'sg-bottom-popup\').remove()" style="width:100%;background:none;border:none;color:rgba(255,255,255,.4);padding:12px;font-size:13px;cursor:pointer;margin-top:8px">Cancel</button>'
    +'</div>'
  );
};

// ─── Channel-specific connect flows ─────────────────────────

window._connectTelegram=async function(){
  var btn=document.getElementById('ch-connect-btn');
  btn.textContent='Getting link...';btn.disabled=true;
  try{
    var r=await fetch('/api/channels/telegram/deeplink');
    var data=await r.json();
    if(data.deepLink){
      // Save to check later
      window._pendingTelegramToken=data.token;
      window.open(data.deepLink,'_blank');
      btn.textContent='Waiting for confirmation...';
      btn.style.background='rgba(255,255,255,.1)';
      // Poll for connection
      _pollTelegramConnection(data.token,0);
    }else{
      sgToast(data.error||'Failed to get link','error');
      btn.textContent='Open Telegram Bot ✈️';btn.disabled=false;
    }
  }catch(e){
    sgToast('Network error','error');
    btn.textContent='Open Telegram Bot ✈️';btn.disabled=false;
  }
};

window._pollTelegramConnection=function(token,attempt){
  if(attempt>30)return; // Give up after ~60s
  setTimeout(async function(){
    try{
      var r=await fetch('/api/channels');
      var data=await r.json();
      var tg=data.channels&&data.channels.find(function(c){return c.id==='telegram';});
      if(tg&&tg.connected){
        // Success!
        var popup=document.getElementById('sg-bottom-popup');
        if(popup)popup.remove();
        sgToast('✅ Telegram connected!','success',3000);
        _loadChannels();
        // Send welcome
        fetch('/api/channels/welcome',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'telegram'})}).catch(function(){});
        return;
      }
    }catch(e){}
    _pollTelegramConnection(token,attempt+1);
  },2000);
};

window._connectWhatsApp=async function(){
  var btn=document.getElementById('ch-connect-btn');
  btn.textContent='Connecting...';btn.disabled=true;
  try{
    // For WhatsApp, we connect using their phone number (already in the system)
    var phone=state.user&&state.user.phone;
    if(!phone){sgToast('Please add a phone number first','error');btn.textContent='Open WhatsApp Chat 💬';btn.disabled=false;return;}
    var r=await fetch('/api/channels/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'whatsapp',channelUserId:'whatsapp:'+phone,channelUsername:phone})});
    var data=await r.json();
    if(data.success){
      // Open WhatsApp with pre-filled message
      var waNumber=(window._sgTwilioPhone||'+447700900000').replace(/[^0-9]/g,'');
      window.open('https://wa.me/'+waNumber+'?text=Hi%20ScanGym!','_blank');
      var popup=document.getElementById('sg-bottom-popup');
      if(popup)popup.remove();
      sgToast('✅ WhatsApp connected!','success',3000);
      _loadChannels();
    }else{sgToast(data.error||'Failed','error');btn.textContent='Open WhatsApp Chat 💬';btn.disabled=false;}
  }catch(e){sgToast('Network error','error');btn.textContent='Open WhatsApp Chat 💬';btn.disabled=false;}
};

window._connectDiscord=async function(){
  var btn=document.getElementById('ch-connect-btn');
  btn.textContent='Connecting...';btn.disabled=true;
  try{
    var r=await fetch('/api/channels/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'discord',channelUsername:state.user&&state.user.name||'User'})});
    var data=await r.json();
    if(data.success){
      // Open Discord bot invite link
      window.open('https://discord.com/api/oauth2/authorize?client_id=&permissions=2048&scope=bot','_blank');
      var popup=document.getElementById('sg-bottom-popup');
      if(popup)popup.remove();
      sgToast('✅ Discord bot added! DM it to start','success',3000);
      _loadChannels();
    }else{sgToast(data.error||'Failed','error');btn.textContent='Add Discord Bot 🎮';btn.disabled=false;}
  }catch(e){sgToast('Network error','error');btn.textContent='Add Discord Bot 🎮';btn.disabled=false;}
};

window._connectSMS=async function(){
  var btn=document.getElementById('ch-connect-btn');
  btn.textContent='Connecting...';btn.disabled=true;
  try{
    var phone=state.user&&state.user.phone;
    if(!phone){sgToast('Please add a phone number first','error');btn.textContent='Connect SMS 📱';btn.disabled=false;return;}
    var r=await fetch('/api/channels/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'sms',channelUserId:'sms:'+phone,channelUsername:phone})});
    var data=await r.json();
    if(data.success){
      var popup=document.getElementById('sg-bottom-popup');
      if(popup)popup.remove();
      sgToast('✅ SMS connected! Text us to search gyms','success',3000);
      _loadChannels();
    }else{sgToast(data.error||'Failed','error');btn.textContent='Connect SMS 📱';btn.disabled=false;}
  }catch(e){sgToast('Network error','error');btn.textContent='Connect SMS 📱';btn.disabled=false;}
};

window._connectEmail=async function(){
  var btn=document.getElementById('ch-connect-btn');
  btn.textContent='Connecting...';btn.disabled=true;
  try{
    var email=state.user&&state.user.email;
    if(!email){sgToast('Please add an email first','error');btn.textContent='Connect Email 📧';btn.disabled=false;return;}
    var r=await fetch('/api/channels/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'email',channelUserId:email,channelUsername:email})});
    var data=await r.json();
    if(data.success){
      var popup=document.getElementById('sg-bottom-popup');
      if(popup)popup.remove();
      sgToast('✅ Email connected! Send to book@scangym.com','success',3000);
      _loadChannels();
    }else{sgToast(data.error||'Failed','error');btn.textContent='Connect Email 📧';btn.disabled=false;}
  }catch(e){sgToast('Network error','error');btn.textContent='Connect Email 📧';btn.disabled=false;}
};

// ─── Disconnect channel ─────────────────────────────────────
window._disconnectChannel=async function(channelId,btn){
  if(!confirm('Disconnect this channel?'))return;
  btn.textContent='...';btn.disabled=true;
  try{
    var r=await fetch('/api/channels/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:channelId})});
    var data=await r.json();
    if(data.success){
      sgToast('Channel disconnected','info',2000);
      _loadChannels();
    }else{sgToast(data.error||'Failed','error');btn.textContent='Disconnect';btn.disabled=false;}
  }catch(e){sgToast('Network error','error');btn.textContent='Disconnect';btn.disabled=false;}
};
