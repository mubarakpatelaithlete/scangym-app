/**
 * Gym Owner Quick Controls -- #98 #99 #100
 * Zomato-style: one-tap open/close + instant price setting with 3-strike abuse detection
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

(async () => {
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='complaint_count') THEN
          ALTER TABLE gyms ADD COLUMN complaint_count INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='suspended_until') THEN
          ALTER TABLE gyms ADD COLUMN suspended_until TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='strike_count') THEN
          ALTER TABLE gyms ADD COLUMN strike_count INTEGER DEFAULT 0;
        END IF;
      END $$;
    `);
  } catch(e) { console.error('[GymOwner] Migration:', e.message); }
})();

// PUT /:gymId/quick-toggle -- one-tap open/close
router.put('/:gymId/quick-toggle', authenticateUser, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { isOpen } = req.body;
    const gym = await pool.query('SELECT id, owner_id, suspended_until, strike_count FROM gyms WHERE id = $1', [gymId]);
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];
    if (g.owner_id !== 'system' && g.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your gym' });
    }
    if (g.suspended_until && new Date() < new Date(g.suspended_until)) {
      return res.status(403).json({
        error: `Gym suspended until ${new Date(g.suspended_until).toLocaleString('en-GB')} due to customer complaints.`,
        suspendedUntil: g.suspended_until
      });
    }
    await pool.query('UPDATE gyms SET is_accepting_bookings = $1, updated_at = NOW() WHERE id = $2', [isOpen, gymId]);
    res.json({
      success: true,
      isOpen,
      message: isOpen ? '✅ Your gym is now OPEN and accepting bookings' : '🔴 Your gym is now CLOSED',
      strikes: g.strike_count || 0,
      maxStrikes: 3
    });
  } catch (err) {
    console.error('[GymOwner] Toggle error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PUT /:gymId/quick-price -- instant price update
router.put('/:gymId/quick-price', authenticateUser, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { price } = req.body;
    if (!price || isNaN(parseFloat(price))) return res.status(400).json({ error: 'Valid price required' });
    const priceNum = parseFloat(price);
    if (priceNum < 3) return res.status(400).json({ error: 'Minimum price is £3.00' });
    if (priceNum > 50) return res.status(400).json({ error: 'Maximum price is £50.00' });
    const gym = await pool.query('SELECT id, owner_id, day_pass_price FROM gyms WHERE id = $1', [gymId]);
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];
    if (g.owner_id !== 'system' && g.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your gym' });
    }
    await pool.query('UPDATE gyms SET day_pass_price = $1, updated_at = NOW() WHERE id = $2', [priceNum, gymId]);
    res.json({ success: true, newPrice: priceNum, message: `💰 Price updated to £${priceNum.toFixed(2)}/day` });
  } catch (err) {
    console.error('[GymOwner] Price error:', err);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

// POST /:gymId/report -- customer complaint (3-strike Zomato rule)
router.post('/:gymId/report', authenticateUser, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { reason } = req.body;
    const booking = await pool.query(
      'SELECT id FROM bookings WHERE gym_id = $1 AND user_id = $2 AND created_at > NOW() - INTERVAL \'7 days\' LIMIT 1',
      [gymId, req.user.id]
    );
    if (!booking.rows.length) return res.status(403).json({ error: 'You can only report gyms you recently visited' });
    const gym = await pool.query('SELECT id, complaint_count, strike_count, suspended_until FROM gyms WHERE id = $1', [gymId]);
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];
    const newComplaints = (g.complaint_count || 0) + 1;
    let strikes = g.strike_count || 0;
    let suspendedUntil = g.suspended_until;
    let message = 'Report received. Thank you for keeping ScanGym accurate.';
    if (newComplaints % 3 === 0) {
      strikes++;
      if (strikes === 1) message = 'Gym received a warning. 2 more strikes = suspension.';
      else if (strikes === 2) message = 'Gym received final warning. 1 more strike = 24h suspension.';
      else if (strikes >= 3) {
        suspendedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        message = 'Gym suspended 24 hours due to repeated complaints.';
        await pool.query('UPDATE gyms SET is_accepting_bookings = false WHERE id = $1', [gymId]);
      }
    }
    await pool.query(
      'UPDATE gyms SET complaint_count = $1, strike_count = $2, suspended_until = $3 WHERE id = $4',
      [newComplaints, strikes, suspendedUntil, gymId]
    );
    res.json({ success: true, message, strikes });
  } catch (err) {
    console.error('[GymOwner] Report error:', err);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

module.exports = router;
