/**
 * #175: Communications Log — View sent emails/SMS/WhatsApp messages
 * 
 * Provides a GET endpoint for the dashboard to see communication history.
 * Messages are logged to the comms_log table (created on first use).
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');

// Ensure table exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comms_log (
        id SERIAL PRIMARY KEY,
        channel VARCHAR(20) NOT NULL DEFAULT 'email',
        direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
        from_addr VARCHAR(255),
        to_addr VARCHAR(255),
        subject VARCHAR(500),
        body TEXT,
        status VARCHAR(20) DEFAULT 'sent',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_comms_log_created ON comms_log(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_comms_log_channel ON comms_log(channel)`);
  } catch (e) {
    console.warn('[comms-log] Table init:', e.message);
  }
})();

// Helper to log a message (called from email/twilio handlers)
async function logComms({ channel, direction, from, to, subject, body, status, metadata }) {
  try {
    await pool.query(
      `INSERT INTO comms_log (channel, direction, from_addr, to_addr, subject, body, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [channel || 'email', direction || 'outbound', from || '', to || '', subject || '', (body || '').substring(0, 5000), status || 'sent', JSON.stringify(metadata || {})]
    );
  } catch (e) {
    console.warn('[comms-log] Failed to log:', e.message);
  }
}

// GET /api/comms-log — Dashboard view of sent/received messages
router.get('/', async (req, res) => {
  try {
    const { channel, direction, limit = 50, offset = 0 } = req.query;
    let where = [];
    let params = [];
    let idx = 1;

    if (channel) { where.push(`channel = $${idx++}`); params.push(channel); }
    if (direction) { where.push(`direction = $${idx++}`); params.push(direction); }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    
    const result = await pool.query(
      `SELECT id, channel, direction, from_addr, to_addr, subject, 
              LEFT(body, 200) as body_preview, status, metadata, created_at
       FROM comms_log ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM comms_log ${whereClause}`,
      params
    );

    res.json({
      success: true,
      messages: result.rows,
      total: parseInt(countResult.rows[0].total),
      channels: { email: 'SendGrid', sms: 'Twilio SMS', whatsapp: 'Twilio WhatsApp' }
    });
  } catch (e) {
    console.error('[comms-log] GET error:', e);
    res.json({ success: true, messages: [], total: 0, error: e.message });
  }
});

// GET /api/comms-log/:id — Full message detail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM comms_log WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, message: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.logComms = logComms;
