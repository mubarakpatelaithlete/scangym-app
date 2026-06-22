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
