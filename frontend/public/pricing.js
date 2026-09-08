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
   * Formatted price for a pass type, e.g. "£4.49".
   * Use this INSTEAD of hardcoding '£4.49' anywhere: it always resolves through the
   * single pricing source (API result, or the GBP fallback above) so the app can never
   * show two different prices or two different currency symbols for the same pass.
   * @param {string} passType - 'day', '3day', 'weekly', 'monthly'
   */
  window.sgPriceDisplay = function sgPriceDisplay(passType) {
    return window.sgPrice(passType || 'day').display;
  };

  /**
   * Numeric price for a pass type (no currency symbol), e.g. 4.49.
   * @param {string} passType - 'day', '3day', 'weekly', 'monthly'
   */
  window.sgAmount = function sgAmount(passType) {
    return window.sgPrice(passType || 'day').amount;
  };

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

  /**
   * Price of a pass for a gym with its own day-pass price.
   *
   * Never multiply a day price by hand: the server charm-rounds after
   * multiplying (4.49 × 5 = 22.45 → charged £22.49), so hand-rolled
   * multipliers put a different number on screen than on the card. This
   * uses the shared maths in /pass-math.js, which is the same code the
   * pricing engine runs server-side.
   *
   * @param {number|string} gymDayAmount - the gym's own day price (null → platform price)
   * @param {string} passType - 'day' | '3day' | 'weekly' | 'monthly' | 'couple'
   * @param {string} [symbol] - gym's currency symbol, defaults to the visitor's
   * @returns {{amount:number, display:string, perDay:number, perDayDisplay:string, savePercent:number}}
   */
  window.sgGymPass = function sgGymPass(gymDayAmount, passType, symbol) {
    var type = passType || 'day';
    var day = parseFloat(gymDayAmount);
    var M = window.SGPassMath;
    var platform = window.sgPrice(type);
    if (!M || !isFinite(day) || day <= 0) {
      var days = (M && M.PASS_DAYS[type]) || 1;
      return {
        amount: platform.amount,
        display: platform.display,
        perDay: platform.amount / days,
        perDayDisplay: platform.symbol + (platform.amount / days).toFixed(2),
        savePercent: M ? M.savePercent(type) : 0
      };
    }
    return M.passPrice(day, type, {
      currency: window.sgPrice('day').currency,
      symbol: symbol || window.sgSymbol()
    });
  };

  /** Honest "save X%" for a pass type, derived from the multipliers. */
  window.sgPassSave = function sgPassSave(passType) {
    return window.SGPassMath ? window.SGPassMath.savePercent(passType || 'day') : 0;
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
