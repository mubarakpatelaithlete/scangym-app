// ── Rate Us Prompt — Shows after 3rd booking ──
// Adds a smart "Rate ScanGym" prompt that appears after the user's 3rd successful booking.
// Detects platform and opens the correct store listing.

(function initRateUsPrompt() {
  'use strict';

  const RATE_US_KEY = 'scangym_rate_prompted';
  const BOOKING_COUNT_KEY = 'scangym_booking_count';
  const MIN_BOOKINGS = 3;

  function getBookingCount() {
    return parseInt(localStorage.getItem(BOOKING_COUNT_KEY) || '0', 10);
  }

  function hasBeenPrompted() {
    return localStorage.getItem(RATE_US_KEY) === 'true';
  }

  function detectPlatform() {
    const ua = navigator.userAgent.toLowerCase();
    if (/windows/.test(ua)) return 'microsoft';
    if (/android/.test(ua)) {
      // Check Samsung vs Google
      if (/samsung|sm-/.test(ua)) return 'samsung';
      return 'google';
    }
    if (/iphone|ipad|ipod/.test(ua)) return 'apple';
    return 'web';
  }

  function getStoreUrl(platform) {
    const urls = {
      microsoft: 'https://apps.microsoft.com/detail/9nh8vrn834dv',
      google: 'https://play.google.com/store/apps/details?id=com.scangym.app',
      samsung: 'https://galaxystore.samsung.com/detail/com.scangym.app',
      apple: 'https://scangym.com', // iOS not live yet
      web: 'https://scangym.com',
    };
    return urls[platform] || urls.web;
  }

  function showRatePrompt() {
    if (hasBeenPrompted()) return;

    const platform = detectPlatform();
    const storeUrl = getStoreUrl(platform);
    const storeName = {
      microsoft: 'Microsoft Store',
      google: 'Google Play',
      samsung: 'Galaxy Store',
      apple: 'App Store',
      web: 'our website',
    }[platform] || 'the store';

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'scangym-rate-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn 0.3s ease';

    overlay.innerHTML = `
      <div style="background:#1a1d2e;border-radius:20px;padding:32px 24px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
        <div style="font-size:48px;margin-bottom:16px">🏋️</div>
        <h2 style="color:#fff;font-size:20px;font-weight:800;margin:0 0 8px">Enjoying ScanGym?</h2>
        <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;line-height:1.5">
          You've booked ${getBookingCount()} gym sessions! If you love the app, a quick rating on ${storeName} helps us grow 🙏
        </p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button onclick="document.getElementById('scangym-rate-overlay').remove();localStorage.setItem('${RATE_US_KEY}','true')"
            style="flex:1;padding:12px;border-radius:10px;border:1px solid #334155;background:transparent;color:#94a3b8;font-size:14px;cursor:pointer;font-weight:600">
            Maybe Later
          </button>
          <a href="${storeUrl}" target="_blank" rel="noopener"
            onclick="localStorage.setItem('${RATE_US_KEY}','true');setTimeout(()=>document.getElementById('scangym-rate-overlay')?.remove(),500)"
            style="flex:1;padding:12px;border-radius:10px;background:linear-gradient(135deg,#FF6D00,#ff8533);color:#fff;font-size:14px;cursor:pointer;font-weight:700;text-decoration:none;display:flex;align-items:center;justify-content:center">
            ⭐ Rate Us
          </a>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }

  // Hook into booking success flow
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    return origFetch.apply(this, args).then(resp => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/api/bookings/') && args[1]?.method === 'POST') {
        resp.clone().json().then(data => {
          if (data.success || data.booking) {
            const count = getBookingCount() + 1;
            localStorage.setItem(BOOKING_COUNT_KEY, count.toString());
            if (count >= MIN_BOOKINGS && !hasBeenPrompted()) {
              setTimeout(showRatePrompt, 2000);
            }
          }
        }).catch(() => {});
      }
      return resp;
    });
  };

  console.log('[ScanGym] Rate Us prompt initialized (triggers after 3 bookings)');
})();