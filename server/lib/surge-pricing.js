/**
 * ScanGym Surge Pricing Engine (Phase 2)
 * ═══════════════════════════════════════
 * 
 * Real-time demand-based pricing, inspired by Uber's surge algorithm.
 * 
 * How it works:
 *   1. Tracks bookings per gym per 30-min slot (in-memory + DB fallback)
 *   2. Calculates demand ratio = recent bookings / baseline
 *   3. Applies gradual surge multiplier (1.0x → 2.0x max)
 *   4. Decay: surge drops automatically when bookings slow down
 * 
 * Usage:
 *   const surge = require('./lib/surge-pricing');
 *   surge.recordBooking(gymId, 'GB');
 *   const factor = surge.getDemandFactor(gymId);
 *   // → 1.0 (normal) to 2.0 (max surge)
 * 
 * Surge tiers:
 *   1.0x  — Normal demand (0-3 bookings in 30 min)
 *   1.1x  — Busy          (4-6 bookings)
 *   1.25x — Very busy     (7-10 bookings)
 *   1.5x  — High demand   (11-15 bookings)
 *   1.75x — Surge         (16-20 bookings)
 *   2.0x  — Peak surge    (20+ bookings)
 */

// ============================================================================
// CONFIG
// ============================================================================
const SURGE_CONFIG = {
  windowMs: 30 * 60 * 1000,           // 30-minute sliding window
  decayMs: 15 * 60 * 1000,            // Surge decays after 15 min of low activity
  maxSurge: 2.0,                       // Maximum surge multiplier
  minSurge: 1.0,                       // No discount below base
  baselineBookingsPerWindow: 3,        // "Normal" bookings per 30 min
  cleanupIntervalMs: 5 * 60 * 1000,   // Clean stale data every 5 min
  maxTrackedGyms: 10000,               // Memory cap
};

// Surge tiers (bookings in window → multiplier)
const SURGE_TIERS = [
  { threshold: 20, multiplier: 2.00 },
  { threshold: 16, multiplier: 1.75 },
  { threshold: 11, multiplier: 1.50 },
  { threshold: 7,  multiplier: 1.25 },
  { threshold: 4,  multiplier: 1.10 },
  { threshold: 0,  multiplier: 1.00 },
];

// ============================================================================
// IN-MEMORY BOOKING TRACKER
// ============================================================================
// Map<gymId, { bookings: [timestamp, ...], lastSurge: number, lastUpdate: timestamp }>
const gymDemand = new Map();

/**
 * Record a booking event (call after every successful booking)
 * @param {number|string} gymId - Gym ID
 * @param {string} [countryCode] - Country for regional surge analysis
 */
function recordBooking(gymId, countryCode = null) {
  const key = String(gymId);
  const now = Date.now();
  
  if (!gymDemand.has(key)) {
    if (gymDemand.size >= SURGE_CONFIG.maxTrackedGyms) {
      // Evict oldest entry
      const oldestKey = gymDemand.keys().next().value;
      gymDemand.delete(oldestKey);
    }
    gymDemand.set(key, { bookings: [], lastSurge: 1.0, lastUpdate: now, country: countryCode });
  }
  
  const data = gymDemand.get(key);
  data.bookings.push(now);
  data.lastUpdate = now;
  if (countryCode) data.country = countryCode;
  
  // Trim old bookings outside the window
  const cutoff = now - SURGE_CONFIG.windowMs;
  data.bookings = data.bookings.filter(ts => ts > cutoff);
}

/**
 * Get the current demand factor (surge multiplier) for a gym
 * @param {number|string} gymId - Gym ID
 * @returns {number} Surge multiplier (1.0 to 2.0)
 */
function getDemandFactor(gymId) {
  const key = String(gymId);
  const data = gymDemand.get(key);
  
  if (!data) return SURGE_CONFIG.minSurge;
  
  const now = Date.now();
  const cutoff = now - SURGE_CONFIG.windowMs;
  
  // Count recent bookings
  const recentBookings = data.bookings.filter(ts => ts > cutoff).length;
  
  // Find matching surge tier
  let multiplier = SURGE_CONFIG.minSurge;
  for (const tier of SURGE_TIERS) {
    if (recentBookings >= tier.threshold) {
      multiplier = tier.multiplier;
      break;
    }
  }
  
  // Apply decay: if no recent activity, ease back toward 1.0
  const timeSinceLastBooking = now - data.lastUpdate;
  if (timeSinceLastBooking > SURGE_CONFIG.decayMs) {
    const decayProgress = Math.min(1, (timeSinceLastBooking - SURGE_CONFIG.decayMs) / SURGE_CONFIG.decayMs);
    multiplier = multiplier - (multiplier - 1.0) * decayProgress;
  }
  
  // Smooth transition: blend with last known surge (prevents jarring price jumps)
  const blended = data.lastSurge * 0.3 + multiplier * 0.7;
  data.lastSurge = blended;
  
  return Math.max(SURGE_CONFIG.minSurge, Math.min(SURGE_CONFIG.maxSurge, blended));
}

