/**
 * Chatbot Router — Mounts all channel adapters
 * 
 * Architecture:
 *   /api/chatbot/telegram/*   → Telegram bot
 *   /api/chatbot/twilio/*     → WhatsApp + SMS via Twilio
 *   /api/chatbot/test         → Test endpoint (for development)
 * 
 * Each adapter is a thin Express router that receives messages
 * in the channel's format and passes them to message-handler.js.
 * 
 * To add a new channel (e.g., Discord, Messenger):
 *   1. Create server/chatbot/discord.js with an Express router
 *   2. Import and mount it here
 *   3. Set webhook URL in the platform's settings
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

// ─── Channel Adapters ───────────────────────────────────────

// Telegram (free, no cost per message)
const telegramRouter = require('./telegram');
router.use('/telegram', telegramRouter);

// Twilio: WhatsApp + SMS (uses existing Twilio account)
const twilioRouter = require('./twilio');
router.use('/twilio', twilioRouter);

// ─── Test Endpoint (for development) ────────────────────────
// POST /api/chatbot/test { "message": "Find gyms in Bolton", "userId": "test123" }
router.post('/test', async (req, res) => {
  const { message, userId } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const response = await handleMessage(userId || 'test:user', message, {
    userName: 'Test User',
    platform: 'test',
  });

  res.json(response);
});

// ─── Health check ────────────────────────────────────────────
router.get('/health', (req, res) => {
  const channels = {
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    whatsapp: !!process.env.TWILIO_ACCOUNT_SID,
    sms: !!process.env.TWILIO_ACCOUNT_SID,
  };

  res.json({
    status: 'ok',
    channels,
    activeChannels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k),
  });
});

module.exports = router;
