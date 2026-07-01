/**
 * Discord Bot Adapter for ScanGym — v3.0 (Telegram-Parity)
 * 
 * FULL FLOW upgrade matching every Telegram bot feature:
 *   ✓ Typing indicator
 *   ✓ Message splitting (2000 char limit)
 *   ✓ Rich Embed messages (gym cards with real prices and open/closed)
 *   ✓ Slash commands (/scangym search, book, help, connect)
 *   ✓ Account linking via OAuth2 deep link
 *   ✓ Markdown conversion
 *   ✓ Auto-reconnect with resume
 *   ✓ Gateway intents
 *   NEW in v3.0:
 *   ✓ ACTUAL gym prices in embeds (no more hardcoded "From £4.49")
 *   ✓ Open/closed status in embeds
 *   ✓ Discord Button components (Book #1, Book #2, Book #3, Show More, Pricing)
 *   ✓ INTERACTION_CREATE handler for button clicks
 *   ✓ Session store for pagination
 *   ✓ Welcome embed on first DM
 *   ✓ Slash responses use embeds (not plain text)
 *   ✓ followUpInteraction splits messages instead of truncating
 *   ✓ /scangym pricing and /scangym creator sub-commands
 *   ✓ Session cleanup (>5000, 30min TTL)
 */

const { handleMessage } = require('./message-handler');

let WS = globalThis.WebSocket;
if (!WS) {
  try { WS = require('ws'); } catch (_) {
    console.error('[Discord] No WebSocket available — install ws package: npm i ws');
  }
}

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_APP_ID = process.env.DISCORD_APP_ID;
const DISCORD_API = 'https://discord.com/api/v10';
const BASE_URL = process.env.BASE_URL || 'https://scangym.com';

// Gateway state
let ws = null;
let heartbeatInterval = null;
let lastSequence = null;
let sessionId = null;
let resumeGatewayUrl = null;
let botUser = null;

// Session store (NEW in v3.0 — matching Telegram)
const sessions = new Map();

// Track known users for welcome message
const knownUsers = new Set();

// ─── Session cleanup (matching Telegram) ─────────────────────
function cleanupSessions() {
  if (sessions.size > 5000) {
    const now = Date.now();
    for (const [k, v] of sessions) {
      if (now - v.lastActive > 1800000) sessions.delete(k);
    }
    console.log(`[Discord] Session cleanup: ${sessions.size} remaining`);
  }
}

// ─── Start Discord Bot ──────────────────────────────────────
function startDiscordBot() {
  if (!DISCORD_TOKEN) {
    console.log('[Discord] No DISCORD_BOT_TOKEN set — skipping Discord bot');
    return;
  }

  console.log('[Discord] Connecting to Discord Gateway...');
  connectGateway('wss://gateway.discord.gg/?v=10&encoding=json');

  setTimeout(() => registerSlashCommands(), 5000);
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
      console.error(`[Discord] Fatal close code ${code} — not reconnecting.`);
    }
  };

  ws.onerror = (err) => {
    console.error('[Discord] WebSocket error:', err.message || 'connection error');
  };
}

// ─── Gateway Message Handler ────────────────────────────────
function handleGatewayMessage(payload) {
  const { op, t, s, d } = payload;
  if (s) lastSequence = s;

  switch (op) {
    case 10: // Hello
      const interval = d.heartbeat_interval;
      startHeartbeat(interval);

      if (sessionId) {
        wsSend({ op: 6, d: { token: DISCORD_TOKEN, session_id: sessionId, seq: lastSequence } });
      } else {
        wsSend({
          op: 2,
          d: {
            token: DISCORD_TOKEN,
            intents: (1 << 9) | (1 << 12) | (1 << 15),
            properties: { os: 'linux', browser: 'scangym', device: 'scangym' },
          },
        });
      }
      break;

    case 11: break; // Heartbeat ACK

    case 0: // Dispatch
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

    case 'INTERACTION_CREATE':
      handleInteraction(data);
      break;
  }
}

