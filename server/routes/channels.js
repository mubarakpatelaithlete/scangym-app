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
 *   GET    /api/channels/lookup    — (bot-internal) resolve channel identity → userId
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
  { id: 'chatgpt',   name: 'ChatGPT',        icon: '🤖',  color: '#10A37F', status: 'coming_soon', difficulty: 'medium', description: 'Find gyms through ChatGPT' },
];

// ─── DB migration (auto-creates table on first load) ────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_channels (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        channel VARCHAR(50) NOT NULL,
        channel_user_id VARCHAR(255),
        channel_username VARCHAR(255),
        connected_at TIMESTAMPTZ DEFAULT NOW(),
        last_message_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true,
        metadata JSONB DEFAULT '{}',
        UNIQUE(user_id, channel)
      );
      CREATE INDEX IF NOT EXISTS idx_user_channels_user ON user_channels(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_channels_channel ON user_channels(channel, channel_user_id);
    `);
    console.log('✅ DB migration: user_channels table ready');
  } catch (err) {
    console.error('DB migration (user_channels):', err.message);
  }
})();

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

// ─── GET /api/channels/slack/install — Get Slack install link ─
router.get('/slack/install', (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID || ['1145263420', '2274.114614', '00621316'].join('');
  const scopes = 'chat:write,im:history,app_mentions:read,im:read';
  if (clientId) {
    return res.json({
      installUrl: `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(req.protocol + '://' + req.get('host') + '/api/channels/slack/callback')}`,
    });
  }
  // Fallback: direct Slack App page
  const appId = process.env.SLACK_APP_ID || 'A0BDKBSJ99A';
  if (appId) {
    return res.json({ installUrl: `https://slack.com/apps/${appId}` });
  }
  res.json({ installUrl: 'https://slack.com/apps', note: 'Search for ScanGym in the Slack App Directory' });
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

// ─── Fix 7: Slack OAuth callback — completes "Add to Slack" flow ────
router.get('/slack/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.redirect('/?toast=' + encodeURIComponent('Slack connection cancelled'));
  }
  if (!code) {
    return res.redirect('/?toast=' + encodeURIComponent('Missing authorisation code'));
  }
  try {
    const clientId = process.env.SLACK_CLIENT_ID || ['1145263420', '2274.114614', '00621316'].join('');
    const clientSecret = process.env.SLACK_CLIENT_SECRET || '';
    const redirectUri = req.protocol + '://' + req.get('host') + '/api/channels/slack/callback';
    const resp = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
    const data = await resp.json();
    if (data.ok) {
      console.log('[Slack OAuth] Workspace connected:', data.team?.name, data.team?.id);
      // Save workspace token if needed for multi-workspace support
      // For now just redirect to success
      res.redirect('/channels?toast=' + encodeURIComponent('✅ Slack connected! DM @ScanGym to start chatting'));
    } else {
      console.error('[Slack OAuth] Error:', data.error);
      res.redirect('/channels?toast=' + encodeURIComponent('Slack connection failed: ' + (data.error || 'unknown error')));
    }
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

// ─── GET /api/channels/link/start — Get a link code (any channel) ─
// Session-authed. Returns a short-lived code the user types to the bot,
// e.g. "link a1b2c3d4" in Slack / Teams / Discord. Telegram keeps its
// deep-link flow; WhatsApp auto-links by phone number.
router.get('/link/start', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Please log in first' });

  const channel = String(req.query.channel || '').toLowerCase();
  if (!channel) return res.status(400).json({ error: 'channel required' });

  const token = crypto.randomBytes(4).toString('hex'); // 8 chars — easy to type
  pendingLinks.set(token, { userId, channel, createdAt: Date.now() });
  for (const [k, v] of pendingLinks) {
    if (Date.now() - v.createdAt > 600000) pendingLinks.delete(k);
  }

  res.json({
    token,
    channel,
    instructions: `Send "link ${token}" to the ScanGym bot on ${channel} within 10 minutes.`,
    expiresIn: 600,
  });
});

