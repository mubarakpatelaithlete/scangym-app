/**
 * ScanGym Shared Pricing Service
 * ═══════════════════════════════
 * Single source of truth for ALL pages (main app, reels, scansquad, scansquad-dashboard).
 * Fetches localized prices from /api/pricing/prices with GBP fallback.
 *
 * Exposes:
 *   window.__sgPricing        — raw pricing data (null until loaded)
 *   window.__sgPricingReady   — boolean
 *   window.__sgPricingCallbacks — queue for post-load callbacks
 *   sgPrice(passType)         — returns { amount, display, symbol, currency, stripeAmount }
 *   sgSymbol()                — returns currency symbol (e.g. '£')
 *   sgCommissionRange()       — returns formatted commission string (e.g. '~£1–£11')
 */
(function () {
  'use strict';

  // ── State ──
  window.__sgPricing = null;
  window.__sgPricingReady = false;
  window.__sgPricingCallbacks = window.__sgPricingCallbacks || [];

  // ── GBP Fallback (matches pricing-engine BASE_PRICE_GBP = 4.49) ──
  var FALLBACK = {
    location: { country: 'GB', currency: 'gbp', symbol: '£' },
    prices: {
      day:     { amount: 4.49,  display: '£4.49',  stripeAmount: 449 },
      '3day':  { amount: 11.99, display: '£11.99', stripeAmount: 1199 },
      weekly:  { amount: 22.49, display: '£22.49', stripeAmount: 2249 },
      monthly: { amount: 44.99, display: '£44.99', stripeAmount: 4499 }
    }
  };

  // ── Fetch prices ──
  // PPP FIX: Default pricing always uses gym's country (GB), not visitor IP.
  // Per-gym prices are fetched via /api/pricing/gym-price when gym overlay opens.
  // This prevents Indian visitors seeing ₹83 for UK gyms.
  function init() {
    var country = 'GB'; // ScanGym gyms are UK-based — default to GB
    var url = '/api/pricing/prices?country=' + encodeURIComponent(country);

    // Use XMLHttpRequest for widest compatibility (reels uses var/ES5)
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = 4000;
      xhr.onload = function () {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data && data.success) {
            applyPricing(data);
          } else {
            applyPricing(FALLBACK);
          }
        } catch (e) {
          applyPricing(FALLBACK);
        }
      };
      xhr.onerror = function () { applyPricing(FALLBACK); };
      xhr.ontimeout = function () { applyPricing(FALLBACK); };
      xhr.send();
    } catch (e) {
      applyPricing(FALLBACK);
    }
  }

  function applyPricing(data) {
    window.__sgPricing = data;
    window.__sgPricingReady = true;

    // Fire any queued callbacks
    var cbs = window.__sgPricingCallbacks || [];
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](data); } catch (e) {}
    }
    window.__sgPricingCallbacks = [];

    // Update any data-sg-price elements already on the page
    try {
      var els = document.querySelectorAll('[data-sg-price]');
      for (var j = 0; j < els.length; j++) {
        var pt = els[j].getAttribute('data-sg-price');
        if (data.prices && data.prices[pt]) {
          els[j].textContent = data.prices[pt].display;
        }
      }
    } catch (e) {}
  }

  // ── Public API ──

  /**
   * Get current price for a pass type.
   * @param {string} passType - 'day', '3day', 'weekly', or 'monthly'
   * @returns {{ amount: number, display: string, symbol: string, currency: string, stripeAmount: number }}
   */
  window.sgPrice = function sgPrice(passType) {
    var p = window.__sgPricing;
    if (p && p.prices && p.prices[passType]) {
      var pr = p.prices[passType];
      return {
        amount: pr.amount,
        display: pr.display,
        symbol: (p.location && p.location.symbol) || '£',
        currency: (p.location && p.location.currency) || 'gbp',
        stripeAmount: pr.stripeAmount
      };
    }
    // Fallback defaults
    var defaults = { day: 4.49, '3day': 11.99, weekly: 22.49, monthly: 44.99 };
    var amt = defaults[passType] || 4.49;
    return {
      amount: amt,
      display: '£' + amt.toFixed(2),
      symbol: '£',
      currency: 'gbp',
      stripeAmount: Math.round(amt * 100)
    };
  };

  /** Get the user's currency symbol */
  window.sgSymbol = function sgSymbol() {
    var p = window.__sgPricing;
    return (p && p.location && p.location.symbol) || '£';
  };

  /**
   * Get dynamic commission range string (25% of day pass – 25% of monthly).
   * e.g. '~£1–£11'
   */
  window.sgCommissionRange = function sgCommissionRange() {
    var sym = window.sgSymbol();
    var low = Math.floor(window.sgPrice('day').amount * 0.25);
    var high = Math.ceil(window.sgPrice('monthly').amount * 0.25);
    if (low < 1) low = 1;
    return '~' + sym + low + '–' + sym + high;
  };

  // ── Init ──
  init();
})();
