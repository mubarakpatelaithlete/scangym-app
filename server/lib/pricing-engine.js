/**
 * ScanGym Global Pricing Engine v2.0
 * ═══════════════════════════════════
 * 
 * 5-Layer Uber-style dynamic pricing:
 *   1. Country Factor  — PPP-adjusted base price per country
 *   2. City Tier       — Capital vs secondary vs small town
 *   3. Time-of-Day     — Peak / off-peak / weekend multipliers
 *   4. Demand Factor   — Real-time surge pricing (Phase 2)
 *   5. Pass Type       — Day / 3-Day / Weekly / Monthly
 *
 * Integration:
 *   const { calculatePrice, getStripePriceId, resolveCurrency } = require('./lib/pricing-engine');
 *   const price = calculatePrice({ countryCode: 'IN', city: 'Mumbai', timeSlot: 'peak', passType: 'day' });
 *   // → { amount: 79.99, currency: 'inr', symbol: '₹', display: '₹79.99', stripeAmount: 7999 }
 */

// ============================================================================
// BASE PRICES (UK anchor)
// ============================================================================
const UK_BASE_PEAK_GBP = 2.99;
const UK_BASE_OFFPEAK_GBP = 1.99;

// ============================================================================
// TIME-OF-DAY MULTIPLIERS
// ============================================================================
const TIME_FACTORS = {
  peak: 1.0,         // 6-9am, 5-9pm weekdays
  offpeak: 0.667,    // 9am-5pm, 9pm-6am weekdays  
  weekend_am: 0.85,  // Saturday/Sunday mornings
  weekend_pm: 1.0,   // Saturday/Sunday evenings
};

// ============================================================================
// CITY TIER MULTIPLIERS
// ============================================================================
const CITY_TIER_FACTORS = {
  1: 1.0,    // Capital / major metro
  2: 0.85,   // Secondary cities
  3: 0.70,   // Smaller cities / towns
};

// ============================================================================
// PASS MULTIPLIERS (relative to single day pass)
// ============================================================================
const PASS_MULTIPLIERS = {
  day: 1.0,
  '3day': 2.67,      // 3 days for 2.67x (11% discount/day)
  three_day: 2.67,
  weekly: 5.0,       // 7 days for 5x (29% discount/day)
  monthly: 10.0,     // 30 days for 10x (67% discount/day)
};

