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
const pool = require('../middleware/db');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
// The apex host 301-redirects to www, and Telegram does not follow redirects:
// a webhook registered on the apex host answered every update with
// "Wrong response from the webhook: 301 Moved Permanently" and the bot went
// silent while /health still reported telegram as configured. Default to the
// canonical host so a missing BASE_URL cannot take the bot down again.
const { canonicalBase } = require('./canonical-host');
const BASE_URL = canonicalBase(process.env.BASE_URL || 'https://www.scangym.com');
const WEBHOOK_PATH = '/api/chatbot/telegram/webhook';

const BOT_SECRET = process.env.BOT_CHECKOUT_SECRET || process.env.ADMIN_IMPORT_SECRET || '';

// Session store for pagination + booking flow
const sessions = new Map();

// ═══════════════════════════════════════════════════════════
//  USER LOOKUP — Link Telegram user to ScanGym account
//  Uses the user_channels table populated by the Connect flow.
// ═══════════════════════════════════════════════════════════
async function lookupLinkedUser(telegramUserId) {
  try {
    const { rows } = await pool.query(
      `SELECT uc.user_id, u.email, u.first_name, u.stripe_customer_id
       FROM user_channels uc
       JOIN public.users u ON u.id = uc.user_id
       WHERE uc.channel = 'telegram' AND uc.channel_user_id = $1 AND uc.is_active = true
       LIMIT 1`,
      [String(telegramUserId)]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error('[Telegram] User lookup error:', err.message);
    return null;
  }
}

/**
 * The gym this customer booked most recently — powers the one-tap
 * "book my usual again today" button, so a returning customer never has to
 * type a city or pick from a list again.
 */
async function lookupLastGym(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT place_id, gym_name FROM bookings
        WHERE user_id = $1 AND place_id IS NOT NULL AND gym_name IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows.length > 0 ? { placeId: rows[0].place_id, name: rows[0].gym_name } : null;
  } catch (err) {
    console.error('[Telegram] Last gym lookup error:', err.message);
    return null;
  }
}

function rebookButton(lastGym) {
  const short = (lastGym.name || 'my gym').substring(0, 24);
  return { text: `🔁 ${short} again today`, callback_data: 'rebook_today' };
}

/**
 * Get saved cards for a linked user (calls bot-cards endpoint internally)
 */
async function getSavedCards(userId) {
  try {
    const resp = await fetch(`${BASE_URL}/api/payment/bot-cards?userId=${encodeURIComponent(userId)}&botSecret=${encodeURIComponent(BOT_SECRET)}`);
    const data = await resp.json();
    return data.cards || [];
  } catch (err) {
    console.error('[Telegram] Get cards error:', err.message);
    return [];
  }
}

/**
 * Execute bot checkout — charge saved card, get QR
 */
