/**
 * sg-shop.js: the Shop tab, split out of app.ctr576.js (Task 158, Shop Batch 1).
 *
 * The main bundle sat 61 bytes under its size budget (tests/code-split.test.js),
 * which is what held back the Shop "Top creators" row and every later Shop
 * feature. Loaded by sgChunk('sg-shop') when /shop or the Shop tab renders
 * (see _sgChunkForView), and prefetched at idle so it is usually already in.
 * _sgShopState stays in core because shop-extras.js and reel-shop.js read it.
 * Core keeps sgChunkStub stubs for the entry points other scripts call:
 * _sgShopOpen, _sgShopOpenSell, _sgShopSimpleSheet, _sgShopStore.
 */
function ShopPage(){
  var cats=['All','Prompt packs','Workout plans','Meal guides','Video programs','Templates'];
  var chips=cats.map(function(c){
    var on=_sgShopState.category===c;
    return '<button type="button" data-shop-cat="'+c+'" onclick="window._sgShopCategory('+JSON.stringify(c).replace(/"/g,'&quot;')+')" '
      +'style="flex:none;border:1px solid '+(on?'#FF6D00':'rgba(255,255,255,.14)')+';border-radius:18px;padding:7px 12px;'
      +'background:'+(on?'rgba(255,109,0,.22)':'rgba(255,255,255,.06)')+';color:#fff;font-size:13px;font-weight:700;cursor:pointer">'+c+'</button>';
  }).join('');
  setTimeout(function(){ if(!_sgShopState.loaded) window._sgShopLoad(); },0);
  /* Task 65 (Amazon pass, owner 2026-10-01): Amazon's mobile order. A white
     search bar first and sticky, slim category pills, a "delivery" line
     (instant download), then the grid. The big title block is gone. */
  return `<section style="width:100%;max-width:720px;min-width:0;box-sizing:border-box;overflow-x:hidden;margin:0 auto;padding:10px 12px 110px;color:#fff">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 2px 8px 44px;min-height:30px">
      <h1 style="margin:0;font-size:17px;font-weight:900;white-space:nowrap">ScanGym <span style="color:#FF6D00">Digital Shop</span></h1>
      <span style="color:rgba(255,255,255,.55);font-size:11px;white-space:nowrap">PDF guides &amp; plans</span>
    </div>
    <div style="position:sticky;top:0;z-index:5;padding:4px 0 8px;background:#0f172a">
      <label style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:10px;padding:0 12px;height:44px;box-shadow:0 1px 6px rgba(0,0,0,.35);border:2px solid #FF6D00">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input type="search" id="sg-shop-search" aria-label="Search digital fitness products" placeholder="Search ScanGym Shop" value="${_sgShopEsc(_sgShopState.q)}" enterkeyhint="search" onkeydown="if(event.key==='Enter')this.blur()" onfocus="window._sgShopRecent(true)" onblur="window._sgShopRemember();setTimeout(function(){window._sgShopRecent(false)},150)" oninput="window._sgShopFilter(this.value);window._sgShopRecent(!this.value)" style="flex:1;min-width:0;border:0 !important;outline:0;background:transparent !important;color:#111 !important;-webkit-text-fill-color:#111;box-shadow:none !important;padding:0 !important;font-size:16px;height:40px">
        <button type="button" id="sg-shop-clear" aria-label="Clear search" onclick="window._sgShopClear()" style="display:${_sgShopState.q?'flex':'none'};flex:none;width:26px;height:26px;border:0;border-radius:50%;background:#ddd;color:#333;font-size:14px;font-weight:900;align-items:center;justify-content:center;cursor:pointer;padding:0">✕</button>
      </label>
      <div id="sg-shop-recent" style="display:none;margin-top:8px"></div>
    </div>
    <div aria-label="Digital product categories" style="display:flex;gap:6px;overflow-x:auto;white-space:nowrap;max-width:100%;scrollbar-width:none;padding:2px 0 8px">${chips}</div>
    <p style="margin:0 0 12px;padding:8px 10px;border-radius:10px;background:rgba(34,197,94,.10);color:#86efac;font-size:12px;font-weight:600">⚡ Instant download · 🔒 Secure · No physical goods</p>
    <div id="sg-digital-shop-results" style="min-height:210px">
      ${_sgShopSkeleton()}
    </div>
    <div style="margin-top:26px;border-top:1px solid rgba(255,255,255,.08);padding-top:18px">
      <button type="button" onclick="window._sgShopOpenSell()" style="width:100%;border:1px dashed rgba(255,109,0,.5);border-radius:14px;padding:14px;background:rgba(255,109,0,.08);color:#FF6D00;font-weight:800;font-size:14px;cursor:pointer">＋ Sell your own digital product</button>
      <p style="margin:8px 0 0;color:rgba(255,255,255,.4);font-size:12px;text-align:center">ScanSquad creators keep 70% of every sale.</p>
    </div>
    <button type="button" id="sg-shop-top" onclick="window._sgShopTop()" aria-label="Back to top" style="display:none;position:fixed;right:14px;bottom:150px;z-index:20;border:1px solid rgba(255,255,255,.25);border-radius:20px;padding:9px 14px;background:rgba(15,23,42,.92);color:#fff;font-weight:800;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.4)">↑ Top</button>
  </section>`;
}

/* Task 65 bug pass: switching category restyles the pills in place and
   reloads only the grid, so the page no longer jumps to the top. */
window._sgShopCategory=function(category){
  _sgShopState.category=category;
  var pills=document.querySelectorAll('[data-shop-cat]');
  if(!pills.length){ _sgShopState.loaded=false; render(); return; }
  pills.forEach(function(b){
    var on=b.getAttribute('data-shop-cat')===category;
    b.style.borderColor=on?'#FF6D00':'rgba(255,255,255,.14)';
    b.style.background=on?'rgba(255,109,0,.22)':'rgba(255,255,255,.06)';
  });
  var box=document.getElementById('sg-digital-shop-results');
  if(box)box.innerHTML=_sgShopSkeleton();
  window._sgShopLoad(true);
};
window._sgShopClear=function(){
  var i=document.getElementById('sg-shop-search');
  if(i){i.value='';i.focus();}
  window._sgShopFilter('');
};
window._sgShopShare=function(id){
  var p=_sgShopState.products.filter(function(x){return x.id===id;})[0]||{};
  var url=location.origin+'/shop?p='+id;
  if(navigator.share){navigator.share({title:p.title||'ScanGym Shop',text:(p.title||'')+' — '+(p.price||''),url:url}).catch(function(){});return;}
  try{navigator.clipboard.writeText(url).then(function(){if(typeof sgToast==='function')sgToast('Link copied','success',1800);});}catch(e){}
};
window._sgShopRecent=function(show){
  var el=document.getElementById('sg-shop-recent');if(!el)return;
  var list=_sgShopLS('sg_shop_recent');
  if(!show||!list.length||_sgShopState.q){el.style.display='none';return;}
  el.innerHTML='<p style="margin:0 0 6px;color:rgba(255,255,255,.5);font-size:11px;font-weight:700">RECENT SEARCHES</p>'+list.map(function(q){
    return '<button type="button" onmousedown="event.preventDefault()" onclick="var i=document.getElementById(\'sg-shop-search\');i.value=this.textContent;window._sgShopFilter(this.textContent);window._sgShopRecent(false);i.blur()" style="margin:0 6px 6px 0;border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:5px 10px;background:rgba(255,255,255,.06);color:#fff;font-size:13px;cursor:pointer">'+_sgShopEsc(q)+'</button>';}).join('');
  el.style.display='block';
};
window._sgShopRemember=function(){
  var q=String(_sgShopState.q||'').trim();if(q.length<2)return;
  var l=_sgShopLS('sg_shop_recent').filter(function(x){return x.toLowerCase()!==q.toLowerCase();});l.unshift(q);
  try{localStorage.setItem('sg_shop_recent',JSON.stringify(l.slice(0,8)));}catch(e){}
};
/* Back-to-top button once you are a few screens down (Amazon). Listens on any
   scroller because the app shell decides which element scrolls. */
if(!window._sgShopTopBound){window._sgShopTopBound=1;
  document.addEventListener('scroll',function(e){var b=document.getElementById('sg-shop-top');if(!b)return;
    var t=e.target===document?(document.scrollingElement||document.documentElement):e.target;if(!t||t.scrollTop==null)return;
    window._sgShopScroller=t;b.style.display=t.scrollTop>900?'block':'none';},true);}
window._sgShopTop=function(){var t=window._sgShopScroller||document.scrollingElement;if(t&&t.scrollTo)t.scrollTo({top:0,behavior:'smooth'});else window.scrollTo(0,0);};
window._sgShopSort=function(v){ _sgShopState.sort=v; window._sgShopRender(); };
window._sgShopFlt=function(k){ var f=_sgShopState.flt=_sgShopState.flt||{}; f[k]=!f[k]; window._sgShopRender(); };
/* Task 108/119 batch 2: seller storefront (Amazon store / Fiverr & Upwork profile). */
window._sgShopStore=async function(handle){
  var h=String(handle||'');
  try{
    var d=await fetch('/api/shop/products?limit=60&q='+encodeURIComponent(h),{credentials:'include'}).then(function(r){return r.json();});
    var list=(d.products||[]).filter(function(x){return x.creatorHandle===h;});
    list.forEach(function(x){ if(!_sgShopState.products.some(function(y){return y.id===x.id;}))_sgShopState.products.push(x); });
    var sales=list.reduce(function(m,x){return m+(x.salesCount||0);},0);
    var rated=list.filter(function(x){return x.ratingCount;}),n=rated.reduce(function(m,x){return m+x.ratingCount;},0);
    var avg=n?Math.round(rated.reduce(function(m,x){return m+x.rating*x.ratingCount;},0)/n*10)/10:null;
    var body='<div style="text-align:center;padding:4px 0 12px"><div style="width:64px;height:64px;border-radius:50%;background:#FF6D00;color:#fff;font-size:26px;font-weight:900;display:flex;align-items:center;justify-content:center;margin:0 auto 8px">'+_sgShopEsc(h.charAt(0).toUpperCase())+'</div>'
      +'<b style="font-size:18px">@'+_sgShopEsc(h)+'</b><p style="margin:4px 0 0;color:rgba(255,255,255,.6);font-size:13px">'+list.length+' product'+(list.length===1?'':'s')+' \u00b7 '+sales+' sold'+(avg?' \u00b7 <span style="color:#FFB020">\u2605 '+avg+'</span> ('+n+')':'')+'</p></div>'
      +'<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">'+list.map(_sgShopMini).join('').replace(/width:130px;/g,'width:auto;')+'</div>';
    window._sgShopSimpleSheet(body,{title:'@'+h+' store',sub:'ScanSquad creator',icon:'\uD83C\uDFEA'});
  }catch(e){ if(typeof sgToast==='function')sgToast('Could not open the store','error',2000); }
};
window._sgShopSkeleton=_sgShopSkeleton;
function _sgShopSkeleton(){
  var c='<div style="border-radius:12px;overflow:hidden;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)"><div class="sg-shop-sk" style="height:128px"></div><div style="padding:10px"><div class="sg-shop-sk" style="height:12px;margin-bottom:6px"></div><div class="sg-shop-sk" style="height:12px;width:60%;margin-bottom:10px"></div><div class="sg-shop-sk" style="height:20px;width:40%"></div></div></div>';
  return '<style>.sg-shop-sk{border-radius:6px;background:linear-gradient(90deg,rgba(255,255,255,.06),rgba(255,255,255,.14),rgba(255,255,255,.06));background-size:200% 100%;animation:sgShopSk 1.2s linear infinite}@keyframes sgShopSk{to{background-position:-200% 0}}</style>'
    +'<div aria-label="Loading products" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">'+c+c+c+c+'</div>';
}

window._sgShopFilter=function(value){
  _sgShopState.q=String(value||'');
  var x=document.getElementById('sg-shop-clear'); if(x)x.style.display=_sgShopState.q?'flex':'none';
  clearTimeout(window._sgShopTimer);
  window._sgShopTimer=setTimeout(function(){ window._sgShopLoad(true); },250);
};

window._sgShopLoad=async function(force){
  var box=document.getElementById('sg-digital-shop-results');
  if(!box)return;
  _sgShopState.loaded=true;
  var mySeq=++_sgShopState.seq; // only the newest request may paint (fast typing / pill taps)
  try{
    var url='/api/shop/products?limit=40'
      +(_sgShopState.category&&_sgShopState.category!=='All'?'&category='+encodeURIComponent(_sgShopState.category):'')
      +(_sgShopState.q?'&q='+encodeURIComponent(_sgShopState.q):'');
    var data=await fetch(url,{credentials:'include'}).then(function(r){if(!r.ok)throw new Error('shop '+r.status);return r.json();});
    if(mySeq!==_sgShopState.seq)return;
    _sgShopState.products=data.products||[];
    if(state.user){
      try{
        var mine=await fetch('/api/shop/my-orders',{credentials:'include'}).then(function(r){return r.json();});
        _sgShopState.owned={};
        _sgShopState.orders=mine.orders||[];
        (mine.orders||[]).forEach(function(o){_sgShopState.owned[o.productId]=o.downloadUrl;});
      }catch(e){}
    }
    window._sgShopRender();
    var dl=null;try{dl=new URLSearchParams(location.search).get('p');}catch(e){}
    if(dl&&!_sgShopState._dl){_sgShopState._dl=1;window._sgShopOpen(+dl);} // shared /shop?p=ID opens that product
  }catch(e){
    if(mySeq!==_sgShopState.seq)return;
    box.innerHTML='<div style="text-align:center;padding:36px 0"><p style="margin:0 0 12px;color:rgba(255,255,255,.6);font-size:14px">The shop could not load. Check your connection.</p>'
      +'<button type="button" onclick="this.parentNode.parentNode.innerHTML=window._sgShopSkeleton();window._sgShopLoad(true)" style="border:1px solid rgba(255,255,255,.25);border-radius:18px;padding:9px 22px;background:rgba(255,255,255,.08);color:#fff;font-weight:800;font-size:14px;cursor:pointer">Try again</button></div>';
  }
};

window._sgShopRender=function(){
  var box=document.getElementById('sg-digital-shop-results');
  if(!box)return;
  var items=_sgShopState.products;
  if(!items.length&&_sgShopState.q){
    box.innerHTML='<div style="text-align:center;border:1px dashed rgba(255,255,255,.16);border-radius:18px;padding:30px 20px">'
      +'<div style="font-size:30px;margin-bottom:8px">🔍</div><h2 style="margin:0 0 6px;font-size:17px">No results for “'+_sgShopEsc(_sgShopState.q)+'”</h2>'
      +'<p style="margin:0 0 14px;color:rgba(255,255,255,.55);font-size:13px">Check the spelling or try a shorter word.</p>'
      +'<button type="button" onclick="window._sgShopClear()" style="border:1px solid rgba(255,255,255,.25);border-radius:18px;padding:8px 18px;background:rgba(255,255,255,.08);color:#fff;font-weight:800;cursor:pointer">Clear search</button></div>';
    return;
  }
  if(!items.length){
    box.innerHTML='<div style="text-align:center;border:1px dashed rgba(255,255,255,.16);border-radius:18px;padding:34px 20px">'
      +'<div style="font-size:34px;margin-bottom:8px">🛍️</div>'
      +'<h2 style="margin:0 0 6px;font-size:18px">Nothing here yet</h2>'
      +'<p style="max-width:340px;margin:0 auto;color:rgba(255,255,255,.55);font-size:13px">Be the first ScanSquad creator to list a product in this category.</p></div>';
    return;
  }
  /* Task 15 (Amazon patterns): Your downloads, Saved and Recently viewed rows
     above the grid; sold count, Bestseller badge and a heart on every card. */
  var rows='';
  if(!_sgShopState.q&&_sgShopState.category==='All'){
    var orders=(_sgShopState.orders||[]).slice(0,10);
    if(orders.length)rows+=_sgShopRow('\uD83D\uDCE5 Your downloads \u00b7 buy again',orders.map(function(o){
      return '<a href="'+o.downloadUrl+'" style="'+_sgShopPill+'">'+_sgShopEsc(o.title)+'<br><span style="color:#22c55e;font-size:11px">Download</span></a>';}).join(''));
    var byId={};items.forEach(function(x){byId[x.id]=x;});
    var saved=_sgShopLS('sg_shop_saved').map(function(id){return byId[id];}).filter(Boolean);
    if(saved.length)rows+=_sgShopRow('\u2764\uFE0F Saved for later',saved.map(_sgShopMini).join(''));
    var seen=_sgShopLS('sg_shop_seen').map(function(id){return byId[id];}).filter(Boolean);
    if(seen.length)rows+=_sgShopRow('\uD83D\uDC40 Recently viewed',seen.map(_sgShopMini).join(''));
  }
  var topSales=items.reduce(function(m,x){return Math.max(m,x.salesCount||0);},0);
  var savedIds=_sgShopLS('sg_shop_saved');
  /* Amazon's results bar: a count and a Sort by menu (sorts on the device). */
  var so=_sgShopState.sort||'featured';
  items=items.slice();
  if(so==='low')items.sort(function(a,b){return (a.pricePence||0)-(b.pricePence||0);});
  else if(so==='high')items.sort(function(a,b){return (b.pricePence||0)-(a.pricePence||0);});
  else if(so==='best')items.sort(function(a,b){return (b.salesCount||0)-(a.salesCount||0);});
  else if(so==='new')items.sort(function(a,b){return String(b.createdAt||'').localeCompare(String(a.createdAt||''));});
  else if(so==='rated')items.sort(function(a,b){return (b.rating||0)-(a.rating||0)||(b.ratingCount||0)-(a.ratingCount||0);});
  /* Task 108 batch 2: Amazon filter chips (price, stars, new) — on the device. */
  var fl=_sgShopState.flt||{};
  if(fl.under5)items=items.filter(function(x){return (x.pricePence||0)<500;});
  if(fl.stars4)items=items.filter(function(x){return (x.rating||0)>=4;});
  if(fl.fresh)items=items.filter(function(x){return Date.now()-new Date(x.createdAt||0).getTime()<30*864e5;});
  var fchip=function(k,l){var on=!!fl[k];return '<button type="button" onclick="window._sgShopFlt(\''+k+'\')" style="flex:none;border:1px solid '+(on?'#FF6D00':'rgba(255,255,255,.2)')+';border-radius:16px;padding:6px 12px;background:'+(on?'rgba(255,109,0,.18)':'rgba(255,255,255,.05)')+';color:#fff;font-size:12px;font-weight:700;cursor:pointer">'+(on?'\u2713 ':'')+l+'</button>';};
  var chipsRow='<div style="display:flex;gap:8px;overflow-x:auto;margin:0 0 10px;scrollbar-width:none">'+fchip('under5','Under \u00a35')+fchip('stars4','\u2605\u2605\u2605\u2605 & up')+fchip('fresh','New this month')+'</div>';
  var opt=function(v,l){return '<option value="'+v+'"'+(so===v?' selected':'')+'>'+l+'</option>';};
  var bar='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px">'
    +'<p style="margin:0;font-size:13px;color:rgba(255,255,255,.7)"><b style="color:#fff">'+items.length+'</b> result'+(items.length===1?'':'s')+(_sgShopState.q?' for “'+_sgShopEsc(_sgShopState.q)+'”':'')+'</p>'
    +'<label style="font-size:12px;color:rgba(255,255,255,.6)">Sort by <select aria-label="Sort products" onchange="window._sgShopSort(this.value)" style="background:#1e293b;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:5px 6px;font-size:13px">'
    +opt('featured','Featured')+opt('low','Price: low to high')+opt('high','Price: high to low')+opt('best','Best sellers')+opt('new','Newest')+opt('rated','Top rated')+'</select></label></div>';
  box.innerHTML=rows+bar+chipsRow+(items.length?'':'<p style="color:rgba(255,255,255,.6);font-size:13px;text-align:center;padding:20px 0">No products match these filters.</p>')+'<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">'+items.map(function(p){
    var owned=!!_sgShopState.owned[p.id];
    var hearted=savedIds.indexOf(p.id)>=0;
    var sold=p.salesCount||0;
    var cover=p.coverImageUrl
      ? '<img src="'+_sgShopEsc(p.coverImageUrl)+'" alt="'+_sgShopEsc(p.title)+'" loading="lazy" decoding="async" style="width:100%;height:128px;object-fit:cover;display:block;background:rgba(255,255,255,.06)">'
      : '<div style="height:118px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(255,109,0,.25),rgba(255,109,0,.05));font-size:34px">'+({'Prompt packs':'\u2728','Workout plans':'\uD83C\uDFCB\uFE0F','Meal guides':'\uD83E\uDD57','Video programs':'\uD83C\uDFAC','Templates':'\uD83D\uDCCB'}[p.category]||'📄')+'</div>';
    return '<button type="button" onclick="window._sgShopOpen('+p.id+')" style="position:relative;display:flex;flex-direction:column;text-align:left;border:1px solid rgba(255,255,255,.1);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.05);color:#fff;padding:0;cursor:pointer">'
      +cover
      +(sold&&sold===topSales?'<span style="position:absolute;top:8px;left:8px;background:#FF6D00;color:#fff;font-size:10px;font-weight:900;border-radius:6px;padding:3px 6px">\uD83D\uDD25 Bestseller</span>':'')
      +'<span role="button" aria-label="Save for later" onclick="event.stopPropagation();window._sgShopHeart('+p.id+')" style="position:absolute;top:6px;right:6px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-size:15px">'+(hearted?'\u2764\uFE0F':'\uD83E\uDD0D')+'</span>'
      +'<div style="padding:9px 10px 10px;display:flex;flex-direction:column;flex:1">'
      +'<p style="margin:0 0 4px;font-size:13px;font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:34px">'+_sgShopEsc(p.title)+'</p>'
      +'<p style="margin:0 0 6px;color:rgba(255,255,255,.45);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">by @'+_sgShopEsc(p.creatorHandle)+'</p>'
      +_sgShopStars(p)
      +(owned?'<p style="margin:0;font-size:15px;font-weight:900;color:#22c55e">Owned</p>':_sgShopPrice(p.price))
      +'<p style="margin:3px 0 0;color:#86efac;font-size:11px;font-weight:600">\u26A1 Instant PDF download</p>'
      +(sold?'<p style="margin:2px 0 0;color:rgba(255,255,255,.5);font-size:11px">'+sold+' sold</p>':'')
      +'<span style="margin-top:auto;padding-top:9px;display:block"><span style="display:block;text-align:center;border-radius:18px;padding:8px 0;background:'+(owned?'#22c55e':'rgba(255,255,255,.1)')+';border:1px solid rgba(255,255,255,.18);color:#fff;font-size:13px;font-weight:800">'+(owned?'Download':'Buy now')+'</span></span>'
      +'</div></button>';
  }).join('')+'</div>';
};

/* Amazon-style price: big pounds, small raised pence (£1⁹⁹). */
function _sgShopPrice(price){
  var m=/^(\D*)(\d+)[.](\d\d)$/.exec(String(price||''));
  if(!m)return '<p style="margin:0;font-size:15px;font-weight:900">'+_sgShopEsc(price)+'</p>';
  return '<p style="margin:0;font-weight:900;line-height:1"><span style="font-size:12px;vertical-align:top">'+_sgShopEsc(m[1])+'</span><span style="font-size:22px">'+m[2]+'</span><span style="font-size:12px;vertical-align:top">'+m[3]+'</span></p>';
}
var _sgShopPill='flex:none;width:130px;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px;background:rgba(255,255,255,.04);color:#fff;font-size:12px;font-weight:700;text-decoration:none;text-align:left;cursor:pointer;white-space:normal';
function _sgShopLS(key){try{var v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v:[];}catch(e){return [];}}
function _sgShopRow(title,inner){
  return '<div style="margin:0 0 16px"><p style="margin:0 0 8px;font-size:14px;font-weight:800">'+title+'</p>'
    +'<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">'+inner+'</div></div>';
}
function _sgShopMini(p){
  return '<button type="button" onclick="window._sgShopOpen('+p.id+')" style="'+_sgShopPill+'">'
    +(p.coverImageUrl?'<img src="'+_sgShopEsc(p.coverImageUrl)+'" alt="" loading="lazy" style="display:block;width:100%;height:70px;object-fit:cover;border-radius:8px;margin-bottom:6px">':'')
    +'<span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+_sgShopEsc(p.title)+'</span>'
    +'<br><span style="color:#FF6D00;font-size:11px">'+(_sgShopState.owned[p.id]?'Owned':_sgShopEsc(p.price))+'</span></button>';
}
window._sgShopHeart=function(id){
  var list=_sgShopLS('sg_shop_saved'),i=list.indexOf(id);
  if(i>=0)list.splice(i,1);else list.unshift(id);
  try{localStorage.setItem('sg_shop_saved',JSON.stringify(list.slice(0,30)));}catch(e){}
  if(typeof sgToast==='function')sgToast(i>=0?'Removed from Saved':'Saved for later \u2764\uFE0F','success',1800);
  window._sgShopRender();
};
window._sgShopAlso=async function(id){
  var el=document.getElementById('sg-shop-also');
  if(!el)return;
  try{
    var d=await fetch('/api/shop/products/'+id+'/also-bought',{credentials:'include'}).then(function(r){return r.json();});
    var list=(d.products||[]);
    list.forEach(function(x){ if(!_sgShopState.products.some(function(y){return y.id===x.id;}))_sgShopState.products.push(x); });
    el.innerHTML=list.length?_sgShopRow('\uD83D\uDED2 Customers also bought',list.map(_sgShopMini).join('')):'';
  }catch(e){ el.innerHTML=''; }
};

/* Task 108/119: star ratings + verified-purchase reviews (Amazon, Fiverr, Upwork, Skool). */
function _sgShopStarStr(r){var n=Math.round(r||0),o='';for(var i=1;i<=5;i++)o+=i<=n?'\u2605':'\u2606';return o;}
function _sgShopStars(p){if(!p||!p.ratingCount)return '';return '<p style="margin:0 0 4px;font-size:12px;color:#FFB020;font-weight:700">'+_sgShopStarStr(p.rating)+' <span style="color:rgba(255,255,255,.6)">'+p.rating+' ('+p.ratingCount+')</span></p>';}
window._sgShopReviews=async function(id,owned){
  var el=document.getElementById('sg-shop-reviews');if(!el)return;
  try{
    var d=await fetch('/api/shop/products/'+id+'/reviews',{credentials:'include'}).then(function(r){return r.json();});
    var h='<p style="margin:4px 0 6px;font-size:14px;font-weight:800">Customer reviews'+(d.count?' <span style="color:#FFB020">'+_sgShopStarStr(d.rating)+'</span> <span style="color:rgba(255,255,255,.6);font-weight:600">'+d.rating+' out of 5 · '+d.count+' rating'+(d.count>1?'s':'')+'</span>':'')+'</p>';
    if(owned){
      h+='<div style="border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;margin:0 0 10px"><p style="margin:0 0 6px;font-size:13px;font-weight:700">Rate this product</p>'
        +'<div id="sg-rv-stars" data-v="0" style="font-size:28px;color:#FFB020;letter-spacing:4px;cursor:pointer">'
        +[1,2,3,4,5].map(function(i){return '<span data-s="'+i+'" onclick="var w=this.parentNode;w.dataset.v='+i+';Array.prototype.forEach.call(w.children,function(c){c.textContent=+c.dataset.s<='+i+'?\'\u2605\':\'\u2606\';})">\u2606</span>';}).join('')+'</div>'
        +'<textarea id="sg-rv-text" maxlength="1000" placeholder="What did you like? (optional)" style="width:100%;min-height:60px;margin:6px 0;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:#fff;padding:8px;font:inherit;font-size:13px"></textarea>'
        +'<button type="button" onclick="window._sgShopSendReview('+id+')" style="width:100%;border:0;border-radius:12px;padding:10px;background:#FF6D00;color:#fff;font-weight:800;cursor:pointer">Post review</button></div>';
    }
    h+=(d.reviews||[]).map(function(r){return '<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.08)"><p style="margin:0;font-size:13px;font-weight:700">'+_sgShopEsc(r.name)+' <span style="color:#FFB020">'+_sgShopStarStr(r.rating)+'</span></p><p style="margin:2px 0;color:#FF9A4D;font-size:11px;font-weight:700">\u2705 Verified purchase</p>'+(r.body?'<p style="margin:2px 0 0;color:rgba(255,255,255,.75);font-size:13px;line-height:1.4">'+_sgShopEsc(r.body)+'</p>':'')+'</div>';}).join('');
    if(!d.count&&!owned)h+='<p style="margin:0 0 10px;color:rgba(255,255,255,.5);font-size:13px">No reviews yet. Buyers can rate it after they download.</p>';
    el.innerHTML=h;
  }catch(e){el.innerHTML='';}
};
window._sgShopSendReview=async function(id){
  var v=+((document.getElementById('sg-rv-stars')||{}).dataset||{}).v||0;
  if(!v){if(typeof sgToast==='function')sgToast('Tap the stars first','error',1800);return;}
  try{
    var r=await fetch('/api/shop/products/'+id+'/reviews',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:v,body:(document.getElementById('sg-rv-text')||{}).value||''})});
    var j=await r.json().catch(function(){return {};});
    if(!r.ok)throw new Error(j.error||'Could not save');
    if(typeof sgToast==='function')sgToast('Thanks for your review \u2B50','success',1800);
    window._sgShopReviews(id,false);
  }catch(e){if(typeof sgToast==='function')sgToast(e.message,'error',2200);}
};

