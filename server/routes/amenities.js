/**
 * Amenities & Vending Routes
 * 
 * Gym amenities: locker, towel, shower, changing room, hair dryer, music
 * Vending machine: water, towel, pre/post workout, BCAA, protein bars, energy, coffee
 * 
 * Endpoints:
 *   GET  /api/amenities/:gymId               — Get gym amenities
 *   PUT  /api/amenities/:gymId               — Update gym amenities (owner)
 *   GET  /api/amenities/:gymId/vending       — Get vending machine menu
 *   PUT  /api/amenities/:gymId/vending       — Update vending menu (owner)
 *   POST /api/amenities/:gymId/vending/buy   — Buy from vending machine
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');


function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });
  req.user = { id: req.session.userId };
  next();
}

// Default vending items for new gyms
const DEFAULT_VENDING = [
  { name: 'Water Bottle', category: 'drinks', emoji: '💧', price: 150 },
  { name: 'Towel', category: 'essentials', emoji: '🧺', price: 200 },
  { name: 'Pre-Workout Drink', category: 'supplements', emoji: '⚡', price: 350 },
  { name: 'Post-Workout Shake', category: 'supplements', emoji: '🥤', price: 400 },
  { name: 'BCAA Drink', category: 'supplements', emoji: '💪', price: 350 },
  { name: 'Protein Bar', category: 'snacks', emoji: '🍫', price: 250 },
  { name: 'Energy Drink', category: 'drinks', emoji: '🔋', price: 200 },
  { name: 'Coffee', category: 'drinks', emoji: '☕', price: 200 },
];

// GET /:gymId — Get gym amenities
router.get('/:gymId', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM gym_amenities WHERE gym_id = $1', [req.params.gymId]);
    if (!r.rows.length) {
      return res.json({
        gym_id: parseInt(req.params.gymId),
        amenities: [],
        raw: {}
      });
    }
    const a = r.rows[0];
    const amenities = [];
    if (a.has_locker) amenities.push({ name: 'Locker', emoji: '🔐', free: a.locker_free });
    if (a.has_towel) amenities.push({ name: 'Towel', emoji: '🧺', free: a.towel_free });
    if (a.has_shower) amenities.push({ name: 'Shower', emoji: '🚿', free: a.shower_free });
    if (a.has_changing_room) amenities.push({ name: 'Changing Room', emoji: '👔', free: true });
    if (a.has_hair_dryer) amenities.push({ name: 'Hair Dryer', emoji: '💨', free: true });
    if (a.has_music_system) amenities.push({ name: 'Music', emoji: '🎵', free: true });
    if (a.has_sauna) amenities.push({ name: 'Sauna', emoji: '🧖', free: false });
    if (a.has_wifi) amenities.push({ name: 'WiFi', emoji: '📶', free: true });
    if (a.has_parking) amenities.push({ name: 'Parking', emoji: '🅿️', free: true });
    if (a.has_water_fountain) amenities.push({ name: 'Water Fountain', emoji: '🚰', free: true });
    res.json({ gym_id: a.gym_id, amenities, raw: a });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

// PUT /:gymId — Update amenities (gym owner)
router.put('/:gymId', requireAuth, express.json(), async (req, res) => {
  try {
    const gymId = req.params.gymId;
    // Verify ownership
    const gym = await pool.query('SELECT claimed_by FROM gyms WHERE id = $1', [gymId]);
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });

    const fields = req.body;
    await pool.query(
      `INSERT INTO gym_amenities (gym_id, has_locker, locker_free, has_towel, towel_free, has_shower, shower_free,
        has_changing_room, has_hair_dryer, has_music_system, has_sauna, has_wifi, has_parking, has_water_fountain, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (gym_id) DO UPDATE SET
         has_locker=COALESCE($2,gym_amenities.has_locker), locker_free=COALESCE($3,gym_amenities.locker_free),
         has_towel=COALESCE($4,gym_amenities.has_towel), towel_free=COALESCE($5,gym_amenities.towel_free),
         has_shower=COALESCE($6,gym_amenities.has_shower), shower_free=COALESCE($7,gym_amenities.shower_free),
         has_changing_room=COALESCE($8,gym_amenities.has_changing_room),
         has_hair_dryer=COALESCE($9,gym_amenities.has_hair_dryer),
         has_music_system=COALESCE($10,gym_amenities.has_music_system),
         has_sauna=COALESCE($11,gym_amenities.has_sauna), has_wifi=COALESCE($12,gym_amenities.has_wifi),
         has_parking=COALESCE($13,gym_amenities.has_parking), has_water_fountain=COALESCE($14,gym_amenities.has_water_fountain),
         notes=COALESCE($15,gym_amenities.notes), updated_at=NOW()`,
      [gymId, fields.has_locker, fields.locker_free, fields.has_towel, fields.towel_free,
       fields.has_shower, fields.shower_free, fields.has_changing_room, fields.has_hair_dryer,
       fields.has_music_system, fields.has_sauna, fields.has_wifi, fields.has_parking,
       fields.has_water_fountain, fields.notes]
    );

    res.json({ success: true });
  } catch (e) {
    console.error('Update amenities error:', e.message);
    res.status(500).json({ error: 'Update failed' });
  }
});

// GET /:gymId/vending — Get vending menu
router.get('/:gymId/vending', async (req, res) => {
  try {
    const items = await pool.query(
      'SELECT * FROM gym_vending WHERE gym_id = $1 ORDER BY sort_order, item_category, item_name',
      [req.params.gymId]
    );
    if (!items.rows.length) {
      // Return default menu
      return res.json({ gym_id: parseInt(req.params.gymId), items: DEFAULT_VENDING.map((d, i) => ({
        ...d, price_pence: d.price, item_name: d.name, item_category: d.category, item_emoji: d.emoji, in_stock: true, sort_order: i
      })), isDefault: true });
    }
    res.json({ gym_id: parseInt(req.params.gymId), items: items.rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

// PUT /:gymId/vending — Update vending menu (owner)
router.put('/:gymId/vending', requireAuth, express.json(), async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

    // Upsert all items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await pool.query(
        `INSERT INTO gym_vending (gym_id, item_name, item_category, item_emoji, price_pence, in_stock, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (gym_id, item_name) DO UPDATE SET
           item_category=$3, item_emoji=$4, price_pence=$5, in_stock=$6, sort_order=$7`,
        [req.params.gymId, item.name, item.category, item.emoji, item.price_pence, item.in_stock !== false, i]
      );
    }

    res.json({ success: true, count: items.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

// POST /:gymId/vending/buy — Purchase from vending machine
router.post('/:gymId/vending/buy', requireAuth, express.json(), async (req, res) => {
  try {
    const { itemName, paymentMethodId } = req.body;
    const item = await pool.query(
      'SELECT * FROM gym_vending WHERE gym_id = $1 AND item_name = $2 AND in_stock = true',
      [req.params.gymId, itemName]
    );
    if (!item.rows.length) return res.status(404).json({ error: 'Item not available' });

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const user = await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.user.id]);
    const customerId = user.rows[0]?.stripe_customer_id;

    if (customerId && paymentMethodId) {
      const pi = await stripe.paymentIntents.create({
        amount: item.rows[0].price_pence,
        currency: 'gbp',
        customer: customerId,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: { type: 'vending', gym_id: req.params.gymId, item: itemName }
      });

      await pool.query(
        'INSERT INTO vending_purchases (gym_id, user_id, item_name, amount_pence, stripe_payment_intent_id) VALUES ($1,$2,$3,$4,$5)',
        [req.params.gymId, req.user.id, itemName, item.rows[0].price_pence, pi.id]
      );
    }

    res.json({ success: true, item: itemName, message: `${item.rows[0].item_emoji} ${itemName} purchased!` });
  } catch (e) {
    console.error('Vending buy error:', e.message);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

module.exports = router;
