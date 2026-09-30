/* Task 25: capture ?ref=<handle> on standalone pages (e.g. /reels) that do not
   load app.ctr576.js. Same storage as the SPA: localStorage sg_referral (30 days)
   + sg_referral cookie, and a server-side click so the sale can be attributed. */
(function(){
  try{
    var p=new URLSearchParams(location.search),ref=p.get('ref');
    if(!ref||!/^[A-Za-z0-9_.-]{2,40}$/.test(ref))return;
    var src=p.get('src')||null,gym=p.get('gym')||null,days=30;
    localStorage.setItem('sg_referral',JSON.stringify({handle:ref,expiry:Date.now()+days*864e5,source:src,gymId:gym}));
    document.cookie='sg_referral='+encodeURIComponent(ref)+';path=/;max-age='+(days*86400)+';SameSite=Lax';
    fetch('/api/referrals/track',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
      body:JSON.stringify({creatorHandle:ref,visitorSession:Date.now().toString(36),source:src||'reels',gymId:gym})}).catch(function(){});
  }catch(e){}
})();
