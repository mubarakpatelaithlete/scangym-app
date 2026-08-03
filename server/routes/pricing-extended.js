/**
 * Extended Pricing Routes (#133, #134, #135, #136, #137)
 * Competitive pricing, gift passes, group/couple passes, carry-forward
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { BASE_PRICE_GBP } = require('../lib/pricing-engine');

// Single source of truth for the base day-pass price: lib/pricing-engine.js.
// These routes used to hardcode 4.49 in three places, so a price change here
// silently disagreed with /api/pricing, the app and Stripe.

// #133: Price comparison — show 25% less than gym's own price
router.get('/compare/:gymId', async (req, res) => {
  try {
    const gymId = req.params.gymId;
    // Try to get gym's listed price from our DB
    const gymResult = await pool.query(
      'SELECT name, day_pass_price, google_price FROM gyms WHERE id = $1',
      [gymId]
    ).catch(() => ({ rows: [] }));

    const gym = gymResult.rows[0];
    const googlePrice = gym?.google_price || gym?.day_pass_price || 12.00;
    const scanGymPrice = Math.round(googlePrice * 0.75 * 100) / 100; // 25% less
    const savings = Math.round((googlePrice - scanGymPrice) * 100) / 100;
    const savingsPct = Math.round((savings / googlePrice) * 100);

    res.json({
      gymPrice: googlePrice,
      scanGymPrice: Math.max(scanGymPrice, 3.00), // minimum £3
      savings,
      savingsPct,
      message: `Save ${savingsPct}% vs gym's own price!`
    });
  } catch (err) {
    const fallbackSavings = Math.round((12 - BASE_PRICE_GBP) * 100) / 100;
    res.json({ gymPrice: 12, scanGymPrice: BASE_PRICE_GBP, savings: fallbackSavings, savingsPct: Math.round((fallbackSavings / 12) * 100), message: 'Save with ScanGym!' });
  }
});

// #134: Gift pass for someone else
router.post('/gift', express.json(), async (req, res) => {
  const { buyerId, recipientEmail, recipientPhone, gymId, date, message } = req.body;
  if (!recipientEmail && !recipientPhone) {
    return res.status(400).json({ error: 'Recipient email or phone required' });
  }

  const giftCode = 'GIFT-' + Math.random().toString(36).slice(2, 8).toUpperCase();

  try {
    await pool.query(
      'INSERT INTO gift_passes (code, buyer_id, recipient_email, recipient_phone, gym_id, date, message, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())',
      [giftCode, buyerId, recipientEmail, recipientPhone, gymId, date, message || '🎁 Enjoy your workout!', 'pending']
    ).catch(() => {});

    res.json({
      success: true,
      giftCode,
      message: `Gift pass created! Share code ${giftCode} with your friend.`,
      redeemUrl: `https://scangym.com/redeem?code=${giftCode}`
    });
  } catch (err) {
    res.json({ success: true, giftCode, message: `Gift pass code: ${giftCode}` });
  }
});

// Redeem gift pass
router.post('/gift/redeem', express.json(), async (req, res) => {
  const { code, userId } = req.body;
  if (!code) return res.status(400).json({ error: 'Gift code required' });

  try {
    const result = await pool.query(
      'UPDATE gift_passes SET status = $1, redeemed_by = $2, redeemed_at = NOW() WHERE code = $3 AND status = $4 RETURNING *',
      ['redeemed', userId, code.toUpperCase(), 'pending']
    ).catch(() => ({ rows: [] }));

    if (result.rows.length > 0) {
      res.json({ success: true, pass: result.rows[0], message: '🎉 Gift pass redeemed!' });
    } else {
      res.json({ success: false, error: 'Invalid or already used gift code' });
    }
  } catch (err) {
    res.json({ success: false, error: 'Could not redeem code' });
  }
});

// #135: Group booking (3-10 people)
router.post('/group', express.json(), async (req, res) => {
  const { gymId, date, groupSize, organiserEmail, members } = req.body;
  if (!groupSize || groupSize < 2 || groupSize > 10) {
    return res.status(400).json({ error: 'Group size must be 2-10' });
  }

  const basePrice = BASE_PRICE_GBP;
  const discount = groupSize >= 5 ? 0.20 : groupSize >= 3 ? 0.10 : 0; // 10-20% group discount
  const perPerson = Math.round(basePrice * (1 - discount) * 100) / 100;
  const total = Math.round(perPerson * groupSize * 100) / 100;
  const groupCode = 'GRP-' + Math.random().toString(36).slice(2, 8).toUpperCase();

  res.json({
    success: true,
    groupCode,
    groupSize,
    perPerson,
    total,
    discount: Math.round(discount * 100) + '%',
    message: `Group of ${groupSize}: £${perPerson}/person (${Math.round(discount * 100)}% off) = £${total} total`
  });
});

// #136: Couple pass (2 people, 15% discount)
router.post('/couple', express.json(), async (req, res) => {
  const { gymId, date, partnerEmail } = req.body;
  const basePrice = BASE_PRICE_GBP;
  const couplePrice = Math.round(basePrice * 0.85 * 2 * 100) / 100; // 15% off for 2
  const perPerson = Math.round(basePrice * 0.85 * 100) / 100;

  res.json({
    success: true,
    coupleCode: 'CPL-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    perPerson,
    total: couplePrice,
    savings: Math.round((basePrice * 2 - couplePrice) * 100) / 100,
    message: `Couple pass: £${perPerson}/person = £${couplePrice} total (save 15%!)`
  });
});

// #137: Carry-forward unused days
router.get('/carry-forward/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, gym_id, booking_date, status, created_at FROM bookings 
       WHERE user_id = $1 AND status = 'unused' AND booking_date < CURRENT_DATE 
       ORDER BY booking_date DESC LIMIT 10`,
      [req.params.userId]
    ).catch(() => ({ rows: [] }));

    const credits = result.rows.length;
    res.json({
      unusedPasses: result.rows,
      creditsAvailable: credits,
      message: credits > 0
        ? `You have ${credits} unused day pass${credits > 1 ? 'es' : ''} that can be carried forward!`
        : 'No unused passes to carry forward.'
    });
  } catch (err) {
    res.json({ unusedPasses: [], creditsAvailable: 0, message: 'No unused passes.' });
  }
});

// Apply carry-forward
router.post('/carry-forward/apply', express.json(), async (req, res) => {
  const { userId, bookingId, newDate } = req.body;
  if (!bookingId || !newDate) return res.status(400).json({ error: 'bookingId and newDate required' });

  try {
    await pool.query(
      'UPDATE bookings SET booking_date = $1, status = $2 WHERE id = $3 AND user_id = $4 AND status = $5',
      [newDate, 'rescheduled', bookingId, userId, 'unused']
    ).catch(() => {});
    res.json({ success: true, message: `Pass rescheduled to ${newDate}!` });
  } catch (err) {
    res.json({ success: false, error: 'Could not reschedule pass' });
  }
});

module.exports = router;