// ============================================================================
// COUNTRY PRICING DATA (99 countries, PPP-adjusted)
// ============================================================================
const COUNTRY_PRICING = {
  // WESTERN EUROPE & ANGLOSPHERE
  GB: { pppFactor: 1.00, currencyCode: 'gbp', symbol: '£', fxRate: 0.79,
    cities: { 'london': 1, 'edinburgh': 1, 'birmingham': 1, 'manchester': 2, 'leeds': 2, 'bristol': 2, 'liverpool': 2, 'glasgow': 2, 'sheffield': 2, 'newcastle': 2, 'nottingham': 2, 'cardiff': 2, 'belfast': 2 } },
  US: { pppFactor: 0.99, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'new york': 1, 'los angeles': 1, 'san francisco': 1, 'miami': 1, 'chicago': 2, 'dallas': 2, 'atlanta': 2, 'houston': 2, 'phoenix': 2, 'denver': 2, 'seattle': 2, 'boston': 2 } },
  CA: { pppFactor: 0.91, currencyCode: 'cad', symbol: 'C$', fxRate: 1.38,
    cities: { 'toronto': 1, 'vancouver': 1, 'montreal': 2, 'calgary': 2, 'ottawa': 2, 'edmonton': 2 } },
  AU: { pppFactor: 1.04, currencyCode: 'aud', symbol: 'A$', fxRate: 1.55,
    cities: { 'sydney': 1, 'melbourne': 1, 'brisbane': 2, 'perth': 2, 'adelaide': 2, 'canberra': 2 } },
  NZ: { pppFactor: 0.81, currencyCode: 'nzd', symbol: 'NZ$', fxRate: 1.68,
    cities: { 'auckland': 1, 'wellington': 1, 'christchurch': 2, 'hamilton': 2 } },
  
  // EUROPE (EUR zone)
  DE: { pppFactor: 0.90, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'berlin': 1, 'munich': 1, 'hamburg': 1, 'frankfurt': 2, 'cologne': 2, 'stuttgart': 2, 'düsseldorf': 2 } },
  FR: { pppFactor: 0.89, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'paris': 1, 'lyon': 2, 'marseille': 2, 'toulouse': 2, 'nice': 2, 'bordeaux': 2 } },
  ES: { pppFactor: 0.69, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'madrid': 1, 'barcelona': 1, 'valencia': 2, 'seville': 2, 'malaga': 2, 'bilbao': 2 } },
  IT: { pppFactor: 0.73, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'rome': 1, 'milan': 1, 'naples': 2, 'turin': 2, 'florence': 2, 'bologna': 2 } },
  NL: { pppFactor: 0.89, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'amsterdam': 1, 'rotterdam': 2, 'the hague': 2, 'utrecht': 2 } },
  BE: { pppFactor: 0.83, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'brussels': 1, 'antwerp': 2, 'ghent': 2 } },
  AT: { pppFactor: 0.85, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'vienna': 1, 'salzburg': 2, 'graz': 2, 'innsbruck': 2 } },
  PT: { pppFactor: 0.58, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'lisbon': 1, 'porto': 2, 'faro': 3 } },
  IE: { pppFactor: 0.94, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'dublin': 1, 'cork': 2, 'galway': 2, 'limerick': 2 } },
  GR: { pppFactor: 0.50, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'athens': 1, 'thessaloniki': 2, 'heraklion': 3 } },
  FI: { pppFactor: 0.86, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'helsinki': 1, 'tampere': 2, 'turku': 2 } },
  
  // EUROPE (non-EUR)
  CH: { pppFactor: 1.45, currencyCode: 'chf', symbol: 'CHF', fxRate: 0.88,
    cities: { 'zurich': 1, 'geneva': 1, 'bern': 2, 'basel': 2, 'lausanne': 2 } },
  SE: { pppFactor: 0.88, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'stockholm': 1, 'gothenburg': 2, 'malmö': 2 } },
  NO: { pppFactor: 1.10, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'oslo': 1, 'bergen': 2, 'trondheim': 2 } },
  DK: { pppFactor: 0.96, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'copenhagen': 1, 'aarhus': 2, 'odense': 2 } },
  PL: { pppFactor: 0.43, currencyCode: 'pln', symbol: 'zł', fxRate: 4.05,
    cities: { 'warsaw': 1, 'krakow': 1, 'wroclaw': 2, 'gdansk': 2, 'poznan': 2, 'lodz': 2 } },
  CZ: { pppFactor: 0.48, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'prague': 1, 'brno': 2, 'ostrava': 2 } },
  RO: { pppFactor: 0.33, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'bucharest': 1, 'cluj-napoca': 2, 'timisoara': 2 } },
  HU: { pppFactor: 0.38, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'budapest': 1, 'debrecen': 2, 'szeged': 2 } },
  HR: { pppFactor: 0.42, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'zagreb': 1, 'split': 2, 'rijeka': 2 } },
  BG: { pppFactor: 0.27, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'sofia': 1, 'plovdiv': 2, 'varna': 2 } },

  // MIDDLE EAST
  AE: { pppFactor: 0.95, currencyCode: 'aed', symbol: 'AED', fxRate: 3.67,
    cities: { 'dubai': 1, 'abu dhabi': 1, 'sharjah': 2, 'ajman': 3 } },
  SA: { pppFactor: 0.65, currencyCode: 'aed', symbol: 'AED', fxRate: 3.67,
    cities: { 'riyadh': 1, 'jeddah': 1, 'dammam': 2, 'mecca': 2 } },
  QA: { pppFactor: 1.05, currencyCode: 'aed', symbol: 'AED', fxRate: 3.67,
    cities: { 'doha': 1 } },
  KW: { pppFactor: 0.85, currencyCode: 'aed', symbol: 'AED', fxRate: 3.67,
    cities: { 'kuwait city': 1 } },
  BH: { pppFactor: 0.70, currencyCode: 'aed', symbol: 'AED', fxRate: 3.67,
    cities: { 'manama': 1 } },
  OM: { pppFactor: 0.60, currencyCode: 'aed', symbol: 'AED', fxRate: 3.67,
    cities: { 'muscat': 1 } },
  IL: { pppFactor: 0.90, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'tel aviv': 1, 'jerusalem': 1, 'haifa': 2 } },
  TR: { pppFactor: 0.25, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'istanbul': 1, 'ankara': 1, 'izmir': 2, 'antalya': 2 } },

  // ASIA
  JP: { pppFactor: 0.72, currencyCode: 'jpy', symbol: '¥', fxRate: 157.0,
    cities: { 'tokyo': 1, 'osaka': 1, 'kyoto': 2, 'yokohama': 2, 'nagoya': 2, 'fukuoka': 2, 'sapporo': 2 } },
  KR: { pppFactor: 0.63, currencyCode: 'jpy', symbol: '¥', fxRate: 157.0,
    cities: { 'seoul': 1, 'busan': 2, 'incheon': 2, 'daegu': 2 } },
  IN: { pppFactor: 0.22, currencyCode: 'inr', symbol: '₹', fxRate: 83.5,
    cities: { 'mumbai': 1, 'delhi': 1, 'bangalore': 1, 'hyderabad': 2, 'chennai': 2, 'kolkata': 2, 'pune': 2, 'ahmedabad': 2, 'jaipur': 3, 'lucknow': 3 } },
  SG: { pppFactor: 0.95, currencyCode: 'sgd', symbol: 'S$', fxRate: 1.35,
    cities: { 'singapore': 1 } },
  HK: { pppFactor: 0.85, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'hong kong': 1 } },
  TH: { pppFactor: 0.30, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'bangkok': 1, 'chiang mai': 2, 'phuket': 2, 'pattaya': 2 } },
  MY: { pppFactor: 0.28, currencyCode: 'sgd', symbol: 'S$', fxRate: 1.35,
    cities: { 'kuala lumpur': 1, 'penang': 2, 'johor bahru': 2 } },
  PH: { pppFactor: 0.20, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'manila': 1, 'cebu': 2, 'davao': 2 } },
  VN: { pppFactor: 0.18, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'ho chi minh city': 1, 'hanoi': 1, 'da nang': 2 } },
  ID: { pppFactor: 0.20, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'jakarta': 1, 'bali': 2, 'surabaya': 2, 'bandung': 2 } },
  CN: { pppFactor: 0.35, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'shanghai': 1, 'beijing': 1, 'shenzhen': 1, 'guangzhou': 2, 'chengdu': 2, 'hangzhou': 2 } },
  TW: { pppFactor: 0.50, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'taipei': 1, 'kaohsiung': 2, 'taichung': 2 } },

  // AMERICAS
  MX: { pppFactor: 0.35, currencyCode: 'mxn', symbol: 'MX$', fxRate: 17.15,
    cities: { 'mexico city': 1, 'guadalajara': 2, 'monterrey': 2, 'cancun': 2, 'puebla': 2 } },
  BR: { pppFactor: 0.30, currencyCode: 'brl', symbol: 'R$', fxRate: 5.05,
    cities: { 'são paulo': 1, 'rio de janeiro': 1, 'brasília': 2, 'salvador': 2, 'belo horizonte': 2, 'curitiba': 2, 'fortaleza': 2 } },
  AR: { pppFactor: 0.18, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'buenos aires': 1, 'córdoba': 2, 'rosario': 2, 'mendoza': 2 } },
  CO: { pppFactor: 0.22, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'bogotá': 1, 'medellín': 2, 'cali': 2, 'cartagena': 2 } },
  CL: { pppFactor: 0.38, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'santiago': 1, 'valparaíso': 2, 'concepción': 2 } },
  PE: { pppFactor: 0.22, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'lima': 1, 'arequipa': 2, 'cusco': 2 } },

  // AFRICA
  ZA: { pppFactor: 0.33, currencyCode: 'zar', symbol: 'R', fxRate: 18.50,
    cities: { 'johannesburg': 1, 'cape town': 1, 'durban': 2, 'pretoria': 2 } },
  NG: { pppFactor: 0.12, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'lagos': 1, 'abuja': 1, 'port harcourt': 2, 'kano': 3 } },
  EG: { pppFactor: 0.15, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'cairo': 1, 'alexandria': 2, 'giza': 2 } },
  KE: { pppFactor: 0.15, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'nairobi': 1, 'mombasa': 2 } },
  MA: { pppFactor: 0.25, currencyCode: 'eur', symbol: '€', fxRate: 0.92,
    cities: { 'casablanca': 1, 'marrakech': 2, 'rabat': 2 } },
  GH: { pppFactor: 0.12, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'accra': 1, 'kumasi': 2 } },
  TZ: { pppFactor: 0.10, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'dar es salaam': 1, 'dodoma': 2 } },
  ET: { pppFactor: 0.08, currencyCode: 'usd', symbol: '$', fxRate: 1.00,
    cities: { 'addis ababa': 1 } },

  // OCEANIA
  FJ: { pppFactor: 0.35, currencyCode: 'nzd', symbol: 'NZ$', fxRate: 1.68,
    cities: { 'suva': 1, 'nadi': 2 } },
};

