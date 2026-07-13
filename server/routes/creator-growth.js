/**
 * Creator Growth Loops — Phase 4 of ScanSquad Creator Empowerment.
 *
 *  - Free Pass Giveaway (OnlyFans lead-gen): creator funds a £5 wallet
 *    credit from their referral balance; one follower claims it.
 *  - Boost Reel (Instagram): creator pays £1/day from balance to pin
 *    their reel to the top of the public feed.
 *  - Bundle Deals (OnlyFans): "3 passes for £12" — buyer tops up the
 *    full price, creator funds the bonus credit on redemption.
 *  - Booking Alerts are client-side (poller on existing stats endpoint).
 *
 * Funding model: every paid action inserts a row into creator_withdrawals
 * (existing table) so the creator's available balance drops atomically
 * with the same math referrals.js already uses (pending/approved/paid).
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { creditWallet } = require('../lib/wallet-credit');
const { authenticateUser } = require('../middleware/auth');
const crypto = require('crypto');

router.use(express.json());

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const GIVEAWAY_COST_PENCE = 500;   // funds one £5 day pass credit
const BOOST_PENCE_PER_DAY = 100;
const BUNDLE_PRESETS = {
  '3for12': { passes: 3, pricePence: 1200, valuePence: 1500, label: '3 gym passes for £12' },
  '5for20': { passes: 5, pricePence: 2000, valuePence: 2500, label: '5 gym passes for £20' },
};

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_giveaways (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        claim_code VARCHAR(20) UNIQUE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        funded_withdrawal_id INTEGER,
        claimed_by_user TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        claimed_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_giveaways_handle ON creator_giveaways(creator_handle, status)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_boosts (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        upload_id INTEGER UNIQUE NOT NULL,
        boost_until TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_bundles (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) UNIQUE NOT NULL,
        preset VARCHAR(20) NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bundle_redemptions (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        user_id TEXT NOT NULL,
        bonus_pence INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(creator_handle, user_id)
      )
    `);
    console.log('[CreatorGrowth] Tables ready');
  } catch (err) {
    console.error('[CreatorGrowth] Table setup error:', err.message);
  }
})();

/** Available balance = converted commissions - held/paid withdrawals. */
async function availablePence(handle) {
  const earned = await pool.query(
    `SELECT COALESCE(SUM(commission_pence), 0)::int AS p
     FROM creator_referrals WHERE creator_handle = $1 AND status = 'converted'`,
    [handle]
  );
  const held = await pool.query(
    `SELECT COALESCE(SUM(amount_pence) FILTER (WHERE status IN ('approved','paid','pending')), 0)::int AS p
     FROM creator_withdrawals WHERE creator_handle = $1`,
    [handle]
  );
  return Math.max(0, earned.rows[0].p - held.rows[0].p);
}

async function holdFunds(handle, pence, note, status) {
  const result = await pool.query(
    `INSERT INTO creator_withdrawals (creator_handle, amount_pence, payment_method, admin_notes, status)
     VALUES ($1, $2, 'creator_spend', $3, $4) RETURNING id`,
    [handle, pence, note, status || 'pending']
  );
  return result.rows[0].id;
}

// ── Free Pass Giveaway ──────────────────────────────────────────

router.post('/giveaway', async (req, res) => {
  try {
    const { handle } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const existing = await pool.query(
      `SELECT id FROM creator_giveaways WHERE creator_handle = $1 AND status = 'active'`, [handle]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'You already have an active giveaway' });
    const balance = await availablePence(handle);
    if (balance < GIVEAWAY_COST_PENCE) {
      return res.status(402).json({ error: `You need £${(GIVEAWAY_COST_PENCE / 100).toFixed(2)} available balance (you have £${(balance / 100).toFixed(2)})` });
    }
    const holdId = await holdFunds(handle, GIVEAWAY_COST_PENCE, 'Free Pass Giveaway hold', 'pending');
    const code = crypto.randomBytes(6).toString('hex');
    const g = await pool.query(
      `INSERT INTO creator_giveaways (creator_handle, claim_code, funded_withdrawal_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [handle, code, holdId]
    );
    res.json({ success: true, giveaway: g.rows[0], claimUrl: `https://scangym.com/r/${handle}?giveaway=${code}` });
  } catch (err) {
    console.error('[CreatorGrowth] giveaway create error:', err.message);
    res.status(500).json({ error: 'Failed to create giveaway' });
  }
});

