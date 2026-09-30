/* Task 11: incoming ScanGym calls ring on every tab, not only inside Chats.
   Polls /api/dm/calls/incoming (stops for signed-out visitors); tapping
   Answer opens the Chats tab, whose call screen picks the ringing call up. */
(function(){
  'use strict';
  var shown=null,stop=false;
  function onChats(){return location.pathname.indexOf('/chats')===0;}
  function banner(c){
    if(shown===c.id)return;shown=c.id;
    var d=document.createElement('div');d.id='sg-ring';
    d.style.cssText='position:fixed;left:12px;right:12px;top:max(12px,env(safe-area-inset-top));z-index:var(--sg-z-toast,11000);background:#111827;border:1px solid rgba(255,109,0,.4);border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:10px;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.5);font:600 15px system-ui,sans-serif';
    d.innerHTML='<span style="font-size:24px">'+(c.kind==='video'?'📹':'📞')+'</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+String(c.fromName||'Someone').replace(/[<>&]/g,'')+' is calling…</span>'
      +'<button id="sg-ring-no" style="background:#f15c6d;color:#fff;border:0;border-radius:18px;padding:8px 12px;font-weight:700">Decline</button>'
      +'<button id="sg-ring-yes" style="background:#25d366;color:#fff;border:0;border-radius:18px;padding:8px 12px;font-weight:700">Answer</button>';
    document.body.appendChild(d);
    document.getElementById('sg-ring-yes').onclick=function(){d.remove();if(typeof window.navigate==='function')window.navigate('/chats');else location.href='/chats';};
    document.getElementById('sg-ring-no').onclick=function(){d.remove();fetch('/api/dm/calls/'+c.id+'/end',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{"reason":"declined"}'}).catch(function(){});};
  }
  function poll(){
    if(stop)return;
    if(document.hidden||onChats()){setTimeout(poll,4000);return;}
    fetch('/api/dm/calls/incoming',{credentials:'same-origin'}).then(function(r){
      if(r.status===401){stop=true;return null;}return r.ok?r.json():null;
    }).then(function(j){
      var el=document.getElementById('sg-ring');
      if(j&&j.call)banner(j.call);else if(el){el.remove();shown=null;}
    }).catch(function(){}).then(function(){setTimeout(poll,4000);});
  }
  setTimeout(poll,5000);
})();
