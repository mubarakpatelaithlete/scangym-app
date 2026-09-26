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
const { nearestMetro, requestedCity } = require('../lib/search-fallback');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth, authenticateUser } = require('../middleware/auth');

const { getCurrencyForCountry, getDayPassPrice, calculateGymPrice, getAllGymPassPrices } = require('../lib/pricing-engine');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const BASE_URL = 'https://maps.googleapis.com/maps/api/place';
const PLACES_NEW_BASE = 'https://places.googleapis.com/v1/places';
const USE_PLACES_NEW_API = process.env.USE_PLACES_NEW_API === 'true';

// Partner-flow test whitelist: these queries bypass the gyms-only restriction
// so a known demo Google Business Profile can be found and claimed for testing.
const PARTNER_TEST_WHITELIST = [/maa\s*chikn/i];
const isPartnerTestQuery = (q) => !!q && PARTNER_TEST_WHITELIST.some((re) => re.test(q));

async function searchWithPlacesNewAPI(searchQuery, lat, lng, radius, maxResults = 20, anyType = false) {
  if (!GOOGLE_MAPS_API_KEY) throw new Error('No API key');
  const requestBody = { textQuery: searchQuery, maxResultCount: Math.min(maxResults, 20), languageCode: 'en' };
  if (!anyType) requestBody.includedType = 'gym';
  if (lat && lng) { requestBody.locationBias = { circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lng) }, radius: parseFloat(radius) || 20000 } }; }
  const fieldMask = ['places.id','places.displayName','places.formattedAddress','places.location','places.rating','places.userRatingCount','places.photos','places.currentOpeningHours','places.regularOpeningHours','places.types','places.internationalPhoneNumber','places.websiteUri','places.businessStatus'].join(',');
  const resp = await fetch(`${PLACES_NEW_BASE}:searchText`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': fieldMask }, body: JSON.stringify(requestBody) });
  if (!resp.ok) throw new Error(`Places New API error: ${resp.status}`);
  const data = await resp.json();
  return (data.places || []).map(p => ({ place_id: p.id, name: p.displayName?.text || '', formatted_address: p.formattedAddress || '', geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } }, rating: p.rating || 0, user_ratings_total: p.userRatingCount || 0, photos: (p.photos || []).slice(0,5).map(ph => ({ photo_reference: ph.name })), opening_hours: { open_now: p.currentOpeningHours?.openNow || false, weekday_text: p.regularOpeningHours?.weekdayDescriptions || [], periods: p.regularOpeningHours?.periods || [] }, types: p.types || ['gym'], business_status: p.businessStatus || 'OPERATIONAL', international_phone_number: p.internationalPhoneNumber || '', website: p.websiteUri || '' }));
}

// ─── Auto-migration: ensure gyms table has currency & country columns ──

const COUNTRY_NAME_TO_CODE = {
  'uk': 'GB', 'united kingdom': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
  'usa': 'US', 'united states': 'US', 'us': 'US',
  'canada': 'CA', 'australia': 'AU', 'new zealand': 'NZ',
  'germany': 'DE', 'france': 'FR', 'spain': 'ES', 'italy': 'IT',
  'netherlands': 'NL', 'belgium': 'BE', 'austria': 'AT', 'portugal': 'PT',
  'ireland': 'IE', 'greece': 'GR', 'finland': 'FI', 'croatia': 'HR',
  'switzerland': 'CH', 'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK',
  'poland': 'PL', 'czech republic': 'CZ', 'czechia': 'CZ',
  'romania': 'RO', 'hungary': 'HU', 'bulgaria': 'BG', 'iceland': 'IS',
  'united arab emirates': 'AE', 'uae': 'AE', 'saudi arabia': 'SA',
  'qatar': 'QA', 'kuwait': 'KW', 'bahrain': 'BH', 'oman': 'OM',
  'israel': 'IL', 'turkey': 'TR',
  'japan': 'JP', 'south korea': 'KR', 'india': 'IN',
  'singapore': 'SG', 'hong kong': 'HK', 'thailand': 'TH', 'malaysia': 'MY',
  'philippines': 'PH', 'vietnam': 'VN', 'indonesia': 'ID', 'china': 'CN',
  'taiwan': 'TW', 'pakistan': 'PK',
  'mexico': 'MX', 'brazil': 'BR', 'argentina': 'AR', 'colombia': 'CO',
  'chile': 'CL', 'peru': 'PE',
  'south africa': 'ZA', 'nigeria': 'NG', 'egypt': 'EG', 'kenya': 'KE',
  'morocco': 'MA', 'ghana': 'GH',
};

function extractCountryCode(formattedAddress) {
  if (!formattedAddress) return 'GB';
  const parts = formattedAddress.split(',').map(p => p.trim());
  const lastPart = (parts[parts.length - 1] || '').toLowerCase().trim();
  return COUNTRY_NAME_TO_CODE[lastPart] || 'GB';
}

const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.time > CACHE_TTL) cache.delete(k);
    }
  }
}

function photoUrl(photoRef, maxWidth = 1200) {
  return `/api/photo?ref=${encodeURIComponent(photoRef)}&maxwidth=${maxWidth}`;
}

const CHAINS_24H = [
  'puregym', 'pure gym', 'the gym group', 'the gym ', 'jd gyms', 'jd gym',
  'xercise4less', 'xercise 4 less', 'easygym', 'easy gym', 'energise fitness',
  'fit4less', 'fit 4 less', 'simply gym', 'total fitness', 'buzz gym',
  'everlast fitness', 'flyefit',
  'anytime fitness', 'planet fitness', '24 hour fitness', '24hour fitness',
  'snap fitness', 'crunch fitness', 'la fitness', 'youfit', 'workout anytime',
  'club fitness', 'chuze fitness', 'vasa fitness', 'eos fitness',
  'fitness 19', 'fitness19', 'blink fitness', 'goodlife fitness', 'world gym',
  'mcfit', 'clever fit', 'fitx', 'fitness24seven', 'fitness 24 seven',
  'basic-fit', 'basic fit', 'trainmore', 'sportcity', 'fit7',
  'john reed', 'high5', 'fitnessfirst', 'fitness first', 'bodyfit',
  'jetts fitness', 'jetts', 'plus fitness', 'anytime fitness',
  'workout 24', 'snap fitness', 'world gym', 'zap fitness',
  'joyfit', 'fastgym', 'tipness', 'gold gym', 'celebrity fitness',
  'fitness time', 'leejam', 'warehouse gym', 'gymnation',
  'smartfit', 'smart fit', 'bodytech', 'bio ritmo',
  'cult.fit', 'cultfit', 'gold gym',
  'virgin active', 'planet fitness',
  '24/7 fitness', '24seven', '24 7 fitness', 'iron 24', 'gym24', 'abs 24',
  'anytime gym', 'nonstop gym', 'non stop gym', 'nonstop fitness', 'alltime fitness',
];