// Zero-decimal currencies (Stripe sends amount as-is, not in cents)
const ZERO_DECIMAL_CURRENCIES = new Set(['jpy', 'krw', 'vnd', 'clp', 'pyg', 'bif', 'djf', 'gnf', 'kmf', 'mga', 'rwf', 'ugx', 'vuf', 'xaf', 'xof', 'xpf']);

// ============================================================================
// STRIPE PRICE ID MAP — Pre-created localized prices
// Maps: currency -> passType -> Stripe price ID
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
 * Determine time slot from hour of day + day of week
 * @param {Date|null} date - Current date/time (defaults to now)
 * @returns {string} 'peak' | 'offpeak' | 'weekend_am' | 'weekend_pm'
 */
function getTimeSlot(date = null) {
  const d = date || new Date();
  const hour = d.getHours();
  const day = d.getDay(); // 0=Sun, 6=Sat
  
  if (day === 0 || day === 6) {
    return hour < 14 ? 'weekend_am' : 'weekend_pm';
  }
  // Weekday peak: 6-9am, 5-9pm
  if ((hour >= 6 && hour < 9) || (hour >= 17 && hour < 21)) return 'peak';
  return 'offpeak';
}

/**
 * Resolve time slot from a time string (e.g., '14:00', 'anytime')
 * @param {string} timeStr - Time string
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {string} Time slot
 */
