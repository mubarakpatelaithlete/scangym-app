// ScanGym Frontend v3.2.0 - Live Google Places API
const API='/api/v2';
let MAPS_KEY='';
let STRIPE_PK='';
let GYM_COUNT=2;
function fmtCount(n){if(n>=1000000)return (n/1000000).toFixed(1).replace(/\.0$/,'')+'M+';if(n>=1000)return (n/1000).toFixed(0)+'K+';return n.toLocaleString();}

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
function getLocation(){
  return new Promise((resolve)=>{
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude}),
        ()=>resolve({lat:53.578,lng:-2.429}) // Default Bolton
      );
    }else resolve({lat:53.578,lng:-2.429});
  });
}

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
  const dist=gym.distanceText||(gym.distance?`${gym.distance.toFixed(1)} km`:'Nearby');
  // Support both live API (photo field) and DB gyms (photo_url / photo_reference)
  const photo=gym.photo||gym.photo_url||
    (gym.photoReference?`https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${gym.photoReference}&key=${MAPS_KEY}`:
    (gym.photo_reference?`https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${gym.photo_reference}&key=${MAPS_KEY}`:''));
  const hasPhoto=!!photo;
  // Use placeId for live results, id for DB gyms
  const gymIdentifier=gym.placeId||gym.place_id||gym.id;
  const isLive=!!gym.placeId;
  return`
  <div class="gym-card bg-card rounded-2xl overflow-hidden border border-slate-700 cursor-pointer" onclick="openGym('${gymIdentifier}',${isLive})">
    <div class="relative h-48 bg-slate-700">
      ${hasPhoto?`<img src="${photo}" alt="${gym.name}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-4xl\\'>🏋️</div>'">`
        :`<div class="w-full h-full flex items-center justify-center text-4xl">🏋️</div>`}
      <div class="absolute top-3 right-3 bg-brand text-white px-3 py-1 rounded-full text-sm font-bold">£${price}</div>
      ${gym.openNow===true?`<div class="absolute top-3 left-3 bg-green-600 text-white px-2 py-1 rounded-full text-xs font-medium">Open Now</div>`:''}
      ${badges[0]?`<div class="absolute bottom-3 left-3 bg-black/70 text-white px-2 py-1 rounded-lg text-xs backdrop-blur">${badges[0].icon} ${badges[0].text}</div>`:''}
    </div>
    <div class="p-4">
      <div class="flex items-start justify-between mb-2">
        <h3 class="font-semibold text-white text-sm leading-tight">${gym.name}</h3>
        <span class="text-xs text-slate-400 whitespace-nowrap ml-2">${dist}</span>
      </div>
      <div class="flex items-center gap-2 mb-3">
        <span class="text-yellow-400 text-sm">★ ${gym.rating||'New'}</span>
        <span class="text-slate-500 text-xs">(${gym.totalReviews||gym.user_ratings_total||0} reviews)</span>
      </div>
      <p class="text-slate-500 text-xs mb-2 truncate">${gym.address||''}</p>
      <div class="flex flex-wrap gap-1.5">
        ${badges.slice(1).map(b=>`<span class="text-xs bg-slate-700/50 text-slate-300 px-2 py-0.5 rounded-full">${b.icon} ${b.text}</span>`).join('')}
      </div>
      <div class="mt-3 flex items-center justify-between">
        <span class="text-xs text-accent font-medium">✅ Free cancellation</span>
        <span class="text-xs text-slate-500">24hr pass</span>
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
        <p class="text-slate-500 text-sm mt-4">Search any city worldwide · 1.2M+ gyms · Powered by Google</p>
      </div>
    </section>

    <!-- Trust bar -->
    <section class="py-8 border-y border-slate-800 bg-slate-900/50">
      <div class="max-w-5xl mx-auto flex flex-wrap justify-center gap-8 px-4 text-center">
        <div><span class="text-2xl font-bold text-white">${fmtCount(GYM_COUNT)}</span><p class="text-xs text-slate-500">Gyms Live</p></div>
        <div><span class="text-2xl font-bold text-white">£5</span><p class="text-xs text-slate-500">From / Session</p></div>
        <div><span class="text-2xl font-bold text-white">24hr</span><p class="text-xs text-slate-500">Day Pass</p></div>
        <div><span class="text-2xl font-bold text-white">QR</span><p class="text-xs text-slate-500">Scan Entry</p></div>
        <div><span class="text-2xl font-bold text-white">0</span><p class="text-xs text-slate-500">Contracts</p></div>
        <div><span class="text-2xl font-bold text-accent">FREE</span><p class="text-xs text-slate-500">Cancellation</p></div>
      </div>
    </section>

    <!-- How It Works -->
    <section class="py-20 px-4">
      <div class="max-w-5xl mx-auto text-center mb-12">
        <h2 class="font-brand text-3xl font-bold text-white mb-3">How It Works</h2>
        <p class="text-slate-400">Simpler than ordering a coffee</p>
      </div>
      <div class="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
        <div class="text-center p-6 bg-card rounded-2xl border border-slate-700">
          <div class="w-16 h-16 bg-brand/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">📍</div>
          <h3 class="text-white font-semibold mb-2">1. Find</h3>
          <p class="text-slate-400 text-sm">Search gyms near you. See photos, reviews, prices, and real-time availability.</p>
        </div>
        <div class="text-center p-6 bg-card rounded-2xl border border-slate-700">
          <div class="w-16 h-16 bg-brand/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">💳</div>
          <h3 class="text-white font-semibold mb-2">2. Book</h3>
          <p class="text-slate-400 text-sm">Pay with Apple Pay, Google Pay, or card. Guest checkout — no account needed.</p>
        </div>
        <div class="text-center p-6 bg-card rounded-2xl border border-slate-700">
          <div class="w-16 h-16 bg-brand/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">📲</div>
          <h3 class="text-white font-semibold mb-2">3. Train</h3>
          <p class="text-slate-400 text-sm">Scan your QR code at entry. Train for 24 hours. Scan out when done.</p>
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

      <div class="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 class="font-brand text-2xl font-bold text-white">Gyms ${searchLabel}</h1>
          <p class="text-slate-400 text-sm">${gyms.length}+ gyms found · Powered by Google Places · 1.2M+ gyms worldwide</p>
        </div>
        <div class="flex gap-2">
          <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-lg text-xs text-slate-300">💰 Price</button>
          <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-lg text-xs text-slate-300">⭐ Rating</button>
          <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-lg text-xs text-slate-300">📍 Distance</button>
          <button class="px-3 py-1.5 bg-card border border-slate-600 rounded-lg text-xs text-slate-300">🕐 Open Now</button>
        </div>
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
  <div class="pt-20 min-h-screen">
    <!-- Photo Banner -->
    <div class="h-72 bg-slate-700 relative">
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
          <!-- Rating + Stats -->
          <div class="flex items-center gap-4 flex-wrap">
            <span class="text-yellow-400 text-lg font-bold">★ ${gym.rating||'4.5'}</span>
            <span class="text-slate-400 text-sm">${gym.user_ratings_total||47} reviews</span>
            <span class="text-slate-600">|</span>
            <span class="text-accent text-sm font-medium">✅ Free cancellation</span>
            <span class="text-slate-600">|</span>
            <span class="text-slate-400 text-sm">🕐 ${gym.opening_hours?.isOpen===true?'<span class="text-green-400">Open Now</span>':(gym.opening_hours?.isOpen===false?'<span class="text-red-400">Closed</span>':'Hours vary')}</span>
          </div>

          <!-- Conviction Badges (Task 9 - 33 techniques) -->
          <div class="flex flex-wrap gap-2">
            ${badges.map(b=>`<span class="bg-slate-800 border border-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-full">${b.icon} ${b.text}</span>`).join('')}
          </div>

          <!-- Opening Hours (Live from Google) -->
          ${gym.opening_hours?.weekday?.length?`
          <div class="bg-card rounded-xl p-5 border border-slate-700">
            <h3 class="text-white font-semibold mb-3">🕐 Opening Hours</h3>
            <div class="space-y-1">
              ${gym.opening_hours.weekday.map(d=>`<p class="text-slate-400 text-sm">${d}</p>`).join('')}
            </div>
          </div>`:``}

          <!-- Facilities -->
          <div class="bg-card rounded-xl p-5 border border-slate-700">
            <h3 class="text-white font-semibold mb-3">Facilities</h3>
            <div class="flex flex-wrap gap-2">
              ${['🏋️ Free Weights','🚴 Cardio','💪 Machines','🧘 Studio','🚿 Showers','🔒 Lockers','♨️ Sauna','🅿️ Parking','📶 WiFi'].map(f=>
                `<span class="bg-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-full">${f}</span>`
              ).join('')}
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
            <div class="text-center">
              <p class="text-slate-400 text-sm">24-Hour Day Pass</p>
              <p class="text-4xl font-bold text-white">£${gym.price_tier||'5'}<span class="text-lg text-slate-500">.00</span></p>
              <p class="text-accent text-xs mt-1">✅ Free cancellation up to 2hrs before</p>
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

// ─── Page: Creators / FlexSquad (Tasks 15-17) ───
function CreatorsPage(){
  return`
  <div class="pt-20 min-h-screen px-4">
    <div class="max-w-5xl mx-auto py-12">
      <div class="text-center mb-12">
        <div class="text-6xl mb-4">💪</div>
        <h1 class="font-brand text-4xl font-bold text-white mb-3">FlexSquad</h1>
        <p class="text-slate-400 text-lg">The ScanGym creator community. Earn. Train free. Compete.</p>
      </div>
      <div class="grid sm:grid-cols-4 gap-6 mb-12">
        ${[
          {tier:'Explorer',req:'Sign up',reward:'25% commission',color:'slate'},
          {tier:'Ambassador',req:'25+ conversions/mo',reward:'Free sessions + £25 bonus',color:'brand'},
          {tier:'Elite Creator',req:'100+ conversions/mo',reward:'Everything + £50 bonus',color:'yellow'},
          {tier:'Legend',req:'500+ conversions/mo',reward:'Revenue share + £100',color:'purple'},
        ].map(t=>`
          <div class="bg-card rounded-xl p-5 border border-slate-700 text-center">
            <div class="text-2xl mb-2">🏅</div>
            <h3 class="text-${t.color}-400 font-bold">${t.tier}</h3>
            <p class="text-slate-500 text-xs mt-1">${t.req}</p>
            <p class="text-slate-300 text-sm mt-2">${t.reward}</p>
          </div>
        `).join('')}
      </div>
      <div class="text-center">
        <button onclick="navigate('/become-a-creator')" class="bg-brand hover:bg-orange-600 text-white font-bold px-8 py-4 rounded-xl transition">
          Join FlexSquad — Start Earning Today
        </button>
        <p class="text-slate-500 text-sm mt-3">Get your personal landing page at scangym.com/r/yourname</p>
      </div>
    </div>
  </div>`;
}

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
window.findGyms=async function(){
  navigate('/explore');
  const loc=await getLocation();
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
  else if(path==='/explore'||path==='/nearby')page=SearchPage();
  else if(path.startsWith('/gym/'))page=GymProfilePage();
  else if(path==='/coach')page=CoachPage();
  else if(path==='/creators')page=CreatorsPage();
  else if(path==='/wallet')page=WalletPage();
  else if(path==='/dashboard'||path==='/admin')page=DashboardPage();
  else if(path==='/suppliers/vending')page=SupplierPage('vending');
  else if(path==='/suppliers/qr')page=SupplierPage('qr');
  else if(path==='/suppliers/loans')page=SupplierPage('loans');
  else if(path==='/login'||path==='/signup')page=LoginPage();
  else if(path==='/how-it-works')page=InfoPage('How It Works','<p>1. Find a gym near you using GPS or search</p><p>2. Book a 24-hour day pass from £5</p><p>3. Pay with Apple Pay, Google Pay, or card (guest checkout available)</p><p>4. Get your QR code — scan in at the gym, scan out when done</p><p>5. Rate your session and earn rewards</p>');
  else if(path==='/pricing')page=InfoPage('Pricing','<p class="text-2xl font-bold text-white">From £5 per session</p><p>4 tiers based on gym quality: Basic £5 · Standard £7.50 · Premium £12 · Elite £18</p><p>🏷️ Off-peak discount: 25% off before 10am and after 8pm</p><p>📦 Multi-pass: Buy 5 sessions, get 1 free</p><p>💰 Wallet top-up: Add £20, get £22 (10% bonus)</p><p>✅ Free cancellation up to 2 hours before</p><p>No memberships. No contracts. No hidden fees.</p>');
  else if(path==='/about')page=InfoPage('About ScanGym','<p>ScanGym is the Skyscanner for gyms — a marketplace connecting fitness enthusiasts with gym owners who have unused capacity.</p><p>Founded in Manchester, UK by Mubarak Ibrahim Patel.</p><p>🏋️ Growing gym network in Bolton</p><p>🎯 Mission: Make any gym accessible to anyone, anywhere, for a fair price.</p><p>📧 info@scangym.com</p>');
  else if(path==='/faq')page=InfoPage('FAQ','<p><strong>How much does it cost?</strong><br>From £5 per 24-hour session. No membership needed.</p><p><strong>How do I get in?</strong><br>QR code on your phone. Scan at the door.</p><p><strong>Can I cancel?</strong><br>Free cancellation up to 2 hours before your session.</p><p><strong>Do I need an account?</strong><br>No — guest checkout available with just email + card.</p><p><strong>How long can I stay?</strong><br>24 hours from scan-in. Scan out when done.</p>');
  else if(path==='/for-gyms'||path==='/list-your-gym'||path==='/owner-benefits')page=InfoPage('For Gym Owners','<p class="text-xl text-white font-bold">Fill your empty hours. Earn more revenue.</p><p>ScanGym sends you paying customers during your quiet periods. You control:</p><p>💸 <strong>Your pricing</strong> — set in one tap from 4 tiers</p><p>⏸️ <strong>Your availability</strong> — pause bookings anytime with one toggle</p><p>📊 <strong>Your data</strong> — see bookings, revenue, ratings, peak hours</p><p>🥤 <strong>Free equipment</strong> — vending machines, QR scanners for listed gyms</p><p>🏦 <strong>Gym loans</strong> — opening finance from £10k-500k</p><p>Zero listing fee. Zero commitment. You only pay a small commission on bookings.</p><p><a onclick="navigate(\'/contact\')" class="text-brand cursor-pointer">Contact us to list your gym →</a></p>');
  else if(path==='/blog')page=InfoPage('Blog / Transformations','<p class="text-xl text-white">Real transformations. Real people. Real gyms.</p><p>Coming soon — stories from ScanGym users who found their perfect gym.</p><p>Want to share your story? <a onclick="navigate(\'/contact\')" class="text-brand cursor-pointer">Get in touch →</a></p>');
  else if(path==='/contact')page=InfoPage('Contact','<p>📧 Email: info@scangym.com</p><p>📍 Manchester, UK</p><p>📱 Instagram: @scangym</p><p>🐦 Twitter/X: @scangym</p>');
  else if(path==='/refer')page=InfoPage('Refer & Earn','<p class="text-xl text-white font-bold">£2 for you. £2 for them.</p><p>Share your referral link. When your friend books their first gym session, you both get £2 ScanGym credit.</p><p>No limit on referrals. The more you share, the more you earn.</p><p><a onclick="navigate(\'/login\')" class="text-brand cursor-pointer">Log in to get your referral link →</a></p>');
  else if(path==='/become-a-creator')page=InfoPage('Become a Creator','<p class="text-xl text-white font-bold">Join FlexSquad — ScanGym\'s Creator Program</p><p>Get your own landing page at scangym.com/r/yourname</p><p>✅ 25% commission on every booking</p><p>✅ Free gym sessions at 25+ conversions/month</p><p>✅ Featured on the creators leaderboard</p><p>✅ Marketing toolkit with 388+ assets</p><p><a onclick="navigate(\'/login\')" class="text-brand cursor-pointer">Sign up to apply →</a></p>');
  else if(path==='/privacy')page=InfoPage('Privacy Policy','<p>Last updated: May 2026</p><p>ScanGym ("we", "us") respects your privacy. We collect only what\'s needed to process bookings: name, email, phone number, payment details, and location data.</p><p>We use Stripe for payments (PCI compliant), Twilio for OTP verification, and Google Maps for gym locations.</p><p>We never sell your data. Contact: privacy@scangym.com</p>');
  else if(path==='/terms')page=InfoPage('Terms of Service','<p>Last updated: May 2026</p><p>By using ScanGym, you agree to these terms. ScanGym is a marketplace connecting gym-goers with gym owners. We are not a gym operator.</p><p>Bookings are 24-hour day passes. Free cancellation up to 2 hours before session start.</p><p>Contact: legal@scangym.com</p>');
  else if(path==='/cookies')page=InfoPage('Cookie Policy','<p>We use essential cookies for authentication and preferences. Analytics cookies help us understand usage patterns. You can disable non-essential cookies in your browser settings.</p>');
  else if(path==='/bookings'||path==='/my-bookings')page=MyBookingsPage();
  else if(path==='/booking-success')page=BookingSuccessPage();
  else if(path==='/featured')page=InfoPage('Featured Listings','<p class="text-xl text-white font-bold">Featured Gyms on ScanGym</p><p>Get your gym seen by thousands. Featured listings appear at the top of search results with a highlighted badge.</p><p>✅ Priority placement in search</p><p>✅ Featured badge on your profile</p><p>✅ 3x more profile views on average</p><p><a onclick="navigate(\'/contact\')" class="text-brand cursor-pointer">Contact us about featured listings →</a></p>');
  else if(path==='/careers')page=InfoPage('Careers at ScanGym','<p class="text-xl text-white font-bold">Join the Team</p><p>We\'re building the future of gym access in the UK. Currently a lean team based in Manchester.</p><p>Interested in working with us? Send your CV to:</p><p>📧 <strong>careers@scangym.com</strong></p>');
  else if(path==='/help')page=InfoPage('Help Center','<p class="text-xl text-white font-bold">How Can We Help?</p><p><strong>How do I book a gym?</strong><br>Search for a gym → Pick your date/time → Pay → Get your QR code.</p><p><strong>How do I cancel?</strong><br>Free cancellation up to 2 hours before your session from your bookings page.</p><p><strong>I can\'t scan my QR code</strong><br>Make sure your screen brightness is at max. If it still doesn\'t work, show the booking confirmation to staff.</p><p><strong>How do I get a refund?</strong><br>Cancelled bookings are refunded to your ScanGym Wallet instantly, or to your card within 5-10 days.</p><p>📧 Still stuck? Email <strong>support@scangym.com</strong></p>');
  else if(path==='/scan')page=InfoPage('QR Scan Entry','<p class="text-xl text-white font-bold">📱 How QR Entry Works</p><p>1. Book a gym session on ScanGym</p><p>2. Get your unique QR code instantly</p><p>3. Scan at the gym entrance to check in</p><p>4. Scan again when you leave to check out</p><p>Your 24-hour day pass is valid from the moment you scan in. No staff interaction needed — it\'s completely contactless.</p><p><a onclick="navigate(\'/explore\')" class="text-brand cursor-pointer">Find a gym to try it →</a></p>');
  else page=InfoPage('Page Not Found','<p>Sorry, this page doesn\'t exist yet.</p><p><a onclick="navigate(\'/\')" class="text-brand cursor-pointer">← Back to home</a></p>');

  document.getElementById('app').innerHTML=NavBar()+`<main class="fade-in">${page}</main>`+Footer();
}

// ─── Init ───
state.route=location.pathname;
render();

// Auto-load data based on initial route
if(state.route==='/explore'||state.route==='/nearby'){
  getLocation().then(loc=>{state.searchLat=loc.lat;state.searchLng=loc.lng;loadGyms(loc.lat,loc.lng)});
}
// Load gym profile when visiting /gym/:id directly
if(state.route.startsWith('/gym/')){
  const gymId=state.route.split('/gym/')[1];
  if(gymId)openGym(gymId,isNaN(parseInt(gymId)));
}
