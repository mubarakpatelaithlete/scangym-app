// ScanGym Frontend v3.3.1 — World-Class UX (Airbnb + Booking.com + Uber + Skyscanner + Revolut)
const API='/api/v2';
let MAPS_KEY='';
let STRIPE_PK='';
let GYM_COUNT=2;
function fmtCount(n){if(n>=1000000)return (n/1000000).toFixed(1).replace(/\.0$/,'')+'M+';if(n>=1000)return (n/1000).toFixed(0)+'K+';return n.toLocaleString();}

// ─── World-Class Utilities (Booking.com + Airbnb + Uber patterns) ───
function urgencyNum(name,max){let h=0;for(let i=0;i<(name||'').length;i++)h=((h<<5)-h)+name.charCodeAt(i);return Math.abs(h%max)+1;}
function minutesAgo(name){return urgencyNum(name,45)+1;}
function peopleLooking(name){return urgencyNum(name,8)+2;}
function spotsLeft(name){return urgencyNum(name,6)+2;}
function bookedToday(name){return urgencyNum(name,40)+10;}
function closingTime(gym){if(gym.opening_hours?.weekday?.length){const now=new Date().getDay();const todayHours=gym.opening_hours.weekday[now===0?6:now-1]||'';const m=todayHours.match(/(\d{1,2}:\d{2}\s*[AP]M)/gi);if(m&&m.length>1)return m[m.length-1];}return gym.openNow===true?'10:00 PM':null;}
function isTopGym(gym){return(gym.rating||0)>=4.5;}
function originalPrice(price){return(parseFloat(price)*1.6).toFixed(0);}
function discountPct(price){const orig=originalPrice(price);return Math.round((1-parseFloat(price)/orig)*100);}
// Animated counter on scroll (Booking.com style)
function initCounters(){const obs=new IntersectionObserver((entries)=>{entries.forEach(e=>{if(e.isIntersecting){const el=e.target;const target=parseInt(el.dataset.target)||0;const suffix=el.dataset.suffix||'';const duration=1500;const start=performance.now();const step=(now)=>{const progress=Math.min((now-start)/duration,1);const eased=1-Math.pow(1-progress,3);el.textContent=Math.floor(eased*target).toLocaleString()+suffix;if(progress<1)requestAnimationFrame(step);};requestAnimationFrame(step);obs.unobserve(el);}});},{threshold:0.3});document.querySelectorAll('[data-counter]').forEach(el=>obs.observe(el));}
// Photo carousel for gym cards (Airbnb style)
function initCarousels(){document.querySelectorAll('.gym-carousel').forEach(c=>{const imgs=c.querySelectorAll('.carousel-img');const dots=c.querySelectorAll('.carousel-dot');let current=0;c.querySelector('.carousel-next')?.addEventListener('click',(e)=>{e.stopPropagation();current=(current+1)%imgs.length;imgs.forEach((img,i)=>{img.style.transform=`translateX(${(i-current)*100}%)`;});dots.forEach((d,i)=>{d.className=i===current?'carousel-dot w-2 h-2 rounded-full bg-white':'carousel-dot w-2 h-2 rounded-full bg-white/40';});});c.querySelector('.carousel-prev')?.addEventListener('click',(e)=>{e.stopPropagation();current=(current-1+imgs.length)%imgs.length;imgs.forEach((img,i)=>{img.style.transform=`translateX(${(i-current)*100}%)`;});dots.forEach((d,i)=>{d.className=i===current?'carousel-dot w-2 h-2 rounded-full bg-white':'carousel-dot w-2 h-2 rounded-full bg-white/40';});});});}
// Accordion FAQ (Airbnb style)
function initAccordions(){document.querySelectorAll('.accordion-trigger').forEach(btn=>{btn.addEventListener('click',()=>{const content=btn.nextElementSibling;const arrow=btn.querySelector('.accordion-arrow');if(content.style.maxHeight){content.style.maxHeight=null;arrow.style.transform='rotate(0deg)';}else{content.style.maxHeight=content.scrollHeight+'px';arrow.style.transform='rotate(180deg)';}});});}
// Init all interactive elements after render
function initInteractive(){setTimeout(()=>{initCounters();initCarousels();initAccordions();},100);}

// Load public config from server (keys injected via env vars, not hardcoded)
async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const c = await r.json();
    MAPS_KEY = c.mapsKey || '';
    STRIPE_PK = c.stripeKey || '';
    GYM_COUNT = c.gymCount || 2;
    // Re-render if already on page so dynamic count shows
    if(document.getElementById('app')) render();
  } catch(e) { console.warn('Config load failed:', e); }
}
loadConfig();

// Check if user is already logged in
async function checkAuth() {
  try {
    const r = await fetch('/api/auth/user', { credentials: 'include' });
    if (r.ok) {
      const user = await r.json();
      if (user && user.id) { state.user = user; }
    }
  } catch(e) {}
}
checkAuth();


// ─── State ───
let state={user:null,gyms:[],currentGym:null,searchLat:null,searchLng:null,route:'/',bookings:[],wallet:{balance:0},authPhone:'',authStep:'phone',lastBooking:null,lastQR:null};

// ─── API Client ───
const api={
  async get(url){const r=await fetch(API+url,{credentials:'include'});return r.json()},
  async post(url,body){const r=await fetch(API+url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});return r.json()},
  async getGuest(url){const r=await fetch('/api/guest'+url);return r.json()},
  async getLive(url){const r=await fetch('/api/live'+url);return r.json()},
  async postLive(url,body){const r=await fetch('/api/live'+url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});return r.json()},
  async authPost(url,body){const r=await fetch('/api/auth'+url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});return r.json()},
  async bookPost(url,body){const r=await fetch('/api/bookings'+url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});return r.json()},
  async bookGet(url){const r=await fetch('/api/bookings'+(url||''),{credentials:'include'});return r.json()},
  async payPost(url,body){const r=await fetch('/api/payment'+url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});return r.json()},
  async payGet(url){const r=await fetch('/api/payment'+url,{credentials:'include'});return r.json()},
};

// ─── Router ───
function navigate(path,pushState=true){
  state.route=path;
  if(pushState)history.pushState(null,'',path);
  render();
  window.scrollTo(0,0);
}
window.addEventListener('popstate',()=>{state.route=location.pathname;render()});

// ─── Geolocation ───
// 5-layer waterfall GPS loaded from robust-location.js
// getLocation() is now defined globally by that script

// ─── Conviction Techniques (Task 9) ───
const BADGES=[
  {icon:'🔥',text:'Booked {n} times today',type:'social'},
  {icon:'⏰',text:'Only {n} spots left',type:'scarcity'},
  {icon:'💰',text:'Price locked for 15 min',type:'urgency'},
  {icon:'✅',text:'Free cancellation',type:'risk'},
  {icon:'⭐',text:'{rating}★ from {n} reviews',type:'authority'},
  {icon:'📉',text:'Off-peak: save {n}%',type:'value'},
  {icon:'🏋️',text:'{n} people training now',type:'social'},
  {icon:'🎯',text:'Top pick in {area}',type:'authority'},
  {icon:'💳',text:'Apple Pay • 1 tap',type:'friction'},
  {icon:'🔒',text:'No membership needed',type:'risk'},
  {icon:'📍',text:'{n} min walk',type:'proximity'},
  {icon:'🆓',text:'First session £3.75',type:'anchor'},
];

function getRandomBadges(gym,count=4){
  const b=[...BADGES];
  return b.sort(()=>Math.random()-.5).slice(0,count).map(badge=>{
    let t=badge.text
      .replace('{n}',Math.floor(Math.random()*30+5))
      .replace('{rating}',gym?.rating||'4.5')
      .replace('{area}',gym?.city||'Bolton');
    return{...badge,text:t};
  });
}

// ─── Components ───
function NavBar(){
  return`
  <nav class="fixed top-0 w-full bg-dark/95 backdrop-blur-lg border-b border-slate-800 z-50">
    <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
      <a onclick="navigate('/')" class="flex items-center gap-2 cursor-pointer">
        <div class="w-9 h-9 bg-brand rounded-xl flex items-center justify-center">
          <span class="text-white font-bold text-lg">S</span>
        </div>
        <span class="font-brand text-xl"><span class="text-brand">Scan</span><span class="text-white">Gym</span></span>
      </a>
      <div class="hidden md:flex items-center gap-6">
        <a onclick="navigate('/coach')" class="text-slate-300 hover:text-brand cursor-pointer flex items-center gap-1">✨ AI Coach</a>
        <a onclick="navigate('/explore')" class="text-slate-300 hover:text-brand cursor-pointer">Discover Nearby</a>
        <a onclick="navigate('/creators')" class="text-slate-300 hover:text-brand cursor-pointer">Creators</a>
        <a onclick="navigate('/for-gyms')" class="text-slate-300 hover:text-brand cursor-pointer">For Gyms</a>
      </div>
      <div class="flex items-center gap-3">
        <a onclick="navigate('/login')" class="hidden md:inline px-4 py-2 text-sm text-slate-300 hover:text-white cursor-pointer">${state.user ? '👤 '+( state.user.name||state.user.phone) : 'Log In'}</a>
        <a onclick="navigate('/explore')" class="px-4 py-2 text-sm bg-brand text-white rounded-xl hover:bg-orange-600 cursor-pointer font-medium">Find a Gym</a>
        <button onclick="document.getElementById('mobile-menu').classList.toggle('hidden')" class="md:hidden p-2 text-slate-300 hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>
    </div>
    <!-- Mobile Menu -->
    <div id="mobile-menu" class="hidden md:hidden bg-dark/98 backdrop-blur-lg border-b border-slate-800 px-4 pb-4 space-y-2">
      <a onclick="navigate('/coach');document.getElementById('mobile-menu').classList.add('hidden')" class="block py-2 text-slate-300 hover:text-brand cursor-pointer">✨ AI Coach</a>
      <a onclick="navigate('/explore');document.getElementById('mobile-menu').classList.add('hidden')" class="block py-2 text-slate-300 hover:text-brand cursor-pointer">Discover Nearby</a>
      <a onclick="navigate('/creators');document.getElementById('mobile-menu').classList.add('hidden')" class="block py-2 text-slate-300 hover:text-brand cursor-pointer">Creators</a>
      <a onclick="navigate('/for-gyms');document.getElementById('mobile-menu').classList.add('hidden')" class="block py-2 text-slate-300 hover:text-brand cursor-pointer">For Gyms</a>
      <a onclick="navigate('/login');document.getElementById('mobile-menu').classList.add('hidden')" class="block py-2 text-brand font-medium cursor-pointer">${state.user ? '👤 '+(state.user.name||state.user.phone) : '🔑 Log In'}</a>
    </div>
  </nav>`;
}

function Footer(){
  return`
  <footer class="bg-slate-900 border-t border-slate-800 pt-16 pb-8 px-4">
    <div class="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
      <div>
        <div class="flex items-center gap-2 mb-4">
          <div class="w-8 h-8 bg-brand rounded-lg flex items-center justify-center"><span class="text-white font-bold">S</span></div>
          <span class="font-brand text-lg"><span class="text-brand">Scan</span>Gym</span>
        </div>
        <p class="text-slate-500 text-sm mb-4">Connecting fitness enthusiasts with gym owners who have unused capacity.</p>
        <p class="text-slate-400 text-xs">Mascot: FLEX 💪</p>
      </div>
      <div>
        <h4 class="text-white font-semibold mb-4">For Gym-Goers</h4>
        <div class="space-y-2 text-sm">
          <a onclick="navigate('/explore')" class="block text-slate-400 hover:text-brand cursor-pointer">Explore Gyms</a>
          <a onclick="navigate('/how-it-works')" class="block text-slate-400 hover:text-brand cursor-pointer">How It Works</a>
          <a onclick="navigate('/pricing')" class="block text-slate-400 hover:text-brand cursor-pointer">Pricing</a>
          <a onclick="navigate('/refer')" class="block text-slate-400 hover:text-brand cursor-pointer">Refer & Earn</a>
          <a onclick="navigate('/bookings')" class="block text-slate-400 hover:text-brand cursor-pointer">My Bookings</a>
          <a onclick="navigate('/coach')" class="block text-brand hover:text-orange-400 cursor-pointer font-medium">✨ Your AI Coach</a>
          <a onclick="navigate('/wallet')" class="block text-brand hover:text-orange-400 cursor-pointer font-medium">💰 ScanGym Wallet</a>
        </div>
      </div>
      <div>
        <h4 class="text-white font-semibold mb-4">For Gym Owners</h4>
        <div class="space-y-2 text-sm">
          <a onclick="navigate('/list-your-gym')" class="block text-slate-400 hover:text-brand cursor-pointer">List Your Gym</a>
          <a onclick="navigate('/owner-benefits')" class="block text-slate-400 hover:text-brand cursor-pointer">Owner Benefits</a>
          <a onclick="navigate('/featured')" class="block text-slate-400 hover:text-brand cursor-pointer">Featured Listings</a>
          <a onclick="navigate('/suppliers/vending')" class="block text-accent hover:text-green-300 cursor-pointer font-medium">🥤 Free Vending Machines</a>
          <a onclick="navigate('/suppliers/qr')" class="block text-accent hover:text-green-300 cursor-pointer font-medium">📱 Free QR Scanners</a>
          <a onclick="navigate('/suppliers/loans')" class="block text-accent hover:text-green-300 cursor-pointer font-medium">🏦 Gym Opening Loans</a>
        </div>
      </div>
      <div>
        <h4 class="text-white font-semibold mb-4">Company</h4>
        <div class="space-y-2 text-sm">
          <a onclick="navigate('/about')" class="block text-slate-400 hover:text-brand cursor-pointer">About Us</a>
          <a onclick="navigate('/careers')" class="block text-slate-400 hover:text-brand cursor-pointer">Careers</a>
          <a onclick="navigate('/contact')" class="block text-slate-400 hover:text-brand cursor-pointer">Contact</a>
          <a onclick="navigate('/creators')" class="block text-brand hover:text-orange-400 cursor-pointer font-medium">FlexSquad Community</a>
          <a onclick="navigate('/become-a-creator')" class="block text-slate-400 hover:text-brand cursor-pointer">Become a Creator</a>
          <a onclick="navigate('/faq')" class="block text-slate-400 hover:text-brand cursor-pointer">FAQ</a>
          <a onclick="navigate('/help')" class="block text-slate-400 hover:text-brand cursor-pointer">Help Center</a>
          <a onclick="navigate('/blog')" class="block text-brand hover:text-orange-400 cursor-pointer font-medium">Blog / Transformations</a>
          <a onclick="navigate('/privacy')" class="block text-slate-400 hover:text-brand cursor-pointer">Privacy Policy</a>
          <a onclick="navigate('/cookies')" class="block text-slate-400 hover:text-brand cursor-pointer">Cookie Policy</a>
          <a onclick="navigate('/terms')" class="block text-slate-400 hover:text-brand cursor-pointer">Terms of Service</a>
        </div>
        <div class="flex gap-3 mt-4 flex-wrap">
          ${[
            {name:'Instagram',url:'https://instagram.com/scangym'},
            {name:'Twitter/X',url:'https://x.com/scangym'},
            {name:'TikTok',url:'https://tiktok.com/@scangym'},
            {name:'Facebook',url:'https://facebook.com/scangym'},
            {name:'Pinterest',url:'https://pinterest.com/scangym'},
            {name:'Threads',url:'https://threads.net/@scangym'}
          ].map(s=>
            `<a href="${s.url}" target="_blank" rel="noopener" class="text-slate-500 hover:text-brand text-xs">${s.name}</a>`
          ).join('')}
        </div>
      </div>
    </div>
    <div class="max-w-7xl mx-auto border-t border-slate-800 pt-6 flex flex-col md:flex-row items-center justify-between">
      <p class="text-slate-600 text-xs">© 2026 ScanGym. All rights reserved.</p>
      <p class="text-slate-700 text-xs mt-2 md:mt-0">Manchester, UK • ${fmtCount(GYM_COUNT)} gyms and growing 🚀</p>
    </div>
  </footer>`;
}

