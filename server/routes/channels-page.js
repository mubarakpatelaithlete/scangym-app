// Reference copy of ChannelsPage from app.ctr576.js
// Updated with WhatsApp + Discord fixes

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
        va