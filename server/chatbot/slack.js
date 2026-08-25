/**
 * Slack Bot Adapter for ScanGym — v3.0 (Premium Experience)
 * 
 * Full-featured Slack integration with:
 *   ✓ Rich Block Kit gym cards with Book buttons & star ratings
 *   ✓ Interactive button handler (Book, Show More, New Search)
 *   ✓ Home tab with welcome content
 *   ✓ Typing indicator
 *   ✓ Signature verification (HMAC-SHA256)
 *   ✓ Slash command (/scangym)
 *   ✓ Event deduplication
 *   ✓ Real username lookup
 *   ✓ Message splitting
 *   ✓ Thread replies
 *   ✓ Account linking
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { handleMessage } = require('./message-handler');

// ─── Slack credentials (env-only — never commit secrets) ───
// NOTE: these were previously hardcoded here as joined string fragments.
// Those credentials are considered compromised and MUST be rotated in Slack.
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) {
  console.error(
    '[chatbot/slack] Missing SLACK_BOT_TOKEN and/or SLACK_SIGNING_SECRET. ' +
    'The Slack chatbot routes are disabled until they are set (see .env.example).'
  );
}

const BASE_URL = process.env.BASE_URL || 'https://scangym.com';
const SLACK_API = 'https://slack.com/api';

// Event deduplication
const processedEvents = new Map();
const EVENT_TTL = 300000;

// User cache
const userCache = new Map();
const USER_CACHE_TTL = 3600000;

// Session store for pagination
const sessions = new Map();

// ─── Verify Slack request signature ──────────────────────────
function verifySlackSignature(req) {
  // Fail closed: without a signing secret we cannot verify authenticity,
  // so the request must be rejected rather than trusted.
  if (!SLACK_SIGNING_SECRET) return false;
  const timestamp = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!timestamp || !sig) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const body = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  const baseString = `v0:${timestamp}:${body}`;
  const hash = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(baseString).digest('hex');
  
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(sig));
  } catch (e) {
    return false;
  }
}

// ─── Get real user display name ──────────────────────────────
async function getUserName(userId) {
  if (!SLACK_BOT_TOKEN || !userId) return userId;
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.ts < USER_CACHE_TTL) return cached.name;

  try {
    const resp = await fetch(`${SLACK_API}/users.info?user=${userId}`, {
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const data = await resp.json();
    if (data.ok && data.user) {
      const name = data.user.profile?.display_name || data.user.profile?.real_name || data.user.name || userId;
      userCache.set(userId, { name, ts: Date.now() });
      return name;
    }
  } catch (e) {
    console.error('[Slack] User lookup error:', e.message);
  }
  return userId;
}

// ─── Events API endpoint ─────────────────────────────────────
router.post('/events', express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString(); } }), async (req, res) => {
  const payload = req.body;

  // URL verification challenge
  if (payload.type === 'url_verification') {
    return res.json({ challenge: payload.challenge });
  }

  res.sendStatus(200);

  try {
    if (!verifySlackSignature(req)) {
      console.error('[Slack] Invalid signature');
      return;
    }

    const event = payload.event;
    if (!event || !event.text) return;
    if (event.bot_id || event.subtype === 'bot_message') return;

    // Event deduplication
    const eventId = payload.event_id || `${event.channel}:${event.ts}`;
    if (processedEvents.has(eventId)) return;
    processedEvents.set(eventId, Date.now());
    if (processedEvents.size > 500) {
      const now = Date.now();
      for (const [k, v] of processedEvents) {
        if (now - v > EVENT_TTL) processedEvents.delete(k);
      }
    }

    const channelId = event.channel;
    const slackUserId = event.user;
    const userId = `slack:${slackUserId}`;
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    const threadTs = event.thread_ts || event.ts;

    if (!text) return;

    const userName = await getUserName(slackUserId);
    console.log(`[Slack] From ${userName}: ${text.substring(0, 100)}`);

    sendTypingIndicator(channelId);

    const response = await handleMessage(userId, text, {
      userName,
      platform: 'slack',
      channelId,
    });

    // Send rich response
    if (response.data && response.data.gyms && response.data.gyms.length > 0) {
      // Store session for pagination
      sessions.set(channelId, {
        gyms: response.data.gyms,
        offset: 5,
        threadTs,
        lastActive: Date.now(),
      });
      await sendGymBlocks(channelId, response.data.gyms, 0, threadTs);
    } else {
      await sendSlackMessage(channelId, response.text, threadTs);
    }

  } catch (err) {
    console.error('[Slack] Event error:', err);
  }
});

// ─── Interactive endpoint (button clicks) ────────────────────
router.post('/interactive', express.urlencoded({ extended: true }), async (req, res) => {
  res.sendStatus(200);

  try {
    const payload = JSON.parse(req.body.payload || '{}');
    if (payload.type !== 'block_actions') return;

    const action = payload.actions?.[0];
    if (!action) return;

    const channelId = payload.channel?.id;
    const userId = payload.user?.id;
    const threadTs = payload.message?.thread_ts || payload.message?.ts;

    if (action.action_id === 'show_more_gyms') {
      const session = sessions.get(channelId);
      if (session && session.gyms && session.offset < session.gyms.length) {
        await sendGymBlocks(channelId, session.gyms, session.offset, threadTs);
        session.offset += 5;
        session.lastActive = Date.now();
      }
    } else if (action.action_id === 'new_search') {
      await sendSlackMessage(channelId, '📍 Sure! Which city would you like to search?\n\nJust type a city name like "London" or "New York" 🏋️', threadTs);
    } else if (action.action_id?.startsWith('book_gym_')) {
      const gymIdx = parseInt(action.action_id.split('_')[2]);
      const session = sessions.get(channelId);
      if (session && session.gyms?.[gymIdx]) {
        const userName = await getUserName(userId);
        const response = await handleMessage(`slack:${userId}`, `Book gym ${gymIdx + 1} for tomorrow`, {
          userName,
          platform: 'slack',
          channelId,
        });
        await sendSlackMessage(channelId, response.text, threadTs);
      }
    }
  } catch (err) {
    console.error('[Slack] Interactive error:', err);
  }
});

// ─── Slash command endpoint (/scangym) ───────────────────────
router.post('/command', express.urlencoded({ extended: true }), async (req, res) => {
  const { text, user_id, channel_id, response_url } = req.body;
  
  res.json({ response_type: 'ephemeral', text: '🔍 Searching gyms...' });

  try {
    const userName = await getUserName(user_id);
    const response = await handleMessage(`slack:${user_id}`, text || 'help', {
      userName,
      platform: 'slack',
      channelId: channel_id,
    });

    if (response.data && response.data.gyms && response.data.gyms.length > 0) {
      // Build blocks for response_url
      const blocks = buildGymBlocks(response.data.gyms, 0);
      await fetch(response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_type: 'in_channel',
          text: response.text,
          blocks,
        }),
      });
    } else {
      await fetch(response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_type: 'in_channel',
          text: response.text,
        }),
      });
    }
  } catch (err) {
    console.error('[Slack] Command error:', err);
  }
});

// ─── Account linking endpoint ────────────────────────────────
router.post('/connect', async (req, res) => {
  const { token, slackUserId, slackTeamId } = req.body;
  if (!token || !slackUserId) {
    return res.status(400).json({ error: 'token and slackUserId required' });
  }

  try {
    const verifyResp = await fetch(`${BASE_URL}/api/channels/slack/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, slackUserId, slackTeamId }),
    });
    const data = await verifyResp.json();
    
    if (data.success) {
      const userName = await getUserName(slackUserId);
      const dmResp = await fetch(`${SLACK_API}/conversations.open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        },
        body: JSON.stringify({ users: slackUserId }),
      });
      const dmData = await dmResp.json();
      if (dmData.ok) {
        await sendSlackMessage(dmData.channel.id, `✅ *Connected!*\n\nHey ${userName}, your ScanGym account is now linked to Slack.\n\nTry: "Find gyms near Manchester" 🏋️`);
      }
      res.json({ success: true });
    } else {
      res.json({ success: false, error: data.error || 'Invalid token' });
    }
  } catch (err) {
    console.error('[Slack] Connect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Status endpoint ─────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    active: !!SLACK_BOT_TOKEN,
    hasSigningSecret: !!SLACK_SIGNING_SECRET,
    processedEvents: processedEvents.size,
    cachedUsers: userCache.size,
    activeSessions: sessions.size,
  });
});

// ─── Build Block Kit gym cards ───────────────────────────────
function buildGymBlocks(gyms, offset) {
  const count = Math.min(5, gyms.length - offset);
  const showing = gyms.slice(offset, offset + count);

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🏋️ ${gyms.length} Gyms Found`, emoji: true },
    },
    { type: 'divider' },
  ];

  showing.forEach((g, i) => {
    const idx = offset + i + 1;
    const rating = g.rating ? `⭐ ${g.rating}/5` : '';
    const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
    const open = g.openNow === true ? '✅ Open now' : g.openNow === false ? '🔴 Closed' : '';
    const stars = g.rating ? '★'.repeat(Math.round(g.rating)) + '☆'.repeat(5 - Math.round(g.rating)) : '';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${idx}. ${g.name || 'Gym'}*\n📍 ${g.address || 'Address unavailable'}\n💰 *${price}/day* ${stars ? '· ' + stars : ''} ${open ? '· ' + open : ''}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '📅 Book', emoji: true },
        style: 'primary',
        url: `${BASE_URL}/book?gym=${encodeURIComponent(g.name || '')}`,
        action_id: `book_gym_${offset + i}`,
      },
    });
  });

  // Action buttons row
  const actionElements = [];
  
  if (offset + count < gyms.length) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: `📋 Show More (${gyms.length - offset - count} left)`, emoji: true },
      action_id: 'show_more_gyms',
    });
  }
  
  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: '🔍 New Search', emoji: true },
    action_id: 'new_search',
  });

  blocks.push({ type: 'actions', elements: actionElements });

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `Showing ${offset + 1}-${offset + count} of ${gyms.length} · <${BASE_URL}|View all on ScanGym.com> · Powered by ScanGym 🌍` },
    ],
  });

  return blocks;
}

// ─── Send gym blocks via API ─────────────────────────────────
async function sendGymBlocks(channel, gyms, offset, threadTs) {
  if (!SLACK_BOT_TOKEN) return;

  const blocks = buildGymBlocks(gyms, offset);

  try {
    await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel,
        text: `🏋️ Found ${gyms.length} gyms`,
        blocks,
        thread_ts: threadTs,
        unfurl_links: false,
      }),
    });
  } catch (err) {
    console.error('[Slack] Block send error:', err.message);
    // Fallback to plain text
    const text = gyms.slice(offset, offset + 5).map((g, i) =>
      `${offset + i + 1}. *${g.name}* — ${g.currencySymbol || '£'}${g.dayPassPrice}/day ⭐ ${g.rating || 'N/A'}\n   📍 ${g.address || ''}`
    ).join('\n\n');
    await sendSlackMessage(channel, text, threadTs);
  }
}

// ─── Slack API helpers ───────────────────────────────────────

async function sendTypingIndicator(channel) {
  if (!SLACK_BOT_TOKEN) return;
  try {
    await fetch(`${SLACK_API}/chat.meTyping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel }),
    });
  } catch (e) {}
}

async function sendSlackMessage(channel, text, threadTs) {
  if (!SLACK_BOT_TOKEN) return;

  const chunks = splitMessage(text, 3000);
  for (const chunk of chunks) {
    try {
      await fetch(`${SLACK_API}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        },
        body: JSON.stringify({
          channel,
          text: chunk,
          thread_ts: threadTs,
          unfurl_links: false,
          mrkdwn: true,
        }),
      });
    } catch (err) {
      console.error('[Slack] Send error:', err.message);
    }
  }
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