function _sgShopEsc(text){
  return String(text==null?'':text).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}

window._sgShopOpen=function(productId){
  var p=_sgShopState.products.filter(function(x){return x.id===productId;})[0];
  if(!p)return;
  var owned=_sgShopState.owned[p.id];
  var seen=_sgShopLS('sg_shop_seen').filter(function(x){return x!==p.id;});seen.unshift(p.id);
  try{localStorage.setItem('sg_shop_seen',JSON.stringify(seen.slice(0,12)));}catch(e){}
  setTimeout(function(){window._sgShopAlso(p.id);window._sgShopReviews(p.id,!!owned);},0);
  /* Task 65 round 2 (Amazon product page): big picture, price block, Save +
     Share, a details table, Read more, and More from this creator. */
  var saved=_sgShopLS('sg_shop_saved').indexOf(p.id)>=0;
  var fmt=/pdf/i.test(p.contentType||p.fileName||'')?'PDF':((p.fileName||'').split('.').pop()||'File').toUpperCase();
  var more=_sgShopState.products.filter(function(x){return x.creatorHandle===p.creatorHandle&&x.id!==p.id;}).slice(0,10);
  var desc=String(p.description||'');
  var dRow=function(k,v){return '<tr><td style="padding:6px 8px 6px 0;color:rgba(255,255,255,.5);font-size:13px;white-space:nowrap">'+k+'</td><td style="padding:6px 0;font-size:13px;font-weight:600">'+v+'</td></tr>';};
  var body='<div style="padding:4px 2px 8px">'
    /* Task 158 B2: tap the picture to see it full screen (Amazon zoom). */
    +(p.coverImageUrl?'<img src="'+_sgShopEsc(p.coverImageUrl)+'" alt="'+_sgShopEsc(p.title)+'" onclick="window._sgShopZoom(this.src)" style="display:block;width:100%;max-height:260px;object-fit:cover;border-radius:12px;margin:0 0 12px;cursor:zoom-in">':'')
    +_sgShopStars(p)
    +(owned?'':'<div style="margin:0 0 4px">'+_sgShopPrice(p.price)+'</div>')
    +'<p style="margin:0 0 10px;color:#86efac;font-size:12px;font-weight:600">⚡ Instant PDF download · 🔒 Secure checkout</p>'
    +'<div style="display:flex;gap:8px;margin:0 0 12px">'
    +'<button type="button" id="sg-shop-save" onclick="window._sgShopHeart('+p.id+');var s=_sgShopLS(\'sg_shop_saved\').indexOf('+p.id+')>=0;this.textContent=s?\'❤️ Saved\':\'🤍 Save for later\'" style="flex:1;border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:9px;background:rgba(255,255,255,.06);color:#fff;font-weight:700;font-size:13px;cursor:pointer">'+(saved?'❤️ Saved':'🤍 Save for later')+'</button>'
    +'<button type="button" onclick="window._sgShopShare('+p.id+')" style="flex:1;border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:9px;background:rgba(255,255,255,.06);color:#fff;font-weight:700;font-size:13px;cursor:pointer">↗️ Share</button></div>'
    +(p.salesCount?'<p style="margin:0 0 8px;color:#FF6D00;font-size:12px;font-weight:800">\uD83D\uDD25 '+p.salesCount+' people bought this</p>':'')
    +(p.fileSizeKb?'<p style="margin:0 0 10px;color:rgba(255,255,255,.5);font-size:12px">'+p.fileSizeKb+' KB</p>':'')
    +_sgShopAbout(desc)
    +'<p id="sg-shop-desc" style="margin:0 0 6px;color:rgba(255,255,255,.75);font-size:14px;line-height:1.5;white-space:pre-wrap;'+(desc.length>220?'display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden':'')+'">'+_sgShopEsc(desc)+'</p>'
    +(desc.length>220?'<button type="button" onclick="var d=document.getElementById(\'sg-shop-desc\');var o=d.style.display===\'block\';d.style.display=o?\'-webkit-box\':\'block\';this.textContent=o?\'Read more\':\'Show less\'" style="border:0;background:none;color:#7dd3fc;font-weight:700;font-size:13px;padding:0;margin:0 0 14px;cursor:pointer">Read more</button>':'<div style="height:10px"></div>')
    +'<p style="margin:0 0 4px;font-size:14px;font-weight:800">Product details</p><table style="border-collapse:collapse;margin:0 0 14px">'
    +dRow('Format',fmt)+(p.fileSizeKb?dRow('File size',p.fileSizeKb+' KB'):'')+dRow('Category',_sgShopEsc(p.category))+dRow('Sold by','<a href="#" onclick="event.preventDefault();window._sgShopStore(\''+_sgShopEsc(p.creatorHandle).replace(/'/g,'')+'\')" style="color:#7dd3fc;text-decoration:none">@'+_sgShopEsc(p.creatorHandle)+' \u203a Visit store</a>')+dRow('Delivery','Instant download + email copy')+'</table>'
    +(more.length?_sgShopRow('More from @'+_sgShopEsc(p.creatorHandle),more.map(_sgShopMini).join('')):'')
    +'<div id="sg-shop-buy-error" style="display:none;color:#f87171;font-size:13px;margin-bottom:10px"></div>'
    +'<div id="sg-shop-reviews"></div>'
    +'<div id="sg-shop-also"></div>'
    +'<div style="position:sticky;bottom:0;background:#12141d;padding:10px 0 4px;z-index:2">'
    +(owned
      ? '<a href="'+owned+'" style="display:block;text-align:center;border-radius:14px;padding:15px;background:#22c55e;color:#fff;font-weight:800;text-decoration:none">Download again</a>'
      : '<button type="button" id="sg-shop-buy-btn" onclick="window._sgShopBuy('+p.id+')" style="width:100%;border:0;border-radius:14px;padding:15px;background:#FF6D00;color:#fff;font-weight:800;font-size:15px;cursor:pointer">\u26A1 Buy now \u00b7 '+_sgShopEsc(p.price)+' \u00b7 1 tap</button>')
    +'</div>'
    +'<p style="margin:10px 0 0;color:rgba(255,255,255,.4);font-size:11px;text-align:center">Instant download, and a copy by email. Digital product — no refunds once downloaded.</p>'
    +'</div>';
  window._sgShopSimpleSheet(body,{title:p.title,sub:'@'+p.creatorHandle+' \u00b7 '+p.category,icon:'\uD83D\uDCC4'});
};

/* Task 158 B2: Amazon's "About this item" — the description's own bullet
   lines, or its first sentences, as up to 5 scannable points above the prose. */
function _sgShopAbout(desc){
  var d=String(desc||'').trim(); if(d.length<80)return '';
  var pts=d.split(/\n+/).map(function(l){return l.replace(/^\s*[-•*✅✔️▪️]+\s*/,'').trim();}).filter(function(l){return l.length>3;});
  if(pts.length<2)pts=d.split(/(?<=[.!?])\s+/).filter(function(x){return x.trim().length>12;});
  pts=pts.slice(0,5); if(pts.length<2)return '';
  return '<p style="margin:0 0 4px;font-size:14px;font-weight:800">About this item</p><ul style="margin:0 0 12px;padding-left:18px;color:rgba(255,255,255,.85);font-size:13px;line-height:1.5">'
    +pts.map(function(x){return '<li style="margin:0 0 4px">'+_sgShopEsc(x.length>140?x.slice(0,137)+'…':x)+'</li>';}).join('')+'</ul>';
}
window._sgShopZoom=function(src){
  var z=document.createElement('div');
  z.style.cssText='position:fixed;inset:0;z-index:var(--sg-z-overlay,10000);background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;touch-action:pinch-zoom';
  z.innerHTML='<img src="'+_sgShopEsc(src)+'" alt="" style="max-width:100%;max-height:100%;object-fit:contain"><div style="position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:14px;width:40px;height:40px;border-radius:50%;background:#ef4444;color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center">\u2715</div>';
  z.addEventListener('click',function(){z.remove();});
  document.body.appendChild(z);
};

/* The app has several bespoke sheets and no shared one; this is the smallest
   correct thing rather than a sixth variant with its own dismiss bugs. */
window._sgShopSimpleSheet=function(html,opts){
  /* The shared half-screen sheet (sg-half-sheet.js): red ✕, swipe down, back
     button. Owner, 2026-09-30. The inline fallback stays for a page that has
     not loaded it. */
  if(typeof window.sgOpenSheet==='function') return window.sgOpenSheet(html,opts||{});
  var old=document.getElementById('sg-shop-sheet');
  if(old)old.remove();
  var el=document.createElement('div');
  el.id='sg-shop-sheet';
  el.style.cssText='position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.6);display:flex;align-items:flex-end';
  el.innerHTML='<div style="width:100%;max-height:80vh;overflow:auto;background:#12141d;color:#fff;border-radius:20px 20px 0 0;padding:18px 18px calc(24px + env(safe-area-inset-bottom,0px))">'
    +'<div style="width:38px;height:4px;border-radius:3px;background:rgba(255,255,255,.25);margin:0 auto 14px"></div>'+html+'</div>';
  el.addEventListener('click',function(event){ if(event.target===el) el.remove(); });
  document.body.appendChild(el);
};

window._sgShopBuy=async function(productId){
  var btn=document.getElementById('sg-shop-buy-btn');
  var err=document.getElementById('sg-shop-buy-error');
  if(!state.user){
    if(typeof window._sgShowAuthSheet==='function'){window._sgShowAuthSheet('book');return;}
    navigate('/login');return;
  }
  if(btn){btn.textContent='Paying…';btn.disabled=true;}
  if(err)err.style.display='none';
  try{
    var r=await fetch('/api/shop/checkout',{method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:productId})})
      .then(function(res){return res.json();});
    if(r.success&&r.downloadUrl){
      _sgShopState.owned[productId]=r.downloadUrl;
      var sheet=document.getElementById('sg-shop-sheet');
      if(sheet)sheet.remove();
      if(typeof window.sgCloseSheet==='function')window.sgCloseSheet();
      sgToast(r.alreadyOwned?'You already own this — downloading':'Paid! Your download is ready 🎉','success',4000);
      window.location.href=r.downloadUrl;
      window._sgShopRender();
      return;
    }
    if(r.code==='needs_card'){
      if(err){err.textContent='Add a card first — opening your payment sheet.';err.style.display='block';}
      if(typeof window._sgShowAuthSheet==='function')window._sgShowAuthSheet('book');
    }else if(err){
      err.textContent=r.error||'Payment failed';err.style.display='block';
    }
  }catch(e){
    if(err){err.textContent='Network error — try again';err.style.display='block';}
  }
  if(btn){btn.textContent='Try again';btn.disabled=false;}
};