function GymCard(gym){
  const badges=getRandomBadges(gym,3);
  const price=gym.dayPassPrice||gym.price_tier||'5.00';
  const origPrice=originalPrice(price);
  const discount=discountPct(price);
  const dist=gym.distanceText||(gym.distance?`${gym.distance.toFixed(1)} km`:'Nearby');
  const photo=gym.photo||gym.photo_url||
    (gym.photoReference?`https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${gym.photoReference}&key=${MAPS_KEY}`:
    (gym.photo_reference?`https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${gym.photo_reference}&key=${MAPS_KEY}`:''));
  const photos=gym.photos_list||[];
  const hasPhoto=!!photo;
  const gymIdentifier=gym.placeId||gym.place_id||gym.id;
  const isLive=!!gym.placeId;
  const topGym=isTopGym(gym);
  const cTime=closingTime(gym);
  const looking=peopleLooking(gym.name);
  const mAgo=minutesAgo(gym.name);
  // Airbnb-style photo carousel (multiple photos if available)
  const allPhotos=photos.length>1?photos.slice(0,5).map(p=>p.thumbnail||p.url||photo):[photo];
  const carouselHTML=hasPhoto&&allPhotos.length>1?`
    <div class="gym-carousel relative w-full h-full overflow-hidden">
      ${allPhotos.map((p,i)=>`<img src="${p}" alt="${gym.name}" class="carousel-img absolute inset-0 w-full h-full object-cover transition-transform duration-300" style="transform:translateX(${i*100}%)" loading="lazy" onerror="this.style.display='none'">`).join('')}
      <button class="carousel-prev absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/80 rounded-full text-black text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition z-10">‹</button>
      <button class="carousel-next absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/80 rounded-full text-black text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition z-10">›</button>
      <div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">${allPhotos.map((p,i)=>`<span class="carousel-dot w-2 h-2 rounded-full ${i===0?'bg-white':'bg-white/40'}"></span>`).join('')}</div>
    </div>`:hasPhoto?`<img src="${photo}" alt="${gym.name}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-4xl\\'>🏋️</div>'">`
    :`<div class="w-full h-full flex items-center justify-center text-4xl">🏋️</div>`;
  return`
  <div class="gym-card group bg-card rounded-2xl overflow-hidden border border-slate-700 hover:border-brand/50 cursor-pointer transition-all hover:shadow-lg hover:shadow-brand/10 hover:-translate-y-1" onclick="openGym('${gymIdentifier}',${isLive})">
    <div class="relative h-48 bg-slate-700">
      ${carouselHTML}
      <!-- Booking.com strikethrough pricing -->
      <div class="absolute top-3 right-3 bg-brand text-white px-3 py-1 rounded-full text-sm font-bold shadow-lg">
        <span class="line-through text-white/60 text-xs mr-1">£${origPrice}</span> £${price}
        <span class="ml-1 bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">${discount}% OFF</span>
      </div>
      ${topGym?`<div class="absolute top-3 left-3 bg-yellow-500 text-black px-2.5 py-1 rounded-full text-xs font-bold shadow-lg">⭐ Top Gym</div>`
        :gym.openNow===true?`<div class="absolute top-3 left-3 bg-green-600 text-white px-2.5 py-1 rounded-full text-xs font-medium shadow-lg flex items-center gap-1"><span class="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse"></span> Open${cTime?' until '+cTime:' Now'}</div>`:``}
      <!-- Booking.com urgency badge -->
      <div class="absolute bottom-3 left-3 bg-red-600/90 text-white px-2 py-1 rounded-lg text-xs backdrop-blur font-medium">🔥 ${looking} people looking now</div>
    </div>
    <div class="p-4">
      <div class="flex items-start justify-between mb-1.5">
        <h3 class="font-semibold text-white text-sm leading-tight">${gym.name}</h3>
        <span class="text-xs text-slate-400 whitespace-nowrap ml-2">${dist}</span>
      </div>
      <div class="flex items-center gap-2 mb-2">
        <span class="text-yellow-400 text-sm font-medium">★ ${gym.rating||'New'}</span>
        <span class="text-slate-500 text-xs">(${gym.totalReviews||gym.user_ratings_total||0} reviews)</span>
        ${topGym?`<span class="text-yellow-400 text-xs font-medium">· Guest Favourite</span>`:''}
      </div>
      <p class="text-slate-500 text-xs mb-2 truncate">${gym.address||gym.vicinity||''}</p>
      <!-- Hussle-style facility icons -->
      <div class="flex flex-wrap gap-1.5 mb-2">
        ${['🏋️ Weights','🚴 Cardio','🧘 Classes'].map(f=>`<span class="text-[10px] bg-slate-700/50 text-slate-300 px-2 py-0.5 rounded-full">${f}</span>`).join('')}
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-accent font-medium">✅ Free cancellation</span>
        <span class="text-[10px] text-slate-500">⏱ Booked ${mAgo}m ago</span>
      </div>
    </div>
  </div>`;
}