// ─── Message Handler ────────────────────────────────────────
async function handleIncomingMessage(msg) {
  if (msg.author.bot) return;

  const isDM = !msg.guild_id;
  const isMentioned = msg.mentions && msg.mentions.some(u => u.id === botUser?.id);
  if (!isDM && !isMentioned) return;

  let text = msg.content;
  if (botUser) {
    text = text.replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '').trim();
  }
  if (!text) text = 'help';

  const userId = `discord:${msg.author.id}`;
  const userName = msg.author.global_name || msg.author.username || 'Discord User';
  const channelId = msg.channel_id;

  console.log(`[Discord] ${isDM ? 'DM' : 'Channel'} from ${userName}: ${text.substring(0, 100)}`);

  // ── Welcome message on first DM (NEW in v3.0 — matching Telegram) ──
  if (isDM && !knownUsers.has(userId)) {
    knownUsers.add(userId);
    await sendWelcomeEmbed(channelId, userName);
    
    // If they just said hi, don't process further
    const greetings = ['hi', 'hello', 'hey', 'hola', 'yo', 'sup', 'help'];
    if (greetings.includes(text.toLowerCase())) return;
  }

  sendTyping(channelId);

  const response = await handleMessage(userId, text, {
    userName,
    platform: 'discord',
    channelId,
  });

  // Send with rich embeds + buttons if gym results
  if (response.data && response.data.gyms && response.data.gyms.length > 0) {
    sessions.set(channelId, {
      gyms: response.data.gyms,
      offset: 5,
      lastActive: Date.now(),
    });
    cleanupSessions();
    await sendGymEmbedWithButtons(channelId, response.data.gyms, 0);
  } else {
    await sendDiscordMessage(channelId, response.text);
  }
}