/**
 * Get surge info for display (icon + label)
 * @param {number} factor - Surge multiplier
 * @returns {Object} { factor, label, icon, color }
 */
function getSurgeDisplay(factor) {
  if (factor >= 1.75) return { factor, label: 'Peak Demand', icon: '🔴', color: '#ef4444' };
  if (factor >= 1.50) return { factor, label: 'High Demand', icon: '🟠', color: '#f97316' };
  if (factor >= 1.25) return { factor, label: 'Busy', icon: '🟡', color: '#eab308' };
  if (factor >= 1.10) return { factor, label: 'Moderate', icon: '🟢', color: '#22c55e' };
  return { factor, label: 'Normal', icon: '⚪', color: '#94a3b8' };
}

/**
 * Get top surging gyms (for admin dashboard)
 * @param {number} limit - Max results
 * @returns {Array} [{ gymId, factor, recentBookings, label }, ...]
 */
function getTopSurging(limit = 10) {
  const results = [];
  const now = Date.now();
  const cutoff = now - SURGE_CONFIG.windowMs;
  
  for (const [gymId, data] of gymDemand.entries()) {
    const recentBookings = data.bookings.filter(ts => ts > cutoff).length;
    const factor = getDemandFactor(gymId);
    if (factor > 1.0) {
      results.push({
        gymId,
        factor: Math.round(factor * 100) / 100,
        recentBookings,
        ...getSurgeDisplay(factor),
      });
    }
  }
  
  return results
    .sort((a, b) => b.factor - a.factor)
    .slice(0, limit);
}

/**
 * Get regional surge (average across all gyms in a country)
 * @param {string} countryCode - ISO country code
 * @returns {number} Average surge multiplier
 */
function getRegionalSurge(countryCode) {
  const cc = (countryCode || '').toUpperCase();
  let total = 0;
  let count = 0;
  
  for (const [gymId, data] of gymDemand.entries()) {
    if (data.country === cc) {
      total += getDemandFactor(gymId);
      count++;
    }
  }
  
  return count > 0 ? total / count : 1.0;
}

// ============================================================================
// CLEANUP (prevent memory leaks)
// ============================================================================
let _cleanupInterval = null;

function startCleanup() {
  if (_cleanupInterval) return;
  _cleanupInterval = setInterval(() => {
    const now = Date.now();
    const staleThreshold = SURGE_CONFIG.windowMs * 3; // Remove gyms idle for 90 min
    
    for (const [gymId, data] of gymDemand.entries()) {
      if (now - data.lastUpdate > staleThreshold) {
        gymDemand.delete(gymId);
      } else {
        // Trim old bookings
        const cutoff = now - SURGE_CONFIG.windowMs;
        data.bookings = data.bookings.filter(ts => ts > cutoff);
      }
    }
  }, SURGE_CONFIG.cleanupIntervalMs);
  
  // Don't prevent Node from exiting
  if (_cleanupInterval.unref) _cleanupInterval.unref();
}

function stopCleanup() {
  if (_cleanupInterval) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
  }
}

// Auto-start cleanup on require
startCleanup();

// ============================================================================
// API ROUTE (optional — mount on Express router for admin/debug)
// ============================================================================
function createSurgeRouter() {
  const express = require('express');
  const router = express.Router();
  
  // GET /api/surge/status — Current surge status for a gym
  router.get('/status', (req, res) => {
    const { gymId } = req.query;
    if (!gymId) return res.status(400).json({ error: 'gymId required' });
    
    const factor = getDemandFactor(gymId);
    res.json({
      gymId,
      ...getSurgeDisplay(factor),
    });
  });
  
  // GET /api/surge/top — Top surging gyms
  router.get('/top', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    res.json({ surging: getTopSurging(limit) });
  });
  
  // GET /api/surge/regional — Regional average surge
  router.get('/regional', (req, res) => {
    const { country } = req.query;
    if (!country) return res.status(400).json({ error: 'country required' });
    
    const factor = getRegionalSurge(country);
    res.json({
      country: country.toUpperCase(),
      ...getSurgeDisplay(factor),
    });
  });
  
  return router;
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  recordBooking,
  getDemandFactor,
  getSurgeDisplay,
  getTopSurging,
  getRegionalSurge,
  createSurgeRouter,
  startCleanup,
  stopCleanup,
  SURGE_CONFIG,
  SURGE_TIERS,
};
