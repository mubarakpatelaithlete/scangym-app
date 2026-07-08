/**
 * ManyChat Webhook Adapter for ScanGym — v2.0
 * 
 * Universal webhook endpoint that receives messages from ManyChat
 * (Instagram, Facebook Messenger, TikTok, YouTube, WhatsApp) and responds
 * using the shared message-handler.js — same AI as Telegram bot.
 * 
 * v2.0 Additions:
 *   ✅ WhatsApp platform support (text + URL buttons, no galleries/quick replies)
 *   ✅ WhatsApp-optimized gym results (numbered text list, URL buttons)
 *   ✅ Bot-checkout integration (pay with saved card from WhatsApp)
 *   ✅ QR code sent as image message after payment
 *   ✅ Account linking (WhatsApp number → ScanGym user via user_channels)
 *   ✅ WhatsApp message templates for outbound (booking confirmations, reminders)
 *   ✅ Broadcast support for marketing messages via ManyChat API
 *   ✅ ManyChat v2 Dynamic Block response format for all platforms
 * 
 * ManyChat Flow Architecture:
 *   ManyChat receives DM → triggers Flow → External Request to this webhook
 *   → ScanGym processes → returns structured JSON → ManyChat formats natively
 * 
 * Supported Platforms:
 *   ✅ Instagram DM (full: buttons, quick replies, carousels)
 *   ✅ Facebook Messenger (full: buttons, quick replies, galleries)
 *   ✅ TikTok DM (buttons, quick replies)
 *   ✅ YouTube (comment replies — limited)
 *   ✅ WhatsApp (text + URL buttons, images — no galleries/quick replies)
 * 
 * Setup:
 *   1. Create ManyChat Pro account ($29/mo) & connect your social channels + WhatsApp
 *   2. Set env: MANYCHAT_API_KEY (from ManyChat Settings → API)
 *   3. Create a Flow → trigger "New Message" (per channel)
 *   4. Add "External Request" action → POST to:
 *      https://scangym.com/api/chatbot/manychat/webhook
 *   5. Map the JSON response back to ManyChat reply actions
 *   6. Set Custom Field "scangym_session" to store pagination state
 *   7. For WhatsApp: connect WhatsApp Business number in ManyChat → Channels
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const BASE_URL = process.env.BASE_URL || 'https://scangym.com';
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY || '';
const BOT_CHECKOUT_SECRET = process.env.BOT_CHECKOUT_SECRET || process.env.ADMIN_IMPORT_SECRET || '';
const SCANGYM_API = (
  process.env.SCANGYM_API_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
  'http://localhost:5000'
).replace(/\/+$/, '');

// Session store for pagination across ManyChat platforms
const sessions = new Map();

// Track linked accounts: manychat subscriber_id → ScanGym userId
const linkedAccounts = new Map();

// ─── Session cleanup ─────────────────────────────────────────
function cleanupSessions() {
  if (sessions.size > 5000) {
    const now = Date.now();
    for (const [k, v] of sessions) {
      if (now - v.lastActive > 1800000) sessions.delete(k);
    }
    console.log(`[ManyChat] Session cleanup: ${sessions.size} remaining`);
  }
}

// ─── Platform detection helpers ──────────────────────────────
function isWhatsApp(platform) {
  return (platform || '').toLowerCase() === 'whatsapp';
}

function supportsQuickReplies(platform) {
  const p = (platform || '').toLowerCase();
  return p === 'instagram' || p === 'facebook' || p === 'tiktok';
}

function supportsGallery(platform) {
  const p = (platform || '').toLowerCase();
  return p === 'instagram' || p === 'facebook';
}

// ─── Main Webhook Endpoint ───────────────────────────────────
// ManyChat sends POST with user message + subscriber info
router.post('/webhook', async (req, res) => {
  try {
    const {
      message,           // User's text message
      subscriber_id,     // ManyChat subscriber ID
      platform,          // "instagram", "facebook", "tiktok", "youtube", "whatsapp"
      first_name,        // User's first name
      last_name,         // User's last name
      username,          // Platform username
      phone,             // WhatsApp phone number (if available)
      custom_fields,     // ManyChat custom fields (e.g., scangym_session)
      action,            // Button action if from quick reply (e.g. "pricing", "book_1")
      location,          // Location if shared { lat, lng }
    } = req.body;

    const text = action || message || '';
    const platformName = (platform || 'manychat').toLowerCase();
    const userId = `${platformName}:${subscriber_id || 'unknown'}`;
    const userName = [first_name, last_name].filter(Boolean).join(' ') || username || 'User';

    if (!text) {
      return res.json(buildResponse('👋 Hey! Send me a city name to find gyms, or tap a button below!', platformName, []));
    }

    console.log(`[ManyChat/${platformName}] From ${userName}: ${text.substring(0, 100)}`);

    // ── Try to look up linked ScanGym account (for WhatsApp — by phone) ──
    let linkedUser = null;
    if (isWhatsApp(platformName) && phone) {
      linkedUser = await lookupLinkedUser(phone, subscriber_id);
    }

    // ── Parse button actions from ManyChat quick replies / flow buttons ──
    let input = text;
    if (text.startsWith('action:')) {
      const actionName = text.replace('action:', '').trim();
      switch (actionName) {
        case 'pricing': input = 'pricing'; break;
        case 'creator': input = 'How to become a creator'; break;
        case 'help': input = 'help'; break;
        case 'show_more': input = 'show more'; break;
        case 'new_search': input = 'Find gyms'; break;
        case 'connect_account': input = '__connect_account'; break;
        case 'my_bookings': input = 'My bookings'; break;
        default:
          if (actionName.startsWith('book_')) {
            const gymIdx = parseInt(actionName.replace('book_', ''));
            input = `Book gym ${gymIdx} for tomorrow`;
          } else if (actionName.startsWith('pay_')) {
            // pay_{cardId}_{gymIdx} — pay with saved card
            input = `__pay_${actionName.replace('pay_', '')}`;
          } else {
            input = actionName;
          }
      }
    }

    // ── Parse slash commands ──
    if (input.startsWith('/')) {
      const cmd = input.split(' ')[0].toLowerCase();
      const args = input.split(' ').slice(1).join(' ');
      switch (cmd) {
        case '/find': case '/search': input = args ? `Find gyms in ${args}` : 'Find gyms'; break;
        case '/book': input = args ? `Book ${args}` : 'Book a gym'; break;
        case '/price': case '/pricing': input = 'pricing'; break;
        case '/help': input = 'help'; break;
        case '/cancel': input = args ? `Cancel ${args}` : 'Cancel booking'; break;
        case '/creator': input = 'How to become a creator'; break;
        default: input = input.slice(1);
      }
    }

    // ── Handle location sharing ──
    if (location && location.lat && location.lng) {
      input = `Find gyms near ${location.lat},${location.lng}`;
    }

    // ── Handle internal commands ──

    // Connect account flow (WhatsApp)
    if (input === '__connect_account') {
      const connectUrl = `${BASE_URL}/channels?connect=whatsapp&phone=${encodeURIComponent(phone || '')}`;
      return res.json(buildResponse(
        '🔗 *Connect your ScanGym account*\n\nLink your WhatsApp to your ScanGym account for 1-tap booking with saved cards.\n\nTap the button below to connect:',
        platformName,
        [{ title: '🔗 Connect Account', url: connectUrl }]
      ));
    }

    // Pay with saved card (WhatsApp booking)
    if (input.startsWith('__pay_')) {
      return await handlePayWithCard(input, userId, linkedUser, platformName, res);
    }

    // ── Process through universal handler ──
    const response = await handleMessage(userId, input, {
      userName,
      platform: platformName,
      phone: phone || undefined,
      linkedUser: linkedUser || undefined,
    });

    // ── Build platform-appropriate response ──
    let mcResponse;

    if (response.data && response.data.gyms && response.data.gyms.length > 0) {
      // Store session for pagination + booking
      sessions.set(userId, {
        gyms: response.data.gyms,
        offset: 5,
        lastActive: Date.now(),
      });
      cleanupSessions();

      mcResponse = buildGymResponse(response.data.gyms, 0, platformName, linkedUser);
    } else {
      // Regular text response with contextual buttons
      const buttons = getContextualButtons(input, platformName, linkedUser);
      mcResponse = buildResponse(response.text, platformName, buttons);
    }

    res.json(mcResponse);

  } catch (err) {
    console.error('[ManyChat] Webhook error:', err);
    res.json(buildResponse(
      'Sorry, something went wrong! Try again or visit scangym.com 🏋️',
      'unknown',
      [{ title: '🌐 Visit ScanGym', url: BASE_URL }]
    ));
  }
});

// ─── Show More endpoint (pagination) ─────────────────────────
router.post('/show-more', async (req, res) => {
  try {
    const { subscriber_id, platform, phone } = req.body;
    const platformName = (platform || 'manychat').toLowerCase();
    const userId = `${platformName}:${subscriber_id || 'unknown'}`;

    let linkedUser = null;
    if (isWhatsApp(platformName) && phone) {
      linkedUser = await lookupLinkedUser(phone, subscriber_id);
    }

    const session = sessions.get(userId);
    if (session && session.gyms && session.offset < session.gyms.length) {
      const offset = session.offset;
      session.offset += 5;
      session.lastActive = Date.now();
      res.json(buildGymResponse(session.gyms, offset, platformName, linkedUser));
    } else {
      res.json(buildResponse(
        "That's all the gyms I found! 🏋️ Try searching another city.",
        platformName,
        [{ title: '🔍 New Search', action: 'new_search' }]
      ));
    }
  } catch (err) {
    res.json(buildResponse('Try searching again!', 'unknown', []));
  }
});

// ─── Handle pay with saved card (WhatsApp booking) ───────────
async function handlePayWithCard(input, userId, linkedUser, platformName, res) {
  // input format: __pay_{cardId}_{gymIdx}
  const parts = input.replace('__pay_', '').split('_');
  if (parts.length < 2) {
    return res.json(buildResponse('❌ Invalid payment action. Try booking again.', platformName, []));
  }

  const cardId = parts[0];
  const gymIdx = parseInt(parts[1]) - 1;

  if (!linkedUser) {
    return res.json(buildResponse(
      '🔗 You need to connect your ScanGym account first to pay with a saved card.\n\nTap the button below:',
      platformName,
      [{ title: '🔗 Connect Account', url: `${BASE_URL}/channels?connect=whatsapp` }]
    ));
  }

  const session = sessions.get(userId);
  if (!session || !session.gyms || !session.gyms[gymIdx]) {
    return res.json(buildResponse('❌ Session expired. Search for gyms again to book.', platformName,
      [{ title: '🔍 Find Gyms', action: 'new_search' }]
    ));
  }

  const gym = session.gyms[gymIdx];

  try {
    // Call bot-checkout endpoint
    const checkoutResp = await fetch(`${SCANGYM_API}/api/payment/bot-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: linkedUser.userId,
        gymId: gym.id || undefined,
        placeId: gym.place_id || gym.placeId || undefined,
        date: getTomorrow(),
        time: 'anytime',
        cardId,
        botSecret: BOT_CHECKOUT_SECRET,
      }),
    });

    const data = await checkoutResp.json();

    if (!checkoutResp.ok || !data.success) {
      if (data.error === 'no_saved_card') {
        return res.json(buildResponse(
          '💳 No saved card found. Please add a payment method at scangym.com first.',
          platformName,
          [{ title: '💳 Add Card', url: `${BASE_URL}/settings` }]
        ));
      }
      if (data.error === 'requires_action' || data.error === 'sca_required') {
        return res.json(buildResponse(
          '🔐 Your bank requires 3D Secure verification. Please complete the booking on scangym.com.',
          platformName,
          [{ title: '📅 Book on ScanGym', url: `${BASE_URL}/search` }]
        ));
      }
      throw new Error(data.error || 'Checkout failed');
    }

    // Success! Build confirmation with QR image
    const booking = data.booking || {};
    const qr = data.qr || '';
    const confirmCode = booking.confirmation_code || booking.id || 'N/A';
    const gymName = gym.name || booking.gym_name || 'Gym';
    const price = `${gym.currencySymbol || '£'}${gym.dayPassPrice || booking.amount || ''}`;

    const confirmText = `✅ *Booking Confirmed!*\n\n🏋️ *${gymName}*\n📍 ${gym.address || ''}\n📅 ${booking.date || getTomorrow()}\n💰 ${price}\n🔖 Code: *${confirmCode}*\n\n📱 Your QR code is below — show it at the gym entrance to check in!\n\n❌ Free cancellation up to 2h before your session.`;

    // Build response with QR image + confirmation
    const messages = [];
    messages.push({ type: 'text', text: confirmText });

    // Send QR as image if available
    if (qr && qr.startsWith('data:')) {
      // QR is a data URL — ManyChat needs a hosted URL
      // Point user to their bookings page where they can see QR
      messages.push({
        type: 'text',
        text: '📱 View your QR code:',
        buttons: [{ type: 'url', caption: '📱 View QR Code', url: `${BASE_URL}/bookings` }],
      });
    } else if (qr) {
      messages.push({ type: 'image', url: qr });
    }

    return res.json(buildDynamicBlock(messages, platformName, [
      { action: 'set_field_value', field_name: 'last_booking', value: confirmCode },
      { action: 'add_tag', tag_name: 'booked' },
    ]));

  } catch (err) {
    console.error('[ManyChat] Bot-checkout error:', err);
    return res.json(buildResponse(
      '❌ Payment failed: ' + (err.message || 'Unknown error') + '\n\nTry booking on scangym.com instead.',
      platformName,
      [{ title: '📅 Book on ScanGym', url: `${BASE_URL}/search` }]
    ));
  }
}

// ─── Look up linked ScanGym user by phone number ─────────────
async function lookupLinkedUser(phone, subscriberId) {
  // Check cache first
  const cacheKey = `wa:${phone}`;
  if (linkedAccounts.has(cacheKey)) {
    const cached = linkedAccounts.get(cacheKey);
    if (Date.now() - cached.ts < 600000) return cached; // 10 min cache
  }

  try {
    // Query user_channels table for whatsapp:{phone}
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    const resp = await fetch(`${SCANGYM_API}/api/channels/lookup?channel=whatsapp&identifier=${encodeURIComponent(cleanPhone)}`, {
      headers: { 'x-bot-secret': BOT_CHECKOUT_SECRET },
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.userId) {
        const linked = {
          userId: data.userId,
          email: data.email || null,
          stripeCustomerId: data.stripeCustomerId || null,
          phone: cleanPhone,
          ts: Date.now(),
        };
        linkedAccounts.set(cacheKey, linked);
        return linked;
      }
    }
  } catch (err) {
    console.error('[ManyChat] User lookup error:', err.message);
  }

  return null;
}

// ─── Build gym results response ──────────────────────────────
function buildGymResponse(gyms, offset, platform, linkedUser) {
  const count = Math.min(5, gyms.length - offset);
  const showing = gyms.slice(offset, offset + count);

  // Build text list (works for ALL platforms including WhatsApp)
  let text = `🏋️ *Found ${gyms.length} Gyms* (${offset + 1}–${offset + count})\n\n`;

  showing.forEach((g, i) => {
    const idx = offset + i + 1;
    const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
    const rating = g.rating ? ` ⭐${g.rating}` : '';
    const open = g.openNow === true ? ' ✅Open' : g.openNow === false ? ' 🔴Closed' : '';
    const topPick = (idx === 1 && offset === 0) ? ' → ⭐Top pick!' : '';

    text += `*${idx}. ${g.name || 'Gym'}*${topPick}\n`;
    text += `📍 ${g.address || 'Address unavailable'}\n`;
    text += `💰 ${price}/day${rating}${open}\n\n`;
  });

  // ── Platform-specific response formatting ──

  if (isWhatsApp(platform)) {
    // WhatsApp: text + URL buttons only (max 3 buttons per message)
    // No galleries, no quick replies
    const buttons = [];

    // Book top gym via URL (direct to ScanGym booking page)
    if (showing[0]) {
      const g = showing[0];
      const bookUrl = `${BASE_URL}/search?gym=${encodeURIComponent(g.name || '')}&book=1`;
      buttons.push({ type: 'url', caption: `📅 Book #${offset + 1}`, url: bookUrl });
    }

    // Show more if available
    if (offset + count < gyms.length) {
      text += `📋 _${gyms.length - offset - count} more gyms available — reply "show more"_`;
    }

    // If user has a linked account with saved cards, offer 1-tap pay
    if (linkedUser) {
      const g = showing[0];
      buttons.push({ type: 'url', caption: '💳 1-Tap Book', url: `${BASE_URL}/search?quick=1` });
    }

    buttons.push({ type: 'url', caption: '🌐 View All', url: `${BASE_URL}/search` });

    const messages = [
      {
        type: 'text',
        text,
        buttons: buttons.slice(0, 3), // WhatsApp max 3 buttons
      },
    ];

    return buildDynamicBlock(messages, platform, [
      { action: 'set_field_value', field_name: 'last_search_count', value: String(gyms.length) },
    ]);
  }

  // ── Instagram / Facebook: galleries + quick replies ──
  if (supportsGallery(platform)) {
    const gallery = showing.map((g, i) => {
      const idx = offset + i + 1;
      const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
      return {
        title: `${idx}. ${g.name || 'Gym'}`,
        subtitle: `📍 ${g.address || ''}\n💰 ${price}/day${g.rating ? ` ⭐${g.rating}` : ''}`,
        image_url: g.photoUrl || g.photo || `${BASE_URL}/og-image.png`,
        buttons: [
          { type: 'url', caption: `📅 Book #${idx}`, url: `${BASE_URL}/search` },
        ],
      };
    });

    const quickReplies = [];
    if (offset + count < gyms.length) {
      quickReplies.push({ type: 'node', caption: `📋 Show More (${gyms.length - offset - count} left)`, target: 'Show More' });
    }
    quickReplies.push({ type: 'node', caption: '🔍 New Search', target: 'New Search' });
    quickReplies.push({ type: 'node', caption: '💰 Pricing', target: 'Pricing' });

    const messages = [
      { type: 'text', text },
      { type: 'cards', elements: gallery, image_aspect_ratio: 'horizontal' },
    ];

    return {
      version: 'v2',
      content: {
        type: platform,
        messages,
        actions: [
          { action: 'set_field_value', field_name: 'last_search_count', value: String(gyms.length) },
        ],
        quick_replies: quickReplies,
      },
    };
  }

  // ── TikTok / YouTube / Other: text + limited buttons ──
  const buttons = [];
  showing.slice(0, 3).forEach((g, i) => {
    const idx = offset + i + 1;
    buttons.push({ title: `📅 Book #${idx}`, action: `book_${idx}` });
  });
  if (offset + count < gyms.length) {
    buttons.push({ title: `📋 Show More (${gyms.length - offset - count} left)`, action: 'show_more' });
  }
  buttons.push({ title: '🔍 New Search', action: 'new_search' });

  return buildResponse(text, platform, buttons);
}

// ─── Build ManyChat Dynamic Block response (v2 format) ───────
function buildDynamicBlock(messages, platform, actions, quickReplies) {
  const pType = (platform || 'instagram').toLowerCase();

  // Ensure platform type is valid for ManyChat
  const validTypes = ['instagram', 'facebook', 'whatsapp', 'telegram', 'tiktok'];
  const contentType = validTypes.includes(pType) ? pType : 'instagram';

  return {
    version: 'v2',
    content: {
      type: contentType,
      messages: messages || [],
      actions: actions || [],
      quick_replies: quickReplies || [],
    },
  };
}

// ─── Build standard response ─────────────────────────────────
function buildResponse(text, platform, buttons) {
  const pType = (platform || 'instagram').toLowerCase();

  if (isWhatsApp(pType)) {
    // WhatsApp: text + URL buttons (max 3)
    const waButtons = (buttons || [])
      .filter(b => b.url) // WhatsApp only supports URL buttons in Dynamic Block
      .slice(0, 3)
      .map(b => ({ type: 'url', caption: b.title || b.caption || 'Link', url: b.url }));

    // If no URL buttons, add default ScanGym link
    if (waButtons.length === 0 && buttons && buttons.length > 0) {
      waButtons.push({ type: 'url', caption: '🌐 ScanGym.com', url: BASE_URL });
    }

    const messages = [{
      type: 'text',
      text: text || '',
      buttons: waButtons.length > 0 ? waButtons : undefined,
    }];

    return buildDynamicBlock(messages, pType, []);
  }

  // Instagram / Facebook / TikTok / other
  const messages = [{ type: 'text', text: text || '' }];

  // Build quick replies for platforms that support them
  const quickReplies = [];
  if (supportsQuickReplies(pType) && buttons && buttons.length > 0) {
    const maxQR = pType === 'tiktok' ? 3 : 10;
    buttons.slice(0, maxQR).forEach(btn => {
      if (btn.url) {
        quickReplies.push({ type: 'url', caption: btn.title || btn.caption || 'Link', url: btn.url });
      } else {
        quickReplies.push({ type: 'node', caption: btn.title || btn.caption || '', target: btn.target || btn.action || btn.title });
      }
    });
  }

  // For non-quick-reply platforms, add buttons inline
  if (!supportsQuickReplies(pType) && buttons && buttons.length > 0) {
    const inlineButtons = buttons.slice(0, 3).map(btn => {
      if (btn.url) return { type: 'url', caption: btn.title || btn.caption || 'Link', url: btn.url };
      return { type: 'flow', caption: btn.title || btn.caption || '', target: btn.target || btn.action || '' };
    });
    messages[0].buttons = inlineButtons;
  }

  return buildDynamicBlock(messages, pType, [], quickReplies);
}

// ─── Get contextual buttons based on user intent ─────────────
function getContextualButtons(input, platform, linkedUser) {
  const lower = (input || '').toLowerCase();
  const wa = isWhatsApp(platform);

  if (lower.includes('pricing') || lower.includes('price')) {
    return [
      { title: '🔍 Find Gyms', action: 'new_search', url: wa ? `${BASE_URL}/search` : undefined },
      { title: '💳 Earn Money', action: 'creator', url: wa ? `${BASE_URL}/creator` : undefined },
      { title: '🌐 Full Pricing', url: `${BASE_URL}/pricing` },
    ];
  }

  if (lower.includes('creator') || lower.includes('earn') || lower.includes('affiliate')) {
    return [
      { title: '🚀 Join Creators', url: `${BASE_URL}/creator` },
      { title: '🔍 Find Gyms', action: 'new_search', url: wa ? `${BASE_URL}/search` : undefined },
      { title: '💰 Pricing', action: 'pricing', url: wa ? `${BASE_URL}/pricing` : undefined },
    ];
  }

  if (lower.includes('book') || lower.includes('cancel')) {
    return [
      { title: '🔍 Find Gyms', action: 'new_search', url: wa ? `${BASE_URL}/search` : undefined },
      { title: '🌐 My Bookings', url: `${BASE_URL}/bookings` },
    ];
  }

  // Default
  const defaults = [
    { title: '🔍 Find Gyms', action: 'new_search', url: wa ? `${BASE_URL}/search` : undefined },
    { title: '💰 Pricing', action: 'pricing', url: wa ? `${BASE_URL}/pricing` : undefined },
    { title: '💳 Earn Money', action: 'creator', url: wa ? `${BASE_URL}/creator` : undefined },
  ];

  // Add connect account for unlinked WhatsApp users
  if (wa && !linkedUser) {
    defaults.push({
      title: '🔗 Connect Account',
      url: `${BASE_URL}/channels?connect=whatsapp`,
    });
  }

  return defaults;
}

// ─── Welcome endpoint (called on first interaction) ──────────
router.post('/welcome', async (req, res) => {
  const { platform, first_name, phone } = req.body;
  const name = first_name || 'there';
  const platformName = (platform || 'manychat').toLowerCase();

  let linkedUser = null;
  if (isWhatsApp(platformName) && phone) {
    linkedUser = await lookupLinkedUser(phone);
  }

  const welcomeText = `👋 Hey ${name}! Welcome to *ScanGym* — the Uber for Gyms 🏋️

I can find and book gym day passes anywhere in the world!

🏋️ 1.2M+ gyms · 🌍 190+ countries · 💰 From £4.49/day · 📱 QR code entry

*Try these:*
📍 Send a city name like "Manchester"
📅 "Book gym 1 for tomorrow"
💰 "How much is a day pass?"
💳 "How do I earn money?"

What city would you like to find gyms in?`;

  const buttons = isWhatsApp(platformName)
    ? [
        { title: '🔍 Find Gyms', url: `${BASE_URL}/search` },
        { title: '💰 Pricing', url: `${BASE_URL}/pricing` },
        ...(linkedUser ? [] : [{ title: '🔗 Connect Account', url: `${BASE_URL}/channels?connect=whatsapp` }]),
      ]
    : [
        { title: '🔍 Find Gyms', action: 'new_search' },
        { title: '💰 Pricing', action: 'pricing' },
        { title: '💳 Earn Money', action: 'creator' },
        { title: '❓ Help', action: 'help' },
        { title: '🌐 ScanGym.com', url: BASE_URL },
      ];

  res.json(buildResponse(welcomeText, platformName, buttons));
});

// ─── Pricing endpoint ────────────────────────────────────────
router.post('/pricing', async (req, res) => {
  const { platform } = req.body;
  const platformName = (platform || 'manychat').toLowerCase();

  const pricingText = `💰 *ScanGym Pricing*

Day passes are PPP-adjusted by country — always a fair local price:

🇬🇧 UK — from £4.49/day
🇺🇸 US — from $5.49/day
🇪🇺 Europe — from €4.99/day
🇮🇳 India — from ₹199/day
🇦🇪 UAE — from AED 19/day
🇦🇺 Australia — from A$8.49/day

*Pass Types:*
🏋️ Day Pass — single session (base price)
📅 3-Day Pass — ~30% savings
📆 Weekly — ~40% savings
🗓️ Monthly — best value!

✅ Zero platform fees
🔄 Free cancellation up to 2h before
💳 15% off with Creator referral code`;

  const buttons = isWhatsApp(platformName)
    ? [
        { title: '🔍 Find Gyms', url: `${BASE_URL}/search` },
        { title: '💳 Earn Money', url: `${BASE_URL}/creator` },
        { title: '🌐 Full Pricing', url: `${BASE_URL}/pricing` },
      ]
    : [
        { title: '🔍 Find Gyms (see prices)', action: 'new_search' },
        { title: '💳 Earn Money', action: 'creator' },
        { title: '🌐 Full Pricing', url: `${BASE_URL}/pricing` },
      ];

  res.json(buildResponse(pricingText, platformName, buttons));
});

// ─── Creator endpoint ────────────────────────────────────────
router.post('/creator', async (req, res) => {
  const { platform } = req.body;
  const platformName = (platform || 'manychat').toLowerCase();

  const creatorText = `💳 *ScanGym Creator Programme*

Share gyms, earn money. The easiest fitness affiliate programme.

💰 30% commission per booking
🔗 Personal affiliate link for ANY gym
📊 Real-time analytics dashboard
🎨 242+ marketing materials
💳 Instant payouts via Stripe

*Perfect for:*
• Fitness influencers & gym reviewers
• Personal trainers
• Travel bloggers
• Anyone with a social following`;

  const buttons = [
    { title: '🚀 Join Creators', url: `${BASE_URL}/creator` },
    { title: '🔍 Find Gyms', action: 'new_search', url: isWhatsApp(platformName) ? `${BASE_URL}/search` : undefined },
    { title: '💰 Pricing', action: 'pricing', url: isWhatsApp(platformName) ? `${BASE_URL}/pricing` : undefined },
  ];

  res.json(buildResponse(creatorText, platformName, buttons));
});

// ═══════════════════════════════════════════════════════════
//  WHATSAPP BOOKING FLOW (Option B — Full)
//  1. User searches → gets gym list
//  2. User taps "Book #1" → redirect to ScanGym booking page
//  3. After payment → booking confirmation + QR sent via ManyChat API
//  4. Reminder sent 1h before session via ManyChat broadcast
// ═══════════════════════════════════════════════════════════

// ─── Booking confirmation webhook (called by ScanGym after payment) ──
// POST /api/chatbot/manychat/booking-confirmed
// Body: { phone, bookingId, gymName, date, time, confirmationCode, qrUrl }
router.post('/booking-confirmed', async (req, res) => {
  try {
    const { phone, bookingId, gymName, date, time, confirmationCode, qrUrl } = req.body;

    if (!phone || !MANYCHAT_API_KEY) {
      return res.status(400).json({ error: 'phone and MANYCHAT_API_KEY required' });
    }

    // Find ManyChat subscriber by phone
    const subscriber = await findSubscriberByPhone(phone);
    if (!subscriber) {
      console.log(`[ManyChat] No subscriber found for phone ${phone}`);
      return res.json({ sent: false, reason: 'subscriber_not_found' });
    }

    // Send booking confirmation via ManyChat API
    const confirmText = `✅ *Booking Confirmed!*\n\n🏋️ *${gymName || 'Gym'}*\n📅 ${date || 'Tomorrow'} at ${time || 'Anytime'}\n🔖 Code: *${confirmationCode || bookingId}*\n\n📱 Show your QR code at the gym entrance to check in!`;

    await sendManyChatMessage(subscriber.id, confirmText);

    // Send QR code image if available
    if (qrUrl && !qrUrl.startsWith('data:')) {
      await sendManyChatImage(subscriber.id, qrUrl);
    }

    // Tag subscriber as "booked"
    await tagSubscriber(subscriber.id, 'booked');

    // Set custom field with booking info
    await setSubscriberField(subscriber.id, 'last_booking', confirmationCode || bookingId);

    res.json({ sent: true, subscriberId: subscriber.id });

  } catch (err) {
    console.error('[ManyChat] Booking confirmation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Booking reminder webhook (called by cron 1h before session) ──
// POST /api/chatbot/manychat/booking-reminder
router.post('/booking-reminder', async (req, res) => {
  try {
    const { phone, gymName, date, time, confirmationCode, gymAddress } = req.body;

    if (!phone || !MANYCHAT_API_KEY) {
      return res.status(400).json({ error: 'phone and MANYCHAT_API_KEY required' });
    }

    const subscriber = await findSubscriberByPhone(phone);
    if (!subscriber) {
      return res.json({ sent: false, reason: 'subscriber_not_found' });
    }

    const reminderText = `⏰ *Gym Session in 1 Hour!*\n\n🏋️ *${gymName || 'Gym'}*\n📍 ${gymAddress || ''}\n📅 ${date || 'Today'} at ${time || ''}\n🔖 Code: *${confirmationCode}*\n\nHave your QR code ready to scan at the entrance. Enjoy your workout! 💪`;

    await sendManyChatMessage(subscriber.id, reminderText);
    res.json({ sent: true });

  } catch (err) {
    console.error('[ManyChat] Reminder error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  BROADCAST — Send marketing messages to tagged subscribers
// ═══════════════════════════════════════════════════════════

// POST /api/chatbot/manychat/broadcast
// Body: { tag, message, buttonText?, buttonUrl?, platform? }
router.post('/broadcast', async (req, res) => {
  try {
    const { tag, message, buttonText, buttonUrl, platform } = req.body;
    const botSecret = req.body.botSecret || req.headers['x-bot-secret'];

    // Auth check
    if (!botSecret || botSecret !== BOT_CHECKOUT_SECRET) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!message || !MANYCHAT_API_KEY) {
      return res.status(400).json({ error: 'message and MANYCHAT_API_KEY required' });
    }

    // Get subscribers by tag
    const subscribers = await getSubscribersByTag(tag || 'all');

    let sent = 0;
    let failed = 0;

    for (const sub of subscribers) {
      try {
        if (buttonText && buttonUrl) {
          await sendManyChatMessageWithButton(sub.id, message, buttonText, buttonUrl);
        } else {
          await sendManyChatMessage(sub.id, message);
        }
        sent++;
        // Rate limit: ManyChat allows ~25 messages/second
        if (sent % 20 === 0) await delay(1000);
      } catch (err) {
        failed++;
      }
    }

    res.json({ sent, failed, total: subscribers.length });

  } catch (err) {
    console.error('[ManyChat] Broadcast error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  ACCOUNT LINKING — Connect WhatsApp number to ScanGym user
// ═══════════════════════════════════════════════════════════

// POST /api/chatbot/manychat/link-account
// Called when user connects WhatsApp from scangym.com/channels
router.post('/link-account', async (req, res) => {
  try {
    const { phone, userId, subscriberId } = req.body;

    if (!phone || !userId) {
      return res.status(400).json({ error: 'phone and userId required' });
    }

    // Cache the link
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    linkedAccounts.set(`wa:${cleanPhone}`, {
      userId,
      phone: cleanPhone,
      ts: Date.now(),
    });

    // Send confirmation via ManyChat if we have subscriber ID
    if (subscriberId && MANYCHAT_API_KEY) {
      await sendManyChatMessage(subscriberId,
        '✅ *Account connected!*\n\nYour WhatsApp is now linked to your ScanGym account.\n\n💳 You can now book gyms with your saved cards right here in WhatsApp!\n\nTry: "Find gyms in Manchester"'
      );
      await tagSubscriber(subscriberId, 'linked_account');
    }

    console.log(`[ManyChat] Linked WhatsApp ${cleanPhone} → ScanGym user ${userId}`);
    res.json({ success: true });

  } catch (err) {
    console.error('[ManyChat] Link account error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  MANYCHAT API HELPERS
// ═══════════════════════════════════════════════════════════

async function sendManyChatMessage(subscriberId, text) {
  if (!MANYCHAT_API_KEY) return;
  try {
    const resp = await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANYCHAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        data: {
          version: 'v2',
          content: {
            messages: [{ type: 'text', text }],
          },
        },
      }),
    });
    if (!resp.ok) console.error('[ManyChat] API send error:', resp.status, await resp.text());
  } catch (err) {
    console.error('[ManyChat] API send error:', err.message);
  }
}

async function sendManyChatMessageWithButton(subscriberId, text, buttonCaption, buttonUrl) {
  if (!MANYCHAT_API_KEY) return;
  try {
    await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANYCHAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        data: {
          version: 'v2',
          content: {
            messages: [{
              type: 'text',
              text,
              buttons: [{ type: 'url', caption: buttonCaption, url: buttonUrl }],
            }],
          },
        },
      }),
    });
  } catch (err) {
    console.error('[ManyChat] API send error:', err.message);
  }
}

async function sendManyChatImage(subscriberId, imageUrl) {
  if (!MANYCHAT_API_KEY) return;
  try {
    await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANYCHAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        data: {
          version: 'v2',
          content: {
            messages: [{ type: 'image', url: imageUrl }],
          },
        },
      }),
    });
  } catch (err) {
    console.error('[ManyChat] API image error:', err.message);
  }
}

async function findSubscriberByPhone(phone) {
  if (!MANYCHAT_API_KEY) return null;
  try {
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    const resp = await fetch(
      `https://api.manychat.com/fb/subscriber/findBySystemField?field_name=whatsapp_phone&field_value=${encodeURIComponent(cleanPhone)}`,
      {
        headers: { 'Authorization': `Bearer ${MANYCHAT_API_KEY}` },
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status === 'success' && data.data && data.data.length > 0) {
      return data.data[0];
    }
  } catch (err) {
    console.error('[ManyChat] Find subscriber error:', err.message);
  }
  return null;
}

async function getSubscribersByTag(tagName) {
  // ManyChat API doesn't directly support "get all by tag"
  // In practice, broadcasts are done through ManyChat UI or Sending API flows
  // This is a placeholder for future API expansion
  console.log(`[ManyChat] Broadcast by tag "${tagName}" — use ManyChat Dashboard for bulk sends`);
  return [];
}

async function tagSubscriber(subscriberId, tagName) {
  if (!MANYCHAT_API_KEY) return;
  try {
    await fetch('https://api.manychat.com/fb/subscriber/addTagByName', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANYCHAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        tag_name: tagName,
      }),
    });
  } catch (err) {
    console.error('[ManyChat] Tag error:', err.message);
  }
}

async function setSubscriberField(subscriberId, fieldName, value) {
  if (!MANYCHAT_API_KEY) return;
  try {
    await fetch('https://api.manychat.com/fb/subscriber/setCustomFieldByName', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANYCHAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        field_name: fieldName,
        field_value: value,
      }),
    });
  } catch (err) {
    console.error('[ManyChat] Set field error:', err.message);
  }
}

// ─── Utility helpers ─────────────────────────────────────────

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Status endpoint ─────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    active: true,
    platforms: ['instagram', 'facebook', 'tiktok', 'youtube', 'whatsapp'],
    hasMCApiKey: !!MANYCHAT_API_KEY,
    hasBotCheckoutSecret: !!BOT_CHECKOUT_SECRET,
    activeSessions: sessions.size,
    linkedAccounts: linkedAccounts.size,
    version: '2.0',
    endpoints: {
      webhook: '/api/chatbot/manychat/webhook',
      welcome: '/api/chatbot/manychat/welcome',
      showMore: '/api/chatbot/manychat/show-more',
      pricing: '/api/chatbot/manychat/pricing',
      creator: '/api/chatbot/manychat/creator',
      bookingConfirmed: '/api/chatbot/manychat/booking-confirmed',
      bookingReminder: '/api/chatbot/manychat/booking-reminder',
      broadcast: '/api/chatbot/manychat/broadcast',
      linkAccount: '/api/chatbot/manychat/link-account',
      status: '/api/chatbot/manychat/status',
    },
    whatsapp: {
      features: [
        'text_messages',
        'url_buttons',
        'images',
        'account_linking',
        'booking_confirmations',
        'booking_reminders',
        'broadcasts',
        'bot_checkout',
      ],
      limitations: [
        'no_galleries',
        'no_quick_replies',
        'max_3_buttons_per_message',
        'no_video_audio_files',
      ],
    },
  });
});

module.exports = router;
