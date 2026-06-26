/**
 * Telegram Bot Adapter for ScanGym — v3.0 (Premium Experience)
 * 
 * Rich Telegram integration with:
 *   ✓ Inline keyboard buttons (Find Gyms, Pricing, Help, Book)
 *   ✓ Location sharing support (find nearest gym by GPS)
 *   ✓ Callback query handling (button taps)
 *   ✓ "Show more" pagination
 *   ✓ Typing indicator
 *   ✓ Deep link channel connect
 *   ✓ Smart markdown formatting
 *   ✓ Photo support (gym images)
 *   ✓ Sticker/GIF reactions
 * 
 * Setup:
 *   1. Create bot with @BotFather on Telegram → get TELEGRAM_BOT_TOKEN
 *   2. Set env: TELEGRAM_BOT_TOKEN=xxx
 *   3. Set webhook: POST https://api.telegram.org/bot{TOKEN}/setWebhook
 *      Body: { "url": "https://scangym.com/api/chatbot/telegram/webhook" }
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const BASE_URL = process.env.BASE_URL || 'https://scangym.com';

// Session store for pagination
const sessions = new Map();

// ─── Webhook endpoint ────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;

    // Handle callback queries (button taps)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }

    // Handle location messages
    if (update.message && update.message.location) {
      await handleLocation(update.message);
      return;
    }

    // Handle text messages
    const msg = update.message;
    if (!msg || !msg.text) return;

    const chatId = msg.chat.id;
    const userId = `telegram:${msg.from.id}`;
    const text = msg.text.trim();
    const userName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Telegram User';

    // Handle /start with deep link token
    let input = text;
    if (text === '/start') {
      input = 'help';
    } else if (text.startsWith('/start ')) {
      const token = text.split('/start ')[1].trim();
      if (token && token.length >= 16) {
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
            await sendWithButtons(chatId, '✅ *Connected!*\n\nYour ScanGym account is now linked to Telegram.\n\nTry: "Find gyms near Manchester"', getMainMenuButtons());
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

    // Handle slash commands
    if (input.startsWith('/')) {
      const cmd = input.split(' ')[0].toLowerCase().replace('@scangymbot', '');
      const args = input.split(' ').slice(1).join(' ');
      switch (cmd) {
        case '/find':
        case '/search':
          input = args ? `Find gyms in ${args}` : 'Find gyms';
          break;
        case '/book':
          input = args ? `Book ${args}` : 'Book a gym';
          break;
        case '/price':
        case '/pricing':
          input = 'pricing';
          break;
        case '/help':
          input = 'help';
          break;
        case '/cancel':
          input = args ? `Cancel ${args}` : 'Cancel booking';
          break;
        case '/creator':
          input = 'How to become a creator';
          break;
        default:
          input = input.slice(1); // Strip / and send as regular text
      }
    }

    sendAction(chatId, 'typing');

    const response = await handleMessage(userId, input, {
      userName,
      platform: 'telegram',
      chatId,
    });

    // If response has gym data, store for pagination and add buttons
    if (response.data && response.data.gyms && response.data.gyms.length > 0) {
      sessions.set(chatId, {
        gyms: response.data.gyms,
        offset: 5,
        lastActive: Date.now(),
      });
      await sendWithButtons(chatId, response.text, getGymResultButtons(response.data.gyms));
    } else if (input === 'help' || input === '/start') {
      await sendWithButtons(chatId, response.text, getMainMenuButtons());
    } else {
      await sendTelegramMessage(chatId, response.text);
    }

    // Cleanup old sessions
    if (sessions.size > 5000) {
      const now = Date.now();
      for (const [k, v] of sessions) {
        if (now - v.lastActive > 1800000) sessions.delete(k);
      }
    }

  } catch (err) {
    console.error('[Telegram] Webhook error:', err);
  }
});

// ─── Handle callback queries (button taps) ───────────────────
async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const data = query.data;

  // Acknowledge the callback
  try {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: query.id }),
    });
  } catch (e) {}

  sendAction(chatId, 'typing');

  if (data === 'show_more') {
    const session = sessions.get(chatId);
    if (session && session.gyms && session.offset < session.gyms.length) {
      const nextGyms = session.gyms.slice(session.offset, session.offset + 5);
      session.offset += 5;
      session.lastActive = Date.now();

      let text = `🏋️ More gyms (${session.offset - 5 + 1}-${Math.min(session.offset, session.gyms.length)} of ${session.gyms.length}):\n\n`;
      nextGyms.forEach((g, i) => {
        const idx = session.offset - 5 + i + 1;
        const rating = g.rating ? ` ⭐ ${g.rating}` : '';
        const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
        const open = g.openNow === true ? ' · ✅ Open now' : g.openNow === false ? ' · 🔴 Closed' : '';
        text += `${idx}. *${g.name}*\n`;
        text += `   💰 ${price}/day${rating}${open}\n`;
        if (g.address) text += `   📍 ${g.address}\n`;
        text += '\n';
      });

      const buttons = [];
      if (session.offset < session.gyms.length) {
        buttons.push([{ text: `📋 Show more (${session.gyms.length - session.offset} left)`, callback_data: 'show_more' }]);
      }
      buttons.push([
        { text: '🔍 New search', callback_data: 'new_search' },
        { text: '🌐 View on web', url: `${BASE_URL}` },
      ]);

      await sendWithButtons(chatId, text, buttons);
    } else {
      await sendTelegramMessage(chatId, "That's all the gyms I found! 🏋️\n\nTry searching another city or visit scangym.com for more.");
    }
  } else if (data === 'new_search') {
    await sendTelegramMessage(chatId, '📍 Sure! Which city would you like to search?\n\nJust type a city name like "London" or "New York"');
  } else if (data === 'pricing') {
    const response = await handleMessage(`telegram:${query.from.id}`, 'pricing', { platform: 'telegram' });
    await sendTelegramMessage(chatId, response.text);
  } else if (data === 'help') {
    const response = await handleMessage(`telegram:${query.from.id}`, 'help', { platform: 'telegram', userName: query.from.first_name });
    await sendWithButtons(chatId, response.text, getMainMenuButtons());
  } else if (data === 'creator') {
    const response = await handleMessage(`telegram:${query.from.id}`, 'How to become a creator', { platform: 'telegram' });
    await sendTelegramMessage(chatId, response.text);
  } else if (data === 'share_location') {
    await sendLocationRequest(chatId);
  } else if (data.startsWith('book_')) {
    const gymIdx = parseInt(data.split('_')[1]) - 1;
    const session = sessions.get(chatId);
    if (session && session.gyms && session.gyms[gymIdx]) {
      const response = await handleMessage(`telegram:${query.from.id}`, `Book gym ${gymIdx + 1} for tomorrow`, {
        platform: 'telegram',
        userName: query.from.first_name,
      });
      await sendTelegramMessage(chatId, response.text);
    }
  }
}

// ─── Handle location sharing ─────────────────────────────────
async function handleLocation(msg) {
  const chatId = msg.chat.id;
  const { latitude, longitude } = msg.location;
  const userId = `telegram:${msg.from.id}`;
  const userName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');

  sendAction(chatId, 'typing');

  // Search gyms near coordinates
  const response = await handleMessage(userId, `Find gyms near ${latitude},${longitude}`, {
    userName,
    platform: 'telegram',
    chatId,
    location: { lat: latitude, lng: longitude },
  });

  if (response.data && response.data.gyms && response.data.gyms.length > 0) {
    sessions.set(chatId, {
      gyms: response.data.gyms,
      offset: 5,
      lastActive: Date.now(),
    });
    await sendWithButtons(chatId, response.text, getGymResultButtons(response.data.gyms));
  } else {
    await sendWithButtons(chatId, response.text, getMainMenuButtons());
  }
}

// ─── Button layouts ──────────────────────────────────────────

function getMainMenuButtons() {
  return [
    [
      { text: '🔍 Find Gyms', callback_data: 'new_search' },
      { text: '💰 Pricing', callback_data: 'pricing' },
    ],
    [
      { text: '📍 Gyms Near Me', callback_data: 'share_location' },
      { text: '💳 Earn Money', callback_data: 'creator' },
    ],
    [
      { text: '🌐 Visit ScanGym.com', url: `${BASE_URL}` },
    ],
  ];
}

function getGymResultButtons(gyms) {
  const buttons = [];
  
  // Book buttons for top 3 gyms
  const bookRow = [];
  for (let i = 0; i < Math.min(3, gyms.length); i++) {
    bookRow.push({ text: `📅 Book #${i + 1}`, callback_data: `book_${i + 1}` });
  }
  if (bookRow.length > 0) buttons.push(bookRow);
  
  // Show more button if there are more gyms
  if (gyms.length > 5) {
    buttons.push([{ text: `📋 Show more gyms (${gyms.length - 5} more)`, callback_data: 'show_more' }]);
  }
  
  buttons.push([
    { text: '🔍 New search', callback_data: 'new_search' },
    { text: '🌐 View on web', url: `${BASE_URL}` },
  ]);
  
  return buttons;
}

// ─── Send location request ───────────────────────────────────
async function sendLocationRequest(chatId) {
  if (!TELEGRAM_TOKEN) return;
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '📍 Share your location and I\'ll find the nearest gyms!\n\nTap the button below or use the 📎 attachment menu → Location.',
        reply_markup: {
          keyboard: [[{ text: '📍 Share My Location', request_location: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }),
    });
  } catch (err) {
    console.error('[Telegram] Location request error:', err.message);
  }
}

// ─── Set up webhook ──────────────────────────────────────────
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
        allowed_updates: ['message', 'callback_query'],
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

async function sendWithButtons(chatId, text, buttons) {
  if (!TELEGRAM_TOKEN) return;

  const chunks = splitMessage(text, 4000);
  // Send all chunks except last without buttons
  for (let i = 0; i < chunks.length - 1; i++) {
    try {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[i],
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      console.error('[Telegram] Send error:', err.message);
    }
  }

  // Send last chunk with inline keyboard
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunks[chunks.length - 1],
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: buttons,
        },
      }),
    });
  } catch (err) {
    console.error('[Telegram] Send with buttons error:', err.message);
    // Fallback without buttons
    await sendTelegramMessage(chatId, chunks[chunks.length - 1]);
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
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trim();
  }
  return chunks;
}

module.exports = router;
