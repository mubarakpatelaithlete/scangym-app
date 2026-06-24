/**
 * Task 23: Post-Booking Directions — CORRECTED
 * CEO: "Option B but no button to leave our platform. Uber shows maps so
 *        accurately without leaving Uber."
 *
 * Uber-style EMBEDDED Google Map with live location + route + ETA.
 * User NEVER leaves ScanGym. No external Google Maps, Apple Maps, or Waze links.
 *
 * Task 9: Conviction model (all 33 techniques in separate routes/conviction.js)
 * Task 10: Upsells (off-peak removed — flat pricing v4.1)
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// GET /api/directions/gym/:gymId — Embedded map data for a gym (NO external links)
router.get('/gym/:gymId', optionalAuth, async (req, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    const { from_lat, from_lng, mode } = req.query;

    const gym = await pool.query('SELECT * FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });

    const g = gym.rows[0];
    const destLat = g.latitude;
    const destLng = g.longitude;

    // Build Google Maps Embed API URL (renders inside our app)
    let embedUrl = null;
    if (destLat && destLng) {
      if (from_lat && from_lng) {
        // Directions embed with origin
        embedUrl = `https://www.google.com/maps/embed/v1/directions?key=${GOOGLE_MAPS_API_KEY}&origin=${from_lat},${from_lng}&destination=${destLat},${destLng}&mode=${mode || 'driving'}`;
      } else {
        // Place embed
        embedUrl = `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=${destLat},${destLng}&zoom=16`;
      }
    } else if (g.address) {
      embedUrl = `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=${encodeURIComponent(g.address)}&zoom=16`;
    }

    // Google Directions API for route data (ETA, distance, steps)
    let routeData = null;
    if (from_lat && from_lng && destLat && destLng) {
      try {
        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${from_lat},${from_lng}&destination=${destLat},${destLng}&mode=${mode || 'driving'}&key=${GOOGLE_MAPS_API_KEY}`;
        const dirResponse = await fetch(directionsUrl);
        const dirData = await dirResponse.json();

        if (dirData.status === 'OK' && dirData.routes?.[0]) {
          const route = dirData.routes[0];
          const leg = route.legs[0];
          routeData = {
            distance: leg.distance?.text,
            distanceMeters: leg.distance?.value,
            duration: leg.duration?.text,
            durationSeconds: leg.duration?.value,
            durationInTraffic: leg.duration_in_traffic?.text || null,
            startAddress: leg.start_address,
            endAddress: leg.end_address,
            steps: leg.steps?.map(s => ({
              instruction: s.html_instructions?.replace(/<[^>]+>/g, ''),
              distance: s.distance?.text,
              duration: s.duration?.text,
              maneuver: s.maneuver || null,
            })),
            polyline: route.overview_polyline?.points,
          };
        }
      } catch (e) {
        console.error('Directions API error:', e.message);
      }
    }

    res.json({
      gymId,
      gymName: g.name,
      address: g.address,
      city: g.city,
      destination: destLat && destLng ? { lat: parseFloat(destLat), lng: parseFloat(destLng) } : null,

      // Uber-style embedded map — stays inside ScanGym
      embeddedMap: {
        embedUrl,
        apiKey: GOOGLE_MAPS_API_KEY,
        destination: destLat && destLng ? { lat: parseFloat(destLat), lng: parseFloat(destLng) } : null,
        placeId: g.place_id || null,
        zoom: 16,
      },

      // Route details (ETA, distance, turn-by-turn)
      route: routeData,

      // Rendering instructions for frontend
      renderInstructions: {
        method: 'embedded_iframe_or_js',
        note: 'NEVER open external maps apps. Render map inside ScanGym using Google Maps Embed API or Maps JavaScript API.',
        iframeHtml: embedUrl ? `<iframe src="${embedUrl}" width="100%" height="400" style="border:0;border-radius:12px" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>` : null,
        jsApiConfig: destLat && destLng ? {
          center: { lat: parseFloat(destLat), lng: parseFloat(destLng) },
          zoom: 16,
          marker: { lat: parseFloat(destLat), lng: parseFloat(destLng), title: g.name },
          directionsService: from_lat && from_lng ? {
            origin: { lat: parseFloat(from_lat), lng: parseFloat(from_lng) },
            destination: { lat: parseFloat(destLat), lng: parseFloat(destLng) },
            travelMode: (mode || 'DRIVING').toUpperCase(),
          } : null,
        } : null,
      },

      // NO external links — user never leaves ScanGym
      externalLinks: null,
    });
  } catch (err) {
    console.error('Directions error:', err);
    res.status(500).json({ error: 'Failed to generate directions' });
  }
});

// GET /api/directions/booking/:bookingId — Post-booking navigation + real-time upsells
router.get('/booking/:bookingId', authenticateUser, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    const userId = req.user.id;
    const { from_lat, from_lng } = req.query;

    const booking = await pool.query(
      `SELECT b.*, g.name as gym_name, g.address, g.city, g.latitude, g.longitude,
              g.operating_hours, g.phone, g.place_id, g.day_pass_price
       FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
       WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, userId]
    );

    if (booking.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const b = booking.rows[0];
    const destLat = b.latitude;
    const destLng = b.longitude;

    // Embedded map
    let embedUrl = null;
    if (destLat && destLng && from_lat && from_lng) {
      embedUrl = `https://www.google.com/maps/embed/v1/directions?key=${GOOGLE_MAPS_API_KEY}&origin=${from_lat},${from_lng}&destination=${destLat},${destLng}&mode=driving`;
    } else if (destLat && destLng) {
      embedUrl = `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=${destLat},${destLng}&zoom=16`;
    }

    // Route data for ETA
    let routeData = null;
    if (from_lat && from_lng && destLat && destLng) {
      try {
        const dirUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${from_lat},${from_lng}&destination=${destLat},${destLng}&mode=driving&departure_time=now&key=${GOOGLE_MAPS_API_KEY}`;
        const dirRes = await fetch(dirUrl);
        const dirData = await dirRes.json();
        if (dirData.status === 'OK' && dirData.routes?.[0]?.legs?.[0]) {
          const leg = dirData.routes[0].legs[0];
          routeData = {
            distance: leg.distance?.text,
            duration: leg.duration?.text,
            durationInTraffic: leg.duration_in_traffic?.text || leg.duration?.text,
            eta: new Date(Date.now() + (leg.duration_in_traffic?.value || leg.duration?.value || 0) * 1000).toISOString(),
            polyline: dirData.routes[0].overview_polyline?.points,
          };
        }
      } catch (e) {
        console.warn('[Directions] Failed to fetch route data from Google Maps:', e.message);
      }
    }

    // Task 10: Upsells — CORRECTION: "must be 100% accurate on real time live data"
    const upsells = [];

    // Upsell 1: Wallet (always relevant)
    try {
      const wallet = await pool.query('SELECT balance_pence FROM wallets WHERE user_id = $1', [userId]);
      if (wallet.rows.length === 0 || wallet.rows[0].balance_pence === 0) {
        upsells.push({
          type: 'wallet_topup',
          title: 'Save on your next visit',
          description: 'Top up your ScanGym Wallet and get up to 15% bonus credits',
          cta: 'Top Up Now',
          link: '/wallet',
        });
      }
    } catch (e) {
      console.warn('[Directions] Failed to fetch wallet for upsell:', e.message);
    }

    // v4.1: Off-peak discount removed — flat pricing at all times

    // Checklist
    const checklist = [
      { step: 'Booking confirmed', done: true, icon: '✅' },
      { step: 'QR code ready', done: true, icon: '📱', hint: 'Show at entrance for check-in' },
      { step: 'Navigating to gym', done: !!from_lat, icon: '🗺️' },
      { step: `Arrive at ${b.gym_name}`, done: false, icon: '🏋️' },
      { step: 'Scan QR at entrance (entry scan)', done: false, icon: '🔓' },
      { step: 'Workout!', done: false, icon: '💪' },
      { step: 'Scan QR at exit (exit scan)', done: false, icon: '🚪' },
    ];

    res.json({
      booking: {
        id: b.id,
        gymName: b.gym_name,
        address: b.address,
        city: b.city,
        phone: b.phone,
        status: b.status,
      },

      // Uber-style embedded navigation — NEVER leaves ScanGym
      navigation: {
        embeddedMap: {
          embedUrl,
          apiKey: GOOGLE_MAPS_API_KEY,
          destination: destLat && destLng ? { lat: parseFloat(destLat), lng: parseFloat(destLng) } : null,
          placeId: b.place_id || null,
        },
        route: routeData,
        renderNote: 'Render map INSIDE ScanGym app. User NEVER leaves the platform.',
      },

      // NO external map links
      externalLinks: null,

      upsells,
      checklist,
    });
  } catch (err) {
    console.error('Booking directions error:', err);
    res.status(500).json({ error: 'Failed to fetch booking navigation' });
  }
});

// ─── Distance Matrix: Batch travel times for gym listing cards ───────────────
// POST /api/directions/travel-times
// Body: { origin: {lat, lng}, destinations: [{id, lat, lng}, ...] }
// Returns real walk/drive times from Google Distance Matrix API.
// Smart mode: walking for ≤3 km (haversine), driving for >3 km.
// In-memory cache: 15 min TTL keyed on rounded origin + destination coords.

const travelTimeCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_DESTINATIONS = 25; // Google limit per request

function roundCoord(v) { return Math.round(v * 1000) / 1000; } // ~111m precision

function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cleanCache() {
  const now = Date.now();
  for (const [k, v] of travelTimeCache) {
    if (now - v.ts > CACHE_TTL_MS) travelTimeCache.delete(k);
  }
}

router.post('/travel-times', async (req, res) => {
  try {
    const { origin, destinations } = req.body;
    if (!origin?.lat || !origin?.lng || !Array.isArray(destinations) || destinations.length === 0) {
      return res.status(400).json({ error: 'origin {lat,lng} and destinations[] required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }

    // Periodic cache cleanup
    if (travelTimeCache.size > 5000) cleanCache();

    const oLat = parseFloat(origin.lat);
    const oLng = parseFloat(origin.lng);
    const results = {};

    // Split destinations into walk (≤3km) and drive (>3km) groups
    const walkGroup = [];
    const driveGroup = [];
    const cached = [];

    for (const d of destinations.slice(0, MAX_DESTINATIONS)) {
      const dLat = parseFloat(d.lat);
      const dLng = parseFloat(d.lng);
      if (!dLat || !dLng || !d.id) continue;

      const cacheKey = `${roundCoord(oLat)},${roundCoord(oLng)}->${roundCoord(dLat)},${roundCoord(dLng)}`;
      const hit = travelTimeCache.get(cacheKey);
      if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
        results[d.id] = hit.data;
        cached.push(d.id);
        continue;
      }

      const straightLine = haversineDist(oLat, oLng, dLat, dLng);
      const entry = { id: d.id, lat: dLat, lng: dLng, straightLine, cacheKey };

      if (straightLine <= 3) {
        walkGroup.push(entry);
      } else {
        driveGroup.push(entry);
      }
    }

    // Helper: call Distance Matrix API for a group
    async function fetchMatrix(group, mode) {
      if (group.length === 0) return;
      const destStr = group.map(g => `${g.lat},${g.lng}`).join('|');
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${oLat},${oLng}&destinations=${destStr}&mode=${mode}&units=metric&key=${GOOGLE_MAPS_API_KEY}`;

      const resp = await fetch(url);
      const data = await resp.json();

      if (data.status !== 'OK' || !data.rows?.[0]?.elements) return;

      const elements = data.rows[0].elements;
      for (let i = 0; i < group.length; i++) {
        const el = elements[i];
        const g = group[i];
        if (el.status === 'OK') {
          const result = {
            mode,
            duration: el.duration.text,
            durationSeconds: el.duration.value,
            distance: el.distance.text,
            distanceMeters: el.distance.value,
            icon: mode === 'walking' ? '🚶' : '🚗',
            label: mode === 'walking'
              ? `${el.duration.text} walk`
              : `${el.duration.text} drive`,
          };
          results[g.id] = result;
          travelTimeCache.set(g.cacheKey, { ts: Date.now(), data: result });
        } else {
          // Fallback to haversine estimate
          const estMin = mode === 'walking'
            ? Math.max(1, Math.round(g.straightLine * 12)) // ~5 km/h walking
            : Math.max(1, Math.round(g.straightLine * 1.5)); // ~40 km/h city driving
          const result = {
            mode,
            duration: `${estMin} min`,
            durationSeconds: estMin * 60,
            distance: g.straightLine < 1
              ? `${Math.round(g.straightLine * 1000)} m`
              : `${g.straightLine.toFixed(1)} km`,
            distanceMeters: Math.round(g.straightLine * 1000),
            icon: mode === 'walking' ? '🚶' : '🚗',
            label: mode === 'walking' ? `~${estMin} min walk` : `~${estMin} min drive`,
            estimated: true,
          };
          results[g.id] = result;
        }
      }
    }

    // Fetch both groups in parallel
    await Promise.all([
      fetchMatrix(walkGroup, 'walking'),
      fetchMatrix(driveGroup, 'driving'),
    ]);

    res.json({
      results,
      meta: {
        total: Object.keys(results).length,
        cached: cached.length,
        walkApiCalls: walkGroup.length > 0 ? 1 : 0,
        driveApiCalls: driveGroup.length > 0 ? 1 : 0,
      },
    });
  } catch (err) {
    console.error('Travel times error:', err);
    res.status(500).json({ error: 'Failed to fetch travel times' });
  }
});

module.exports = router;
