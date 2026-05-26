/**
 * ═══════════════════════════════════════════════════════════════
 *  GOOGLE GEOLOCATION API — Server Route (Express.js)
 * ═══════════════════════════════════════════════════════════════
 * 
 * Server-side proxy for Google Maps Geolocation API.
 * Required by Layers 3 and 5 of the 5-layer waterfall.
 * 
 * INSTALLATION:
 *   1. Copy this file to: server/routes/geolocation.js
 *   2. In server.js, add:
 *        const geolocationRouter = require('./routes/geolocation');
 *      with the other imports at the top, then:
 *        app.use('/api/geolocation', geolocationRouter);
 *      with the other app.use() routes
 *   3. Make sure GOOGLE_MAPS_API_KEY is set in your environment
 *      (you already have this for Places API)
 * 
 * ENDPOINTS:
 *   POST /api/geolocation     → full geolocation (WiFi + cell + IP)
 *   POST /api/geolocation/ip  → IP-only fallback (city-level)
 * 
 * COST:
 *   ~£0.004 per request ($5 per 1,000 requests)
 *   Only hits when GPS fails, so maybe 5-10% of users = very cheap
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_GEO_URL = 'https://www.googleapis.com/geolocation/v1/geolocate';

/**
 * POST /api/geolocation
 * Full geolocation — accepts optional WiFi/cell data for better accuracy.
 * Falls back to IP geolocation if no extra data provided.
 */
router.post('/', async (req, res) => {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('[Geolocation] GOOGLE_MAPS_API_KEY not configured');
    return res.status(500).json({ error: 'Geolocation service not configured' });
  }

  try {
    // Build request — accept optional WiFi/cell data from client
    const requestBody = { considerIp: true };

    if (req.body && req.body.wifiAccessPoints && req.body.wifiAccessPoints.length > 0) {
      requestBody.wifiAccessPoints = req.body.wifiAccessPoints;
    }
    if (req.body && req.body.cellTowers && req.body.cellTowers.length > 0) {
      requestBody.cellTowers = req.body.cellTowers;
    }

    const response = await fetch(
      `${GOOGLE_GEO_URL}?key=${GOOGLE_MAPS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Geolocation] Google API error:', response.status, errorData);
      return res.status(response.status).json({
        error: 'Geolocation failed',
        detail: errorData.error ? errorData.error.message : 'Unknown error',
      });
    }

    const data = await response.json();

    res.json({
      lat: data.location.lat,
      lng: data.location.lng,
      accuracy: data.accuracy,
      source: 'google_geolocation',
    });
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
  if (!GOOGLE_MAPS_API_KEY) {
    return res.status(500).json({ error: 'Geolocation service not configured' });
  }

  try {
    const response = await fetch(
      `${GOOGLE_GEO_URL}?key=${GOOGLE_MAPS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ considerIp: true }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Geolocation/IP] Google API error:', response.status, errorData);
      return res.status(response.status).json({ error: 'IP geolocation failed' });
    }

    const data = await response.json();

    res.json({
      lat: data.location.lat,
      lng: data.location.lng,
      accuracy: data.accuracy,
      source: 'google_ip',
    });
  } catch (error) {
    console.error('[Geolocation/IP] Server error:', error.message);
    res.status(500).json({ error: 'IP geolocation service error' });
  }
});

module.exports = router;
