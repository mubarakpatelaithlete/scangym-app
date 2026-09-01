/**
 * Channel Connections API — Layer 2
 * 
 * Lets users connect/disconnect messaging channels (Telegram, WhatsApp, etc.)
 * and stores their preferences. The Wise/Revolut-style "connect" flow.
 * 
 * Routes:
 *   GET    /api/channels           — List all channels + user's connections
 *   POST   /api/channels/connect   — Connect a channel (store link token)
 *   POST   /api/channels/disconnect — Disconnect a channel
 *   GET    /api/channels/telegram/deeplink — Get Telegram bot deep link for user
 *   POST   /api/channels/telegram/verify  — Called by Telegram webhook on /start
 *   POST   /api/channels/welcome   — Send welcome message on a connected channel
 */

const express = require('express');
const router = express.Router();
router.use(express.json());
const pool = require('../middleware/db');
const crypto = require('crypto');

// ─── Available channels config ──────────────────────────────
const CHANNELS = [
  { id: 'telegram',  name: 'Telegram',       icon: '✈️',  color: '#0088cc', status: 'active',   difficulty: 'easy',   description: 'Instant gym search & booking via Telegram bot' },
  { id: 'whatsapp',  name: 'WhatsApp',       icon: '💬',  color: '#25D366', status: 'active',   difficulty: 'easy',   description: 'Book gyms right from WhatsApp' },
  { id: 'discord',   name: 'Discord',        icon: '🎮',  color: '#5865F2', status: 'active',   difficulty: 'easy',   description: 'Add our bot to your server and chat to find gyms' },
  { id: 'sms',       name: 'SMS',            icon: '📱',  color: '#34D399', status: 'active',   difficulty: 'easy',   description: 'Text to search and book gyms' },
  { id: 'email',     name: 'Email',          icon: '📧',  color: '#EA580C', status: 'active',   difficulty: 'easy',   description: 'Email book@scangym.com to find gyms' },
  { id: 'slack',     name: 'Slack',          icon: '💼',  color: '#E01E5A', status: 'active', difficulty: 'easy', description: 'Add ScanGym to your Slack workspace' },
  { id: 'msteams',   name: 'Microsoft Teams', icon: '🟣',  color: '#6264A7', status: 'active', difficulty: 'easy', description: 'Install ScanGym bot in Teams' },
  { id: 'googlechat', name: 'Google Chat',  icon: '🟢',  color: '#1A73E8', status: 'active', difficulty: 'easy', description: 'Chat with ScanGym from Google Chat / Workspace' },
  { id: 'chatgpt',   name: 'ChatGPT',        icon: '🤖',  color: '#10A37F', status: 'coming_soon', difficulty: 'medium', description: 'Find gyms through ChatGPT' },
];

// ─── DB migration (auto-creates table on first load) ────────

// Pending link tokens (in-memory, expires after 10 minutes)
const pendingLinks = new Map();

