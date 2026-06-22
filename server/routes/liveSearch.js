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
const PLACES_NEW_BASE = 'https://places.googleapis.com/v1/places';
const USE_PLACES_NEW_API = process.env.USE_PLACES_NEW_API === 'true'; // Set to 'true' in Railway env to enable Places API (New)

/**
 * #11: Places API (New) v2 — Better global gym coverage
 * 
 * SETUP: In Google Cloud Console, enable "Places API (New)"
 * Then set env var: USE_PLACES_NEW_API=true in Railway
 * 
 * Advantages over legacy:
 * - Better international coverage
 * - regularOpeningHours with better 24/7 detection
 * - More accurate gym type classification
 * - Field masks for efficient API usage
 */
async function searchWithPlacesNewAPI(searchQuery, lat, lng, radius, maxResults = 20) {
  if (!GOOGLE_MAPS_API_KEY) throw new Error('No API key');
  const requestBody = {
    textQuery: searchQuery,
    maxResultCount: Math.min(maxResults, 20),
    languageCode: 'en',
    includedType: 'gym',
  };
  if (lat && lng) {
    requestBody.locationBias = {
      circle: {
        center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
        radius: parseFloat(radius) || 20000,
      },
    };
  }
  const fieldMask = [
    'places.id', 'places.displayName', 'places.formattedAddress',
    'places.location', 'places.rating', 'places.userRatingCount',
    'places.photos', 'places.currentOpeningHours', 'places.regularOpeningHours',
    'places.types', 'places.internationalPhoneNumber', 'places.websiteUri',
    'places.businessStatus',
  ].join(',');

  const resp = await fetch(`${PLACES_NEW_BASE}:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(requestBody),
  });
  if (!resp.ok) throw new Error(`Places New API error: ${resp.status}`);
  const data = await resp.json();
  return (data.places || []).map(p => ({
    place_id: p.id,
    name: p.displayName?.text || '',
    formatted_address: p.formattedAddress || '',
    geometry: { location: { lat: p.location?.latitude, lng: p.location?.longitude } },
    rating: p.rating || 0,
    user_ratings_total: p.userRatingCount || 0,
    photos: (p.photos || []).slice(0, 5).map(ph => ({ photo_reference: ph.name })),
    opening_hours: {
      open_now: p.currentOpeningHours?.openNow || false,
      weekday_text: p.regularOpeningHours?.weekdayDescriptions || [],
      periods: p.regularOpeningHours?.periods || [],
    },
    types: p.types || ['gym'],
    business_status: p.businessStatus || 'OPERATIONAL',
    international_phone_number: p.internationalPhoneNumber || '',
    website: p.websiteUri || '',
  }));
}

module.exports = router;
