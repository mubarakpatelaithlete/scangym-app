/**
 * LIVE SEARCH — Google Places API as the gym discovery engine.
 * 
 * Instead of searching our DB, this queries Google Places in real time.
 * Every gym on Earth becomes searchable — 1.2M+ gyms worldwide.
 * 
 * Endpoints:
 *   GET /api/live/search?q=gym+in+London        — Text Search
 *   GET /api/live/nearby?lat=51.5&lng=-0.12      — Nearby Search
 *   GET /api/live/place/:placeId                 — Place Details
 *   GET /api/live/place/:placeId/photos          — Place Photos
 *   POST /api/live/ensure-gym                    — Ensure gym exists in DB (for booking)
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth, authenticateUser } = require('../middleware/auth');

const { getCurrencyForCountry, getDayPassPrice, calculateGymPrice } = require('../lib/pricing-engine');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const BASE_URL = 'https://maps.googleapis.com/maps/api/place';

// ─── Auto-migration: ensure gyms table has currency & country columns ──
(async () => {
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='currency') THEN
          ALTER TABLE gyms ADD COLUMN currency VARCHAR(10) DEFAULT 'GBP';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='country') THEN
          ALTER TABLE gyms ADD COLUMN country VARCHAR(10) DEFAULT 'GB';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='is_accepting_bookings') THEN
          ALTER TABLE gyms ADD COLUMN is_accepting_bookings BOOLEAN DEFAULT TRUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='is_24h') THEN
          ALTER TABLE gyms ADD COLUMN is_24h BOOLEAN DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='is_self_service') THEN
          ALTER TABLE gyms ADD COLUMN is_self_service BOOLEAN DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='lat') THEN
          ALTER TABLE gyms ADD COLUMN lat DOUBLE PRECISION DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='lng') THEN
          ALTER TABLE gyms ADD COLUMN lng DOUBLE PRECISION DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='phone') THEN
          ALTER TABLE gyms ADD COLUMN phone VARCHAR(50) DEFAULT '';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='website') THEN
          ALTER TABLE gyms ADD COLUMN website TEXT DEFAULT '';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='rating') THEN
          ALTER TABLE gyms ADD COLUMN rating NUMERIC(3,2) DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='zip_code') THEN
          ALTER TABLE gyms ADD COLUMN zip_code VARCHAR(20) DEFAULT '';
        END IF;
      END $$;
    `);
    console.log('[LiveSearch] gyms table columns verified (all ensure-gym columns)');
  } catch (err) {
    console.error('[LiveSearch] Migration error:', err.message);
  }
})();

// ─── C7 fix: Map of common country names/suffixes → ISO 3166-1 alpha-2 codes ──
// Google Places formatted_address ends with the country name.
// This covers all 99 countries in the pricing engine + common variants.
const COUNTRY_NAME_TO_CODE = {
  'uk': 'GB', 'united kingdom': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
  'usa': 'US', 'united states': 'US', 'us': 'US',
  'canada': 'CA', 'australia': 'AU', 'new zealand': 'NZ',
  'germany': 'DE', 'france': 'FR', 'spain': 'ES', 'italy': 'IT',
  'netherlands': 'NL', 'belgium': 'BE', 'austria': 'AT', 'portugal': 'PT',
  'ireland': 'IE', 'greece': 'GR', 'finland': 'FI', 'croatia': 'HR',
  'estonia': 'EE', 'lithuania': 'LT', 'latvia': 'LV', 'slovakia': 'SK',
  'slovenia': 'SI', 'cyprus': 'CY', 'malta': 'MT', 'luxembourg': 'LU',
  'switzerland': 'CH', 'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK',
  'poland': 'PL', 'czech republic': 'CZ', 'czechia': 'CZ',
  'romania': 'RO', 'hungary': 'HU', 'bulgaria': 'BG', 'iceland': 'IS',
  'serbia': 'RS', 'ukraine': 'UA', 'georgia': 'GE',
  'united arab emirates': 'AE', 'uae': 'AE', 'saudi arabia': 'SA',
  'qatar': 'QA', 'kuwait': 'KW', 'bahrain': 'BH', 'oman': 'OM',
  'israel': 'IL', 'turkey': 'TR', 'türkiye': 'TR', 'jordan': 'JO',
  'japan': 'JP', 'south korea': 'KR', 'korea': 'KR', 'india': 'IN',
  'singapore': 'SG', 'hong kong': 'HK', 'thailand': 'TH', 'malaysia': 'MY',
  'philippines': 'PH', 'vietnam': 'VN', 'indonesia': 'ID', 'china': 'CN',
  'taiwan': 'TW', 'pakistan': 'PK', 'bangladesh': 'BD', 'sri lanka': 'LK',
  'nepal': 'NP', 'myanmar': 'MM', 'cambodia': 'KH',
  'mexico': 'MX', 'brazil': 'BR', 'argentina': 'AR', 'colombia': 'CO',
  'chile': 'CL', 'peru': 'PE', 'costa rica': 'CR', 'panama': 'PA',
  'ecuador': 'EC', 'dominican republic': 'DO', 'uruguay': 'UY',
  'trinidad and tobago': 'TT', 'jamaica': 'JM', 'guatemala': 'GT', 'honduras': 'HN',
  'south africa': 'ZA', 'nigeria': 'NG', 'egypt': 'EG', 'kenya': 'KE',
  'morocco': 'MA', 'ghana': 'GH', 'tanzania': 'TZ', 'ethiopia': 'ET',
  'uganda': 'UG', 'rwanda': 'RW', 'senegal': 'SN', 'ivory coast': 'CI',
  "côte d'ivoire": 'CI', 'cameroon': 'CM', 'tunisia': 'TN', 'mauritius': 'MU',
  'kazakhstan': 'KZ', 'uzbekistan': 'UZ', 'azerbaijan': 'AZ', 'fiji': 'FJ',
};

/**
 * C7 fix: Extract country code from Google Places formatted_address.
 * e.g. "24 Bolton Rd, Bolton BL1 1AA, UK" → "GB"
 *      "123 5th Ave, New York, NY 10001, USA" → "US"
 *      "渋谷, Tokyo 150-0002, Japan" → "JP"
 */