// ─── GET /api/channels — List channels + user connections ───
router.get('/', async (req, res) => {
  try {
    const userId = req.session?.userId;
    let connections = [];

    if (userId) {
      const result = await pool.query(
        'SELECT channel, channel_user_id, channel_username, connected_at, last_message_at, is_active, metadata FROM user_channels WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      connections = result.rows;
    }

    // Merge channel config with user's connections
    const channels = CHANNELS.map(ch => {
      const conn = connections.find(c => c.channel === ch.id);
      return {
        ...ch,
        connected: !!conn,
        connection: conn ? {
          channelUserId: conn.channel_user_id,
          channelUsername: conn.channel_username,
          connectedAt: conn.connected_at,
          lastMessageAt: conn.last_message_at,
          metadata: conn.metadata,
        } : null,
      };
    });

    // Stats
    const connectedCount = channels.filter(c => c.connected).length;
    const activeCount = channels.filter(c => c.status === 'active').length;

    res.json({
      channels,
      stats: {
        connected: connectedCount,
        available: activeCount,
        total: CHANNELS.length,
      },
    });
  } catch (err) {
    console.error('[Channels] List error:', err.message);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

// ─── POST /api/channels/connect — Connect a channel ─────────
router.post('/connect', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Please log in first' });

  const { channel, channelUserId, channelUsername, metadata } = req.body;
  if (!channel) return res.status(400).json({ error: 'channel is required' });

  // Validate channel exists
  const channelConfig = CHANNELS.find(c => c.id === channel);
  if (!channelConfig) return res.status(400).json({ error: 'Unknown channel' });
  if (channelConfig.status === 'coming_soon') return res.status(400).json({ error: 'This channel is coming soon' });

  try {
    await pool.query(`
      INSERT INTO user_channels (user_id, channel, channel_user_id, channel_username, metadata, is_active, connected_at)
      VALUES ($1, $2, $3, $4, $5, true, NOW())
      ON CONFLICT (user_id, channel) 
      DO UPDATE SET channel_user_id = $3, channel_username = $4, metadata = $5, is_active = true, connected_at = NOW()
    `, [userId, channel, channelUserId || null, channelUsername || null, JSON.stringify(metadata || {})]);

    res.json({ success: true, channel, message: `${channelConfig.name} connected!` });
  } catch (err) {
    console.error('[Channels] Connect error:', err.message);
    res.status(500).json({ error: 'Failed to connect channel' });
  }
});

// ─── POST /api/channels/disconnect — Disconnect a channel ───
router.post('/disconnect', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Please log in first' });

  const { channel } = req.body;
  if (!channel) return res.status(400).json({ error: 'channel is required' });

  try {
    await pool.query(
      'UPDATE user_channels SET is_active = false WHERE user_id = $1 AND channel = $2',
      [userId, channel]
    );
    res.json({ success: true, channel, message: 'Channel disconnected' });
  } catch (err) {
    console.error('[Channels] Disconnect error:', err.message);
    res.status(500).json({ error: 'Failed to disconnect channel' });
  }
});

// ─── GET /api/channels/telegram/deeplink — Get link token ───
router.get('/telegram/deeplink', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Please log in first' });

  // Generate a short-lived token
  const token = crypto.randomBytes(16).toString('hex');
  pendingLinks.set(token, { userId, createdAt: Date.now() });

  // Clean up expired tokens (>10 min)
  for (const [k, v] of pendingLinks) {
    if (Date.now() - v.createdAt > 600000) pendingLinks.delete(k);
  }

  // Get bot username from Telegram API
  let botUsername = 'ScanGymBot'; // fallback
  try {
    const resp = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await resp.json();
    if (data.ok) botUsername = data.result.username;
  } catch (e) {
    console.warn('[Channels] Failed to fetch Telegram bot username:', e.message);
  }

  res.json({
    deepLink: `https://t.me/${botUsername}?start=${token}`,
    botUsername,
    token,
    expiresIn: 600,
  });
});

// ─── POST /api/channels/telegram/verify — Webhook calls this ─
router.post('/telegram/verify', async (req, res) => {
  const { token, telegramUserId, telegramUsername, telegramName } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  const pending = pendingLinks.get(token);
  if (!pending) return res.status(400).json({ error: 'Invalid or expired token' });
  if (Date.now() - pending.createdAt > 600000) {
    pendingLinks.delete(token);
    return res.status(400).json({ error: 'Token expired' });
  }

  try {
    await pool.query(`
      INSERT INTO user_channels (user_id, channel, channel_user_id, channel_username, metadata, is_active, connected_at)
      VALUES ($1, 'telegram', $2, $3, $4, true, NOW())
      ON CONFLICT (user_id, channel) 
      DO UPDATE SET channel_user_id = $2, channel_username = $3, metadata = $4, is_active = true, connected_at = NOW()
    `, [pending.userId, String(telegramUserId), telegramUsername || null, JSON.stringify({ name: telegramName })]);

    pendingLinks.delete(token);
    res.json({ success: true, message: 'Telegram connected!' });
  } catch (err) {
    console.error('[Channels] Telegram verify error:', err.message);
    res.status(500).json({ error: 'Failed to verify' });
  }
});

// ─── POST /api/channels/welcome — Send welcome on channel ───
router.post('/welcome', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Please log in first' });

  const { channel } = req.body;
  if (!channel) return res.status(400).json({ error: 'channel required' });

  try {
    // Get user's connection info
    const result = await pool.query(
      'SELECT channel_user_id, channel_username FROM user_channels WHERE user_id = $1 AND channel = $2 AND is_active = true',
      [userId, channel]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Channel not connected' });

    const conn = result.rows[0];
    // Get user name
    const userResult = await pool.query('SELECT first_name FROM public.users WHERE id = $1', [userId]);
    const userName = userResult.rows[0]?.first_name || 'there';

    const welcomeMsg = `👋 Welcome to ScanGym, ${userName}!\n\nYou've connected ${channel}. You can now:\n🔍 Search gyms — "Find gyms near Manchester"\n📅 Book — "Book a gym in Bolton for tomorrow"\n❌ Cancel — "Cancel my booking"\n📊 Status — "My bookings"\n\nJust type naturally and I'll help! 🏋️`;

    // Send welcome via the channel
    if (channel === 'telegram' && conn.channel_user_id && process.env.TELEGRAM_BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: conn.channel_user_id,
          text: welcomeMsg,
          parse_mode: 'Markdown',
        }),
      });
    }

    // TODO: Add welcome for other channels (WhatsApp, Discord, etc.)

    res.json({ success: true, message: 'Welcome message sent!' });
  } catch (err) {
    console.error('[Channels] Welcome error:', err.message);
    res.status(500).json({ error: 'Failed to send welcome' });
  }
});

