/**
 * Wallet credit helpers — shared by payment.js, referrals.js and wallet.js.
 *
 * Root cause of "Earned £X but wallet shows £0":
 * Commission is recorded in creator_referrals under a creator_handle (e.g.
 * "mubarakibrahimpatel") but the handle→user mapping may be missing from
 * both users.referral_handle and creator_landing_pages.slug. When neither
 * source resolves the handle, the wallet never gets credited.
 *
 * Fix: reconcileCommissionBackpay() now uses THREE sources of truth:
 * 1. creator_referrals — the detailed ledger (handle-based lookup)
 *    Handles are discovered from users.referral_handle,
 *    creator_landing_pages.slug, AND creator_referrals.creator_email
 *    (matched against the user's email).
 * 2. creator_memberships.total_earnings_pence — the summary (user_id lookup)
 * 3. Direct email match on creator_referrals.creator_email
 * It takes the HIGHER of all sources and credits the difference to the wallet.
 *
 * creditWallet() remains a constraint-free upsert (UPDATE first, INSERT if
 * no row), safe regardless of whether wallets.user_id has a UNIQUE constraint.
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
 * Back-pay affiliate commissions that were recorded but never reached the
 * wallet. Uses TWO sources of earned commission:
 *   A) creator_referrals (handle-based ledger)
 *   B) creator_memberships.total_earnings_pence (direct user_id lookup)
 * Takes the higher of the two, compares against wallet_transactions with
 * reference_type='commission', and credits the shortfall.
 *
 * Safe to call on every wallet load: advisory xact lock prevents
 * double-credit under concurrent requests.
 *
 * @param {object} pool - pg Pool (needs .connect())
 * @returns {number} pence credited (0 when already in sync)
 */
async function reconcileCommissionBackpay(pool, userId) {
  if (!userId) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Per-user lock so two simultaneous wallet loads can't both back-pay
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['wallet_backpay:' + String(userId)]);

    // ── Source A: creator_referrals (handle-based) ──
    // Discover ALL handles that belong to this user from multiple sources
    let earnedFromReferrals = 0;
    try {
      const handles = [];

      // A1: users.referral_handle
      try {
        const u = await client.query('SELECT referral_handle, email FROM public.users WHERE id = $1', [userId]);
        if (u.rows[0]?.referral_handle) handles.push(u.rows[0].referral_handle);
        // A2: Find handles in creator_referrals where creator_email matches user's email
        if (u.rows[0]?.email) {
          try {
            const emailHandles = await client.query(
              `SELECT DISTINCT creator_handle FROM creator_referrals
               WHERE LOWER(creator_email) = LOWER($1) AND creator_handle IS NOT NULL`,
              [u.rows[0].email]
            );
            emailHandles.rows.forEach((r) => {
              if (r.creator_handle && !handles.includes(r.creator_handle)) handles.push(r.creator_handle);
            });
          } catch (e) { /* creator_email column may not exist */ }
        }
      } catch (e) { /* ignore */ }

      // A3: creator_landing_pages slugs
      for (const col of ['creator_user_id', 'user_id']) {
        try {
          const lp = await client.query(`SELECT slug FROM creator_landing_pages WHERE ${col} = $1`, [userId]);
          lp.rows.forEach((r) => { if (r.slug && !handles.includes(r.slug)) handles.push(r.slug); });
        } catch (e) { /* column may not exist */ }
      }

      // A4: creator_landing_pages.creator_handle (may store instagram handle)
      try {
        const lpHandles = await client.query(
          `SELECT DISTINCT creator_handle FROM creator_landing_pages
           WHERE creator_user_id::text = $1::text AND creator_handle IS NOT NULL`,
          [userId]
        );
        lpHandles.rows.forEach((r) => {
          if (r.creator_handle && !handles.includes(r.creator_handle)) handles.push(r.creator_handle);
        });
      } catch (e) { /* ignore */ }

      if (handles.length > 0) {
        const earned = await client.query(
          `SELECT COALESCE(SUM(commission_pence), 0) AS pence
           FROM creator_referrals
           WHERE status = 'converted' AND LOWER(creator_handle) = ANY($1)`,
          [handles.map((h) => String(h).toLowerCase())]
        );
        earnedFromReferrals = parseInt(earned.rows[0].pence, 10) || 0;
      }
      console.log(`[WalletBackpay] Source A handles for user ${userId}: [${handles.join(', ')}] → ${earnedFromReferrals}p`);
    } catch (e) {
      console.warn('[WalletBackpay] Source A (creator_referrals) failed:', e.message);
    }

    // ── Source B: creator_memberships.total_earnings_pence (user_id direct) ──
    let earnedFromMemberships = 0;
    try {
      const cm = await client.query(
        `SELECT COALESCE(total_earnings_pence, 0) AS pence
         FROM creator_memberships
         WHERE user_id::text = $1::text`,
        [userId]
      );
      if (cm.rows.length > 0) {
        earnedFromMemberships = parseInt(cm.rows[0].pence, 10) || 0;
      }
    } catch (e) {
      console.warn('[WalletBackpay] Source B (creator_memberships) failed:', e.message);
    }

    // Take the HIGHER of the two sources (covers cases where one source
    // recorded the commission but the other didn't)
    const totalEarned = Math.max(earnedFromReferrals, earnedFromMemberships);
    if (totalEarned === 0) {
      await client.query('COMMIT');
      return 0;
    }

    // ── Already credited to wallet ──
    const credited = await client.query(
      `SELECT COALESCE(SUM(amount_pence), 0) AS pence
       FROM wallet_transactions
       WHERE user_id = $1 AND reference_type = 'commission'`,
      [userId]
    );
    const alreadyCredited = parseInt(credited.rows[0].pence, 10) || 0;

    const shortfall = totalEarned - alreadyCredited;
    if (shortfall > 0) {
      await creditWallet(
        client, userId, shortfall,
        `🎉 Affiliate commission back-pay: £${(shortfall / 100).toFixed(2)} (earnings synced to your wallet)`,
        'commission'
      );
      console.log(`[WalletBackpay] Credited ${shortfall}p to user ${userId} (referrals: ${earnedFromReferrals}p, memberships: ${earnedFromMemberships}p, was credited: ${alreadyCredited}p)`);
    } else {
      console.log(`[WalletBackpay] User ${userId} in sync (earned: ${totalEarned}p, credited: ${alreadyCredited}p)`);
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
