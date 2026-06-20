/**
 * Slack Bot Adapter for ScanGym
 * 
 * Thin wrapper that receives Slack messages via Events API webhook,
 * passes them to the universal message-handler, and sends back replies.
 * 
 * Setup:
 *   1. Create a Slack App at api.slack.com/apps
 *   2. Enable Event Subscriptions → Request URL: https://scangym.com/api/chatbot/slack/events
 *   3. Subscribe to bot events: message.im, message.channels, app_mention
 *   4. Add bot scopes: chat:write, im:history, app_mentions:read
 *   5. Install to workspace → get SLACK_BOT_TOKEN (xoxb-...)
 *   6. Set env: SLACK_BOT_TOKEN=xoxb-..., SLACK_SIGNING_SECRET=...
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { handleMessage } = require('./message-handler');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// ─── Verify Slack request signature ──────────────────────────
function verifySlackSignature(req) {
  if (!SLACK_SIGNING_SECRET) return true; // Skip in dev
  const timestamp = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!timestamp || !sig) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const baseString = `v0:${timestamp}:${body}`;
  const hash = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(baseString).digest('hex');
  
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(sig));
}

// ─── Events API endpoint ─────────────────────────────────────
router.post('/events', express.json(), async (req, res) => {
  const payload = req.body;

  // Step 1: Handle Slack URL verification challenge
  if (payload.type === 'url_verification') {
    return res.json({ challenge: payload.challenge });
  }

  // Step 2: Respond 200 immediately (Slack retries after 3s)
  res.sendStatus(200);

  try {
    // Verify signature
    if (!verifySlackSignature(req)) {
      console.error('[Slack] Invalid signature');
      return;
    }

    const event = payload.event;
    if (!event || !event.text) return;

    // Skip bot messages to avoid loops
    if (event.bot_id || event.subtype === 'bot_message') return;

    const channelId = event.channel;
    const userId = `slack:${event.user}`;
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim(); // Strip @mentions
    const threadTs = event.thread_ts || event.ts; // Reply in thread

    if (!text) return;

    // Process through universal handler
    const response = await handleMessage(userId, text, {
      userName: event.user,
      platform: 'slack',
      channelId,
    });

    // Send response back to Slack
    await sendSlackMessage(channelId, response.text, threadTs);

  } catch (err) {
    console.error('[Slack] Event error:', err);
  }
});

// ─── Slash command endpoint (optional: /scangym) ─────────────
router.post('/command', express.urlencoded({ extended: true }), async (req, res) => {
  const { text, user_id, channel_id, response_url } = req.body;
  
  // Acknowledge immediately
  res.json({ response_type: 'ephemeral', text: '🔍 Searching gyms...' });

  try {
    const response = await handleMessage(`slack:${user_id}`, text || 'help', {
      userName: user_id,
      platform: 'slack',
      channelId: channel_id,
    });

    // Post result via response_url
    await fetch(response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        text: response.text,
      }),
    });
  } catch (err) {
    console.error('[Slack] Command error:', err);
  }
});

// ─── Slack API helper ────────────────────────────────────────
async function sendSlackMessage(channel, text, threadTs) {
  if (!SLACK_BOT_TOKEN) {
    console.error('[Slack] No SLACK_BOT_TOKEN set');
    return;
  }

  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel,
        text,
        thread_ts: threadTs,
        unfurl_links: false,
      }),
    });
  } catch (err) {
    console.error('[Slack] Send error:', err.message);
  }
}

module.exports = router;