async function executeBotCheckout(params) {
  try {
    const resp = await fetch(`${BASE_URL}/api/payment/bot-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, botSecret: BOT_SECRET }),
    });
    return await resp.json();
  } catch (err) {
    console.error('[Telegram] Bot checkout error:', err.message);
    return { error: err.message };
  }
}

/**
 * Send a QR code image to Telegram chat
 * The QR data URL is a base64 PNG — we convert and send as photo.
 */
async function sendQRPhoto(chatId, qrDataUrl, caption) {
  if (!TELEGRAM_TOKEN || !qrDataUrl) return;
  try {
    // qrDataUrl is "data:image/png;base64,..." — extract the base64 part
    const base64Data = qrDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Use multipart form to send photo
    const FormData = require('form-data') || null;
    // Fallback: send as document if form-data not available
    // Use the Telegram sendPhoto with base64 file upload
    const boundary = '----ScanGymQR' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption || ''}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="qr-code.png"\r\nContent-Type: image/png\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
  } catch (err) {
    console.error('[Telegram] QR photo send error:', err.message);
    // Fallback: send QR as a link
    await sendTelegramMessage(chatId, `📲 *Your QR code:* ${BASE_URL}/booking/${chatId}/qr`);
  }
}

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
          const verifyResp = await fetch(`${BASE_URL}/api/channels/telegram/verify`, {
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
        case '/gyms':
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
        case '/pass':
        case '/passes':
        case '/mypasses':
          input = 'my bookings';
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

    // Look up linked ScanGym account
    const linkedUser = await lookupLinkedUser(msg.from.id);

    const response = await handleMessage(userId, input, {
      userName,
      platform: 'telegram',
      chatId,
      linkedUser, // Pass linked user context to message handler
    });

    // If response has gym data, store for pagination and add buttons
    if (response.data && response.data.gyms && response.data.gyms.length > 0) {
      sessions.set(chatId, {
        gyms: response.data.gyms,
        offset: 5,
        lastActive: Date.now(),
        telegramUserId: msg.from.id,
      });
      await sendWithButtons(chatId, response.text, getGymResultButtons(response.data.gyms, linkedUser));
    } else if (response.data && response.data.booking) {
      // Booking was created (guest flow) — if linked user, offer to pay with saved card
      if (linkedUser && linkedUser.stripe_customer_id) {
        const cards = await getSavedCards(linkedUser.user_id);
        if (cards.length > 0) {
          const session = sessions.get(chatId) || {};
          session.pendingPayment = {
            booking: response.data.booking,
            linkedUserId: linkedUser.user_id,
          };
          session.lastActive = Date.now();
          sessions.set(chatId, session);

          const payButtons = cards.slice(0, 3).map(c => ({
            text: `💳 Pay with ${c.label}`,
            callback_data: `pay_${c.id}_${response.data.booking.id}`,
          }));
          payButtons.push({ text: '🌐 Pay on website', url: `${BASE_URL}/booking/${response.data.booking.id}/pay` });

          await sendWithButtons(chatId, response.text + `\n\n💳 *Pay instantly with your saved card:*`, [payButtons]);
          return;
        }
      }
      await sendTelegramMessage(chatId, response.text);
    } else if (input === 'help' || input === '/start') {
      const lastGym = linkedUser ? await lookupLastGym(linkedUser.user_id) : null;
      const menu = getMainMenuButtons();
      if (lastGym) {
        const session = sessions.get(chatId) || {};
        session.lastGym = lastGym;
        session.lastActive = Date.now();
        sessions.set(chatId, session);
        menu.unshift([rebookButton(lastGym)]);
      }
      await sendWithButtons(chatId, response.text, menu);
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
  } else if (data === 'rebook_today') {
    const session = sessions.get(chatId) || {};
    const linkedUser = await lookupLinkedUser(query.from.id);
    const lastGym = session.lastGym || (linkedUser ? await lookupLastGym(linkedUser.user_id) : null);
    if (!lastGym) {
      await sendTelegramMessage(chatId, "I don't have a previous gym for you yet — tap 🔍 Find Gyms and I'll book it in one tap next time.");
      return;
    }
    const response = await handleMessage(`telegram:${query.from.id}`, 'Book it for today', {
      platform: 'telegram',
      userName: query.from.first_name,
      linkedUser,
      rebookGym: lastGym,
    });
    await sendTelegramMessage(chatId, response.text);
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
  } else if (data.startsWith('book_') || data.startsWith('bookday_')) {
    /* Day-pass customers usually want to train TODAY, but the old single
       "Book #N" button silently booked tomorrow. bookday_<n>_<today|tomorrow>
       lets them pick the day in the same tap. */
    const parts = data.split('_');
    const gymIdx = parseInt(parts[1]) - 1;
    const when = parts[2] === 'today' ? 'today' : 'tomorrow';
    const session = sessions.get(chatId);
    if (session && session.gyms && session.gyms[gymIdx]) {
      // Look up linked user for booking flow
      const linkedUser = await lookupLinkedUser(query.from.id);
      const response = await handleMessage(`telegram:${query.from.id}`, `Book gym ${gymIdx + 1} for ${when}`, {
        platform: 'telegram',
        userName: query.from.first_name,
        linkedUser,
      });

      // If linked user has saved cards, offer instant payment
      if (response.data?.booking && linkedUser?.stripe_customer_id) {
        const cards = await getSavedCards(linkedUser.user_id);
        if (cards.length > 0) {
          const s = session || {};
          s.pendingPayment = { booking: response.data.booking, linkedUserId: linkedUser.user_id };
          s.lastActive = Date.now();
          sessions.set(chatId, s);

          const payRow = cards.slice(0, 2).map(c => ({
            text: `💳 ${c.label}`, callback_data: `pay_${c.id}_${response.data.booking.id}`,
          }));
          payRow.push({ text: '🌐 Website', url: `${BASE_URL}/booking/${response.data.booking.id}/pay` });
          await sendWithButtons(chatId, response.text + '\n\n💳 *Pay now with saved card:*', [payRow]);
          return;
        }
      }
      await sendTelegramMessage(chatId, response.text);
    }

  // ── PAY WITH SAVED CARD — bot-checkout flow ──
  } else if (data.startsWith('pay_')) {
    const parts = data.split('_');
    // Format: pay_{cardId}_{bookingId} — cardId may contain underscores
    const bookingId = parts[parts.length - 1];
    const cardId = parts.slice(1, -1).join('_');

    const session = sessions.get(chatId);
    if (!session?.pendingPayment) {
      await sendTelegramMessage(chatId, '⏱ This payment link has expired. Please try booking again.');
      return;
    }

    const { booking, linkedUserId } = session.pendingPayment;

    await sendAction(chatId, 'typing');
    await sendTelegramMessage(chatId, '💳 Processing payment...');

    const result = await executeBotCheckout({
      userId: linkedUserId,
      gymId: booking.gymId,
      date: booking.date,
      time: booking.time || 'anytime',
      cardId,
    });

    if (result.success) {
      // Clear pending payment
      session.pendingPayment = null;
      sessions.set(chatId, session);

      // Send booking confirmation
      const confirmText = `━━━━━━━━━━━━━━━━\n`
        + `✅ *Booking Confirmed!*\n`
        + `━━━━━━━━━━━━━━━━\n\n`
        + `🏋️ *${result.booking.gymName}*\n`
        + `📅 ${result.booking.date}\n`
        + `⏰ ${result.booking.time}\n`
        + `💰 ${result.booking.currencySymbol || '£'}${typeof result.booking.price === 'number' ? result.booking.price.toFixed(2) : result.booking.price}\n`
        + `💳 Charged to ${result.cardUsed}\n`
        + `🔖 Code: *${result.booking.bookingCode}*\n\n`
        + `📲 *Your QR code is below!*\n`
        + `Scan at the gym entrance — no reception needed! 🔑\n\n`
        + `⏳ Free cancel: up to 2 hours before.\n`
        + `To cancel: \"Cancel ${result.booking.bookingCode}\"\n\n`
        + `Have an amazing workout! 💪🔥`;

      await sendTelegramMessage(chatId, confirmText);

      // Send QR code as photo
      if (result.qr?.dataUrl) {
        await sendQRPhoto(chatId, result.qr.dataUrl,
          `🎟 QR Code for *${result.booking.gymName}*\n📅 ${result.booking.date} at ${result.booking.time}\n\nShow this at the gym entrance!`
        );
      }
    } else {
      // Payment failed
      let errorMsg = '❌ *Payment failed*\n\n';
      if (result.error === 'no_saved_card') {
        errorMsg += '💳 No saved card found.\n\nPlease add a payment method at scangym.com first, then try again.';
      } else if (result.error === 'sca_required') {
        errorMsg += `🔐 Your card requires 3D Secure verification.\n\nPlease complete this booking on the website:\n${BASE_URL}/booking/${bookingId}/pay`;
      } else if (result.error === 'duplicate') {
        errorMsg += '📋 You already have a booking at this gym for this date/time!';
      } else {
        errorMsg += `${result.message || result.error || 'Unknown error'}\n\nTry again or book at scangym.com`;
      }
      await sendTelegramMessage(chatId, errorMsg);
    }

  // ── CONNECT ACCOUNT — prompt user to link Telegram to ScanGym ──
  } else if (data === 'connect_account') {
    await sendWithButtons(chatId,
      '🔗 *Connect your ScanGym account*\n\n'
      + 'Link your Telegram to ScanGym to:\n'
      + '• 💳 Pay with your saved card\n'
      + '• 📲 Get QR codes right here in Telegram\n'
      + '• 📋 View your bookings\n\n'
      + '1. Log in at scangym.com\n'
      + '2. Go to Channels → Telegram\n'
      + '3. Tap "Connect" — done!\n\n'
      + 'Or tap below to open the website:',
      [[{ text: '🔗 Connect at scangym.com', url: `${BASE_URL}/channels` }]]
    );
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

function getGymResultButtons(gyms, linkedUser) {
  const buttons = [];
  
  // Book buttons for the top 3 gyms — one tap per day, so the customer never
  // has to type a date and never gets a surprise day.
  const todayRow = [];
  const tomorrowRow = [];
  for (let i = 0; i < Math.min(3, gyms.length); i++) {
    todayRow.push({ text: `☀️ #${i + 1} today`, callback_data: `bookday_${i + 1}_today` });
    tomorrowRow.push({ text: `📅 #${i + 1} tomorrow`, callback_data: `bookday_${i + 1}_tomorrow` });
  }
  if (todayRow.length > 0) { buttons.push(todayRow); buttons.push(tomorrowRow); }
  
  // Show more button if there are more gyms
  if (gyms.length > 5) {
    buttons.push([{ text: `📋 Show more gyms (${gyms.length - 5} more)`, callback_data: 'show_more' }]);
  }
  
  // If user is not linked, show connect prompt
  if (!linkedUser) {
    buttons.push([
      { text: '🔗 Connect account (1-tap booking)', callback_data: 'connect_account' },
    ]);
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

// ─── Admin guard ─────────────────────────────────────────────
// This route repoints the bot's webhook. Unauthenticated, it let anyone on the
// internet redirect every customer conversation to their own server.
function requireChatbotAdmin(req, res, next) {
  const expected = process.env.CHATBOT_ADMIN_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'CHATBOT_ADMIN_KEY is not set, so webhook changes are refused' });
  }
  const given = req.get('x-admin-key') || '';
  if (given.length !== expected.length || given !== expected) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}

/**
 * Point Telegram at the canonical webhook URL on boot.
 *
 * Registration lives in Telegram's console, not in this repo, so a deploy can
 * be perfectly healthy while inbound messages go to a stale or redirecting
 * URL. Checking it at startup makes that self-healing instead of silent.
 */
async function ensureWebhook() {
  if (!TELEGRAM_TOKEN) return { ok: false, reason: 'no token' };
  const want = `${BASE_URL}${WEBHOOK_PATH}`;
  try {
    const info = await (await fetch(`${TELEGRAM_API}/getWebhookInfo`)).json();
    const current = info?.result?.url || '';
    const lastError = info?.result?.last_error_message || '';
    if (current === want && !lastError) return { ok: true, changed: false, url: current };

    const resp = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: want, allowed_updates: ['message', 'callback_query'] }),
    });
    const data = await resp.json();
    console.log(`[Telegram] webhook ${current ? `was ${current}` : 'was missing'}${lastError ? ` (last error: ${lastError})` : ''} → set to ${want}:`, data.ok ? 'ok' : data.description);
    return { ok: !!data.ok, changed: true, url: want, previous: current };
  } catch (err) {
    console.error('[Telegram] ensureWebhook failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * Publish the command menu to Telegram.
 *
 * The bot already understood /find, /book and friends, but nothing ever called
 * setMyCommands, so Telegram's blue "Menu" button listed nothing and customers
 * had no way to discover them. Registering on boot keeps the menu in step with
 * the switch statement above.
 */
const BOT_COMMANDS = [
  { command: 'gyms', description: 'Find gyms near a place' },
  { command: 'book', description: 'Book a day pass' },
  { command: 'pass', description: 'Show my passes and bookings' },
  { command: 'price', description: 'See pricing' },
  { command: 'cancel', description: 'Cancel a booking' },
  { command: 'help', description: 'What this bot can do' },
];

async function ensureCommands() {
  if (!TELEGRAM_TOKEN) return { ok: false, reason: 'no token' };
  try {
    const resp = await fetch(`${TELEGRAM_API}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    const data = await resp.json();
    if (!data.ok) console.error('[Telegram] setMyCommands failed:', data.description);
    return { ok: !!data.ok, commands: BOT_COMMANDS.length };
  } catch (err) {
    console.error('[Telegram] ensureCommands failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

// ─── Set up webhook ──────────────────────────────────────────
router.post('/setup', requireChatbotAdmin, async (req, res) => {
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
module.exports.ensureWebhook = ensureWebhook;
module.exports.ensureCommands = ensureCommands;
module.exports.BOT_COMMANDS = BOT_COMMANDS;