function extractCountryCode(formattedAddress) {
  if (!formattedAddress) return 'GB';
  const parts = formattedAddress.split(',').map(p => p.trim());
  // Last part is usually the country
  const lastPart = (parts[parts.length - 1] || '').toLowerCase().trim();
  return COUNTRY_NAME_TO_CODE[lastPart] || 'GB';
}

// ─── Simple in-memory cache (5 min TTL) ─────────────────────
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes — gyms don't change often, saves Google API calls

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
  // Cleanup old entries every 100 sets
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.time > CACHE_TTL) cache.delete(k);
    }
  }
}

// ─── Helper: Build photo URL from photo_reference ────────────
// C2/C3 fix: proxy through /api/photo so the Google API key is never exposed to clients
function photoUrl(photoRef, maxWidth = 1200) {
  return `/api/photo?ref=${encodeURIComponent(photoRef)}&maxwidth=${maxWidth}`;
}

// ─── #17/#18: 24/7 and Self-Service gym detection ────────────
// Known gym chains that operate 24/7 (always open, key-fob/QR entry)
// Worldwide list — 60+ chains across all major markets
const CHAINS_24H = [
  // ── UK & Ireland ──
  'puregym', 'pure gym', 'the gym group', 'the gym ', 'jd gyms', 'jd gym',
  'xercise4less', 'xercise 4 less', 'easygym', 'easy gym', 'energie fitness',
  'fit4less', 'fit 4 less', 'simply gym', 'total fitness', 'buzz gym',
  'everlast fitness', 'gymshark lifting club', 'flyefit',
  // ── USA & Canada ──
  'anytime fitness', 'planet fitness', '24 hour fitness', '24hour fitness',
  'snap fitness', 'crunch fitness', 'la fitness', 'youfit', 'workout anytime',
  'club fitness', 'chuze fitness', 'vasa fitness', 'eos fitness',
  'fitness 19', 'fitness19', 'blink fitness', 'title boxing',
  'fit4less', 'goodlife fitness', 'world gym',
  // ── Europe ──
  'mcfit', 'clever fit', 'fitx', 'fitness24seven', 'fitness 24 seven',
  'basic-fit', 'basic fit', 'trainmore', 'sportcity', 'fit7',
  'john reed', 'high5', 'fitnessfirst', 'fitness first', 'bodyfit',
  'keep cool', 'neoness', 'amazonia', 'vivagym', 'viva gym',
  'altafit', 'dir fitness', 'mcfit', 'actic', 'sats',
  'fresh fitness', 'cleverfit', 'superfit',
  // ── Australia & NZ ──
  'jetts fitness', 'jetts', 'plus fitness', 'anytime fitness',
  'workout 24', 'snap fitness', 'world gym', 'zap fitness',
  // ── Asia ──
  'joyfit', 'fastgym', 'tipness', 'anytime fitness', 'gold gym',
  'fitness first', 'celebrity fitness',
  // ── Middle East ──
  'fitness time', 'leejam', 'warehouse gym', 'gymnation',
  // ── South America ──
  'smartfit', 'smart fit', 'bodytech', 'bio ritmo',
  // ── India ──
  'cult.fit', 'cultfit', 'anytime fitness', 'gold gym', 'snap fitness',
  // ── Africa ──
  'virgin active', 'planet fitness',
  // ── Generic 24/7 patterns ──
  '24/7 fitness', '24seven', '24 7 fitness', 'iron 24', 'gym24', 'abs 24',
  'anytime gym', 'fitnessfirst 24', 'lifecentre 24', 'open 24',
  'nonstop gym', 'non stop gym', 'nonstop fitness', 'alltime fitness',
];

// Known self-service entry chains (unmanned / key-fob / app-based entry)
const CHAINS_SELF_SERVICE = [
  // ── UK ──
  'puregym', 'pure gym', 'the gym group', 'the gym ', 'jd gyms', 'jd gym',
  'xercise4less', 'xercise 4 less', 'easygym', 'easy gym', 'fit4less',
  'fit 4 less', 'simply gym', 'buzz gym', 'flyefit',
  // ── US & Canada ──
  'anytime fitness', 'snap fitness', 'planet fitness', '24 hour fitness',
  '24hour fitness', 'workout anytime', 'youfit', 'blink fitness',
  // ── Europe ──
  'basic-fit', 'basic fit', 'mcfit', 'clever fit', 'fitx',
  'fitness24seven', 'fitness 24 seven', 'trainmore', 'john reed',
  'vivagym', 'viva gym', 'fresh fitness', 'cleverfit', 'neoness',
  // ── Australia & NZ ──
  'jetts fitness', 'jetts', 'plus fitness', 'zap fitness',
  // ── Asia ──
  'joyfit', 'fastgym', 'anytime fitness',
  // ── Middle East ──
  'gymnation',
  // ── South America ──
  'smartfit', 'smart fit',
  // ── Generic ──
  '24/7 fitness', 'nonstop gym', 'non stop gym',
];

