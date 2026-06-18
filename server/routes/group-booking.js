/**
 * Group Booking Routes — Book for partner / group + split payment
 * 
 * Endpoints:
 *   POST /api/group/create          — Create group booking (organizer)
 *   POST /api/group/join/:code      — Join a group booking via code
 *   POST /api/group/split-pay       — Pay your share of a group booking
 *   GET  /api/group/:bookingId      — Get group booking details
 *   GET  /api/group/my              — List my group bookings
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const crypto = require('crypto');
const pricing = require('../lib/pricing-engine');

// Ensure tables exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_bookings (
        id SERIAL PRIMARY KEY,
        group_code VARCHAR(12) UNIQUE NOT NULL,
        organizer_id TEXT NOT NULL,
        gym_id INTEGER NOT NULL,
        booking_date DATE NOT NULL,
        time_slot TEXT DEFAULT 'anytime',
        max_members INTEGER DEFAULT 10,
        status TEXT DEFAULT 'open',
        total_amount_pence INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        id SERIAL PRIMARY KEY,
        group_booking_id INTEGER REFERENCES group_bookings(id),
        user_id TEXT NOT NULL,
        user_name VARCHAR(200),
        user_email VARCHAR(200),
        share_pence INTEGER DEFAULT 0,
        paid BOOLEAN DEFAULT false,
        stripe_payment_intent_id TEXT,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(group_booking_id, user_id)
      )
    `);
  } catch (e) { console.error('Group booking table init:', e.message); }
})();

function generateGroupCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });
  req.user = { id: req.session.userId };
  next();
}

// POST /create — Create a group booking
router.post('/create', requireAuth, express.json(), async (req, res) => {
  try {
    const { gymId, date, time, memberCount } = req.body;
    if (!gymId || !date) return res.status(400).json({ error: 'gymId and date required' });

    const gym = await pool.query('SELECT id, name, country FROM gyms WHERE id = $1', [gymId]);
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });

    const dayPrice = pricing.getDayPassPrice(gym.rows[0].country || 'GB');
    const count = Math.min(Math.max(memberCount || 2, 2), 10);
    const totalPence = dayPrice.amountPence * count;
    const groupCode = generateGroupCode();

    const result = await pool.query(
      `INSERT INTO group_bookings (group_code, organizer_id, gym_id, booking_date, time_slot, max_members, total_amount_pence)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [groupCode, req.user.id, gymId, date, time || 'anytime', count, totalPence]
    );

    // Auto-add organizer as first member
    const sharePence = Math.ceil(totalPence / count);
    await pool.query(
      `INSERT INTO group_members (group_booking_id, user_id, share_pence) VALUES ($1, $2, $3)`,
      [result.rows[0].id, req.user.id, sharePence]
    );

    res.json({
      success: true,
      groupCode,
      bookingId: result.rows[0].id,
      shareLink: `https://scangym.com/group/${groupCode}`,
      perPerson: { amount: sharePence / 100, display: dayPrice.symbol + (sharePence / 100).toFixed(2) },
      totalMembers: count,
      gym: gym.rows[0].name
    });
  } catch (e) {
    console.error('Group create error:', e.message);
    res.status(500).json({ error: 'Failed to create group booking' });
  }
});

// POST /join/:code — Join a group booking
router.post('/join/:code', requireAuth, express.json(), async (req, res) => {
  try {
    const gb = await pool.query('SELECT * FROM group_bookings WHERE group_code = $1', [req.params.code]);
    if (!gb.rows.length) return res.status(404).json({ error: 'Group not found' });
    const g = gb.rows[0];
    if (g.status !== 'open') return res.status(400).json({ error: 'Group is closed' });

    const members = await pool.query('SELECT * FROM group_members WHERE group_booking_id = $1', [g.id]);
    if (members.rows.length >= g.max_members) return res.status(400).json({ error: 'Group is full' });

    const sharePence = Math.ceil(g.total_amount_pence / g.max_members);
    await pool.query(
      `INSERT INTO group_members (group_booking_id, user_id, user_name, share_pence)
       VALUES ($1, $2, $3, $4) ON CONFLICT (group_booking_id, user_id) DO NOTHING`,
      [g.id, req.user.id, req.body.name || 'Member', sharePence]
    );

    res.json({ success: true, groupCode: g.group_code, share: sharePence / 100 });
  } catch (e) {
    console.error('Group join error:', e.message);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// POST /split-pay — Pay your share
router.post('/split-pay', requireAuth, express.json(), async (req, res) => {
  try {
    const { groupCode, paymentMethodId } = req.body;
    const gb = await pool.query('SELECT * FROM group_bookings WHERE group_code = $1', [req.params.code || groupCode]);
    if (!gb.rows.length) return res.status(404).json({ error: 'Group not found' });

    const member = await pool.query(
      'SELECT * FROM group_members WHERE group_booking_id = $1 AND user_id = $2',
      [gb.rows[0].id, req.user.id]
    );
    if (!member.rows.length) return res.status(404).json({ error: 'Not a member of this group' });
    if (member.rows[0].paid) return res.json({ success: true, alreadyPaid: true });

    // Charge via Stripe
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const customer = await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.user.id]);
    const customerId = customer.rows[0]?.stripe_customer_id;

    if (customerId && paymentMethodId) {
      const pi = await stripe.paymentIntents.create({
        amount: member.rows[0].share_pence,
        currency: 'gbp',
        customer: customerId,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: { type: 'group_split', group_code: groupCode, user_id: req.user.id }
      });

      await pool.query(
        'UPDATE group_members SET paid = true, stripe_payment_intent_id = $1 WHERE id = $2',
        [pi.id, member.rows[0].id]
      );
    }

    res.json({ success: true, paid: true });
  } catch (e) {
    console.error('Split pay error:', e.message);
    res.status(500).json({ error: 'Payment failed' });
  }
});

// GET /my — My group bookings (MUST be before /:bookingId)
router.get('/my', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });
  try {
    const groups = await pool.query(
      `SELECT gb.*, g.name as gym_name FROM group_bookings gb
       JOIN group_members gm ON gb.id = gm.group_booking_id
       LEFT JOIN gyms g ON gb.gym_id = g.id
       WHERE gm.user_id = $1 ORDER BY gb.created_at DESC LIMIT 20`,
      [req.session.userId]
    );
    res.json(groups.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

// GET /:bookingId — Get group booking details
router.get('/:bookingId', async (req, res) => {
  try {
    const gb = await pool.query(
      'SELECT * FROM group_bookings WHERE id = $1 OR group_code = $1',
      [req.params.bookingId]
    );
    if (!gb.rows.length) return res.status(404).json({ error: 'Not found' });

    const members = await pool.query(
      'SELECT user_id, user_name, paid, joined_at FROM group_members WHERE group_booking_id = $1 ORDER BY joined_at',
      [gb.rows[0].id]
    );

    const gym = await pool.query('SELECT name, address FROM gyms WHERE id = $1', [gb.rows[0].gym_id]);

    res.json({
      ...gb.rows[0],
      gym: gym.rows[0] || {},
      members: members.rows,
      paidCount: members.rows.filter(m => m.paid).length,
      totalMembers: members.rows.length
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load group booking' });
  }
});

module.exports = router;
