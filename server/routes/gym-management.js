/**
 * Gym Management Routes — Equipment, Facilities, Scheduling, Reviews
 * 
 * Equipment & Facility CRUD + out-of-order status
 * Schedule open/close
 * Review management
 * 
 * Endpoints:
 *   GET    /api/gym-mgmt/:gymId/equipment           — List equipment
 *   POST   /api/gym-mgmt/:gymId/equipment           — Add equipment
 *   PUT    /api/gym-mgmt/:gymId/equipment/:id        — Update equipment
 *   DELETE /api/gym-mgmt/:gymId/equipment/:id        — Remove equipment
 *   PATCH  /api/gym-mgmt/:gymId/equipment/:id/status — Toggle out-of-order
 *
 *   GET    /api/gym-mgmt/:gymId/facilities           — List facilities
 *   POST   /api/gym-mgmt/:gymId/facilities           — Add facility
 *   PUT    /api/gym-mgmt/:gymId/facilities/:id        — Update facility
 *   DELETE /api/gym-mgmt/:gymId/facilities/:id        — Remove facility
 *   PATCH  /api/gym-mgmt/:gymId/facilities/:id/status — Toggle out-of-order
 *
 *   GET    /api/gym-mgmt/:gymId/schedule             — Get open/close schedule
 *   PUT    /api/gym-mgmt/:gymId/schedule             — Set schedule
 *   POST   /api/gym-mgmt/:gymId/schedule/close       — Schedule temporary close
 *
 *   GET    /api/gym-mgmt/:gymId/reviews              — Get reviews for management
 *   POST   /api/gym-mgmt/:gymId/reviews/:id/respond  — Respond to a review
 *   POST   /api/gym-mgmt/:gymId/reviews/:id/offer    — Offer incentive for review update
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

// Ensure tables
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_equipment (
        id SERIAL PRIMARY KEY,
        gym_id INTEGER NOT NULL,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(100),
        brand VARCHAR(100),
        quantity INTEGER DEFAULT 1,
        equipment_condition VARCHAR(50) DEFAULT 'good',
        is_out_of_order BOOLEAN DEFAULT false,
        out_of_order_since TIMESTAMPTZ,
        out_of_order_reason TEXT,
        photo_url TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_facilities (
        id SERIAL PRIMARY KEY,
        gym_id INTEGER NOT NULL,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(100),
        description TEXT,
        is_free BOOLEAN DEFAULT true,
        price_pence INTEGER DEFAULT 0,
        is_out_of_order BOOLEAN DEFAULT false,
        out_of_order_since TIMESTAMPTZ,
        out_of_order_reason TEXT,
        photo_url TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_schedule_overrides (
        id SERIAL PRIMARY KEY,
        gym_id INTEGER NOT NULL,
        override_date DATE NOT NULL,
        is_closed BOOLEAN DEFAULT true,
        open_time TEXT,
        close_time TEXT,
        reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(gym_id, override_date)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_review_responses (
        id SERIAL PRIMARY KEY,
        gym_id INTEGER NOT NULL,
        review_id INTEGER NOT NULL,
        responder_id TEXT NOT NULL,
        response_text TEXT NOT NULL,
        offer_type VARCHAR(50),
        offer_value TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(gym_id, review_id)
      )
    `);
  } catch (e) { console.error('Gym management table init:', e.message); }
})();

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });
  req.user = { id: req.session.userId };
  next();
}

// ═══ Equipment CRUD ═══

router.get('/:gymId/equipment', async (req, res) => {
  try {
    // Ensure table exists (in case init race condition)
    await pool.query(`CREATE TABLE IF NOT EXISTS gym_equipment (
      id SERIAL PRIMARY KEY, gym_id INTEGER NOT NULL, name VARCHAR(200) NOT NULL,
      category VARCHAR(100), brand VARCHAR(100), quantity INTEGER DEFAULT 1,
      equipment_condition VARCHAR(50) DEFAULT 'good',
      is_out_of_order BOOLEAN DEFAULT false, out_of_order_since TIMESTAMPTZ,
      out_of_order_reason TEXT, photo_url TEXT, sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const r = await pool.query(
      'SELECT * FROM gym_equipment WHERE gym_id = $1 ORDER BY sort_order, category, name',
      [req.params.gymId]
    );
    res.json({ equipment: r.rows, total: r.rows.length });
  } catch (e) { console.error('Equipment GET error:', e.message); res.status(500).json({ error: 'Failed' }); }
});

router.post('/:gymId/equipment', requireAuth, express.json(), async (req, res) => {
  try {
    const { name, category, brand, quantity, equipment_condition, photo_url } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(
      `INSERT INTO gym_equipment (gym_id, name, category, brand, quantity, equipment_condition, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.gymId, name, category || 'General', brand, quantity || 1, equipment_condition || 'good', photo_url]
    );
    res.json({ success: true, equipment: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed to add' }); }
});

router.put('/:gymId/equipment/:id', requireAuth, express.json(), async (req, res) => {
  try {
    const { name, category, brand, quantity, equipment_condition, photo_url } = req.body;
    await pool.query(
      `UPDATE gym_equipment SET name=COALESCE($1,name), category=COALESCE($2,category),
       brand=COALESCE($3,brand), quantity=COALESCE($4,quantity), equipment_condition=COALESCE($5,equipment_condition),
       photo_url=COALESCE($6,photo_url), updated_at=NOW()
       WHERE id=$7 AND gym_id=$8`,
      [name, category, brand, quantity, equipment_condition, photo_url, req.params.id, req.params.gymId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to update' }); }
});

router.delete('/:gymId/equipment/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM gym_equipment WHERE id=$1 AND gym_id=$2', [req.params.id, req.params.gymId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/:gymId/equipment/:id/status', requireAuth, express.json(), async (req, res) => {
  try {
    const { isOutOfOrder, reason } = req.body;
    await pool.query(
      `UPDATE gym_equipment SET is_out_of_order=$1,
       out_of_order_since=CASE WHEN $1 THEN NOW() ELSE NULL END,
       out_of_order_reason=CASE WHEN $1 THEN $2 ELSE NULL END,
       updated_at=NOW()
       WHERE id=$3 AND gym_id=$4`,
      [isOutOfOrder, reason, req.params.id, req.params.gymId]
    );
    res.json({ success: true, isOutOfOrder });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ Facilities CRUD ═══

router.get('/:gymId/facilities', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM gym_facilities WHERE gym_id = $1 ORDER BY sort_order, category, name',
      [req.params.gymId]
    );
    res.json({ facilities: r.rows, total: r.rows.length });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/:gymId/facilities', requireAuth, express.json(), async (req, res) => {
  try {
    const { name, category, description, is_free, price_pence, photo_url } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(
      `INSERT INTO gym_facilities (gym_id, name, category, description, is_free, price_pence, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.gymId, name, category || 'General', description, is_free !== false, price_pence || 0, photo_url]
    );
    res.json({ success: true, facility: r.rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed to add' }); }
});

router.put('/:gymId/facilities/:id', requireAuth, express.json(), async (req, res) => {
  try {
    const { name, category, description, is_free, price_pence, photo_url } = req.body;
    await pool.query(
      `UPDATE gym_facilities SET name=COALESCE($1,name), category=COALESCE($2,category),
       description=COALESCE($3,description), is_free=COALESCE($4,is_free), price_pence=COALESCE($5,price_pence),
       photo_url=COALESCE($6,photo_url), updated_at=NOW()
       WHERE id=$7 AND gym_id=$8`,
      [name, category, description, is_free, price_pence, photo_url, req.params.id, req.params.gymId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to update' }); }
});

router.delete('/:gymId/facilities/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM gym_facilities WHERE id=$1 AND gym_id=$2', [req.params.id, req.params.gymId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.patch('/:gymId/facilities/:id/status', requireAuth, express.json(), async (req, res) => {
  try {
    const { isOutOfOrder, reason } = req.body;
    await pool.query(
      `UPDATE gym_facilities SET is_out_of_order=$1,
       out_of_order_since=CASE WHEN $1 THEN NOW() ELSE NULL END,
       out_of_order_reason=CASE WHEN $1 THEN $2 ELSE NULL END,
       updated_at=NOW()
       WHERE id=$3 AND gym_id=$4`,
      [isOutOfOrder, reason, req.params.id, req.params.gymId]
    );
    res.json({ success: true, isOutOfOrder });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ Schedule Management ═══

router.get('/:gymId/schedule', async (req, res) => {
  try {
    const gym = await pool.query('SELECT opening_hours, is_24h FROM gyms WHERE id = $1', [req.params.gymId]).catch(() => ({ rows: [{}] }));
    const overrides = await pool.query(
      'SELECT * FROM gym_schedule_overrides WHERE gym_id = $1 AND override_date >= CURRENT_DATE ORDER BY override_date LIMIT 30',
      [req.params.gymId]
    );
    res.json({
      regularHours: gym.rows[0]?.opening_hours || {},
      is24h: gym.rows[0]?.is_24h || false,
      overrides: overrides.rows
    });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/:gymId/schedule', requireAuth, express.json(), async (req, res) => {
  try {
    const { openingHours, is24h } = req.body;
    await pool.query(
      `UPDATE gyms SET opening_hours = COALESCE($1::jsonb, opening_hours), is_24h = COALESCE($2, is_24h), updated_at = NOW()
       WHERE id = $3`,
      [openingHours ? JSON.stringify(openingHours) : null, is24h, req.params.gymId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/:gymId/schedule/close', requireAuth, express.json(), async (req, res) => {
  try {
    const { date, reason, openTime, closeTime } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const isClosed = !openTime; // If no open time, it's fully closed
    await pool.query(
      `INSERT INTO gym_schedule_overrides (gym_id, override_date, is_closed, open_time, close_time, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (gym_id, override_date) DO UPDATE SET is_closed=$3, open_time=$4, close_time=$5, reason=$6`,
      [req.params.gymId, date, isClosed, openTime, closeTime, reason]
    );
    res.json({ success: true, date, closed: isClosed });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ Review Management ═══

router.get('/:gymId/reviews', requireAuth, async (req, res) => {
  try {
    const reviews = await pool.query(
      `SELECT r.*, rr.response_text, rr.offer_type, rr.offer_value
       FROM reviews r
       LEFT JOIN gym_review_responses rr ON r.id = rr.review_id AND rr.gym_id = $1
       WHERE r.gym_id = $1
       ORDER BY r.created_at DESC LIMIT 50`,
      [req.params.gymId]
    ).catch(() => ({ rows: [] }));
    res.json({ reviews: reviews.rows });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/:gymId/reviews/:reviewId/respond', requireAuth, express.json(), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Response text required' });
    await pool.query(
      `INSERT INTO gym_review_responses (gym_id, review_id, responder_id, response_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (gym_id, review_id) DO UPDATE SET response_text = $4`,
      [req.params.gymId, req.params.reviewId, req.user.id, text]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/:gymId/reviews/:reviewId/offer', requireAuth, express.json(), async (req, res) => {
  try {
    const { offerType, offerValue, message } = req.body;
    // offerType: 'free_day', 'discount', 'towel', 'drink'
    await pool.query(
      `INSERT INTO gym_review_responses (gym_id, review_id, responder_id, response_text, offer_type, offer_value)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (gym_id, review_id) DO UPDATE SET response_text=$4, offer_type=$5, offer_value=$6`,
      [req.params.gymId, req.params.reviewId, req.user.id,
       message || 'We appreciate your feedback and would love to make it right!', offerType, offerValue]
    );
    res.json({ success: true, offerType });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