function resolveTimeSlot(timeStr, dateStr) {
  if (!timeStr || timeStr === 'anytime') return 'peak'; // Default to peak for anytime
  
  const hour = parseInt(timeStr.split(':')[0], 10);
  
  if (dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    if (day === 0 || day === 6) {
      return hour < 14 ? 'weekend_am' : 'weekend_pm';
    }
  }
  
  if ((hour >= 6 && hour < 9) || (hour >= 17 && hour < 21)) return 'peak';
  return 'offpeak';
}

/**
 * Get the city tier for a given city in a country
 * @param {string} countryCode - ISO 3166-1 alpha-2
 * @param {string} city - City name
 * @returns {number} 1, 2, or 3
 */
function getCityTier(countryCode, city) {
  const country = COUNTRY_PRICING[countryCode];
  if (!country || !city) return 2; // Default to tier 2
  
  const cityLower = city.toLowerCase().trim();
  
  // Direct match
  if (country.cities[cityLower] !== undefined) return country.cities[cityLower];
  
  // Fuzzy match — check if the city name contains or is contained by a known city
  for (const [knownCity, tier] of Object.entries(country.cities)) {
    if (cityLower.includes(knownCity) || knownCity.includes(cityLower)) return tier;
  }
  
  return 3; // Unknown city → tier 3 (cheaper)
}

