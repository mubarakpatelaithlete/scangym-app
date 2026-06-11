/**
 * ScanGym Pricing Engine v4.0 — Clean Slate
 * ═══════════════════════════════════════════
 *
 * ONE price: £4.49 GBP base
 * PPP-adjusted + currency-converted by the gym's physical country.
 *
 * Pass tiers (multiplied from the PPP-adjusted day price):
 *   Day     1.0×
 *   3-Day   2.67× (11 % discount/day)
 *   Weekly  5.0×  (29 % discount/day)
 *   Monthly 10.0× (67 % discount/day)
 *
 * Integration:
 *   const pricing = require('./lib/pricing-engine');
 *   const p = pricing.calculatePrice({ countryCode: 'IN', passType: 'day' });
 *   // → { amount: 83, currency: 'inr', symbol: '₹', display: '₹83', stripeAmount: 8300 }
 */

// ============================================================================
// BASE PRICE (UK anchor — the single source of truth)
// ============================================================================
const BASE_PRICE_GBP = 4.49;

// ============================================================================
// PASS MULTIPLIERS (relative to single day pass)
// ============================================================================
const PASS_MULTIPLIERS = {
  day: 1.0,
  '3day': 2.67,      // 3 days for 2.67× (11 % discount / day)
  three_day: 2.67,
  weekly: 5.0,        // 7 days for 5× (29 % discount / day)
  monthly: 10.0,      // 30 days for 10× (67 % discount / day)
};

