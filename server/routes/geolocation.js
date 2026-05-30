/**
 * ═══════════════════════════════════════════════════════════════
 *  GEOLOCATION API — Uber-Grade Location Detection
 * ═══════════════════════════════════════════════════════════════
 * 
 * Implements all 5 Uber location techniques:
 *   1. Parallel Signal Race — IP + GPS + WiFi fire simultaneously
 *   2. Location Caching — server-side last-known-location cache
 *   3. H3 Hex Grid Indexing — O(1) spatial lookups for nearby gyms
 *   4. In-Memory IP-to-City — geoip-lite for <1ms IP resolution
 *   5. Predictive Pre-Loading — time-of-day based location prediction
 * 
 * ENDPOINTS:
 *   GET  /api/geolocation/auto-city    → instant city from IP (<5ms)
 *   POST /api/geolocation              → full geolocation (WiFi + cell + IP)
 *   POST /api/geolocation/ip           → IP-only fallback
 *   GET  /api/geolocation/nearby-h3    → H3 hex-grid nearby gym lookup
 *   POST /api/geolocation/predict      → predictive location for returning users
 *   POST /api/geolocation/cache        → store last known location
 *   GET  /api/geolocation/cache        → retrieve cached location
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();

// ─── Technique #4: In-Memory IP-to-City (geoip-lite bundles MaxMind DB) ───
let geoip;
try {
  geoip = require('geoip-lite');
  console.log('[Geolocation] ✅ geoip-lite loaded — in-memory IP lookups active (<1ms)');
} catch (e) {
  console.warn('[Geolocation] ⚠️ geoip-lite not available, falling back to external APIs');
  geoip = null;
}

// ─── Technique #3: H3 Hex Grid Indexing ───
let h3;
try {
  h3 = require('h3-js');
  console.log('[Geolocation] ✅ h3-js loaded — hex grid spatial indexing active');
} catch (e) {
  console.warn('[Geolocation] ⚠️ h3-js not available, falling back to distance queries');
  h3 = null;
}

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_GEO_URL = 'https://www.googleapis.com/geolocation/v1/geolocate';

// ─── Technique #2: Server-Side Location Cache ───
// In-memory cache keyed by session/IP. In production, use Redis.
const locationCache = new Map();
const CACHE_TTL_ACTIVE = 5 * 60 * 1000;   // 5 min for active users
const CACHE_TTL_RETURN = 30 * 60 * 1000;   // 30 min for returning users
const MAX_CACHE_SIZE = 10000;

function getCacheKey(req) {
  // Use session ID if available, otherwise IP
  return req.sessionID || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

function getCachedLocation(req) {
  const key = getCacheKey(req);
  const cached = locationCache.get(key);
  if (!cached) return null;
  const age = Date.now() - cached.timestamp;
  const ttl = cached.isActive ? CACHE_TTL_ACTIVE : CACHE_TTL_RETURN;
  if (age > ttl) {
    locationCache.delete(key);
    return null;
  }
  return { ...cached, age_ms: age, from_cache: true };
}

function setCachedLocation(req, location, isActive = true) {
  // Evict oldest if cache is full
  if (locationCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = locationCache.keys().next().value;
    locationCache.delete(oldestKey);
  }
  const key = getCacheKey(req);
  locationCache.set(key, {
    ...location,
    timestamp: Date.now(),
    isActive,
  });
}

// ─── Technique #5: Predictive Pre-Loading ───
// Simple time-of-day prediction: morning = home, evening = work
const predictionCache = new Map();
const PREDICTION_MAX = 5000;

function getPredictedLocation(req) {
  const key = getCacheKey(req);
  const history = predictionCache.get(key);
  if (!history || history.length === 0) return null;

  const now = new Date();
  const hour = now.getHours();
  const dayType = (now.getDay() === 0 || now.getDay() === 6) ? 'weekend' : 'weekday';

  // Find best matching historical location for this time slot
  const timeSlot = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  
  // Filter history to matching time slots, prefer same dayType
  const matches = history.filter(h => h.timeSlot === timeSlot);
  const exactMatches = matches.filter(h => h.dayType === dayType);
  
  const best = exactMatches.length > 0 ? exactMatches[exactMatches.length - 1] : 
               matches.length > 0 ? matches[matches.length - 1] : 
               history[history.length - 1];
  
  return {
    lat: best.lat,
    lng: best.lng,
    city: best.city,
    query: best.query || `gyms in ${best.city}`,
    source: 'prediction',
    confidence: exactMatches.length > 2 ? 'high' : matches.length > 1 ? 'medium' : 'low',
    based_on: `${history.length} past searches`,
  };
}

function recordLocationForPrediction(req, location) {
  if (predictionCache.size >= PREDICTION_MAX) {
    const oldestKey = predictionCache.keys().next().value;
    predictionCache.delete(oldestKey);
  }
  const key = getCacheKey(req);
  const history = predictionCache.get(key) || [];
  const now = new Date();
  const hour = now.getHours();
  
  history.push({
    lat: location.lat,
    lng: location.lng,
    city: location.city,
    query: location.query,
    timeSlot: hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening',
    dayType: (now.getDay() === 0 || now.getDay() === 6) ? 'weekend' : 'weekday',
    timestamp: Date.now(),
  });
  
  // Keep last 20 entries per user
  if (history.length > 20) history.shift();
  predictionCache.set(key, history);
}

// ─── Technique #4: In-Memory IP Lookup (<1ms) ───
function lookupIpInMemory(ip) {
  if (!geoip) return null;
  // Skip local IPs
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.')) return null;
  
  const geo = geoip.lookup(ip);
  if (!geo || !geo.ll || !geo.city) return null;
  
  return {
    city: geo.city,
    region: geo.region,
    country: geo.country,
    lat: geo.ll[0],
    lng: geo.ll[1],
    query: `gyms in ${geo.city}`,
    source: 'geoip_inmemory',
    lookup_ms: 0, // <1ms, effectively instant
  };
}

// ─── Technique #3: H3 Hex Grid Nearby Lookup ───
// H3 resolution 7 ≈ 5.16 km² hexagons — ideal for city-level gym search
const H3_RESOLUTION = 7;
const H3_RING_SIZE = 2; // 2-ring = ~15km radius

// In-memory H3 index of known gym locations (populated from DB)
let h3GymIndex = new Map(); // hex_id -> [gym_ids]
let h3IndexBuilt = false;

async function buildH3Index(pool) {
  if (!h3 || h3IndexBuilt) return;
  try {
    const result = await pool.query('SELECT id, name, latitude, longitude FROM gyms WHERE latitude IS NOT NULL AND longitude IS NOT NULL');
    h3GymIndex = new Map();
    for (const gym of result.rows) {
      const hexId = h3.latLngToCell(parseFloat(gym.latitude), parseFloat(gym.longitude), H3_RESOLUTION);
      if (!h3GymIndex.has(hexId)) h3GymIndex.set(hexId, []);
      h3GymIndex.get(hexId).push({ id: gym.id, name: gym.name, lat: parseFloat(gym.latitude), lng: parseFloat(gym.longitude) });
    }
    h3IndexBuilt = true;
    console.log(`[Geolocation] ✅ H3 index built: ${result.rows.length} gyms across ${h3GymIndex.size} hex cells`);
  } catch (e) {
    console.warn('[Geolocation] H3 index build failed:', e.message);
  }
}

function findGymsInH3Ring(lat, lng) {
  if (!h3 || !h3IndexBuilt) return null;
  const centerHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);
  const ring = h3.gridDisk(centerHex, H3_RING_SIZE);
  
  const nearbyGyms = [];
  for (const hexId of ring) {
    const gyms = h3GymIndex.get(hexId);
    if (gyms) nearbyGyms.push(...gyms);
  }
  return nearbyGyms;
}

// ─── External API Fallbacks ───
async function tryGoogleGeolocation(requestBody) {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const response = await fetch(`${GOOGLE_GEO_URL}?key=${GOOGLE_MAPS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return { lat: data.location.lat, lng: data.location.lng, accuracy: data.accuracy, source: 'google_geolocation' };
  } catch (error) { return null; }
}

async function tryIpApi() {
  try {
    const response = await fetch('https://ipapi.co/json/', {
      headers: { 'User-Agent': 'ScanGym/1.0' },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.latitude || !data.longitude) return null;
    return { lat: data.latitude, lng: data.longitude, accuracy: 5000, source: 'ipapi_co', city: data.city };
  } catch (error) { return null; }
}

async function tryIpApiCom() {
  try {
    const response = await fetch('http://ip-api.com/json/?fields=lat,lon,city,regionName,country,status', {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status !== 'success') return null;
    return { lat: data.lat, lng: data.lon, accuracy: 10000, source: 'ip_api_com', city: data.city };
  } catch (error) { return null; }
}

async function geolocate(googleBody) {
  const google = await tryGoogleGeolocation(googleBody);
  if (google) return google;
  const ipapi = await tryIpApi();
  if (ipapi) return ipapi;
  const ipApiCom = await tryIpApiCom();
  if (ipApiCom) return ipApiCom;
  return null;
}

// ════════════════════════════════════════════════════════════════
//  ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/geolocation/auto-city
 * UBER TECHNIQUE #1 + #2 + #4: Instant city detection
 * Priority: Cache → In-Memory GeoIP → External API → Default
 * Target: <5ms with geoip-lite, <200ms with external API
 */
