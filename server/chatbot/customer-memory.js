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

// ─── ScanGym ID: full chat log + identity (items 23/24, 2026-09-28) ───
/** Store both sides of one exchange in chat_messages (all chatbots, one key). */
async function logExchange(key, { text, reply, platform }, deps) {
  if (!key || (!text && !reply)) return;
  try {
    const rows = [];
    if (text) rows.push(['user', String(text).slice(0, 4000)]);
    if (reply) rows.push(['assistant', String(reply).slice(0, 4000)]);
    const vals = rows.map((_, i) => `($1, $2, $${i * 2 + 3}, $${i * 2 + 4})`).join(', ');
    await db(deps).query(`INSERT INTO chat_messages (memory_key, platform, role, text) VALUES ${vals}`,
      [key, platform || null, ...rows.flat()]);
  } catch (e) {
    if (e.message !== 'no DATABASE_URL') console.error('[Memory] log failed:', e.message);
  }
}

/** Last n messages for this customer from every chatbot, oldest first. */
async function recentMessages(key, n = 16, deps) {
  try {
    const { rows } = await db(deps).query(
      'SELECT role, text, platform FROM chat_messages WHERE memory_key = $1 ORDER BY id DESC LIMIT $2', [key, n]);
    return rows.reverse();
  } catch (e) {
    if (e.message !== 'no DATABASE_URL') console.error('[Memory] recent failed:', e.message);
    return [];
  }
}

/** Name, email, mobile and saved card label (never the number) for a linked customer. */
async function loadIdentity(customer, deps) {
  if (!customer) return null;
  const out = { name: customer.firstName || null, email: customer.email || null };
  try {
    const { rows } = await db(deps).query(
      'SELECT first_name, last_name, email, phone_number, stripe_customer_id FROM public.users WHERE id::text = $1 LIMIT 1',
      [String(customer.userId)]);
    const u = rows[0];
    if (u) {
      out.name = [u.first_name, u.last_name].filter(Boolean).join(' ') || out.name;
      out.email = u.email || out.email;
      out.mobile = u.phone_number || null;
      if (u.stripe_customer_id) out.card = await cardLabel(u.stripe_customer_id, deps);
    }
    const c = await db(deps).query(
      'SELECT COUNT(*)::int AS n, ARRAY_AGG(DISTINCT platform) AS via FROM chat_messages WHERE memory_key = $1',
      [memoryKey(null, customer)]);
    if (c.rows[0]) { out.messages = c.rows[0].n || 0; out.via = (c.rows[0].via || []).filter(Boolean); }
  } catch (e) {
    if (e.message !== 'no DATABASE_URL') console.error('[Memory] identity failed:', e.message);
  }
  return out;
}

async function cardLabel(stripeCustomerId, deps) {
  try {
    if (deps && deps.cardLabel) return await deps.cardLabel(stripeCustomerId);
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    const stripe = require('stripe')(key);
    const m = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: 'card', limit: 1 });
    const card = m.data[0] && m.data[0].card;
    return card ? `${String(card.brand || 'card').toUpperCase()} ••${card.last4}` : null;
  } catch (e) { return null; }
}

const mask = {
  email: (e) => String(e).replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2'),
  mobile: (m) => '••••' + String(m).replace(/\D/g, '').slice(-4),
};

/** Fold one exchange into the stored memory (pure — easy to test). */
function remember(mem, { text, reply, platform, create, city, prefs }) {
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
  if (prefs) out.createPrefs = prefs;
  out.profile = learnProfile(mem.profile, { text, city, create, prefs });
  out.sinceSummary = (mem.sinceSummary || 0) + 1;
  return out;
}

// ─── Personality (ScanGym ID part 2, 2026-09-28) ───────────────
/* Learned by simple rules, no AI cost: cities, favourite models/shapes,
   reply style, language, and anything said with "remember that …". */
const LANGS = { english: 'English', hindi: 'Hindi', urdu: 'Urdu', arabic: 'Arabic', spanish: 'Spanish', french: 'French', german: 'German', polish: 'Polish', portuguese: 'Portuguese', italian: 'Italian', punjabi: 'Punjabi', gujarati: 'Gujarati', bengali: 'Bengali' };
const NOTE_RE = /^\s*(?:please\s+)?remember(?:\s+that)?\s+(.{3,200})$/i;
function bump(map, key) {
  if (!key) return map;
  const m = { ...(map || {}) };
  m[key] = (m[key] || 0) + 1;
  return m;
}
function top(map, n = 3) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
function learnProfile(profile, { text, city, create, prefs }) {
  const p = { ...(profile || {}) };
  const t = String(text || '');
  if (city) p.cities = bump(p.cities, String(city).slice(0, 60));
  if (create && create.kind) p.kinds = bump(p.kinds, create.kind);
  if (prefs && typeof prefs === 'object') {
    for (const v of Object.values(prefs)) {
      if (v && v.model) p.models = bump(p.models, String(v.model).split('/').pop().slice(0, 40));
      if (v && v.shape) p.shapes = bump(p.shapes, String(v.shape).slice(0, 20));
    }
  }
  if (/\b(short|brief|quick) (replies|answers|messages)\b|\bkeep it short\b/i.test(t)) p.style = 'short';
  else if (/\b(long|detailed|more detail(ed)?) (replies|answers)\b/i.test(t)) p.style = 'detailed';
  const lang = t.match(/\b(?:reply|speak|talk|answer|write)(?: to me)? in (\w+)/i);
  if (lang && LANGS[lang[1].toLowerCase()]) p.language = LANGS[lang[1].toLowerCase()];
  const note = t.match(NOTE_RE);
  if (note && !/\b(my (booking|password|card))\b/i.test(note[1])) {
    p.notes = [...(p.notes || []).filter((x) => x !== note[1]), note[1].trim()].slice(-10);
  }
  return p;
}

