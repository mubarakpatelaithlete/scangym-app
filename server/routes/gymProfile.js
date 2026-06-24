/**
 * Task 2: Gym Profiles — CORRECTED
 * CEO: "Only Google Places not our DB"
 * ALL gym data (photos, reviews, hours, facilities) comes from Google Places API.
 * No custom DB tables for equipment, classes, or media.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth } = require('../middleware/auth');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Fetch full Place Details from Google Places API (New).
 * Returns photos, reviews, hours, rating, types, etc.
 */
async function fetchGooglePlaceDetails(placeId) {
  if (!placeId || !GOOGLE_MAPS_API_KEY) return null;

  try {
    // Use Places API (New) — fields mask for what we need
    const fields = [
      'id', 'displayName', 'formattedAddress', 'location',
      'rating', 'userRatingCount', 'reviews', 'photos',
      'regularOpeningHours', 'currentOpeningHours',
      'types', 'websiteUri', 'nationalPhoneNumber',
      'editorialSummary', 'goodForChildren', 'accessibilityOptions',
      'parkingOptions', 'priceLevel'
    ].join(',');

    const url = `https://places.googleapis.com/v1/places/${placeId}?fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': fields,
      },
    });

    if (!response.ok) {
      // Fallback to legacy Places API
      return await fetchGooglePlaceDetailsLegacy(placeId);
    }

    return await response.json();
  } catch (err) {
    console.error('Google Places API (New) error:', err.message);
    // Fallback to legacy
    return await fetchGooglePlaceDetailsLegacy(placeId);
  }
}

/**
 * Fallback: Legacy Google Places Details API
 */
async function fetchGooglePlaceDetailsLegacy(placeId) {
  if (!placeId || !GOOGLE_MAPS_API_KEY) return null;

  try {
    const fields = 'name,formatted_address,formatted_phone_number,geometry,rating,user_ratings_total,reviews,photos,opening_hours,types,website,url,price_level,business_status';
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.result) return null;
    return data.result;
  } catch (err) {
    console.error('Google Places Legacy API error:', err.message);
    return null;
  }
}

/**
 * Build photo URLs from Google Places photo references.
 */
function buildPhotoUrls(photos, maxPhotos = 10) {
  if (!photos || !Array.isArray(photos)) return [];

  // C4 fix: proxy through /api/photo so the Google API key is never exposed to clients
  return photos.slice(0, maxPhotos).map((photo, idx) => {
    // New API format
    if (photo.name) {
      return {
        url: `/api/photo?name=${encodeURIComponent(photo.name)}&maxwidth=1200&maxheight=800`,
        attribution: photo.authorAttributions?.[0]?.displayName || null,
        width: photo.widthPx || null,
        height: photo.heightPx || null,
      };
    }
    // Legacy format
    if (photo.photo_reference) {
      return {
        url: `/api/photo?ref=${encodeURIComponent(photo.photo_reference)}&maxwidth=1200`,
        attribution: photo.html_attributions?.[0] || null,
        width: photo.width || null,
        height: photo.height || null,
      };
    }
    return null;
  }).filter(Boolean);
}

/**
 * Parse opening hours from Google Places
 */
function parseOpeningHours(hours) {
  if (!hours) return null;

  // New API format
  if (hours.weekdayDescriptions) {
    return {
      isOpen: hours.openNow || null,
      weekday: hours.weekdayDescriptions,
      periods: hours.periods || [],
    };
  }

  // Legacy format
  if (hours.weekday_text) {
    return {
      isOpen: hours.open_now || null,
      weekday: hours.weekday_text,
      periods: hours.periods || [],
    };
  }

  return null;
}

/**
 * Parse reviews from Google Places
 */
function parseReviews(reviews) {
  if (!reviews || !Array.isArray(reviews)) return [];

  return reviews.map(r => ({
    author: r.authorAttribution?.displayName || r.author_name || 'Anonymous',
    authorPhoto: r.authorAttribution?.photoUri || r.profile_photo_url || null,
    rating: r.rating,
    text: r.text?.text || r.text || '',
    relativeTime: r.relativePublishTimeDescription || r.relative_time_description || '',
    time: r.publishTime || (r.time ? new Date(r.time * 1000).toISOString() : null),
    source: 'google',
  }));
}

// GET /api/gym-profile/:gymId — Full profile from Google Places ONLY
router.get('/:gymId', optionalAuth, async (req, res) => {
  try {
    const gymId = parseInt(req.params.gymId);

    // Get base gym info from our DB (just ID, name, placeId, coordinates)
    const gymResult = await pool.query('SELECT * FROM gyms WHERE id = $1', [gymId]);
    if (gymResult.rows.length === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }
    const gym = gymResult.rows[0];

    // Fetch EVERYTHING from Google Places API
    const placeDetails = await fetchGooglePlaceDetails(gym.place_id);

    // ScanGym-specific reviews (from our DB)
    let scangymReviews = { total: 0, avgRating: 0, latest: [] };
    try {
      const reviewStats = await pool.query(`
        SELECT COUNT(*) as total, COALESCE(AVG(rating), 0) as avg_rating
        FROM reviews WHERE gym_id = $1
      `, [gymId]);
      const latestReviews = await pool.query(`
        SELECT id, rating, comment, owner_response, created_at
        FROM reviews WHERE gym_id = $1 ORDER BY created_at DESC LIMIT 5
      `, [gymId]);
      scangymReviews = {
        total: parseInt(reviewStats.rows[0].total),
        avgRating: parseFloat(parseFloat(reviewStats.rows[0].avg_rating).toFixed(1)),
        latest: latestReviews.rows,
      };
    } catch (e) {
      console.warn('[GymProfile] Failed to fetch ScanGym reviews:', e.message);
    }

    // Booking stats for social proof
    let bookingStats = { total: 0, thisMonth: 0 };
    try {
      const bStats = await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as monthly
        FROM bookings WHERE gym_id = $1
      `, [gymId]);
      bookingStats = {
        total: parseInt(bStats.rows[0].total),
        thisMonth: parseInt(bStats.rows[0].monthly),
      };
    } catch (e) {
      console.warn('[GymProfile] Failed to fetch booking stats:', e.message);
    }

    // Pricing from gym_pricing or gyms table
    let pricing = null;
    try {
      const p = await pool.query('SELECT * FROM gym_pricing WHERE gym_id = $1', [gymId]);
      if (p.rows.length > 0) {
        pricing = {
          dayPassPrice: p.rows[0].day_pass_pence ? p.rows[0].day_pass_pence / 100 : null,
          pricingModel: '24hr_day_pass',
          currency: p.rows[0].currency || 'GBP',
        };
      }
    } catch (e) {
      console.warn('[GymProfile] Failed to fetch gym pricing:', e.message);
    }
    if (!pricing) {
      pricing = {
        dayPassPrice: gym.day_pass_price || gym.hourly_rate || null,
        pricingModel: '24hr_day_pass',
        currency: 'GBP',
      };
    }

    // Build response — Google Places as primary data source
    const response = {
      gym: {
        id: gym.id,
        name: placeDetails?.displayName?.text || placeDetails?.name || gym.name,
        address: placeDetails?.formattedAddress || placeDetails?.formatted_address || gym.address,
        city: gym.city,
        coordinates: {
          lat: placeDetails?.location?.latitude || placeDetails?.geometry?.location?.lat || gym.latitude,
          lng: placeDetails?.location?.longitude || placeDetails?.geometry?.location?.lng || gym.longitude,
        },
        phone: placeDetails?.nationalPhoneNumber || placeDetails?.formatted_phone_number || gym.phone,
        website: placeDetails?.websiteUri || placeDetails?.website || gym.website,
        googlePlaceId: gym.place_id,
        googleMapsUrl: placeDetails?.url || null,
      },

      // ALL photos from Google Places
      photos: buildPhotoUrls(placeDetails?.photos),

      // Hours from Google Places
      openingHours: parseOpeningHours(placeDetails?.regularOpeningHours || placeDetails?.opening_hours),
      currentHours: parseOpeningHours(placeDetails?.currentOpeningHours),

      // Google Places rating + reviews
      googleRating: {
        rating: placeDetails?.rating || null,
        totalReviews: placeDetails?.userRatingCount || placeDetails?.user_ratings_total || 0,
        reviews: parseReviews(placeDetails?.reviews),
      },

      // ScanGym-specific reviews (our users)
      scangymRating: scangymReviews,

      // Combined rating
      combinedRating: {
        google: placeDetails?.rating || null,
        scangym: scangymReviews.avgRating || null,
        totalGoogleReviews: placeDetails?.userRatingCount || placeDetails?.user_ratings_total || 0,
        totalScangymReviews: scangymReviews.total,
      },

      // Facilities/types from Google Places
      types: placeDetails?.types || [],
      description: placeDetails?.editorialSummary?.text || placeDetails?.editorial_summary?.overview || gym.description,
      priceLevel: placeDetails?.priceLevel || placeDetails?.price_level || null,
      accessibility: placeDetails?.accessibilityOptions || null,
      parking: placeDetails?.parkingOptions || null,

      // ScanGym-specific data
      pricing,
      bookingStats,

      // Embedded map data (Task 23: Uber-style, no external links)
      // C4 fix: removed raw apiKey — frontend uses Google Maps JS API (loaded via /api/maps-loader)
      embeddedMap: {
        center: {
          lat: placeDetails?.location?.latitude || placeDetails?.geometry?.location?.lat || gym.latitude,
          lng: placeDetails?.location?.longitude || placeDetails?.geometry?.location?.lng || gym.longitude,
        },
        placeId: gym.place_id,
        embedUrl: gym.place_id
          ? `/api/map-embed?place_id=${encodeURIComponent(gym.place_id)}`
          : null,
      },
    };

    res.json(response);
  } catch (err) {
    console.error('Gym profile error:', err);
    res.status(500).json({ error: 'Failed to fetch gym profile' });
  }
});

