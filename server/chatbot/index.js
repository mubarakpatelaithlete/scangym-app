/**
 * Chatbot Router — Mounts all channel adapters
 * 
 * Architecture:
 *   /api/chatbot/telegram/*   → Telegram bot
 *   /api/chatbot/twilio/*     → WhatsApp + SMS via Twilio
 *   /api/chatbot/discord/*    → Discord bot (WebSocket + status routes)
 *   /api/chatbot/email/*      → Email booking via SendGrid
 *   /api/chatbot/test         → Test endpoint (for development)
 * 
 * Each adapter is a thin Express router that receives messages
 * in the channel's format and passes them to message-handler.js.
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

// Discord (free, connects via WebSocket Gateway)
const { router: discordRouter, startDiscordBot } = require('./discord');
router.use('/discord', discordRouter);

// Email booking (inbound via SendGrid Parse, replies via SMTP)
const emailRouter = require('./email');
router.use('/email', emailRouter);

// ─── Start Discord Bot (connects on server boot) ────────────
// Call this after Express is listening
startDiscordBot();

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
    discord: !!process.env.DISCORD_BOT_TOKEN,
    email: !!process.env.SENDGRID_API_KEY,
  };

  res.json({
    status: 'ok',
    channels,
    activeChannels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k),
  });
});

module.exports = router;