router.get('/giveaway/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
  try {
    const g = await pool.query(
      `SELECT * FROM creator_giveaways WHERE creator_handle = $1 ORDER BY created_at DESC LIMIT 5`, [handle]
    );
    const active = g.rows.find(r => r.status === 'active') || null;
    res.json({
      handle,
      active: active ? { id: active.id, claimCode: active.claim_code, claimUrl: `https://scangym.com/r/${handle}?giveaway=${active.claim_code}`, createdAt: active.created_at } : null,
      history: g.rows.map(r => ({ id: r.id, status: r.status, createdAt: r.created_at, claimedAt: r.claimed_at })),
      costPence: GIVEAWAY_COST_PENCE,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load giveaway' });
  }
});

router.post('/giveaway/claim', authenticateUser, async (req, res) => {
  try {
    const code = String((req.body || {}).code || '').replace(/[^a-f0-9]/g, '').slice(0, 20);
    if (!code) return res.status(400).json({ error: 'Invalid code' });
    const g = await pool.query(
      `UPDATE creator_giveaways SET status = 'claimed', claimed_by_user = $2, claimed_at = NOW()
       WHERE claim_code = $1 AND status = 'active' RETURNING *`,
      [code, String(req.user.id)]
    );
    if (g.rows.length === 0) return res.status(404).json({ error: 'Giveaway not found or already claimed' });
    const row = g.rows[0];
    // Mark the hold as spent
    if (row.funded_withdrawal_id) {
      await pool.query(
        `UPDATE creator_withdrawals SET status = 'paid', processed_at = NOW() WHERE id = $1`,
        [row.funded_withdrawal_id]
      );
    }
    const credit = await creditWallet(pool, String(req.user.id), GIVEAWAY_COST_PENCE, `Free gym pass giveaway from @${row.creator_handle}`, 'giveaway');
    res.json({ success: true, creditedPence: GIVEAWAY_COST_PENCE, balanceAfterPence: credit ? credit.balanceAfterPence : null, from: row.creator_handle });
  } catch (err) {
    console.error('[CreatorGrowth] giveaway claim error:', err.message);
    res.status(500).json({ error: 'Failed to claim giveaway' });
  }
});

router.post('/giveaway/cancel', async (req, res) => {
  try {
    const { handle } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const g = await pool.query(
      `UPDATE creator_giveaways SET status = 'cancelled'
       WHERE creator_handle = $1 AND status = 'active' RETURNING funded_withdrawal_id`,
      [handle]
    );
    if (g.rows.length === 0) return res.status(404).json({ error: 'No active giveaway' });
    if (g.rows[0].funded_withdrawal_id) {
      await pool.query(
        `UPDATE creator_withdrawals SET status = 'cancelled', rejected_at = NOW() WHERE id = $1`,
        [g.rows[0].funded_withdrawal_id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel giveaway' });
  }
});

// ── Boost Reel ──────────────────────────────────────────────────

router.post('/boost', async (req, res) => {
  try {
    const { handle, uploadId } = req.body || {};
    let days = parseInt((req.body || {}).days, 10) || 1;
    days = Math.min(Math.max(days, 1), 7);
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const upId = parseInt(uploadId, 10);
    if (!upId) return res.status(400).json({ error: 'Invalid uploadId' });
    const upload = await pool.query(
      `SELECT id, status FROM creator_uploads WHERE id = $1 AND creator_handle = $2`, [upId, handle]
    );
    if (upload.rows.length === 0) return res.status(404).json({ error: 'Reel not found' });
    if (upload.rows[0].status !== 'approved') return res.status(400).json({ error: 'Reel must be approved before boosting' });
    const cost = BOOST_PENCE_PER_DAY * days;
    const balance = await availablePence(handle);
    if (balance < cost) {
      return res.status(402).json({ error: `Boost costs £${(cost / 100).toFixed(2)} (you have £${(balance / 100).toFixed(2)})` });
    }
    await holdFunds(handle, cost, `Reel boost: upload ${upId} x ${days} day(s)`, 'paid');
    const boost = await pool.query(
      `INSERT INTO creator_boosts (creator_handle, upload_id, boost_until)
       VALUES ($1, $2, NOW() + ($3 || ' days')::interval)
       ON CONFLICT (upload_id) DO UPDATE SET
         boost_until = GREATEST(creator_boosts.boost_until, NOW()) + ($3 || ' days')::interval
       RETURNING *`,
      [handle, upId, String(days)]
    );
    res.json({ success: true, boost: boost.rows[0], costPence: cost });
  } catch (err) {
    console.error('[CreatorGrowth] boost error:', err.message);
    res.status(500).json({ error: 'Failed to boost reel' });
  }
});

router.get('/boosts/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
  try {
    const result = await pool.query(
      `SELECT b.*, u.caption FROM creator_boosts b
       LEFT JOIN creator_uploads u ON u.id = b.upload_id
       WHERE b.creator_handle = $1 AND b.boost_until > NOW()
       ORDER BY b.boost_until DESC`,
      [handle]
    );
    res.json({ handle, boosts: result.rows, pencePerDay: BOOST_PENCE_PER_DAY });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load boosts' });
  }
});

// ── Bundle Deals ────────────────────────────────────────────────

router.post('/bundle', async (req, res) => {
  try {
    const { handle, preset } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    if (preset === null || preset === '' || preset === 'off') {
      await pool.query(`UPDATE creator_bundles SET active = false, updated_at = NOW() WHERE creator_handle = $1`, [handle]);
      return res.json({ success: true, active: false });
    }
    if (!BUNDLE_PRESETS[preset]) return res.status(400).json({ error: 'Unknown preset' });
    const result = await pool.query(
      `INSERT INTO creator_bundles (creator_handle, preset, active)
       VALUES ($1, $2, true)
       ON CONFLICT (creator_handle) DO UPDATE SET preset = $2, active = true, updated_at = NOW()
       RETURNING *`,
      [handle, preset]
    );
    res.json({ success: true, bundle: { ...result.rows[0], ...BUNDLE_PRESETS[preset] } });
  } catch (err) {
    console.error('[CreatorGrowth] bundle error:', err.message);
    res.status(500).json({ error: 'Failed to set bundle' });
  }
});

router.get('/bundle/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
  try {
    const result = await pool.query(
      `SELECT * FROM creator_bundles WHERE creator_handle = $1 AND active = true`, [handle]
    );
    if (result.rows.length === 0) return res.json({ handle, bundle: null });
    const preset = BUNDLE_PRESETS[result.rows[0].preset];
    res.json({ handle, bundle: preset ? { preset: result.rows[0].preset, ...preset } : null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bundle' });
  }
});

/**
 * Redeem the bundle bonus after topping up the bundle price.
 * Verifies a qualifying top_up in the last 24h, one redemption per
 * user per creator, and that the creator can fund the bonus.
 */
router.post('/bundle/redeem', authenticateUser, async (req, res) => {
  try {
    const { handle } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const userId = String(req.user.id);
    const bundleRow = await pool.query(
      `SELECT * FROM creator_bundles WHERE creator_handle = $1 AND active = true`, [handle]
    );
    if (bundleRow.rows.length === 0) return res.status(404).json({ error: 'This creator has no active bundle' });
    const preset = BUNDLE_PRESETS[bundleRow.rows[0].preset];
    if (!preset) return res.status(404).json({ error: 'Bundle preset no longer available' });
    const bonus = preset.valuePence - preset.pricePence;

    const topup = await pool.query(
      `SELECT id FROM wallet_transactions
       WHERE user_id = $1 AND type = 'top_up' AND amount_pence >= $2
         AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
      [userId, preset.pricePence]
    );
    if (topup.rows.length === 0) {
      return res.status(400).json({ error: `Top up £${(preset.pricePence / 100).toFixed(2)} first, then redeem your bonus` });
    }
    const creatorBalance = await availablePence(handle);
    if (creatorBalance < bonus) return res.status(409).json({ error: 'Bundle temporarily unavailable' });

    // One redemption per user per creator (unique constraint enforces atomically)
    try {
      await pool.query(
        `INSERT INTO bundle_redemptions (creator_handle, user_id, bonus_pence) VALUES ($1, $2, $3)`,
        [handle, userId, bonus]
      );
    } catch (e) {
      return res.status(409).json({ error: 'You already redeemed this bundle' });
    }
    await holdFunds(handle, bonus, `Bundle bonus redemption by user ${userId}`, 'paid');
    const credit = await creditWallet(pool, userId, bonus, `Bundle bonus (${preset.label}) from @${handle}`, 'bundle');
    res.json({ success: true, bonusPence: bonus, balanceAfterPence: credit ? credit.balanceAfterPence : null });
  } catch (err) {
    console.error('[CreatorGrowth] bundle redeem error:', err.message);
    res.status(500).json({ error: 'Failed to redeem bundle' });
  }
});

module.exports = router;