// ─── Interaction Handler (slash commands + button clicks) ────
async function handleInteraction(interaction) {
  // Handle button clicks (NEW in v3.0)
  if (interaction.type === 3) { // MESSAGE_COMPONENT
    await handleButtonClick(interaction);
    return;
  }

  if (interaction.type !== 2) return; // APPLICATION_COMMAND

  const userId = `discord:${interaction.member?.user?.id || interaction.user?.id}`;
  const userName = interaction.member?.user?.global_name || interaction.user?.global_name || 'Discord User';
  const channelId = interaction.channel_id;

  const options = interaction.data?.options || [];
  let text = '';

  switch (interaction.data?.name) {
    case 'scangym':
      const subCmd = options[0]?.name;
      if (subCmd === 'search') {
        text = options[0]?.options?.[0]?.value || 'help';
      } else if (subCmd === 'book') {
        text = `book ${options[0]?.options?.[0]?.value || ''}`;
      } else if (subCmd === 'help') {
        text = 'help';
      } else if (subCmd === 'pricing') {
        // NEW in v3.0
        text = 'pricing';
      } else if (subCmd === 'creator') {
        // NEW in v3.0
        text = 'How to become a creator';
      } else if (subCmd === 'connect') {
        const token = options[0]?.options?.[0]?.value;
        if (token) {
          try {
            const verifyResp = await fetch(`${BASE_URL}/api/channels/discord/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, discordUserId: userId.replace('discord:', ''), discordUsername: userName }),
            });
            const data = await verifyResp.json();
            const replyText = data.success
              ? '✅ **Connected!** Your ScanGym account is linked. Try `/scangym search Manchester`'
              : '❌ Invalid or expired token. Go to scangym.com/channels to get a new link.';
            await respondToInteraction(interaction, replyText, true);
          } catch (e) {
            await respondToInteraction(interaction, '❌ Connection failed. Please try again.', true);
          }
          return;
        }
        text = 'help';
      } else {
        text = options[0]?.value || 'help';
      }
      break;
    default:
      text = 'help';
  }

  // Acknowledge with "thinking"
  await respondToInteraction(interaction, null, false, true);

  // Process
  const response = await handleMessage(userId, text, { userName, platform: 'discord', channelId });

  // Follow up with result — using embeds for gym results (IMPROVED in v3.0)
  if (response.data?.gyms?.length > 0) {
    sessions.set(channelId, {
      gyms: response.data.gyms,
      offset: 5,
      lastActive: Date.now(),
    });
    await followUpWithGymEmbed(interaction, response.data.gyms, 0);
  } else if (text === 'help') {
    await followUpWithWelcomeEmbed(interaction, userName);
  } else {
    await followUpInteraction(interaction, response.text);
  }
}

// ─── Handle Button Clicks (NEW in v3.0) ─────────────────────
async function handleButtonClick(interaction) {
  const customId = interaction.data?.custom_id;
  const userId = `discord:${interaction.member?.user?.id || interaction.user?.id}`;
  const userName = interaction.member?.user?.global_name || interaction.user?.global_name || 'Discord User';
  const channelId = interaction.channel_id;

  if (!customId) return;

  // Acknowledge the button click
  await respondToInteraction(interaction, null, false, true);

  if (customId.startsWith('book_')) {
    const gymIdx = parseInt(customId.split('_')[1]) - 1;
    const session = sessions.get(channelId);
    if (session && session.gyms && session.gyms[gymIdx]) {
      const response = await handleMessage(userId, `Book gym ${gymIdx + 1} for tomorrow`, {
        userName, platform: 'discord', channelId,
      });
      await followUpInteraction(interaction, response.text);
    } else {
      await followUpInteraction(interaction, '❌ Gym not found. Try searching again!');
    }
  } else if (customId === 'show_more') {
    const session = sessions.get(channelId);
    if (session && session.gyms && session.offset < session.gyms.length) {
      const offset = session.offset;
      session.offset += 5;
      session.lastActive = Date.now();
      await followUpWithGymEmbed(interaction, session.gyms, offset);
    } else {
      await followUpInteraction(interaction, "That's all the gyms I found! 🏋️ Try searching another city.");
    }
  } else if (customId === 'new_search') {
    await followUpInteraction(interaction, '📍 Which city would you like to search?\n\nJust type a city name like "London" or "New York"');
  } else if (customId === 'pricing') {
    const response = await handleMessage(userId, 'pricing', { platform: 'discord' });
    await followUpInteraction(interaction, response.text);
  } else if (customId === 'creator') {
    const response = await handleMessage(userId, 'How to become a creator', { platform: 'discord' });
    await followUpInteraction(interaction, response.text);
  }
}

// ─── Register Slash Commands (UPGRADED — pricing + creator) ──
async function registerSlashCommands() {
  if (!DISCORD_TOKEN || !DISCORD_APP_ID) return;

  const commands = [{
    name: 'scangym',
    description: 'Find and book gyms worldwide — day passes from £4.49',
    options: [
      {
        name: 'search',
        description: 'Search for gyms near a location',
        type: 1,
        options: [{ name: 'location', description: 'City or area (e.g. Manchester)', type: 3, required: true }],
      },
      {
        name: 'book',
        description: 'Book a gym session',
        type: 1,
        options: [{ name: 'gym', description: 'Gym name or location', type: 3, required: true }],
      },
      {
        name: 'pricing',
        description: 'View day pass pricing by country',
        type: 1,
      },
      {
        name: 'creator',
        description: 'Learn about the Creator programme — earn 30% commission',
        type: 1,
      },
      {
        name: 'connect',
        description: 'Link your ScanGym account',
        type: 1,
        options: [{ name: 'token', description: 'Your connect token from scangym.com/channels', type: 3, required: true }],
      },
      { name: 'help', description: 'Show help and available commands', type: 1 },
    ],
  }];

  try {
    const resp = await fetch(`${DISCORD_API}/applications/${DISCORD_APP_ID}/commands`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (resp.ok) {
      console.log('[Discord] Slash commands registered (v3.0 — with pricing & creator)');
    } else {
      console.error('[Discord] Slash command registration failed:', await resp.text());
    }
  } catch (e) {
    console.error('[Discord] Slash command error:', e.message);
  }
}

// ─── Build Gym Embed with ACTUAL prices (FIXED in v3.0) ─────
function buildGymEmbed(gyms, offset) {
  const count = Math.min(5, gyms.length - offset);
  const showing = gyms.slice(offset, offset + count);

  const fields = [];
  for (let i = 0; i < showing.length; i++) {
    const g = showing[i];
    const idx = offset + i + 1;
    const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
    const rating = g.rating ? ` · ⭐ ${g.rating}` : '';
    const open = g.openNow === true ? ' · ✅ Open' : g.openNow === false ? ' · 🔴 Closed' : '';
    const is24h = g.is24h ? ' · 🕐 24/7' : '';
    const distance = g.distanceText || g.distance || '';
    const topPick = (idx === 1 && offset === 0) ? '\n→ ⭐ **Top pick!**' : '';

    fields.push({
      name: `${idx}. ${g.name || 'Gym'}`,
      value: `📍 ${g.address || 'N/A'}${distance ? ` · ${distance}` : ''}\n💰 **${price}/day**${rating}${open}${is24h}${topPick}`,
      inline: false,
    });
  }

  return {
    title: `🏋️ Found ${gyms.length} Gyms`,
    description: `Showing ${offset + 1}–${offset + count} of ${gyms.length}. [Browse all on ScanGym](${BASE_URL}/search)`,
    color: 0xFF6D00, // ScanGym orange
    fields,
    footer: { text: 'ScanGym — Universal Gym Day Pass · No membership needed' },
    timestamp: new Date().toISOString(),
  };
}

// ─── Build button components for gym results (NEW in v3.0) ──
function buildGymButtons(gyms, offset) {
  const count = Math.min(5, gyms.length - offset);
  const showing = gyms.slice(offset, offset + count);
  const components = [];

  // Row 1: Book buttons for top 3 gyms
  const bookRow = [];
  for (let i = 0; i < Math.min(3, showing.length); i++) {
    const idx = offset + i + 1;
    const gymName = (showing[i].name || 'Gym').substring(0, 30);
    bookRow.push({
      type: 2, // Button
      style: 3, // Success (green)
      label: `📅 Book #${idx}`,
      custom_id: `book_${idx}`,
    });
  }
  if (bookRow.length > 0) {
    components.push({ type: 1, components: bookRow }); // Action Row
  }

  // Row 2: Show More + New Search + Pricing
  const navRow = [];
  if (offset + count < gyms.length) {
    navRow.push({
      type: 2,
      style: 1, // Primary (blue)
      label: `📋 Show More (${gyms.length - offset - count} left)`,
      custom_id: 'show_more',
    });
  }
  navRow.push({
    type: 2,
    style: 2, // Secondary (grey)
    label: '🔍 New Search',
    custom_id: 'new_search',
  });
  navRow.push({
    type: 2,
    style: 2,
    label: '💰 Pricing',
    custom_id: 'pricing',
  });
  navRow.push({
    type: 2,
    style: 5, // Link
    label: '🌐 ScanGym.com',
    url: `${BASE_URL}/search`,
  });
  components.push({ type: 1, components: navRow });

  return components;
}

// ─── Build Welcome Embed (NEW in v3.0) ──────────────────────
function buildWelcomeEmbed(userName) {
  return {
    title: '🏋️ ScanGym — The Uber for Gyms',
    description: `Hey ${userName}! Skip the membership. Book a day pass at any gym, anywhere.\n\n**1.2M+ gyms** · **190+ countries** · **From £4.49/day** · **QR code entry**`,
    color: 0xFF6D00,
    fields: [
      {
        name: '🔍 Find Gyms',
        value: 'Type a city: "Manchester" or use `/scangym search London`',
        inline: true,
      },
      {
        name: '📅 Book',
        value: '"Book gym 1 for tomorrow"',
        inline: true,
      },
      {
        name: '💰 Pricing',
        value: 'Type "pricing" or `/scangym pricing`',
        inline: true,
      },
      {
        name: '💳 Earn Money',
        value: 'Type "creator" — earn 30% commission',
        inline: true,
      },
      {
        name: '❌ Cancel',
        value: '"Cancel 5WCB-8VDY"',
        inline: true,
      },
      {
        name: '📍 Location',
        value: 'DM me any city name!',
        inline: true,
      },
    ],
    footer: { text: 'ScanGym · No membership, no contract, just gym.' },
    timestamp: new Date().toISOString(),
  };
}

// ─── Build welcome button components ─────────────────────────
function buildWelcomeButtons() {
  return [{
    type: 1,
    components: [
      { type: 2, style: 1, label: '🔍 Find Gyms', custom_id: 'new_search' },
      { type: 2, style: 2, label: '💰 Pricing', custom_id: 'pricing' },
      { type: 2, style: 2, label: '💳 Earn Money', custom_id: 'creator' },
      { type: 2, style: 5, label: '🌐 ScanGym.com', url: BASE_URL },
    ],
  }];
}

// ─── Send methods ────────────────────────────────────────────

async function sendWelcomeEmbed(channelId, userName) {
  if (!DISCORD_TOKEN) return;
  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [buildWelcomeEmbed(userName)],
        components: buildWelcomeButtons(),
      }),
    });
  } catch (err) {
    console.error('[Discord] Welcome embed error:', err.message);
  }
}

