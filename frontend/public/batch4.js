/**
 * ScanGym Batch 4 — smart lock auto-unlock on valid QR (Seam chain)
 * Backend now fires the connected smart lock (Seam/Kisi) on every valid
 * ENTRY scan. This patch surfaces it: the scanner result shows
 * "🔓 Door unlocked" when the lock fired.
 */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('sg_sheet')==='1')return;

function install(){
  if(typeof window.sgVerifyQR!=='function'||window.sgVerifyQR.__b4)return;
  window.sgVerifyQR=async function(token){
    var result=document.getElementById('sg-scan-result');
    if(!result)return;
    result.style.display='block';
    result.innerHTML='<div style="text-align:center;padding:16px;color:rgba(255,255,255,.5)">Verifying...</div>';
    try{
      var r=await fetch('/api/qr/scan',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({qr_token:token,token:token})});
      var d=await r.json();
      if(r.ok&&(d.success||d.valid)){
        var doorLine='';
        if(d.doorUnlocked){doorLine='<p style="color:#4ade80;font-size:13px;font-weight:700;margin-top:8px">\uD83D\uDD13 Door unlocked \u2014 walk in!</p>';}
        else if(d.doorUnlockAttempted){doorLine='<p style="color:rgba(255,255,255,.4);font-size:12px;margin-top:8px">\uD83D\uDD12 Auto-unlock didn\u2019t respond \u2014 use the door code or ask staff</p>';}
        result.innerHTML='<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);border-radius:12px;padding:16px;text-align:center">'
          +'<p style="font-size:28px;margin-bottom:8px">\u2705</p>'
          +'<p style="color:#4ade80;font-weight:700;font-size:16px">'+((d.scanType==='entry'||d.scanType==='check-in')?'Checked In':'Checked Out')+'</p>'
          +'<p style="color:rgba(255,255,255,.6);font-size:13px;margin-top:4px">'+(d.gymName||'Gym')+' \u00b7 Scan '+(d.scanNumber||'')+' of 2</p>'
          +doorLine+'</div>';
      }else{
        result.innerHTML='<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:16px;text-align:center">'
          +'<p style="font-size:28px;margin-bottom:8px">\u274C</p>'
          +'<p style="color:#f87171;font-weight:700;font-size:16px">Invalid QR Code</p>'
          +'<p style="color:rgba(255,255,255,.4);font-size:13px;margin-top:4px">'+(d.error||d.message||'This QR code is expired or already used')+'</p></div>';
      }
    }catch(e){
      result.innerHTML='<div style="text-align:center;padding:16px;color:#f87171">Network error \u2014 please try again</div>';
    }
  };
  window.sgVerifyQR.__b4=true;
}
setInterval(install,800);
console.log('[Batch4] smart lock auto-unlock UI');
})();