// GET /api/gym-profile/:gymId/photos — Just photos from Google Places
router.get('/:gymId/photos', async (req, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    if (isNaN(gymId)) return res.status(400).json({ error: 'Invalid gym ID' });

    const gym = await pool.query('SELECT place_id, name FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });

    const placeId = gym.rows[0].place_id;
    let photos = [];
    if (placeId && GOOGLE_MAPS_API_KEY) {
      const placeDetails = await fetchGooglePlaceDetails(placeId);
      photos = buildPhotoUrls(placeDetails?.photos, 20);
    }

    res.json({
      gymId,
      gymName: gym.rows[0].name,
      photos,
      source: placeId ? 'google_places' : 'none',
      total: photos.length,
    });
  } catch (err) {
    console.error('Gym photos error:', err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// GET /api/gym-profile/:gymId/hours — Just opening hours from Google Places
router.get('/:gymId/hours', async (req, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    if (isNaN(gymId)) return res.status(400).json({ error: 'Invalid gym ID' });

    const gym = await pool.query('SELECT place_id, name FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });

    const placeId = gym.rows[0].place_id;
    let openingHours = null;
    let currentHours = null;
    if (placeId && GOOGLE_MAPS_API_KEY) {
      const placeDetails = await fetchGooglePlaceDetails(placeId);
      openingHours = parseOpeningHours(placeDetails?.regularOpeningHours || placeDetails?.opening_hours);
      currentHours = parseOpeningHours(placeDetails?.currentOpeningHours);
    }

    res.json({
      gymId,
      gymName: gym.rows[0].name,
      openingHours,
      currentHours,
      source: placeId ? 'google_places' : 'none',
    });
  } catch (err) {
    console.error('Gym hours error:', err);
    res.status(500).json({ error: 'Failed to fetch hours' });
  }
});

module.exports = router;