/** Short text the AI reads before answering (summary + personality). */
function contextNote(mem) {
  const p = (mem && mem.profile) || {};
  const bits = [];
  if (mem && mem.summary) bits.push(`Summary so far: ${mem.summary}`);
  if (top(p.cities).length) bits.push(`Usual cities: ${top(p.cities).join(', ')}`);
  if (top(p.kinds).length) bits.push(`Likes creating: ${top(p.kinds).join(', ')}`);
  if (top(p.models).length) bits.push(`Favourite models: ${top(p.models).join(', ')}`);
  if (p.style) bits.push(`Wants ${p.style} replies`);
  if (p.language) bits.push(`Reply in ${p.language}`);
  if (p.notes && p.notes.length) bits.push(`Things they asked me to remember: ${p.notes.join('; ')}`);
  return bits.length ? `[What you know about this customer — use it, don't repeat it back] ${bits.join('. ')}.` : '';
}

/** Every ~20 exchanges, fold older chat into a 2-3 sentence summary (cheap model). */
const SUMMARY_EVERY = 20;
async function maybeSummarise(key, mem, deps) {
  if (!key || (mem.sinceSummary || 0) < SUMMARY_EVERY) return null;
  const ai = deps && deps.summarise;
  if (!ai) return null;
  try {
    const recent = await recentMessages(key, 40, deps);
    if (!recent.length) return null;
    const convo = recent.map((m) => `${m.role === 'user' ? 'Customer' : 'Bot'}: ${String(m.text).slice(0, 300)}`).join('\n');
    const prompt = `Summarise what matters about this gym-booking customer in at most 3 short sentences (goals, gyms, times, creations, preferences). No greetings.\nPrevious summary: ${mem.summary || 'none'}\n\n${convo}`;
    const out = await ai(prompt);
    if (!out) return null;
    return String(out).replace(/\s+/g, ' ').trim().slice(0, 600);
  } catch (e) {
    console.error('[Memory] summary failed:', e.message);
    return null;
  }
}

/** "forget X": drop matching notes, cities, models; "forget everything" is handled as delete. */
function forget(mem, what) {
  const w = String(what || '').toLowerCase().trim();
  const out = { ...mem, profile: { ...(mem.profile || {}) } };
  const p = out.profile;
  const hit = (s) => String(s).toLowerCase().includes(w) || w.includes(String(s).toLowerCase());
  let n = 0;
  if (p.notes) { const k = p.notes.filter((x) => !hit(x)); n += p.notes.length - k.length; p.notes = k; }
  for (const f of ['cities', 'models', 'shapes', 'kinds']) {
    if (!p[f]) continue;
    for (const k of Object.keys(p[f])) if (hit(k)) { delete p[f][k]; n++; }
  }
  if (/\b(style|short|long)\b/.test(w) && p.style) { delete p.style; n++; }
  if (/\blanguage\b/.test(w) && p.language) { delete p.language; n++; }
  if (mem.lastCity && hit(mem.lastCity)) { delete out.lastCity; n++; }
  if (mem.lastCreate && hit(mem.lastCreate.prompt)) { delete out.lastCreate; n++; }
  if (n && out.summary && hit(out.summary)) delete out.summary;
  return { mem: out, removed: n };
}

/** GDPR: wipe the shared memory row and every stored message. */
async function deleteMemory(key, deps) {
  try {
    await db(deps).query('DELETE FROM chat_messages WHERE memory_key = $1', [key]);
    await db(deps).query('DELETE FROM chatbot_memory WHERE memory_key = $1', [key]);
    return true;
  } catch (e) {
    if (e.message !== 'no DATABASE_URL') console.error('[Memory] delete failed:', e.message);
    return false;
  }
}

// ─── Customer-facing phrases ────────────────────────────────
/* "Show my shared library" used to become a city search ("Found 20 gyms in My
   Shared Library", email test 2026-09-28): allow shared/saved/whole and a
   bare "library". */
