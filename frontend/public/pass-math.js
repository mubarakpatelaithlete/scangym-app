/**
 * ScanGym Pass Maths — ONE implementation, used by the server and the browser.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Why this file exists
 * --------------------
 * The server charged £22.49 for a weekly pass while the pass sheet displayed
 * £22.45, because the browser multiplied the day price (4.49 × 5 = 22.45) and
 * the pricing engine multiplied *and then* charm-rounded it (22.45 → 22.49).
 * Same for Monthly (£44.90 shown / £44.99 charged), Couple (£8.08 shown /
 * £7.63 charged) and Group. A price you display must be the price you charge —
 * so multipliers, charm rounding and savings percentages live here, once, and
 * both sides import them.
 *
 * Node:    const M = require('../../frontend/public/pass-math.js');
 * Browser: <script src="/pass-math.js"></script>  →  window.SGPassMath
 *
 * Pure functions only. No I/O, no DOM, no dependencies.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SGPassMath = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Multipliers relative to one day pass. Day 1×, 3-Day 2.67×, Weekly 5×,
  // Monthly 10×, Couple 1.7× (2 people, 15% off), Group is per-person tiered.
  var PASS_MULTIPLIERS = {
    day: 1.0,
    '3day': 2.67,
    three_day: 2.67,
    weekly: 5.0,
    monthly: 10.0,
    couple: 1.7,
  };

  // Days covered by each pass — used to derive the honest "save X%" label
  // instead of hand-written marketing numbers.
  var PASS_DAYS = { day: 1, '3day': 3, three_day: 3, weekly: 7, monthly: 30, couple: 1 };

  // Couple/group discounts, mirroring routes/pricing-extended.js.
  var COUPLE_DISCOUNT = 0.15;
  function groupDiscount(size) {
    if (size >= 5) return 0.20;
    if (size >= 3) return 0.10;
    return 0;
  }

  var ZERO_DECIMAL_CURRENCIES = ['jpy', 'krw', 'vnd', 'clp', 'pyg', 'bif', 'djf',
    'gnf', 'kmf', 'mga', 'rwf', 'ugx', 'vuf', 'xaf', 'xof', 'xpf', 'isk'];

  function isZeroDecimal(currencyCode) {
    return ZERO_DECIMAL_CURRENCIES.indexOf(String(currencyCode || '').toLowerCase()) !== -1;
  }

  /** Charm-round a raw amount the way the pricing engine does (….49 / ….99). */
  function charmPrice(raw, currencyCode) {
    if (isZeroDecimal(currencyCode)) {
      if (raw >= 100000) return Math.max(Math.round(raw / 1000) * 1000 - 1, 999);
      if (raw >= 10000) return Math.max(Math.round(raw / 100) * 100 - 1, 99);
      return Math.max(Math.round(raw / 10) * 10 - 1, 9);
    }
    if (raw >= 10000) return Math.max(Math.round(raw / 100) * 100 - 1, 99);
    if (raw >= 1000) return Math.max(Math.round(raw / 10) * 10 - 1, 9);

    var whole = Math.floor(raw);
    var decimal = raw - whole;
    if (raw < 1) return 0.99;
    if (decimal < 0.25) return whole - 0.01;
    if (decimal < 0.75) return whole + 0.49;
    return whole + 0.99;
  }

  function toStripeAmount(amount, currencyCode) {
    if (isZeroDecimal(currencyCode)) return Math.round(amount);
    return Math.round(amount * 100);
  }

  function formatPrice(amount, symbol, currencyCode) {
    if (isZeroDecimal(currencyCode) || amount >= 1000) {
      return (symbol || '') + Math.round(amount).toLocaleString();
    }
    return (symbol || '') + amount.toFixed(2);
  }

  /**
   * The price of `passType` for a gym whose day pass costs `dayAmount`.
   * Identical maths to pricing-engine.calculateGymPrice() for the gym's own
   * currency, so the sheet and the Stripe charge cannot drift apart.
   *
   * @returns {{amount:number, display:string, stripeAmount:number, perDay:number,
   *            savePercent:number, passType:string}}
   */
  function passPrice(dayAmount, passType, opts) {
    opts = opts || {};
    var currencyCode = String(opts.currency || 'gbp').toLowerCase();
    var symbol = opts.symbol != null ? opts.symbol : '£';
    var type = String(passType || 'day').toLowerCase();
    var multiplier = PASS_MULTIPLIERS[type];
    if (multiplier == null) multiplier = 1.0;

    var day = Number(dayAmount);
    if (!isFinite(day) || day <= 0) return null;

    var amount = charmPrice(day * multiplier, currencyCode);
    var days = PASS_DAYS[type] || 1;

    return {
      passType: type,
      amount: amount,
      display: formatPrice(amount, symbol, currencyCode),
      stripeAmount: toStripeAmount(amount, currencyCode),
      perDay: amount / days,
      perDayDisplay: formatPrice(amount / days, symbol, currencyCode),
      savePercent: savePercent(type),
    };
  }

  /** Honest saving vs buying the same number of day passes, rounded down. */
  function savePercent(passType) {
    var type = String(passType || 'day').toLowerCase();
    if (type === 'couple') return Math.round(COUPLE_DISCOUNT * 100);
    var days = PASS_DAYS[type] || 1;
    var multiplier = PASS_MULTIPLIERS[type];
    if (multiplier == null || days <= 1) return 0;
    return Math.floor((1 - multiplier / days) * 100);
  }

  function groupPrice(dayAmount, groupSize, opts) {
    opts = opts || {};
    var currencyCode = String(opts.currency || 'gbp').toLowerCase();
    var symbol = opts.symbol != null ? opts.symbol : '£';
    var size = Math.max(2, Math.min(10, parseInt(groupSize, 10) || 2));
    var day = Number(dayAmount);
    if (!isFinite(day) || day <= 0) return null;
    var discount = groupDiscount(size);
    var perPerson = Math.round(day * (1 - discount) * 100) / 100;
    var total = Math.round(perPerson * size * 100) / 100;
    return {
      groupSize: size,
      perPerson: perPerson,
      perPersonDisplay: formatPrice(perPerson, symbol, currencyCode),
      total: total,
      display: formatPrice(total, symbol, currencyCode),
      savePercent: Math.round(discount * 100),
    };
  }

  return {
    PASS_MULTIPLIERS: PASS_MULTIPLIERS,
    PASS_DAYS: PASS_DAYS,
    COUPLE_DISCOUNT: COUPLE_DISCOUNT,
    ZERO_DECIMAL_CURRENCIES: ZERO_DECIMAL_CURRENCIES,
    isZeroDecimal: isZeroDecimal,
    charmPrice: charmPrice,
    toStripeAmount: toStripeAmount,
    formatPrice: formatPrice,
    passPrice: passPrice,
    savePercent: savePercent,
    groupDiscount: groupDiscount,
    groupPrice: groupPrice,
  };
});
