async function resolveReferralUserId(handle) {
  if (!handle) return null;
  try {
    const lp = await pool.query(
      'SELECT creator_user_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1',
      [handle]
    );
    if (lp.rows.length > 0 && lp.rows[0].creator_user_id) return lp.rows[0].creator_user_id;
  } catch (e) { /* fall through to users lookup */ }
  try {
    const u = await pool.query(
      'SELECT id FROM public.users WHERE LOWER(referral_handle) = LOWER($1) LIMIT 1',
      [handle]
    );
    if (u.rows.length > 0 && u.rows[0].id) return u.rows[0].id;
  } catch (e) { /* fall through to email lookup */ }
  // Fallback 3: email match via creator_referrals — handles stored in localStorage
  // that were never synced via /api/creators/sync-handle still have their email
  // recorded in creator_referrals when the referral was tracked.
  try {
    const emailMatch = await pool.query(
      `SELECT u.id FROM public.users u
       INNER JOIN creator_referrals cr ON LOWER(cr.creator_email) = LOWER(u.email)
       WHERE LOWER(cr.creator_handle) = LOWER($1) LIMIT 1`,
      [handle]
    );
    if (emailMatch.rows.length > 0 && emailMatch.rows[0].id) return emailMatch.rows[0].id;
  } catch (e) { /* no match */ }
  return null;
}

module.exports = router;
