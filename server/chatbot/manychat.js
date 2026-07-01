/**
 * ManyChat Webhook Adapter for ScanGym — v1.0
 * 
 * Universal webhook endpoint that receives messages from ManyChat
 * (Instagram, Facebook Messenger, TikTok, YouTube) and responds
 * using the shared message-handler.js — same AI as Telegram bot.
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
 * 
 * Setup:
 *   1. Create ManyChat account & connect your social channels
 *   2. Create a Flow → trigger "New Message"
 *   3. Add "External Request" action → POST to:
 *      https://scangym.com/api/chatbot/manychat/webhook
 *   4. Map the JSON response back to ManyChat reply actions
 *   5. Set Custom Field "scangym_session" to store pagination state
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const BASE_URL = process.env.BASE_URL || 'https://scangym.com';
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY || '';

// Session store for pagination across ManyChat platforms
const sessions = new Map();

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

// ─── Main Webhook Endpoint ───────────────────────────────────
// ManyChat sends POST with user message + subscriber info
router.post('/webhook', async (req, res) => {
  try {
    const {
      message,           // User's text message
      subscriber_id,     // ManyChat subscriber ID
      platform,          // "instagram", "facebook", "tiktok", "youtube"
      first_name,        // User's first name
      last_name,         // User's last name
      username,          // Platform username
      custom_fields,     // ManyChat custom fields (e.g., scangym_session)
      action,            // Button action if from quick reply (e.g. "pricing", "book_1")
      location,          // Location if shared { lat, lng }
    } = req.body;

    const text = action || message || '';
    const platformName = (platform || 'manychat').toLowerCase();
    const userId = `${platformName}:${subscriber_id || 'unknown'}`;
    const userName = [first_name, last_name].filter(Boolean).join(' ') || username || 'User';

    if (!text) {
      return res.json(buildMCResponse('👋 Hey! Send me a city name to find gyms, or tap a button below!', platformName, []));
    }

    console.log(`[ManyChat/${platformName}] From ${userName}: ${text.substring(0, 100)}`);

    // ── Parse button actions from ManyChat quick replies ──
    let input = text;
    if (text.startsWith('action:')) {
      const actionName = text.replace('action:', '').trim();
      switch (actionName) {
        case 'pricing': input = 'pricing'; break;
        case 'creator': input = 'How to become a creator'; break;
        case 'help': input = 'help'; break;
        case 'show_more': input = 'show more'; break;
        case 'new_search': input = 'Find gyms'; break;
        default:
          if (actionName.startsWith('book_')) {
            const gymIdx = parseInt(actionName.replace('book_', ''));
            input = `Book gym ${gymIdx} for tomorrow`;
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

    // ── Process through universal handler ──
    const response = await handleMessage(userId, input, {
      userName,
      platform: platformName,
    });

    // ── Build platform-appropriate response ──
    let mcResponse;

    if (response.data && response.data.gyms && response.data.gyms.length > 0) {
      // Store session for pagination
      sessions.set(userId, {
        gyms: response.data.gyms,
        offset: 5,
        lastActive: Date.now(),
      });
      cleanupSessions();

      mcResponse = buildGymResponse(response.data.gyms, 0, platformName);
    } else {
      // Regular text response with contextual buttons
      const buttons = getContextualButtons(input, platformName);
      mcResponse = buildMCResponse(response.text, platformName, buttons);
    }

    res.json(mcResponse);

  } catch (err) {
    console.error('[ManyChat] Webhook error:', err);
    res.json(buildMCResponse(
      'Sorry, something went wrong! Try again or visit scangym.com 🏋️',
      'unknown',
      [{ title: '🌐 Visit ScanGym', url: BASE_URL }]
    ));
  }
});

// ─── Show More endpoint (pagination) ─────────────────────────
router.post('/show-more', async (req, res) => {
  try {
    const { subscriber_id, platform } = req.body;
    const platformName = (platform || 'manychat').toLowerCase();
    const userId = `${platformName}:${subscriber_id || 'unknown'}`;

    const session = sessions.get(userId);
    if (session && session.gyms && session.offset < session.gyms.length) {
      const offset = session.offset;
      session.offset += 5;
      session.lastActive = Date.now();
      res.json(buildGymResponse(session.gyms, offset, platformName));
    } else {
      res.json(buildMCResponse(
        "That's all the gyms I found! 🏋️ Try searching another city.",
        platformName,
        [{ title: '🔍 New Search', action: 'new_search' }]
      ));
    }
  } catch (err) {
    res.json(buildMCResponse('Try searching again!', 'unknown', []));
  }
});

// ─── Build gym results response ──────────────────────────────
function buildGymResponse(gyms, offset, platform) {
  const count = Math.min(5, gyms.length - offset);
  const showing = gyms.slice(offset, offset + count);

  // Build text list
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

  // Build buttons
  const buttons = [];

  // Book buttons for top 3
  showing.slice(0, 3).forEach((g, i) => {
    const idx = offset + i + 1;
    buttons.push({
      title: `📅 Book #${idx}`,
      action: `book_${idx}`,
    });
  });

  // Navigation buttons
  if (offset + count < gyms.length) {
    buttons.push({
      title: `📋 Show More (${gyms.length - offset - count} left)`,
      action: 'show_more',
    });
  }
  buttons.push({ title: '🔍 New Search', action: 'new_search' });
  buttons.push({ title: '💰 Pricing', action: 'pricing' });
  buttons.push({ title: '🌐 ScanGym.com', url: `${BASE_URL}/search` });

  // Build gallery/carousel items for platforms that support it
  const gallery = showing.map((g, i) => {
    const idx = offset + i + 1;
    const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
    return {
      title: `${idx}. ${g.name || 'Gym'}`,
      subtitle: `📍 ${g.address || ''}\n💰 ${price}/day${g.rating ? ` ⭐${g.rating}` : ''}`,
      image_url: g.photoUrl || g.photo || `${BASE_URL}/og-image.png`,
      buttons: [
        { title: `📅 Book #${idx}`, action: `book_${idx}` },
        { title: '🌐 View Details', url: `${BASE_URL}/search` },
      ],
    };
  });

  return {
    version: 'v2',
    content: {
      type: 'gym_results',
      text,
      buttons,
      gallery,  // For Instagram/FB carousel
      total_gyms: gyms.length,
      showing_from: offset + 1,
      showing_to: offset + count,
      has_more: offset + count < gyms.length,
    },
    // ManyChat-specific response format
    messages: [
      { type: 'text', text },
      ...buildQuickReplies(buttons, platform),
    ],
  };
}

// ─── Build standard ManyChat response ────────────────────────
function buildMCResponse(text, platform, buttons) {
  return {
    version: 'v2',
    content: {
      type: 'text',
      text,
      buttons: buttons || [],
    },
    messages: [
      { type: 'text', text },
      ...buildQuickReplies(buttons || [], platform),
    ],
  };
}

// ─── Build quick replies (platform-specific) ─────────────────
function buildQuickReplies(buttons, platform) {
  if (!buttons || buttons.length === 0) return [];

  // Instagram and FB support quick replies (max 13 for IG, 11 for FB)
  // TikTok supports up to 3 quick replies
  const maxButtons = platform === 'tiktok' ? 3 : platform === 'youtube' ? 0 : 10;
  const quickReplies = buttons.slice(0, maxButtons).map(btn => {
    if (btn.url) {
      return {
        type: 'url',
        title: btn.title,
        url: btn.url,
      };
    }
    return {
      type: 'quick_reply',
      title: btn.title,
      payload: btn.action || btn.title,
    };
  });

  if (quickReplies.length === 0) return [];

  return [{
    type: 'quick_replies',
    quick_replies: quickReplies,
  }];
}

// ─── Get contextual buttons based on user intent ─────────────
function getContextualButtons(input, platform) {
  const lower = (input || '').toLowerCase();

  if (lower.includes('pricing') || lower.includes('price')) {
    return [
      { title: '🔍 Find Gyms', action: 'new_search' },
      { title: '💳 Earn Money', action: 'creator' },
      { title: '🌐 Full Pricing', url: `${BASE_URL}/pricing` },
    ];
  }

  if (lower.includes('creator') || lower.includes('earn') || lower.includes('affiliate')) {
    return [
      { title: '🚀 Join Creators', url: `${BASE_URL}/creator` },
      { title: '🔍 Find Gyms', action: 'new_search' },
      { title: '💰 Pricing', action: 'pricing' },
    ];
  }

  if (lower.includes('book') || lower.includes('cancel')) {
    return [
      { title: '🔍 Find Gyms', action: 'new_search' },
      { title: '🌐 My Bookings', url: `${BASE_URL}/bookings` },
    ];
  }

  // Default
  return [
    { title: '🔍 Find Gyms', action: 'new_search' },
    { title: '💰 Pricing', action: 'pricing' },
    { title: '💳 Earn Money', action: 'creator' },
    { title: '🌐 ScanGym.com', url: BASE_URL },
  ];
}

// ─── ManyChat API: Send message to subscriber ────────────────
async function sendToSubscriber(subscriberId, platform, text, buttons) {
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
            messages: [
              { type: 'text', text },
            ],
          },
        },
      }),
    });
  } catch (err) {
    console.error('[ManyChat] API send error:', err.message);
  }
}

// ─── Welcome endpoint (called on first interaction) ──────────
router.post('/welcome', async (req, res) => {
  const { platform, first_name } = req.body;
  const name = first_name || 'there';
  const platformName = (platform || 'manychat').toLowerCase();

  const welcomeText = `👋 Hey ${name}! Welcome to *ScanGym* — the Uber for Gyms 🏋️

I can find and book gym day passes anywhere in the world!

🏋️ 1.2M+ gyms · 🌍 190+ countries · 💰 From £4.49/day · 📱 QR code entry

*Try these:*
📍 Send a city name like "Manchester"
📅 "Book gym 1 for tomorrow"
💰 "How much is a day pass?"
💳 "How do I earn money?"

What city would you like to find gyms in?`;

  const buttons = [
    { title: '🔍 Find Gyms', action: 'new_search' },
    { title: '💰 Pricing', action: 'pricing' },
    { title: '💳 Earn Money', action: 'creator' },
    { title: '❓ Help', action: 'help' },
    { title: '🌐 ScanGym.com', url: BASE_URL },
  ];

  res.json(buildMCResponse(welcomeText, platformName, buttons));
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

  const buttons = [
    { title: '🔍 Find Gyms (see prices)', action: 'new_search' },
    { title: '💳 Earn Money', action: 'creator' },
    { title: '🌐 Full Pricing', url: `${BASE_URL}/pricing` },
  ];

  res.json(buildMCResponse(pricingText, platformName, buttons));
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
    { title: '🔍 Find Gyms', action: 'new_search' },
    { title: '💰 Pricing', action: 'pricing' },
  ];

  res.json(buildMCResponse(creatorText, platformName, buttons));
});

// ─── Status endpoint ─────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    active: true,
    platforms: ['instagram', 'facebook', 'tiktok', 'youtube'],
    hasMCApiKey: !!MANYCHAT_API_KEY,
    activeSessions: sessions.size,
    version: '1.0',
    endpoints: {
      webhook: '/api/chatbot/manychat/webhook',
      welcome: '/api/chatbot/manychat/welcome',
      showMore: '/api/chatbot/manychat/show-more',
      pricing: '/api/chatbot/manychat/pricing',
      creator: '/api/chatbot/manychat/creator',
      status: '/api/chatbot/manychat/status',
    },
  });
});

module.exports = router;
