/**
 * Never show a visitor an empty product.
 *
 * ScanGym resolves the visitor's city from their IP and searches it. That is right until the
 * city has nothing: on 24 Aug 2026 a first-time visitor resolved to Boardman, Oregon, the
 * search legitimately returned zero gyms, and the app replaced the results it was already
 * showing with "No Gyms Found" — a more precise location with no inventory beat a working one.
 *
 * So when a location-biased search comes back empty, widen instead of surrendering: drop the
 * distance cap first, and if there is still nothing, offer the nearest city we know has gyms
 * and *say so*, rather than silently pretending the visitor asked for London.
 */

// Deliberately short. These are markets with dependable gym density, not a gazetteer.
const METROS = [
  { city: 'London', lat: 51.5074, lng: -0.1278 },
  { city: 'Manchester', lat: 53.4808, lng: -2.2426 },
  { city: 'Birmingham', lat: 52.4862, lng: -1.8904 },
  { city: 'Dublin', lat: 53.3498, lng: -6.2603 },
  { city: 'Paris', lat: 48.8566, lng: 2.3522 },
  { city: 'Berlin', lat: 52.52, lng: 13.405 },
  { city: 'Madrid', lat: 40.4168, lng: -3.7038 },
  { city: 'Amsterdam', lat: 52.3676, lng: 4.9041 },
  { city: 'Dubai', lat: 25.2048, lng: 55.2708 },
  { city: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { city: 'Sydney', lat: -33.8688, lng: 151.2093 },
  { city: 'Toronto', lat: 43.6532, lng: -79.3832 },
  { city: 'New York', lat: 40.7128, lng: -74.006 },
  { city: 'Chicago', lat: 41.8781, lng: -87.6298 },
  { city: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
  { city: 'San Francisco', lat: 37.7749, lng: -122.4194 },
];

const DEFAULT_CITY = METROS[0];

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * The city to offer when the visitor's own has nothing.
 * Nearest known metro if we have coordinates, otherwise the home market.
 */
function nearestMetro(lat, lng) {
  const la = parseFloat(lat);
  const ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return { ...DEFAULT_CITY, distanceKm: null };
  let best = DEFAULT_CITY;
  let bestKm = Infinity;
  for (const m of METROS) {
    const km = haversineKm(la, ln, m.lat, m.lng);
    if (km < bestKm) {
      bestKm = km;
      best = m;
    }
  }
  return { ...best, distanceKm: Math.round(bestKm) };
}

/** The city name the visitor actually asked about, for an honest "nothing in X yet" message. */
function requestedCity(query) {
  if (!query) return null;
  const m = String(query).match(/\b(?:gyms?|fitness)\s+(?:in|near)\s+(.+)$/i);
  return (m ? m[1] : String(query)).replace(/\s+24 hour$/i, '').trim() || null;
}

/** An automatic, location-derived search may be widened. An explicit one the user typed may not. */
function mayWiden({ explicit = false, hasResults = false } = {}) {
  return !explicit && !hasResults;
}

module.exports = { METROS, DEFAULT_CITY, nearestMetro, requestedCity, mayWiden, haversineKm };
