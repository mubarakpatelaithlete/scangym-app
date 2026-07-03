/**
 * Task 14: ScanGym Wallet System
 * In-app credits for top-ups, spending, refunds, and referral rewards.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

// GET /api/wallet - Get wallet balance
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    let wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (wallet.rows.length === 0) {
      wallet = await pool.query(`
        INSERT INTO wallets (user_id, balance_pence, total_loaded_pence, total_spent_pence, currency, is_active, created_at, updated_at)
        VALUES ($1, 0, 0, 0, 'GBP', true, NOW(), NOW())
        RETURNING *
      `, [userId]);
    }
    const w = wallet.rows[0];
    res.json({
      balance: w.balance_pence / 100,
      balancePence: w.balance_pence,
      totalLoaded: w.total_loaded_pence / 100,
      totalSpent: w.total_spent_pence / 100,
      currency: w.currency || 'GBP',
    });
  } catch (err) {
    console.error('Get wallet error:', err);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// POST /api/wallet/topup - Add funds
router.post('/topup', async (req, res) => {
  try {
    const userId = req.user.id;
    let { amountPence, paymentMethodId } = req.body;
    if (req.body.amount && !amountPence) {
      amountPence = Math.round(req.body.amount * 100);
    }
    if (!amountPence || amountPence < 500) {
      return res.status(400).json({ error: 'Minimum top-up is £5.00 (500 pence)' });
    }
    if (amountPence > 50000) {
      return res.status(400).json({ error: 'Maximum top-up is £500.00' });
    }

    // Calculate bonus (10% for £20+, 15% for £50+)
    let bonusPence = 0;
    if (amountPence >= 5000) bonusPence = Math.round(amountPence * 0.15);
    else if (amountPence >= 2000) bonusPence = Math.round(amountPence * 0.10);
    const totalCredit = amountPence + bonusPence;

    let wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (wallet.rows.length === 0) {
      wallet = await pool.query(`
        INSERT INTO wallets (user_id, balance_pence, total_loaded_pence, total_spent_pence, currency, is_active, created_at, updated_at)
        VALUES ($1, 0, 0, 0, 'GBP', true, NOW(), NOW())
        RETURNING *
      `, [userId]);
    }
    const newBalance = wallet.rows[0].balance_pence + totalCredit;

    await pool.query(`
      UPDATE wallets SET balance_pence = $1, total_loaded_pence = total_loaded_pence + $2, updated_at = NOW()
      WHERE user_id = $3
    `, [newBalance, totalCredit, userId]);

    await pool.query(`
      INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
      VALUES ($1, $2, 'top_up', $3, $4, $5, 'stripe', NOW())
    `, [
      wallet.rows[0].id, userId, totalCredit, newBalance,
      bonusPence > 0 ? `Top-up £${(amountPence/100).toFixed(2)} + £${(bonusPence/100).toFixed(2)} bonus` : `Top-up £${(amountPence/100).toFixed(2)}`,
    ]);

    res.json({
      success: true,
      topUpAmount: amountPence / 100,
      bonusAmount: bonusPence / 100,
      totalCredited: totalCredit / 100,
      newBalance: newBalance / 100,
      currency: 'GBP',
    });
  } catch (err) {
    console.error('Wallet topup error:', err);
    res.status(500).json({ error: 'Failed to top up wallet' });
  }
});

// POST /api/wallet/spend - Spend from wallet
router.post('/spend', async (req, res) => {
  try {
    const userId = req.user.id;
    let { amountPence, description, referenceType, referenceId } = req.body;
    if (req.body.amount && !amountPence) {
      amountPence = Math.round(req.body.amount * 100);
    }
    if (!amountPence || amountPence <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (wallet.rows.length === 0 || wallet.rows[0].balance_pence < amountPence) {
      return res.status(400).json({
        error: 'Insufficient wallet balance',
        balance: wallet.rows.length > 0 ? wallet.rows[0].balance_pence / 100 : 0,
        required: amountPence / 100,
      });
    }

    const newBalance = wallet.rows[0].balance_pence - amountPence;
    await pool.query(`
      UPDATE wallets SET balance_pence = $1, total_spent_pence = total_spent_pence + $2, updated_at = NOW()
      WHERE user_id = $3
    `, [newBalance, amountPence, userId]);

    await pool.query(`
      INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
      VALUES ($1, $2, 'payment', $3, $4, $5, $6, NOW())
    `, [
      wallet.rows[0].id, userId, -amountPence, newBalance,
      description || `Payment of £${(amountPence/100).toFixed(2)}`,
      referenceType || 'booking',
    ]);

    res.json({ success: true, spent: amountPence / 100, newBalance: newBalance / 100, currency: 'GBP' });
  } catch (err) {
    console.error('Wallet spend error:', err);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// POST /api/wallet/reward - Add reward credits
router.post('/reward', async (req, res) => {
  try {
    const userId = req.user.id;
    let { amountPence, reason, referenceType } = req.body;
    if (req.body.amount && !amountPence) {
      amountPence = Math.round(req.body.amount * 100);
    }
    if (!amountPence || amountPence <= 0 || amountPence > 5000) {
      return res.status(400).json({ error: 'Reward must be between 1p and £50' });
    }

    let wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (wallet.rows.length === 0) {
      wallet = await pool.query(`
        INSERT INTO wallets (user_id, balance_pence, total_loaded_pence, total_spent_pence, currency, is_active, created_at, updated_at)
        VALUES ($1, 0, 0, 0, 'GBP', true, NOW(), NOW())
        RETURNING *
      `, [userId]);
    }
    const newBalance = wallet.rows[0].balance_pence + amountPence;

    await pool.query(`
      UPDATE wallets SET balance_pence = $1, total_loaded_pence = total_loaded_pence + $2, updated_at = NOW()
      WHERE user_id = $3
    `, [newBalance, amountPence, userId]);

    await pool.query(`
      INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
      VALUES ($1, $2, 'reward', $3, $4, $5, $6, NOW())
    `, [
      wallet.rows[0].id, userId, amountPence, newBalance,
      reason || `Reward £${(amountPence/100).toFixed(2)}`,
      referenceType || 'reward',
    ]);

    res.json({ success: true, rewarded: amountPence / 100, newBalance: newBalance / 100 });
  } catch (err) {
    console.error('Wallet reward error:', err);
    res.status(500).json({ error: 'Failed to add reward' });
  }
});

// GET /api/wallet/transactions - Transaction history
router.get('/transactions', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const wallet = await pool.query('SELECT id FROM wallets WHERE user_id = $1', [userId]);
    if (wallet.rows.length === 0) {
      return res.json({ transactions: [], total: 0 });
    }

    let query = `
      SELECT type, amount_pence, balance_after_pence, description, reference_type, created_at
      FROM wallet_transactions WHERE wallet_id = $1
    `;
    const params = [wallet.rows[0].id];
    if (type) {
      query += ` AND type = $${params.length + 1}`;
      params.push(type);
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM wallet_transactions WHERE wallet_id = $1', [wallet.rows[0].id]
    );

    res.json({
      transactions: result.rows.map(t => ({
        ...t, amount: t.amount_pence / 100, balanceAfter: t.balance_after_pence / 100,
      })),
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit)),
    });
  } catch (err) {
    console.error('Wallet transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ── Helpers for payout methods (mirrors gym-partner.js maskAccount) ──
function _maskPayoutDetails(details) {
  const d = details || {};
  if (d.accountNumber) return { type: 'bank', accountName: d.accountName || '', last4: String(d.accountNumber).slice(-4) };
  if (d.iban) return { type: 'bank_international', accountName: d.accountName || '', last4: String(d.iban).slice(-4), swift: d.swift || '' };
  if (d.paypalEmail) {
    const [u, dom] = String(d.paypalEmail).split('@');
    return { type: 'paypal', email: (u || '').slice(0, 2) + '\u2022\u2022\u2022@' + (dom || '') };
  }
  return { type: 'other' };
}

// Resolve the user's Stripe Connect account id. Partners store it on
// users.stripe_connect_id; ScanSquad creators may only have it on
// creator_landing_pages (referrals onboarding). Self-heals users row.
async function _resolveStripeConnectId(userId, creatorHandle) {
  const u = await pool.query('SELECT stripe_connect_id FROM users WHERE id = $1', [userId]).catch(() => ({ rows: [] }));
  let connectId = u.rows[0]?.stripe_connect_id || null;
  if (!connectId && creatorHandle) {
    const c = await pool.query(
      'SELECT stripe_connect_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1', [String(creatorHandle)]
    ).catch(() => ({ rows: [] }));
    connectId = c.rows[0]?.stripe_connect_id || null;
    if (connectId) {
      await pool.query('UPDATE users SET stripe_connect_id = $1 WHERE id = $2', [connectId, userId]).catch(() => {});
    }
  }
  return connectId;
}

// GET /api/wallet/withdraw-method - which payout rail a withdrawal would use
router.get('/withdraw-method', async (req, res) => {
  try {
    const userId = req.user.id;
    const creatorHandle = req.query.creatorHandle || null;
    const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

    const connectId = await _resolveStripeConnectId(userId, creatorHandle);
    let stripeReady = false;
    if (connectId && stripe) {
      try {
        const acct = await stripe.accounts.retrieve(connectId);
        stripeReady = !!acct.payouts_enabled;
      } catch (e) { /* treat as not ready */ }
    }

    const m = await pool.query('SELECT method, details FROM payout_methods WHERE user_id = $1', [String(userId)]).catch(() => ({ rows: [] }));
    const saved = m.rows[0] || null;

    res.json({
      stripeConnect: !!connectId,
      stripeReady,
      saved: saved ? saved.method : null,
      summary: saved ? _maskPayoutDetails(saved.details) : null,
      hasMethod: stripeReady || !!saved,
    });
  } catch (err) {
    console.error('Wallet withdraw-method error:', err);
    res.status(500).json({ error: 'Failed to load withdraw method' });
  }
});