router.get('/auto-city', async (req, res) => {
  const start = Date.now();
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

    // 0. Cloudflare geolocation headers (FREE, 0ms — injected by CF edge)
    // Enable: Cloudflare Dashboard → Rules → Transform Rules → Managed Transforms → "Add visitor location headers"
    const cfCity = req.headers['cf-ipcity'];
    const cfCountry = req.headers['cf-ipcountry'];
    const cfLat = req.headers['cf-iplatitude'];
    const cfLng = req.headers['cf-iplongitude'];
    if (cfCity && cfCity !== 'XX') {
      const result = {
        city: cfCity, country: cfCountry || '',
        lat: cfLat ? parseFloat(cfLat) : null, lng: cfLng ? parseFloat(cfLng) : null,
        query: `gyms in ${cfCity}`, source: 'cloudflare_edge',
        resolve_ms: 0,
      };
      setCachedLocation(req, result);
      recordLocationForPrediction(req, result);
      return res.json(result);
    }

    // 1. Check cache first (Technique #2)
    const cached = getCachedLocation(req);
    if (cached) {
      return res.json({
        city: cached.city, region: cached.region, country: cached.country,
        lat: cached.lat, lng: cached.lng,
        query: cached.query || `gyms in ${cached.city}`,
        source: 'cache', original_source: cached.source,
        resolve_ms: Date.now() - start,
      });
    }

    // 2. In-memory GeoIP lookup (Technique #4: <1ms)
    const inMemory = lookupIpInMemory(ip);
    if (inMemory) {
      const result = {
        city: inMemory.city, region: inMemory.region, country: inMemory.country,
        lat: inMemory.lat, lng: inMemory.lng,
        query: inMemory.query, source: 'geoip_inmemory',
        resolve_ms: Date.now() - start,
      };
      setCachedLocation(req, result);
      recordLocationForPrediction(req, result);
      return res.json(result);
    }

    // 3. Check prediction (Technique #5)
    const predicted = getPredictedLocation(req);
    if (predicted && predicted.confidence !== 'low') {
      const result = {
        city: predicted.city, lat: predicted.lat, lng: predicted.lng,
        query: predicted.query, source: 'prediction',
        confidence: predicted.confidence,
        resolve_ms: Date.now() - start,
      };
      setCachedLocation(req, result);
      return res.json(result);
    }

    // 4. External API fallback (Technique #1: parallel race)
    const [ipapiResult, ipApiComResult] = await Promise.allSettled([
      tryIpApi(), tryIpApiCom()
    ]);

    const extResult = ipapiResult.value || ipApiComResult.value;
    if (extResult && extResult.city) {
      const result = {
        city: extResult.city, lat: extResult.lat, lng: extResult.lng,
        query: `gyms in ${extResult.city}`, source: extResult.source,
        resolve_ms: Date.now() - start,
      };
      setCachedLocation(req, result);
      recordLocationForPrediction(req, result);
      return res.json(result);
    }

    // 5. Default fallback
    res.json({
      city: 'London', region: 'England', country: 'United Kingdom',
      lat: 51.5074, lng: -0.1278,
      query: 'gyms in London', source: 'default',
      resolve_ms: Date.now() - start,
    });
  } catch (error) {
    console.error('[Geolocation/auto-city] Error:', error.message);
    res.json({ city: 'London', query: 'gyms in London', source: 'default' });
  }
});

