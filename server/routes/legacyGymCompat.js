/**
 * LEGACY GYM-DISCOVERY COMPAT SHIM  (cleanup step 1)
 *
 * The old frontend layers still call gym-discovery endpoints that were never
 * (or are no longer) implemented:
 *
 *   GET /api/gyms/search?q=      -> /api/live/search
 *   GET /api/gyms/nearby?lat&lng -> /api/live/nearby
 *   GET /api/gyms/place/:placeId -> /api/live/place/:placeId
 *   GET /api/gym/:id             -> /api/live/place/:placeId
 *                                   (numeric ids are resolved via gyms.place_id)
 *
 * Because the SPA fallback answers every unknown path with 200 + HTML, those
 * calls used to "succeed" and then blow up on JSON.parse, so the UI just went
 * blank (this is what made the Book tab fall back to demo US data at $6.99).
 *
 * This shim rewrites the legacy URL onto the live-search router so old callers
 * get real JSON. It is a bridge, not a home: the plan is to delete the legacy
 * callers in step 5, after which this file can be removed.
 */
const express = require('express');
const pool = require('../middleware/db');
const liveSearchRouter = require('./liveSearch');

const router = express.Router();

const LEGACY_HITS = { search: 0, nearby: 0, place: 0, gym: 0 };
function count(kind, req) {
  LEGACY_HITS[kind] += 1;
  if (LEGACY_HITS[kind] <= 5 || LEGACY_HITS[kind] % 100 === 0) {
    console.warn(`[legacy-compat] ${req.method} ${req.originalUrl} -> live search (${kind} hit #${LEGACY_HITS[kind]})`);
  }
}
router.getLegacyHits = () => ({ ...LEGACY_HITS });

function delegate(req, res, next, target) {
  const qs = req.originalUrl.split('?')[1];
  req.url = target + (qs ? `?${qs}` : '');
  res.setHeader('X-ScanGym-Compat', 'legacy-gyms->live');
  return liveSearchRouter(req, res, next);
}

// /api/gyms/search  and  /api/gyms/nearby
router.get('/gyms/search', (req, res, next) => { count('search', req); return delegate(req, res, next, '/search'); });
router.get('/gyms/nearby', (req, res, next) => { count('nearby', req); return delegate(req, res, next, '/nearby'); });

// /api/gyms/place/:placeId
router.get('/gyms/place/:placeId', (req, res, next) => {
  count('place', req);
  return delegate(req, res, next, `/place/${encodeURIComponent(req.params.placeId)}`);
});

// /api/gym/:id — either a Google place id, or our numeric DB id
router.get('/gym/:id', async (req, res, next) => {
  count('gym', req);
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return delegate(req, res, next, `/place/${encodeURIComponent(id)}`);
  try {
    const { rows } = await pool.query('SELECT place_id FROM gyms WHERE id = $1', [id]);
    if (!rows.length || !rows[0].place_id) {
      return res.status(404).json({ error: 'Gym not found', code: 'GYM_NOT_FOUND', id });
    }
    return delegate(req, res, next, `/place/${encodeURIComponent(rows[0].place_id)}`);
  } catch (e) {
    console.error('[legacy-compat] gym id lookup failed:', e.message);
    return res.status(502).json({ error: 'Gym lookup failed', code: 'GYM_LOOKUP_FAILED' });
  }
});

module.exports = router;
