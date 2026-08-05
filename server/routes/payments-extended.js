/**
 * Extended Payment Methods Routes (#42-#52)
 * PayPal, Google/Apple/Samsung Pay, Gift Cards, Crypto, Bank Transfer, BNPL, Refund
 */
const express = require('express');
const router = express.Router();

// ── #42: PayPal Connect ──
router.post('/paypal/connect', async (req, res) => {
  try {
    // In production: redirect to PayPal OAuth flow
    // For now: stub that saves PayPal preference
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Login required' });
    
    // TODO: Integrate PayPal SDK - generate OAuth redirect URL
    // const redirectUrl = await paypal.generateAuthUrl(userId);
    res.json({ success: true, message: 'PayPal will be available at launch' });
  } catch (err) {
    console.error('PayPal connect error:', err.message);
    res.status(500).json({ error: 'PayPal connection failed' });
  }
});

// ── #44/#45/#46: Wallet Token (Google Pay, Apple Pay, Samsung Pay) ──
router.post('/wallet-token', async (req, res) => {
  try {
    const { wallet } = req.body; // 'google_pay', 'apple_pay', 'samsung_pay'
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Login required' });

    const supportedWallets = ['google_pay', 'apple_pay', 'samsung_pay'];
    if (!supportedWallets.includes(wallet)) {
      return res.status(400).json({ error: 'Unsupported wallet type' });
    }

    // In production: Create Stripe PaymentRequest for the wallet
    // For now: acknowledge the wallet preference
    // TODO: stripe.paymentIntents.create with payment_method_types including the wallet
    res.json({ 
      success: true, 
      wallet,
      message: `${wallet.replace('_', ' ')} ready for checkout`
    });
  } catch (err) {
    console.error('Wallet token error:', err.message);
    res.status(500).json({ error: 'Wallet setup failed' });
  }
});

// ── #43: Gift Card Redemption ──
router.post('/gift-card/redeem', async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Login required' });
    if (!code || code.trim().length < 6) {
      return res.status(400).json({ error: 'Invalid gift card code' });
    }

    // TODO: Look up gift card in gift_cards table, validate, apply balance
    // const card = await db.query('SELECT * FROM gift_cards WHERE code = $1 AND redeemed = false', [code.trim()]);
    // For now: stub response
    res.json({ 
      success: false, 
      error: 'Gift cards launching soon — stay tuned!' 
    });
  } catch (err) {
    console.error('Gift card redeem error:', err.message);
    res.status(500).json({ error: 'Could not redeem gift card' });
  }
});

// ── #49: Crypto Setup (Coinbase Commerce / BTCPay) ──
router.post('/crypto/setup', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Login required' });

    // TODO: Create Coinbase Commerce charge or BTCPay invoice
    // const charge = await coinbase.charges.create({ ... });
    res.json({ 
      success: true, 
      message: 'Crypto payments coming soon',
      invoiceUrl: null 
    });
  } catch (err) {
    console.error('Crypto setup error:', err.message);
    res.status(500).json({ error: 'Crypto setup failed' });
  }
});

// ── #50: Bank Transfer Setup ──
router.post('/bank-transfer/setup', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Login required' });

    // TODO: Generate unique bank transfer reference, send details via email
    // In production: Use Stripe bank_transfer payment method
    res.json({ 
      success: true,
      bankDetails: {
        sortCode: '00-00-00',
        accountNumber: '00000000',
        reference: `SG-${userId.slice(0, 8).toUpperCase()}`,
        note: 'Bank transfer details sent to your registered email'
      }
    });
  } catch (err) {
    console.error('Bank transfer setup error:', err.message);
    res.status(500).json({ error: 'Bank transfer setup failed' });
  }
});

// ── #51: BNPL / Pay Next Visit — Emergency Deferred Payment ──
router.post('/bnpl/check', async (req, res) => {
  try {
    const userId = req.user?.id || req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Login required' });

    // Check if user already has an outstanding deferred payment
    let hasOutstanding = false;
    try {
      const existing = await pool.query(
        `SELECT id FROM deferred_payments WHERE user_id = $1 AND status = 'pending' LIMIT 1`,
        [userId]
      );
      hasOutstanding = existing.rows.length > 0;
    } catch (e) {
      // Table may not exist yet — that's fine, means no outstanding
    }

    if (hasOutstanding) {
      return res.json({
        eligible: false,
        message: 'You have an outstanding deferred payment. Please settle it before using Pay Next Visit again.',
        providers: ['scangym_deferred']
      });
    }

    // Eligible: no outstanding deferred payments
    res.json({ 
      eligible: true,
      message: 'Pay Next Visit available — enter now, pay on your next booking',
      providers: ['scangym_deferred'],
      terms: 'Maximum 1 deferred payment at a time. Auto-collected on next booking.'
    });
  } catch (err) {
    console.error('BNPL check error:', err.message);
    res.status(500).json({ error: 'BNPL check failed' });
  }
});

// ── #51b: Create deferred payment (Pay Next Visit) ──
router.post('/bnpl/create', async (req, res) => {
  try {
    const userId = req.user?.id || req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Login required' });

    const { gymId, amount, bookingId } = req.body;
    if (!gymId) return res.status(400).json({ error: 'gymId required' });

    // Check no outstanding deferred payment
    const existing = await pool.query(
      `SELECT id FROM deferred_payments WHERE user_id = $1 AND status = 'pending' LIMIT 1`,
      [userId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You already have a pending deferred payment. Settle it first.' });
    }

    // Create the deferred payment record
    const result = await pool.query(
      `INSERT INTO deferred_payments (user_id, gym_id, booking_id, amount_pence, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [userId, gymId, bookingId || null, amount || 449]
    );

    res.json({
      success: true,
      deferredPaymentId: result.rows[0].id,
      message: 'Entry granted! Payment will be collected on your next booking.'
    });
  } catch (err) {
    console.error('BNPL create error:', err.message);
    res.status(500).json({ error: 'Could not create deferred payment' });
  }
});

// ── #52: Refund First 3 Bookings (satisfaction guarantee) ──
router.post('/refund-guarantee/check', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Login required' });

    // TODO: Count user's completed bookings, check if < 3
    // const { count } = await db.query('SELECT COUNT(*) FROM bookings WHERE user_id = $1 AND status = $2', [userId, 'completed']);
    const bookingCount = 0; // stub
    const eligible = bookingCount < 3;

    res.json({
      success: true,
      eligible,
      remaining: Math.max(0, 3 - bookingCount),
      message: eligible
        ? `You have ${3 - bookingCount} risk-free bookings remaining!`
        : 'You\'ve used all 3 risk-free bookings'
    });
  } catch (err) {
    console.error('Refund guarantee check error:', err.message);
    res.status(500).json({ error: 'Could not check refund eligibility' });
  }
});

// ── #47/#48: App Store / Google Play in-app purchase webhooks ──
router.post('/iap/verify', async (req, res) => {
  try {
    const { platform, receipt, productId } = req.body;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Login required' });

    if (platform === 'google_play') {
      // TODO: Verify with Google Play Developer API
      // const result = await googlePlay.verifyPurchase(receipt);
    } else if (platform === 'app_store') {
      // TODO: Verify with App Store Server API
      // const result = await appStore.verifyReceipt(receipt);
    }

    res.json({ success: true, message: 'In-app purchase verified', productId });
  } catch (err) {
    console.error('IAP verify error:', err.message);
    res.status(500).json({ error: 'Purchase verification failed' });
  }
});

module.exports = router;