/**
 * POST /api/geolocation
 * TECHNIQUE #1: Parallel Signal Race — WiFi + Cell + IP simultaneously
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const requestBody = { considerIp: true };

    if (req.body?.wifiAccessPoints?.length > 0) {
      requestBody.wifiAccessPoints = req.body.wifiAccessPoints;
    }
    if (req.body?.cellTowers?.length > 0) {
      requestBody.cellTowers = req.body.cellTowers;
    }

    // Technique #1: Fire ALL sources in parallel
    const [googleResult, inMemoryResult, ipapiResult, ipApiComResult] = await Promise.allSettled([
      tryGoogleGeolocation(requestBody),
      Promise.resolve(lookupIpInMemory(ip)),
      tryIpApi(),
      tryIpApiCom(),
    ]);

    // Pick best result (Google > in-memory > external APIs)
    const result = googleResult.value || inMemoryResult.value || ipapiResult.value || ipApiComResult.value;

    if (!result) {
      return res.status(503).json({ error: 'All geolocation services failed' });
    }

    result.resolve_ms = Date.now() - start;
    
    // Cache result (Technique #2)
    setCachedLocation(req, result, true);
    recordLocationForPrediction(req, result);
    
    res.json(result);
  } catch (error) {
    console.error('[Geolocation] Server error:', error.message);
    res.status(500).json({ error: 'Geolocation service error' });
  }
});

/**
 * POST /api/geolocation/ip
 * IP-only geolocation — uses in-memory GeoIP first
 */
