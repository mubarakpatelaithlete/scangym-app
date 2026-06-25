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

// POST /api/wallet/withdraw - Request withdrawal to bank account
router.post('/withdraw', async (req, res) => {
  try {
    const userId = req.user.id;
    let { amountPence, bankDetails } = req.body;
    
    // Support amount in pounds
    if (req.body.amount && !amountPence) {
      amountPence = Math.round(req.body.amount * 100);
    }
    
    // Validation
    if (!amountPence || amountPence < 1000) {
      return res.status(400).json({ error: 'Minimum withdrawal is £10.00' });
    }
    if (amountPence > 100000) {
      return res.status(400).json({ error: 'Maximum withdrawal is £1,000.00 per request' });
    }
    
    // Check wallet balance
    const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (wallet.rows.length === 0 || wallet.rows[0].balance_pence < amountPence) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    const w = wallet.rows[0];
    const newBalance = w.balance_pence - amountPence;
    
    // Deduct from wallet
    await pool.query(`
      UPDATE wallets SET balance_pence = $1, total_spent_pence = total_spent_pence + $2, updated_at = NOW()
      WHERE user_id = $3
    `, [newBalance, amountPence, userId]);
    
    // Record transaction
    await pool.query(`
      INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
      VALUES ($1, $2, 'withdrawal', $3, $4, $5, 'bank_transfer', NOW())
    `, [
      w.id, userId, -amountPence, newBalance,
      `Withdrawal request £${(amountPence/100).toFixed(2)} to bank`
    ]);
    
    // TODO: Implement Stripe Connect payout or manual bank transfer
    // For now, log the request for manual processing
    console.log(`💳 Withdrawal request: User ${userId}, £${(amountPence/100).toFixed(2)}, Balance after: £${(newBalance/100).toFixed(2)}`);
    
    res.json({
      success: true,
      message: `Withdrawal of £${(amountPence/100).toFixed(2)} requested. Funds will arrive in 2-5 business days.`,
      amountWithdrawn: amountPence / 100,
      newBalance: newBalance / 100,
      estimatedArrival: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
  } catch (err) {
    console.error('Wallet withdrawal error:', err);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

module.exports = router;