/* ── Listing a product (creators) ── */
window._sgShopOpenSell=function(opts){
  /* Task 101: "Sell" under a Create result passes that creation in; the file
     box is replaced by it and the server copies the file across. */
  window._sgShopSellSource=(opts&&opts.sourceUrl)||null;
  if(!state.user){
    if(typeof window._sgShowAuthSheet==='function')return window._sgShowAuthSheet('book');
    return navigate('/login');
  }
  var field='width:100%;box-sizing:border-box;padding:12px;margin:0 0 10px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.05);color:#fff;font-size:15px';
  var cats=['Prompt packs','Workout plans','Meal guides','Video programs','Templates'];
  window._sgShopSimpleSheet(
    '<h2 style="margin:0 0 4px;font-size:19px;font-weight:900">Sell a digital product</h2>'
    +'<p style="margin:0 0 14px;color:rgba(255,255,255,.5);font-size:12px">PDF, ZIP, image, MP3 or MP4, up to 50MB. You keep 70% of every sale.</p>'
    +'<input id="sg-shop-title" placeholder="Title — e.g. 50 Gym Reel Prompts" maxlength="120" style="'+field+'">'
    +'<textarea id="sg-shop-desc" placeholder="What the buyer gets" rows="3" style="'+field+'"></textarea>'
    +'<select id="sg-shop-cat" style="'+field+'">'+cats.map(function(c){return '<option>'+c+'</option>';}).join('')+'</select>'
    +'<input id="sg-shop-price" type="number" min="1" max="500" step="0.01" placeholder="Price in £ (min £1)" style="'+field+'">'
    +(window._sgShopSellSource
      ?'<div id="sg-shop-src" style="'+field+'display:flex;align-items:center;gap:10px">'+(opts&&opts.kind==='image'?'<img alt="" src="'+window._sgShopSellSource+'" style="width:44px;height:44px;border-radius:8px;object-fit:cover">':'🎬')+'<span>Your creation is attached ✓</span></div>'
      :'<input id="sg-shop-file" type="file" accept=".pdf,.zip,.epub,image/*,audio/mpeg,video/mp4" style="'+field+'">')
    +'<div id="sg-shop-sell-error" style="display:none;color:#f87171;font-size:13px;margin-bottom:10px"></div>'
    +'<button type="button" id="sg-shop-sell-btn" onclick="window._sgShopSubmitProduct()" style="width:100%;border:0;border-radius:14px;padding:15px;background:#FF6D00;color:#fff;font-weight:800;font-size:15px;cursor:pointer">List it</button>'
  );
};