async function sendGymEmbedWithButtons(channelId, gyms, offset) {
  if (!DISCORD_TOKEN) return;
  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [buildGymEmbed(gyms, offset)],
        components: buildGymButtons(gyms, offset),
      }),
    });
  } catch (err) {
    console.error('[Discord] Gym embed error:', err.message);
    // Fallback to plain text
    const { formatGymList } = require('./message-handler');
    await sendDiscordMessage(channelId, `Found ${gyms.length} gyms — check them out on scangym.com`);
  }
}

async function sendDiscordMessage(channelId, text) {
  if (!DISCORD_TOKEN) return;
  const chunks = splitMessage(text, 1900);

  for (const chunk of chunks) {
    const formatted = chunk.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '**$1**');
    try {
      const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: formatted }),
      });
      if (!resp.ok) console.error(`[Discord] Send failed (${resp.status}):`, await resp.text());
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

async function respondToInteraction(interaction, content, ephemeral, deferred) {
  try {
    const data = deferred
      ? { type: 5, data: { flags: 64 } }
      : { type: 4, data: { content, flags: ephemeral ? 64 : 0 } };

    await fetch(`${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error('[Discord] Interaction respond error:', e.message);
  }
}

// FIXED in v3.0: Split messages instead of truncating
async function followUpInteraction(interaction, content) {
  try {
    const formatted = content.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '**$1**');
    const chunks = splitMessage(formatted, 1900);

    for (const chunk of chunks) {
      await fetch(`${DISCORD_API}/webhooks/${DISCORD_APP_ID}/${interaction.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunk }),
      });
    }
  } catch (e) {
    console.error('[Discord] Interaction follow-up error:', e.message);
  }
}

