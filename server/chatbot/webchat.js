/**
 * Web Chat Adapter for ScanGym
 * 
 * REST endpoint for the in-app Chat tab and any web-based chat widget.
 * Uses the same universal message-handler as Telegram/Discord/Slack/Teams.
 * 
 * This ensures the Chat tab in the ScanGym app works EXACTLY like
 * all other channels — same AI, same responses, same booking flow.
 * 
 * Endpoint: POST /api/chatbot/web/message
 *   Body: { "message": "Find gyms in Manchester", "userId": "web:123", "userName": "John" }
 *   Response: { "success": true, "text": "...", "data": { ... } }
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

// ─── Web Chat Message Endpoint ──────────────────────────────
router.post('/message', async (req, res) => {
  try {
    const { message, userId, userName, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    // Use session-based userId or fall back to generic
    const uid = userId || `web:${sessionId || 'anonymous'}`;
    const name = userName || 'User';

    const response = await handleMessage(uid, message.trim(), {
      userName: name,
      platform: 'web',
    });

    res.json({
      success: true,
      text: response.text,
      data: response.data || null,
    });
  } catch (err) {
    console.error('[WebChat] Error:', err);
    res.status(500).json({
      success: false,
      text: "😕 Something went wrong. Please try again!",
    });
  }
});

// ─── Status ─────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ active: true, platform: 'web' });
});

module.exports = router;
