'use strict';
/**
 * One customer, one memory, one library — whichever chatbot or model they use.
 *
 * Owner request 2026-09-26: customers create lots of things with lots of models
 * from lots of chatbots, so every chatbot must know the same customer.
 *
 *  - WHO (only when meta.verified): a chat is tied to a ScanGym account only through a link the customer
 *    made while signed in (user_channels, Profile → Chatbots), or the verified
 *    sender address on the email channel. Never by an email typed into a chat:
 *    that would let anyone read anyone's library.
 *  - MEMORY: chatbot_memory row keyed `user:<id>` for linked customers (shared
 *    across every chatbot) or the chat id for unlinked ones. Holds recent chat,
 *    last city, last creation, channels used. Survives deploys.
 *  - LIBRARY: every creation from every model is already saved against the
 *    account in squad_video_jobs (ScanSquad Create). "my library" lists it in
 *    any chatbot; "remix my last" reopens the last idea in Create.
 *
 * Everything here fails soft: a database hiccup must never stop a booking.
 */

const BASE = 'https://www.scangym.com';
const HISTORY_KEEP = 12;
const CACHE_MS = 10 * 60 * 1000;

// chat id prefix → user_channels.channel
const CHANNEL_OF = {
  telegram: 'telegram', whatsapp: 'whatsapp', sms: 'sms', discord: 'discord',
  slack: 'slack', teams: 'msteams', googlechat: 'googlechat', tiktok: 'tiktok',
  instagram: 'instagram', messenger: 'messenger', facebook: 'messenger', reddit: 'reddit',
};

const PLATFORM_LABEL = {
  telegram: 'Telegram', whatsapp: 'WhatsApp', sms: 'SMS', discord: 'Discord', slack: 'Slack',
  teams: 'Teams', msteams: 'Teams', googlechat: 'Google Chat', tiktok: 'TikTok', instagram: 'Instagram',
  messenger: 'Messenger', facebook: 'Messenger', email: 'Email', reddit: 'Reddit', web: 'Web chat',
};

const KIND_ICON = { image: '🖼️', video: '🎬', audio: '🎙️', voice: '🎙️', music: '🎵' };

const linkCache = new Map();

function db(deps) {
  if (deps && deps.pool) return deps.pool;
  // Tests and the build (npm test) have no database: stay silent and soft.
  if (!process.env.DATABASE_URL) throw new Error('no DATABASE_URL');
  return require('../middleware/db');
}

function prefixOf(chatId) {
  const m = String(chatId || '').match(/^([a-z]+):(.+)$/i);
  return m ? { prefix: m[1].toLowerCase(), id: m[2] } : null;
}

/** ScanGym account behind this chat, or null. */
async function resolveCustomer(chatId, meta = {}, deps) {
  /* Only chats whose sender is proven by the platform (Telegram secret token,
     Twilio signature, Slack signature, Discord gateway) may act as an account.
     Anyone can POST a fake webhook body naming someone else's chat id, and the
     public /api/chatbot/test endpoint takes a linkedUser straight from the
     body — neither may read a library or spend a card. */
  if (!meta.verified) return null;
  const lu = meta.linkedUser;
  if (lu && (lu.userId || lu.user_id)) {
    return { userId: String(lu.userId || lu.user_id), email: lu.email || null, firstName: lu.firstName || lu.first_name || null };
  }
  const p = prefixOf(chatId);
  if (!p || p.prefix === 'test') return null;

  const cached = linkCache.get(chatId);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.user;

  let user = null;
  try {
    if (p.prefix === 'email') {
      // The email channel replies to the sender address, so a spoofed sender
      // never sees the answer.
      const { rows } = await db(deps).query(
        'SELECT id, email, first_name FROM public.users WHERE LOWER(email) = LOWER($1) LIMIT 1', [p.id]);
      if (rows[0]) user = { userId: String(rows[0].id), email: rows[0].email, firstName: rows[0].first_name };
    } else if (CHANNEL_OF[p.prefix]) {
      const channel = CHANNEL_OF[p.prefix];
      const { rows } = await db(deps).query(
        `SELECT uc.user_id, u.email, u.first_name
           FROM user_channels uc JOIN public.users u ON u.id::text = uc.user_id::text
          WHERE uc.channel = $1 AND uc.is_active = true
            AND (uc.channel_user_id = $2 OR uc.channel_user_id = $1 || ':' || $2)
          LIMIT 1`, [channel, p.id]);
      if (rows[0]) user = { userId: String(rows[0].user_id), email: rows[0].email, firstName: rows[0].first_name };
    }
  } catch (e) {
    if (e.message !== 'no DATABASE_URL') console.error('[Memory] resolve failed:', e.message);
    return null; // do not cache a failure
  }
  linkCache.set(chatId, { ts: Date.now(), user });
  return user;
}

function memoryKey(chatId, customer) {
  return customer ? `user:${customer.userId}` : `chat:${chatId}`;
}