const CHAINS_SELF_SERVICE = [
  'puregym', 'pure gym', 'the gym group', 'the gym ', 'jd gyms', 'jd gym',
  'xercise4less', 'xercise 4 less', 'easygym', 'easy gym', 'fit4less',
  'fit 4 less', 'simply gym', 'buzz gym', 'flyefit',
  'anytime fitness', 'snap fitness', 'planet fitness', '24 hour fitness',
  '24hour fitness', 'workout anytime', 'youfit', 'blink fitness',
  'basic-fit', 'basic fit', 'mcfit', 'clever fit', 'fitx',
  'fitness24seven', 'fitness 24 seven', 'trainmore', 'john reed',
  'vivagym', 'viva gym', 'fresh fitness', 'cleverfit', 'neoness',
  'jetts fitness', 'jetts', 'plus fitness', 'zap fitness',
  'joyfit', 'fastgym', 'anytime fitness',
  'gymnation',
  'smartfit', 'smart fit',
  '24/7 fitness', 'nonstop gym', 'non stop gym',
];

function detect24Hours(place) {
  const periods = place.opening_hours?.periods;
  if (periods && periods.length === 1) {
    const p = periods[0];
    if (p.open && p.open.day === 0 && p.open.time === '0000' && !p.close) return true;
  }
  if (periods && periods.length === 7) {
    const allDay = periods.every(p => p.open?.time === '0000' && (!p.close || p.close?.time === '2359' || p.close?.time === '0000'));
    if (allDay) return true;
  }
  const weekday = place.opening_hours?.weekday_text;
  if (weekday && weekday.length === 7 && weekday.every(d => /open 24 hours/i.test(d))) return true;
  if (weekday && weekday.length === 7 && weekday.every(d => /24/i.test(d) && /hour|heur|stund|hora|uur|tim/i.test(d))) return true;
  const name = (place.name || '').toLowerCase();
  if (CHAINS_24H.some(chain => name.includes(chain))) return true;
  if (/\b24\s*[\/\\]?\s*7\b/.test(name) || /\b24\s*h(ou)?rs?\b/i.test(name)) return true;
  if (/always\s*open/i.test(name) || /non\s*-?\s*stop/i.test(name)) return true;
  if (/\bopen\s*24\b/i.test(name) || /\b24\s*gym/i.test(name)) return true;
  const regHours = place.regularOpeningHours;
  if (regHours?.periods) {
    if (regHours.periods.length === 1) {
      const p = regHours.periods[0];
      if (p.open?.day === 0 && p.open?.hour === 0 && (p.open?.minute || 0) === 0 && !p.close) return true;
    }
  }
  return false;
}

function detectSelfService(place) {
  const name = (place.name || '').toLowerCase();
  if (CHAINS_SELF_SERVICE.some(chain => name.includes(chain))) return true;
  if (/\b(unmanned|self.service|keycard|key.fob|key.card|pin.entry|qr.entry|app.entry)\b/i.test(name)) return true;
  if (detect24Hours(place)) return true;
  return false;
}

async function searchGymsFromDatabase(searchQuery, limit = 20) {
  try {
    const q = `%${(searchQuery || '').replace(/\bgym[s]?\b/gi, '').replace(/\bin\b/gi, '').trim()}%`;
    const result = await pool.query(
      `SELECT id, name, address, city, country, lat, lng, latitude, longitude, 
              rating, average_rating, total_reviews, day_pass_price, currency,
              place_id, is_24h, is_self_service, phone, website, zip_code,
              is_accepting_bookings
       FROM gyms 
       WHERE name ILIKE $1 OR city ILIKE $1 OR address ILIKE $1
       ORDER BY rating DESC NULLS LAST, total_reviews DESC NULLS LAST
       LIMIT $2`,
      [q, limit]
    );
    if (result.rows.length === 0) {
      // Never fall back to "top rated gyms anywhere": that showed a customer searching
      // Inverness or Dubai our Bolton and Naples gyms as if they were local results.
      // Callers widen explicitly (and label it) via dbFallbackToNearestCity instead.
      console.log('[LiveSearch] no saved gyms match location:', searchQuery);
      return [];
    }
    return result.rows.map(formatDbGym);
  } catch (err) {
    console.error('[LiveSearch] Database fallback error:', err.message);
    return [];
  }
}

function formatDbGym(row) {
  const gymCountry = row.country || 'GB';
  const gymCurrency = getCurrencyForCountry(gymCountry);
  const gymPrice = getDayPassPrice(gymCountry);
  return {
    id: row.place_id || `db-${row.id}`,
    placeId: row.place_id || `db-${row.id}`,
    name: row.name || 'Unknown Gym',
    address: row.address || '',
    city: row.city || '',
    country: gymCountry,
    latitude: row.lat || row.latitude || null,
    longitude: row.lng || row.longitude || null,
    rating: row.rating || row.average_rating || null,
    totalReviews: row.total_reviews || 0,
    photo: null,
    photoReference: null,
    photos_list: [],
    types: ['gym'],
    businessStatus: 'OPERATIONAL',
    openNow: null,
    is24Hours: row.is_24h || false,
    is24h: row.is_24h || false,
    isSelfService: row.is_self_service || false,
    priceLevel: null,
    dayPassPrice: row.day_pass_price || gymPrice.amount,
    currency: row.currency || gymCurrency.currency,
    currencySymbol: gymCurrency.symbol,
    source: 'database_fallback',
  };
}

