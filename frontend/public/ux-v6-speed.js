/* ═══════════════════════════════════════════════════════════════════════════
   UX V6 — ROUND 2: Faster, Easier, Better
   ═══════════════════════════════════════════════════════════════════════════
   7 improvements focused on SPEED + EASE + QUALITY:

   1. ⚡ INSTANT SEARCH — Type-ahead autocomplete with debounce (no Enter needed)
   2. 🚀 PREFETCH GYM DATA — Preload gym detail when card is in viewport
   3. 🎯 1-TAP BOOK — "Book Now" button on each gym card skips gym profile
   4. 📍 SMART GPS PROMPT — Auto-detect location on first visit silently
   5. 💫 SMOOTH PAGE TRANSITIONS — Slide/fade between pages instead of flash
   6. 🔄 PULL-TO-REFRESH — Swipe down on gym list to refresh results
   7. 📊 SKELETON SPEED — Replace loading spinner with shimmer skeletons everywhere

   Loaded AFTER all other scripts. Purely additive — no existing files modified.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';

// ═════════════════════════════════════════════════════════════════════
// FIX #1: INSTANT SEARCH — Autocomplete as you type
// ═════════════════════════════════════════════════════════════════════
// Instead of requiring Enter key, search fires after 350ms of no typing
// Shows live suggestions dropdown below the search input

var _v6CSS = document.createElement('style');
_v6CSS.id = 'ux-v6-css';
_v6CSS.textContent = [
  // Autocomplete dropdown
  '#sg-autocomplete{position:absolute;top:100%;left:0;right:0;background:rgba(15,18,28,.98);border:1px solid rgba(255,255,255,.1);border-top:none;border-radius:0 0 14px 14px;max-height:240px;overflow-y:auto;z-index:9600;display:none;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
  '#sg-autocomplete.open{display:block}',
  '.sg-ac-item{display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;transition:background .1s;border-bottom:1px solid rgba(255,255,255,.04)}',
  '.sg-ac-item:last-child{border-bottom:none}',
  '.sg-ac-item:active,.sg-ac-item:hover{background:rgba(255,109,0,.08)}',
  '.sg-ac-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}',
  '.sg-ac-text{flex:1;min-width:0}',
  '.sg-ac-name{color:#fff;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.sg-ac-sub{color:rgba(255,255,255,.4);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  // Page transitions
  '.sg-page-enter{animation:sgPageIn .25s ease-out}',
  '@keyframes sgPageIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
  // Pull to refresh
  '#sg-ptr{position:fixed;top:0;left:0;right:0;height:0;display:flex;align-items:center;justify-content:center;z-index:9999;overflow:hidden;transition:height .2s ease;background:linear-gradient(180deg,rgba(255,109,0,.1),transparent)}',
  '#sg-ptr.pulling{height:60px}',
  '#sg-ptr.refreshing{height:50px}',
  '.sg-ptr-spinner{width:24px;height:24px;border:2px solid rgba(255,109,0,.3);border-top-color:#FF6D00;border-radius:50%;animation:sgPtrSpin .6s linear infinite}',
  '@keyframes sgPtrSpin{to{transform:rotate(360deg)}}',
  // Better shimmer skeleton
  '.sg-shimmer{background:linear-gradient(90deg,rgba(255,255,255,.03) 25%,rgba(255,255,255,.06) 50%,rgba(255,255,255,.03) 75%);background-size:200% 100%;animation:sgShimmer 1.2s ease-in-out infinite;border-radius:8px}',
  '@keyframes sgShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}',
  // Quick book button
  '.sg-quick-book{position:absolute;bottom:60px;right:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;z-index:16;box-shadow:0 4px 16px rgba(34,197,94,.4);transition:all .15s;display:flex;align-items:center;gap:6px;letter-spacing:.3px}',
  '.sg-quick-book:active{transform:scale(.95)}',
  // Haptic tap feedback
  '.sg-tap{-webkit-tap-highlight-color:transparent;transition:transform .1s}',
  '.sg-tap:active{transform:scale(.97)}'
].join('\n');
document.head.appendChild(_v6CSS);


// ─── Autocomplete Search ───
var _acDebounce = null;
var _acContainer = null;

function setupAutocomplete(){
  var input = document.getElementById('sg-search-input');
  if(!input || input.dataset.v6ac) return;
  input.dataset.v6ac = '1';

  // Create autocomplete dropdown
  var wrap = input.closest('div');
  if(!wrap) return;
  wrap.style.position = 'relative';

  _acContainer = document.createElement('div');
  _acContainer.id = 'sg-autocomplete';
  wrap.appendChild(_acContainer);

  input.addEventListener('input', function(){
    var q = this.value.trim();
    if(_acDebounce) clearTimeout(_acDebounce);
    if(q.length < 2){
      _acContainer.classList.remove('open');
      return;
    }
    _acDebounce = setTimeout(function(){ _runAutocomplete(q); }, 300);
  });

  // Close on outside click
  document.addEventListener('click', function(e){
    if(_acContainer && !_acContainer.contains(e.target) && e.target !== input){
      _acContainer.classList.remove('open');
    }
  });
}

async function _runAutocomplete(query){
  if(!_acContainer) return;

  // Build suggestions from:
  // 1. Recent searches (instant)
  // 2. Trending cities (instant)
  // 3. Live API if query is long enough

  var suggestions = [];

  // Recent searches that match
  try{
    var history = JSON.parse(localStorage.getItem('sg_search_history') || '[]');
    history.forEach(function(s){
      if(s.toLowerCase().indexOf(query.toLowerCase()) !== -1){
        suggestions.push({ name: s, sub: 'Recent search', icon: '🕐', bg: 'rgba(255,109,0,.1)', type: 'history' });
      }
    });
  }catch(e){}

  // Trending cities that match
  var cities = ['London, UK','Manchester, UK','Birmingham, UK','Bolton, UK','Dubai, UAE','New York, US','Barcelona, Spain','Berlin, Germany','Paris, France','Tokyo, Japan','Sydney, Australia','Los Angeles, US','Toronto, Canada','Mumbai, India','Singapore'];
  cities.forEach(function(c){
    if(c.toLowerCase().indexOf(query.toLowerCase()) !== -1){
      suggestions.push({ name: c, sub: 'Trending city', icon: '🔥', bg: 'rgba(239,68,68,.1)', type: 'city' });
    }
  });

  // Gym name matches from current loaded gyms
  if(typeof state !== 'undefined' && state.gyms && state.gyms.length > 0){
    state.gyms.forEach(function(g){
      if(g.name && g.name.toLowerCase().indexOf(query.toLowerCase()) !== -1){
        suggestions.push({
          name: g.name,
          sub: g.address || g.vicinity || 'Nearby',
          icon: '🏋️',
          bg: 'rgba(34,197,94,.1)',
          type: 'gym',
          gymId: g.placeId || g.place_id || g.id
        });
      }
    });
  }

  // Limit to 6 suggestions
  suggestions = suggestions.slice(0, 6);

  if(suggestions.length === 0){
    // Show "Search for X" as the only option
    suggestions.push({ name: 'Search for "' + query + '"', sub: 'Press enter or tap to search', icon: '🔍', bg: 'rgba(255,255,255,.05)', type: 'search', query: query });
  }

  // Render
  _acContainer.innerHTML = suggestions.map(function(s){
    var onclick = '';
    if(s.type === 'gym' && s.gymId){
      onclick = 'openGym(\'' + s.gymId + '\',true);document.getElementById(\'sg-search-overlay\').classList.remove(\'active\');setTimeout(function(){document.getElementById(\'sg-search-overlay\').style.display=\'none\'},200)';
    } else {
      var sq = s.query || (s.name + ' gyms');
      onclick = 'searchGyms(\'' + sq.replace(/'/g, "\\'") + '\',true);navigate(\'/explore\');document.getElementById(\'sg-search-overlay\').classList.remove(\'active\');setTimeout(function(){document.getElementById(\'sg-search-overlay\').style.display=\'none\'},200)';
    }
    return '<div class="sg-ac-item" onclick="' + onclick + '">'
      + '<div class="sg-ac-icon" style="background:' + s.bg + '">' + s.icon + '</div>'
      + '<div class="sg-ac-text"><div class="sg-ac-name">' + s.name + '</div><div class="sg-ac-sub">' + s.sub + '</div></div>'
      + '</div>';
  }).join('');
  _acContainer.classList.add('open');
}

// Watch for search overlay to appear, then setup autocomplete
setInterval(setupAutocomplete, 500);


// ═════════════════════════════════════════════════════════════════════
// FIX #2: PREFETCH GYM DATA — Preload the next gym while browsing
// ═════════════════════════════════════════════════════════════════════
// When a gym card is visible for >500ms, preload its Place API data
// so tapping it opens instantly

var _prefetchCache = {};
var _prefetchQueue = new Set();

function prefetchGym(gymId){
  if(!gymId || _prefetchCache[gymId] || _prefetchQueue.has(gymId)) return;
  _prefetchQueue.add(gymId);

  // Only prefetch if on wifi or fast connection
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if(conn && conn.saveData) return;

  setTimeout(function(){
    if(_prefetchCache[gymId]) return;
    // /api/gyms/place/:id and /api/gym/:id never existed on the server (they returned
    // index.html, so every prefetch silently failed). The real endpoint is
    // /api/live/place/:placeId, which returns the {gym, photos, rating, pricing} shape
    // used below. Numeric DB ids have no equivalent, so we simply skip prefetching them —
    // prefetch is an optimisation, the normal openGym path still works.
    var isPlaceId = isNaN(parseInt(gymId));
    if(!isPlaceId){ _prefetchQueue.delete(gymId); return; }
    fetch('/api/live/place/' + encodeURIComponent(gymId), { credentials: 'include' })
      .then(function(r){
        if(!r.ok) throw new Error('prefetch failed: ' + r.status);
        return r.json();
      })
      .then(function(d){
        _prefetchCache[gymId] = d;
        _prefetchQueue.delete(gymId);
      })
      .catch(function(){ _prefetchQueue.delete(gymId); });
  }, 200);
}

// Hook into openGym to use prefetched data
var _origOpenGym = window.openGym;
if(_origOpenGym){
  window.openGym = async function(id, isLive){
    var cached = _prefetchCache[id];
    if(cached && cached.gym){
      navigate('/gym/' + id);
      state.currentGym = {
        ...cached.gym,
        id: cached.gym.dbId || cached.gym.placeId,
        place_id: cached.gym.placeId,
        photo_url: cached.photos?.[0]?.url || null,
        photos_list: cached.photos || [],
        rating: cached.rating?.google || null,
        user_ratings_total: cached.rating?.googleTotal || 0,
        formatted_address: cached.gym.address,
        vicinity: cached.gym.address,
        opening_hours: cached.openingHours,
        reviews_data: cached.reviews,
        pricing: cached.pricing,
        map: cached.map,
        source: 'live',
      };
      render();
      if(state._pendingOverlay){
        var po = state._pendingOverlay; state._pendingOverlay = null;
        if(typeof openGymOverlay === 'function') openGymOverlay(po);
      }
      if(typeof _loadConvictionSignals === 'function') _loadConvictionSignals(id);
      return;
    }
    return _origOpenGym.call(window, id, isLive);
  };
}

// Observe visible gym cards and prefetch
var _cardObserver = null;
function setupCardPrefetch(){
  if(_cardObserver) return;
  if(!('IntersectionObserver' in window)) return;
  _cardObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){
        var gymId = e.target.getAttribute('data-gym-id');
        if(gymId) prefetchGym(gymId);
      }
    });
  }, { rootMargin: '200px', threshold: 0.1 });
}
setupCardPrefetch();

// Re-observe new cards when carousel renders
var _cardMO = new MutationObserver(function(){
  if(!_cardObserver) return;
  var cards = document.querySelectorAll('.tt-card[data-gym-id]');
  cards.forEach(function(card){
    if(!card.dataset.v6pf){
      card.dataset.v6pf = '1';
      _cardObserver.observe(card);
    }
  });
});
_cardMO.observe(document.body, { childList: true, subtree: true });


// ═════════════════════════════════════════════════════════════════════
// FIX #3: 1-TAP BOOK — Quick "Book Now" button on visible gym card
// ═════════════════════════════════════════════════════════════════════
// The CTA at the bottom of each TikTok card opens the gym profile.
// Add a floating "⚡ Book Now" button that jumps straight to checkout.

function injectQuickBook(){
  var carousel = document.getElementById('bm-carousel');
  if(!carousel) return;

  var cards = carousel.querySelectorAll('.tt-card[data-gym-id]');
  cards.forEach(function(card){
    if(card.querySelector('.sg-quick-book')) return;
    var gymId = card.getAttribute('data-gym-id');
    var price = card.getAttribute('data-price');
    if(!gymId) return;

    var btn = document.createElement('button');
    btn.className = 'sg-quick-book';
    btn.innerHTML = '⚡ Book ' + (price || '') ;
    btn.onclick = function(e){
      e.stopPropagation();
      // Haptic feedback
      if(navigator.vibrate) navigator.vibrate(30);
      // Open gym with booking overlay
      state._pendingOverlay = 'book';
      if(typeof openGym === 'function') openGym(gymId, true);
    };
    card.appendChild(btn);
  });
}

setInterval(injectQuickBook, 800);


// ═════════════════════════════════════════════════════════════════════
// FIX #4: SMART GPS — Auto-detect location on first visit
// ═════════════════════════════════════════════════════════════════════
// If user hasn't searched yet and we don't have GPS, try IP geolocation
// immediately (no prompt needed) so gyms load faster

(function(){
  // Location comes from the one engine (location.js / window.sgLocation), which
  // owns the cache and the GPS-permission timing. This block used to ask the
  // browser for a position itself and keep its own copy of the answer.
  setTimeout(function(){
    if(typeof state === 'undefined') return;
    if(state.gyms && state.gyms.length > 0) return;
    if(state.userExplicitSearch) return;
    if(!window.sgLocation) return;
    if(window.sgLocation.cached()) return; // we already know where we are

    window.sgLocation.get().then(function(loc){
      if(!loc) return;
      if(state.userExplicitSearch) return;
      if(state.gyms && state.gyms.length > 0) return;
      if(typeof loadGyms === 'function') loadGyms(loc.lat, loc.lng);
    }).catch(function(){});
  }, 1500);
})();


// ═════════════════════════════════════════════════════════════════════
// FIX #5: SMOOTH PAGE TRANSITIONS — Fade/slide between pages
// ═════════════════════════════════════════════════════════════════════
// After each render, add the entry animation class

var _origRender = window._renderInner;
if(!_origRender){
  // Fallback: observe the tab content for changes and animate
  var _lastRoute = '';
  setInterval(function(){
    if(typeof state === 'undefined') return;
    if(state.route === _lastRoute) return;
    _lastRoute = state.route;
    var content = document.querySelector('.sg-tab-content');
    if(!content) return;
    // Add transition class
    content.classList.remove('sg-page-enter');
    void content.offsetWidth; // force reflow
    content.classList.add('sg-page-enter');
  }, 100);
}


// ═════════════════════════════════════════════════════════════════════
// FIX #6: PULL-TO-REFRESH — Swipe down to refresh gym list
// ═════════════════════════════════════════════════════════════════════

var _ptrEl = document.createElement('div');
_ptrEl.id = 'sg-ptr';
_ptrEl.innerHTML = '<div class="sg-ptr-spinner"></div>';
document.body.appendChild(_ptrEl);

var _ptrStartY = 0;
var _ptrActive = false;
var _ptrTriggered = false;

document.addEventListener('touchstart', function(e){
  var carousel = document.getElementById('bm-carousel');
  if(!carousel) return;
  // Only enable when scrolled to top
  if(carousel.scrollTop > 5) return;
  _ptrStartY = e.touches[0].clientY;
  _ptrActive = true;
  _ptrTriggered = false;
}, { passive: true });

document.addEventListener('touchmove', function(e){
  if(!_ptrActive) return;
  var dy = e.touches[0].clientY - _ptrStartY;
  if(dy > 60 && !_ptrTriggered){
    _ptrEl.classList.add('pulling');
    _ptrTriggered = true;
  }
}, { passive: true });

document.addEventListener('touchend', function(){
  if(!_ptrActive) return;
  _ptrActive = false;
  if(_ptrTriggered){
    _ptrEl.classList.remove('pulling');
    _ptrEl.classList.add('refreshing');
    // Haptic
    if(navigator.vibrate) navigator.vibrate(20);
    // Refresh: re-run the last search
    setTimeout(function(){
      if(typeof state !== 'undefined'){
        // Clear search cache
        window._sgSearchCache = {};
        if(state.searchLat && state.searchLng){
          if(typeof loadGyms === 'function') loadGyms(state.searchLat, state.searchLng);
        } else if(state.lastSearchQuery){
          if(typeof searchGyms === 'function') searchGyms(state.lastSearchQuery, true);
        } else {
          if(typeof searchGyms === 'function') searchGyms('gyms in London', true);
        }
      }
      setTimeout(function(){
        _ptrEl.classList.remove('refreshing');
        if(typeof sgToast === 'function') sgToast('Gyms refreshed ✨', 'success', 1500);
      }, 800);
    }, 300);
  }
}, { passive: true });


// ═════════════════════════════════════════════════════════════════════
// FIX #7: SKELETON SPEED — Better loading states everywhere
// ═════════════════════════════════════════════════════════════════════
// Replace generic spinners with shimmer skeletons on gym profile loading

var _skelWatch = setInterval(function(){
  // Gym profile loading state
  var app = document.getElementById('app');
  if(!app) return;

  // Replace the default spinner on gym loading with a beautiful skeleton
  var spinner = app.querySelector('.animate-spin');
  if(spinner && state && state.route && state.route.startsWith('/gym/') && !state.currentGym){
    var parent = spinner.closest('div');
    if(parent && !parent.dataset.v6skel){
      parent.dataset.v6skel = '1';
      parent.style.padding = '0';
      parent.innerHTML = ''
        // Photo skeleton
        + '<div style="width:100%;height:38vh;position:relative">'
        + '<div class="sg-shimmer" style="position:absolute;inset:0;border-radius:0"></div>'
        + '</div>'
        // Info skeleton
        + '<div style="padding:16px">'
        + '<div class="sg-shimmer" style="width:70%;height:24px;margin-bottom:8px"></div>'
        + '<div class="sg-shimmer" style="width:50%;height:14px;margin-bottom:16px"></div>'
        + '<div style="display:flex;gap:8px;margin-bottom:16px">'
        + '<div class="sg-shimmer" style="width:60px;height:28px;border-radius:14px"></div>'
        + '<div class="sg-shimmer" style="width:80px;height:28px;border-radius:14px"></div>'
        + '<div class="sg-shimmer" style="width:50px;height:28px;border-radius:14px"></div>'
        + '</div>'
        + '<div class="sg-shimmer" style="width:100%;height:52px;border-radius:12px;margin-bottom:12px"></div>'
        + '<div class="sg-shimmer" style="width:100%;height:52px;border-radius:12px"></div>'
        + '</div>';
    }
  }
}, 200);


// ═════════════════════════════════════════════════════════════════════
// BONUS: Performance — defer non-essential work
// ═════════════════════════════════════════════════════════════════════

// Preload Google Fonts earlier (they're set to media="print" by default)
setTimeout(function(){
  var printLinks = document.querySelectorAll('link[media="print"]');
  printLinks.forEach(function(l){
    if(l.href && l.href.indexOf('fonts.googleapis') !== -1){
      l.media = 'all';
    }
  });
}, 100);

// Add resource hints for common gym photo CDNs
['https://streetviewpixels-pa.googleapis.com', 'https://maps.googleapis.com'].forEach(function(origin){
  if(!document.querySelector('link[rel="preconnect"][href="' + origin + '"]')){
    var l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = origin;
    l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
});


console.log('[UX-V6] Round 2 — 7 speed/UX improvements loaded');
})();