/**
 * Apply charm pricing — make price end in .99 or .49
 * @param {number} raw - Raw calculated price
 * @param {string} currencyCode - Currency code
 * @returns {number} Charm-priced amount
 */
function charmPrice(raw, currencyCode) {
  if (ZERO_DECIMAL_CURRENCIES.has(currencyCode)) {
    // For JPY etc: round to nearest 10, subtract 1 (e.g., 690 → 689)
    const rounded = Math.round(raw / 10) * 10;
    return Math.max(rounded - 1, 9);
  }
  
  const whole = Math.floor(raw);
  const decimal = raw - whole;
  
  if (raw < 1) return 0.99;
  if (decimal < 0.25) return whole - 0.01;   // 5.15 → 4.99
  if (decimal < 0.75) return whole + 0.49;    // 5.55 → 5.49
  return whole + 0.99;                        // 5.85 → 5.99
}

/**
 * Main pricing function — calculate the price for a gym session
 * 
 * @param {Object} params
 * @param {string} params.countryCode - ISO 3166-1 alpha-2 (e.g., 'GB', 'IN')
 * @param {string} [params.city] - City name
 * @param {string} [params.timeSlot] - 'peak' | 'offpeak' | 'weekend_am' | 'weekend_pm'
 * @param {string} [params.passType] - 'day' | '3day' | 'weekly' | 'monthly'
 * @param {number} [params.demandFactor] - Surge multiplier (1.0 = normal, default)
 * @param {string} [params.time] - Time string (e.g., '14:00')
 * @param {string} [params.date] - Date string (e.g., '2026-06-03')
 * @returns {Object} { amount, currency, symbol, display, stripeAmount, tier, timeSlot, passType }
 */
function calculatePrice({
  countryCode = 'GB',
  city = null,
  timeSlot = null,
  passType = 'day',
  demandFactor = 1.0,
  time = null,
  date = null,
} = {}) {
  const cc = (countryCode || 'GB').toUpperCase();
  const country = COUNTRY_PRICING[cc] || COUNTRY_PRICING.GB;
  
  // Resolve time slot
  if (!timeSlot) {
    timeSlot = time ? resolveTimeSlot(time, date) : getTimeSlot();
  }
  
  // Layer 1: Country PPP factor
  const pppFactor = country.pppFactor;
  
  // Layer 2: City tier
  const cityTier = getCityTier(cc, city);
  const cityFactor = CITY_TIER_FACTORS[cityTier] || 1.0;
  
  // Layer 3: Time-of-day
  const timeFactor = TIME_FACTORS[timeSlot] || 1.0;
  
  // Layer 4: Demand (surge)
  const demand = Math.max(0.8, Math.min(3.0, demandFactor));
  
  // Layer 5: Pass type
  const passMultiplier = PASS_MULTIPLIERS[passType] || 1.0;
  
  // Calculate raw price in local currency
  const baseInUSD = UK_BASE_PEAK_GBP / 0.79; // ~$3.78 USD
  const rawPrice = baseInUSD * pppFactor * country.fxRate * cityFactor * timeFactor * demand * passMultiplier;
  
  // Apply charm pricing
  const finalPrice = charmPrice(rawPrice, country.currencyCode);
  
  // Convert to Stripe amount (smallest currency unit)
  const stripeAmount = ZERO_DECIMAL_CURRENCIES.has(country.currencyCode)
    ? Math.round(finalPrice)
    : Math.round(finalPrice * 100);
  
  // Format display price
  const displayPrice = ZERO_DECIMAL_CURRENCIES.has(country.currencyCode)
    ? `${country.symbol}${Math.round(finalPrice).toLocaleString()}`
    : `${country.symbol}${finalPrice.toFixed(2)}`;
  
  return {
    amount: finalPrice,
    currency: country.currencyCode,
    symbol: country.symbol,
    display: displayPrice,
    stripeAmount,
    countryCode: cc,
    cityTier,
    timeSlot,
    passType,
    demandFactor: demand,
  };
}