function parseSearchResult(place) {
  const geo = place.geometry?.location || {};
  const photoRef = place.photos?.[0]?.photo_reference || null;
  const photos_list = (place.photos || []).map(p => ({
    url: photoUrl(p.photo_reference, 1200),
    thumbnail: photoUrl(p.photo_reference, 400),
  }));
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
    is24h: detect24Hours(place),
    isSelfService: detectSelfService(place),
    priceLevel: place.price_level ?? null,
    dayPassPrice: gymPrice.amount,
    currency: gymCurrency.currency,
    currencySymbol: gymCurrency.symbol,
    phone: place.international_phone_number || place.formatted_phone_number || '',
    website: place.website || '',
    source: 'google_places_live',
  };
}

function extractCity(address) {
  if (!address) return '';
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 3) return parts[parts.length - 3] || parts[1] || '';
  if (parts.length >= 2) return parts[parts.length - 2] || '';
  return parts[0] || '';
}

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
    const dbMap = {};
    for (const row of result.rows) { dbMap[row.place_id] = row; }
    for (const gym of gyms) {
      const pid = gym.placeId || gym.id;
      const dbRow = dbMap[pid];
      if (!dbRow) continue;
      const ownerPrice = dbRow.day_pass_price ? parseFloat(dbRow.day_pass_price) : null;
      if (ownerPrice && ownerPrice > 0) {
        const gymPrice = calculateGymPrice({ gymDayPassPrice: ownerPrice, countryCode: gym.country || 'GB', passType: 'day' });
        gym.dayPassPrice = gymPrice.amount;
        gym.priceSource = 'owner_price';
      }
      if (dbRow.is_accepting_bookings === true) { gym.openNow = true; gym.ownerIsOpen = true; }
      else if (dbRow.is_accepting_bookings === false) { gym.openNow = false; gym.ownerIsOpen = false; }
      if (dbRow.is_24h === true) { gym.is24Hours = true; gym.is24h = true; }
      if (dbRow.is_24h === false) { gym.is24Hours = false; gym.is24h = false; }
      if (dbRow.is_self_service === true) gym.isSelfService = true;
      if (dbRow.is_self_service === false) gym.isSelfService = false;
    }
  } catch (e) {
    console.error('[enrichGymsWithDbPrices] DB lookup error:', e.message);
  }
  return gyms;
}

const BOOKING_BUCKETS = [5000, 2000, 1000, 500, 200, 100, 50, 10];
function bucketLabel(count) {
  for (const b of BOOKING_BUCKETS) {
    if (count >= b) return b >= 1000 ? `${b / 1000}K+` : `${b}+`;
  }
  return null;
}
async function enrichGymsWithBookingCounts(gyms) {
  if (!gyms || gyms.length === 0) return gyms;
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
      for (const row of result.rows) { dbCounts[row.place_id] = parseInt(row.booking_count) || 0; }
    }
  } catch (e) {
    console.error('[enrichBookingCounts] DB error:', e.message);
  }
  // Only real bookings are shown. A gym with no bookings in the last 30 days gets no
  // count at all — never a number invented from its place ID. Fabricated social proof
  // on a payment screen is a trust problem and, in the UK, a CMA/DMCC one.
  for (const gym of gyms) {
    const pid = gym.placeId || gym.id;
    const realCount = dbCounts[pid];
    if (realCount !== undefined && realCount > 0) {
      gym.bookedThisMonth = realCount;
      gym.bookedBucket = bucketLabel(realCount);
      gym.bookedIsReal = true;
    } else {
      gym.bookedThisMonth = 0;
      gym.bookedBucket = null;
      gym.bookedIsReal = false;
    }
  }
  return gyms;
}


/**
 * The visitor's own town has no gyms. Offer the nearest city that does, and label it honestly
 * so nobody thinks they are looking at something round the corner.
 */