const LIBRARY_RE = /^\s*(?:my\s+)?(?:shared\s+)?library\s*[.!?]*\s*$|\b(my|show( me)?( my)?|open( my)?|see( my)?|check( my)?|view( my)?)\s+(?:(?:shared|saved|whole|full)\s+)?(library|creations?|images?|pictures?|photos? i made|videos?|songs?|music|audios?|voiceovers?)\b/i;
const REMIX_RE = /\b(remix|redo|again|another version|make it again)\b.*\b(last|previous|that)\b|\b(remix|redo) (my|that|it)\b/i;
/* Bug 16 (2026-09-28): only "what do you remember about me" / "my memory"
   matched, so "check shared memory context", "do you remember me" or
   "who am I" fell through to the AI, which invented an answer. */
const MEMORY_RE = /\b(what do you (remember|know)( about me)?|do you (remember|know) me|who am i|(my|shared|show( me)?( my)?|check( my)?|see( my)?|view( my)?|open( my)?)\s+(shared\s+)?memory|memory context|what did i (make|create) last)\b/i;

const DELETE_RE = /^\s*(?:please\s+)?(?:delete|erase|wipe|clear|forget)\s+(?:all\s+(?:of\s+)?)?(?:my\s+)?(?:memory|data|everything|history|chat history|all about me)(?:\s+about me)?\s*[.!?]*\s*$/i;
const FORGET_RE = /^\s*(?:please\s+)?forget\s+(?:that\s+|about\s+)?(.{2,120}?)\s*[.!?]*\s*$/i;

function detectMemoryAsk(text) {
  const t = String(text || '');
  if (DELETE_RE.test(t)) return 'delete';
  const fg = t.match(FORGET_RE);
  if (fg && !/^(it|that|this|about it|him|her|them|the booking|my booking)$/i.test(fg[1].trim())) return 'forget';
  if (NOTE_RE.test(t) && !MEMORY_RE.test(t)) return 'note';
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
    return `${n + 1}. ${icon} ${idea || i.kind}${model}\n   ${require('./safe-link').safeLink(i.url)}`;
  });
  return `📚 *Your library* (newest first, from every chatbot):\n\n${lines.join('\n')}\n\n` +
    `All ${done.length > 5 ? 'of them' : 'creations'}: ${BASE}/creator\n🔁 Say "remix my last" to make a new version.`;
}

function formatMemory(mem, customer, id) {
  const bits = [];
  if (id && id.name) bits.push(`👋 You're ${id.name}.`);
  else if (customer && customer.firstName) bits.push(`👋 You're ${customer.firstName}.`);
  if (id && id.email) bits.push(`📧 ${mask.email(id.email)}`);
  if (id && id.mobile) bits.push(`📱 ${mask.mobile(id.mobile)}`);
  if (id && id.card) bits.push(`💳 Saved card: ${id.card}`);
  if (mem.lastCity) bits.push(`📍 Last city: ${mem.lastCity}`);
  if (mem.lastCreate) bits.push(`🎨 Last creation idea: "${mem.lastCreate.prompt.slice(0, 80)}" (${mem.lastCreate.kind})`);
  const chans = [...new Set([...(mem.channels || []), ...((id && id.via) || [])])];
  if (chans.length) bits.push(`💬 Chatbots used: ${chans.map((c) => PLATFORM_LABEL[c] || c).join(', ')}`);
  if (id && id.messages) bits.push(`🗂️ ${id.messages} messages remembered across all chatbots`);
  const p = mem.profile || {};
  if (top(p.cities).length) bits.push(`🏙️ Usual cities: ${top(p.cities).join(', ')}`);
  if (top(p.models).length) bits.push(`🎨 Favourite models: ${top(p.models).join(', ')}`);
  if (p.style) bits.push(`✍️ You like ${p.style} replies`);
  if (p.language) bits.push(`🌐 Language: ${p.language}`);
  if (p.notes && p.notes.length) bits.push(`📝 You asked me to remember: ${p.notes.join('; ')}`);
  if (mem.summary) bits.push(`🧾 So far: ${mem.summary}`);
  if (!bits.length) bits.push("I don't know much yet — search a gym or create something and I'll remember it.");
  return `🧠 *What I remember:*\n${bits.join('\n')}\n\n🗑️ Say "forget …" to remove something, or "delete my memory" to wipe it all.`;
}

module.exports = {
  resolveCustomer, memoryKey, loadMemory, saveMemory, remember,
  logExchange, recentMessages, loadIdentity,
  learnProfile, contextNote, maybeSummarise, forget, deleteMemory, SUMMARY_EVERY, FORGET_RE, NOTE_RE,
  detectMemoryAsk, kindFromText, linkPrompt, formatLibrary, formatMemory,
  PLATFORM_LABEL, _linkCache: linkCache,
};