router.post('/ip', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    
    // In-memory first (Technique #4)
    const inMemory = lookupIpInMemory(ip);
    if (inMemory) return res.json(inMemory);

    const result = await geolocate({ considerIp: true });
    if (!result) return res.status(503).json({ error: 'All IP geolocation services failed' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'IP geolocation service error' });
  }
});

/**
 * GET /api/geolocation/nearby-h3
 * TECHNIQUE #3: H3 Hex Grid Nearby Lookup — O(1) spatial query
 * Query: ?lat=51.5&lng=-0.12&ring=2
 */
router.get('/nearby-h3', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const ring = parseInt(req.query.ring) || H3_RING_SIZE;

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    if (!h3) {
      return res.json({ gyms: [], source: 'h3_unavailable', fallback: true });
    }

    // Build index on first request if not built
    if (!h3IndexBuilt && req.app.locals.pool) {
      await buildH3Index(req.app.locals.pool);
    }

    const centerHex = h3.latLngToCell(lat, lng, H3_RESOLUTION);
    const hexRing = h3.gridDisk(centerHex, ring);
    
    const nearbyGyms = [];
    for (const hexId of hexRing) {
      const gyms = h3GymIndex.get(hexId);
      if (gyms) nearbyGyms.push(...gyms);
    }

    // Sort by distance from center
    nearbyGyms.sort((a, b) => {
      const distA = Math.pow(a.lat - lat, 2) + Math.pow(a.lng - lng, 2);
      const distB = Math.pow(b.lat - lat, 2) + Math.pow(b.lng - lng, 2);
      return distA - distB;
    });

    res.json({
      gyms: nearbyGyms.slice(0, 50),
      total: nearbyGyms.length,
      hex_center: centerHex,
      hex_ring_size: ring,
      hex_cells_searched: hexRing.length,
      source: 'h3_index',
    });
  } catch (error) {
    console.error('[Geolocation/nearby-h3] Error:', error.message);
    res.json({ gyms: [], source: 'error', error: error.message });
  }
});

/**
 * POST /api/geolocation/predict
 * TECHNIQUE #5: Predictive Pre-Loading — returns predicted location based on time-of-day patterns
 */
router.post('/predict', (req, res) => {
  const predicted = getPredictedLocation(req);
  if (predicted) {
    return res.json(predicted);
  }
  // No prediction data yet — fall back to auto-city
  res.json({ source: 'no_prediction', fallback: '/api/geolocation/auto-city' });
});

/**
 * POST /api/geolocation/cache — store current location (Technique #2)
 * Body: { lat, lng, city, query }
 */
router.post('/cache', (req, res) => {
  const { lat, lng, city, query } = req.body || {};
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  
  const location = { lat, lng, city, query: query || `gyms in ${city}`, source: 'client_reported' };
  setCachedLocation(req, location, true);
  recordLocationForPrediction(req, location);
  
  res.json({ cached: true, ttl_seconds: CACHE_TTL_ACTIVE / 1000 });
});

/**
 * GET /api/geolocation/cache — retrieve cached location (Technique #2)
 */
router.get('/cache', (req, res) => {
  const cached = getCachedLocation(req);
  if (cached) return res.json(cached);
  res.json({ cached: false });
});

// ─── H3 Index Builder Hook ───
// Called from server.js after DB pool is ready
router.buildH3Index = buildH3Index;

module.exports = router;
