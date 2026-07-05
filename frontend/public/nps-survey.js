/**
 * NPS Survey — collects Net Promoter Score after a completed booking.
 *
 * Why: the Admin Dashboard has an NPS card and POST /api/stats/nps exists,
 * but nothing ever collected responses, so NPS was always empty.
 *
 * Trigger: watches fetch() for successful booking/payment confirmations,
 * then shows a 0-10 survey once. Re-asks at most every 90 days (also
 * enforced server-side). Also increments the booking counter used by
 * rate-us.js (which previously was never incremented).
 */
(function () {
  'use strict';

  var NPS_ASKED_KEY = 'scangym_nps_asked_at';
  var BOOKING_COUNT_KEY = 'scangym_booking_count';
  var ASK_COOLDOWN_DAYS = 90;
  var SHOW_DELAY_MS = 4000;

  var CONFIRM_ENDPOINTS = [
    '/api/payment/confirm',      // covers /confirm, /confirm-sca, /confirm-*
    '/api/payment/quick',
    '/api/payment/first-free',
    '/api/bookings',             // wallet / direct booking flows (POST)
  ];

  function askedRecently() {
    var t = parseInt(localStorage.getItem(NPS_ASKED_KEY) || '0', 10);
    return t && (Date.now() - t) < ASK_COOLDOWN_DAYS * 86400000;
  }

  function bumpBookingCount() {
    try {
      var n = parseInt(localStorage.getItem(BOOKING_COUNT_KEY) || '0', 10) + 1;
      localStorage.setItem(BOOKING_COUNT_KEY, String(n));
    } catch (e) { /* private mode */ }
  }

  function isConfirmCall(url, method) {
    if (!url || (method || 'GET').toUpperCase() !== 'POST') return false;
    for (var i = 0; i < CONFIRM_ENDPOINTS.length; i++) {
      if (url.indexOf(CONFIRM_ENDPOINTS[i]) !== -1) return true;
    }
    return false;
  }

  function showSurvey() {
    if (document.getElementById('sg-nps-overlay')) return;
    localStorage.setItem(NPS_ASKED_KEY, String(Date.now()));

    var overlay = document.createElement('div');
    overlay.id = 'sg-nps-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:flex-end;justify-content:center';

    var scoreBtns = '';
    for (var i = 0; i <= 10; i++) {
      var bg = i <= 6 ? 'rgba(239,68,68,.15)' : i <= 8 ? 'rgba(234,179,8,.15)' : 'rgba(34,197,94,.15)';
      var clr = i <= 6 ? '#ef4444' : i <= 8 ? '#eab308' : '#22c55e';
      scoreBtns += '<button data-nps-score="' + i + '" style="flex:1;min-width:26px;background:' + bg + ';color:' + clr + ';border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 0;font-size:14px;font-weight:700;cursor:pointer">' + i + '</button>';
    }

    overlay.innerHTML =
      '<div style="background:#111;border:1px solid rgba(255,255,255,.1);border-radius:20px 20px 0 0;padding:22px;max-width:520px;width:100%">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
      + '<p style="color:#fff;font-size:16px;font-weight:800;margin:0">Quick question</p>'
      + '<button id="sg-nps-close" style="background:none;border:none;color:rgba(255,255,255,.4);font-size:20px;cursor:pointer">&times;</button>'
      + '</div>'
      + '<p style="color:rgba(255,255,255,.6);font-size:13px;margin:0 0 14px">How likely are you to recommend ScanGym to a friend? (0 = not at all, 10 = definitely)</p>'
      + '<div style="display:flex;gap:4px;flex-wrap:nowrap;overflow-x:auto">' + scoreBtns + '</div>'
      + '<div id="sg-nps-feedback-wrap" style="display:none;margin-top:12px">'
      + '<textarea id="sg-nps-feedback" placeholder="Anything we could do better? (optional)" style="width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#fff;font-size:13px;padding:10px;min-height:60px;resize:none"></textarea>'
      + '<button id="sg-nps-submit" style="width:100%;margin-top:10px;background:#FF6D00;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">Send feedback</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);

    var selectedScore = null;

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.id === 'sg-nps-close') {
        overlay.remove();
        return;
      }
      var btn = e.target.closest ? e.target.closest('[data-nps-score]') : null;
      if (btn) {
        selectedScore = parseInt(btn.getAttribute('data-nps-score'), 10);
        var all = overlay.querySelectorAll('[data-nps-score]');
        for (var j = 0; j < all.length; j++) { all[j].style.outline = 'none'; all[j].style.opacity = '.45'; }
        btn.style.opacity = '1';
        btn.style.outline = '2px solid #FF6D00';
        document.getElementById('sg-nps-feedback-wrap').style.display = 'block';
      }
      if (e.target.id === 'sg-nps-submit' && selectedScore !== null) {
        var fb = (document.getElementById('sg-nps-feedback') || {}).value || '';
        fetch('/api/stats/nps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ score: selectedScore, feedback: fb }),
        }).catch(function () {});
        overlay.innerHTML =
          '<div style="background:#111;border:1px solid rgba(255,255,255,.1);border-radius:20px 20px 0 0;padding:32px;max-width:520px;width:100%;text-align:center">'
          + '<p style="font-size:28px;margin:0 0 8px">&#128588;</p>'
          + '<p style="color:#fff;font-size:15px;font-weight:700;margin:0">Thanks for the feedback!</p>'
          + '</div>';
        setTimeout(function () { overlay.remove(); }, 1600);
      }
    });
  }

  // Watch fetch for successful booking confirmations
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    var p = origFetch.apply(this, arguments);
    if (isConfirmCall(url, method)) {
      p.then(function (resp) {
        if (resp && resp.ok) {
          bumpBookingCount();
          if (!askedRecently()) setTimeout(showSurvey, SHOW_DELAY_MS);
        }
      }).catch(function () {});
    }
    return p;
  };
})();
