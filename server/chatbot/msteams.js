/**
 * Microsoft Teams Bot Adapter for ScanGym
 * 
 * Thin wrapper that receives Teams messages via Bot Framework webhook,
 * passes them to the universal message-handler, and sends back replies.
 * 
 * Setup:
 *   1. Register a bot at dev.botframework.com (or via Azure Bot Service)
 *   2. Set messaging endpoint: https://scangym.com/api/chatbot/msteams/messages
 *   3. Set env: TEAMS_APP_ID=..., TEAMS_APP_PASSWORD=...
 *   4. Install the bot in your Teams workspace
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const TEAMS_APP_ID = process.env.TEAMS_APP_ID;
const TEAMS_APP_PASSWORD = process.env.TEAMS_APP_PASSWORD;

let _accessToken = null;
let _tokenExpiry = 0;

// ─── Get Bot Framework access token ─────────────────────────
async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 60000) return _accessToken;
  if (!TEAMS_APP_ID || !TEAMS_APP_PASSWORD) return null;

  try {
    const resp = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: TEAMS_APP_ID,
        client_secret: TEAMS_APP_PASSWORD,
        scope: 'https://api.botframework.com/.default',
      }),
    });
    const data = await resp.json();
    _accessToken = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in * 1000);
    return _accessToken;
  } catch (err) {
    console.error('[Teams] Token error:', err.message);
    return null;
  }
}

// ─── Incoming messages endpoint ──────────────────────────────
router.post('/messages', async (req, res) => {
  // Respond 200 immediately
  res.sendStatus(200);

  try {
    const activity = req.body;

    // Only handle message activities
    if (activity.type !== 'message' || !activity.text) return;

    const userId = `teams:${activity.from?.id || 'unknown'}`;
    const text = activity.text.replace(/<at>.*?<\/at>/g, '').trim(); // Strip @mentions
    const userName = activity.from?.name || 'Teams User';
    const conversationId = activity.conversation?.id;
    const serviceUrl = activity.serviceUrl;

    if (!text || !conversationId || !serviceUrl) return;

    // Process through universal handler
    const response = await handleMessage(userId, text, {
      userName,
      platform: 'msteams',
      conversationId,
    });

    // Send response back to Teams
    await sendTeamsMessage(serviceUrl, conversationId, activity.id, response.text);

  } catch (err) {
    console.error('[Teams] Message error:', err);
  }
});

// ─── Send reply to Teams ─────────────────────────────────────
async function sendTeamsMessage(serviceUrl, conversationId, replyToId, text) {
  const token = await getAccessToken();
  if (!token) {
    console.error('[Teams] No access token — set TEAMS_APP_ID and TEAMS_APP_PASSWORD');
    return;
  }

  const url = `${serviceUrl.replace(/\/+$/, '')}/v3/conversations/${conversationId}/activities/${replyToId}`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: 'message',
        text,
        textFormat: 'markdown',
      }),
    });
  } catch (err) {
    console.error('[Teams] Send error:', err.message);
  }
}

module.exports = router;
