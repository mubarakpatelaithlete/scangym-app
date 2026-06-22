/**
 * ScanGym App Patches
 * Applied after app.ctr576.js loads
 * 
 * Implements:
 *  #4  — "30 gyms in 30 days" USP messaging
 *  #5  — Anti-subscription messaging  
 *  #17 — 24/7 filter button in filter sheet
 *  #18 — Self-service entry filter button
 *  #19 — Manchester as default city
 *  #26 — Uber-style Mapbox map in gym overlay (no Google link)
 * 
 * All patches are idempotent (safe to re-run after app.js updates).
 */

(function() {
  'use strict';

  // ══ #19: Override default city from London → Manchester ══
  // Intercept searchGyms calls with London default
  var _origSearchGyms = window.searchGyms;
  if (_origSearchGyms) {
    window.searchGyms = function(query, isExplicit, triggerLayer) {
      // Replace London default with Manchester
      if (!query || query === 'gyms in London') {
        query = 'gyms in Manchester, UK';
      }
      return _origSearchGyms.call(this, query, isExplicit, triggerLayer);
    };
    console.log('[Patches] #19: searchGyms defaulting to Manchester');
  }

  // ══ #17/#18: Create filter sheet with 24/7 + Self Entry + Open Now pills ══
  function ensureFilterSheet() {
    if (document.getElementById('tt-filter-sheet')) return; // Already exists
    var fs = document.createElement('div');
    fs.id = 'tt-filter-sheet';
    fs.className = 'tt-filter-sheet';
    fs.innerHTML = 
      '<span style="font-size:10px;color:rgba(255,255,255,.4);font-weight:700;width:100%;margin-bottom:6px;display:block">FILTER GYMS</span>' +
      '<button class="sg-filter-pill" data-filter="24h" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'24h\');window.searchGyms&&searchGyms(document.getElementById(\'tt-search-real-input\')?.value||window.state?.searchQuery||\'gyms in Manchester, UK\')">⏰ 24/7 Only</button>' +
      '<button class="sg-filter-pill" data-filter="self-service" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'self-service\');window.searchGyms&&searchGyms(document.getElementById(\'tt-search-real-input\')?.value||window.state?.searchQuery||\'gyms in Manchester, UK\')">🔓 Self Entry</button>' +
      '<button class="sg-filter-pill" data-filter="open" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'open\')">🟢 Open Now</button>' +
      '<button class="sg-filter-pill" data-filter="rating" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'rating\')">⭐ 4.0+</button>' +
      '<button class="sg-filter-pill" data-filter="near" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'near\')">📍 Nearest</button>';
    document.body.appendChild(fs);
    console.log('[Patches] #17/#18: Filter sheet created');
  }

  // ══ #17/#18: Inject Filter button into gym card action column ══
  function injectFilterButton() {
    var filterBtnAdded = false;
    var injectBtn = function() {
      var actions = document.querySelector('.tt-actions');
      if (actions && !actions.querySelector('[data-filter-toggle]')) {
        var btn = document.createElement('div');
        btn.className = 'tt-action';
        btn.setAttribute('data-filter-toggle', '1');
        btn.innerHTML = '<div class="tt-action-btn" id="tt-filter-toggle-btn">⚙️</div><div class="tt-action-label">Filter</div>';
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          ensureFilterSheet();
          var fs = document.getElementById('tt-filter-sheet');
          if (fs) {
            fs.classList.toggle('open');
            var card = actions.closest('.tt-card');
            if (card && fs.parentElement !== card) card.appendChild(fs);
          }
        });
        var saveBtn = Array.from(actions.children).find(el => el.textContent.includes('Save'));
        actions.insertBefore(btn, saveBtn || null);
        filterBtnAdded = true;
        console.log('[Patches] #17/#18: Filter button injected');
      }
    };
    injectBtn();
    var observer = new MutationObserver(function() { if (!filterBtnAdded) injectBtn(); });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function() { observer.disconnect(); }, 30000);
  }

  // ══ #26: Remove external Google Maps link + add Mapbox map ══
  function patchGymOverlay() {
    var patchAddr = function(el) {
      if (el._sgMapPatched) return;
      el._sgMapPatched = true;
      el.style.cursor = 'default';
      el.removeAttribute('onclick');
      el.onclick = null;
      var dirSpan = el.querySelector('span');
      if (dirSpan && dirSpan.textContent.includes('Directions')) dirSpan.style.display = 'none';
      var gym = window.state && window.state.currentGym;
      if (!gym) return;
      var lat = gym.latitude || gym.lat;
      var lng = gym.longitude || gym.lng;
      if (!lat || !lng) return;
      var tok = window._sgMapboxToken || '';
      if (!tok) return;
      var mapDiv = document.createElement('div');
      mapDiv.style.cssText = 'margin-top:10px;border-radius:14px;overflow:hidden;height:140px;background:#1a2035;position:relative';
      var img = document.createElement('img');
      img.src = 'https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-s+FF6D00(' + lng + ',' + lat + ')/' + lng + ',' + lat + ',14,0/400x180@2x?attribution=false&logo=false&access_token=' + tok;
      img.alt = (gym.name || 'Gym') + ' location';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover';
      img.onerror = function() { mapDiv.style.display = 'none'; };
      var badge = document.createElement('div');
      badge.style.cssText = 'position:absolute;bottom:8px;left:12px;color:rgba(255,255,255,.5);font-size:9px;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8)';
      badge.textContent = '📍 ' + (gym.vicinity || gym.address || '').split(',').slice(-2).join(',').trim();
      mapDiv.appendChild(img);
      mapDiv.appendChild(badge);
      el.parentElement && el.parentElement.insertBefore(mapDiv, el.nextSibling);
      console.log('[Patches] #26: Mapbox map added for', gym.name);
    };
    var obs = new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          (node.querySelectorAll ? node.querySelectorAll('.gym-info-addr[onclick*="google.com"]') : []).forEach(patchAddr);
          if (node.classList && node.classList.contains('gym-info-addr') && (node.getAttribute('onclick')||'').includes('google.com')) patchAddr(node);
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    console.log('[Patches] #26: Google Maps link patcher active');
  }

  // ══ #4/#5: USP anti-subscription messaging ══
  function addUSPMessaging() {
    setTimeout(function() {
      if (document.getElementById('sg-usp-banner')) return;
      var banner = document.createElement('div');
      banner.id = 'sg-usp-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10500;background:linear-gradient(90deg,rgba(255,109,0,.95),rgba(230,98,0,.95));padding:6px 12px;text-align:center;font-size:11px;font-weight:700;color:#fff;display:flex;align-items:center;justify-content:center;gap:8px';
      banner.innerHTML = '🏋️ <span>30 gyms in 30 days — No subscription. Pay only when you go.</span> <span onclick="this.parentElement.style.display=\'none\'" style="opacity:.6;font-size:14px;cursor:pointer;margin-left:8px">✕</span>';
      document.body.insertBefore(banner, document.body.firstChild);
      setTimeout(function() { if(banner.parentElement){banner.style.transition='opacity 1s';banner.style.opacity='0';setTimeout(function(){banner.remove();},1000);} }, 5000);
      console.log('[Patches] #4/#5: USP banner shown');
    }, 2000);
  }

  function init() {
    ensureFilterSheet();
    injectFilterButton();
    patchGymOverlay();
    addUSPMessaging();
    console.log('[ScanGym Patches v1.0] Applied: #4 #5 #17 #18 #19 #26');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500); // Wait for app.ctr576.js to init
  }

})();
