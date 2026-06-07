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

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const BASE_URL = 'https://maps.googleapis.com/maps/api/place';

// ─── Simple in-memory cache (5 min TTL) ─────────────────────
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
function photoUrl(photoRef, maxWidth = 1200) {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
}

// ─── Helper: Parse a Text/Nearby Search result into ScanGym gym format ───
function parseSearchResult(place) {
  const geo = place.geometry?.location || {};
  const photoRef = place.photos?.[0]?.photo_reference || null;

  // Include ALL photo references for multi-photo carousel (Google returns up to 10)
  const photos_list = (place.photos || []).map(p => ({
    url: photoUrl(p.photo_reference, 1200),
    thumbnail: photoUrl(p.photo_reference, 400),
  }));

  return {
    // Use place_id as the universal ID
    id: place.place_id,
    placeId: place.place_id,
    name: place.name || 'Unknown Gym',
    address: place.formatted_address || place.vicinity || '',
    city: extractCity(place.formatted_address || place.vicinity || ''),
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
    priceLevel: place.price_level ?? null,
    // ScanGym defaults
    dayPassPrice: 5.00,
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

// ═══════════════════════════════════════════════════════════════
// GET /api/live/search — Live Text Search via Google Places
// Query: ?q=gym+in+London&pagetoken=xxx
// ═══════════════════════════════════════════════════════════════
router.get('/search', async (req, res) => {
  try {
    const { q, query, pagetoken, type, lat, lng, radius } = req.query;
    const searchQuery = q || query;

    if (!searchQuery && !pagetoken) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: 'Google Maps API key not configured' });
    }

    // Check cache (include lat/lng in cache key for location-biased searches)
    const cacheKey = `search:${searchQuery}:${pagetoken || ''}:${lat || ''}:${lng || ''}`;
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
      // Detect region from query or default to UK (primary market)
      const regionMatch = searchQuery.match(/\b(uk|gb|us|ae|in|au|ca|de|fr|es|it)\b/i);
      if (regionMatch) {
        url += `&region=${regionMatch[1].toLowerCase()}`;
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

    const gyms = (data.results || [])
      .filter(p => p.business_status !== 'CLOSED_PERMANENTLY')
      .map(parseSearchResult);

    const result = {
      gyms,
      total: gyms.length,
      nextPageToken: data.next_page_token || null,
      query: searchQuery,
      source: 'google_places_live',
    };

    setCache(cacheKey, result);
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
    const { lat, lng, radius = 5000, pagetoken, keyword } = req.query;

    if (!pagetoken && (!lat || !lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: 'Google Maps API key not configured' });
    }

    const cacheKey = `nearby:${lat}:${lng}:${radius}:${pagetoken || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    let url;
    if (pagetoken) {
      url = `${BASE_URL}/nearbysearch/json?pagetoken=${pagetoken}&key=${GOOGLE_MAPS_API_KEY}`;
    } else {
      url = `${BASE_URL}/nearbysearch/json?location=${lat},${lng}&radius=${Math.min(parseInt(radius), 50000)}&type=gym&keyword=${encodeURIComponent(keyword || 'gym fitness')}&key=${GOOGLE_MAPS_API_KEY}`;
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

    const gyms = (data.results || [])
      .filter(p => p.business_status !== 'CLOSED_PERMANENTLY')
      .map(parseSearchResult);

    // Calculate distance from search point
    if (lat && lng) {
      const searchLat = parseFloat(lat);
      const searchLng = parseFloat(lng);
      gyms.forEach(g => {
        if (g.latitude && g.longitude) {
          g.distance = haversineDistance(searchLat, searchLng, g.latitude, g.longitude);
          g.distanceText = g.distance < 1 ? `${Math.round(g.distance * 1000)}m` : `${g.distance.toFixed(1)}km`;
        }
      });
      gyms.sort((a, b) => (a.distance || 999) - (b.distance || 999));
    }

    const result = {
      gyms,
      total: gyms.length,
      nextPageToken: data.next_page_token || null,
      source: 'google_places_live',
    };

    setCache(cacheKey, result);
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
      const dbResult = await pool.query('SELECT id, day_pass_price, hourly_rate, is_claimed FROM gyms WHERE place_id = $1', [placeId]);
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

    const result = {
      gym: {
        placeId,
        dbId: dbGym?.id || null,
        name: p.name,
        address: p.formatted_address,
        city: extractCity(p.formatted_address),
        phone: p.formatted_phone_number || null,
        website: p.website || null,
        googleMapsUrl: p.url || null,
        latitude: geo.lat,
        longitude: geo.lng,
        businessStatus: p.business_status || 'OPERATIONAL',
        types: p.types || [],
        priceLevel: p.price_level ?? null,
        isClaimed: dbGym?.is_claimed || false,
      },
      pricing: {
        dayPassPrice: dbGym?.day_pass_price || 5.00,
        hourlyRate: dbGym?.hourly_rate || 5.00,
        currency: 'GBP',
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
        embedUrl: `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=place_id:${placeId}`,
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

    // Fetch from Google Places to get full details
    const fields = 'name,formatted_address,formatted_phone_number,geometry,rating,user_ratings_total,types,website';
    const url = `${BASE_URL}/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.result) {
      return res.status(404).json({ error: 'Place not found on Google' });
    }

    const p = data.result;
    const geo = p.geometry?.location || {};
    const city = extractCity(p.formatted_address);

    // Create slug
    const slug = (p.name || 'gym').toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s-]+/g, '-')
      .slice(0, 100);

    // Extract postcode (UK format)
    let zipCode = '';
    const zipMatch = (p.formatted_address || '').match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
    if (zipMatch) zipCode = zipMatch[0].toUpperCase();

    const result = await pool.query(`
      INSERT INTO gyms 
      (name, address, place_id, day_pass_price, owner_id, slug, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, 5.00, 'system', $4, true, NOW(), NOW())
      RETURNING id, name
    `, [
      p.name,
      p.formatted_address, placeId, slug,
    ]);

    res.json({ gymId: result.rows[0].id, name: result.rows[0].name, created: true });
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

module.exports = router;