window._sgShopSubmitProduct=async function(){
  var btn=document.getElementById('sg-shop-sell-btn');
  var err=document.getElementById('sg-shop-sell-error');
  var title=(document.getElementById('sg-shop-title')||{}).value||'';
  var price=(document.getElementById('sg-shop-price')||{}).value||'';
  var fileInput=document.getElementById('sg-shop-file');
  function fail(message){ if(err){err.textContent=message;err.style.display='block';} }
  if(!title.trim())return fail('Give your product a title');
  if(!(parseFloat(price)>=1))return fail('Price must be at least £1.00');
  var src=window._sgShopSellSource;
  if(!src&&(!fileInput||!fileInput.files||!fileInput.files[0]))return fail('Attach the file buyers will download');
  var form=new FormData();
  form.append('title',title.trim());
  form.append('description',((document.getElementById('sg-shop-desc')||{}).value||'').trim());
  form.append('category',(document.getElementById('sg-shop-cat')||{}).value||'Prompt packs');
  form.append('price',price);
  if(src){form.append('sourceUrl',src);if(/\.(jpe?g|png)(\?|$)/i.test(src))form.append('coverImageUrl',src);}
  else form.append('file',fileInput.files[0]);
  if(btn){btn.textContent='Uploading…';btn.disabled=true;}
  if(err)err.style.display='none';
  try{
    var r=await fetch('/api/shop/products',{method:'POST',credentials:'include',body:form})
      .then(function(res){return res.json();});
    if(r.success){
      var sheet=document.getElementById('sg-shop-sheet');
      if(sheet)sheet.remove();
      if(typeof window.sgCloseSheet==='function')window.sgCloseSheet();
      sgToast('Listed! It is live in the Shop 🎉','success',4000);
      _sgShopState.loaded=false;
      window._sgShopLoad(true);
      return;
    }
    fail(r.error||'Could not list that product');
  }catch(e){
    fail('Upload failed — try again');
  }
  if(btn){btn.textContent='List it';btn.disabled=false;}
};

// ─── More Hub Page (Everything Else) ───
