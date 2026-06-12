/**
 * Discord Bot Adapter for ScanGym
 * 
 * Thin wrapper that connects to Discord via Gateway (WebSocket),
 * listens for messages, and passes them to the universal message-handler.
 * 
 * Architecture: Same "one kitchen, many doors" pattern as Telegram/Twilio.
 *   Discord message → This adapter → message-handler.js → ScanGym API → Reply
 * 
 * Setup:
 *   1. Go to https://discord.com/developers/applications → New Application
 *   2. Go to Bot tab → Create Bot → Copy token
 *   3. Set env: DISCORD_BOT_TOKEN=your_token
 *   4. Invite bot to your server with this URL:
 *      https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=2048&scope=bot
 *      (permission 2048 = Send Messages)
 *   5. Bot auto-connects on server start — no webhook needed!
 * 
 * Users DM the bot or mention it in a channel to search/book gyms.
 * Zero dependencies — uses built-in WebSocket + fetch.
 */

const { handleMessage } = require('./message-handler');

// Use built-in WebSocket (Node 22+) — zero dependencies
// Falls back to 'ws' package if somehow not available
const WS = globalThis.WebSocket;

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_API = 'https://discord.com/api/v10';

// Gateway state
let ws = null;
let heartbeatInterval = null;
let lastSequence = null;
let sessionId = null;
let resumeGatewayUrl = null;
let botUser = null;

// ─── Start Discord Bot ──────────────────────────────────────
function startDiscordBot() {
  if (!DISCORD_TOKEN) {
    console.log('[Discord] No DISCORD_BOT_TOKEN set — skipping Discord bot');
    return;
  }

  console.log('[Discord] Connecting to Discord Gateway...');
  connectGateway('wss://gateway.discord.gg/?v=10&encoding=json');
}

function connectGateway(url) {
  ws = new WS(url);

  ws.onopen = () => {
    console.log('[Discord] WebSocket connected');
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === 'string' ? event.data : event.data.toString();
    handleGatewayMessage(JSON.parse(data));
  };

  ws.onclose = (event) => {
    const code = event.code;
    console.log(`[Discord] WebSocket closed (code: ${code})`);
    clearInterval(heartbeatInterval);

    // Reconnect after 5 seconds (unless it was a fatal close code)
    const fatalCodes = [4004, 4010, 4011, 4012, 4013, 4014];
    if (!fatalCodes.includes(code)) {
      setTimeout(() => {
        console.log('[Discord] Reconnecting...');
        if (sessionId && resumeGatewayUrl) {
          connectGateway(resumeGatewayUrl);
        } else {
          connectGateway('wss://gateway.discord.gg/?v=10&encoding=json');
        }
      }, 5000);
    } else {
      console.error(`[Discord] Fatal close code ${code} — not reconnecting. Check your bot token.`);
    }
  };

  ws.onerror = (err) => {
    console.error('[Discord] WebSocket error:', err.message || 'connection error');
  };
}

// ─── Gateway Message Handler ────────────────────────────────
function handleGatewayMessage(payload) {
  const { op, t, s, d } = payload;

  // Track sequence number for heartbeats
  if (s) lastSequence = s;

  switch (op) {
    case 10: // Hello — start heartbeating + identify
      const interval = d.heartbeat_interval;
      startHeartbeat(interval);

      if (sessionId) {
        // Resume existing session
        wsSend({ op: 6, d: { token: DISCORD_TOKEN, session_id: sessionId, seq: lastSequence } });
      } else {
        // Fresh identify
        wsSend({
          op: 2,
          d: {
            token: DISCORD_TOKEN,
            intents: (1 << 9) | (1 << 12) | (1 << 15), // GUILD_MESSAGES | MESSAGE_CONTENT | DIRECT_MESSAGES
            properties: { os: 'linux', browser: 'scangym', device: 'scangym' },
          },
        });
      }
      break;

    case 11: // Heartbeat ACK
      break;

    case 0: // Dispatch (events)
      handleDispatch(t, d);
      break;

    case 7: // Reconnect
      console.log('[Discord] Server requested reconnect');
      ws.close();
      break;

    case 9: // Invalid session
      console.log('[Discord] Invalid session, re-identifying...');
      sessionId = null;
      setTimeout(() => {
        wsSend({
          op: 2,
          d: {
            token: DISCORD_TOKEN,
            intents: (1 << 9) | (1 << 12) | (1 << 15),
            properties: { os: 'linux', browser: 'scangym', device: 'scangym' },
          },
        });
      }, 1000 + Math.random() * 4000);
      break;
  }
}