/**
 * Detect if a gym is 24/7 from name + opening_hours.
 * 
 * Detection layers (most reliable → least):
 *   1. Google Places opening_hours.periods — single always-open period = definitive 24/7
 *   2. Google Places weekday_text — "Open 24 hours" on all 7 days
 *   3. Known chain names — 60+ worldwide 24/7 gym chains
 *   4. Name pattern matching — "24/7", "24 hour", "24hr" in gym name
 *   5. regularOpeningHours (New API) — periods array check
 */
function detect24Hours(place) {
  // ── Layer 1: Google Places periods (most reliable) ──
  // A 24/7 gym has one period: open day=0 time=0000, no close
  const periods = place.opening_hours?.periods;
  if (periods && periods.length === 1) {
    const p = periods[0];
    if (p.open && p.open.day === 0 && p.open.time === '0000' && !p.close) return true;
  }
  // Also handle gyms with 7 periods all showing 0000-0000 (some Google results)
  if (periods && periods.length === 7) {
    const allDay = periods.every(p => 
      p.open?.time === '0000' && (!p.close || p.close?.time === '2359' || p.close?.time === '0000')
    );
    if (allDay) return true;
  }

  // ── Layer 2: weekday_text — "Open 24 hours" on all 7 days ──
  const weekday = place.opening_hours?.weekday_text;
  if (weekday && weekday.length === 7 && weekday.every(d => /open 24 hours/i.test(d))) return true;
  // Also check for translated variants (Google returns localized text)
  if (weekday && weekday.length === 7 && weekday.every(d => /24/i.test(d) && /hour|heur|stund|hora|uur|tim/i.test(d))) return true;

  // ── Layer 3: Known chain names (60+ worldwide) ──
  const name = (place.name || '').toLowerCase();
  if (CHAINS_24H.some(chain => name.includes(chain))) return true;

  // ── Layer 4: Name pattern matching ──
  if (/\b24\s*[\/\\]?\s*7\b/.test(name) || /\b24\s*h(ou)?rs?\b/i.test(name)) return true;
  if (/always\s*open/i.test(name) || /non\s*-?\s*stop/i.test(name)) return true;
  if (/\bopen\s*24\b/i.test(name) || /\b24\s*gym/i.test(name)) return true;

  // ── Layer 5: New Places API regularOpeningHours ──
  const regHours = place.regularOpeningHours;
  if (regHours?.periods) {
    // New API format: periods[].open.day, periods[].open.hour, periods[].open.minute
    if (regHours.periods.length === 1) {
      const p = regHours.periods[0];
      if (p.open?.day === 0 && p.open?.hour === 0 && (p.open?.minute || 0) === 0 && !p.close) return true;
    }
  }

  return false;
}

/**
 * Detect if a gym has self-service entry (key-fob, QR, pin code — no staff needed).
 * Self-service gyms are almost always 24/7 — if it's 24/7, it's very likely self-service.
 */
function detectSelfService(place) {
  const name = (place.name || '').toLowerCase();
  // Known self-service chains
  if (CHAINS_SELF_SERVICE.some(chain => name.includes(chain))) return true;
  // Name contains self-service indicators
  if (/\b(unmanned|self.service|keycard|key.fob|key.card|pin.entry|qr.entry|app.entry)\b/i.test(name)) return true;
  // 24/7 gyms are almost always self-service (you can't staff 24/7 economically)
  if (detect24Hours(place)) return true;
  return false;
}

// ─── Helper: Parse a Text/Nearby Search result into ScanGym gym format ───
// v4.0: priceLevelToPrice removed — all gyms use £4.49 base (PPP + currency by country)

function parseSearchResult(place) {
  const geo = place.geometry?.location || {};
  const photoRef = place.photos?.[0]?.photo_reference || null;

  // Include ALL photo references for multi-photo carousel (Google returns up to 10)
  const photos_list = (place.photos || []).map(p => ({
    url: photoUrl(p.photo_reference, 1200),
    thumbnail: photoUrl(p.photo_reference, 400),
  }));

  // v4.0: Currency + price from gym's physical country (PPP-adjusted £4.49 base)
  const addr = place.formatted_address || place.vicinity || '';
  const gymCountry = extractCountryCode(addr);
  const gymCurrency = getCurrencyForCountry(gymCountry);
  const gymPrice = getDayPassPrice(gymCountry);

  return {
    id: place.place_id,
    placeId: place.place_id,
    name: place.name || 'Unknown Gym',
    address: addr,
    city: extractCity(addr),
    country: gymCountry,
    latitude: geo.lat || null,
    longitude: geo.lng || null,
    rating: place.rating || null,
    totalReviews: place.user_ratings_total || 0,
    photo: photoRef ? photoUrl(photoRef) : null,
    photoReference: photoRef,
    photos_list,
    types: place.types || [],
    businessStatus: place.business_status || 'OPERATIONAL',
    openNow: place.opening_hours?.open_now ?? null,
    is24Hours: detect24Hours(place),
    isSelfService: detectSelfService(place),
    priceLevel: place.price_level ?? null,
    dayPassPrice: gymPrice.amount,
    currency: gymCurrency.currency,
    currencySymbol: gymCurrency.symbol,
    source: 'google_places_live',
  };
}

// ─── Helper: Extract city from formatted address ─────────────
function extractCity(address) {
  if (!address) return '';
  const parts = address.split(',').map(p => p.trim());
  // For UK: usually "Street, City, Postcode, UK"
  if (parts.length >= 3) return parts[parts.length - 3] || parts[1] || '';
  if (parts.length >= 2) return parts[parts.length - 2] || '';
  return parts[0] || '';
}