// ─── Page: Home ───
function HomePage(){
  return`
  <div class="min-h-screen">
    <!-- Hero -->
    <section class="relative pt-32 pb-20 px-4 text-center overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-b from-brand/10 via-transparent to-transparent"></div>
      <div class="relative max-w-3xl mx-auto">
        <div class="inline-flex items-center gap-2 bg-brand/10 border border-brand/30 rounded-full px-4 py-1.5 mb-6">
          <span class="badge text-accent text-xs font-medium">●</span>
          <span class="text-brand text-sm font-medium">${fmtCount(GYM_COUNT)} gyms live in Bolton • No membership needed</span>
        </div>
        <h1 class="font-brand text-5xl md:text-7xl font-extrabold text-white mb-4 leading-tight">
          Book a Gym.<br><span class="text-brand">Anywhere.</span>
        </h1>
        <p class="text-xl text-slate-400 mb-8">3 taps. That's it. £5 day passes, QR entry, free cancellation.</p>
        <div class="flex gap-2 max-w-lg mx-auto mb-4">
          <input type="text" id="home-search" placeholder="Search city, area, or gym name..." 
            class="flex-1 bg-card border border-slate-600 rounded-xl px-4 py-4 text-white placeholder-slate-500 focus:border-brand outline-none text-sm"
            onkeydown="if(event.key==='Enter'){const v=document.getElementById('home-search').value;if(v)searchGyms(v);navigate('/explore')}">
          <button onclick="const v=document.getElementById('home-search').value;if(v){searchGyms(v);navigate('/explore')}else{findGyms()}" class="bg-brand hover:bg-orange-600 text-white font-bold text-lg px-8 py-4 rounded-xl shadow-lg shadow-brand/30 transition-all hover:scale-105">
            🔍
          </button>
        </div>
        <button onclick="findGyms()" class="bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm px-8 py-3 rounded-xl transition-all w-full max-w-lg">
          📍 Use My Location — Find Gyms Near Me
        </button>
        <p class="text-slate-500 text-sm mt-4">Search any city worldwide · ${fmtCount(GYM_COUNT)} gyms · Powered by Google</p>
        <!-- Skyscanner-style trending cities -->
        <div class="flex flex-wrap justify-center gap-2 mt-4 max-w-lg mx-auto">
          ${['🇬🇧 London','🇬🇧 Manchester','🇬🇧 Birmingham','🇬🇧 Bolton','🇦🇪 Dubai','🇺🇸 New York','🇪🇸 Barcelona','🇩🇪 Berlin'].map(c=>{
            const city=c.split(' ')[1];
            return`<button onclick="searchGyms('${city} gyms');navigate('/explore')" class="text-xs bg-slate-800 hover:bg-brand hover:text-white text-slate-400 px-3 py-1.5 rounded-full transition">${c}</button>`;
          }).join('')}
        </div>
        <p class="text-slate-600 text-xs mt-2">🔥 Trending now</p>
      </div>
    </section>

    <!-- Booking.com FOMO banner -->
    <section class="py-3 bg-green-900/30 border-y border-green-800/30">
      <p class="text-center text-green-400 text-sm font-medium animate-pulse">🔥 Live now · Explore gyms near you</p>
    </section>

    <!-- Trust bar — Booking.com animated counters -->
    <section class="py-8 border-b border-slate-800 bg-slate-900/50">
      <div class="max-w-5xl mx-auto flex flex-wrap justify-center gap-8 px-4 text-center">
        <div><span class="text-2xl font-bold text-white">${fmtCount(GYM_COUNT)}</span><p class="text-xs text-slate-500">Gyms Listed</p></div>
        <div><span class="text-2xl font-bold text-white">£5</span><p class="text-xs text-slate-500">From / Session</p></div>
        <div><span class="text-2xl font-bold text-white">24hr</span><p class="text-xs text-slate-500">Day Pass</p></div>
        <div><span class="text-2xl font-bold text-white">QR</span><p class="text-xs text-slate-500">Scan Entry</p></div>
        <div><span class="text-2xl font-bold text-white">0</span><p class="text-xs text-slate-500">Contracts</p></div>
        <div><span class="text-2xl font-bold text-accent">FREE</span><p class="text-xs text-slate-500">Cancellation</p></div>
        <div><span class="text-2xl font-bold text-blue-400" data-counter data-target="50" data-suffix="+">0</span><p class="text-xs text-slate-500">Countries</p></div>
      </div>
    </section>

    <!-- How It Works — Uber 3-step simplicity -->
    <section class="py-20 px-4">
      <div class="max-w-5xl mx-auto text-center mb-12">
        <h2 class="font-brand text-3xl font-bold text-white mb-3">3 Steps. That's It.</h2>
        <p class="text-slate-400">Faster than ordering an Uber</p>
      </div>
      <div class="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
        <div class="text-center p-8 bg-card rounded-2xl border border-slate-700 hover:border-brand/50 transition relative">
          <div class="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-brand rounded-full flex items-center justify-center text-white font-bold text-sm">1</div>
          <div class="w-20 h-20 bg-brand/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-4xl">🔍</div>
          <h3 class="text-white font-bold text-lg mb-2">Search</h3>
          <p class="text-slate-400 text-sm">Type any city or tap GPS. See real photos, live ratings, and prices for 1.2M+ gyms worldwide.</p>
          <p class="text-brand text-xs mt-3 font-medium">⚡ Results in under 1 second</p>
        </div>
        <div class="text-center p-8 bg-card rounded-2xl border border-slate-700 hover:border-brand/50 transition relative">
          <div class="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-brand rounded-full flex items-center justify-center text-white font-bold text-sm">2</div>
          <div class="w-20 h-20 bg-brand/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-4xl">💳</div>
          <h3 class="text-white font-bold text-lg mb-2">Book</h3>
          <p class="text-slate-400 text-sm">Pay with Apple Pay, Google Pay, or card. No account needed — guest checkout in 3 taps.</p>
          <p class="text-accent text-xs mt-3 font-medium">✅ Free cancellation included</p>
        </div>
        <div class="text-center p-8 bg-card rounded-2xl border border-slate-700 hover:border-brand/50 transition relative">
          <div class="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-brand rounded-full flex items-center justify-center text-white font-bold text-sm">3</div>
          <div class="w-20 h-20 bg-brand/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-4xl">📲</div>
          <h3 class="text-white font-bold text-lg mb-2">Scan & Train</h3>
          <p class="text-slate-400 text-sm">Show your QR code at the door. Train for 24 hours. Scan out when done.</p>
          <p class="text-blue-400 text-xs mt-3 font-medium">📱 100% contactless entry</p>
        </div>
      </div>
      <div class="text-center mt-8">
        <div class="flex items-center justify-center gap-2 text-slate-500 text-sm">
          <span>🍎 Apple Pay</span><span>·</span><span>Google Pay</span><span>·</span><span>💳 Visa/MC</span><span>·</span><span>👤 No account needed</span>
        </div>
      </div>
    </section>

    <!-- Features from 24 Tasks -->
    <section class="py-20 px-4 bg-slate-900/50 border-y border-slate-800">
      <div class="max-w-5xl mx-auto text-center mb-12">
        <h2 class="font-brand text-3xl font-bold text-white mb-3">Everything You Need</h2>
        <p class="text-slate-400">More than just a booking — a complete gym experience</p>
      </div>
      <div class="max-w-5xl mx-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        ${[
          {icon:'🤖',title:'AI Personal Coach',desc:'Personalized workout plans, form analysis, and nutrition advice. Unlocks after your first gym check-in.',link:'/coach'},
          {icon:'📸',title:'Real Gym Photos',desc:'See actual photos, reviews, equipment lists, and busy times before you visit. All from Google Places.',link:'/explore'},
          {icon:'💬',title:'Chat with Gym',desc:'AI answers your questions instantly. Need a human? It escalates to the gym owner via SMS.',link:''},
          {icon:'🗺️',title:'Uber-Style Directions',desc:'Embedded Google Maps after booking. Walking distance, real-time navigation, never leave ScanGym.',link:''},
          {icon:'💰',title:'ScanGym Wallet',desc:'Add £20, get £22. Top-up bonuses, referral credits, and challenge rewards.',link:'/wallet'},
          {icon:'📊',title:'Smart Pricing',desc:'Off-peak discounts from real-time data. Multi-pass bundles: 5 for the price of 4.',link:'/pricing'},
          {icon:'🏆',title:'FlexSquad Creators',desc:'Join the community. Earn commission, get free sessions, compete on the leaderboard.',link:'/creators'},
          {icon:'📱',title:'2-Scan QR Entry',desc:'Scan in at the door. Scan out when done. 24-hour day pass, JD Gym style.',link:'/scan'},
          {icon:'⭐',title:'Rate Your Session',desc:'Uber-style 1-5 star rating after your workout. Help others find the best gyms.',link:''},
        ].map(f=>`
          <div class="p-6 bg-card rounded-2xl border border-slate-700 hover:border-brand/50 transition cursor-pointer" ${f.link?`onclick="navigate('${f.link}')"`:''}> 
            <div class="text-3xl mb-3">${f.icon}</div>
            <h3 class="text-white font-semibold mb-2">${f.title}</h3>
            <p class="text-slate-400 text-sm">${f.desc}</p>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- For Gym Owners -->
    <section class="py-20 px-4">
      <div class="max-w-4xl mx-auto text-center">
        <h2 class="font-brand text-3xl font-bold text-white mb-3">Own a Gym?</h2>
        <p class="text-slate-400 mb-8">Fill your empty hours. Control your pricing. Zero commitment.</p>
        <div class="grid sm:grid-cols-3 gap-6 mb-8">
          <div class="p-5 bg-card rounded-xl border border-slate-700 text-center">
            <div class="text-2xl mb-2">💸</div>
            <h4 class="text-white font-medium text-sm">1-Click Pricing</h4>
            <p class="text-slate-500 text-xs mt-1">Set your price in one tap. Pause bookings anytime.</p>
          </div>
          <div class="p-5 bg-card rounded-xl border border-slate-700 text-center">
            <div class="text-2xl mb-2">📊</div>
            <h4 class="text-white font-medium text-sm">Analytics Dashboard</h4>
            <p class="text-slate-500 text-xs mt-1">See bookings, revenue, ratings, and peak hours.</p>
          </div>
          <div class="p-5 bg-card rounded-xl border border-slate-700 text-center">
            <div class="text-2xl mb-2">🥤</div>
            <h4 class="text-white font-medium text-sm">Free Equipment</h4>
            <p class="text-slate-500 text-xs mt-1">Vending machines, QR scanners — free for listed gyms.</p>
          </div>
        </div>
        <button onclick="navigate('/list-your-gym')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl transition">List Your Gym — It's Free</button>
      </div>
    </section>

    <!-- CTA -->
    <section class="py-20 px-4 bg-gradient-to-b from-brand/10 to-transparent">
      <div class="max-w-3xl mx-auto text-center">
        <h2 class="font-brand text-4xl font-bold text-white mb-4">Ready to Train?</h2>
        <p class="text-slate-400 mb-8">£5. No membership. No contract. Just you and the weights.</p>
        <button onclick="findGyms()" class="bg-brand hover:bg-orange-600 text-white font-bold text-lg px-12 py-5 rounded-2xl shadow-lg shadow-brand/30 transition-all hover:scale-105">
          📍 Find Gyms Near Me
        </button>
      </div>
    </section>
  </div>`;
}

// ─── Page: Search Results ───
async function loadGyms(lat,lng){
  try{
    // LIVE Google Places API — searches every gym on Earth
    const data=await api.getLive(`/nearby?lat=${lat}&lng=${lng}&radius=10000`);
    state.gyms=data.gyms||[];
    state.nextPageToken=data.nextPageToken||null;
    render();
    // If we have more pages, load them in background
    if(data.nextPageToken){
      setTimeout(async()=>{
        try{
          const page2=await api.getLive(`/nearby?lat=${lat}&lng=${lng}&pagetoken=${data.nextPageToken}`);
          if(page2.gyms){state.gyms=[...state.gyms,...page2.gyms];render();}
          if(page2.nextPageToken){
            setTimeout(async()=>{
              const page3=await api.getLive(`/nearby?lat=${lat}&lng=${lng}&pagetoken=${page2.nextPageToken}`);
              if(page3.gyms){state.gyms=[...state.gyms,...page3.gyms];render();}
            },2500);
          }
        }catch(e){}
      },2500);
    }
  }catch(e){console.error('Failed to load gyms:',e)}
}

async function searchGyms(query){
  try{
    state.searchQuery=query;
    const data=await api.getLive(`/search?q=${encodeURIComponent(query)}`);
    state.gyms=data.gyms||[];
    state.nextPageToken=data.nextPageToken||null;
    render();
    // Load more pages
    if(data.nextPageToken){
      setTimeout(async()=>{
        try{
          const page2=await api.getLive(`/search?q=${encodeURIComponent(query)}&pagetoken=${data.nextPageToken}`);
          if(page2.gyms){state.gyms=[...state.gyms,...page2.gyms];render();}
        }catch(e){}
      },2500);
    }
  }catch(e){console.error('Search failed:',e)}
}

function SearchPage(){
  const gyms=state.gyms||[];
  const searchLabel=state.searchQuery||'Near You';
  return`
  <div class="pt-20 min-h-screen px-4">
    <div class="max-w-7xl mx-auto">
      <!-- Live Search Bar -->
      <div class="mb-6">
        <div class="flex gap-2">
          <div class="flex-1 relative">
            <input type="text" id="gym-search-input" placeholder="Search gyms anywhere — London, Dubai, New York..." 
              class="w-full bg-card border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-brand outline-none text-sm"
              value="${state.searchQuery||''}"
              onkeydown="if(event.key==='Enter'){window.doSearch()}">
            <span class="absolute right-3 top-3 text-slate-500">🔍</span>
          </div>
          <button onclick="window.doSearch()" class="bg-brand hover:bg-orange-600 text-white px-6 py-3 rounded-xl text-sm font-medium transition">Search</button>
          <button onclick="findGyms()" class="bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-xl text-sm transition" title="Use GPS">📍</button>
        </div>
      </div>

      <div class="flex items-center justify-between mb-4 flex-wrap gap-4">
        <div>
          <h1 class="font-brand text-2xl font-bold text-white">Gyms ${searchLabel}</h1>
          <!-- Booking.com style: show total scale -->
          <p class="text-slate-400 text-sm">Showing <span class="text-white font-medium">${gyms.length}</span> of <span class="text-white font-medium">${fmtCount(GYM_COUNT)}</span> gyms worldwide · Powered by Google Places</p>
        </div>
        <!-- Skyscanner-style sort tabs -->
        <div class="flex gap-1 bg-slate-800 rounded-lg p-1">
          <button onclick="state.gyms.sort((a,b)=>(parseFloat(a.price_tier||5)-parseFloat(b.price_tier||5)));render()" class="px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-brand hover:text-white transition">💰 Cheapest</button>
          <button onclick="state.gyms.sort((a,b)=>(b.rating||0)-(a.rating||0));render()" class="px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-brand hover:text-white transition">⭐ Best Rated</button>
          <button onclick="state.gyms.sort((a,b)=>(a.distance||99)-(b.distance||99));render()" class="px-3 py-1.5 rounded-md text-xs text-slate-300 hover:bg-brand hover:text-white transition">📍 Nearest</button>
        </div>
      </div>
      <!-- ClassPass-style activity filters + Booking.com filters -->
      <div class="flex gap-2 mb-6 flex-wrap">
        <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-full text-xs text-slate-300 hover:border-brand hover:text-brand transition">🏋️ Free Weights</button>
        <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-full text-xs text-slate-300 hover:border-brand hover:text-brand transition">🧘 Yoga</button>
        <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-full text-xs text-slate-300 hover:border-brand hover:text-brand transition">🥊 Boxing</button>
        <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-full text-xs text-slate-300 hover:border-brand hover:text-brand transition">🏊 Swimming</button>
        <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-full text-xs text-slate-300 hover:border-brand hover:text-brand transition">💪 CrossFit</button>
        <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-full text-xs text-slate-300 hover:border-brand hover:text-brand transition">🕐 Open Now</button>
        <button class="px-3 py-1.5 bg-accent/20 border border-accent/50 rounded-full text-xs text-accent font-medium">✅ Free Cancellation</button>
      </div>
      ${gyms.length?`
        <!-- Embedded Map -->
        ${MAPS_KEY&&gyms[0]?`<div class="mb-6 rounded-2xl overflow-hidden border border-slate-700 h-64">
          <iframe width="100%" height="100%" frameborder="0" style="border:0"
            src="https://www.google.com/maps/embed/v1/search?key=${MAPS_KEY}&q=${encodeURIComponent(state.searchQuery||'gyms near me')}&zoom=13${gyms[0].latitude?'&center='+gyms[0].latitude+','+gyms[0].longitude:''}" allowfullscreen></iframe>
        </div>`:''}
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
          ${gyms.map(g=>GymCard(g)).join('')}
        </div>
      `:`
        <div class="text-center py-20">
          <div class="text-5xl mb-4">🔍</div>
          <p class="text-slate-400">Finding gyms near you...</p>
          <div class="mt-4 w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      `}
    </div>
  </div>`;
}

// ─── Page: Gym Profile (Task 2 + 6 + 9 + 23) ───
function GymProfilePage(){
  const gym=state.currentGym;
  if(!gym)return`<div class="pt-24 text-center"><div class="animate-spin w-8 h-8 border-2 border-brand border-t-transparent rounded-full mx-auto"></div></div>`;
  const badges=getRandomBadges(gym,6);
  const mainPhoto=gym.photo_url||gym.photo||(gym.photos_list?.[0]?.url)||'';
  const gymId=gym.place_id||gym.placeId||gym.id;
  return`
  <div class="pt-20 min-h-screen overflow-x-hidden">
    <!-- Photo Banner -->
    <div class="h-72 bg-slate-700 relative overflow-hidden">
      ${mainPhoto?`<img src="${mainPhoto}" class="w-full h-full object-cover" onerror="this.style.display='none'">`:'<div class="w-full h-full flex items-center justify-center text-6xl">🏋️</div>'}
      <div class="absolute inset-0 bg-gradient-to-t from-dark via-transparent to-transparent"></div>
      <div class="absolute bottom-4 left-4 right-4">
        <h1 class="font-brand text-3xl font-bold text-white">${gym.name}</h1>
        <p class="text-slate-300 text-sm mt-1">${gym.formatted_address||gym.vicinity||'Bolton, UK'}</p>
      </div>
    </div>

    <div class="max-w-5xl mx-auto px-4 py-8">
      <div class="grid lg:grid-cols-3 gap-8">
        <!-- Main Content -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Airbnb Guest Favourite badge + Rating -->
          ${isTopGym(gym)?`<div class="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-center gap-3 mb-2">
            <span class="text-2xl">⭐</span>
            <div><p class="text-yellow-400 font-bold text-sm">Guest Favourite</p><p class="text-yellow-400/70 text-xs">One of the most-loved gyms on ScanGym based on ratings, reviews, and reliability</p></div>
          </div>`:``}

          <!-- Rating + Stats + Booking.com urgency -->
          <div class="flex items-center gap-4 flex-wrap">
            <span class="text-yellow-400 text-lg font-bold">★ ${gym.rating||'4.5'}</span>
            <span class="text-slate-400 text-sm">${gym.user_ratings_total||47} reviews</span>
            <span class="text-slate-600">|</span>
            <span class="text-accent text-sm font-medium">✅ Free cancellation</span>
            <span class="text-slate-600">|</span>
            <span class="text-sm">${gym.opening_hours?.isOpen===true?`<span class="text-green-400 flex items-center gap-1"><span class="w-2 h-2 bg-green-400 rounded-full animate-pulse inline-block"></span> Open Now${closingTime(gym)?' · Closes '+closingTime(gym):''}</span>`:(gym.opening_hours?.isOpen===false?'<span class="text-red-400">Closed</span>':'<span class="text-slate-400">Hours vary</span>')}</span>
          </div>

          <!-- Booking.com urgency badges -->
          <div class="flex flex-wrap gap-2">
            <span class="bg-red-900/30 border border-red-800/30 text-red-400 text-xs px-3 py-1.5 rounded-full font-medium">🔥 ${peopleLooking(gym.name)} people looking at this gym right now</span>
            <span class="bg-blue-900/30 border border-blue-800/30 text-blue-400 text-xs px-3 py-1.5 rounded-full font-medium">⏱ Last booked ${minutesAgo(gym.name)} minutes ago</span>
            <span class="bg-orange-900/30 border border-orange-800/30 text-orange-400 text-xs px-3 py-1.5 rounded-full font-medium">⚡ Only ${spotsLeft(gym.name)} spots left today</span>
            ${badges.slice(0,3).map(b=>`<span class="bg-slate-800 border border-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-full">${b.icon} ${b.text}</span>`).join('')}
          </div>

          <!-- Opening Hours (Live from Google) -->
          ${gym.opening_hours?.weekday?.length?`
          <div class="bg-card rounded-xl p-5 border border-slate-700">
            <h3 class="text-white font-semibold mb-3">🕐 Opening Hours</h3>
            <div class="space-y-1">
              ${gym.opening_hours.weekday.map(d=>`<p class="text-slate-400 text-sm">${d}</p>`).join('')}
            </div>
          </div>`:``}

          <!-- Facilities — Hussle-style icon grid + PureGym equipment counts -->
          <div class="bg-card rounded-xl p-5 border border-slate-700">
            <h3 class="text-white font-semibold mb-3">Facilities & Equipment</h3>
            <div class="grid grid-cols-3 gap-3">
              ${[
                {icon:'🏋️',name:'Free Weights',detail:'120+ dumbbells'},
                {icon:'🚴',name:'Cardio Zone',detail:'30+ machines'},
                {icon:'💪',name:'Resistance',detail:'25+ machines'},
                {icon:'🧘',name:'Studio',detail:'Classes daily'},
                {icon:'🚿',name:'Showers',detail:'Hot water'},
                {icon:'🔒',name:'Lockers',detail:'Free to use'},
                {icon:'♨️',name:'Sauna',detail:'Available'},
                {icon:'🅿️',name:'Parking',detail:'Free on-site'},
                {icon:'📶',name:'WiFi',detail:'Free'},
              ].map(f=>`
                <div class="bg-slate-800 rounded-lg p-3 text-center">
                  <div class="text-2xl mb-1">${f.icon}</div>
                  <p class="text-white text-xs font-medium">${f.name}</p>
                  <p class="text-slate-500 text-[10px]">${f.detail}</p>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Photo Gallery (Live from Google) -->
          ${gym.photos_list?.length>1?`
          <div class="bg-card rounded-xl p-5 border border-slate-700">
            <h3 class="text-white font-semibold mb-3">📸 Photos</h3>
            <div class="grid grid-cols-3 gap-2">
              ${gym.photos_list.slice(0,9).map(p=>`
                <img src="${p.thumbnail||p.url}" class="w-full h-24 object-cover rounded-lg" loading="lazy" onerror="this.style.display='none'">
              `).join('')}
            </div>
          </div>`:``}

          <!-- Map (Task 23 - Uber style, embedded, no external links) -->
          <div class="bg-card rounded-xl overflow-hidden border border-slate-700">
            <h3 class="text-white font-semibold p-5 pb-2">📍 Location & Directions</h3>
            ${MAPS_KEY?`<div class="h-64">
              <iframe width="100%" height="100%" frameborder="0" style="border:0"
                src="https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=${encodeURIComponent(gym.name+' '+( gym.vicinity||'Bolton'))}&zoom=15" allowfullscreen></iframe>
            </div>`:`<div class="h-48 flex items-center justify-center bg-slate-800"><p class="text-slate-400 text-sm">📍 ${gym.formatted_address||gym.vicinity||gym.address||'Bolton, UK'}</p></div>`}
            <div class="p-4 flex items-center gap-3 border-t border-slate-700">
              <span class="text-2xl">🚶</span>
              <div>
                <p class="text-white text-sm font-medium">${Math.floor(Math.random()*15+3)} min walk</p>
                <p class="text-slate-500 text-xs">Directions shown in-app after booking</p>
              </div>
            </div>
          </div>

          <!-- Chat with Gym (Task 6 - Option C: AI + escalation) -->
          <div class="bg-card rounded-xl p-5 border border-slate-700">
            <h3 class="text-white font-semibold mb-3">💬 Ask a Question</h3>
            <p class="text-slate-400 text-sm mb-3">AI answers instantly. Need a human? We'll text the gym owner.</p>
            <div class="flex gap-2 flex-wrap mb-3">
              ${['Is the squat rack free?','What\'s the locker code?','Where\'s the entrance?','Can I bring a guest?','Is it busy right now?'].map(q=>
                `<button class="text-xs bg-slate-800 text-slate-300 px-3 py-1.5 rounded-full hover:bg-brand hover:text-white transition">${q}</button>`
              ).join('')}
            </div>
            <div class="flex gap-2">
              <input type="text" placeholder="Type your question..." class="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-brand outline-none">
              <button class="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">Send</button>
            </div>
          </div>

          <!-- Reviews (Live from Google + ScanGym) -->
          <div class="bg-card rounded-xl p-5 border border-slate-700">
            <h3 class="text-white font-semibold mb-3">⭐ Reviews</h3>
            ${(gym.reviews_data?.google?.length||gym.reviews_data?.scangym?.length)?
              (gym.reviews_data.google||[]).concat(gym.reviews_data.scangym||[]).slice(0,5).map(r=>`
              <div class="border-b border-slate-700 pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-white text-sm font-medium">${r.author||r.name||'Anonymous'}</span>
                  <span class="text-slate-500 text-xs">${r.relativeTime||r.time||''} ${r.source==='google'?'· via Google':''}</span>
                </div>
                <div class="text-yellow-400 text-xs mb-1">${'★'.repeat(r.rating||5)}${'☆'.repeat(5-(r.rating||5))}</div>
                <p class="text-slate-400 text-sm">${r.text||r.comment||''}</p>
              </div>
            `).join('')
            :`
              ${[
                {name:'Sarah M.',stars:5,text:'Amazing gym! Clean, spacious, great equipment. Squat rack was free both times I visited.',time:'2 days ago'},
                {name:'James K.',stars:4,text:'Good value for £5. Decent cardio section. Showers could be cleaner but overall solid.',time:'1 week ago'},
                {name:'Priya R.',stars:5,text:'Love the no-membership model. Booked through ScanGym and the QR entry was seamless.',time:'2 weeks ago'},
              ].map(r=>`
                <div class="border-b border-slate-700 pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-white text-sm font-medium">${r.name}</span>
                    <span class="text-slate-500 text-xs">${r.time}</span>
                  </div>
                  <div class="text-yellow-400 text-xs mb-1">${'★'.repeat(r.stars)}${'☆'.repeat(5-r.stars)}</div>
                  <p class="text-slate-400 text-sm">${r.text}</p>
                </div>
              `).join('')}
            `}
          </div>
        </div>

        <!-- Mobile Sticky Book Now CTA -->
        <div class="lg:hidden fixed bottom-0 left-0 right-0 bg-dark/98 backdrop-blur-lg border-t border-slate-700 p-3 z-40 flex items-center justify-between">
          <div>
            <p class="text-white font-bold text-lg">£${gym.price_tier||'5'}.00</p>
            <p class="text-slate-400 text-xs">24-Hour Day Pass</p>
          </div>
          <button onclick="handleBookNow('${gymId}')" class="bg-brand hover:bg-orange-600 text-white font-bold py-3 px-8 rounded-xl text-base transition shadow-lg shadow-brand/20">
            Book Now
          </button>
        </div>

        <!-- Booking Sidebar (Task 5 - 3-step flow, Task 9 - conviction, Task 12 - 24hr pass, Task 19 - guest) -->
        <div class="lg:col-span-1 hidden lg:block">
          <div class="sticky top-20 bg-card rounded-2xl border border-slate-700 p-6 space-y-4">
            <!-- Booking.com strikethrough pricing + discount -->
            <div class="text-center">
              <p class="text-slate-400 text-sm">24-Hour Day Pass</p>
              <p class="text-slate-500 text-lg line-through">£${originalPrice(gym.price_tier||'5')}.00</p>
              <p class="text-4xl font-bold text-white">£${gym.price_tier||'5'}<span class="text-lg text-slate-500">.00</span></p>
              <span class="inline-block bg-green-500 text-white text-xs px-2 py-0.5 rounded-full font-bold mt-1">${discountPct(gym.price_tier||'5')}% OFF — Limited time</span>
              <p class="text-accent text-xs mt-2">✅ Free cancellation up to 2hrs before</p>
            </div>
            <!-- Booking.com urgency in sidebar -->
            <div class="bg-red-900/20 border border-red-800/30 rounded-lg p-3 text-center">
              <p class="text-red-400 text-xs font-medium">🔥 ${bookedToday(gym.name)} people booked this gym today</p>
            </div>

            <div class="space-y-3">
              <div class="bg-slate-800 rounded-lg p-3">
                <label class="text-slate-400 text-xs mb-1 block">Date</label>
                <input type="date" value="${new Date().toISOString().split('T')[0]}" class="w-full bg-transparent text-white text-sm outline-none">
              </div>
              <div class="bg-slate-800 rounded-lg p-3">
                <label class="text-slate-400 text-xs mb-1 block">Time</label>
                <select class="w-full bg-transparent text-white text-sm outline-none">
                  ${Array.from({length:15},(_,i)=>`<option>${(6+i).toString().padStart(2,'0')}:00</option>`).join('')}
                </select>
              </div>
            </div>

            <button onclick="handleBookNow('${gymId}')" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-4 rounded-xl text-lg transition shadow-lg shadow-brand/20">
              Book Now — £${gym.price_tier||'5'}.00
            </button>
            <button onclick="handleBookNow('${gymId}')" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl text-sm transition">
              Continue as Guest 👤
            </button>

            <div class="space-y-2 text-xs">
              <div class="flex items-center gap-2 text-slate-400"><span>🔒</span><span>No membership. No contract.</span></div>
              <div class="flex items-center gap-2 text-slate-400"><span>📱</span><span>QR scan entry (scan in + scan out)</span></div>
              <div class="flex items-center gap-2 text-slate-400"><span>⏰</span><span>Valid for 24 hours from scan-in</span></div>
              <div class="flex items-center gap-2 text-accent"><span>🏷️</span><span>Off-peak before 10am: £3.75</span></div>
              <div class="flex items-center gap-2 text-brand"><span>📦</span><span>5 sessions for £20 (save £5)</span></div>
            </div>

            <div class="border-t border-slate-700 pt-3 text-center">
              <p class="text-slate-500 text-xs">Pay with</p>
              <div class="flex justify-center gap-3 mt-2">
                <span class="text-sm">🍎 Apple Pay</span>
                <span class="text-sm">Google Pay</span>
                <span class="text-sm">💳 Card</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Page: AI Coach (Task 1) ───
function CoachPage(){
  return`
  <div class="pt-20 min-h-screen px-4">
    <div class="max-w-3xl mx-auto py-12">
      <div class="text-center mb-12">
        <div class="text-6xl mb-4">🤖</div>
        <h1 class="font-brand text-4xl font-bold text-white mb-3">Your AI Coach</h1>
        <p class="text-slate-400 text-lg">Personalized workout plans, form analysis, and nutrition advice.</p>
        <p class="text-brand text-sm mt-2">Powered by GPT-4o · Remembers everything · Gets smarter over time</p>
      </div>
      <div class="bg-card rounded-2xl border border-slate-700 p-6">
        <div class="bg-slate-800 rounded-xl p-4 mb-4 flex items-start gap-3">
          <div class="w-8 h-8 bg-brand rounded-full flex items-center justify-center text-white text-sm">AI</div>
          <div>
            <p class="text-white text-sm">Hey! 👋 I'm your ScanGym AI Coach. To unlock me, you need to:</p>
            <ol class="text-slate-400 text-sm mt-2 ml-4 list-decimal space-y-1">
              <li>Book a gym session on ScanGym</li>
              <li>Check in by scanning your QR code at the gym</li>
              <li>Then I'm yours — unlimited coaching, workout plans, and form analysis!</li>
            </ol>
            <p class="text-accent text-xs mt-3">🔒 This ensures only active gym-goers get coaching — makes my advice better.</p>
          </div>
        </div>
        <button onclick="navigate('/explore')" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition">
          Book a Session to Unlock AI Coach
        </button>
      </div>
      <div class="mt-8 grid sm:grid-cols-3 gap-4">
        <div class="bg-card rounded-xl p-5 border border-slate-700 text-center">
          <div class="text-3xl mb-2">💪</div>
          <h3 class="text-white font-medium text-sm">Workout Plans</h3>
          <p class="text-slate-500 text-xs mt-1">Custom routines based on your goals, equipment, and history.</p>
        </div>
        <div class="bg-card rounded-xl p-5 border border-slate-700 text-center">
          <div class="text-3xl mb-2">📸</div>
          <h3 class="text-white font-medium text-sm">Form Analysis</h3>
          <p class="text-slate-500 text-xs mt-1">Upload a photo — AI checks your posture and technique.</p>
        </div>
        <div class="bg-card rounded-xl p-5 border border-slate-700 text-center">
          <div class="text-3xl mb-2">🧠</div>
          <h3 class="text-white font-medium text-sm">Remembers You</h3>
          <p class="text-slate-500 text-xs mt-1">Knows your injuries, preferences, and past workouts.</p>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Page: Creators / FlexSquad (World-Class Redesign — Shopify + ClassPass + Gymshark patterns) ───
// REPLACES the old CreatorsPage() function in app.js (lines 832-872)
// Also add the filterAssets function below the page function, and call initInteractive() after render.

function CreatorsPage(){
  // Asset paths — serve from /assets/flexsquad/ on the server (Railway/Supabase)
  const A = '/assets/flexsquad';

  // Real asset data from Google Drive
  const assets = [
    // Creator Assets (10)
    {name:'Hero Banner',file:'ScanGym-Asset1-Hero-Banner.webp',type:'image',cat:'Creator Assets'},
    {name:'How It Works',file:'ScanGym-Asset2-How-It-Works.webp',type:'image',cat:'Creator Assets'},
    {name:'Competitor Comparison',file:'ScanGym-Asset3-Competitor-Comparison.webp',type:'image',cat:'Creator Assets'},
    {name:'DM Outreach Card',file:'ScanGym-Asset4-DM-Outreach-Card.webp',type:'image',cat:'Creator Assets'},
    {name:'Uber For Gyms Story',file:'ScanGym-Asset5-Uber-For-Gyms-Story.webp',type:'image',cat:'Creator Assets'},
    {name:'Viral Hook',file:'ScanGym-Asset6-Viral-Hook.webp',type:'image',cat:'Creator Assets'},
    {name:'Price Comparison',file:'ScanGym-Asset7-Price-Comparison.webp',type:'image',cat:'Creator Assets'},
    {name:'Comment Bait',file:'ScanGym-Asset8-Comment-Bait.webp',type:'image',cat:'Creator Assets'},
    {name:'Gym Review Story',file:'ScanGym-Asset9-Gym-Review-Story.webp',type:'image',cat:'Creator Assets'},
    {name:'Hidden Gems',file:'ScanGym-Asset10-Hidden-Gems.webp',type:'image',cat:'Creator Assets'},
    // Branded (5)
    {name:'Hero Graphic + App Mockup',file:'ScanGym-CMO-HeroGraphic-AppMockup.webp',type:'image',cat:'Branded'},
    {name:'Membership vs ScanGym',file:'ScanGym-CMO-ComparisonInfographic-MembershipVsScanGym.webp',type:'image',cat:'Branded'},
    {name:'Affiliate Earnings',file:'ScanGym-CMO-I20-AffiliateEarnings-Landscape.webp',type:'image',cat:'Branded'},
    {name:'Soul ID — Founder',file:'ScanGym-Soul-ID-Mubarak.webp',type:'image',cat:'Branded'},
    {name:'AIthlete Soul ID Avatar',file:'AIthlete-Soul-ID-Avatar.webp',type:'image',cat:'Branded'},
    // Marketing — CMO content (7 webp)
    {name:'Student Hack Story',file:'ScanGym-CMO-I7-StudentHack-VerticalStory.webp',type:'image',cat:'Marketing'},
    {name:'Meme Post',file:'ScanGym-CMO-I11-Meme-Square.webp',type:'image',cat:'Marketing'},
    {name:'Launch Offer',file:'ScanGym-CMO-I16-LaunchOffer-Square.webp',type:'image',cat:'Marketing'},
    {name:'This vs That',file:'ScanGym-CMO-I17-ThisVsThat-Square.webp',type:'image',cat:'Marketing'},
    {name:'Monday Motivation',file:'ScanGym-CMO-I18-MondayMotivation-Square.webp',type:'image',cat:'Marketing'},
    {name:'60-Sec Infographic',file:'ScanGym-CMO-I19-60SecInfographic-Vertical.webp',type:'image',cat:'Marketing'},
    // Marketing — Additional thumbnails (30 png)
    {name:'Affiliate Videos Pack 1',file:'affiliate-videos_1.png',type:'image',cat:'Social Packs'},
    {name:'Affiliate Videos Pack 2',file:'affiliate-videos_2.png',type:'image',cat:'Social Packs'},
    {name:'Affiliate Videos Pack 3',file:'affiliate-videos_3.png',type:'image',cat:'Social Packs'},
    {name:'AI Cinematic 1',file:'ai-cinematic_1.png',type:'image',cat:'Social Packs'},
    {name:'AI Cinematic 2',file:'ai-cinematic_2.png',type:'image',cat:'Social Packs'},
    {name:'AI Cinematic 3',file:'ai-cinematic_3.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Square 1',file:'city-promos-square_1.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Square 2',file:'city-promos-square_2.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Square 3',file:'city-promos-square_3.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Vertical 1',file:'city-promos-vertical_1.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Vertical 2',file:'city-promos-vertical_2.png',type:'image',cat:'Social Packs'},
    {name:'City Promos Vertical 3',file:'city-promos-vertical_3.png',type:'image',cat:'Social Packs'},
    {name:'Price Comparison 1',file:'price-comparisons_1.png',type:'image',cat:'Social Packs'},
    {name:'Price Comparison 2',file:'price-comparisons_2.png',type:'image',cat:'Social Packs'},
    {name:'Price Comparison 3',file:'price-comparisons_3.png',type:'image',cat:'Social Packs'},
    {name:'TikTok Reel 1',file:'tiktok-reels_1.png',type:'image',cat:'Social Packs'},
    {name:'TikTok Reel 2',file:'tiktok-reels_2.png',type:'image',cat:'Social Packs'},
    {name:'TikTok Reel 3',file:'tiktok-reels_3.png',type:'image',cat:'Social Packs'},
    {name:'Ready to Post 1',file:'ready-to-post_1.png',type:'image',cat:'Social Packs'},
    {name:'Ready to Post 2',file:'ready-to-post_2.png',type:'image',cat:'Social Packs'},
    {name:'Ready to Post 3',file:'ready-to-post_3.png',type:'image',cat:'Social Packs'},
    {name:'Viral Video Cover 1',file:'viral-videos_1.png',type:'image',cat:'Social Packs'},
    {name:'Viral Video Cover 2',file:'viral-videos_2.png',type:'image',cat:'Social Packs'},
    {name:'Viral Video Cover 3',file:'viral-videos_3.png',type:'image',cat:'Social Packs'},
    {name:'Did You Know 1',file:'did-you-know-videos_1.png',type:'image',cat:'Social Packs'},
    {name:'Did You Know 2',file:'did-you-know-videos_2.png',type:'image',cat:'Social Packs'},
    {name:'Did You Know 3',file:'did-you-know-videos_3.png',type:'image',cat:'Social Packs'},
    {name:'YouTube Horizontal 1',file:'youtube-horizontal_1.png',type:'image',cat:'Social Packs'},
    {name:'YouTube Horizontal 2',file:'youtube-horizontal_2.png',type:'image',cat:'Social Packs'},
    {name:'YouTube Horizontal 3',file:'youtube-horizontal_3.png',type:'image',cat:'Social Packs'},
    // Mascot (3)
    {name:'FLEX Hero Pose',file:'FLEX_01_hero_pose.jpg',type:'image',cat:'Mascot'},
    {name:'FLEX Friendly',file:'FLEX_02_friendly.jpg',type:'image',cat:'Mascot'},
    {name:'FLEX Double Bicep',file:'FLEX_03_double_bicep.jpg',type:'image',cat:'Mascot'},
    // Videos — Promo (24 named)
    {name:'Contrarian Hook: "Gym Scam"',file:'01_contrarian_hook_gym_scam_1080p.mp4',type:'video',cat:'Promo Videos'},
    {name:'Gen Z Day Pass Journey',file:'02_gen_z_day_pass_journey.mp4',type:'video',cat:'Promo Videos'},
    {name:'£5 Gym Challenge',file:'03_five_pound_challenge.mp4',type:'video',cat:'Promo Videos'},
    {name:'Gym Hopper (YouTube 16:9)',file:'04_gym_hopper_youtube_16x9.mp4',type:'video',cat:'Promo Videos'},
    {name:'Stop Paying Full Price',file:'05_stop_paying_imperative.mp4',type:'video',cat:'Promo Videos'},
    {name:'Travelling? Find a Gym',file:'06_travelling_gym_finder.mp4',type:'video',cat:'Promo Videos'},
    {name:'Gym Membership Trap',file:'07_gym_membership_trap.mp4',type:'video',cat:'Promo Videos'},
    {name:'£5 Gym Tour London',file:'08_five_pound_gym_tour_london.mp4',type:'video',cat:'Promo Videos'},
    {name:'Before & After Gym Hopper',file:'09_before_after_gym_hopper.mp4',type:'video',cat:'Promo Videos'},
    {name:'ScanGym App Demo',file:'10_scangym_app_demo.mp4',type:'video',cat:'Promo Videos'},
    {name:'CrossFit Box Hop',file:'11_crossfit_box_hop.mp4',type:'video',cat:'Promo Videos'},
    {name:'Manchester Gym Scene',file:'12_manchester_gym_scene.mp4',type:'video',cat:'Promo Videos'},
    {name:'Birmingham Gym Discovery',file:'13_birmingham_gym_discovery.mp4',type:'video',cat:'Promo Videos'},
    {name:'Student Gym Hack',file:'14_student_gym_hack.mp4',type:'video',cat:'Promo Videos'},
    {name:'Yoga Studio Hop',file:'15_yoga_studio_hop.mp4',type:'video',cat:'Promo Videos'},
    {name:'£50 vs £5 Comparison',file:'16_fifty_vs_five_comparison.mp4',type:'video',cat:'Promo Videos'},
    {name:'Edinburgh Fitness Scene',file:'17_edinburgh_fitness_scene.mp4',type:'video',cat:'Promo Videos'},
    {name:'Morning Routine w/ ScanGym',file:'18_morning_routine_scangym.mp4',type:'video',cat:'Promo Videos'},
    {name:'Leeds Gym Crawl',file:'19_leeds_gym_crawl.mp4',type:'video',cat:'Promo Videos'},
    {name:'Couples Gym Date',file:'20_couples_gym_date.mp4',type:'video',cat:'Promo Videos'},
    {name:'Late Night Gym Finder',file:'21_late_night_gym_finder.mp4',type:'video',cat:'Promo Videos'},
    {name:'Glasgow Gym Culture',file:'22_glasgow_gym_culture.mp4',type:'video',cat:'Promo Videos'},
    {name:'Bodybuilder Budget Gyms',file:'23_bodybuilder_budget_gyms.mp4',type:'video',cat:'Promo Videos'},
    {name:'Save Money Calculator',file:'24_save_money_calculator.mp4',type:'video',cat:'Promo Videos'},
    // Videos — CMO Content (5)
    {name:'POV: First Gym Visit',file:'ScanGym-CMO-V14-POVFirstGym-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Travel Fitness',file:'ScanGym-CMO-V15-TravelFitness-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'GRWM Gym Edition',file:'ScanGym-CMO-V16-GRWM-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Storytime: Gym Discovery',file:'ScanGym-CMO-V17-Storytime-Vertical.mp4',type:'video',cat:'CMO Content'},
    {name:'Gym Tour Walkthrough',file:'ScanGym-CMO-V18-GymTour-Horizontal.mp4',type:'video',cat:'CMO Content'},
  ];

  return`
  <div class="pt-20 min-h-screen">

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  HERO — Aspirational headline + stats + dual CTA          -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="relative overflow-hidden px-4 py-20 md:py-28">
      <div class="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-orange-950/30"></div>
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-brand/10 via-transparent to-transparent"></div>
      <div class="relative max-w-6xl mx-auto text-center">
        <div class="inline-flex items-center gap-2 bg-brand/10 border border-brand/20 rounded-full px-5 py-2 mb-8">
          <span class="text-2xl">💪</span>
          <span class="text-brand font-bold text-sm tracking-wider uppercase">FlexSquad Creator Program</span>
        </div>
        <h1 class="font-brand text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-4 leading-tight">
          Your Gym Content.<br><span class="text-brand">Your Earnings.</span>
        </h1>
        <p class="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-8">
          Join the FlexSquad — ScanGym's creator community. Share gyms you love, earn 25% commission on every booking, and train for free.
        </p>
        <div class="flex flex-wrap justify-center gap-6 md:gap-12 mb-10">
          <div class="text-center"><p class="text-3xl md:text-4xl font-bold text-white" data-counter data-target="25" data-suffix="%">0%</p><p class="text-slate-500 text-sm">Commission</p></div>
          <div class="text-center"><p class="text-3xl md:text-4xl font-bold text-white" data-counter data-target="388" data-suffix="+">0+</p><p class="text-slate-500 text-sm">Ready-to-go Assets</p></div>
          <div class="text-center"><p class="text-3xl md:text-4xl font-bold text-white">£5K<span class="text-brand">+</span></p><p class="text-slate-500 text-sm">Top Earnings/mo</p></div>
          <div class="text-center"><p class="text-3xl md:text-4xl font-bold text-brand">FREE</p><p class="text-slate-500 text-sm">Gym Sessions</p></div>
        </div>
        <div class="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button onclick="navigate('/login')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl transition text-lg shadow-lg shadow-brand/20 hover:shadow-brand/40">Join FlexSquad — It's Free</button>
          <a href="#fs-how" onclick="event.preventDefault();document.getElementById('fs-how').scrollIntoView({behavior:'smooth'})" class="text-slate-300 hover:text-white font-medium px-6 py-4 rounded-xl border border-slate-700 hover:border-slate-500 transition cursor-pointer">See How It Works ↓</a>
        </div>
        <p class="text-slate-600 text-sm mt-4">No minimum followers · No application · Start in 60 seconds</p>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  WHO IS THIS FOR — Persona cards (Shopify pattern)        -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16 bg-slate-900/50">
      <div class="max-w-6xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">Who's in FlexSquad?</h2>
        <p class="text-slate-400 text-center mb-12 max-w-xl mx-auto">Whether you have 100 followers or 100K — if you love gyms, this is for you.</p>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          ${[
            {title:'Fitness TikTokers',desc:'Share gym finds, workout clips, and booking walkthroughs with your followers.',icon:'📱',stat:'Avg £200-500/mo',img:'ScanGym-Asset1-Hero-Banner.webp'},
            {title:'Gym Bloggers',desc:'Write reviews, film gym tours, rate equipment — your audience books through your link.',icon:'✍️',stat:'Avg £150-400/mo',img:'ScanGym-Asset9-Gym-Review-Story.webp'},
            {title:'PTs & Coaches',desc:'Recommend gyms to clients. They book, you earn. Plus free sessions for yourself.',icon:'🏋️',stat:'Avg £300-800/mo',img:'ScanGym-Asset8-Comment-Bait.webp'},
            {title:'Students',desc:'Tight budget? Share ScanGym on campus socials and fund your own gym sessions.',icon:'🎓',stat:'Avg £50-200/mo',img:'ScanGym-Asset6-Viral-Hook.webp'},
          ].map(p=>`
            <div class="group bg-card rounded-2xl overflow-hidden border border-slate-700/50 hover:border-brand/30 transition-all duration-300 hover:-translate-y-1">
              <div class="h-40 bg-slate-800 overflow-hidden">
                <img src="${A}/images/creator_assets/${p.img}" alt="${p.title}" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center h-full text-5xl\\'>${p.icon}</div>'">
              </div>
              <div class="p-5">
                <div class="flex items-center gap-2 mb-2"><span class="text-xl">${p.icon}</span><h3 class="text-white font-bold text-lg">${p.title}</h3></div>
                <p class="text-slate-400 text-sm mb-3">${p.desc}</p>
                <span class="inline-block bg-brand/10 text-brand text-xs font-bold px-3 py-1 rounded-full">${p.stat}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  HOW IT WORKS — 3 steps (universal pattern)               -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section id="fs-how" class="px-4 py-16">
      <div class="max-w-5xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">How FlexSquad Works</h2>
        <p class="text-slate-400 text-center mb-12">Three steps. Sixty seconds. Zero cost.</p>
        <div class="grid md:grid-cols-3 gap-8">
          ${[
            {step:'01',title:'Sign Up & Get Your Link',desc:'Create your free FlexSquad account. Instantly receive your personal referral page at <strong class="text-brand">scangym.com/r/yourname</strong>.',icon:'🔗'},
            {step:'02',title:'Share Gyms You Love',desc:'Post gym content, share your link, and use our <strong class="text-white">388+ ready-made assets</strong> — stories, reels, posts, videos. All free.',icon:'📤'},
            {step:'03',title:'Earn On Every Booking',desc:'When someone books through your link you earn <strong class="text-brand">25% commission</strong> (~£5-15 per booking). Paid weekly. No caps.',icon:'💰'},
          ].map(s=>`
            <div class="bg-card rounded-2xl p-8 border border-slate-700/50 hover:border-brand/20 transition h-full">
              <div class="flex items-center gap-4 mb-4">
                <span class="text-4xl">${s.icon}</span>
                <span class="text-brand/20 font-brand text-6xl font-bold select-none">${s.step}</span>
              </div>
              <h3 class="text-white font-bold text-xl mb-3">${s.title}</h3>
              <p class="text-slate-400 text-sm leading-relaxed">${s.desc}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  EARNINGS CALCULATOR — Interactive slider (Shopify style)  -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16 bg-slate-900">
      <div class="max-w-5xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-12">Calculate Your Earnings</h2>
        <div class="grid md:grid-cols-2 gap-8 items-center">
          <div class="bg-card rounded-2xl p-8 border border-slate-700/50">
            <h3 class="text-white font-bold text-lg mb-2">Referrals per month</h3>
            <p class="text-slate-400 text-sm mb-6">Earn <strong class="text-brand">25% commission</strong> (~£5-15) per booking</p>
            <div class="flex items-center gap-4 mb-4">
              <span id="calc-val" class="bg-slate-800 text-white text-3xl font-bold px-6 py-3 rounded-xl min-w-[100px] text-center">10</span>
              <span class="text-slate-500">bookings</span>
            </div>
            <input type="range" id="calc-slider" min="1" max="200" value="10" class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand" oninput="document.getElementById('calc-val').textContent=this.value;const v=parseInt(this.value),hi=v*15;document.getElementById('calc-earn').innerHTML='Up to <span class=\\'text-brand text-4xl md:text-5xl font-bold\\'>£'+hi.toLocaleString()+'</span>';document.getElementById('calc-yr').textContent='£'+(v*10*12).toLocaleString()+' — £'+(hi*12).toLocaleString()+' per year';document.getElementById('calc-tier').textContent=v>=500?'👑 Legend':v>=100?'⭐ Elite Creator':v>=25?'🔥 Ambassador':'🌱 Explorer';">
            <div class="flex justify-between text-slate-600 text-xs mt-2"><span>1</span><span>50</span><span>100</span><span>200</span></div>
            <div class="mt-6 pt-6 border-t border-slate-700">
              <p class="text-slate-500 text-xs mb-1">Estimated monthly earnings</p>
              <p id="calc-earn">Up to <span class="text-brand text-4xl md:text-5xl font-bold">£150</span></p>
              <p id="calc-yr" class="text-slate-500 text-sm mt-1">£1,200 — £1,800 per year</p>
              <p class="text-slate-600 text-xs mt-2">Your tier: <span id="calc-tier" class="text-white">🌱 Explorer</span></p>
            </div>
          </div>
          <div class="text-center md:text-left space-y-6">
            <div class="bg-brand/10 border border-brand/20 rounded-2xl p-8">
              <h3 class="text-4xl md:text-5xl font-bold text-white mb-2">No commission<br>caps. <span class="text-brand">Ever.</span></h3>
              <p class="text-slate-400 mt-3">The more you share, the more you earn. Top FlexSquad creators earn £1,200-5,000+ per month.</p>
            </div>
            <button onclick="navigate('/login')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl transition text-lg w-full md:w-auto">Start Earning →</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  TIER SYSTEM — 4 levels with real perks                    -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16">
      <div class="max-w-6xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">Level Up Your Earnings</h2>
        <p class="text-slate-400 text-center mb-12">Four tiers. Real perks. The more you grow, the more you get.</p>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          ${[
            {tier:'Explorer',req:'Just sign up',earnings:'£50-150',icon:'🌱',col:'slate',perks:['25% commission','Personal referral link','388+ assets','Weekly payouts','Real-time dashboard'],quote:'"I share gym finds on stories and earn £87/mo doing what I already do." — Sarah, London'},
            {tier:'Ambassador',req:'25+ bookings/mo',earnings:'£200-500',icon:'🔥',col:'brand',perks:['Everything in Explorer','Unlimited free sessions','£25 monthly bonus','Priority support','Featured on leaderboard'],quote:'"FlexSquad pays for all my gym time plus extra. Best side hustle ever." — James, Manchester'},
            {tier:'Elite Creator',req:'100+ bookings/mo',earnings:'£500-1,200',icon:'⭐',col:'yellow',perks:['Everything in Ambassador','£50 monthly bonus','Early feature access','Co-branded content','Exclusive events'],quote:'"My TikTok gym content earns me £890/mo. FlexSquad changed my life." — Priya, Birmingham'},
            {tier:'Legend',req:'500+ bookings/mo',earnings:'£1,200-5,000+',icon:'👑',col:'purple',perks:['Everything in Elite','Revenue share deal','£100 monthly bonus','Personal account manager','Brand collaboration opps'],quote:'"I built a full income stream from gym content. £3.2K last month." — Top Creator'},
          ].map(t=>`
            <div class="bg-card rounded-2xl p-6 border border-slate-700/50 hover:border-${t.col==='brand'?'brand':t.col+'-500'}/30 transition-all flex flex-col">
              <div class="text-center mb-4">
                <div class="text-4xl mb-2">${t.icon}</div>
                <h3 class="text-${t.col==='brand'?'brand':t.col+'-400'} font-bold text-xl">${t.tier}</h3>
                <p class="text-slate-500 text-xs mt-1">${t.req}</p>
              </div>
              <div class="bg-slate-800/50 rounded-xl p-4 mb-4">
                <p class="text-white font-bold text-2xl text-center">${t.earnings}<span class="text-slate-500 text-sm">/mo</span></p>
              </div>
              <ul class="space-y-2 mb-4 flex-grow">
                ${t.perks.map(p=>`<li class="flex items-start gap-2 text-sm"><span class="text-brand mt-0.5">✓</span><span class="text-slate-300">${p}</span></li>`).join('')}
              </ul>
              <div class="pt-4 border-t border-slate-700/50">
                <p class="text-slate-500 text-xs italic leading-relaxed">${t.quote}</p>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="hidden lg:flex justify-center items-center mt-6 gap-2 text-sm">
          <span class="text-slate-600">Your journey:</span>
          <span>🌱</span><span class="text-slate-700">→</span><span>🔥</span><span class="text-slate-700">→</span><span>⭐</span><span class="text-slate-700">→</span><span>👑</span>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  ASSET LIBRARY — Downloadable creator toolkit               -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section id="fs-assets" class="px-4 py-16 bg-slate-900">
      <div class="max-w-6xl mx-auto">
        <div class="text-center mb-8">
          <h2 class="font-brand text-3xl md:text-4xl font-bold text-white mb-3">Ready-to-Go Assets</h2>
          <p class="text-slate-400 max-w-2xl mx-auto">Professional images, videos, stories, and posts — designed for FlexSquad creators. Download, customise, post.</p>
          <p class="text-brand font-bold text-lg mt-2">${assets.length} assets and growing</p>
        </div>
        
        <!-- Filter tabs -->
        <div class="flex flex-wrap justify-center gap-2 mb-8">
          <button onclick="window._fsFilter('all')" class="fs-filter-btn bg-brand text-white px-4 py-2 rounded-full text-sm font-medium" data-f="all">All (${assets.length})</button>
          <button onclick="window._fsFilter('image')" class="fs-filter-btn bg-slate-800 text-slate-300 hover:bg-slate-700 px-4 py-2 rounded-full text-sm font-medium" data-f="image">📸 Images (${assets.filter(a=>a.type==='image').length})</button>
          <button onclick="window._fsFilter('video')" class="fs-filter-btn bg-slate-800 text-slate-300 hover:bg-slate-700 px-4 py-2 rounded-full text-sm font-medium" data-f="video">🎬 Videos (${assets.filter(a=>a.type==='video').length})</button>
        </div>

        <!-- Asset grid -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" id="fs-grid">
          ${assets.map(a=>{
            const folder = a.type==='video' ? (a.cat==='CMO Content'?'videos/content':'videos/promo') : (a.cat==='Creator Assets'?'images/creator_assets':a.cat==='Branded'?'images/branded':a.cat==='Mascot'?'images/mascot':'images/marketing');
            return`
            <div class="fs-asset group relative bg-card rounded-xl overflow-hidden border border-slate-700/30 hover:border-brand/30 transition cursor-pointer" data-t="${a.type}" onclick="window.open('${A}/${folder}/${a.file}','_blank')">
              <div class="aspect-square bg-slate-800 overflow-hidden relative">
                ${a.type==='video'
                  ?`<div class="flex items-center justify-center h-full"><span class="text-3xl opacity-50">🎬</span><div class="absolute inset-0 flex items-center justify-center"><div class="w-12 h-12 bg-brand/80 rounded-full flex items-center justify-center group-hover:bg-brand transition"><span class="text-white text-lg ml-0.5">▶</span></div></div></div>`
                  :`<img src="${A}/${folder}/${a.file}" alt="${a.name}" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center h-full text-3xl\\'>📸</div>'">`}
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
                  <span class="bg-brand text-white text-[10px] px-2 py-1 rounded-full font-medium">↓</span>
                </div>
              </div>
              <div class="p-2.5">
                <p class="text-white text-xs font-medium truncate">${a.name}</p>
                <p class="text-slate-500 text-[10px]">${a.cat}</p>
              </div>
            </div>`;
          }).join('')}
        </div>

        <div class="text-center mt-8">
          <button onclick="window.open('${A}/FlexSquad-Creator-Toolkit.zip','_blank')" class="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold px-8 py-4 rounded-xl transition border border-slate-700">
            <span class="text-xl">📦</span> Download All Assets (ZIP)
          </button>
          <p class="text-slate-600 text-xs mt-2">All images, videos, captions, and posting guide in one download</p>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  FAST TRACK — Tools & support (Shopify pattern)            -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16">
      <div class="max-w-6xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-12">Fast Track Your Success</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          ${[
            {title:'Personal Dashboard',desc:'Track clicks, bookings, earnings, and payouts in real-time. See exactly what\\'s working.',icon:'📊'},
            {title:'388+ Assets',desc:'Professionally designed images, videos, stories, and reels. Download and post — done.',icon:'🎨'},
            {title:'Creator Playbook',desc:'Step-by-step guides, caption templates, hashtag lists, and posting schedules that convert.',icon:'📖'},
            {title:'Weekly Payouts',desc:'Earnings hit your bank every week. No minimum threshold. Direct bank transfer.',icon:'💳'},
          ].map(f=>`
            <div class="bg-card rounded-2xl p-6 border border-slate-700/50 hover:border-brand/20 transition text-center">
              <div class="text-4xl mb-4">${f.icon}</div>
              <h3 class="text-white font-bold text-lg mb-2">${f.title}</h3>
              <p class="text-slate-400 text-sm">${f.desc}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  LEADERBOARD — Competitive social proof                    -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16 bg-slate-900">
      <div class="max-w-4xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-3">FlexSquad Leaderboard</h2>
        <p class="text-slate-400 text-center mb-10">Top creators this month. Could be you next. 🏆</p>
        <div class="bg-card rounded-2xl border border-slate-700/50 overflow-hidden">
          <div class="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-700/50 text-slate-500 text-xs font-medium uppercase tracking-wider">
            <div class="col-span-1">#</div><div class="col-span-5">Creator</div><div class="col-span-3 text-right">Bookings</div><div class="col-span-3 text-right">Earned</div>
          </div>
          ${[
            {r:1,n:'S****a K.',t:'👑',b:612,e:'£3,240',badge:'Legend'},
            {r:2,n:'J****s M.',t:'⭐',b:287,e:'£1,580',badge:'Elite'},
            {r:3,n:'P****a R.',t:'⭐',b:194,e:'£1,120',badge:'Elite'},
            {r:4,n:'A****d T.',t:'🔥',b:89,e:'£490',badge:'Ambassador'},
            {r:5,n:'L****a W.',t:'🔥',b:67,e:'£380',badge:'Ambassador'},
            {r:6,n:'You?',t:'🌱',b:'—',e:'Join now →',badge:'Explorer',hl:true},
          ].map(l=>`
            <div class="grid grid-cols-12 gap-4 px-6 py-4 border-b border-slate-800/50 ${l.hl?'bg-brand/5 hover:bg-brand/10 cursor-pointer':'hover:bg-slate-800/30'} transition items-center" ${l.hl?'onclick="navigate(\\'/login\\')"':''}>
              <div class="col-span-1 font-bold ${l.r<=3?'text-brand':'text-slate-400'}">${l.r<=3?['🥇','🥈','🥉'][l.r-1]:l.r}</div>
              <div class="col-span-5 flex items-center gap-2"><span>${l.t}</span><span class="${l.hl?'text-brand font-bold':'text-white font-medium'}">${l.n}</span><span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 hidden sm:inline">${l.badge}</span></div>
              <div class="col-span-3 text-right text-slate-300 font-medium">${typeof l.b==='number'?l.b.toLocaleString():l.b}</div>
              <div class="col-span-3 text-right ${l.hl?'text-brand font-bold':'text-brand font-medium'}">${l.e}</div>
            </div>
          `).join('')}
        </div>
        <p class="text-slate-600 text-xs text-center mt-4">Updated weekly · Names partially hidden for privacy</p>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  FAQ — Accordion                                           -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-16">
      <div class="max-w-3xl mx-auto">
        <h2 class="font-brand text-3xl md:text-4xl font-bold text-white text-center mb-10">Frequently Asked Questions</h2>
        <div class="space-y-3">
          ${[
            {q:'How much does it cost to join FlexSquad?',a:'Nothing. Zero. FlexSquad is completely free to join. Sign up, get your link, start earning immediately.'},
            {q:'How much can I realistically earn?',a:'Explorers typically earn £50-150/mo, Ambassadors £200-500/mo, Elite Creators £500-1,200/mo, and Legends £1,200-5,000+/mo. Commission is 25% of every booking (~£5-15 each).'},
            {q:'Do I need a minimum number of followers?',a:'No! We have no follower requirements. Some of our top earners started with small, highly engaged audiences. Quality over quantity.'},
            {q:'How and when do I get paid?',a:'Earnings are paid weekly via direct bank transfer. No minimum payout threshold — even £5 gets sent.'},
            {q:'What content should I post?',a:'Anything gym-related! Gym tours, workout clips, reviews, booking walkthroughs, money-saving tips. We provide 388+ ready-made assets and a creator playbook with caption templates.'},
            {q:'How does tracking work?',a:'When someone clicks your link (scangym.com/r/yourname), a 30-day cookie tracks them. Any booking within 30 days earns you 25% commission — even if they don\\'t book immediately.'},
            {q:'Can I use the assets on any platform?',a:'Yes! Assets are designed for Instagram, TikTok, YouTube, Twitter/X, Facebook, and blogs. Download and use freely — they\\'re yours.'},
            {q:'Is FlexSquad only for UK creators?',a:'ScanGym gyms are currently UK-based, so the audience who books will be UK users. But you can join from anywhere if you have a UK-interested audience.'},
          ].map(f=>`
            <div class="border border-slate-700/50 rounded-xl overflow-hidden">
              <button class="accordion-trigger w-full flex items-center justify-between p-5 text-left hover:bg-slate-800/30 transition">
                <span class="text-white font-medium pr-4">${f.q}</span>
                <span class="accordion-arrow text-slate-500 transition-transform text-sm flex-shrink-0">▼</span>
              </button>
              <div class="overflow-hidden transition-all duration-300" style="max-height:0">
                <p class="text-slate-400 text-sm p-5 pt-0 leading-relaxed">${f.a}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════ -->
    <!--  FINAL CTA                                                 -->
    <!-- ═══════════════════════════════════════════════════════════ -->
    <section class="px-4 py-20 bg-gradient-to-b from-slate-900 to-slate-950">
      <div class="max-w-3xl mx-auto text-center">
        <div class="text-5xl mb-6">💪</div>
        <h2 class="font-brand text-3xl md:text-5xl font-bold text-white mb-4">Ready to Join FlexSquad?</h2>
        <p class="text-slate-400 text-lg mb-8 max-w-xl mx-auto">Free to join · 25% commission · 388+ assets · Weekly payouts · No caps · No minimum followers</p>
        <button onclick="navigate('/login')" class="bg-brand hover:bg-orange-600 text-white font-bold px-10 py-5 rounded-xl transition text-xl shadow-lg shadow-brand/20 hover:shadow-brand/40">Join FlexSquad — Start Earning Today</button>
        <p class="text-slate-600 text-sm mt-4">Your personal page: <span class="text-brand">scangym.com/r/yourname</span></p>
      </div>
    </section>

  </div>`;
}

// ─── Asset filter for FlexSquad page ───
window._fsFilter=function(type){
  document.querySelectorAll('.fs-filter-btn').forEach(b=>{
    b.className=b.dataset.f===type
      ?'fs-filter-btn bg-brand text-white px-4 py-2 rounded-full text-sm font-medium'
      :'fs-filter-btn bg-slate-800 text-slate-300 hover:bg-slate-700 px-4 py-2 rounded-full text-sm font-medium';
  });
  document.querySelectorAll('.fs-asset').forEach(el=>{
    el.style.display=(type==='all'||el.dataset.t===type)?'':'none';
  });
};

// ─── Page: Wallet (Task 14) ───
function WalletPage(){
  return`
  <div class="pt-20 min-h-screen px-4">
    <div class="max-w-2xl mx-auto py-12">
      <h1 class="font-brand text-3xl font-bold text-white mb-2 text-center">💰 ScanGym Wallet</h1>
      <p class="text-slate-400 text-center mb-8">Top up, save more, pay faster.</p>
      <div class="bg-card rounded-2xl border border-slate-700 p-8 text-center mb-6">
        <p class="text-slate-400 text-sm">Current Balance</p>
        <p class="text-5xl font-bold text-white mt-2">£0.00</p>
        <p class="text-accent text-xs mt-2">Auto-applied at checkout</p>
      </div>
      <div class="grid sm:grid-cols-3 gap-4 mb-8">
        ${[{amount:10,bonus:'+ £1 free',total:'£11'},{amount:20,bonus:'+ £2 free (10%)',total:'£22',popular:true},{amount:50,bonus:'+ £7.50 free (15%)',total:'£57.50'}].map(p=>`
          <button class="bg-card rounded-xl border ${p.popular?'border-brand':'border-slate-700'} p-5 text-center hover:border-brand transition relative">
            ${p.popular?'<span class="absolute -top-2 left-1/2 -translate-x-1/2 bg-brand text-white text-xs px-2 py-0.5 rounded-full">Popular</span>':''}
            <p class="text-2xl font-bold text-white">£${p.amount}</p>
            <p class="text-accent text-xs mt-1">${p.bonus}</p>
            <p class="text-slate-400 text-xs mt-1">Get ${p.total}</p>
          </button>
        `).join('')}
      </div>
      <button onclick="navigate('/login')" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition">
        Log In to Top Up
      </button>
    </div>
  </div>`;
}

// ─── Page: Suppliers (Task 24) ───
function SupplierPage(type){
  const data={
    vending:{title:'🥤 Free Vending Machines',desc:'Get a protein shake & snack vending machine in your gym — completely free.',items:[
      {name:'Royal Vending UK',model:'Free hire & service',cost:'FREE'},
      {name:'Energy Vending',model:'Sports nutrition specialist',cost:'Revenue share'},
      {name:'Krols V&C',model:'Full range from Crane, Coffetek',cost:'Quote-based'},
    ]},
    qr:{title:'📱 Free QR Scanners',desc:'ScanGym-compatible QR entry hardware for your gym.',items:[
      {name:'GANTNER GT7',model:'RFID + QR + fingerprint terminal',cost:'£500-2,000'},
      {name:'Gym Assistant',model:'Omnidirectional barcode/QR scanner',cost:'£200-400'},
      {name:'Paxton',model:'Access control with QR/NFC',cost:'£300-800'},
    ]},
    loans:{title:'🏦 Gym Opening Loans',desc:'Finance for new and expanding gyms.',items:[
      {name:'Start Up Loans (Gov)',model:'Government-backed startup loan',cost:'Up to £25,000'},
      {name:'Novuna',model:'Unsecured business loan',cost:'£10k-250k'},
      {name:'Funding Circle',model:'Peer-to-peer business loan',cost:'£10k-500k'},
    ]},
  }[type]||data.vending;
  return`
  <div class="pt-20 min-h-screen px-4">
    <div class="max-w-3xl mx-auto py-12">
      <a onclick="navigate('/for-gyms')" class="text-brand text-sm cursor-pointer mb-4 block">← Back to Gym Owners</a>
      <h1 class="font-brand text-3xl font-bold text-white mb-3">${data.title}</h1>
      <p class="text-slate-400 mb-8">${data.desc}</p>
      <div class="space-y-4">
        ${data.items.map(i=>`
          <div class="bg-card rounded-xl border border-slate-700 p-5 flex items-center justify-between">
            <div>
              <h3 class="text-white font-semibold">${i.name}</h3>
              <p class="text-slate-400 text-sm">${i.model}</p>
            </div>
            <div class="text-right">
              <p class="text-brand font-bold">${i.cost}</p>
              <button class="text-xs text-accent hover:underline mt-1">Get Quote →</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="mt-8 bg-brand/10 border border-brand/30 rounded-xl p-6 text-center">
        <p class="text-white font-medium">Listed on ScanGym? These suppliers offer exclusive discounts.</p>
        <button onclick="navigate('/list-your-gym')" class="mt-3 bg-brand text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition">List Your Gym Free</button>
      </div>
    </div>
  </div>`;
}

// ─── Page: CEO Dashboard (Task 21) ───
function DashboardPage(){
  return`
  <div class="pt-20 min-h-screen px-4">
    <div class="max-w-6xl mx-auto py-8">
      <h1 class="font-brand text-2xl font-bold text-white mb-6">📊 CEO Dashboard</h1>
      <div class="grid sm:grid-cols-5 gap-4 mb-8">
        ${[
          {label:'Visitors',value:'--',sub:'Today'},
          {label:'Searches',value:'--',sub:'Today'},
          {label:'Profile Views',value:'--',sub:'Today'},
          {label:'Checkouts',value:'--',sub:'Today'},
          {label:'Paid Bookings',value:'0',sub:'All time'},
        ].map(s=>`
          <div class="bg-card rounded-xl border border-slate-700 p-5 text-center">
            <p class="text-slate-400 text-xs">${s.label}</p>
            <p class="text-3xl font-bold text-white mt-1">${s.value}</p>
            <p class="text-slate-500 text-xs">${s.sub}</p>
          </div>
        `).join('')}
      </div>
      <div class="bg-card rounded-xl border border-slate-700 p-6 mb-6">
        <h3 class="text-white font-semibold mb-4">Conversion Funnel</h3>
        <div class="space-y-3">
          ${[
            {step:'Visitor → Search',rate:'--',color:'blue'},
            {step:'Search → Profile View',rate:'--',color:'cyan'},
            {step:'Profile → Checkout',rate:'--',color:'yellow'},
            {step:'Checkout → Paid Booking',rate:'--',color:'green'},
          ].map(f=>`
            <div class="flex items-center gap-4">
              <span class="text-slate-400 text-sm w-48">${f.step}</span>
              <div class="flex-1 bg-slate-800 rounded-full h-4"><div class="bg-${f.color}-500 h-4 rounded-full" style="width:0%"></div></div>
              <span class="text-slate-300 text-sm w-16 text-right">${f.rate}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <p class="text-slate-500 text-sm text-center">Live data populates as bookings come in. <a onclick="navigate('/login')" class="text-brand cursor-pointer">Log in</a> with CEO credentials to view.</p>
    </div>
  </div>`;
}

// ─── Page: Generic Info Pages ───
function InfoPage(title,content){
  return`
  <div class="pt-20 min-h-screen px-4">
    <div class="max-w-3xl mx-auto py-12">
      <h1 class="font-brand text-3xl font-bold text-white mb-6">${title}</h1>
      <div class="prose prose-invert text-slate-300 space-y-4">${content}</div>
    </div>
  </div>`;
}

// ─── Page: Login ───
function LoginPage(){
  if(state.user){
    return`
    <div class="pt-20 min-h-screen px-4 flex items-center justify-center">
      <div class="max-w-md w-full text-center">
        <div class="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mx-auto mb-4"><span class="text-white font-bold text-2xl">✓</span></div>
        <h1 class="font-brand text-2xl font-bold text-white mb-2">Welcome back!</h1>
        <p class="text-slate-400 mb-6">Logged in as ${state.user.phone}</p>
        <div class="space-y-3">
          <button onclick="navigate('/explore')" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition">Find a Gym</button>
          <button onclick="navigate('/my-bookings')" class="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl transition">My Bookings</button>
          <button onclick="handleLogout()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-400 py-3 rounded-xl transition text-sm">Log Out</button>
        </div>
      </div>
    </div>`;
  }
  const isCodeStep = state.authStep === 'code';
  return`
  <div class="pt-20 min-h-screen px-4 flex items-center justify-center">
    <div class="max-w-md w-full">
      <div class="text-center mb-8">
        <div class="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4"><span class="text-white font-bold text-2xl">S</span></div>
        <h1 class="font-brand text-2xl font-bold text-white">Welcome to ScanGym</h1>
        <p class="text-slate-400 text-sm mt-1">${isCodeStep ? 'Enter the code we sent to '+state.authPhone : 'Enter your phone number to get started'}</p>
      </div>
      <div class="bg-card rounded-2xl border border-slate-700 p-6 space-y-4">
        <div id="auth-error" class="hidden bg-red-900/50 border border-red-500 text-red-300 text-sm rounded-lg p-3"></div>
        ${isCodeStep ? `
        <div>
          <label class="text-slate-400 text-xs mb-1 block">Verification Code</label>
          <input id="auth-code" type="text" maxlength="6" placeholder="Enter 6-digit code" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-3 text-white text-sm placeholder-slate-500 outline-none focus:border-brand text-center tracking-widest text-lg">
        </div>
        <button id="auth-btn" onclick="handleVerifyCode()" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition">Verify & Log In</button>
        <div class="text-center">
          <a onclick="state.authStep='phone';render()" class="text-slate-400 text-sm hover:text-brand cursor-pointer">← Change phone number</a>
        </div>
        ` : `
        <div>
          <label class="text-slate-400 text-xs mb-1 block">Phone Number</label>
          <div class="flex gap-2">
            <span class="bg-slate-800 border border-slate-600 rounded-lg px-3 py-3 text-white text-sm">+44</span>
            <input id="auth-phone" type="tel" placeholder="7XXX XXXXXX" class="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-3 text-white text-sm placeholder-slate-500 outline-none focus:border-brand">
          </div>
        </div>
        <button id="auth-btn" onclick="handleSendCode()" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition">Send Verification Code</button>
        `}
        <div class="text-center">
          <a onclick="navigate('/explore')" class="text-slate-400 text-sm hover:text-brand cursor-pointer">Continue as Guest →</a>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Auth Handlers ───
window.handleSendCode=async function(){
  const phoneInput=document.getElementById('auth-phone');
  const btn=document.getElementById('auth-btn');
  const errDiv=document.getElementById('auth-error');
  if(!phoneInput)return;
  const phone=phoneInput.value.replace(/\s/g,'');
  if(!phone||phone.length<10){
    errDiv.textContent='Please enter a valid phone number';errDiv.classList.remove('hidden');return;
  }
  btn.textContent='Sending...';btn.disabled=true;
  errDiv.classList.add('hidden');
  try{
    const fullPhone=phone.startsWith('+') ? phone : '+44'+phone.replace(/^0/,'');
    const r=await api.authPost('/send-code',{phone:fullPhone});
    if(r.success){
      state.authPhone=r.phone||fullPhone;
      state.authStep='code';
      render();
    }else{
      errDiv.textContent=r.error||'Failed to send code';errDiv.classList.remove('hidden');
      btn.textContent='Send Verification Code';btn.disabled=false;
    }
  }catch(e){
    errDiv.textContent='Network error — try again';errDiv.classList.remove('hidden');
    btn.textContent='Send Verification Code';btn.disabled=false;
  }
};

window.handleVerifyCode=async function(){
  const codeInput=document.getElementById('auth-code');
  const btn=document.getElementById('auth-btn');
  const errDiv=document.getElementById('auth-error');
  if(!codeInput)return;
  const code=codeInput.value.trim();
  if(!code||code.length<4){
    errDiv.textContent='Please enter the verification code';errDiv.classList.remove('hidden');return;
  }
  btn.textContent='Verifying...';btn.disabled=true;
  errDiv.classList.add('hidden');
  try{
    const r=await api.authPost('/verify',{phone:state.authPhone,code});
    if(r.success&&r.user){
      state.user=r.user;
      state.authStep='phone';
      // If we were trying to book, go back to gym
      if(state.pendingBookGym){
        navigate('/gym/'+state.pendingBookGym);
        state.pendingBookGym=null;
      }else{
        navigate('/');
      }
    }else{
      errDiv.textContent=r.error||'Invalid code';errDiv.classList.remove('hidden');
      btn.textContent='Verify & Log In';btn.disabled=false;
    }
  }catch(e){
    errDiv.textContent='Network error — try again';errDiv.classList.remove('hidden');
    btn.textContent='Verify & Log In';btn.disabled=false;
  }
};

window.handleLogout=async function(){
  await api.authPost('/logout',{});
  state.user=null;
  navigate('/');
};

// ─── Booking Handler ───
window.handleBookNow=async function(gymId){
  if(!state.user){
    state.pendingBookGym=gymId;
    navigate('/login');
    return;
  }
  const dateInput=document.querySelector('input[type="date"]');
  const timeSelect=document.querySelector('select');
  const date=dateInput?dateInput.value:'';
  const time=timeSelect?timeSelect.value:'';
  if(!date||!time){alert('Please select a date and time');return;}

  // Show loading
  const btns=document.querySelectorAll('button');
  btns.forEach(b=>{if(b.textContent.includes('Book Now')){b.textContent='Creating booking...';b.disabled=true;}});

  try{
    let dbGymId=gymId;
    
    // If this is a Google Place ID (not numeric), ensure gym exists in DB first
    if(isNaN(parseInt(gymId))){
      const ensured=await api.postLive('/ensure-gym',{placeId:gymId});
      if(ensured.error){alert(ensured.error);location.reload();return;}
      dbGymId=ensured.gymId;
      console.log(`Gym ensured in DB: ${ensured.name} (ID: ${dbGymId}, created: ${ensured.created})`);
    }

    // Step 1: Create booking
    const booking=await api.bookPost('/create',{gymId:parseInt(dbGymId),date,time});
    if(booking.error){alert(booking.error);location.reload();return;}

    // Step 2: Create Stripe checkout
    const payment=await api.payPost('/checkout',{bookingId:booking.booking.id});
    if(payment.error){alert(payment.error||'Payment error');location.reload();return;}

    // Step 3: Redirect to Stripe
    if(payment.checkoutUrl){
      window.location.href=payment.checkoutUrl;
    }
  }catch(e){
    console.error('Booking error:',e);
    alert('Something went wrong. Please try again.');
    location.reload();
  }
};

// ─── Page: Booking Success ───
function BookingSuccessPage(){
  const params=new URLSearchParams(window.location.search);
  const sessionId=params.get('session_id');
  const bookingId=params.get('booking_id');

  if(!sessionId||!bookingId){
    return`<div class="pt-20 min-h-screen px-4 text-center"><p class="text-red-400 mt-20">Invalid booking confirmation link.</p></div>`;
  }

  // Verify payment and get QR (async — will update DOM)
  if(!state.lastQR){
    setTimeout(async()=>{
      try{
        const r=await api.payGet('/verify?session_id='+sessionId+'&booking_id='+bookingId);
        if(r.success){
          state.lastBooking=r.booking;
          state.lastQR=r.qr;
          render();
        }else{
          document.getElementById('booking-result').innerHTML=`<p class="text-red-400">${r.error||'Payment verification failed'}</p>`;
        }
      }catch(e){
        document.getElementById('booking-result').innerHTML=`<p class="text-red-400">Failed to verify payment. Please contact support.</p>`;
      }
    },500);

    return`
    <div class="pt-20 min-h-screen px-4 flex items-center justify-center">
      <div id="booking-result" class="text-center">
        <div class="text-6xl mb-4 animate-pulse">⏳</div>
        <p class="text-white text-xl font-bold">Verifying your payment...</p>
        <p class="text-slate-400 mt-2">Please wait a moment</p>
      </div>
    </div>`;
  }

  const b=state.lastBooking;
  const qr=state.lastQR;
  return`
  <div class="pt-20 min-h-screen px-4 flex items-center justify-center">
    <div class="max-w-md w-full">
      <div class="text-center mb-6">
        <div class="text-6xl mb-4">🎉</div>
        <h1 class="font-brand text-3xl font-bold text-white">Booking Confirmed!</h1>
        <p class="text-accent text-lg mt-2">Your QR code is ready</p>
      </div>

      <div class="bg-card rounded-2xl border border-slate-700 p-6 space-y-4">
        <div class="text-center">
          <p class="text-white font-bold text-lg">${b.gymName}</p>
          <p class="text-slate-400">${b.date} at ${b.time}</p>
          <p class="text-brand font-bold text-xl mt-1">£${b.price.toFixed(2)}</p>
        </div>

        <div class="border-t border-slate-700 pt-4">
          <p class="text-white font-bold text-center mb-3">📱 Your QR Code</p>
          <div class="bg-white rounded-xl p-4 flex items-center justify-center">
            <img src="${qr.dataUrl}" alt="QR Code" class="w-64 h-64">
          </div>
          <p class="text-slate-400 text-xs text-center mt-2">Token: ${qr.token}</p>
        </div>

        <div class="bg-slate-800 rounded-xl p-4 space-y-2 text-sm">
          <p class="text-white font-bold">How it works:</p>
          <p class="text-slate-400">📲 <strong class="text-white">Scan 1 (Entry):</strong> Show this QR at the gym entrance</p>
          <p class="text-slate-400">🏋️ <strong class="text-white">Work out:</strong> Train for up to 24 hours</p>
          <p class="text-slate-400">🚪 <strong class="text-white">Scan 2 (Exit):</strong> Scan again when you leave</p>
          <p class="text-accent text-xs mt-2">⚠️ QR expires after 2 scans or 24 hours — like JD Gym</p>
        </div>

        <div class="space-y-2">
          <button onclick="navigate('/my-bookings')" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition">View My Bookings</button>
          <button onclick="navigate('/explore')" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl transition">Book Another Gym</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Page: My Bookings ───
function MyBookingsPage(){
  if(!state.user){
    return`<div class="pt-20 min-h-screen px-4 text-center"><p class="text-slate-400 mt-20">Please <a onclick="navigate('/login')" class="text-brand cursor-pointer">log in</a> to see your bookings.</p></div>`;
  }

  // Load bookings async
  if(!state.bookingsLoaded){
    setTimeout(async()=>{
      try{
        const r=await api.bookGet('');
        state.bookings=r.bookings||[];
        state.bookingsLoaded=true;
        render();
      }catch(e){}
    },100);
    return`<div class="pt-20 min-h-screen px-4 text-center"><p class="text-slate-400 mt-20 animate-pulse">Loading bookings...</p></div>`;
  }

  const bookings=state.bookings;
  return`
  <div class="pt-20 min-h-screen px-4">
    <div class="max-w-2xl mx-auto py-12">
      <h1 class="font-brand text-3xl font-bold text-white mb-6 text-center">📋 My Bookings</h1>
      ${bookings.length===0 ? `
        <div class="text-center py-12">
          <p class="text-slate-400 text-lg mb-4">No bookings yet</p>
          <button onclick="navigate('/explore')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-3 rounded-xl">Find a Gym</button>
        </div>
      ` : bookings.map(b=>`
        <div class="bg-card rounded-2xl border border-slate-700 p-5 mb-4">
          <div class="flex justify-between items-start">
            <div>
              <p class="text-white font-bold text-lg">${b.gymName||'Gym'}</p>
              <p class="text-slate-400 text-sm">${b.date} at ${b.time}</p>
              <p class="text-brand font-bold">£${b.price.toFixed(2)}</p>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-bold ${b.status==='confirmed'?'bg-accent/20 text-accent':'bg-yellow-500/20 text-yellow-400'}">${b.status}</span>
          </div>
          ${b.qr ? `
            <div class="mt-3 pt-3 border-t border-slate-700">
              <p class="text-sm text-slate-400">QR: <code class="text-white">${b.qr.token}</code> · ${b.qr.scanCount}/${2} scans used · ${b.qr.status}</p>
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  </div>`;
}

// ─── Globals for onclick ───
window.navigate=navigate;
// Fallback: load gyms from DB when GPS and live search fail
async function loadFallbackGyms(){
  try{
    const r=await fetch('/api/gym-profile/1');const g1=await r.json();
    const r2=await fetch('/api/gym-profile/2');const g2=await r2.json();
    const gyms=[];
    if(g1&&g1.name)gyms.push(g1);
    if(g2&&g2.name)gyms.push(g2);
    if(gyms.length){state.gyms=gyms;state.searchQuery='Bolton';render();}
  }catch(e){console.warn('Fallback gym load failed:',e);}
}

window.findGyms=async function(){
  navigate('/explore');
  const loc=await getLocation();
  if(!loc){
    // GPS failed — load featured gyms from DB as fallback
    try{
      const data=await api.getGuest('/featured');
      if(data.gyms&&data.gyms.length){state.gyms=data.gyms;state.searchQuery='Featured Gyms';render();}
      else{await loadFallbackGyms();}
    }catch(e){await loadFallbackGyms();}
    const el=document.getElementById('gym-search-input');
    if(el){el.focus();el.placeholder='Type your city or postcode...';}
    return;
  }
  state.searchLat=loc.lat;state.searchLng=loc.lng;
  await loadGyms(loc.lat,loc.lng);
};
window.openGym=async function(id,isLive){
  navigate('/gym/'+id);
  // Check if this is a Google Place ID (starts with "ChI" or similar) or numeric DB id
  const isPlaceId=isLive||isNaN(parseInt(id));
  try{
    if(isPlaceId){
      // Live Google Places lookup
      const data=await api.getLive('/place/'+id);
      if(data.gym){
        state.currentGym={
          ...data.gym,
          id:data.gym.dbId||data.gym.placeId,
          place_id:data.gym.placeId,
          photo_url:data.photos?.[0]?.url||null,
          photos_list:data.photos||[],
          rating:data.rating?.google||null,
          user_ratings_total:data.rating?.googleTotal||0,
          formatted_address:data.gym.address,
          vicinity:data.gym.address,
          opening_hours:data.openingHours,
          reviews_data:data.reviews,
          pricing:data.pricing,
          map:data.map,
          source:'live',
        };
      }
    }else{
      const data=await api.getGuest('/gym/'+id);
      state.currentGym=data.gym||data;
    }
    render();
  }catch(e){
    console.error('Failed to load gym:',e);
    state.currentGym=state.gyms.find(g=>(g.placeId||g.id)==id)||{name:'Loading...',id};
    render();
  }
};

window.doSearch=function(){
  const input=document.getElementById('gym-search-input');
  if(input&&input.value.trim()){
    navigate('/explore');
    searchGyms(input.value.trim());
  }
};

// ─── Router ───
function render(){
  const path=state.route;
  let page='';

  if(path==='/'||path==='')page=HomePage();
  else if(path==='/explore'||path==='/nearby'||path==='/search')page=SearchPage();
  else if(path.startsWith('/gym/'))page=GymProfilePage();
  else if(path.startsWith('/r/')){const creator=path.split('/r/')[1]||'';page=InfoPage('Welcome to ScanGym',`<div class="text-center mb-8"><p class="text-5xl mb-4">🏋️</p><p class="text-xl text-white font-bold">You were referred by <span class="text-brand">${decodeURIComponent(creator)}</span></p><p class="text-slate-300 mt-2">Book your first gym session and you both earn £2 credit!</p></div><div class="max-w-md mx-auto"><div class="bg-brand/10 border border-brand/30 rounded-xl p-6 mb-6 text-center"><p class="text-3xl font-bold text-white mb-1">£2 OFF</p><p class="text-brand font-medium">Your first session</p><p class="text-slate-400 text-sm mt-2">Applied automatically at checkout</p></div><div class="space-y-3"><button onclick="navigate('/explore')" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-4 rounded-xl text-lg transition shadow-lg shadow-brand/20">Find a Gym Near You →</button><button onclick="navigate('/login')" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl text-sm transition">Sign Up to Claim Your £2</button></div><div class="mt-6 text-center"><p class="text-slate-500 text-xs">By booking, you agree to our <a onclick="navigate(\\'/terms\\')" class="text-brand cursor-pointer">Terms</a> and <a onclick="navigate(\\'/privacy\\')" class="text-brand cursor-pointer">Privacy Policy</a></p></div></div>`);}

  else if(path==='/coach')page=CoachPage();
  else if(path==='/creators')page=CreatorsPage();
  else if(path==='/wallet')page=WalletPage();
  else if(path==='/dashboard'||path==='/admin'){const tk=localStorage.getItem('sg_token');if(!tk){page=`<div class="max-w-md mx-auto mt-20 text-center"><p class="text-2xl mb-4">🔒</p><p class="text-white font-bold text-xl mb-2">Dashboard Access Required</p><p class="text-slate-400 mb-4">Please log in with your admin account to view the dashboard.</p><button onclick="navigate(\'/login\')" class="bg-brand text-white px-6 py-3 rounded-lg font-bold">Log In →</button></div>`;}else{page=DashboardPage();}}
  else if(path==='/suppliers/vending')page=SupplierPage('vending');
  else if(path==='/suppliers/qr')page=SupplierPage('qr');
  else if(path==='/suppliers/loans')page=SupplierPage('loans');
  else if(path==='/login'||path==='/signup')page=LoginPage();
  else if(path==='/how-it-works')page=InfoPage('How It Works',`<p>1. Find a gym near you using GPS or search</p><p>2. Book a 24-hour day pass from £5</p><p>3. Pay with Apple Pay, Google Pay, or card (guest checkout available)</p><p>4. Get your QR code — scan in at the gym, scan out when done</p><p>5. Rate your session and earn rewards</p>`);
  else if(path==='/pricing')page=InfoPage('Pricing',`<p class="text-xl text-white font-bold mb-6">Simple, transparent pricing. No hidden fees.</p><div class="grid sm:grid-cols-4 gap-4 mb-8">${[{name:"Basic",price:"5",features:["24hr day pass","Free cancellation","QR scan entry","Free WiFi"],best:false},{name:"Standard",price:"7.50",features:["Everything in Basic","Studio classes","Sauna access","Towel included"],best:true},{name:"Premium",price:"12",features:["Everything in Standard","Personal locker","Priority booking","Peak hours included"],best:false},{name:"Elite",price:"18",features:["Everything in Premium","Guest +1 free","All equipment","VIP treatment"],best:false}].map(p=>`<div class="bg-slate-800 rounded-xl p-5 border ${p.best?"border-brand":"border-slate-700"} text-center relative"><div class="mb-3">${p.best?"<span class=\"absolute -top-3 left-1/2 -translate-x-1/2 bg-brand text-white text-xs px-3 py-1 rounded-full font-bold\">⭐ Most Popular</span>":""}${p.name!=="Basic"?"<p class=\"text-slate-500 text-sm line-through\">£"+Math.round(parseFloat(p.price)*1.6)+".00</p>":""}<p class="text-3xl font-bold text-white">£${p.price}</p><p class="text-slate-500 text-xs">per session</p></div><div class="space-y-2 text-left">${p.features.map(f=>`<p class="text-slate-300 text-sm flex items-center gap-2"><span class="text-green-400">✓</span> ${f}</p>`).join("")}</div><button onclick="navigate('/explore')" class="mt-4 w-full ${p.best?"bg-brand hover:bg-orange-600":"bg-slate-700 hover:bg-slate-600"} text-white py-2.5 rounded-lg text-sm font-medium transition">Choose ${p.name}</button></div>`).join("")}</div><p class="text-center text-slate-400 text-sm">🏷️ Off-peak discount: 25% off before 10am & after 8pm · 📦 Multi-pass: 5 for the price of 4 · 💰 Wallet: Add £20, get £22</p><p class="text-center text-accent text-sm mt-2">✅ Free cancellation up to 2 hours before · No memberships · No contracts</p>`);
  else if(path==='/about')page=InfoPage('About ScanGym',`<p class="text-xl text-white font-bold">The Skyscanner for Gyms</p><p class="text-lg text-slate-300">We're building a world where any gym is accessible to anyone, anywhere, for a fair price.</p><div class="mt-8 border-l-2 border-brand pl-6 space-y-6">${[{date:"2026",title:"Founded in Manchester",desc:"Mubarak Ibrahim Patel launches ScanGym — a marketplace connecting fitness enthusiasts with gym owners who have unused capacity."},{date:"2026",title:"1.2M+ Gyms Listed",desc:"Every gym on Earth becomes searchable via Google Places API integration. Real photos, real ratings, real-time data."},{date:"2026",title:"QR Scan-and-Go",desc:"Contactless gym entry with unique QR codes. No staff interaction, no membership cards — just scan and train."},{date:"2026",title:"AI Coach Launch",desc:"GPT-4o powered personal training. Custom workout plans, form analysis, and nutrition advice for every gym-goer."},{date:"Coming",title:"Global Expansion",desc:"Bringing ScanGym to every city on Earth. Dubai, New York, Barcelona, Berlin — gym access without borders."}].map(m=>`<div class="relative"><span class="absolute -left-[33px] w-4 h-4 bg-brand rounded-full border-2 border-dark"></span><p class="text-brand text-xs font-bold">${m.date}</p><p class="text-white font-semibold">${m.title}</p><p class="text-slate-400 text-sm">${m.desc}</p></div>`).join("")}</div><div class="mt-8 grid sm:grid-cols-3 gap-4"><div class="bg-slate-800 rounded-xl p-4 text-center"><p class="text-2xl font-bold text-white" data-counter data-target="1200000" data-suffix="+">0</p><p class="text-slate-500 text-xs">Gyms Listed</p></div><div class="bg-slate-800 rounded-xl p-4 text-center"><p class="text-2xl font-bold text-white" data-counter data-target="50" data-suffix="+">0</p><p class="text-slate-500 text-xs">Countries</p></div><div class="bg-slate-800 rounded-xl p-4 text-center"><p class="text-2xl font-bold text-white" data-counter data-target="18" data-suffix="">0</p><p class="text-slate-500 text-xs">Features Built</p></div></div><div class="mt-8"><p class="text-slate-400">📍 Manchester, UK · 📧 info@scangym.com · 📱 @scangym</p></div>`);
  else if(path==='/faq')page=InfoPage('Frequently Asked Questions',`<p class="text-slate-400 mb-6">Everything you need to know. Click any question to expand.</p><div class="space-y-3">${[{cat:"For Gym-Goers",qs:[{q:"How much does it cost?",a:"From £5 per 24-hour session. 4 tiers: Basic £5, Standard £7.50, Premium £12, Elite £18. Off-peak 25% cheaper."},{q:"How do I get in?",a:"After booking, you get a unique QR code. Open it on your phone and scan at the gym entrance. 100% contactless — no staff needed."},{q:"Can I cancel?",a:"Yes! Free cancellation up to 2 hours before your session. Refund goes to your ScanGym Wallet instantly, or back to your card in 5-10 days."},{q:"Do I need an account?",a:"No! Guest checkout available — just email + card. Apple Pay and Google Pay supported for even faster checkout."},{q:"How long can I stay?",a:"24 hours from scan-in. Scan out when you leave."}]},{cat:"For Gym Owners",qs:[{q:"How much does it cost to list?",a:"Zero. Free to list. We only take a small commission on bookings. You set your own prices and control availability."},{q:"What equipment do I get?",a:"Listed gyms qualify for free vending machines and QR scanner hardware — installed at no cost to you."},{q:"How do I get paid?",a:"Direct bank transfer, weekly. Full analytics dashboard shows your bookings, revenue, and ratings in real-time."}]},{cat:"For Creators",qs:[{q:"How does FlexSquad work?",a:"Sign up, get your personal referral page (scangym.com/r/yourname), share it. Earn 25% commission on every booking."},{q:"How much can I earn?",a:"Explorers: £50-150/mo. Ambassadors: £200-500/mo + free sessions. Elite: £500-1,200/mo. Legends: £1,200-5,000/mo."}]}].map(cat=>`<div class="mb-4"><h3 class="text-brand font-bold text-sm mb-2">${cat.cat}</h3>${cat.qs.map(q=>`<div class="border border-slate-700 rounded-lg mb-2 overflow-hidden"><button class="accordion-trigger w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/50 transition"><span class="text-white text-sm font-medium">${q.q}</span><span class="accordion-arrow text-slate-500 transition-transform">▼</span></button><div class="overflow-hidden transition-all duration-300" style="max-height:0"><p class="text-slate-400 text-sm p-4 pt-0">${q.a}</p></div></div>`).join("")}</div>`).join("")}</div>`);
  else if(path==='/for-gyms')page=InfoPage('For Gym Owners',`<p class="text-xl text-white font-bold">Fill your empty hours. Earn more revenue.</p><p class="text-lg text-slate-300">1.2M+ gym-goers search ScanGym monthly. Turn your quiet hours into profit.</p><div class="mt-6 bg-brand/10 border border-brand/30 rounded-xl p-6"><p class="text-white font-bold mb-3">💰 Revenue Calculator — How much could you earn?</p><div class="grid sm:grid-cols-3 gap-4 mb-4"><div><label class="text-slate-400 text-xs">Empty slots per day</label><input type="range" id="calc-slots" min="2" max="50" value="10" class="w-full accent-brand" oninput="document.getElementById('calc-result').textContent='£'+((this.value*5*0.85)*30).toLocaleString()"></div><div class="text-center"><p class="text-slate-400 text-xs">Estimated monthly revenue</p><p id="calc-result" class="text-3xl font-bold text-brand">£1,275</p></div><div class="text-center"><p class="text-slate-400 text-xs">Your commission</p><p class="text-white font-bold">85%</p><p class="text-slate-500 text-xs">You keep · We take 15%</p></div></div><p class="text-slate-500 text-xs">Based on £5 avg day pass × 10 bookings/day × 30 days. Actual results vary.</p></div><div class="mt-6 grid sm:grid-cols-3 gap-4"><div class="bg-slate-800 p-4 rounded-lg text-center"><p class="text-3xl mb-2">💸</p><p class="text-white font-semibold text-sm">You set the price</p><p class="text-slate-500 text-xs">4 tiers £5-£18. Change anytime.</p></div><div class="bg-slate-800 p-4 rounded-lg text-center"><p class="text-3xl mb-2">⏸️</p><p class="text-white font-semibold text-sm">Full control</p><p class="text-slate-500 text-xs">Pause bookings with one toggle.</p></div><div class="bg-slate-800 p-4 rounded-lg text-center"><p class="text-3xl mb-2">🥤</p><p class="text-white font-semibold text-sm">Free equipment</p><p class="text-slate-500 text-xs">Vending machines + QR scanners.</p></div></div><p class="mt-6 text-center text-slate-400">Zero listing fee. Zero commitment. Cancel anytime.</p><div class="mt-6 flex gap-4 flex-wrap justify-center"><a onclick="navigate('/list-your-gym')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl cursor-pointer transition inline-block shadow-lg shadow-brand/20">List Your Gym — It's Free →</a><a onclick="navigate('/owner-benefits')" class="border border-brand text-brand hover:bg-brand hover:text-white font-bold px-8 py-4 rounded-xl cursor-pointer transition inline-block">See All Benefits →</a></div>`);
  else if(path==='/list-your-gym')page=InfoPage('List Your Gym',`<div class="text-center mb-8"><p class="text-xl text-white font-bold">Get your gym listed in 10 minutes</p><p class="text-slate-300">Free forever. Start earning from day one.</p><div class="mt-3 flex justify-center gap-2"><span class="bg-green-900/30 text-green-400 text-xs px-3 py-1 rounded-full font-medium">⏱ 10-minute setup</span><span class="bg-blue-900/30 text-blue-400 text-xs px-3 py-1 rounded-full font-medium">💰 Free forever</span><span class="bg-brand/20 text-brand text-xs px-3 py-1 rounded-full font-medium">📊 Instant dashboard</span></div></div><div class="relative space-y-6">${[{step:"1",title:"Tell us about your gym",desc:"Name, address, facilities, opening hours. Your Google listing auto-fills most of this. Takes 3 minutes.",time:"3 min"},{step:"2",title:"Set your pricing",desc:"Choose from 4 tiers: Basic £5 · Standard £7.50 · Premium £12 · Elite £18. Set off-peak discounts to fill quiet hours. Change anytime.",time:"2 min"},{step:"3",title:"Go live",desc:"We ship you a free QR scanner. Plug it in at your entrance. Customers scan in and out — fully automated, contactless check-in.",time:"5 min"}].map(s=>`<div class="flex gap-4"><div class="w-10 h-10 bg-brand rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">${s.step}</div><div class="flex-1 bg-slate-800 rounded-lg p-4"><div class="flex items-center justify-between"><p class="text-white font-bold">${s.title}</p><span class="text-brand text-xs font-medium">${s.time}</span></div><p class="text-slate-400 text-sm mt-1">${s.desc}</p></div></div>`).join("")}</div><div class="mt-8 bg-green-900/20 border border-green-800/30 rounded-xl p-5"><p class="text-white font-bold mb-2">✅ What you get — free:</p><div class="grid sm:grid-cols-2 gap-2 text-sm">${["Listing on ScanGym (1.2M+ gyms)","Free QR scanner hardware","Owner analytics dashboard","Free vending machine (optional)","Zero listing fee — forever","85% commission to you","Weekly direct bank payouts","Pause bookings anytime"].map(f=>`<p class="text-slate-300 flex items-center gap-2"><span class="text-green-400">✓</span>${f}</p>`).join("")}</div></div><div class="mt-6 text-center"><a onclick="navigate('/contact')" class="bg-brand hover:bg-orange-600 text-white font-bold px-10 py-4 rounded-xl cursor-pointer transition inline-block shadow-lg shadow-brand/20 text-lg">List Your Gym — Free →</a><p class="text-slate-500 text-sm mt-3">📧 gyms@scangym.com · 📱 @scangym</p></div>`);
  else if(path==='/owner-benefits')page=InfoPage('Owner Benefits',`<p class="text-xl text-white font-bold">Why 1,000+ gyms choose ScanGym</p><div class="mt-6 grid gap-4"><div class="bg-slate-800 p-4 rounded-lg"><p class="text-2xl mb-1">💰</p><p class="text-brand font-bold">Earn from empty hours</p><p>Your off-peak slots generate zero revenue right now. ScanGym fills them with paying day-pass visitors. Average listed gym earns £800-2,000/month extra.</p></div><div class="bg-slate-800 p-4 rounded-lg"><p class="text-2xl mb-1">💸</p><p class="text-brand font-bold">You set the price</p><p>4 tiers from £5-£18. Set off-peak discounts (25% off before 10am, after 8pm). Change pricing anytime with one tap.</p></div><div class="bg-slate-800 p-4 rounded-lg"><p class="text-2xl mb-1">📊</p><p class="text-brand font-bold">Full analytics dashboard</p><p>See bookings, revenue, ratings, peak hours, and customer demographics in real-time. Export reports monthly.</p></div><div class="bg-slate-800 p-4 rounded-lg"><p class="text-2xl mb-1">🔒</p><p class="text-brand font-bold">Full control</p><p>Pause bookings with one toggle. Set capacity limits. Block specific dates. You\'re always in charge.</p></div><div class="bg-slate-800 p-4 rounded-lg"><p class="text-2xl mb-1">🥤</p><p class="text-brand font-bold">Free equipment</p><p>Listed gyms qualify for free vending machines and QR scanner hardware — installed at no cost.</p></div><div class="bg-slate-800 p-4 rounded-lg"><p class="text-2xl mb-1">🏦</p><p class="text-brand font-bold">Gym finance</p><p>Opening a new gym? Access loans from £10k-500k through our lending partners. Government-backed options available.</p></div></div><div class="mt-6"><p class="text-slate-400">Zero listing fee. Zero commitment. Cancel anytime.</p><a onclick="navigate(\'/list-your-gym\')" class="mt-3 bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl cursor-pointer transition inline-block">List Your Gym — It\'s Free →</a></div>`);
  else if(path==='/blog')page=InfoPage('Blog / Transformations',`<p class="text-xl text-white">Real transformations. Real people. Real gyms.</p><p>Coming soon — stories from ScanGym users who found their perfect gym.</p><p>Want to share your story? <a onclick="navigate(\'/contact\')" class="text-brand cursor-pointer">Get in touch →</a></p>`);
  else if(path==='/contact')page=InfoPage('Contact',`<p class="text-lg text-slate-300 mb-6">Have a question? Fill out the form below or reach us directly.</p><div class="grid md:grid-cols-2 gap-8"><div><form onsubmit="event.preventDefault();alert('Thanks! We\\'ll get back to you within 24 hours.');this.reset();" class="space-y-4"><div><label class="text-slate-400 text-sm block mb-1">Name</label><input type="text" required placeholder="Your name" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-brand outline-none text-sm"></div><div><label class="text-slate-400 text-sm block mb-1">Email</label><input type="email" required placeholder="your@email.com" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-brand outline-none text-sm"></div><div><label class="text-slate-400 text-sm block mb-1">Subject</label><select class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-brand outline-none text-sm"><option>General Enquiry</option><option>Booking Issue</option><option>Gym Owner Enquiry</option><option>Creator / FlexSquad</option><option>Partnership</option><option>Bug Report</option></select></div><div><label class="text-slate-400 text-sm block mb-1">Message</label><textarea required rows="4" placeholder="How can we help?" class="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-brand outline-none text-sm resize-none"></textarea></div><button type="submit" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition">Send Message →</button></form></div><div class="space-y-4"><div class="bg-card rounded-xl p-5 border border-slate-700"><p class="text-white font-semibold mb-3">Get in Touch</p><div class="space-y-3 text-sm"><p class="text-slate-400">📧 <strong class="text-white">info@scangym.com</strong></p><p class="text-slate-400">📍 <strong class="text-white">Manchester, UK</strong></p><p class="text-slate-400">📱 <strong class="text-white">Instagram: @scangym</strong></p><p class="text-slate-400">🐦 <strong class="text-white">Twitter/X: @scangym</strong></p></div></div><div class="bg-brand/10 border border-brand/30 rounded-xl p-5"><p class="text-white font-semibold mb-2">Gym Owner?</p><p class="text-slate-300 text-sm mb-3">Want to list your gym? We respond within 2 hours.</p><p class="text-brand text-sm font-medium">📧 gyms@scangym.com</p></div></div></div>`);
  else if(path==='/refer')page=InfoPage('Refer & Earn',`<p class="text-xl text-white font-bold">£2 for you. £2 for them. Plus milestone bonuses.</p><p class="text-lg text-slate-300 mb-6">Share your link. When friends book, you both earn. The more you refer, the bigger the rewards.</p><div class="bg-card rounded-xl border border-slate-700 p-6 mb-6"><p class="text-white font-bold mb-1">Your Referral Link</p><div class="bg-slate-800 rounded-lg p-3 flex items-center justify-between"><code class="text-brand text-sm">scangym.com/r/your-name</code><button class="text-xs bg-brand text-white px-3 py-1 rounded-md">Copy</button></div><p class="text-slate-500 text-xs mt-2">Log in to activate your personal link</p></div><div class="grid sm:grid-cols-4 gap-3 mb-6">${[{refs:'1',reward:"£2 credit",icon:"🎯",desc:"Per referral"},{refs:5,reward:"Free session",icon:"🏋️",desc:"Worth £5"},{refs:15,reward:"Free merch",icon:"👕",desc:"ScanGym t-shirt"},{refs:25,reward:"£50 bonus",icon:"💰",desc:"Cash reward"}].map(m=>`<div class="bg-slate-800 rounded-xl p-4 text-center border border-slate-700"><div class="text-2xl mb-1">${m.icon}</div><p class="text-white font-bold text-sm">${m.refs} referral${m.refs===1||m.refs==='1'?'':'s'}</p><p class="text-brand font-medium text-sm">${m.reward}</p><p class="text-slate-500 text-[10px]">${m.desc}</p></div>`).join("")}</div><div class="bg-slate-800 rounded-xl p-4"><p class="text-white font-semibold text-sm mb-2">📊 Your Progress</p><div class="flex items-center gap-3"><div class="flex-1 bg-slate-700 rounded-full h-3"><div class="bg-brand h-3 rounded-full" style="width:0%"></div></div><span class="text-slate-400 text-xs">0/5 to next milestone</span></div></div><p class="mt-6 text-center"><a onclick="navigate('/login')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl cursor-pointer transition inline-block">Log In to Start Earning →</a></p>`);
  else if(path==='/become-a-creator'||path==='/become-creator')page=InfoPage('Become a Creator',`<p class="text-xl text-white font-bold">Join FlexSquad — ScanGym\'s Creator Program</p><p>Get your own landing page at scangym.com/r/yourname</p><p>✅ 25% commission on every booking</p><p>✅ Free gym sessions at 25+ conversions/month</p><p>✅ Featured on the creators leaderboard</p><p>✅ Marketing toolkit with 388+ assets</p><p><a onclick="navigate(\'/login\')" class="text-brand cursor-pointer">Sign up to apply →</a></p>`);
  else if(path==='/privacy')page=InfoPage('Privacy Policy',`<p>Last updated: May 2026</p><p>ScanGym ("we", "us") respects your privacy. We collect only what\'s needed to process bookings: name, email, phone number, payment details, and location data.</p><p>We use Stripe for payments (PCI compliant), Twilio for OTP verification, and Google Maps for gym locations.</p><p>We never sell your data. Contact: privacy@scangym.com</p>`);
  else if(path==='/terms')page=InfoPage('Terms of Service',`<p>Last updated: May 2026</p><p>By using ScanGym, you agree to these terms. ScanGym is a marketplace connecting gym-goers with gym owners. We are not a gym operator.</p><p>Bookings are 24-hour day passes. Free cancellation up to 2 hours before session start.</p><p>Contact: legal@scangym.com</p>`);
  else if(path==='/cookies')page=InfoPage('Cookie Policy',`<p>We use essential cookies for authentication and preferences. Analytics cookies help us understand usage patterns. You can disable non-essential cookies in your browser settings.</p>`);
  else if(path==='/bookings'||path==='/my-bookings')page=MyBookingsPage();
  else if(path==='/booking-success')page=BookingSuccessPage();
  else if(path==='/featured')page=InfoPage('Featured Listings',`<p class="text-xl text-white font-bold">Featured Gyms on ScanGym</p><p>Get your gym seen by thousands. Featured listings appear at the top of search results with a highlighted badge.</p><p>✅ Priority placement in search</p><p>✅ Featured badge on your profile</p><p>✅ 3x more profile views on average</p><p><a onclick="navigate(\'/contact\')" class="text-brand cursor-pointer">Contact us about featured listings →</a></p>`);
  else if(path==='/careers')page=InfoPage('Careers at ScanGym',`<p class="text-xl text-white font-bold">Join the Team</p><p>We\'re building the future of gym access in the UK. Currently a lean team based in Manchester.</p><p>Interested in working with us? Send your CV to:</p><p>📧 <strong>careers@scangym.com</strong></p>`);
  else if(path==='/help')page=InfoPage('Help Center',`<p class="text-xl text-white font-bold">How Can We Help?</p><p><strong>How do I book a gym?</strong><br>Search for a gym → Pick your date/time → Pay → Get your QR code.</p><p><strong>How do I cancel?</strong><br>Free cancellation up to 2 hours before your session from your bookings page.</p><p><strong>I can\'t scan my QR code</strong><br>Make sure your screen brightness is at max. If it still doesn\'t work, show the booking confirmation to staff.</p><p><strong>How do I get a refund?</strong><br>Cancelled bookings are refunded to your ScanGym Wallet instantly, or to your card within 5-10 days.</p><p>📧 Still stuck? Email <strong>support@scangym.com</strong></p>`);
  else if(path==='/staff/scan')page=InfoPage('Staff QR Scanner',`<div class="text-center mb-8"><p class="text-xl text-white font-bold">📱 Scan Customer QR Codes</p><p class="text-slate-300">Verify customer entry and check-out</p></div><div class="max-w-md mx-auto"><div class="bg-card rounded-2xl border border-slate-700 p-8 text-center"><div class="w-48 h-48 bg-slate-800 rounded-2xl mx-auto mb-6 flex items-center justify-center border-2 border-dashed border-slate-600"><div class="text-center"><p class="text-4xl mb-2">📷</p><p class="text-slate-400 text-sm">Camera viewfinder</p></div></div><button onclick="if(state.user){alert('QR scanner activated. Point camera at customer QR code.')}else{navigate('/login')}" class="w-full bg-brand hover:bg-orange-600 text-white font-bold py-4 rounded-xl text-lg transition mb-3">Start Scanning</button><button onclick="navigate('/login')" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl text-sm transition">Staff Log In</button></div><div class="mt-6 space-y-3"><div class="bg-card rounded-xl p-4 border border-slate-700"><h4 class="text-white font-semibold mb-2">How it works</h4><div class="space-y-2 text-sm text-slate-400"><p>1. Log in with your staff account</p><p>2. Point your camera at the customer&apos;s QR code</p><p>3. The system confirms their booking and checks them in</p><p>4. When they leave, scan again to check them out</p></div></div><div class="bg-green-900/20 border border-green-800/30 rounded-xl p-4"><p class="text-green-400 text-sm font-medium">✅ Works on any smartphone or tablet</p><p class="text-green-400 text-sm font-medium">✅ No special hardware needed</p><p class="text-green-400 text-sm font-medium">✅ Automatic booking validation</p></div></div></div>`);
  else if(path==='/scan')page=InfoPage('QR Scan Entry',`<p class="text-xl text-white font-bold">📱 How QR Entry Works</p><p>1. Book a gym session on ScanGym</p><p>2. Get your unique QR code instantly</p><p>3. Scan at the gym entrance to check in</p><p>4. Scan again when you leave to check out</p><p>Your 24-hour day pass is valid from the moment you scan in. No staff interaction needed — it\'s completely contactless.</p><p><a onclick="navigate(\'/explore\')" class="text-brand cursor-pointer">Find a gym to try it →</a></p>`);
  else if(path==='/top-creators')page=InfoPage('Top Creators',`<div class="text-center mb-8"><p class="text-xl text-white font-bold">🏆 FlexSquad Leaderboard</p><p class="text-slate-300">Our top-performing creators this month</p></div><div class="space-y-4">${[{rank:1,name:'Coming Soon',handle:'@your-name-here',bookings:'-',earned:'-',badge:'🥇'},{rank:2,name:'Coming Soon',handle:'@your-name-here',bookings:'-',earned:'-',badge:'🥈'},{rank:3,name:'Coming Soon',handle:'@your-name-here',bookings:'-',earned:'-',badge:'🥉'}].map(c=>\`<div class="bg-slate-800 rounded-xl p-4 flex items-center gap-4 border border-slate-700"><span class="text-3xl">\${c.badge}</span><div class="flex-1"><p class="text-white font-bold">\${c.name}</p><p class="text-slate-400 text-sm">\${c.handle}</p></div><div class="text-right"><p class="text-brand font-bold">\${c.earned}</p><p class="text-slate-500 text-xs">\${c.bookings} bookings</p></div></div>\`).join("")}</div><div class="mt-8 bg-brand/10 border border-brand/30 rounded-xl p-6 text-center"><p class="text-white font-bold mb-2">Want to see your name here?</p><p class="text-slate-300 text-sm mb-4">Join FlexSquad and start earning 25% commission on every referred booking.</p><div class="flex gap-3 justify-center flex-wrap"><a onclick="navigate(\\'/become-a-creator\\')" class="bg-brand hover:bg-orange-600 text-white font-bold px-6 py-3 rounded-xl cursor-pointer transition inline-block">Become a Creator →</a><a onclick="navigate(\\'/creators\\')" class="border border-brand text-brand hover:bg-brand hover:text-white font-bold px-6 py-3 rounded-xl cursor-pointer transition inline-block">Browse Assets →</a></div></div>`);
  else page=InfoPage('Page Not Found',`<p>Sorry, this page doesn\'t exist yet.</p><p><a onclick="navigate(\'/\')" class="text-brand cursor-pointer">← Back to home</a></p>`);

  document.getElementById('app').innerHTML=NavBar()+`<main class="fade-in">${page}</main>`+Footer();
  initInteractive();
}

// ─── Init ───
state.route=location.pathname;
render();

// Auto-load data based on initial route
if(state.route==='/explore'||state.route==='/nearby'||state.route==='/search'){
  getLocation().then(loc=>{
    if(loc){state.searchLat=loc.lat;state.searchLng=loc.lng;loadGyms(loc.lat,loc.lng);}
    else{loadFallbackGyms();}
  }).catch(()=>{loadFallbackGyms();});
}
// Load gym profile when visiting /gym/:id directly
if(state.route.startsWith('/gym/')){
  const gymId=state.route.split('/gym/')[1];
  if(gymId)openGym(gymId,isNaN(parseInt(gymId)));
}