async function fallbackToNearestCity(searchQuery, lat, lng) {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const asked = requestedCity(searchQuery);
  const metro = nearestMetro(lat, lng);
  if (!metro || !metro.city) return null;
  if (asked && asked.toLowerCase() === metro.city.toLowerCase()) return null; // already there
  try {
    const url = `${BASE_URL}/textsearch/json?query=${encodeURIComponent('gym in ' + metro.city)}&type=gym&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data || data.status !== 'OK' || !(data.results || []).length) return null;
    const gyms = data.results.filter(p => p.business_status !== 'CLOSED_PERMANENTLY').map(parseSearchResult);
    await Promise.all([enrichGymsWithDbPrices(gyms), enrichGymsWithBookingCounts(gyms)]);
    rankGyms(gyms, metro.lat, metro.lng);
    console.log(`[LiveSearch] "${searchQuery}" had nothing; offering ${metro.city} instead`);
    return {
      gyms,
      total: gyms.length,
      nextPageToken: null,
      query: 'gyms in ' + metro.city,
      source: 'nearest_city_fallback',
      fallback: { requested: asked, city: metro.city, distanceKm: metro.distanceKm },
    };
  } catch (err) {
    console.warn('[LiveSearch] fallback city search failed:', err.message);
    return null;
  }
}

/**
 * The same honest widening as fallbackToNearestCity, but served from our own gyms table so
 * it still works when Google Places is unavailable (billing disabled, quota, outage).
 * The response names the city actually searched, so the UI can say "nothing in Inverness —
 * here is London" rather than presenting distant gyms as local ones.
 */
async function dbFallbackToNearestCity(searchQuery, lat, lng) {
  const asked = requestedCity(searchQuery);
  const metro = nearestMetro(lat, lng);
  if (!metro || !metro.city) return null;
  if (asked && asked.toLowerCase() === metro.city.toLowerCase()) return null;
  const gyms = await searchGymsFromDatabase(metro.city);
  if (!gyms.length) return null;
  console.log(`[LiveSearch] "${searchQuery}" had no saved gyms; offering ${metro.city} from the database`);
  return {
    gyms,
    total: gyms.length,
    nextPageToken: null,
    query: 'gyms in ' + metro.city,
    source: 'database_nearest_city_fallback',
    fallback: { requested: asked, city: metro.city, distanceKm: metro.distanceKm },
  };
}

router.get('/search', async (req, res) => {
  try {
    const { q, query, pagetoken, type, lat, lng, radius, filter24h, filterSelfService } = req.query;
    let searchQuery = q || query;

    if (!searchQuery && !pagetoken) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.log('[LiveSearch] No API key configured, falling back to database');
      const fallbackGyms = await searchGymsFromDatabase(searchQuery);
      if (fallbackGyms.length > 0) {
        return res.json({ gyms: fallbackGyms, total: fallbackGyms.length, nextPageToken: null, query: searchQuery, source: 'database_fallback' });
      }
      const widened = await dbFallbackToNearestCity(searchQuery, req.query.lat, req.query.lng);
      if (widened) return res.json({ ...widened, liveSearchUnavailable: true });
      return res.status(503).json({ error: 'search_unavailable', message: 'Gym search is temporarily unavailable.' });
    }

    // #11: Places API (New) fast-path
    if (USE_PLACES_NEW_API && !pagetoken && searchQuery) {
      try {
        let newGyms = await searchWithPlacesNewAPI(searchQuery, lat, lng, radius, 20, isPartnerTestQuery(searchQuery));
        if (newGyms.length > 0) {
          newGyms = newGyms.map(parseSearchResult);
          await Promise.all([enrichGymsWithDbPrices(newGyms), enrichGymsWithBookingCounts(newGyms)]);
          if (filter24h === 'true') newGyms = newGyms.filter(g => g.is24Hours === true);
          if (filterSelfService === 'true') newGyms = newGyms.filter(g => g.isSelfService === true);
          rankGyms(newGyms, lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null);
          console.log(`[Places New API] Served ${newGyms.length} gyms for "${searchQuery}"`);
          return res.json({ gyms: newGyms, total: newGyms.length, nextPageToken: null, query: searchQuery, source: 'google_places_new_api' });
        }
      } catch (newApiErr) {
        console.warn('[Places New API] Error, falling back to legacy API:', newApiErr.message);
      }
    }

    if (filter24h === 'true' && searchQuery && !searchQuery.toLowerCase().includes('24')) {
      searchQuery = searchQuery + ' 24 hour';
    }

    const cacheKey = `search:${searchQuery}:${pagetoken || ''}:${lat || ''}:${lng || ''}:24h=${filter24h || ''}:ss=${filterSelfService || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    let url;
    if (pagetoken) {
      url = `${BASE_URL}/textsearch/json?pagetoken=${pagetoken}&key=${GOOGLE_MAPS_API_KEY}`;
    } else {
      let q = searchQuery;
      const partnerTest = isPartnerTestQuery(searchQuery);
      if (!partnerTest && !q.toLowerCase().includes('gym') && !q.toLowerCase().includes('fitness') && !q.toLowerCase().includes('sport')) {
        q = `gym in ${q}`;
      }
      const encoded = encodeURIComponent(q);
      const typeParam = type || 'gym';
      url = `${BASE_URL}/textsearch/json?query=${encoded}${partnerTest ? '' : `&type=${typeParam}`}&key=${GOOGLE_MAPS_API_KEY}`;
      if (lat && lng) {
        const r = radius || 20000;
        url += `&location=${lat},${lng}&radius=${r}`;
      }
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
        url += '&region=gb';
      }
    }

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
          console.log('[LiveSearch] Fetch failed, falling back to database for:', searchQuery);
          const fetchFallbackGyms = await searchGymsFromDatabase(searchQuery);
          if (fetchFallbackGyms.length > 0) {
            return res.json({ gyms: fetchFallbackGyms, total: fetchFallbackGyms.length, nextPageToken: null, query: searchQuery, source: 'database_fallback' });
          }
          return res.json({ gyms: [], total: 0, nextPageToken: null, query: searchQuery, source: 'google_places_live', error: 'Search temporarily unavailable' });
        }
        continue;
      }
      if (data.status !== 'INVALID_REQUEST' || !pagetoken) break;
    }

    if (!data || data.status === 'ZERO_RESULTS') {
      const fb = await fallbackToNearestCity(searchQuery, lat, lng);
      if (fb) return res.json(fb);
      const result = { gyms: [], total: 0, nextPageToken: null, query: searchQuery, source: 'google_places_live' };
      return res.json(result);
    }

    if (data.status !== 'OK') {
      console.error('Google Places Text Search error:', data.status, data.error_message);
      console.log('[LiveSearch] Falling back to database search for:', searchQuery);
      const fallbackGyms = await searchGymsFromDatabase(searchQuery);
      if (fallbackGyms.length > 0) {
        const result = { gyms: fallbackGyms, total: fallbackGyms.length, nextPageToken: null, query: searchQuery, source: 'database_fallback' };
        return res.json(result);
      }
      const widenedDb = await dbFallbackToNearestCity(searchQuery, lat, lng);
      if (widenedDb) return res.json({ ...widenedDb, liveSearchUnavailable: true, error: data.status });
      return res.json({ gyms: [], total: 0, nextPageToken: null, query: searchQuery, source: 'google_places_live', error: data.status });
    }

    let gyms = (data.results || [])
      .filter(p => p.business_status !== 'CLOSED_PERMANENTLY')
      .map(parseSearchResult);

    await Promise.all([
      enrichGymsWithDbPrices(gyms),
      enrichGymsWithBookingCounts(gyms)
    ]);

    if (filter24h === 'true') {
      gyms = gyms.filter(g => g.is24Hours === true);
    }
    if (filterSelfService === 'true') {
      gyms = gyms.filter(g => g.isSelfService === true);
    }

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;
    rankGyms(gyms, userLat, userLng);

    const MAX_SEARCH_DISTANCE_KM = 50;
    let filteredGyms = gyms.filter(g => g.distance == null || g.distance <= MAX_SEARCH_DISTANCE_KM);

    // Widen before surrendering. An empty screen loses the visitor; a gym 60km away, clearly
    // labelled, at least keeps the promise that ScanGym has something for them.
    let widened = null;
    if (filteredGyms.length === 0 && gyms.length > 0) {
      filteredGyms = gyms;
      widened = { reason: 'distance', from: MAX_SEARCH_DISTANCE_KM };
    }

    const result = {
      gyms: filteredGyms,
      total: filteredGyms.length,
      widened,
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

// ── Partner search helpers ──────────────────────────────────────────
// Google's text search ranks by global prominence, so a small local gym
// searched by name alone loses to famous businesses on the other side of
// the world. Two ways out: let the owner paste their Google Maps link, and
// tell them to add their town when nothing looks like a name match.
function looksLikeUrl(q) { return /^https?:\/\//i.test(q.trim()); }

async function resolvePlaceFromUrl(rawUrl) {
  const out = { placeId: null, names: [], finalUrl: null };
  try {
    const resp = await fetch(rawUrl.trim(), { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const finalUrl = resp.url || '';
    out.finalUrl = finalUrl;
    const html = await resp.text().catch(() => '');

    const pidMatch = finalUrl.match(/[?&](?:place_id|query_place_id)=([A-Za-z0-9_-]+)/);
    if (pidMatch) { out.placeId = pidMatch[1]; return out; }

    const candidates = [];
    const push = (v) => { if (v) candidates.push(String(v)); };
    const fromUrl = finalUrl.match(/\/maps\/place\/([^/@?]+)/);
    if (fromUrl) push(decodeURIComponent(fromUrl[1]));
    const qUrl = finalUrl.match(/[?&]q=([^&]+)/);
    if (qUrl) push(decodeURIComponent(qUrl[1]));
    // Client-side redirect pages keep the name in the HTML instead
    for (const m of html.matchAll(/[?&]q=([^&"'<\\]{3,120})/g)) {
      try { push(decodeURIComponent(m[1])); } catch (e) { push(m[1]); }
    }
    const title = html.match(/<title[^>]*>([^<]{3,160})</i);
    if (title) push(title[1].replace(/\s*[-–|]\s*Google\s*Maps.*$/i, ''));
    const og = html.match(/property=["']og:title["']\s+content=["']([^"']{3,160})["']/i);
    if (og) push(og[1]);

    // Keep only strings that read like a business name. Google's pages are full
    // of opaque tokens, and searching one of those finds nothing at all.
    const seen = new Set();
    out.names = candidates
      .map(c => c.replace(/\+/g, ' ').trim())
      .filter(c => {
        if (c.length < 3 || c.length > 80) return false;
        if (/^google(\s|$)/i.test(c)) return false;
        const letters = (c.match(/[a-z]/gi) || []).length;
        if (letters / c.length < 0.6) return false;
        if (!c.includes(' ') && c.length > 20) return false;
        const key = c.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
    return out;
  } catch (e) {
    console.warn('[PartnerSearch] URL resolve failed:', e.message);
    return out;
  }
}

async function placeDetailsById(placeId) {
  const fieldMask = ['id','displayName','formattedAddress','location','rating','userRatingCount','photos','currentOpeningHours','regularOpeningHours','types','internationalPhoneNumber','websiteUri','businessStatus'].join(',');
  const resp = await fetch(`${PLACES_NEW_BASE}/${encodeURIComponent(placeId)}`, { headers: { 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': fieldMask } });
  if (!resp.ok) return null;
  const p = await resp.json();
  return {
    place_id: p.id, name: p.displayName?.text || '', formatted_address: p.formattedAddress || '',
    geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } },
    rating: p.rating || 0, user_ratings_total: p.userRatingCount || 0,
    photos: (p.photos || []).slice(0, 5).map(ph => ({ photo_reference: ph.name })),
    opening_hours: { open_now: p.currentOpeningHours?.openNow || false, weekday_text: p.regularOpeningHours?.weekdayDescriptions || [], periods: p.regularOpeningHours?.periods || [] },
    types: p.types || [], business_status: p.businessStatus || 'OPERATIONAL',
    international_phone_number: p.internationalPhoneNumber || '', website: p.websiteUri || '',
  };
}

const normWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2);
function looksLikeNameMatch(query, gyms) {
  const qw = normWords(query);
  if (!qw.length) return true;
  return gyms.some(g => {
    const nw = new Set(normWords(g.name));
    const hits = qw.filter(w => nw.has(w)).length;
    return hits >= Math.max(1, Math.ceil(qw.length * 0.6));
  });
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/live/partner-search — "find MY gym" search for onboarding
// Customer search deliberately narrows to type=gym and rewrites a bare
// query to "gym in X". That is right for browsing and wrong for an owner
// typing their own business name: plenty of real gyms, studios and
// combined premises are not typed 'gym' by Google, so the owner searched
// their own gym, saw nothing, and gave up before ever reaching Verify.
// This endpoint searches the exact words the owner typed, no type filter.
// ═══════════════════════════════════════════════════════════════════
router.get('/partner-search', async (req, res) => {
  try {
    const searchQuery = (req.query.q || req.query.query || '').trim();
    if (!searchQuery) return res.status(400).json({ error: 'Query parameter "q" is required' });
    if (!GOOGLE_MAPS_API_KEY) {
      const dbGyms = await searchGymsFromDatabase(searchQuery);
      return res.json({ gyms: dbGyms, total: dbGyms.length, source: 'database' });
    }

    const { lat, lng, radius } = req.query;
    let places = [];
    let source = null;

    // Pasted a Google Maps / share link? Resolve it straight to the listing.
    if (looksLikeUrl(searchQuery)) {
      const resolved = await resolvePlaceFromUrl(searchQuery);
      if (resolved.placeId) {
        const one = await placeDetailsById(resolved.placeId);
        if (one) { places = [one]; source = 'google_maps_link'; }
      }
      for (const cand of resolved.names) {
        if (places.length) break;
        try {
          places = await searchWithPlacesNewAPI(cand, lat, lng, radius, 10, true);
          if (places.length) {
            source = 'google_maps_link';
            const target = cand.toLowerCase();
            places.sort((a, b) => (b.name.toLowerCase() === target ? 1 : 0) - (a.name.toLowerCase() === target ? 1 : 0));
          }
        } catch (e) { console.warn('[PartnerSearch] link name search failed:', e.message); }
      }
      if (!places.length) {
        return res.json({
          gyms: [], total: 0, source: 'google_maps_link',
          resolvedName: resolved.names[0] || null,
          message: resolved.names.length
            ? `That link points to "${resolved.names[0]}", which we could not find in our directory.`
            : 'We could not read that link.',
          action: 'Try your gym name plus your town, e.g. "Iron Works Bharuch".',
        });
      }
    }

    // Places API (New) — exact words, any business type.
    // Only when a pasted link has not already resolved the listing: searching
    // the raw URL text finds nothing and threw away a perfectly good result.
    if (!places.length) {
      try {
        places = await searchWithPlacesNewAPI(searchQuery, lat, lng, radius, 20, true);
        if (places.length) source = 'google_places_new_api';
      } catch (e) {
        console.warn('[PartnerSearch] New API failed, using legacy:', e.message);
      }
    }

    // Legacy text search — still no type filter, still no query rewriting
    if (!places.length) {
      let url = `${BASE_URL}/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${GOOGLE_MAPS_API_KEY}`;
      if (lat && lng) url += `&location=${lat},${lng}&radius=${radius || 20000}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
        places = data.results || [];
        if (places.length) source = 'google_places_legacy';
      } else {
        console.error('[PartnerSearch] Places error:', data.status, data.error_message || '');
      }
    }

    const gyms = places.map(parseSearchResult);

    if (!gyms.length) {
      // Say what to do instead of showing an empty list with no explanation
      return res.json({
        gyms: [],
        total: 0,
        source: source || 'google',
        message: 'We could not find your gym in our directory.',
        action: 'Try your gym name plus your town or city.',
      });
    }

    // Nothing that resembles the typed name? Google ranked famous places above
    // this owner's gym. Say so, instead of leaving them scrolling strangers.
    const payload = { gyms, total: gyms.length, query: searchQuery, source };
    if (source !== 'google_maps_link' && !looksLikeNameMatch(searchQuery, gyms)) {
      payload.weakMatch = true;
      payload.message = 'Keep scrolling \u2014 more results below.';
      payload.action = 'Still not there? Add your town or city, e.g. "your gym name Bharuch".';
    }
    res.json(payload);
  } catch (err) {
    console.error('Partner search error:', err);
    res.status(500).json({ error: 'search_failed', message: 'Could not search for your gym right now.', action: 'Try again in a moment.' });
  }
});

router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, radius = 5000, pagetoken, keyword, filter24h, filterSelfService } = req.query;

    if (!pagetoken && (!lat || !lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(503).json({ error: 'search_unavailable', message: 'Gym search is temporarily unavailable.' });
    }

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

    /* Legacy nearbysearch is REQUEST_DENIED on this key ("legacy API not
       enabled", 2026-09-26) and the Book tab fell back to 20 photo-less DB
       gyms. Places API (New) works on the same key, so use it first. */
    let data = null;
    if (USE_PLACES_NEW_API && !pagetoken) {
      try {
        const results = await searchWithPlacesNewAPI(searchKeyword, lat, lng, Math.min(parseInt(radius) || 5000, 50000), 20);
        data = { status: results.length ? 'OK' : 'ZERO_RESULTS', results };
      } catch (e) {
        console.error('[LiveSearch] Places New nearby failed, trying legacy:', e.message);
      }
    }
    if (!data) {
      const response = await fetch(url);
      data = await response.json();
    }

    if (data.status === 'ZERO_RESULTS') {
      return res.json({ gyms: [], total: 0, nextPageToken: null, source: 'google_places_live' });
    }

    if (data.status !== 'OK') {
      console.error('Google Places Nearby error:', data.status, data.error_message);
      console.log('[LiveSearch] Nearby search falling back to database');
      const fallbackGyms = await searchGymsFromDatabase('gym');
      if (fallbackGyms.length > 0) {
        return res.json({ gyms: fallbackGyms, total: fallbackGyms.length, nextPageToken: null, source: 'database_fallback' });
      }
      return res.status(502).json({ error: 'Nearby search error', details: data.status });
    }

    let gyms = (data.results || [])
      .filter(p => p.business_status !== 'CLOSED_PERMANENTLY')
      .map(parseSearchResult);

    await Promise.all([
      enrichGymsWithDbPrices(gyms),
      enrichGymsWithBookingCounts(gyms)
    ]);

    if (filter24h === 'true') {
      gyms = gyms.filter(g => g.is24Hours === true);
    }
    if (filterSelfService === 'true') {
      gyms = gyms.filter(g => g.isSelfService === true);
    }

    const searchLat = lat ? parseFloat(lat) : null;
    const searchLng = lng ? parseFloat(lng) : null;
    rankGyms(gyms, searchLat, searchLng);

    const MAX_NEARBY_DISTANCE_KM = 50;
    const filteredGyms = gyms.filter(g => g.distance == null || g.distance <= MAX_NEARBY_DISTANCE_KM);

    const result = {
      gyms: filteredGyms,
      total: filteredGyms.length,
      nextPageToken: data.next_page_token || null,
      source: 'google_places_live',
      filters: {
        is24h: filter24h === 'true',
        isSelfService: filterSelfService === 'true',
      },
    };

    setCache(cacheKey, result);
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
    res.json(result);
  } catch (err) {
    console.error('Live nearby error:', err);
    res.status(500).json({ error: 'Nearby search failed' });
  }
});

// ─── Check Availability ─────────────────────────────────────────────
// GET /api/live/check-availability?placeId=...&date=YYYY-MM-DD&time=HH:MM
// Read-only check: is a gym likely available for a given date/time?
// Does NOT create a booking or payment.
router.get('/check-availability', async (req, res) => {
  try {
    const { placeId, date, time } = req.query;
    if (!placeId || !date) {
      return res.status(400).json({ error: 'placeId and date are required' });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    }

    // Fetch gym details (reuses the place details logic)
    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(503).json({ error: 'search_unavailable', message: 'Gym search is temporarily unavailable.' });
    }

    const cacheKey = `place:${placeId}`;
    let placeData = getCached(cacheKey);

    if (!placeData) {
      placeData = await fetchPlaceForEnsure(placeId);
      if (!placeData) {
        return res.status(404).json({ error: 'Gym not found', available: false });
      }
    }

    const p = placeData.gym ? placeData : { gym: placeData };
    const gymName = p.gym?.name || placeData.name || 'Unknown Gym';
    const gymAddress = p.gym?.address || placeData.formatted_address || '';
    const gymCountry = extractCountryCode(gymAddress);
    const gymCurrency = getCurrencyForCountry(gymCountry);

    // Look up owner price from DB if available
    let ownerPrice = null;
    try {
      const dbResult = await pool.query('SELECT day_pass_price FROM gyms WHERE place_id = $1', [placeId]);
      if (dbResult.rows.length > 0 && dbResult.rows[0].day_pass_price > 0) {
        ownerPrice = parseFloat(dbResult.rows[0].day_pass_price);
      }
    } catch (e) { /* ignore DB errors */ }

    const allPrices = getAllGymPassPrices({ gymDayPassPrice: ownerPrice, countryCode: gymCountry });

    // Determine if gym is open on the requested date
    const requestedDate = new Date(date + 'T12:00:00Z');
    const dayOfWeek = requestedDate.getUTCDay(); // 0=Sun
    const hours = placeData.opening_hours || p.openingHours || {};
    const weekday = hours.weekday_text || hours.weekday || [];

    // Basic availability: we assume available unless the gym is permanently closed
    const businessStatus = placeData.business_status || p.gym?.businessStatus || 'OPERATIONAL';
    const available = businessStatus !== 'CLOSED_PERMANENTLY' && businessStatus !== 'CLOSED_TEMPORARILY';

    res.json({
      available,
      gym: {
        placeId,
        name: gymName,
        address: gymAddress,
      },
      pricing: {
        dayPass: allPrices.day.amount,
        threeDay: allPrices['3day'].amount,
        weekly: allPrices.weekly.amount,
        monthly: allPrices.monthly.amount,
        currency: gymCurrency.currency.toUpperCase(),
        currencySymbol: gymCurrency.symbol,
      },
      date,
      time: time || 'anytime',
      message: available
        ? 'This gym appears available for the requested date. Confirm details with the user before booking.'
        : 'This gym may not be available. It appears to be temporarily or permanently closed.',
    });
  } catch (err) {
    console.error('Check availability error:', err);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

router.get('/place/:placeId', optionalAuth, async (req, res) => {
  try {
    const { placeId } = req.params;

    if (!placeId || !GOOGLE_MAPS_API_KEY) {
      return res.status(400).json({ error: 'placeId required' });
    }

    const cacheKey = `place:${placeId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const p = await fetchPlaceForEnsure(placeId);
    if (!p) {
      return res.status(404).json({ error: 'Place not found' });
    }
    const geo = p.geometry?.location || {};

    let dbGym = null;
    try {
      /* `claimed_by` is the column the claim route writes and every partner
         query filters on; `is_claimed` is a legacy flag nothing sets. Reading
         only the flag made a claimed gym look free: the sheet said "unclaimed"
         while POST /api/gym-partner/claim answered 409 "already claimed". */
      const dbResult = await pool.query('SELECT id, day_pass_price, hourly_rate, is_claimed, claimed_by, is_accepting_bookings FROM gyms WHERE place_id = $1', [placeId]);
      if (dbResult.rows.length > 0) dbGym = dbResult.rows[0];
    } catch (e) {
      console.warn('[LiveSearch] Failed to fetch gym from DB by place_id:', e.message);
    }

    let scangymReviews = [];
    let scangymRating = null;
    if (dbGym) {
      try {
        // REVIEW FIX: include the reviewer's name (was anonymous) and return more rows
        const reviews = await pool.query(`
          SELECT r.rating, r.comment, r.created_at,
                 COALESCE(NULLIF(TRIM(u.first_name), ''), SPLIT_PART(u.email, '@', 1), 'ScanGym member') AS author
          FROM reviews r
          LEFT JOIN public.users u ON r.user_id::text = u.id::text
          WHERE r.gym_id = $1 ORDER BY r.created_at DESC LIMIT 10`, [dbGym.id]);
        scangymReviews = reviews.rows;
        const stats = await pool.query('SELECT AVG(rating) as avg, COUNT(*) as total FROM reviews WHERE gym_id = $1', [dbGym.id]);
        if (parseInt(stats.rows[0].total) > 0) {
          scangymRating = { average: parseFloat(parseFloat(stats.rows[0].avg).toFixed(1)), total: parseInt(stats.rows[0].total) };
        }
      } catch (e) {
        console.warn('[LiveSearch] Failed to fetch ScanGym reviews:', e.message);
      }
    }

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
        isClaimed: !!(dbGym?.claimed_by || dbGym?.is_claimed),
        is24Hours: detect24Hours(p),
        isSelfService: detectSelfService(p),
        ownerIsOpen: dbGym?.is_accepting_bookings ?? null,
      },
      pricing: (() => {
        const allPrices = getAllGymPassPrices({ gymDayPassPrice: dbGym?.day_pass_price, countryCode: gymCountry });
        return {
          dayPass: allPrices.day.amount,
          dayPassPrice: allPrices.day.amount, // backward compat
          threeDay: allPrices['3day'].amount,
          weekly: allPrices.weekly.amount,
          monthly: allPrices.monthly.amount,
          currency: gymCurrency.currency.toUpperCase(),
          currencySymbol: gymCurrency.symbol,
          surgeMultiplier: 1.0,
          source: (dbGym?.day_pass_price > 0) ? 'owner_price' : 'ppp_default',
        };
      })(),
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

/* Gym details for /ensure-gym, in the legacy Place Details shape the insert
   below expects. Search already runs on Places API (New); ensure-gym still
   called the legacy details/json endpoint, which is not enabled for this key —
   so every gym found by search but not yet in the DB came back "not_found" and
   chatbot customers saw "Couldn't set up that gym". Try New first, legacy as a
   fallback. */
async function fetchPlaceForEnsure(placeId) {
  try {
    const fieldMask = 'id,displayName,formattedAddress,nationalPhoneNumber,location,rating,userRatingCount,types,websiteUri,addressComponents,regularOpeningHours,currentOpeningHours,businessStatus,photos,reviews,googleMapsUri';
    const r = await fetch(`${PLACES_NEW_BASE}/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': fieldMask },
    });
    if (r.ok) {
      const n = await r.json();
      if (n && (n.displayName || n.formattedAddress)) {
        return {
          name: n.displayName?.text || '',
          formatted_address: n.formattedAddress || '',
          formatted_phone_number: n.nationalPhoneNumber || '',
          geometry: { location: { lat: n.location?.latitude, lng: n.location?.longitude } },
          rating: n.rating || 0,
          user_ratings_total: n.userRatingCount || 0,
          types: n.types || [],
          website: n.websiteUri || '',
          address_components: (n.addressComponents || []).map(c => ({
            long_name: c.longText, short_name: c.shortText, types: c.types || [],
          })),
          opening_hours: {
            open_now: n.currentOpeningHours?.openNow || false,
            weekday_text: n.regularOpeningHours?.weekdayDescriptions || [],
            periods: n.regularOpeningHours?.periods || [],
          },
          business_status: n.businessStatus || 'OPERATIONAL',
          photos: (n.photos || []).map(ph => ({ photo_reference: ph.name })),
          reviews: (n.reviews || []).map(r => ({
            author_name: r.authorAttribution?.displayName || '',
            rating: r.rating || 0,
            text: r.text?.text || r.originalText?.text || '',
            relative_time_description: r.relativePublishTimeDescription || '',
            time: r.publishTime ? Math.floor(new Date(r.publishTime).getTime() / 1000) : 0,
          })),
          url: n.googleMapsUri || '',
        };
      }
    } else {
      console.warn('[ensure-gym] Places New details', r.status);
    }
  } catch (e) {
    console.warn('[ensure-gym] Places New details failed:', e.message);
  }
  try {
    const fields = 'name,formatted_address,formatted_phone_number,geometry,rating,user_ratings_total,types,website,price_level,address_components,opening_hours,business_status,photos,reviews,url';
    const r = await fetch(`${BASE_URL}/details/json?place_id=${encodeURIComponent(placeId)}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`);
    const d = await r.json();
    if (d.status === 'OK' && d.result) return d.result;
    console.warn('[ensure-gym] legacy details status', d.status);
  } catch (e) {
    console.warn('[ensure-gym] legacy details failed:', e.message);
  }
  return null;
}

router.post('/ensure-gym', optionalAuth, async (req, res) => {
  try {
    const { placeId } = req.body;
    if (!placeId) return res.status(400).json({ error: 'placeId required' });

    const existing = await pool.query('SELECT id, name FROM gyms WHERE place_id = $1', [placeId]);
    if (existing.rows.length > 0) {
      return res.json({ gymId: existing.rows[0].id, name: existing.rows[0].name, created: false });
    }

    const p = await fetchPlaceForEnsure(placeId);
    if (!p) {
      return res.status(404).json({ error: 'not_found', message: 'We could not find that gym.' });
    }
    const geo = p.geometry?.location || {};
    const city = extractCity(p.formatted_address);

    let gymCountry = 'GB';
    const countryComponent = (p.address_components || []).find(c => (c.types || []).includes('country'));
    if (countryComponent && countryComponent.short_name) {
      gymCountry = countryComponent.short_name.toUpperCase();
    } else {
      gymCountry = extractCountryCode(p.formatted_address);
    }
    const gymCurrency = getCurrencyForCountry(gymCountry);
    const gymPrice = getDayPassPrice(gymCountry).amount;

    const slug = (p.name || 'gym').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s-]+/g, '-')
      .slice(0, 100);

    let zipCode = '';
    const zipMatch = (p.formatted_address || '').match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
    if (zipMatch) zipCode = zipMatch[0].toUpperCase();

    const schemaRes = await pool.query(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'gyms'`
    );
    const existingCols = new Set(schemaRes.rows.map(r => r.column_name));

    const stateComp = (p.address_components || []).find(c => (c.types || []).includes('administrative_area_level_1'));
    const state = stateComp ? stateComp.short_name : '';

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

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rankGyms(gyms, userLat, userLng) {
  if (!gyms || gyms.length === 0) return gyms;
  const hasCoords = userLat != null && userLng != null;
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
  if (gyms.length === 1) { gyms[0].rankingScore = 100; return gyms; }
  const distances = gyms.filter(g => g.distance != null).map(g => g.distance);
  const prices    = gyms.filter(g => g.dayPassPrice != null && g.dayPassPrice > 0).map(g => g.dayPassPrice);
  const minDist  = distances.length ? Math.min(...distances) : 0;
  const maxDist  = distances.length ? Math.max(...distances) : 0;
  const minPrice = prices.length    ? Math.min(...prices)    : 0;
  const maxPrice = prices.length    ? Math.max(...prices)    : 0;
  const reviewSignals = gyms.map(g => {
    const rating = g.rating || 0;
    const count  = g.totalReviews || 0;
    return rating * Math.log2(count + 1);
  });
  const minReview = Math.min(...reviewSignals);
  const maxReview = Math.max(...reviewSignals);
  let wDist, wPrice, wReview, wAvail;
  if (hasCoords && distances.length > 0) {
    wDist = 0.40; wPrice = 0.25; wReview = 0.25; wAvail = 0.10;
  } else {
    wDist = 0; wPrice = 0.36; wReview = 0.36; wAvail = 0.28;
  }
  gyms.forEach((gym, i) => {
    let score = 0;
    if (wDist > 0 && gym.distance != null) {
      const norm = (maxDist > minDist) ? 1 - (gym.distance - minDist) / (maxDist - minDist) : 1;
      score += norm * 100 * wDist;
    }
    if (gym.dayPassPrice != null && gym.dayPassPrice > 0) {
      const norm = (maxPrice > minPrice) ? 1 - (gym.dayPassPrice - minPrice) / (maxPrice - minPrice) : 1;
      score += norm * 100 * wPrice;
    }
    const reviewSig = reviewSignals[i];
    if (maxReview > minReview) {
      const norm = (reviewSig - minReview) / (maxReview - minReview);
      score += norm * 100 * wReview;
    } else if (maxReview > 0) {
      score += 100 * wReview;
    }
    if (gym.openNow === true) { score += 100 * wAvail; }
    gym.rankingScore = Math.round(score * 10) / 10;
  });
  gyms.sort((a, b) => (b.rankingScore || 0) - (a.rankingScore || 0));
  return gyms;
}

module.exports = router;