// ─── C6 fix: Enrich Google Places gyms with owner-set DB prices ──────────
// Batch-lookup place_ids against our DB. If a gym owner has set a custom
// day_pass_price, override the default PPP price in the API response.
// H15 fix: also fetch is_accepting_bookings for owner open/closed override.
async function enrichGymsWithDbPrices(gyms) {
  if (!gyms || gyms.length === 0) return gyms;
  try {
    const placeIds = gyms.map(g => g.placeId || g.id).filter(Boolean);
    if (placeIds.length === 0) return gyms;

    const result = await pool.query(
      'SELECT place_id, day_pass_price, is_accepting_bookings, is_24h, is_self_service FROM gyms WHERE place_id = ANY($1)',
      [placeIds]
    );

    if (result.rows.length === 0) return gyms;

    // Build lookup maps
    const dbMap = {};
    for (const row of result.rows) {
      dbMap[row.place_id] = row;
    }

    // Override prices and open/closed for gyms with owner data
    for (const gym of gyms) {
      const pid = gym.placeId || gym.id;
      const dbRow = dbMap[pid];
      if (!dbRow) continue;

      // C6: owner price override
      const ownerPrice = dbRow.day_pass_price ? parseFloat(dbRow.day_pass_price) : null;
      if (ownerPrice && ownerPrice > 0) {
        const gymPrice = calculateGymPrice({
          gymDayPassPrice: ownerPrice,
          countryCode: gym.country || 'GB',
          passType: 'day',
        });
        gym.dayPassPrice = gymPrice.amount;
        gym.priceSource = 'owner_price';
      }

      // H15: owner open/closed override — if owner set it, override Google
      if (dbRow.is_accepting_bookings === true) {
        gym.openNow = true;
        gym.ownerIsOpen = true;
      } else if (dbRow.is_accepting_bookings === false) {
        gym.openNow = false;
        gym.ownerIsOpen = false;
      }

      // #17/#18: Owner-set 24/7 and self-service flags override chain detection
      if (dbRow.is_24h === true) gym.is24Hours = true;
      if (dbRow.is_24h === false) gym.is24Hours = false;
      if (dbRow.is_self_service === true) gym.isSelfService = true;
      if (dbRow.is_self_service === false) gym.isSelfService = false;
    }
  } catch (e) {
    // DB lookup failed — keep defaults (non-critical)
    console.error('[enrichGymsWithDbPrices] DB lookup error:', e.message);
  }
  return gyms;
}

// ─── #59: Amazon-style bucketed booking counts ──────────────────────
// Query bookings table for 30-day counts, bucket like Amazon:
// "10+ booked", "50+ booked", "100+ booked", "200+", "500+", "1K+", "2K+", "5K+"
// For gyms not in DB yet, use smart seeding (hash-based, consistent per gym).
const BOOKING_BUCKETS = [5000, 2000, 1000, 500, 200, 100, 50, 10];

function bucketLabel(count) {
  for (const b of BOOKING_BUCKETS) {
    if (count >= b) return b >= 1000 ? `${b / 1000}K+` : `${b}+`;
  }
  return null; // fewer than 10 — don't show
}

// Smart seeding: consistent per-gym count for early stage
function seededBookingCount(placeId) {
  let h = 0;
  for (let i = 0; i < (placeId || '').length; i++) {
    h = ((h << 5) - h) + placeId.charCodeAt(i);
  }
  // Range 15-180 — realistic for a gym in first months
  return Math.abs(h % 166) + 15;
}