async function followUpWithGymEmbed(interaction, gyms, offset) {
  try {
    await fetch(`${DISCORD_API}/webhooks/${DISCORD_APP_ID}/${interaction.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [buildGymEmbed(gyms, offset)],
        components: buildGymButtons(gyms, offset),
      }),
    });
  } catch (e) {
    console.error('[Discord] Gym embed follow-up error:', e.message);
  }
}

async function followUpWithWelcomeEmbed(interaction, userName) {
  try {
    await fetch(`${DISCORD_API}/webhooks/${DISCORD_APP_ID}/${interaction.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [buildWelcomeEmbed(userName)],
        components: buildWelcomeButtons(),
      }),
    });
  } catch (e) {
    console.error('[Discord] Welcome embed follow-up error:', e.message);
  }
}

// ─── Utility ─────────────────────────────────────────────────

function wsSend(data) {
  if (ws && ws.readyState === WS.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function startHeartbeat(intervalMs) {
  clearInterval(heartbeatInterval);
  setTimeout(() => wsSend({ op: 1, d: lastSequence }), Math.random() * intervalMs);
  heartbeatInterval = setInterval(() => wsSend({ op: 1, d: lastSequence }), intervalMs);
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trim();
  }
  return chunks;
}

// ─── Express routes ─────────────────────────────────────────
const express = require('express');
const router = express.Router();

router.get('/status', (req, res) => {
  res.json({
    connected: ws?.readyState === WS.OPEN,
    bot: botUser ? { username: botUser.username, id: botUser.id } : null,
    sessionId: sessionId ? '(active)' : null,
    slashCommands: !!DISCORD_APP_ID,
    activeSessions: sessions.size,
    knownUsers: knownUsers.size,
    version: '3.0',
  });
});

router.get('/invite', (req, res) => {
  const appId = DISCORD_APP_ID || botUser?.id;
  if (!appId) {
    return res.json({ error: 'Bot not connected yet. Set DISCORD_BOT_TOKEN env var.' });
  }
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=2048&scope=bot+applications.commands`;
  res.json({ inviteUrl, instructions: 'Open this URL to add ScanGym bot to your Discord server' });
});

router.post('/connect', async (req, res) => {
  const { token, discordUserId, discordUsername } = req.body;
  if (!token || !discordUserId) {
    return res.status(400).json({ error: 'token and discordUserId required' });
  }

  try {
    const verifyResp = await fetch(`${BASE_URL}/api/channels/discord/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, discordUserId, discordUsername }),
    });
    const data = await verifyResp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, startDiscordBot };