// ============================================================================
// COUNTRY PRICING DATA — 99 countries, each with local currency + PPP
//
// pppFactor : Purchasing-Power-Parity relative to UK (1.00 = same)
// currencyCode : ISO 4217 lowercase
// symbol : Display symbol / prefix
// fxRate : Units of local currency per 1 USD (approximate)
// ============================================================================
const COUNTRY_PRICING = {
  // ── Western Europe & Anglosphere ──
  GB: { pppFactor: 1.00, currencyCode: 'gbp', symbol: '£', fxRate: 0.79 },
  US: { pppFactor: 0.99, currencyCode: 'usd', symbol: '$', fxRate: 1.00 },
  CA: { pppFactor: 0.91, currencyCode: 'cad', symbol: 'C$', fxRate: 1.38 },
  AU: { pppFactor: 1.04, currencyCode: 'aud', symbol: 'A$', fxRate: 1.55 },
  NZ: { pppFactor: 0.81, currencyCode: 'nzd', symbol: 'NZ$', fxRate: 1.68 },

  // ── Europe — Eurozone ──
  DE: { pppFactor: 0.90, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  FR: { pppFactor: 0.89, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  ES: { pppFactor: 0.69, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  IT: { pppFactor: 0.73, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  NL: { pppFactor: 0.89, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  BE: { pppFactor: 0.83, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  AT: { pppFactor: 0.85, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  PT: { pppFactor: 0.58, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  IE: { pppFactor: 0.94, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  GR: { pppFactor: 0.50, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  FI: { pppFactor: 0.86, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  HR: { pppFactor: 0.42, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  EE: { pppFactor: 0.55, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  LT: { pppFactor: 0.48, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  LV: { pppFactor: 0.46, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  SK: { pppFactor: 0.50, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  SI: { pppFactor: 0.58, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  CY: { pppFactor: 0.62, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  MT: { pppFactor: 0.65, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },
  LU: { pppFactor: 1.10, currencyCode: 'eur', symbol: '€', fxRate: 0.92 },

  // ── Europe — Non-Eurozone ──
  CH: { pppFactor: 1.45, currencyCode: 'chf', symbol: 'CHF ', fxRate: 0.88 },
  SE: { pppFactor: 0.88, currencyCode: 'sek', symbol: 'kr', fxRate: 10.85 },
  NO: { pppFactor: 1.10, currencyCode: 'nok', symbol: 'kr', fxRate: 10.75 },
  DK: { pppFactor: 0.96, currencyCode: 'dkk', symbol: 'kr', fxRate: 6.90 },
  PL: { pppFactor: 0.43, currencyCode: 'pln', symbol: 'zł', fxRate: 4.05 },
  CZ: { pppFactor: 0.48, currencyCode: 'czk', symbol: 'Kč', fxRate: 23.50 },
  RO: { pppFactor: 0.33, currencyCode: 'ron', symbol: 'lei', fxRate: 4.65 },
  HU: { pppFactor: 0.38, currencyCode: 'huf', symbol: 'Ft', fxRate: 375.0 },
  BG: { pppFactor: 0.27, currencyCode: 'bgn', symbol: 'лв', fxRate: 1.80 },
  IS: { pppFactor: 1.05, currencyCode: 'isk', symbol: 'kr', fxRate: 138.0 },
  RS: { pppFactor: 0.30, currencyCode: 'rsd', symbol: 'din', fxRate: 108.0 },
  UA: { pppFactor: 0.18, currencyCode: 'uah', symbol: '₴', fxRate: 41.0 },
  GE: { pppFactor: 0.25, currencyCode: 'gel', symbol: '₾', fxRate: 2.70 },

  // ── Middle East ──
  AE: { pppFactor: 0.95, currencyCode: 'aed', symbol: 'AED ', fxRate: 3.67 },
  SA: { pppFactor: 0.65, currencyCode: 'sar', symbol: 'SAR ', fxRate: 3.75 },
  QA: { pppFactor: 1.05, currencyCode: 'qar', symbol: 'QAR ', fxRate: 3.64 },
  KW: { pppFactor: 0.85, currencyCode: 'kwd', symbol: 'KD ', fxRate: 0.31 },
  BH: { pppFactor: 0.70, currencyCode: 'bhd', symbol: 'BD ', fxRate: 0.376 },
  OM: { pppFactor: 0.60, currencyCode: 'omr', symbol: 'OMR ', fxRate: 0.385 },
  IL: { pppFactor: 0.90, currencyCode: 'ils', symbol: '₪', fxRate: 3.65 },
  TR: { pppFactor: 0.25, currencyCode: 'try', symbol: '₺', fxRate: 32.50 },
  JO: { pppFactor: 0.50, currencyCode: 'jod', symbol: 'JD ', fxRate: 0.71 },

  // ── Asia ──
  JP: { pppFactor: 0.72, currencyCode: 'jpy', symbol: '¥', fxRate: 157.0 },
  KR: { pppFactor: 0.63, currencyCode: 'krw', symbol: '₩', fxRate: 1350.0 },
  IN: { pppFactor: 0.22, currencyCode: 'inr', symbol: '₹', fxRate: 83.5 },
  SG: { pppFactor: 0.95, currencyCode: 'sgd', symbol: 'S$', fxRate: 1.35 },
  HK: { pppFactor: 0.85, currencyCode: 'hkd', symbol: 'HK$', fxRate: 7.82 },
  TH: { pppFactor: 0.30, currencyCode: 'thb', symbol: '฿', fxRate: 35.5 },
  MY: { pppFactor: 0.28, currencyCode: 'myr', symbol: 'RM', fxRate: 4.72 },
  PH: { pppFactor: 0.20, currencyCode: 'php', symbol: '₱', fxRate: 56.5 },
  VN: { pppFactor: 0.18, currencyCode: 'vnd', symbol: '₫', fxRate: 25400.0 },
  ID: { pppFactor: 0.20, currencyCode: 'idr', symbol: 'Rp', fxRate: 15700.0 },
  CN: { pppFactor: 0.35, currencyCode: 'cny', symbol: '¥', fxRate: 7.25 },
  TW: { pppFactor: 0.50, currencyCode: 'twd', symbol: 'NT$', fxRate: 31.5 },
  PK: { pppFactor: 0.15, currencyCode: 'pkr', symbol: 'Rs', fxRate: 278.0 },
  BD: { pppFactor: 0.12, currencyCode: 'bdt', symbol: '৳', fxRate: 110.0 },
  LK: { pppFactor: 0.18, currencyCode: 'lkr', symbol: 'Rs', fxRate: 320.0 },
  NP: { pppFactor: 0.10, currencyCode: 'npr', symbol: 'Rs', fxRate: 133.0 },
  MM: { pppFactor: 0.10, currencyCode: 'mmk', symbol: 'K', fxRate: 2100.0 },
  KH: { pppFactor: 0.12, currencyCode: 'khr', symbol: '៛', fxRate: 4100.0 },

  // ── Americas ──
  MX: { pppFactor: 0.35, currencyCode: 'mxn', symbol: 'MX$', fxRate: 17.15 },
  BR: { pppFactor: 0.30, currencyCode: 'brl', symbol: 'R$', fxRate: 5.05 },
  AR: { pppFactor: 0.18, currencyCode: 'ars', symbol: 'AR$', fxRate: 870.0 },
  CO: { pppFactor: 0.22, currencyCode: 'cop', symbol: 'COL$', fxRate: 4050.0 },
  CL: { pppFactor: 0.38, currencyCode: 'clp', symbol: 'CL$', fxRate: 925.0 },
  PE: { pppFactor: 0.22, currencyCode: 'pen', symbol: 'S/', fxRate: 3.75 },
  CR: { pppFactor: 0.35, currencyCode: 'crc', symbol: '₡', fxRate: 520.0 },
  PA: { pppFactor: 0.40, currencyCode: 'usd', symbol: '$', fxRate: 1.00 },
  EC: { pppFactor: 0.25, currencyCode: 'usd', symbol: '$', fxRate: 1.00 },
  DO: { pppFactor: 0.28, currencyCode: 'dop', symbol: 'RD$', fxRate: 58.5 },
  UY: { pppFactor: 0.42, currencyCode: 'uyu', symbol: '$U', fxRate: 39.5 },
  TT: { pppFactor: 0.45, currencyCode: 'ttd', symbol: 'TT$', fxRate: 6.80 },
  JM: { pppFactor: 0.22, currencyCode: 'jmd', symbol: 'J$', fxRate: 155.0 },

  // ── Africa ──
  ZA: { pppFactor: 0.33, currencyCode: 'zar', symbol: 'R', fxRate: 18.50 },
  NG: { pppFactor: 0.12, currencyCode: 'ngn', symbol: '₦', fxRate: 1550.0 },
  EG: { pppFactor: 0.15, currencyCode: 'egp', symbol: 'E£', fxRate: 48.50 },
  KE: { pppFactor: 0.15, currencyCode: 'kes', symbol: 'KSh', fxRate: 153.0 },
  MA: { pppFactor: 0.25, currencyCode: 'mad', symbol: 'MAD ', fxRate: 10.0 },
  GH: { pppFactor: 0.12, currencyCode: 'ghs', symbol: 'GH₵', fxRate: 15.0 },
  TZ: { pppFactor: 0.10, currencyCode: 'tzs', symbol: 'TSh', fxRate: 2650.0 },
  ET: { pppFactor: 0.08, currencyCode: 'etb', symbol: 'Br', fxRate: 56.5 },
  UG: { pppFactor: 0.10, currencyCode: 'ugx', symbol: 'USh', fxRate: 3750.0 },
  RW: { pppFactor: 0.10, currencyCode: 'rwf', symbol: 'RF', fxRate: 1280.0 },
  SN: { pppFactor: 0.12, currencyCode: 'xof', symbol: 'CFA', fxRate: 605.0 },
  CI: { pppFactor: 0.12, currencyCode: 'xof', symbol: 'CFA', fxRate: 605.0 },
  CM: { pppFactor: 0.10, currencyCode: 'xaf', symbol: 'FCFA', fxRate: 605.0 },
  TN: { pppFactor: 0.22, currencyCode: 'tnd', symbol: 'DT', fxRate: 3.12 },
  MU: { pppFactor: 0.30, currencyCode: 'mur', symbol: 'Rs', fxRate: 45.0 },

  // ── Central Asia & Caucasus ──
  KZ: { pppFactor: 0.25, currencyCode: 'kzt', symbol: '₸', fxRate: 460.0 },
  UZ: { pppFactor: 0.12, currencyCode: 'uzs', symbol: 'сўм', fxRate: 12500.0 },
  AZ: { pppFactor: 0.22, currencyCode: 'azn', symbol: '₼', fxRate: 1.70 },

  // ── Caribbean & Central America ──
  GT: { pppFactor: 0.20, currencyCode: 'gtq', symbol: 'Q', fxRate: 7.80 },
  HN: { pppFactor: 0.15, currencyCode: 'hnl', symbol: 'L', fxRate: 24.8 },

  // ── Oceania ──
  FJ: { pppFactor: 0.35, currencyCode: 'fjd', symbol: 'FJ$', fxRate: 2.25 },
};

// ============================================================================
// ZERO-DECIMAL CURRENCIES — Stripe sends amount as-is (not in cents/pence)
// ============================================================================
const ZERO_DECIMAL_CURRENCIES = new Set([
  'jpy', 'krw', 'vnd', 'clp', 'pyg', 'bif', 'djf', 'gnf', 'kmf',
  'mga', 'rwf', 'ugx', 'vuf', 'xaf', 'xof', 'xpf', 'isk',
]);

// ============================================================================
// STRIPE PRICE ID MAP — Pre-created localized prices (15 high-volume currencies)
// For all other currencies, dynamic price_data is used at checkout.
// ============================================================================
const STRIPE_PRICE_MAP = {
  gbp: {
    day:     'price_1TeFYTDPbSptA7HKH9vW2rAx',
    '3day':  'price_1TeGEnDPbSptA7HKZLNFeAdx',
    weekly:  'price_1TeFY5DPbSptA7HKFrM2r2nW',
    monthly: 'price_1TeFYQDPbSptA7HKbr3bGKBY',
  },
  usd: {
    day:     'price_1TeFYbDPbSptA7HKQDWqzqoA',
    '3day':  'price_1TeGEpDPbSptA7HKL0WaYG9y',
    weekly:  'price_1TeFYiDPbSptA7HKgVbxXp6b',
    monthly: 'price_1TeFYqDPbSptA7HKKWlJjIxO',
  },
  eur: {
    day:     'price_1TeFYyDPbSptA7HKd9GHuQ7X',
    '3day':  'price_1TeGEsDPbSptA7HKFBxgv4MB',
    weekly:  'price_1TeFZ6DPbSptA7HKwmm9y1ug',
    monthly: 'price_1TeFZEDPbSptA7HKuQc20tAV',
  },
  aud: {
    day:     'price_1TeFZJDPbSptA7HKhSCFDSBQ',
    '3day':  'price_1TeGEsDPbSptA7HKrwsXGCBy',
    weekly:  'price_1TeFZMDPbSptA7HK80f0o1Xl',
    monthly: 'price_1TeFZQDPbSptA7HKlf4DdlPO',
  },
  cad: {
    day:     'price_1TeFZTDPbSptA7HKzV9BT5zX',
    '3day':  'price_1TeGEvDPbSptA7HKLkpkAjAs',
    weekly:  'price_1TeFZVDPbSptA7HKWRlVp8nI',
    monthly: 'price_1TeFZXDPbSptA7HKOvjKP2P1',
  },
  jpy: {
    day:     'price_1TeFjkDPbSptA7HKiVMbCQdx',
    '3day':  'price_1TeGExDPbSptA7HK8MM1dWzQ',
    weekly:  'price_1TeFjoDPbSptA7HKqWwLABjz',
    monthly: 'price_1TeFjsDPbSptA7HKOlNWk0pJ',
  },
  inr: {
    day:     'price_1TeFk5DPbSptA7HKCcj8b2A2',
    '3day':  'price_1TeGEyDPbSptA7HKbXfBP5nM',
    weekly:  'price_1TeFkADPbSptA7HK4bvUWipj',
    monthly: 'price_1TeFkBDPbSptA7HKaQkXBGwA',
  },
  brl: {
    day:     'price_1TeFkFDPbSptA7HKMzQI8UrC',
    '3day':  'price_1TeGF1DPbSptA7HKVOlEqKyG',
    weekly:  'price_1TeFkHDPbSptA7HKYgKg47xl',
    monthly: 'price_1TeFkIDPbSptA7HKk2sHJOnA',
  },
  mxn: {
    day:     'price_1TeFkPDPbSptA7HK60ezMgr5',
    '3day':  'price_1TeGF0DPbSptA7HKgYqjz5Po',
    weekly:  'price_1TeFkMDPbSptA7HKzONJaB9L',
    monthly: 'price_1TeFkODPbSptA7HK9kNiDpRS',
  },
  aed: {
    day:     'price_1TeFkPDPbSptA7HKC3Rj42kL',
    '3day':  'price_1TeGF4DPbSptA7HKPmugFYIZ',
    weekly:  'price_1TeFkTDPbSptA7HKJzTLGuBJ',
    monthly: 'price_1TeFkhDPbSptA7HKGqwbJmLF',
  },
  sgd: {
    day:     'price_1TeFkhDPbSptA7HKBT6OIRTc',
    '3day':  'price_1TeGF4DPbSptA7HKfVkYvnh3',
    weekly:  'price_1TeFkkDPbSptA7HKU9nmUlut',
    monthly: 'price_1TeFknDPbSptA7HKfnT1PE2L',
  },
  zar: {
    day:     'price_1TeFkoDPbSptA7HKPvt5XuvB',
    '3day':  'price_1TeGF7DPbSptA7HKAMVIzweE',
    weekly:  'price_1TeFkqDPbSptA7HKuMLUqAcs',
    monthly: 'price_1TeFkrDPbSptA7HKibFJrevq',
  },
  pln: {
    day:     'price_1TeFktDPbSptA7HKRJU4Evii',
    '3day':  'price_1TeGFBDPbSptA7HKLtt6AsBy',
    weekly:  'price_1TeFkvDPbSptA7HK3pJ2GPao',
    monthly: 'price_1TeFkwDPbSptA7HKHcKghbHP',
  },
  nzd: {
    day:     'price_1TeFlEDPbSptA7HKlYTkVWEE',
    '3day':  'price_1TeGFCDPbSptA7HKpenGdFU1',
    weekly:  'price_1TeFlFDPbSptA7HKCyMyjmVU',
    monthly: 'price_1TeFlGDPbSptA7HKQrZaB3T2',
  },
  chf: {
    day:     'price_1TeFlQDPbSptA7HK4JZ1MH0f',
    '3day':  'price_1TeGFDDPbSptA7HKNPu1Ix9O',
    weekly:  'price_1TeFlKDPbSptA7HKP9GCzKxS',
    monthly: 'price_1TeFlSDPbSptA7HKUcsqsvil',
  },
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Apply charm pricing — make price end in .99 or .49 (or nice round for large)
 */
function charmPrice(raw, currencyCode) {
  if (ZERO_DECIMAL_CURRENCIES.has(currencyCode)) {
    if (raw >= 100000) return Math.max(Math.round(raw / 1000) * 1000 - 1, 999);
    if (raw >= 10000)  return Math.max(Math.round(raw / 100) * 100 - 1, 99);
    return Math.max(Math.round(raw / 10) * 10 - 1, 9);
  }
  if (raw >= 10000) return Math.max(Math.round(raw / 100) * 100 - 1, 99);
  if (raw >= 1000)  return Math.max(Math.round(raw / 10) * 10 - 1, 9);

  const whole = Math.floor(raw);
  const decimal = raw - whole;
  if (raw < 1) return 0.99;
  if (decimal < 0.25) return whole - 0.01;
  if (decimal < 0.75) return whole + 0.49;
  return whole + 0.99;
}

/**
 * Convert a price to Stripe's smallest currency unit
 */
function toStripeAmount(amount, currencyCode) {
  if (ZERO_DECIMAL_CURRENCIES.has(currencyCode)) return Math.round(amount);
  return Math.round(amount * 100);
}

/**
 * Main pricing function — ONE source of truth.
 *
 * @param {Object} params
 * @param {string} params.countryCode — ISO 3166-1 alpha-2 (gym's country)
 * @param {string} [params.passType]  — 'day' | '3day' | 'weekly' | 'monthly'
 * @returns {Object} { amount, currency, symbol, display, stripeAmount, countryCode, passType }
 */
function calculatePrice({ countryCode = 'GB', passType = 'day' } = {}) {
  const cc = (countryCode || 'GB').toUpperCase();
  const country = COUNTRY_PRICING[cc] || COUNTRY_PRICING.GB;

  const passMultiplier = PASS_MULTIPLIERS[passType] || 1.0;

  // £4.49 GBP → USD base → PPP-adjust → FX to local currency → pass multiplier
  const baseInUSD = BASE_PRICE_GBP / (COUNTRY_PRICING.GB.fxRate); // ~$5.68
  const rawPrice = baseInUSD * country.pppFactor * country.fxRate * passMultiplier;

  const finalPrice = charmPrice(rawPrice, country.currencyCode);
  const stripeAmount = toStripeAmount(finalPrice, country.currencyCode);

  // Format display
  let displayPrice;
  if (ZERO_DECIMAL_CURRENCIES.has(country.currencyCode) || finalPrice >= 1000) {
    displayPrice = `${country.symbol}${Math.round(finalPrice).toLocaleString()}`;
  } else {
    displayPrice = `${country.symbol}${finalPrice.toFixed(2)}`;
  }

  return {
    amount: finalPrice,
    currency: country.currencyCode,
    symbol: country.symbol,
    display: displayPrice,
    stripeAmount,
    countryCode: cc,
    passType,
  };
}

/**
 * Get pricing for all pass types for a given country.
 */
function getAllPassPrices({ countryCode = 'GB' } = {}) {
  const passTypes = ['day', '3day', 'weekly', 'monthly'];
  const result = {};
  for (const pt of passTypes) {
    result[pt] = calculatePrice({ countryCode, passType: pt });
  }
  return result;
}

/**
 * Get a pre-created Stripe Price ID (returns null for dynamic currencies).
 */
function getStripePriceId(currency, passType) {
  const cur = (currency || 'gbp').toLowerCase();
  const pass = (passType || 'day').toLowerCase();
  return STRIPE_PRICE_MAP[cur]?.[pass] || null;
}

/**
 * Build Stripe checkout line item.
 */
function buildStripeLineItem({ passType, currency, stripeAmount, gymName, description }) {
  const priceId = getStripePriceId(currency, passType);
  const PASS_NAMES = {
    day: 'ScanGym Day Pass',
    '3day': 'ScanGym 3-Day Pass',
    three_day: 'ScanGym 3-Day Pass',
    weekly: 'ScanGym Weekly Pass',
    monthly: 'ScanGym Monthly Pass',
  };
  if (priceId) return { price: priceId, quantity: 1 };
  return {
    price_data: {
      currency,
      product_data: {
        name: `${PASS_NAMES[passType] || 'ScanGym Day Pass'} — ${gymName || 'Gym'}`,
        description: description || 'Gym day pass',
      },
      unit_amount: stripeAmount,
    },
    quantity: 1,
  };
}

/**
 * Get currency info from a gym's country code.
 * Currency follows the GYM's physical location (not visitor IP).
 */
function getCurrencyForCountry(countryCode) {
  const cc = (countryCode || 'GB').toUpperCase();
  const country = COUNTRY_PRICING[cc] || COUNTRY_PRICING.GB;
  return { countryCode: cc, currency: country.currencyCode, symbol: country.symbol };
}

/**
 * Get the day-pass price for a gym's country (convenience helper).
 * Used by booking.js / payment.js instead of reading day_pass_price from DB.
 */
function getDayPassPrice(countryCode) {
  return calculatePrice({ countryCode, passType: 'day' });
}

/**
 * C6 FIX: Calculate price respecting owner-set gym prices.
 *
 * If the gym owner has set a custom day_pass_price (stored in GBP in the DB),
 * use that as the base instead of £4.49. Currency conversion still applies
 * (GBP → local via FX), but PPP is skipped since the owner chose the price.
 *
 * @param {Object} params
 * @param {number|null} params.gymDayPassPrice - Owner-set price in GBP (from gyms.day_pass_price), or null/0 for default
 * @param {string}      params.countryCode     - Gym's country (ISO alpha-2)
 * @param {string}      [params.passType]      - 'day' | '3day' | 'weekly' | 'monthly'
 * @returns {Object} { amount, currency, symbol, display, stripeAmount, countryCode, passType, source }
 */
function calculateGymPrice({ gymDayPassPrice, countryCode = 'GB', passType = 'day' } = {}) {
  // No owner price → standard PPP calculation
  if (!gymDayPassPrice || gymDayPassPrice <= 0) {
    const result = calculatePrice({ countryCode, passType });
    result.source = 'ppp_default';
    return result;
  }

  // Owner set a price — use it as the GBP base
  const cc = (countryCode || 'GB').toUpperCase();
  const country = COUNTRY_PRICING[cc] || COUNTRY_PRICING.GB;
  const passMultiplier = PASS_MULTIPLIERS[passType] || 1.0;

  // Convert owner's GBP price to local currency (skip PPP — owner chose this price)
  const baseInUSD = gymDayPassPrice / COUNTRY_PRICING.GB.fxRate;
  const rawPrice = baseInUSD * country.fxRate * passMultiplier;

  const finalPrice = charmPrice(rawPrice, country.currencyCode);
  const stripeAmount = toStripeAmount(finalPrice, country.currencyCode);

  let displayPrice;
  if (ZERO_DECIMAL_CURRENCIES.has(country.currencyCode) || finalPrice >= 1000) {
    displayPrice = `${country.symbol}${Math.round(finalPrice).toLocaleString()}`;
  } else {
    displayPrice = `${country.symbol}${finalPrice.toFixed(2)}`;
  }

  return {
    amount: finalPrice,
    currency: country.currencyCode,
    symbol: country.symbol,
    display: displayPrice,
    stripeAmount,
    countryCode: cc,
    passType,
    source: 'owner_price',
  };
}

/**
 * C6 FIX: Get all pass prices respecting owner-set gym price.
 */
function getAllGymPassPrices({ gymDayPassPrice, countryCode = 'GB' } = {}) {
  const passTypes = ['day', '3day', 'weekly', 'monthly'];
  const result = {};
  for (const pt of passTypes) {
    result[pt] = calculateGymPrice({ gymDayPassPrice, countryCode, passType: pt });
  }
  return result;
}

// ============================================================================
module.exports = {
  calculatePrice,
  calculateGymPrice,
  getAllPassPrices,
  getAllGymPassPrices,
  getStripePriceId,
  buildStripeLineItem,
  getCurrencyForCountry,
  getDayPassPrice,
  charmPrice,
  toStripeAmount,
  COUNTRY_PRICING,
  STRIPE_PRICE_MAP,
  ZERO_DECIMAL_CURRENCIES,
  PASS_MULTIPLIERS,
  BASE_PRICE_GBP,
};