async function enrichGymsWithBookingCounts(gyms) {
  if (!gyms || gyms.length === 0) return gyms;

  // Try to get real counts from DB
  const dbCounts = {};
  try {
    const placeIds = gyms.map(g => g.placeId || g.id).filter(Boolean);
    if (placeIds.length > 0) {
      const result = await pool.query(
        `SELECT g.place_id, COUNT(b.id) as booking_count
         FROM gyms g
         LEFT JOIN bookings b ON b.gym_id = g.id
           AND b.created_at > NOW() - INTERVAL '30 days'
           AND b.status NOT IN ('cancelled', 'refunded')
         WHERE g.place_id = ANY($1)
         GROUP BY g.place_id`,
        [placeIds]
      );
      for (const row of result.rows) {
        dbCounts[row.place_id] = parseInt(row.booking_count) || 0;
      }
    }
  } catch (e) {
    // DB not available — fall through to seeding
    console.error('[enrichBookingCounts] DB error:', e.message);
  }

  // Enrich each gym with bucketed count
  for (const gym of gyms) {
    const pid = gym.placeId || gym.id;
    const realCount = dbCounts[pid];
    const count = (realCount !== undefined && realCount > 0)
      ? realCount
      : seededBookingCount(pid);

    gym.bookedThisMonth = count;
    gym.bookedBucket = bucketLabel(count);
    gym.bookedIsReal = (realCount !== undefined && realCount > 0);
  }

  return gyms;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/live/search — Live Text Search via Google Places
// Query: ?q=gym+in+London&pagetoken=xxx
// ═══════════════════════════════════════════════════════════════
router.get('/search', async (req, res) => {
  try {
    const { q, query, pagetoken, type, lat, lng, radius, filter24h, filterSelfService } = req.query;
    let searchQuery = q || query;

    if (!searchQuery && !pagetoken) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: 'Google Maps API key not configured' });
    }

    // #17: If 24h filter active, enhance query to prefer 24-hour gyms
    if (filter24h === 'true' && searchQuery && !searchQuery.toLowerCase().includes('24')) {
      searchQuery = searchQuery + ' 24 hour';
    }

    // Check cache (include lat/lng + filters in cache key)
    const cacheKey = `search:${searchQuery}:${pagetoken || ''}:${lat || ''}:${lng || ''}:24h=${filter24h || ''}:ss=${filterSelfService || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Build Google Places Text Search URL
    let url;
    if (pagetoken) {
      url = `${BASE_URL}/textsearch/json?pagetoken=${pagetoken}&key=${GOOGLE_MAPS_API_KEY}`;
    } else {
      // Always append "gym" context if not already in query
      let q = searchQuery;
      if (!q.toLowerCase().includes('gym') && !q.toLowerCase().includes('fitness') && !q.toLowerCase().includes('sport')) {
        q = `gym in ${q}`;
      }
      const encoded = encodeURIComponent(q);
      // Filter to gym-related types
      const typeParam = type || 'gym';
      url = `${BASE_URL}/textsearch/json?query=${encoded}&type=${typeParam}&key=${GOOGLE_MAPS_API_KEY}`;

      // ━━━ LOCATION BIAS FIX: Add coordinates + radius so Google biases to the right area ━━━
      if (lat && lng) {
        const r = radius || 20000; // 20km default bias radius
        url += `&location=${lat},${lng}&radius=${r}`;
      }
      // ━━━ REGION BIAS: Hint Google to prefer results in this country ━━━
      // Fix #6: Also detect country names (e.g. "United Kingdom", "UAE", "United States")
      const regionMap = {
        'united kingdom': 'gb', 'uk': 'gb', 'gb': 'gb', 'england': 'gb', 'scotland': 'gb', 'wales': 'gb',
        'united states': 'us', 'us': 'us', 'usa': 'us',
        'uae': 'ae', 'ae': 'ae', 'dubai': 'ae',
        'india': 'in', 'in': 'in',
        'australia': 'au', 'au': 'au',
        'canada': 'ca', 'ca': 'ca',
        'germany': 'de', 'de': 'de',
        'france': 'fr', 'fr': 'fr',
        'spain': 'es', 'es': 'es',
        'italy': 'it', 'it': 'it',
        'netherlands': 'nl', 'nl': 'nl'
      };
      const qLower = searchQuery.toLowerCase();
      let detectedRegion = null;
      for (const [keyword, code] of Object.entries(regionMap)) {
        if (qLower.includes(keyword)) { detectedRegion = code; break; }
      }
      if (detectedRegion) {
        url += `&region=${detectedRegion}`;
      } else if (!lat && !lng) {
        // No region detected AND no coordinates — default to UK (ScanGym primary market)
        url += '&region=gb';
      }
    }

    // Google Places pagetoken requires ~2-3s delay before it becomes valid.
    // Retry up to 5 times with increasing backoff for INVALID_REQUEST on pagination.
    let data;
    const maxRetries = pagetoken ? 5 : 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000 + attempt * 1500));
      try {
        const response = await fetch(url);
        data = await response.json();
      } catch (fetchErr) {
        console.error('Google Places fetch error (attempt', attempt + 1, '):', fetchErr.message);
        if (attempt === maxRetries) {
          return res.json({ gyms: [], total: 0, nextPageToken: null, query: searchQuery, source: 'google_places_live', error: 'Search temporarily unavailable' });
        }
        continue;
      }
      if (data.status !== 'INVALID_REQUEST' || !pagetoken) break;
    }

    if (!data || data.status === 'ZERO_RESULTS') {
      const result = { gyms: [], total: 0, nextPageToken: null, query: searchQuery, source: 'google_places_live' };
      return res.json(result);
    }

    if (data.status !== 'OK') {
      console.error('Google Places Text Search error:', data.status, data.error_message);
      // Return empty results instead of 502 so the frontend doesn't break
      return res.json({ gyms: [], total: 0, nextPageToken: null, query: searchQuery, source: 'google_places_live', error: data.status });
    }

    let gyms = (data.results || [])
      .filter(p => p.business_status !== 'CLOSED_PERMANENTLY')
      .map(parseSearchResult);

    // Perf: Run DB enrichment in parallel (prices + booking counts)
    await Promise.all([
      enrichGymsWithDbPrices(gyms),
      enrichGymsWithBookingCounts(gyms)
    ]);

    // ── #17 TRUE SERVER-SIDE FILTERING ──────────────────────────
    // The query-bias ("24 hour" appended) gets Google to *prefer* 24/7 gyms,
    // but non-24/7 results can still slip through. This actually removes them.
    if (filter24h === 'true') {
      gyms = gyms.filter(g => g.is24Hours === true);
    }
    if (filterSelfService === 'true') {
      gyms = gyms.filter(g => g.isSelfService === true);
    }

    // Amazon-style ranking: sort by composite score instead of Google's default order
    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    rankGyms(gyms, userLat, userLng);

    const result = {
      gyms,
      total: gyms.length,
      nextPageToken: data.next_page_token || null,
      query: searchQuery,
      source: 'google_places_live',
      filters: {
        is24h: filter24h === 'true',
        isSelfService: filterSelfService === 'true',
      },
    };

    setCache(cacheKey, result);
    res.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800');
    res.json(result);
  } catch (err) {
    console.error('Live search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/live/nearby — Nearby Search (GPS-based)
// Query: ?lat=51.5&lng=-0.12&radius=5000&type=gym
// ═══════════════════════════════════════════════════════════════
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius = 5000, pagetoken, keyword, filter24h, filterSelfService } = req.query;

    if (!pagetoken && (!lat || !lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: 'Google Maps API key not configured' });
    }

    // #17: Enhance keyword for 24h filter
    let searchKeyword = keyword || 'gym fitness';
    if (filter24h === 'true' && !searchKeyword.includes('24')) {
      searchKeyword = '24 hour ' + searchKeyword;
    }

    const cacheKey = `nearby:${lat}:${lng}:${radius}:${pagetoken || ''}:24h=${filter24h || ''}:ss=${filterSelfService || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    let url;
    if (pagetoken) {
      url = `${BASE_URL}/nearbysearch/json?pagetoken=${pagetoken}&key=${GOOGLE_MAPS_API_KEY}`;
    } else {
      url = `${BASE_URL}/nearbysearch/json?location=${lat},${lng}&radius=${Math.min(parseInt(radius), 50000)}&type=gym&keyword=${encodeURIComponent(searchKeyword)}&key=${GOOGLE_MAPS_API_KEY}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'ZERO_RESULTS') {
      return res.json({ gyms: [], total: 0, nextPageToken: null, source: 'google_places_live' });
    }

    if (data.status !== 'OK') {
      console.error('Google Places Nearby error:', data.status, data.error_message);
      return res.status(502).json({ error: 'Nearby search error', details: data.status });
    }

    let gyms = (data.results || [])
      .filter(p => p.business_status !== 'CLOSED_PERMANENTLY')
      .map(parseSearchResult);

    // Perf: Run DB enrichment in parallel (prices + booking counts)
    await Promise.all([
      enrichGymsWithDbPrices(gyms),
      enrichGymsWithBookingCounts(gyms)
    ]);

    // ── #17 TRUE SERVER-SIDE FILTERING (nearby) ─────────────────
    if (filter24h === 'true') {
      gyms = gyms.filter(g => g.is24Hours === true);
    }
    if (filterSelfService === 'true') {
      gyms = gyms.filter(g => g.isSelfService === true);
    }

    // Amazon-style ranking: composite score replaces simple distance sort.
    // rankGyms() computes distance + distanceText internally, then sorts by
    // Score = Distance(40%) + Price(25%) + Reviews(25%) + Availability(10%)
    const searchLat = lat ? parseFloat(lat) : null;
    const searchLng = lng ? parseFloat(lng) : null;
    rankGyms(gyms, searchLat, searchLng);

    const result = {
      gyms,
      total: gyms.length,
      nextPageToken: data.next_page_token || null,
      source: 'google_places_live',
      filters: {
        is24h: filter24h === 'true',
        isSelfService: filterSelfService === 'true',
      },
    };

    setCache(cacheKey, result);
    /* Perf #120: Let browsers/CDN cache nearby results for 2 min */
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
    res.json(result);
  } catch (err) {
    console.error('Live nearby error:', err);
    res.status(500).json({ error: 'Nearby search failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/live/place/:placeId — Full Place Details
// ═══════════════════════════════════════════════════════════════
router.get('/place/:placeId', optionalAuth, async (req, res) => {
  try {
    const { placeId } = req.params;

    if (!placeId || !GOOGLE_MAPS_API_KEY) {
      return res.status(400).json({ error: 'placeId required' });
    }

    const cacheKey = `place:${placeId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Fetch from Google Places
    const fields = 'name,formatted_address,formatted_phone_number,geometry,rating,user_ratings_total,reviews,photos,opening_hours,types,website,url,price_level,business_status';
    const url = `${BASE_URL}/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.result) {
      return res.status(404).json({ error: 'Place not found' });
    }

    const p = data.result;
    const geo = p.geometry?.location || {};

    // Check if this gym exists in our DB
    let dbGym = null;
    try {
      // H15 fix: also fetch is_accepting_bookings so owner override beats Google open/closed
      const dbResult = await pool.query('SELECT id, day_pass_price, hourly_rate, is_claimed, is_accepting_bookings FROM gyms WHERE place_id = $1', [placeId]);
      if (dbResult.rows.length > 0) dbGym = dbResult.rows[0];
    } catch (e) {}

    // Check for ScanGym reviews
    let scangymReviews = [];
    let scangymRating = null;
    if (dbGym) {
      try {
        const reviews = await pool.query('SELECT rating, comment, created_at FROM reviews WHERE gym_id = $1 ORDER BY created_at DESC LIMIT 5', [dbGym.id]);
        scangymReviews = reviews.rows;
        const stats = await pool.query('SELECT AVG(rating) as avg, COUNT(*) as total FROM reviews WHERE gym_id = $1', [dbGym.id]);
        if (parseInt(stats.rows[0].total) > 0) {
          scangymRating = {
            average: parseFloat(parseFloat(stats.rows[0].avg).toFixed(1)),
            total: parseInt(stats.rows[0].total),
          };
        }
      } catch (e) {}
    }

    // C7 fix: Currency from gym's physical country
    const gymCountry = extractCountryCode(p.formatted_address);
    const gymCurrency = getCurrencyForCountry(gymCountry);

    const result = {
      gym: {
        placeId,
        dbId: dbGym?.id || null,
        name: p.name,
        address: p.formatted_address,
        city: extractCity(p.formatted_address),
        country: gymCountry,
        phone: p.formatted_phone_number || null,
        website: p.website || null,
        googleMapsUrl: p.url || null,
        latitude: geo.lat,
        longitude: geo.lng,
        businessStatus: p.business_status || 'OPERATIONAL',
        types: p.types || [],
        priceLevel: p.price_level ?? null,
        isClaimed: dbGym?.is_claimed || false,
        // #17/#18: 24/7 and self-service detection (uses full Place Details periods)
        is24Hours: detect24Hours(p),
        isSelfService: detectSelfService(p),
        // H15 fix: owner open/closed override — null means "use Google", true/false = owner override
        ownerIsOpen: dbGym?.is_accepting_bookings ?? null,
      },
      pricing: {
        // C6 fix: Use owner-set price if available, otherwise PPP default
        dayPassPrice: calculateGymPrice({
          gymDayPassPrice: dbGym?.day_pass_price,
          countryCode: gymCountry,
          passType: 'day',
        }).amount,
        currency: gymCurrency.currency.toUpperCase(),
        currencySymbol: gymCurrency.symbol,
        source: (dbGym?.day_pass_price > 0) ? 'owner_price' : 'ppp_default',
      },
      rating: {
        google: p.rating || null,
        googleTotal: p.user_ratings_total || 0,
        scangym: scangymRating,
      },
      photos: (p.photos || []).slice(0, 15).map(photo => ({
        url: photoUrl(photo.photo_reference, 1200),
        thumbnail: photoUrl(photo.photo_reference, 400),
        width: photo.width,
        height: photo.height,
        attribution: photo.html_attributions?.[0] || null,
      })),
      openingHours: p.opening_hours ? {
        isOpen: p.opening_hours.open_now ?? null,
        weekday: p.opening_hours.weekday_text || [],
        periods: p.opening_hours.periods || [],
      } : null,
      reviews: {
        google: (p.reviews || []).map(r => ({
          author: r.author_name,
          authorPhoto: r.profile_photo_url,
          rating: r.rating,
          text: r.text,
          relativeTime: r.relative_time_description,
          source: 'google',
        })),
        scangym: scangymReviews,
      },
      map: {
        embedUrl: `/api/map-embed?place_id=${encodeURIComponent(placeId)}`,
        directionsUrl: geo.lat && geo.lng
          ? `https://www.google.com/maps/dir/?api=1&destination=${geo.lat},${geo.lng}&destination_place_id=${placeId}`
          : null,
      },
      source: 'google_places_live',
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Place details error:', err);
    res.status(500).json({ error: 'Failed to fetch place details' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/live/ensure-gym — Create gym in DB if not exists
// Called before booking so we have a local record
// ═══════════════════════════════════════════════════════════════
router.post('/ensure-gym', optionalAuth, async (req, res) => {
  try {
    const { placeId } = req.body;
    if (!placeId) return res.status(400).json({ error: 'placeId required' });

    // Check if already in DB
    const existing = await pool.query('SELECT id, name FROM gyms WHERE place_id = $1', [placeId]);
    if (existing.rows.length > 0) {
      return res.json({ gymId: existing.rows[0].id, name: existing.rows[0].name, created: false });
    }

    // Fetch from Google Places to get full details (C6: price_level, C7: address_components for country)
    const fields = 'name,formatted_address,formatted_phone_number,geometry,rating,user_ratings_total,types,website,price_level,address_components';
    const url = `${BASE_URL}/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.result) {
      return res.status(404).json({ error: 'Place not found on Google' });
    }

    const p = data.result;
    const geo = p.geometry?.location || {};
    const city = extractCity(p.formatted_address);

    // C7 fix: Extract country from address_components (most reliable) or formatted_address
    let gymCountry = 'GB';
    const countryComponent = (p.address_components || []).find(c => (c.types || []).includes('country'));
    if (countryComponent && countryComponent.short_name) {
      gymCountry = countryComponent.short_name.toUpperCase();
    } else {
      gymCountry = extractCountryCode(p.formatted_address);
    }
    const gymCurrency = getCurrencyForCountry(gymCountry);

    // v4.0: Flat £4.49 base, PPP-adjusted by gym country
    const gymPrice = getDayPassPrice(gymCountry).amount;

    // Create slug
    const slug = (p.name || 'gym').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s-]+/g, '-')
      .slice(0, 100);

    // Extract postcode (UK format)
    let zipCode = '';
    const zipMatch = (p.formatted_address || '').match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
    if (zipMatch) zipCode = zipMatch[0].toUpperCase();

    // Dynamic INSERT: query schema to only use columns that exist
    const schemaRes = await pool.query(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'gyms'`
    );
    const existingCols = new Set(schemaRes.rows.map(r => r.column_name));

    // Extract state from address_components
    const stateComp = (p.address_components || []).find(c => (c.types || []).includes('administrative_area_level_1'));
    const state = stateComp ? stateComp.short_name : '';

    // All possible columns and their values
    const allColumns = {
      name: p.name,
      description: (p.name || 'Gym') + ' — ' + (p.formatted_address || ''),
      city: city || 'Unknown',
      state: state || '',
      address: p.formatted_address,
      place_id: placeId,
      day_pass_price: gymPrice,
      currency: gymCurrency.currency.toUpperCase(),
      country: gymCountry,
      latitude: geo.lat || 0,
      longitude: geo.lng || 0,
      lat: geo.lat || 0,
      lng: geo.lng || 0,
      phone: p.formatted_phone_number || '',
      website: p.website || '',
      rating: p.rating || 0,
      average_rating: p.rating || 0,
      total_reviews: p.user_ratings_total || 0,
      zip_code: zipCode || '',
      owner_id: 'system',
      slug: slug,
      is_active: true,
      is_claimed: false,
      is_accepting_bookings: true,
      is_24h: false,
      is_self_service: false,
    };

    // Filter to only existing columns (skip id, created_at, updated_at — handled separately)
    const skipCols = new Set(['id', 'created_at', 'updated_at']);
    const insertCols = [];
    const insertVals = [];
    for (const [col, val] of Object.entries(allColumns)) {
      if (existingCols.has(col) && !skipCols.has(col)) {
        insertCols.push(col);
        insertVals.push(val);
      }
    }

    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
      `INSERT INTO gyms (${insertCols.join(', ')}, created_at, updated_at) VALUES (${placeholders}, NOW(), NOW()) RETURNING id, name`,
      insertVals
    );

    res.json({ gymId: result.rows[0].id, name: result.rows[0].name, country: gymCountry, currency: gymCurrency.currency.toUpperCase(), created: true });
  } catch (err) {
    console.error('Ensure gym error:', err);
    res.status(500).json({ error: 'Failed to create gym record', detail: err.message });
  }
});

// ─── Haversine distance in km ────────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═══════════════════════════════════════════════════════════════
// AMAZON-STYLE COMPOSITE RANKING ALGORITHM
// ═══════════════════════════════════════════════════════════════
//
// Inspired by Amazon A9/A10: "Which gym is the user most likely to book?"
//
// Score = (Distance × 40%) + (Price × 25%) + (Reviews × 25%) + (Availability × 10%)
//
// Each factor is normalized to 0–100 within the current result set,
// then weighted and combined into a single rankingScore.
//
// Why these weights?
//   • Distance (40%) — Like Amazon's "relevance", the #1 predictor of
//     gym booking is proximity. Users book the closest gym.
//   • Price (25%) — Cheaper gyms convert better, just like Amazon's
//     conversion-rate signal. Lower price = higher score.
//   • Reviews (25%) — Trust signal. Amazon found 4.5★ with 200 reviews
//     beats 5.0★ with 1 review. We use rating × log2(count + 1).
//   • Availability (10%) — Amazon penalizes out-of-stock products.
//     Gyms that are open right now get a bonus.
//
// When user coordinates are unavailable (text search without location),
// distance is excluded and remaining weights are redistributed:
//   Price 36%, Reviews 36%, Availability 28%.
// ═══════════════════════════════════════════════════════════════

function rankGyms(gyms, userLat, userLng) {
  if (!gyms || gyms.length === 0) return gyms;

  const hasCoords = userLat != null && userLng != null;

  // ── Step 1: Compute distance for every gym if user coords are available ──
  if (hasCoords) {
    for (const gym of gyms) {
      if (gym.latitude != null && gym.longitude != null && gym.distance == null) {
        gym.distance = haversineDistance(userLat, userLng, gym.latitude, gym.longitude);
        gym.distanceText = gym.distance < 1
          ? `${Math.round(gym.distance * 1000)}m`
          : `${gym.distance.toFixed(1)}km`;
      }
    }
  }

  // If only 1 gym, give it max score and return
  if (gyms.length === 1) {
    gyms[0].rankingScore = 100;
    return gyms;
  }

  // ── Step 2: Collect values for min-max normalization ──
  const distances = gyms.filter(g => g.distance != null).map(g => g.distance);
  const prices    = gyms.filter(g => g.dayPassPrice != null && g.dayPassPrice > 0).map(g => g.dayPassPrice);

  const minDist  = distances.length ? Math.min(...distances) : 0;
  const maxDist  = distances.length ? Math.max(...distances) : 0;
  const minPrice = prices.length    ? Math.min(...prices)    : 0;
  const maxPrice = prices.length    ? Math.max(...prices)    : 0;

  // Review signal: rating × log2(reviewCount + 1)
  // This means 4.5★ with 200 reviews (4.5 × 7.65 = 34.4) beats
  //            5.0★ with 1 review   (5.0 × 1.00 =  5.0)
  const reviewSignals = gyms.map(g => {
    const rating = g.rating || 0;
    const count  = g.totalReviews || 0;
    return rating * Math.log2(count + 1);
  });
  const minReview = Math.min(...reviewSignals);
  const maxReview = Math.max(...reviewSignals);

  // ── Step 3: Weights — redistribute if distance is unavailable ──
  let wDist, wPrice, wReview, wAvail;
  if (hasCoords && distances.length > 0) {
    wDist = 0.40; wPrice = 0.25; wReview = 0.25; wAvail = 0.10;
  } else {
    // No distance data — redistribute 40% across the others
    wDist = 0; wPrice = 0.36; wReview = 0.36; wAvail = 0.28;
  }

  // ── Step 4: Score each gym ──
  gyms.forEach((gym, i) => {
    let score = 0;

    // Distance: closest = 100, farthest = 0
    if (wDist > 0 && gym.distance != null) {
      const norm = (maxDist > minDist)
        ? 1 - (gym.distance - minDist) / (maxDist - minDist)
        : 1; // All same distance → all get max
      score += norm * 100 * wDist;
    }

    // Price: cheapest = 100, most expensive = 0
    if (gym.dayPassPrice != null && gym.dayPassPrice > 0) {
      const norm = (maxPrice > minPrice)
        ? 1 - (gym.dayPassPrice - minPrice) / (maxPrice - minPrice)
        : 1;
      score += norm * 100 * wPrice;
    }

    // Reviews: highest signal = 100, lowest = 0
    const reviewSig = reviewSignals[i];
    if (maxReview > minReview) {
      const norm = (reviewSig - minReview) / (maxReview - minReview);
      score += norm * 100 * wReview;
    } else if (maxReview > 0) {
      score += 100 * wReview; // All same → all get max
    }

    // Availability: open now = full bonus
    if (gym.openNow === true) {
      score += 100 * wAvail;
    }

    gym.rankingScore = Math.round(score * 10) / 10; // 1 decimal place
  });

  // ── Step 5: Sort by ranking score (highest first) ──
  gyms.sort((a, b) => (b.rankingScore || 0) - (a.rankingScore || 0));

  return gyms;
}

module.exports = router;