// ─── Dispatch Event Handler ─────────────────────────────────
function handleDispatch(eventName, data) {
  switch (eventName) {
    case 'READY':
      sessionId = data.session_id;
      resumeGatewayUrl = data.resume_gateway_url;
      botUser = data.user;
      console.log(`[Discord] Bot ready as ${data.user.username}#${data.user.discriminator}`);
      break;

    case 'RESUMED':
      console.log('[Discord] Session resumed');
      break;

    case 'MESSAGE_CREATE':
      handleIncomingMessage(data);
      break;
  }
}

// ─── Message Handler ────────────────────────────────────────
async function handleIncomingMessage(msg) {
  // Ignore messages from bots (including ourselves)
  if (msg.author.bot) return;

  const isDM = !msg.guild_id;
  const isMentioned = msg.mentions && msg.mentions.some(u => u.id === botUser?.id);

  // Only respond to DMs or messages that mention the bot
  if (!isDM && !isMentioned) return;

  // Clean up mention from message text
  let text = msg.content;
  if (botUser) {
    text = text.replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '').trim();
  }

  if (!text) {
    text = 'help';
  }

  const userId = `discord:${msg.author.id}`;
  const userName = msg.author.global_name || msg.author.username || 'Discord User';
  const channelId = msg.channel_id;

  console.log(`[Discord] ${isDM ? 'DM' : 'Channel'} from ${userName}: ${text.substring(0, 100)}`);

  // Show typing indicator
  sendTyping(channelId);

  // Process through universal handler
  const response = await handleMessage(userId, text, {
    userName,
    platform: 'discord',
    channelId,
  });

  // Send response back to Discord
  await sendDiscordMessage(channelId, response.text);
}

// ─── Discord API Helpers ────────────────────────────────────

function wsSend(data) {
  if (ws && ws.readyState === WS.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function startHeartbeat(intervalMs) {
  clearInterval(heartbeatInterval);
  // Send first heartbeat after jitter
  setTimeout(() => wsSend({ op: 1, d: lastSequence }), Math.random() * intervalMs);
  heartbeatInterval = setInterval(() => wsSend({ op: 1, d: lastSequence }), intervalMs);
}

async function sendDiscordMessage(channelId, text) {
  if (!DISCORD_TOKEN) return;

  // Discord has 2000 char limit — split if needed
  const chunks = splitMessage(text, 1900);

  for (const chunk of chunks) {
    // Convert markdown bold from *text* to **text** (Discord uses double asterisks)
    const formatted = chunk.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '**$1**');

    try {
      const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${DISCORD_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: formatted }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        console.error(`[Discord] Send failed (${resp.status}):`, err);
      }
    } catch (err) {
      console.error('[Discord] Send error:', err.message);
    }
  }
}

async function sendTyping(channelId) {
  if (!DISCORD_TOKEN) return;
  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/typing`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_TOKEN}` },
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

// ─── Express routes (status + invite link) ──────────────────
const express = require('express');
const router = express.Router();

router.get('/status', (req, res) => {
  res.json({
    connected: ws?.readyState === WS.OPEN,
    bot: botUser ? { username: botUser.username, id: botUser.id } : null,
    sessionId: sessionId ? '(active)' : null,
  });
});

router.get('/invite', (req, res) => {
  if (!botUser) {
    return res.json({ error: 'Bot not connected yet. Set DISCORD_BOT_TOKEN env var.' });
  }
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${botUser.id}&permissions=2048&scope=bot`;
  res.json({ inviteUrl, instructions: 'Open this URL to add ScanGym bot to your Discord server' });
});

// Export both the router and the start function
module.exports = { router, startDiscordBot };