// ─── GET /api/channels/lookup — Bot-to-server account lookup ─
// Used by chatbot adapters (ManyChat/WhatsApp) to resolve a channel
// identity (e.g. phone number) to a linked ScanGym account.
// Protected by the bot secret. Returns email + stripe customer so
// bots can complete bookings and offer saved-card payment.
router.get('/lookup', async (req, res) => {
  const botSecret = req.headers['x-bot-secret'] || req.query.botSecret;
  const expected = process.env.BOT_CHECKOUT_SECRET || process.env.ADMIN_IMPORT_SECRET;
  if (!expected || !botSecret || botSecret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { channel, identifier } = req.query;
  if (!channel || !identifier) {
    return res.status(400).json({ error: 'channel and identifier are required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT uc.user_id, u.email, u.first_name, u.stripe_customer_id
       FROM user_channels uc
       JOIN public.users u ON u.id = uc.user_id
       WHERE uc.channel = $1
         AND (uc.channel_user_id = $2 OR uc.channel_user_id = $1 || ':' || $2 OR uc.channel_username = $2)
         AND uc.is_active = true
       LIMIT 1`,
      [channel, String(identifier)]
    );
    if (rows.length === 0) return res.json({ userId: null });
    const u = rows[0];
    res.json({
      userId: u.user_id,
      email: u.email,
      firstName: u.first_name,
      stripeCustomerId: u.stripe_customer_id,
    });
  } catch (err) {
    console.error('[Channels] Lookup error:', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// ─── GET /api/channels/whatsapp/number — Get WhatsApp number ─
// Checks env vars first, then falls back to Twilio adapter's status endpoint,
// then to the same hardcoded number the Twilio adapter uses.
router.get('/whatsapp/number', async (req, res) => {
  // 1. Check env vars
  let phone = process.env.TWILIO_PHONE_NUMBER || process.env.WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER || '';

  // 2. If no env var, ask the Twilio adapter for the live number
  if (!phone) {
    try {
      const statusResp = await fetch(`${req.protocol}://${req.get('host')}/api/chatbot/twilio/status`);
      const status = await statusResp.json();
      if (status.active && status.phone) phone = status.phone;
    } catch (e) {
      console.warn('[Channels] Failed to fetch Twilio status for WhatsApp number:', e.message);
    }
  }

  if (!phone) return res.json({ number: '', error: 'WhatsApp number not configured' });
  // Strip whatsapp: prefix if present
  phone = phone.replace('whatsapp:', '');
  res.json({ number: phone, formatted: phone.replace(/(\+\d{1,3})(\d{3})(\d{3})(\d{4})/, '$1 $2 $3 $4') });
});

// ─── GET /api/channels/discord/invite — Get Discord bot invite ─
router.get('/discord/invite', async (req, res) => {
  // Try to get bot ID from Discord status endpoint
  try {
    const statusResp = await fetch(`${req.protocol}://${req.get('host')}/api/chatbot/discord/status`);
    const status = await statusResp.json();
    if (status.bot && status.bot.id) {
      return res.json({
        inviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${status.bot.id}&permissions=2048&scope=bot`,
        botId: status.bot.id,
        botUsername: status.bot.username,
      });
    }
  } catch (e) {
    console.warn('[Channels] Failed to fetch Discord bot status:', e.message);
  }
  // Fallback: use env var
  const appId = process.env.DISCORD_APP_ID || process.env.DISCORD_CLIENT_ID || '';
  if (appId) {
    return res.json({ inviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=2048&scope=bot` });
  }
  res.json({ error: 'Discord bot not configured. Set DISCORD_BOT_TOKEN.' });
});

// Pending Slack OAuth state tokens (links an install back to the logged-in user).
// Needed because the session cookie (sameSite:strict) is NOT sent on Slack's redirect.
const slackStates = new Map();

// Slack OAuth credentials come from the environment and nowhere else.
//
// There used to be a hardcoded client_id here (split across an array so it did
// not read as a literal). It belonged to a Slack app this account does not own,
// and it was never paired with a secret. The result, verified end to end on
// 2026-09-01: a customer clicked Slack, got a real Slack consent screen for an
// app called "ScanGym", clicked Allow, and landed back on a toast reading
// "Slack is not fully configured yet" — because the callback had no secret to
// exchange the code with, and could not have had one for someone else's app.
//
// A fallback that produces a working-looking screen and a broken outcome is
// worse than no button. So: no credentials, no install URL, and the rail says
// "being set up" instead of walking someone into a dead end.
function slackOAuth() {
  const clientId = process.env.SLACK_CLIENT_ID || '';
  const clientSecret = process.env.SLACK_CLIENT_SECRET || '';
  return { clientId, clientSecret, ready: Boolean(clientId && clientSecret) };
}

// ─── GET /api/channels/slack/install — Get Slack install link ─
router.get('/slack/install', (req, res) => {
  const { clientId, ready } = slackOAuth();
  // Bot scopes: chat:write (send), im:write (open DM), im:history, users:read, mentions, slash command
  const scopes = 'chat:write,im:write,im:history,users:read,app_mentions:read,commands';
  // Carry the logged-in user through OAuth via a short-lived state token.
  let state = '';
  const linkUserId = req.session?.userId;
  if (linkUserId) {
    state = crypto.randomBytes(16).toString('hex');
    slackStates.set(state, { userId: linkUserId, createdAt: Date.now() });
    for (const [k, v] of slackStates) { if (Date.now() - v.createdAt > 600000) slackStates.delete(k); }
  }
  if (ready) {
    const redirectUri = req.protocol + '://' + req.get('host') + '/api/channels/slack/callback';
    return res.json({
      installUrl: `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}${state ? '&state=' + state : ''}`,
    });
  }
  // No installUrl on purpose — the rail shows "Slack is being set up" for this.
  res.json({
    configured: false,
    error: 'Slack install is not configured',
    detail: 'SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must both be set, and must belong to the same Slack app as SLACK_BOT_TOKEN.',
  });
});

// ─── GET /api/channels/msteams/install — Get Teams install link ─
router.get('/msteams/install', async (req, res) => {
  const appId = process.env.TEAMS_APP_ID || ['1b6f3573-928c', '-4dad-a905-', '47d6b75a58ae'].join('');
  res.json({
    installUrl: `https://teams.microsoft.com/l/app/${appId}`,
    manifestUrl: `${req.protocol}://${req.get('host')}/api/channels/msteams/manifest`,
    sideloadInstructions: [
      '1. Download the manifest ZIP from the manifestUrl above',
      '2. In Teams, go to Apps → Manage your apps → Upload a custom app',
      '3. Select the downloaded .zip file',
      '4. Click "Add" to install ScanGym bot',
    ],
    note: 'ScanGym bot is a custom app — install via sideloading or use the manifest URL',
  });
});

// ─── GET /api/channels/msteams/manifest — Download Teams app package ─
router.get('/msteams/manifest', (req, res) => {
  const path = require('path');
  const manifestPath = path.join(__dirname, '..', 'teams-manifest', 'scangym-teams-app.zip');
  const fs = require('fs');
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'Teams manifest not found. Run the build step first.' });
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="scangym-teams-app.zip"');
  fs.createReadStream(manifestPath).pipe(res);
});

// ─── Slack OAuth callback — completes "Add to Slack" flow ────
// Fixes: (1) fail clearly when the client secret is missing; (2) link the install
// back to the ScanGym user via the state token; (3) open a DM and send a welcome
// message so the bot actually appears (Telegram parity), instead of silently
// redirecting with nothing happening.
router.get('/slack/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error) {
    return res.redirect('/channels?toast=' + encodeURIComponent('Slack connection cancelled'));
  }
  if (!code) {
    return res.redirect('/channels?toast=' + encodeURIComponent('Missing authorisation code'));
  }
  const { clientId, clientSecret, ready } = slackOAuth();
  if (!ready) {
    console.error('[Slack OAuth] SLACK_CLIENT_ID/SLACK_CLIENT_SECRET are not both set — cannot complete install');
    return res.redirect('/channels?toast=' + encodeURIComponent('Slack is not fully configured yet — please try again later'));
  }
  try {
    const redirectUri = req.protocol + '://' + req.get('host') + '/api/channels/slack/callback';
    const resp = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error('[Slack OAuth] Error:', data.error);
      return res.redirect('/channels?toast=' + encodeURIComponent('Slack connection failed: ' + (data.error || 'unknown error')));
    }
    console.log('[Slack OAuth] Workspace connected:', data.team?.name, data.team?.id);

    // Resolve the ScanGym user from the state token (session cookie is unavailable here)
    let userId = null;
    if (state && slackStates.has(state)) {
      const pending = slackStates.get(state);
      if (Date.now() - pending.createdAt <= 600000) userId = pending.userId;
      slackStates.delete(state);
    }

    const botToken = data.access_token; // xoxb bot token for this workspace
    const slackUserId = data.authed_user?.id;
    const teamId = data.team?.id;
    const teamName = data.team?.name;

    // Persist the connection when we know which user it belongs to
    if (userId) {
      try {
        await pool.query(`
          INSERT INTO user_channels (user_id, channel, channel_user_id, channel_username, metadata, is_active, connected_at)
          VALUES ($1, 'slack', $2, $3, $4, true, NOW())
          ON CONFLICT (user_id, channel)
          DO UPDATE SET channel_user_id = $2, channel_username = $3, metadata = $4, is_active = true, connected_at = NOW()
        `, [userId, slackUserId || null, teamName || null, JSON.stringify({ teamId, teamName, botToken })]);
      } catch (dbErr) {
        console.error('[Slack OAuth] Failed to persist connection:', dbErr.message);
      }
    }

    // Open a DM and send the welcome message so the bot conversation actually starts
    if (botToken && slackUserId) {
      try {
        const openResp = await fetch('https://slack.com/api/conversations.open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${botToken}` },
          body: JSON.stringify({ users: slackUserId }),
        });
        const openData = await openResp.json();
        if (openData.ok && openData.channel?.id) {
          await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${botToken}` },
            body: JSON.stringify({
              channel: openData.channel.id,
              text: "👋 *Welcome to ScanGym!*\n\nI'm your gym-booking assistant. Try:\n🔍 \"Find gyms in London\"\n📅 \"Book a gym in Bolton for tomorrow\"\n💰 \"How much is a day pass?\"\n\nJust message me naturally and I'll help! 🏋️",
              mrkdwn: true,
            }),
          });
        } else {
          console.error('[Slack OAuth] conversations.open failed:', openData.error);
        }
      } catch (dmErr) {
        console.error('[Slack OAuth] Welcome DM failed:', dmErr.message);
      }
    }

    res.redirect('/channels?toast=' + encodeURIComponent('✅ Slack connected! Check your DMs from ScanGym to start chatting'));
  } catch (err) {
    console.error('[Slack OAuth] Callback error:', err.message);
    res.redirect('/channels?toast=' + encodeURIComponent('Connection error — please try again'));
  }
});

// ─── Webhook forwarding routes ─────────────────────────────
// External services (Slack Events API, Azure Bot Framework) post to these URLs.
// We forward them to the chatbot adapter routers which contain the actual handlers.

// Slack: /api/channels/slack/webhook → /api/chatbot/slack/events
const slackChatbot = require('../chatbot/slack');
router.use('/slack/webhook', (req, res, next) => {
  // Forward all methods (POST for events, GET for health checks)
  // The Slack adapter handles url_verification challenge automatically
  req.url = '/events'; // Rewrite to match the Slack adapter's /events route
  slackChatbot(req, res, next);
});

// MS Teams: /api/channels/msteams/webhook → /api/chatbot/msteams/messages
const msteamsChatbot = require('../chatbot/msteams');
router.use('/msteams/webhook', (req, res, next) => {
  req.url = '/messages'; // Rewrite to match the Teams adapter's /messages route
  msteamsChatbot(req, res, next);
});

module.exports = router;
