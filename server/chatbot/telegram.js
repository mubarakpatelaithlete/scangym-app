/**
 * Telegram Bot Adapter for ScanGym
 * 
 * Thin wrapper that receives Telegram messages via webhook,
 * passes them to the universal message-handler, and sends back replies.
 * 
 * Setup:
 *   1. Create bot with @BotFather on Telegram → get TELEGRAM_BOT_TOKEN
 *   2. Set env: TELEGRAM_BOT_TOKEN=xxx
 *   3. Set webhook: POST https://api.telegram.org/bot{TOKEN}/setWebhook
 *      Body: { "url": "https://scangym.com/api/chatbot/telegram/webhook" }
 * 
 * That's it. Users message @ScanGymBot and can search/book gyms.
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ─── Webhook endpoint (Telegram sends updates here) ─────────
router.post('/webhook', async (req, res) => {
  // Always respond 200 quickly (Telegram retries on failures)
  res.sendStatus(200);

  try {
    const update = req.body;

    // Handle text messages only (skip edits, channels, etc.)
    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const userId = `telegram:${msg.from.id}`;
    const text = msg.text.trim();
    const userName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Telegram User';

    // Handle /start with deep link token (Layer 2 channel connect)
    let input = text;
    if (text === '/start') {
      input = 'help';
    } else if (text.startsWith('/start ')) {
      const token = text.split('/start ')[1].trim();
      if (token && token.length >= 16) {
        // This is a channel connect deep link — verify the token
        try {
          const verifyResp = await fetch((process.env.BASE_URL || 'https://scangym.com') + '/api/channels/telegram/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              telegramUserId: msg.from.id,
              telegramUsername: msg.from.username || null,
              telegramName: userName,
            }),
          });
          const verifyData = await verifyResp.json();
          if (verifyData.success) {
            await sendTelegramMessage(chatId, '✅ *Connected!*\n\nYour ScanGym account is now linked to Telegram.\n\nTry: "Find gyms near Manchester"');
            return;
          }
        } catch (e) {
          console.error('[Telegram] Deep link verify error:', e.message);
        }
        input = 'help';
      } else {
        input = 'help';
      }
    }

    // Send "typing..." indicator
    sendAction(chatId, 'typing');

    // Process message through universal handler
    const response = await handleMessage(userId, input, {
      userName,
      platform: 'telegram',
      chatId,
    });

    // Send response back to Telegram
    await sendTelegramMessage(chatId, response.text);

  } catch (err) {
    console.error('[Telegram] Webhook error:', err);
  }
});

// ─── Set up webhook (call once on deploy) ────────────────────
router.post('/setup', async (req, res) => {
  const { webhookUrl } = req.body;
  if (!webhookUrl) {
    return res.status(400).json({ error: 'webhookUrl required' });
  }

  try {
    const resp = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'],
        drop_pending_updates: true,
      }),
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get webhook info ────────────────────────────────────────
router.get('/webhook-info', async (req, res) => {
  try {
    const resp = await fetch(`${TELEGRAM_API}/getWebhookInfo`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Telegram API helpers ────────────────────────────────────

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_TOKEN) {
    console.error('[Telegram] No TELEGRAM_BOT_TOKEN set');
    return;
  }

  // Telegram has a 4096 char limit — split if needed
  const chunks = splitMessage(text, 4000);

  for (const chunk of chunks) {
    try {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      console.error('[Telegram] Send error:', err.message);
    }
  }
}

async function sendAction(chatId, action) {
  if (!TELEGRAM_TOKEN) return;
  try {
    await fetch(`${TELEGRAM_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (e) {}
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline before limit
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen; // If no good newline, hard split
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trim();
  }
  return chunks;
}

module.exports = router;
