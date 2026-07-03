/**
 * Wallet credit helpers — shared by payment.js, referrals.js and wallet.js.
 *
 * Why this exists (bug: "Earned £1.25 as affiliate but wallet shows zero"):
 * 1. The old wallet auto-credit used `INSERT ... ON CONFLICT (user_id)` on
 *    the wallets table. If production `wallets.user_id` has no UNIQUE
 *    constraint, Postgres rejects the statement ("no unique or exclusion
 *    constraint matching the ON CONFLICT specification") and the error was
 *    swallowed by a non-blocking catch — so the ledger (creator_referrals)
 *    recorded the commission but the wallet was never credited.
 * 2. Conversions that happened BEFORE the users.referral_handle fallback
 *    shipped resolved no user at all — commission on paper, no wallet credit,
 *    and nothing ever back-paid the gap.
 *
 * creditWallet() is a constraint-free upsert (UPDATE first, INSERT if no
 * row), and reconcileCommissionBackpay() heals historical gaps by comparing
 * the commission ledger against wallet_transactions and crediting the
 * shortfall exactly once (advisory-locked).
 */

/**
 * Credit a user's wallet without relying on a UNIQUE constraint.
 * @param {object} db - pg Pool or Client
 * @returns {{walletId, balanceAfterPence}|null}
 */
async function creditWallet(db, userId, amountPence, description, referenceType) {
  if (!userId || !amountPence || amountPence <= 0) return null;

  // 1) UPDATE existing wallet row
  let row = await db.query(
    `UPDATE wallets
     SET balance_pence = balance_pence + $2,
         total_loaded_pence = total_loaded_pence + $2,
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING id, balance_pence`,
    [userId, amountPence]
  );

  // 2) No wallet yet — create one
  if (row.rows.length === 0) {
    try {
      row = await db.query(
        `INSERT INTO wallets (user_id, balance_pence, total_loaded_pence, total_spent_pence, currency, is_active, created_at, updated_at)
         VALUES ($1, $2, $2, 0, 'GBP', true, NOW(), NOW())
         RETURNING id, balance_pence`,
        [userId, amountPence]
      );
    } catch (e) {
      // Lost a create race — retry the UPDATE once
      row = await db.query(
        `UPDATE wallets
         SET balance_pence = balance_pence + $2,
             total_loaded_pence = total_loaded_pence + $2,
             updated_at = NOW()
         WHERE user_id = $1
         RETURNING id, balance_pence`,
        [userId, amountPence]
      );
    }
  }
  if (row.rows.length === 0) return null;

  await db.query(
    `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
     VALUES ($1, $2, 'reward', $3, $4, $5, $6, NOW())`,
    [row.rows[0].id, userId, amountPence, row.rows[0].balance_pence, description, referenceType || 'commission']
  );

  return { walletId: row.rows[0].id, balanceAfterPence: row.rows[0].balance_pence };
}

/**
 * Back-pay affiliate commissions that were recorded in creator_referrals but
 * never reached the wallet. Compares SUM(converted commissions) across all of
 * the user's handles vs SUM(wallet 'commission' transactions) and credits the
 * shortfall once. Safe to call on every wallet load: advisory xact lock
 * prevents double-credit under concurrent requests.
 * @param {object} pool - pg Pool (needs .connect())
 * @returns {number} pence credited (0 when already in sync)
 */
async function reconcileCommissionBackpay(pool, userId) {
  if (!userId) return 0;

  // Collect every handle that can earn for this user (two handle systems)
  const handles = [];
  try {
    const u = await pool.query('SELECT referral_handle FROM public.users WHERE id = $1', [userId]);
    if (u.rows[0]?.referral_handle) handles.push(u.rows[0].referral_handle);
  } catch (e) { /* ignore */ }
  for (const col of ['creator_user_id', 'user_id']) {
    try {
      const lp = await pool.query(`SELECT slug FROM creator_landing_pages WHERE ${col} = $1`, [userId]);
      lp.rows.forEach((r) => { if (r.slug && !handles.includes(r.slug)) handles.push(r.slug); });
    } catch (e) { /* column may not exist in this schema */ }
  }
  if (handles.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Per-user lock so two simultaneous wallet loads can't both back-pay
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['wallet_backpay:' + String(userId)]);

    const earned = await client.query(
      `SELECT COALESCE(SUM(commission_pence), 0) AS pence
       FROM creator_referrals
       WHERE status = 'converted' AND LOWER(creator_handle) = ANY($1)`,
      [handles.map((h) => String(h).toLowerCase())]
    );
    const credited = await client.query(
      `SELECT COALESCE(SUM(amount_pence), 0) AS pence
       FROM wallet_transactions
       WHERE user_id = $1 AND reference_type = 'commission'`,
      [userId]
    );

    const shortfall = parseInt(earned.rows[0].pence, 10) - parseInt(credited.rows[0].pence, 10);
    if (shortfall > 0) {
      await creditWallet(
        client, userId, shortfall,
        `🎉 Affiliate commission back-pay: £${(shortfall / 100).toFixed(2)} (earnings that hadn't reached your wallet)`,
        'commission'
      );
      console.log(`[WalletBackpay] Credited ${shortfall}p to user ${userId} (handles: ${handles.join(', ')})`);
    }
    await client.query('COMMIT');
    return Math.max(shortfall, 0);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[WalletBackpay] Reconciliation failed (non-blocking):', e.message);
    return 0;
  } finally {
    client.release();
  }
}

module.exports = { creditWallet, reconcileCommissionBackpay };
