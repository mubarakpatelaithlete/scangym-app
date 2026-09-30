/**
 * ScanGym Public API v1 (Task 2, 2026-09-30).
 *
 * Lets developers put ScanGym reels, shop products and gyms into their own
 * web apps. Keys are created by signed-in users at /developers.
 *
 *   Key management (signed in, Bearer JWT):
 *     POST   /api/developer/keys          { name }  -> returns the key ONCE
 *     GET    /api/developer/keys                    -> list (prefix only)
 *     DELETE /api/developer/keys/:id                -> revoke
 *
 *   Public endpoints (header  X-API-Key: sg_live_...  or  ?api_key=):
 *     GET /api/v1/reels?limit=&offset=&category=
 *     GET /api/v1/products?category=
 *     GET /api/v1/products/:id
 *     GET /api/v1/gyms?lat=&lng=  |  ?query=
 *     GET /api/v1/categories
 *
 * Decisions:
 *  - Only the sha256 of a key is stored; the plain key is shown once.
 *  - v1 is read-only. It proxies our own internal endpoints, so the public API
 *    always returns exactly what the app shows (no second copy of the logic).
 *  - 60 requests / minute / key, in memory (single process on Railway).
 */
const express = require('express');
const crypto = require('node:crypto');
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

const developerRouter = express.Router();
const v1Router = express.Router();
developerRouter.use(express.json());

const PORT = process.env.PORT || 5000;
const RATE_PER_MIN = 60;
const MAX_KEYS_PER_USER = 5;

let ready = null;
function ensureTable() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'My app',
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        requests BIGINT NOT NULL DEFAULT 0,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);
    `).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex');
function newKey() { return 'sg_live_' + crypto.randomBytes(24).toString('base64url'); }

// ── Key management ──────────────────────────────────────────────
developerRouter.post('/keys', authenticateUser, async (req, res) => {
  try {
    await ensureTable();
    const userId = String(req.user.id);
    const name = String((req.body || {}).name || 'My app').trim().slice(0, 60) || 'My app';
    const { rows: [{ n }] } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
    if (n >= MAX_KEYS_PER_USER) return res.status(400).json({ error: `Maximum ${MAX_KEYS_PER_USER} active keys. Revoke one first.` });
    const key = newKey();
    const { rows: [row] } = await pool.query(
      `INSERT INTO api_keys (user_id, name, key_hash, key_prefix) VALUES ($1,$2,$3,$4)
       RETURNING id, name, key_prefix, created_at`, [userId, name, hashKey(key), key.slice(0, 14)]);
    res.status(201).json({ ...row, key, note: 'Copy this key now. It will not be shown again.' });
  } catch (e) { console.error('[public-api] create key', e.message); res.status(500).json({ error: 'Could not create key' }); }
});

developerRouter.get('/keys', authenticateUser, async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await pool.query(
      `SELECT id, name, key_prefix, requests, last_used_at, created_at FROM api_keys
       WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`, [String(req.user.id)]);
    res.json({ keys: rows });
  } catch (e) { res.status(500).json({ error: 'Could not list keys' }); }
});

developerRouter.delete('/keys/:id', authenticateUser, async (req, res) => {
  try {
    await ensureTable();
    const r = await pool.query(
      'UPDATE api_keys SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
      [parseInt(req.params.id, 10) || 0, String(req.user.id)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Key not found' });
    res.json({ revoked: true });
  } catch (e) { res.status(500).json({ error: 'Could not revoke key' }); }
});

// ── Public v1 ───────────────────────────────────────────────────
const buckets = new Map(); // keyId -> { start, count }
function rateOk(id) {
  const now = Date.now();
  const b = buckets.get(id);
  if (!b || now - b.start >= 60000) { buckets.set(id, { start: now, count: 1 }); return RATE_PER_MIN - 1; }
  if (b.count >= RATE_PER_MIN) return -1;
  b.count += 1;
  return RATE_PER_MIN - b.count;
}

v1Router.use((req, res, next) => {
  // Browser web apps call this cross-origin, so allow any origin (read-only, key-scoped).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

async function requireApiKey(req, res, next) {
  const auth = req.headers.authorization || '';
  const key = req.headers['x-api-key'] || (auth.startsWith('Bearer sg_') ? auth.slice(7) : '') || req.query.api_key;
  if (!key || !/^sg_live_[A-Za-z0-9_-]{20,}$/.test(String(key))) {
    return res.status(401).json({ error: 'Missing or invalid API key. Get one at https://www.scangym.com/developers' });
  }
  try {
    await ensureTable();
    const { rows: [row] } = await pool.query(
      'SELECT id FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL', [hashKey(String(key))]);
    if (!row) return res.status(401).json({ error: 'API key not recognised or revoked' });
    const left = rateOk(row.id);
    res.setHeader('X-RateLimit-Limit', String(RATE_PER_MIN));
    if (left < 0) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: `Rate limit: ${RATE_PER_MIN} requests per minute` }); }
    res.setHeader('X-RateLimit-Remaining', String(left));
    pool.query('UPDATE api_keys SET requests=requests+1, last_used_at=NOW() WHERE id=$1', [row.id]).catch(() => {});
    next();
  } catch (e) { console.error('[public-api] key check', e.message); res.status(500).json({ error: 'API unavailable' }); }
}

// Forward to our own internal endpoint and pass the JSON through.
function proxy(buildPath) {
  return async (req, res) => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${buildPath(req)}`, { headers: { accept: 'application/json' } });
      const body = await r.json().catch(() => ({ error: 'Bad upstream response' }));
      res.status(r.status).json(body);
    } catch (e) { res.status(502).json({ error: 'Upstream unavailable' }); }
  };
}
const qs = (req, allowed) => {
  const p = new URLSearchParams();
  for (const k of allowed) if (req.query[k] != null && req.query[k] !== '') p.set(k, String(req.query[k]).slice(0, 200));
  const s = p.toString();
  return s ? '?' + s : '';
};

v1Router.get('/', (req, res) => res.json({
  name: 'ScanGym API', version: 'v1', docs: 'https://www.scangym.com/developers',
  endpoints: ['/api/v1/reels', '/api/v1/products', '/api/v1/products/:id', '/api/v1/gyms', '/api/v1/categories'],
}));
v1Router.use(requireApiKey);
v1Router.get('/reels', proxy((req) => '/api/reels/feed' + qs(req, ['limit', 'offset', 'category'])));
v1Router.get('/categories', proxy(() => '/api/reels/categories'));
v1Router.get('/products', proxy((req) => '/api/shop/products' + qs(req, ['category', 'q', 'limit'])));
v1Router.get('/products/:id', proxy((req) => '/api/shop/products/' + encodeURIComponent(req.params.id)));
v1Router.get('/gyms', (req, res, next) => {
  if (req.query.lat && req.query.lng) return proxy(() => '/api/live/nearby' + qs(req, ['lat', 'lng', 'radius']))(req, res, next);
  if (req.query.query) return proxy(() => '/api/live/search' + qs(req, ['query']))(req, res, next);
  res.status(400).json({ error: 'Pass lat & lng, or query' });
});
v1Router.use((req, res) => res.status(404).json({ error: 'Unknown endpoint. See https://www.scangym.com/developers' }));

module.exports = { developerRouter, v1Router, _test: { hashKey, newKey, rateOk } };
