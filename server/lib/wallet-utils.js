/**
 * Shared wallet utilities.
 * Consolidates the "get or create wallet" upsert pattern
 * repeated across wallet.js routes.
 */
const pool = require('../middleware/db');

/**
 * Get the wallet for a user, creating one if it doesn't exist.
 *
 * @param {string} userId - The user ID
 * @returns {Promise<object>} The wallet row (with balance_pence, total_loaded_pence, etc.)
 */
async function getOrCreateWallet(userId) {
  let wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
  if (wallet.rows.length === 0) {
    wallet = await pool.query(`
      INSERT INTO wallets (user_id, balance_pence, total_loaded_pence, total_spent_pence, currency, is_active, created_at, updated_at)
      VALUES ($1, 0, 0, 0, 'GBP', true, NOW(), NOW())
      RETURNING *
    `, [userId]);
  }
  return wallet.rows[0];
}

/**
 * Convert pence to pounds (with 2 decimal places).
 * @param {number} pence
 * @returns {number}
 */
function penceToPounds(pence) {
  return parseFloat((pence / 100).toFixed(2));
}

module.exports = { getOrCreateWallet, penceToPounds };