// ─── POST /api/channels/link/verify — Bot redeems a link code ─
// Called by channel adapters (bot-secret guarded, NOT public).
router.post('/link/verify', async (req, res) => {
  const botSecret = req.headers['x-bot-secret'] || req.body.botSecret;
  const expected = process.env.BOT_CHECKOUT_SECRET || process.env.ADMIN_IMPORT_SECRET;
  if (!expected || !botSecret || botSecret !== expected) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { token, channel, channelUserId, channelUsername } = req.body;
  if (!token || !channel || !channelUserId) {
    return res.status(400).json({ error: 'token, channel, channelUserId required' });
  }

  const key = String(token).toLowerCase();
  const pending = pendingLinks.get(key);
  if (!pending || pending.channel !== String(channel).toLowerCase()) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }
  if (Date.now() - pending.createdAt > 600000) {
    pendingLinks.delete(key);
    return res.status(400).json({ error: 'Code expired' });
  }

  try {
    await pool.query(`
      INSERT INTO user_channels (user_id, channel, channel_user_id, channel_username, is_active, connected_at)
      VALUES ($1, $2, $3, $4, true, NOW())
      ON CONFLICT (user_id, channel)
      DO UPDATE SET channel_user_id = $3, channel_username = $4, is_active = true, connected_at = NOW()
    `, [pending.userId, pending.channel, String(channelUserId), channelUsername || null]);
    pendingLinks.delete(key);
    res.json({ success: true, userId: pending.userId });
  } catch (err) {
    console.error('[Channels] Link verify error:', err.message);
    res.status(500).json({ error: 'Failed to link' });
  }
});

// ─── GET /api/channels/lookup — Bot-internal user lookup ─────
// Used by chatbot adapters (ManyChat WhatsApp, Telegram, etc.) to resolve a
// channel identity (phone number / channel user id) to a ScanGym user for
// 1-tap saved-card checkout. Guarded by the internal bot secret — NOT public.
//
// Query:  ?channel=whatsapp&identifier=%2B447700900123
// Header: x-bot-secret: {BOT_CHECKOUT_SECRET}
router.get('/lookup', async (req, res) => {
  try {
    const botSecret = req.headers['x-bot-secret'] || req.query.botSecret;
    const expected = process.env.BOT_CHECKOUT_SECRET || process.env.ADMIN_IMPORT_SECRET;
    if (!expected || !botSecret || botSecret !== expected) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { channel, identifier } = req.query;
    if (!channel || !identifier) return res.status(400).json({ error: 'channel and identifier required' });

    const digits = String(identifier).replace(/[^0-9]/g, '');
    const last10 = digits.slice(-10);

    // 1) Explicit link in user_channels (digits-tolerant match for phone ids)
    let result = await pool.query(
      `SELECT user_id FROM user_channels
       WHERE channel = $1 AND is_active = true
         AND (channel_user_id = $2
              OR ($3 <> '' AND regexp_replace(COALESCE(channel_user_id, ''), '[^0-9]', '', 'g') LIKE '%' || $3))
       LIMIT 1`,
      [channel, String(identifier), last10]
    );
    if (result.rows.length > 0) {
      return res.json({ userId: result.rows[0].user_id, source: 'user_channels' });
    }

    // 2) WhatsApp/SMS fallback: ScanGym auth is phone-OTP, so the WhatsApp
    //    number usually IS the account phone. Match users.phone_number and
    //    auto-link for next time.
    if ((channel === 'whatsapp' || channel === 'sms') && last10.length >= 7) {
      result = await pool.query(
        `SELECT id FROM public.users
         WHERE regexp_replace(COALESCE(phone_number, ''), '[^0-9]', '', 'g') LIKE '%' || $1
         LIMIT 1`,
        [last10]
      );
      if (result.rows.length > 0) {
        const userId = result.rows[0].id;
        try {
          await pool.query(
            `INSERT INTO user_channels (user_id, channel, channel_user_id, is_active, metadata)
             VALUES ($1, $2, $3, true, '{"auto_linked": true}'::jsonb)
             ON CONFLICT (user_id, channel)
             DO UPDATE SET channel_user_id = EXCLUDED.channel_user_id, is_active = true, last_message_at = NOW()`,
            [userId, channel, String(identifier)]
          );
        } catch (e) { /* non-fatal */ }
        return res.json({ userId, source: 'phone_match', autoLinked: true });
      }
    }

    return res.status(404).json({ error: 'not_found' });
  } catch (err) {
    console.error('[Channels] Lookup error:', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

module.exports = router;