async function loadMemory(key, deps) {
  try {
    const { rows } = await db(deps).query('SELECT data FROM chatbot_memory WHERE memory_key = $1', [key]);
    return (rows[0] && rows[0].data) || {};
  } catch (e) {
    if (e.message !== 'no DATABASE_URL') console.error('[Memory] load failed:', e.message);
    return {};
  }
}

async function saveMemory(key, data, deps) {
  try {
    await db(deps).query(
      `INSERT INTO chatbot_memory (memory_key, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (memory_key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [key, JSON.stringify(data)]);
  } catch (e) {
    if (e.message !== 'no DATABASE_URL') console.error('[Memory] save failed:', e.message);
  }
}

/** Fold one exchange into the stored memory (pure — easy to test). */
function remember(mem, { text, reply, platform, create, city }) {
  const out = { ...mem };
  const history = Array.isArray(mem.history) ? mem.history.slice() : [];
  if (text) history.push({ role: 'user', text: String(text).slice(0, 500), via: platform || null });
  if (reply) history.push({ role: 'assistant', text: String(reply).slice(0, 800) });
  out.history = history.slice(-HISTORY_KEEP);
  const chans = new Set(mem.channels || []);
  if (platform) chans.add(platform);
  out.channels = [...chans];
  if (platform) out.lastChannel = platform;
  if (create) out.lastCreate = { kind: create.kind, prompt: String(create.prompt || '').slice(0, 600), at: new Date().toISOString() };
  if (city) out.lastCity = city;
  return out;
}

// ─── Customer-facing phrases ────────────────────────────────
const LIBRARY_RE = /\b(my|show( me)?( my)?)\s+(library|creations?|images?|pictures?|photos? i made|videos?|songs?|music|audios?|voiceovers?)\b/i;
const REMIX_RE = /\b(remix|redo|again|another version|make it again)\b.*\b(last|previous|that)\b|\b(remix|redo) (my|that|it)\b/i;
const MEMORY_RE = /\b(what do you (remember|know) about me|my memory)\b/i;

function detectMemoryAsk(text) {
  const t = String(text || '');
  if (MEMORY_RE.test(t)) return 'memory';
  if (REMIX_RE.test(t)) return 'remix';
  if (LIBRARY_RE.test(t) && !/\b(bookings?|gyms?)\b/i.test(t)) return 'library';
  return null;
}

function kindFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(images?|pictures?|photos?)\b/.test(t)) return 'image';
  if (/\bvideos?\b/.test(t)) return 'video';
  if (/\b(songs?|music)\b/.test(t)) return 'music';
  if (/\b(audios?|voiceovers?|voice)\b/.test(t)) return 'audio';
  return null;
}

function linkPrompt(platform) {
  const name = PLATFORM_LABEL[platform] || 'this chat';
  return `🔒 Link ${name} to your ScanGym account once and every chatbot will share your library and memory:\n` +
    `👉 ${BASE}/profile → Chatbots → Connect ${name}`;
}

function formatLibrary(items, platform) {
  const done = items.filter((i) => i.url && (!i.status || /done|complete|succe|ready/i.test(i.status)));
  if (!done.length) {
    return `📚 Your library is empty so far.\n\n🎨 Try: "make an image of a gym at sunrise" — everything you create in any chatbot lands here.`;
  }
  const lines = done.slice(0, 5).map((i, n) => {
    const icon = KIND_ICON[i.kind] || '✨';
    const idea = String(i.prompt || '').replace(/\s+/g, ' ').slice(0, 60);
    const model = i.model ? ` · ${String(i.model).split('/').pop()}` : '';
    return `${n + 1}. ${icon} ${idea || i.kind}${model}\n   ${i.url}`;
  });
  return `📚 *Your library* (newest first, from every chatbot):\n\n${lines.join('\n')}\n\n` +
    `All ${done.length > 5 ? 'of them' : 'creations'}: ${BASE}/creator\n🔁 Say "remix my last" to make a new version.`;
}

function formatMemory(mem, customer) {
  const bits = [];
  if (customer && customer.firstName) bits.push(`👋 You're ${customer.firstName}.`);
  if (mem.lastCity) bits.push(`📍 Last city: ${mem.lastCity}`);
  if (mem.lastCreate) bits.push(`🎨 Last creation idea: "${mem.lastCreate.prompt.slice(0, 80)}" (${mem.lastCreate.kind})`);
  if (mem.channels && mem.channels.length) bits.push(`💬 Chatbots used: ${mem.channels.map((c) => PLATFORM_LABEL[c] || c).join(', ')}`);
  if (!bits.length) bits.push("I don't know much yet — search a gym or create something and I'll remember it.");
  return `🧠 *What I remember:*\n${bits.join('\n')}`;
}

module.exports = {
  resolveCustomer, memoryKey, loadMemory, saveMemory, remember,
  detectMemoryAsk, kindFromText, linkPrompt, formatLibrary, formatMemory,
  PLATFORM_LABEL, _linkCache: linkCache,
};
