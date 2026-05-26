/**
 * ═══════════════════════════════════════════════════════════════
 *  GEOLOCATION API — Server Route (Express.js)
 * ═══════════════════════════════════════════════════════════════
 * 
 * Server-side proxy for geolocation. Tries Google Maps Geolocation
 * API first (best accuracy), falls back to free IP services if
 * Google API is not enabled or fails.
 * 
 * Required by Layers 3 and 5 of the 5-layer waterfall.
 * 
 * ENDPOINTS:
 *   POST /api/geolocation     → full geolocation (WiFi + cell + IP)
 *   POST /api/geolocation/ip  → IP-only fallback (city-level)
 * 
 * FALLBACK CHAIN:
 *   1. Google Maps Geolocation API (if enabled & key set)
 *   2. ipapi.co (free, 1000 req/day)
 *   3. ip-api.com (free, 45 req/min)
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_GEO_URL = 'https://www.googleapis.com/geolocation/v1/geolocate';

/**
 * Try Google Maps Geolocation API
 * Returns { lat, lng, accuracy, source } or null on failure
 */
async function tryGoogleGeolocation(requestBody) {
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const response = await fetch(
      `${GOOGLE_GEO_URL}?key=${GOOGLE_MAPS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.warn('[Geolocation] Google API error:', response.status, err.error?.message || '');
      return null;
    }

    const data = await response.json();
    return {
      lat: data.location.lat,
      lng: data.location.lng,
      accuracy: data.accuracy,
      source: 'google_geolocation',
    };
  } catch (error) {
    console.warn('[Geolocation] Google API failed:', error.message);
    return null;
  }
}

/**
 * Try ipapi.co — free IP geolocation (1000 req/day, no key)
 * Returns { lat, lng, accuracy, source } or null on failure
 */
async function tryIpApi() {
  try {
    const response = await fetch('https://ipapi.co/json/', {
      headers: { 'User-Agent': 'ScanGym/1.0' },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.latitude || !data.longitude) return null;

    return {
      lat: data.latitude,
      lng: data.longitude,
      accuracy: 5000, // city-level ~5km
      source: 'ipapi_co',
    };
  } catch (error) {
    console.warn('[Geolocation] ipapi.co failed:', error.message);
    return null;
  }
}

/**
 * Try ip-api.com — free IP geolocation (45 req/min, no key)
 * Returns { lat, lng, accuracy, source } or null on failure
 */
async function tryIpApiCom() {
  try {
    const response = await fetch('http://ip-api.com/json/?fields=lat,lon,status', {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.status !== 'success' || !data.lat || !data.lon) return null;

    return {
      lat: data.lat,
      lng: data.lon,
      accuracy: 10000, // city-level ~10km
      source: 'ip_api_com',
    };
  } catch (error) {
    console.warn('[Geolocation] ip-api.com failed:', error.message);
    return null;
  }
}

/**
 * Run the server-side geolocation fallback chain
 */
async function geolocate(googleBody) {
  // 1. Try Google (best accuracy: ~20-200m with WiFi, ~city with IP)
  const google = await tryGoogleGeolocation(googleBody);
  if (google) return google;

  // 2. Try ipapi.co (city-level)
  const ipapi = await tryIpApi();
  if (ipapi) return ipapi;

  // 3. Try ip-api.com (city-level)
  const ipApiCom = await tryIpApiCom();
  if (ipApiCom) return ipApiCom;

  return null;
}

/**
 * POST /api/geolocation
 * Full geolocation — accepts optional WiFi/cell data for better accuracy.
 */
router.post('/', async (req, res) => {
  try {
    const requestBody = { considerIp: true };

    if (req.body && req.body.wifiAccessPoints && req.body.wifiAccessPoints.length > 0) {
      requestBody.wifiAccessPoints = req.body.wifiAccessPoints;
    }
    if (req.body && req.body.cellTowers && req.body.cellTowers.length > 0) {
      requestBody.cellTowers = req.body.cellTowers;
    }

    const result = await geolocate(requestBody);

    if (!result) {
      return res.status(503).json({ error: 'All geolocation services failed' });
    }

    res.json(result);
  } catch (error) {
    console.error('[Geolocation] Server error:', error.message);
    res.status(500).json({ error: 'Geolocation service error' });
  }
});

/**
 * POST /api/geolocation/ip
 * IP-only geolocation — Layer 5 fallback.
 * City-level accuracy (~2-10km), no permissions needed.
 */
router.post('/ip', async (req, res) => {
  try {
    const result = await geolocate({ considerIp: true });

    if (!result) {
      return res.status(503).json({ error: 'All IP geolocation services failed' });
    }

    res.json(result);
  } catch (error) {
    console.error('[Geolocation/IP] Server error:', error.message);
    res.status(500).json({ error: 'IP geolocation service error' });
  }
});

module.exports = router;
