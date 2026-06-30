/**
 * Reddit Bot Adapter for ScanGym — v1.0
 * 
 * Custom Reddit bot (NO ManyChat — Reddit not supported).
 * Uses Reddit API (snoowrap) to monitor and reply to:
 *   ✓ DMs/private messages mentioning gym/day pass/travel fitness
 *   ✓ Comments in r/fitness, r/gym, r/travel mentioning day passes
 *   ✓ Posts mentioning ScanGym
 *   ✓ u/ScanGymBot mentions
 * 
 * Limitations (vs Telegram):
 *   ✗ No buttons or quick replies (text-only)
 *   ✗ No carousels or cards
 *   ✗ Rate limited (Reddit API limits)
 *   ✗ Cannot send unsolicited DMs
 * 
 * Setup:
 *   1. Create Reddit account u/ScanGymBot
 *   2. Create Reddit app at https://www.reddit.com/prefs/apps
 *      - Type: script
 *      - Redirect URI: http://localhost:8080
 *   3. Set env vars: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
 *      REDDIT_USERNAME, REDDIT_PASSWORD
 *   4. This adapter uses polling (Reddit doesn't have webhooks for bots)
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const REDDIT_USERNAME = process.env.REDDIT_USERNAME || '';
const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD || '';
const REDDIT_USER_AGENT = 'ScanGym:v1.0 (by /u/ScanGymBot)';
const BASE_URL = process.env.BASE_URL || 'https://scangym.com';

let accessToken = null;
let tokenExpiry = 0;
let pollInterval = null;
const processedIds = new Set(); // Track already-processed messages
const MAX_PROCESSED = 10000;

// ─── Get Reddit OAuth token ─────────────────────────────────
async function getRedditToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;

  try {
    const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: REDDIT_USERNAME,
        password: REDDIT_PASSWORD,
      }),
    });
    const data = await resp.json();
    if (data.access_token) {
      accessToken = data.access_token;
      tokenExpiry = Date.now() + (data.expires_in * 1000);
      return accessToken;
    }
    console.error('[Reddit] Token error:', data);
    return null;
  } catch (err) {
    console.error('[Reddit] Token fetch error:', err.message);
    return null;
  }
}

// ─── Reddit API helper ──────────────────────────────────────
async function redditApi(endpoint, method = 'GET', body = null) {
  const token = await getRedditToken();
  if (!token) return null;

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': REDDIT_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
  if (body) opts.body = new URLSearchParams(body);

  const resp = await fetch(`https://oauth.reddit.com${endpoint}`, opts);
  return resp.json();
}

// ─── Check inbox for new messages ────────────────────────────
async function checkInbox() {
  try {
    const data = await redditApi('/message/unread?limit=25');
    if (!data || !data.data || !data.data.children) return;

    for (const item of data.data.children) {
      const msg = item.data;
      if (processedIds.has(msg.name)) continue;
      processedIds.add(msg.name);

      // Cleanup processed IDs if too many
      if (processedIds.size > MAX_PROCESSED) {
        const arr = [...processedIds];
        arr.splice(0, arr.length - 5000);
        processedIds.clear();
        arr.forEach(id => processedIds.add(id));
      }

      console.log(`[Reddit] New message from u/${msg.author}: ${msg.body?.substring(0, 100)}`);

      const userId = `reddit:${msg.author}`;
      const response = await handleMessage(userId, msg.body || 'help', {
        userName: msg.author,
        platform: 'reddit',
      });

      // Format for Reddit (text-only, Reddit markdown)
      const replyText = formatForReddit(response);

      // Reply to the message
      await redditApi('/api/comment', 'POST', {
        thing_id: msg.name,
        text: replyText,
      });

      // Mark as read
      await redditApi('/api/read_message', 'POST', {
        id: msg.name,
      });
    }
  } catch (err) {
    console.error('[Reddit] Inbox check error:', err.message);
  }
}

// ─── Check username mentions ─────────────────────────────────
async function checkMentions() {
  try {
    const data = await redditApi('/message/mentions?limit=10');
    if (!data || !data.data || !data.data.children) return;

    for (const item of data.data.children) {
      const msg = item.data;
      if (processedIds.has(msg.name)) continue;
      processedIds.add(msg.name);

      console.log(`[Reddit] Mention by u/${msg.author} in r/${msg.subreddit}`);

      // Extract text after the mention
      const text = msg.body.replace(/\/?u\/ScanGymBot/gi, '').trim() || 'help';

      const userId = `reddit:${msg.author}`;
      const response = await handleMessage(userId, text, {
        userName: msg.author,
        platform: 'reddit',
        subreddit: msg.subreddit,
      });

      const replyText = formatForReddit(response);
      await redditApi('/api/comment', 'POST', {
        thing_id: msg.name,
        text: replyText,
      });

      await redditApi('/api/read_message', 'POST', { id: msg.name });
    }
  } catch (err) {
    console.error('[Reddit] Mentions check error:', err.message);
  }
}

// ─── Format response for Reddit (text-only, Reddit markdown) ─
function formatForReddit(response) {
  let text = response.text || '';

  // Convert common markdown to Reddit format
  // Bold: *text* → **text** (Reddit uses double asterisks)
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '**$1**');

  // Add gym results as Reddit-formatted table if available
  if (response.data && response.data.gyms && response.data.gyms.length > 0) {
    const gyms = response.data.gyms.slice(0, 5);
    let table = '\n\n| # | Gym | Price | Rating |\n|---|-----|-------|--------|\n';
    gyms.forEach((g, i) => {
      const price = `${g.currencySymbol || '£'}${g.dayPassPrice}/day`;
      const rating = g.rating ? `⭐ ${g.rating}` : 'N/A';
      table += `| ${i + 1} | **${g.name || 'Gym'}** — ${g.address || ''} | ${price} | ${rating} |\n`;
    });
    text += table;
  }

  // Add footer with links
  text += `\n\n---\n🏋️ *[ScanGym — Universal Gym Day Pass](${BASE_URL})* | [Find Gyms](${BASE_URL}/search) | [Pricing](${BASE_URL}/pricing) | [Earn 30% as Creator](${BASE_URL}/creator)`;

  return text;
}

// ─── Start polling ───────────────────────────────────────────
function startRedditBot() {
  if (!REDDIT_CLIENT_ID || !REDDIT_USERNAME) {
    console.log('[Reddit] No Reddit credentials set — skipping Reddit bot');
    return;
  }

  console.log('[Reddit] Starting Reddit bot polling...');

  // Check every 60 seconds (Reddit rate limits)
  pollInterval = setInterval(async () => {
    await checkInbox();
    await checkMentions();
  }, 60000);

  // Initial check
  setTimeout(async () => {
    await checkInbox();
    await checkMentions();
  }, 5000);
}

function stopRedditBot() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('[Reddit] Bot polling stopped');
  }
}

// ─── Express routes ──────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json({
    active: !!(REDDIT_CLIENT_ID && REDDIT_USERNAME),
    username: REDDIT_USERNAME || null,
    hasToken: !!accessToken,
    polling: !!pollInterval,
    processedMessages: processedIds.size,
    version: '1.0',
    note: 'Reddit bot uses polling (no webhooks). Text-only replies — no buttons/cards.',
  });
});

// Manual trigger for testing
router.post('/test', async (req, res) => {
  const { message, userId } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const response = await handleMessage(userId || 'reddit:test', message, {
    userName: 'TestUser',
    platform: 'reddit',
  });

  res.json({
    original: response,
    reddit_formatted: formatForReddit(response),
  });
});

module.exports = { router, startRedditBot, stopRedditBot };