// POST /api/wallet/withdraw - Withdraw ScanGym wallet balance
// Primary rail: Stripe Connect transfer (money moves BEFORE the wallet is
// deducted). Fallback: saved bank/PayPal method -> queued payout_request.
router.post('/withdraw', async (req, res) => {
  try {
    const userId = req.user.id;
    let { amountPence } = req.body;

    // Support amount in pounds
    if (req.body.amount && !amountPence) {
      amountPence = Math.round(req.body.amount * 100);
    }
    amountPence = parseInt(amountPence, 10);

    // Validation
    if (!amountPence || amountPence < 100) {
      return res.status(400).json({ error: 'Minimum withdrawal is \u00a31.00' });
    }
    if (amountPence > 100000) {
      return res.status(400).json({ error: 'Maximum withdrawal is \u00a31,000.00 per request' });
    }

    // Check wallet balance
    const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (wallet.rows.length === 0 || wallet.rows[0].balance_pence < amountPence) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    const w = wallet.rows[0];

    // Resolve payout rail
    const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
    const connectId = await _resolveStripeConnectId(userId, req.body.creatorHandle || null);
    const m = await pool.query('SELECT method, details FROM payout_methods WHERE user_id = $1', [String(userId)]).catch(() => ({ rows: [] }));
    const savedMethod = m.rows[0] || null;

    const amountDisp = '\u00a3' + (amountPence / 100).toFixed(2);
    let payoutMethod, payoutStatus, message;

    if (stripe && connectId) {
      // Verify the Connect account can actually receive payouts
      let acct = null;
      try { acct = await stripe.accounts.retrieve(connectId); } catch (e) { /* fallthrough */ }
      if (!acct || !acct.payouts_enabled) {
        return res.status(400).json({
          error: 'Your Stripe payout setup isn\u2019t finished yet \u2014 complete it to withdraw.',
          needsOnboarding: true,
        });
      }
      // Move the money FIRST; only deduct the wallet if the transfer succeeds
      try {
        await stripe.transfers.create({
          amount: amountPence,
          currency: 'gbp',
          destination: connectId,
          description: 'ScanGym wallet withdrawal',
          metadata: { scangym_user_id: String(userId), source: 'wallet' },
        });
      } catch (transferErr) {
        console.error('[WalletWithdraw] Stripe transfer failed:', transferErr.message);
        return res.status(502).json({ error: 'Transfer failed: ' + transferErr.message });
      }
      payoutMethod = 'stripe_connect';
      payoutStatus = 'paid';
      message = amountDisp + ' sent to your bank via Stripe \u2014 usually arrives within 1-2 business days.';
    } else if (savedMethod && ['bank', 'paypal'].includes(savedMethod.method)) {
      // Manual queue fallback (no Stripe Connect yet)
      payoutMethod = savedMethod.method;
      payoutStatus = 'pending';
      message = 'Withdrawal of ' + amountDisp + ' queued to your ' +
        (savedMethod.method === 'paypal' ? 'PayPal' : 'bank account') +
        ' \u2014 funds arrive in 2-5 business days.';
    } else {
      return res.status(400).json({ error: 'Add a withdraw method first', needsMethod: true });
    }

    // Deduct from wallet (only after the payout rail is secured)
    const newBalance = w.balance_pence - amountPence;
    await pool.query(`
      UPDATE wallets SET balance_pence = $1, total_spent_pence = total_spent_pence + $2, updated_at = NOW()
      WHERE user_id = $3
    `, [newBalance, amountPence, userId]);

    // Record transaction
    await pool.query(`
      INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
      VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6, NOW())
    `, [
      w.id, userId, -amountPence, newBalance,
      `Wallet withdrawal ${amountDisp} (${payoutMethod})`, payoutMethod,
    ]);

    // Audit row in the shared payout queue
    await pool.query(`
      INSERT INTO payout_requests (user_id, role, amount_pence, method, details, status, requested_at, processed_at)
      VALUES ($1, 'wallet', $2, $3, $4::jsonb, $5, NOW(), $6)
    `, [
      String(userId), amountPence, payoutMethod,
      JSON.stringify({ source: 'scangym_wallet' }), payoutStatus,
      payoutStatus === 'paid' ? new Date() : null,
    ]).catch((e) => console.warn('[WalletWithdraw] payout_requests insert skipped:', e.message));

    console.log(`[WalletWithdraw] User ${userId}: ${amountDisp} via ${payoutMethod} (${payoutStatus}). Balance after: \u00a3${(newBalance / 100).toFixed(2)}`);

    res.json({
      success: true,
      message,
      method: payoutMethod,
      status: payoutStatus,
      amountWithdrawn: amountPence / 100,
      newBalance: newBalance / 100,
      newBalancePence: newBalance,
      estimatedArrival: new Date(Date.now() + (payoutStatus === 'paid' ? 2 : 5) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
  } catch (err) {
    console.error('Wallet withdrawal error:', err);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

module.exports = router;