/**
 * Get a pre-created Stripe Price ID for a currency + pass type
 * Falls back to null (use dynamic price_data instead)
 * 
 * @param {string} currency - Currency code (e.g., 'gbp')
 * @param {string} passType - Pass type (e.g., 'day')
 * @returns {string|null} Stripe Price ID or null
 */
function getStripePriceId(currency, passType) {
  const cur = (currency || 'gbp').toLowerCase();
  const pass = (passType || 'day').toLowerCase();
  return STRIPE_PRICE_MAP[cur]?.[pass] || null;
}

/**
 * Resolve currency and country from geolocation data
 * 
 * @param {Object} geo - Geolocation data
 * @param {string} [geo.country] - ISO country code
 * @param {string} [geo.city] - City name
 * @param {string} [geo.countryCode] - Alternative key
 * @returns {Object} { countryCode, currency, symbol, country }
 */
function resolveCurrency(geo) {
  if (!geo) return { countryCode: 'GB', currency: 'gbp', symbol: '£', country: COUNTRY_PRICING.GB };
  
  const cc = (geo.country || geo.countryCode || 'GB').toUpperCase();
  const country = COUNTRY_PRICING[cc] || COUNTRY_PRICING.GB;
  
  return {
    countryCode: cc,
    currency: country.currencyCode,
    symbol: country.symbol,
    country,
  };
}

/**
 * Get pricing for all pass types for a given location + time
 * Useful for showing pricing cards in the frontend
 * 
 * @param {Object} params - Same as calculatePrice, minus passType
 * @returns {Object} { day, '3day', weekly, monthly } — each with full pricing info
 */
function getAllPassPrices(params) {
  const passTypes = ['day', '3day', 'weekly', 'monthly'];
  const result = {};
  for (const pt of passTypes) {
    result[pt] = calculatePrice({ ...params, passType: pt });
  }
  return result;
}

/**
 * Build Stripe checkout line items with proper currency
 * Prefers pre-created Price IDs; falls back to price_data
 * 
 * @param {Object} params
 * @param {string} params.passType - Pass type
 * @param {string} params.currency - Currency code
 * @param {number} params.stripeAmount - Amount in smallest currency unit
 * @param {string} params.gymName - Gym name for description
 * @param {string} params.description - Time/date description
 * @returns {Object} Stripe line_items[0] config
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
  
  if (priceId) {
    // Use pre-created price (preferred — no price_data needed)
    return { price: priceId, quantity: 1 };
  }
  
  // Fallback: dynamic price_data
  return {
    price_data: {
      currency: currency,
      product_data: {
        name: `${PASS_NAMES[passType] || 'ScanGym Day Pass'} — ${gymName || 'Gym'}`,
        description: description || 'Gym day pass',
      },
      unit_amount: stripeAmount,
    },
    quantity: 1,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  calculatePrice,
  getStripePriceId,
  resolveCurrency,
  getAllPassPrices,
  buildStripeLineItem,
  getTimeSlot,
  resolveTimeSlot,
  getCityTier,
  charmPrice,
  COUNTRY_PRICING,
  STRIPE_PRICE_MAP,
  TIME_FACTORS,
  CITY_TIER_FACTORS,
  PASS_MULTIPLIERS,
  ZERO_DECIMAL_CURRENCIES,
};
