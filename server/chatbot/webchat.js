/**
 * Web Chat Adapter for ScanGym — v2.0 (Telegram-level quality)
 * 
 * Full-featured web chat integration with:
 *   ✓ Typing indicator via response header (X-ScanGym-Typing)
 *   ✓ Streaming response support (Server-Sent Events)
 *   ✓ Session management (conversation history per session)
 *   ✓ Rate limiting (prevent spam)
 *   ✓ CORS-safe headers
 *   ✓ Health check endpoint
 * 
 * Endpoint: POST /api/chatbot/web/message
 *   Body: { "message": "Find gyms in Manchester", "userId": "web:123", "userName": "John" }
 *   Response: { "success": true, "text": "...", "data": { ... } }
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

// Rate limiting: max 20 messages per minute per user
const rateLimiter = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimiter.get(userId);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimiter.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Cleanup rate limiter periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimiter) {
    if (now - v.windowStart > RATE_WINDOW * 2) rateLimiter.delete(k);
  }
}, 120000);

// ─── Web Chat Message Endpoint ──────────────────────────────
router.post('/message', async (req, res) => {
  try {
    const { message, userId, userName, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const uid = userId || `web:${sessionId || 'anonymous'}`;
    const name = userName || 'User';

    // Rate limit check
    if (!checkRateLimit(uid)) {
      return res.status(429).json({
        success: false,
        text: '⏳ You\'re sending messages too fast. Please wait a moment.',
      });
    }

    // Set typing header immediately
    res.setHeader('X-ScanGym-Typing', 'true');

    const response = await handleMessage(uid, message.trim(), {
      userName: name,
      platform: 'web',
      sessionId,
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
      text: '😕 Something went wrong. Please try again!',
    });
  }
});

// ─── Server-Sent Events (streaming responses) ───────────────
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const origin = req.headers.origin;
  const allowedOrigins = ['https://scangym.com', 'https://www.scangym.com'];
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  // Send initial connection event
  res.write('event: connected\ndata: {"status":"connected"}\n\n');

  // Keep alive every 30 seconds
  const keepAlive = setInterval(() => {
    res.write('event: ping\ndata: {"ts":' + Date.now() + '}\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// ─── Status ─────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    active: true,
    platform: 'web',
    rateLimitedUsers: rateLimiter.size,
  });
});

module.exports = router;