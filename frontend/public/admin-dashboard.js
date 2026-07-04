/**
 * Admin Dashboard v2 — Enhanced metrics
 * Total Registrations · Active Users · Activity Levels
 * Cohort Retention · Revenue · NPS
 * 
 * Loaded at /admin route via app.ctr576.js DashboardPage() override
 */
(function(){
'use strict';

var _adminPeriod = '30d';
var _adminData = null;

// ─── Format helpers ───
function fmt(n){ return typeof n==='number' ? n.toLocaleString('en-GB') : String(n||0); }
function fmtPct(n){ return (typeof n==='number' ? n.toFixed(1) : '0.0') + '%'; }
function fmtGBP(n){ return '£' + (typeof n==='number' ? n.toFixed(2) : '0.00'); }
function growthArrow(pct){
  if(pct>0) return '<span style="color:#22c55e;font-size:11px;font-weight:700">▲ '+fmtPct(pct)+'</span>';
  if(pct<0) return '<span style="color:#ef4444;font-size:11px;font-weight:700">▼ '+fmtPct(Math.abs(pct))+'</span>';
  return '<span style="color:rgba(255,255,255,.3);font-size:11px;font-weight:700">— 0%</span>';
}
function sparkBars(data, key, color, maxH){
  if(!data||!data.length)return '<div style="color:rgba(255,255,255,.2);font-size:12px;padding:20px;text-align:center">No data yet</div>';
  maxH=maxH||80;
  var max=Math.max.apply(null,data.map(function(d){return d[key]||0;}))||1;
  return '<div style="display:flex;align-items:flex-end;gap:2px;height:'+maxH+'px;padding:0 4px">'
    +data.map(function(d){
      var v=d[key]||0;
      var h=Math.max(2,Math.round((v/max)*maxH));
      var label=d.date?(new Date(d.date)).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'';
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0">'
        +'<div style="width:100%;height:'+h+'px;background:'+color+';border-radius:3px 3px 0 0;min-width:4px" title="'+v+'"></div>'
        +'<span style="color:rgba(255,255,255,.2);font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">'+label+'</span>'
        +'</div>';
    }).join('')
    +'</div>';
}

// ─── Card builder ───
function card(icon, title, subtitle, body, accent){
  accent=accent||'rgba(255,255,255,.06)';
  return '<div style="background:rgba(255,255,255,.02);border:1px solid '+accent+';border-radius:16px;padding:20px;margin-bottom:14px">'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">'
    +'<span style="font-size:22px">'+icon+'</span>'
    +'<div><p style="color:#fff;font-size:15px;font-weight:800">'+title+'</p>'
    +(subtitle?'<p style="color:rgba(255,255,255,.35);font-size:11px">'+subtitle+'</p>':'')
    +'</div></div>'
    +body
    +'</div>';
}
function metricBox(value, label, color){
  color=color||'#fff';
  return '<div style="background:rgba(0,0,0,.3);border-radius:12px;padding:14px;text-align:center">'
    +'<p style="color:'+color+';font-size:22px;font-weight:900">'+value+'</p>'
    +'<p style="color:rgba(255,255,255,.3);font-size:10px">'+label+'</p>'
    +'</div>';
}

// ─── Build the full page HTML ───
function buildAdminDashboard(d){
  if(!d) return '<div style="padding:40px;text-align:center;color:rgba(255,255,255,.3)">Loading...</div>';

  var reg=d.registrations||{};
  var au=d.activeUsers||{};
  var act=d.activityLevels||{};
  var coh=d.cohortRetention||[];
  var rev=d.revenue||{};
  var nps=d.nps||{};

  var html='';

  // Period selector
  var periods=[{k:'today',l:'Today'},{k:'7d',l:'7d'},{k:'30d',l:'30d'},{k:'90d',l:'90d'},{k:'all',l:'All'}];
  html+='<div style="display:flex;gap:6px;margin-bottom:18px;overflow-x:auto" id="adm-period-bar">';
  periods.forEach(function(p){
    var active=p.k===_adminPeriod;
    html+='<button onclick="window._sgAdminSetPeriod(\''+p.k+'\')" data-k="'+p.k+'" style="'
      +(active?'background:#FF6D00;color:#fff;border:1px solid #FF6D00':'background:rgba(255,255,255,.04);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08)')
      +';border-radius:20px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">'+p.l+'</button>';
  });
  html+='</div>';

  // ═══ 1. TOTAL REGISTRATIONS ═══
  html+=card('👥','Total Registrations','User sign-ups across all channels',
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">'
    +metricBox(fmt(reg.total),'All Time','#FF6D00')
    +metricBox(fmt(reg.inPeriod),'This Period','#3b82f6')
    +metricBox(growthArrow(reg.growthPercent),'vs Previous','#fff')
    +'</div>'
    +sparkBars(reg.trend,'count','rgba(255,109,0,.6)',60),
    'rgba(255,109,0,.15)'
  );

  // ═══ 2. ACTIVE USERS ═══
  html+=card('🟢','Active Users','DAU · WAU · MAU · Stickiness',
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px">'
    +metricBox(fmt(au.dau),'DAU','#22c55e')
    +metricBox(fmt(au.wau),'WAU','#3b82f6')
    +metricBox(fmt(au.mau),'MAU','#a855f7')
    +metricBox(fmtPct(au.stickiness),'Stickiness','#eab308')
    +'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
    +metricBox(fmt(au.bookedInPeriod),'Booked','#FF6D00')
    +metricBox(fmt(au.visitorsInPeriod),'Visitors','#3b82f6')
    +'</div>',
    'rgba(34,197,94,.15)'
  );

  // ═══ 3. ACTIVITY LEVELS ═══
  var peakStr='';
  if(act.peakHours&&act.peakHours.length){
    peakStr='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">';
    act.peakHours.forEach(function(h){
      peakStr+='<span style="background:rgba(255,109,0,.1);color:#FF6D00;border:1px solid rgba(255,109,0,.2);border-radius:20px;padding:4px 10px;font-size:11px;font-weight:600">'
        +h.hour+':00 ('+h.count+')</span>';
    });
    peakStr+='</div>';
  }
  var topGymsStr='';
  if(act.topGyms&&act.topGyms.length){
    topGymsStr='<div style="margin-top:12px">';
    act.topGyms.forEach(function(g,i){
      topGymsStr+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
        +'<span style="color:rgba(255,255,255,.3);font-size:11px;width:16px">'+(i+1)+'</span>'
        +'<span style="color:#fff;font-size:12px;font-weight:600;flex:1">'+g.name+'</span>'
        +'<span style="color:#FF6D00;font-size:12px;font-weight:700">'+g.bookings+'</span>'
        +'</div>';
    });
    topGymsStr+='</div>';
  }
  html+=card('📊','Activity Levels','Bookings · Page views · Peak hours',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'
    +metricBox(fmt(act.totalBookingsInPeriod),'Bookings','#FF6D00')
    +metricBox(fmt(act.totalPageViewsInPeriod),'Page Views','#3b82f6')
    +'</div>'
    +'<p style="color:rgba(255,255,255,.4);font-size:11px;font-weight:600;margin-bottom:4px">📈 Booking Trend</p>'
    +sparkBars(act.bookingTrend,'count','rgba(255,109,0,.5)',50)
    +(act.peakHours&&act.peakHours.length?'<p style="color:rgba(255,255,255,.4);font-size:11px;font-weight:600;margin-top:14px">⏰ Peak Hours</p>'+peakStr:'')
    +(act.topGyms&&act.topGyms.length?'<p style="color:rgba(255,255,255,.4);font-size:11px;font-weight:600;margin-top:14px">🏆 Top Gyms</p>'+topGymsStr:''),
    'rgba(59,130,246,.15)'
  );

  // ═══ 4. COHORT RETENTION ═══
  var cohortHtml='';
  if(coh.length){
    cohortHtml+='<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px">';
    // Header
    var maxWeeks=0;
    coh.forEach(function(c){if(c.retention)c.retention.forEach(function(r){if(r.week>maxWeeks)maxWeeks=r.week;});});
    cohortHtml+='<tr><th style="color:rgba(255,255,255,.4);font-weight:600;padding:6px 8px;text-align:left;border-bottom:1px solid rgba(255,255,255,.06)">Cohort</th>'
      +'<th style="color:rgba(255,255,255,.4);font-weight:600;padding:6px 8px;text-align:center;border-bottom:1px solid rgba(255,255,255,.06)">Size</th>';
    for(var w=0;w<=Math.min(maxWeeks,6);w++){
      cohortHtml+='<th style="color:rgba(255,255,255,.4);font-weight:600;padding:6px 4px;text-align:center;border-bottom:1px solid rgba(255,255,255,.06)">W'+w+'</th>';
    }
    cohortHtml+='</tr>';
    // Rows
    coh.forEach(function(c){
      var dateStr=(new Date(c.cohort_week)).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
      cohortHtml+='<tr><td style="color:#fff;padding:5px 8px;white-space:nowrap">'+dateStr+'</td>'
        +'<td style="color:rgba(255,255,255,.5);padding:5px 8px;text-align:center">'+c.size+'</td>';
      var retMap={};
      if(c.retention)c.retention.forEach(function(r){retMap[r.week]=r.percent;});
      for(var ww=0;ww<=Math.min(maxWeeks,6);ww++){
        var pct=retMap[ww];
        var bg='rgba(255,255,255,.02)';
        var clr='rgba(255,255,255,.2)';
        if(pct!==undefined){
          if(pct>=50){bg='rgba(34,197,94,.2)';clr='#22c55e';}
          else if(pct>=20){bg='rgba(234,179,8,.15)';clr='#eab308';}
          else if(pct>0){bg='rgba(239,68,68,.1)';clr='#ef4444';}
        }
        cohortHtml+='<td style="background:'+bg+';color:'+clr+';padding:5px 4px;text-align:center;font-weight:600">'
          +(pct!==undefined?pct+'%':'—')+'</td>';
      }
      cohortHtml+='</tr>';
    });
    cohortHtml+='</table></div>';
  } else {
    cohortHtml='<div style="color:rgba(255,255,255,.2);font-size:12px;padding:20px;text-align:center">No cohort data yet — need more sign-ups & bookings</div>';
  }
  html+=card('🔄','Cohort Retention','Weekly user return rates',cohortHtml,'rgba(168,85,247,.15)');

  // ═══ 5. REVENUE ═══
  html+=card('💰','Revenue','Income breakdown & trends',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'
    +metricBox(fmtGBP(rev.totalAllTime),'All Time','#FF6D00')
    +metricBox(fmtGBP(rev.inPeriod),'This Period','#3b82f6')
    +'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">'
    +metricBox(fmtGBP(rev.scanGymShare),'ScanGym (25%)','#a855f7')
    +metricBox(fmtGBP(rev.gymOwnerShare),'Gym Owners (75%)','#22c55e')
    +metricBox(growthArrow(rev.growthPercent),'vs Previous','#fff')
    +'</div>'
    +'<p style="color:rgba(255,255,255,.4);font-size:11px;font-weight:600;margin-bottom:4px">📈 Revenue Trend</p>'
    +sparkBars(rev.trend,'revenue','rgba(255,109,0,.6)',60),
    'rgba(255,109,0,.15)'
  );

  // ═══ 6. NET PROMOTER SCORE ═══
  var npsDisplay='—';
  var npsColor='rgba(255,255,255,.3)';
  if(nps.score!==null&&nps.score!==undefined){
    npsDisplay=nps.score;
    if(nps.score>=50)npsColor='#22c55e';
    else if(nps.score>=0)npsColor='#eab308';
    else npsColor='#ef4444';
  }
  var npsBar='';
  if(nps.totalResponses>0){
    npsBar='<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;margin-top:10px">'
      +'<div style="width:'+nps.detractorPercent+'%;background:#ef4444" title="Detractors '+nps.detractorPercent+'%"></div>'
      +'<div style="width:'+(100-nps.promoterPercent-nps.detractorPercent)+'%;background:#eab308" title="Passives"></div>'
      +'<div style="width:'+nps.promoterPercent+'%;background:#22c55e" title="Promoters '+nps.promoterPercent+'%"></div>'
      +'</div>'
      +'<div style="display:flex;justify-content:space-between;margin-top:6px">'
      +'<span style="color:#ef4444;font-size:10px">Detractors: '+nps.detractors+'</span>'
      +'<span style="color:#eab308;font-size:10px">Passives: '+nps.passives+'</span>'
      +'<span style="color:#22c55e;font-size:10px">Promoters: '+nps.promoters+'</span>'
      +'</div>';
  }
  html+=card('⭐','Net Promoter Score',nps.note||'Customer satisfaction metric',
    '<div style="text-align:center;margin-bottom:10px">'
    +'<p style="color:'+npsColor+';font-size:48px;font-weight:900;line-height:1">'+npsDisplay+'</p>'
    +'<p style="color:rgba(255,255,255,.3);font-size:11px;margin-top:4px">'+fmt(nps.totalResponses)+' responses</p>'
    +'</div>'
    +npsBar
    +(nps.totalResponses===0?'<p style="color:rgba(255,255,255,.2);font-size:11px;text-align:center;margin-top:10px">💡 Add NPS survey to post-booking flow to collect feedback</p>':''),
    'rgba(234,179,8,.15)'
  );

  return html;
}

// ─── Main page renderer ───
window._sgAdminDashboardPage=function(){
  setTimeout(function(){window._sgLoadAdminDashboard();},200);
  return '<div style="max-width:520px;margin:0 auto;padding:16px 16px 100px" id="sg-admin-dash">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">'
    +'<div onclick="navigate(\'/more\')" style="cursor:pointer;color:rgba(255,255,255,.6);font-size:14px;font-weight:600">← Back</div>'
    +'<p style="color:#fff;font-size:18px;font-weight:900">📊 Admin Dashboard</p>'
    +'<button onclick="window._sgLoadAdminDashboard()" style="background:rgba(255,109,0,.1);border:1px solid rgba(255,109,0,.2);color:#FF6D00;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer">↻</button>'
    +'</div>'
    +'<div id="sg-admin-content"><div style="padding:40px;text-align:center"><div class="skel-card" style="width:100%;height:200px;background:rgba(255,255,255,.03);border-radius:16px;margin-bottom:12px"></div><p style="color:rgba(255,255,255,.3);font-size:13px">Loading dashboard...</p></div></div>'
    +'<p style="text-align:center;color:rgba(255,255,255,.12);font-size:10px;margin-top:16px">Auto-refreshes every 60s · <span id="sg-admin-last-refresh">—</span></p>'
    +'</div>';
};

// ─── Fetch data ───
window._sgLoadAdminDashboard=async function(){
  try{
    var r=await fetch('/api/stats/admin-dashboard?period='+_adminPeriod,{credentials:'include'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    _adminData=await r.json();
    var el=document.getElementById('sg-admin-content');
    if(el)el.innerHTML=buildAdminDashboard(_adminData);
    var ts=document.getElementById('sg-admin-last-refresh');
    if(ts)ts.textContent=new Date().toLocaleTimeString('en-GB');
  }catch(e){
    console.error('[AdminDash] Load error:',e);
    var el2=document.getElementById('sg-admin-content');
    if(el2)el2.innerHTML='<div style="padding:40px;text-align:center;color:#ef4444"><p style="font-size:16px;margin-bottom:8px">⚠️ Failed to load</p><p style="font-size:12px;color:rgba(255,255,255,.3)">'+e.message+'</p><button onclick="window._sgLoadAdminDashboard()" style="margin-top:12px;background:#FF6D00;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer">Retry</button></div>';
  }
};

// ─── Period switcher ───
window._sgAdminSetPeriod=function(p){
  _adminPeriod=p;
  // Update button styles
  var btns=document.querySelectorAll('#adm-period-bar button');
  btns.forEach(function(b){
    var isActive=b.dataset.k===p;
    b.style.background=isActive?'#FF6D00':'rgba(255,255,255,.04)';
    b.style.color=isActive?'#fff':'rgba(255,255,255,.5)';
    b.style.borderColor=isActive?'#FF6D00':'rgba(255,255,255,.08)';
  });
  window._sgLoadAdminDashboard();
};

// ─── Auto refresh ───
setInterval(function(){
  if(window.state&&(window.state.route==='/admin'||window.state.route==='/dashboard')){
    window._sgLoadAdminDashboard();
  }
},60000);

// ─── Override the old DashboardPage + CeoDashboardPage to use enhanced version ───
// The old DashboardPage() and CeoDashboardPage() are defined in app.ctr576.js.
// /admin uses CeoDashboardPage(), so we must override both.
if(typeof window.DashboardPage==='function'){
  window._sgOldDashboardPage=window.DashboardPage;
}
window.DashboardPage=function(){
  return window._sgAdminDashboardPage();
};
if(typeof window.CeoDashboardPage==='function'){
  window._sgOldCeoDashboardPage=window.CeoDashboardPage;
}
window.CeoDashboardPage=function(){
  return window._sgAdminDashboardPage();
};

console.log('[AdminDashboard] Enhanced admin dashboard v2 loaded');
})();
