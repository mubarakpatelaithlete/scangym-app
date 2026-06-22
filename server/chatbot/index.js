/**
 * Chatbot Router — Mounts all channel adapters
 * 
 * Architecture:
 *   /api/chatbot/telegram/*   → Telegram bot
 *   /api/chatbot/twilio/*     → WhatsApp + SMS via Twilio
 *   /api/chatbot/discord/*    → Discord bot (WebSocket + status routes)
 *   /api/chatbot/email/*      → Email booking via SendGrid
 *   /api/chatbot/slack/*      → Slack bot (Events API + slash commands)
 *   /api/chatbot/msteams/*    → Microsoft Teams bot (Bot Framework)
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

// Slack (Events API + slash commands)
const slackRouter = require('./slack');
router.use('/slack', slackRouter);

// Microsoft Teams (Bot Framework)
const msteamsRouter = require('./msteams');
router.use('/msteams', msteamsRouter);

// Web Chat (REST API — same handler as all channels)
const webchatRouter = require('./webchat');
router.use('/web', webchatRouter);

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
    slack: !!process.env.SLACK_BOT_TOKEN,
    msteams: !!process.env.TEAMS_APP_ID,
    web: true, // Always available
  };

  const aiProviders = {
    groq: !!process.env.GROQ_API_KEY,
    gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY),
    cloudflare: !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN),
    huggingface: !!(process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY),
    fallback: true, // Pattern-matching always available
  };

  res.json({
    status: 'ok',
    channels,
    activeChannels: Object.entries(channels).filter(([, v]) => v).map(([k]) => k),
    aiProviders,
    activeAI: Object.entries(aiProviders).filter(([, v]) => v).map(([k]) => k),
  });
});

module.exports = router;

// ─── Debug: test Gemini API directly ────────────────────────
router.get('/debug-gemini', async (req, res) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  const status = {
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasGoogleMapsKey: !!process.env.GOOGLE_MAPS_API_KEY,
    resolvedKeyPrefix: GEMINI_API_KEY ? GEMINI_API_KEY.substring(0, 8) + '...' : 'NONE',
  };

  if (!GEMINI_API_KEY) {
    return res.json({ ...status, geminiWorking: false, error: 'No API key found' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say "hello" in one word' }] }],
        generationConfig: { maxOutputTokens: 20 },
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return res.json({ ...status, geminiWorking: false, httpStatus: resp.status, error: data });
    }
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return res.json({ ...status, geminiWorking: true, testReply: reply });
  } catch (e) {
    return res.json({ ...status, geminiWorking: false, error: e.message });
  }
});
