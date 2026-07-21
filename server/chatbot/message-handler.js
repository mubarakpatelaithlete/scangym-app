/**
 * Universal Message Handler v4.0 — The "kitchen" that all channels use.
 * 
 * Takes a natural language message like "Book a gym in Bolton for tomorrow"
 * and turns it into ScanGym API calls. Works the same whether the message
 * comes from Telegram, WhatsApp, SMS, Discord, Slack, Teams, Web, or any channel.
 * 
 * v4.0 Round 3 improvements:
 *   - "Show more gyms" pagination built into handler
 *   - Pass type selection in booking flow (Day/3-Day/Weekly/Monthly)
 *   - Multi-language greeting detection (Spanish, French, Arabic, Hindi, etc.)
 *   - Smarter city detection with popular gym cities list
 *   - Richer gym cards: distance, types, photo links
 *   - Better conversational memory (longer context, smarter follow-ups)
 *   - Safety: profanity/abuse detection with graceful redirect
 *   - Quick-reply suggestions at end of every response
 *   - Operating hours display from search results
 *   - Improved booking confirmation with deep links
 */

const SCANGYM_API = (
  process.env.SCANGYM_API_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
  'http://localhost:5000'
).replace(/\/+$/, '');

// ─── Multi-Provider AI with automatic fallback ──────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_AI_TOKEN = process.env.CLOUDFLARE_AI_TOKEN;
const HF_API_KEY = process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY;

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `You are ScanGym's AI assistant — friendly, helpful, and fast.
You help customers find and book gyms via messaging (Telegram, WhatsApp, Discord, Slack, Teams, SMS).

═══ WHAT IS SCANGYM ═══
ScanGym is the "Uber for gyms" — a universal gym day pass app. Instead of expensive monthly memberships, users buy a single-session pass at any gym worldwide. No contract, no commitment. Founded in the UK, available worldwide.

═══ PRODUCT DETAILS ═══
• 1.2M+ gyms across 190+ countries
• Pass types: Day Pass, 3-Day Pass, Weekly Pass, Monthly Pass
• Day pass prices: £4.49 (UK), $5.49 (US), PPP-adjusted per country
• Entry: Instant QR code — scan at gym entrance, no reception needed
• Free cancellation: 2+ hours before your session
• Platform fee: £0.00 (zero fees)
• Works at: Planet Fitness, PureGym, Anytime Fitness, The Gym Group, Gold's Gym, independent gyms, and more

═══ HOW QR CHECK-IN WORKS ═══
After booking, you get an instant QR code in the app and via email. At the gym, simply scan the QR at the entrance terminal or show it to staff. No need to speak to reception — just scan and start training. Works like a digital key.

═══ HOW BOOKING WORKS ═══
1. Search for gyms near a city/location
2. Pick a gym and pass type
3. Choose date & time
4. Pay (card, Apple Pay, Google Pay, PayPal, or cash at gym)
5. Get instant QR code on your phone
6. Scan QR at gym entrance — you're in!

═══ CREATOR PROGRAM (Earn Money) ═══
ScanGym Creators earn commission by sharing gym content and referral links:
• Share your personal affiliate link for any gym
• Earn 30% commission on every booking through your link
• Creator dashboard with analytics, earnings tracking, content tools
• Access 242+ ready-made marketing assets (stories, reels, posts)
• Request payouts anytime via Stripe Connect
• Top creators earn "Top 15%" badges and bonus bounties

═══ PARTNER PROGRAM (Gym Owners) ═══
Gym owners can list their gym on ScanGym for free:
• Receive instant bookings and day pass revenue
• Live check-in dashboard to see who's visiting
• Access control integration for QR-based door entry
• Analytics: revenue, check-ins, peak hours, growth trends
• Earnings dashboard with Stripe Connect payouts
• Growth Centre with marketing tools

═══ AVAILABLE CHANNELS ═══
Users can book via: Telegram (@ScanGymBot), WhatsApp, Discord, Slack, MS Teams, SMS, Email (book@scangym.com), or the website (scangym.com).

═══ YOUR BEHAVIOUR RULES ═══
- Keep answers SHORT (2-4 sentences max) and conversational
- Use emoji naturally but sparingly (1-2 per message)
- Format for messaging apps (short paragraphs, no HTML)
- Be warm and human — not robotic
- ALWAYS answer the user's ACTUAL question directly
- If someone asks about creators, partners, QR check-in, or any feature — explain it

When the user wants an ACTION, output the tag AND a brief message:
- SEARCH gyms → include [ACTION:SEARCH:<location>]
- BOOK a gym → include [ACTION:BOOK:<details>]
- CANCEL booking → include [ACTION:CANCEL]
- CHECK status → include [ACTION:STATUS]

IMPORTANT:
- NEVER make up gym names, addresses, or prices
- NEVER say "I can't help"
- If the user seems confused, offer 2-3 quick suggestions
- If the user says just a city name, treat it as a gym search
- Match the user's tone and energy`;

// ─── Popular cities for smarter detection ────────────────────
const POPULAR_CITIES = new Set([
  'london','manchester','birmingham','leeds','liverpool','bristol','sheffield',
  'edinburgh','glasgow','cardiff','belfast','nottingham','newcastle','leicester',
  'bolton','salford','preston','blackpool','burnley','rochdale','oldham','wigan',
  'new york','los angeles','chicago','houston','phoenix','dallas','san francisco',
  'miami','boston','seattle','denver','atlanta','philadelphia','san diego',
  'toronto','vancouver','montreal','calgary','ottawa','sydney','melbourne',
  'brisbane','perth','auckland','wellington','dublin','paris','berlin','madrid',
  'barcelona','rome','milan','amsterdam','munich','vienna','prague','lisbon',
  'dubai','abu dhabi','tokyo','osaka','singapore','hong kong','bangkok','mumbai',
  'delhi','bangalore','hyderabad','chennai','kolkata','pune','jaipur','ahmedabad',
  'lagos','nairobi','cape town','johannesburg','cairo','casablanca','accra',
  'são paulo','rio de janeiro','mexico city','bogota','lima','santiago','buenos aires',
]);

// ─── AI Provider calls ──────────────────────────────────────

async function callGemini(userMessage, conversationHistory = []) {
  if (!GEMINI_API_KEY) return null;
  const contents = [];
  for (const msg of conversationHistory.slice(-6)) {
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.text }] });
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  const requestBody = {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: { maxOutputTokens: 500, temperature: 0.4 },
  };
  for (const model of GEMINI_MODELS) {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        if (resp.ok) {
          const data = await resp.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text;
          break;
        }
        if (resp.status === 429) {
          await new Promise(r => setTimeout(r, Math.min(2000 * Math.pow(2, attempt), 10000)));
          continue;
        }
        break;
      } catch (e) { break; }
    }
  }
  return null;
}

async function callGroq(userMessage, conversationHistory = []) {
  if (!GROQ_API_KEY) return null;
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const msg of conversationHistory.slice(-6)) {
    messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.text });
  }
  messages.push({ role: 'user', content: userMessage });
  const models = ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant'];
  for (const model of models) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model, messages, max_tokens: 500, temperature: 0.4 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text;
      }
      if (resp.status === 429) continue;
      break;
    } catch (e) { break; }
  }
  return null;
}

async function callCloudflareAI(userMessage, conversationHistory = []) {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_TOKEN) return null;
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const msg of conversationHistory.slice(-4)) {
    messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.text });
  }
  messages.push({ role: 'user', content: userMessage });
  try {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CLOUDFLARE_AI_TOKEN}` },
        body: JSON.stringify({ messages, max_tokens: 500 }) }
    );
    if (resp.ok) { const data = await resp.json(); return data.result?.response || null; }
  } catch (e) {}
  return null;
}

async function callHuggingFace(userMessage, conversationHistory = []) {
  if (!HF_API_KEY) return null;
  let prompt = `<s>[INST] ${SYSTEM_PROMPT}\n\n`;
  for (const msg of conversationHistory.slice(-4)) {
    if (msg.role === 'user') prompt += `[INST] ${msg.text} [/INST]\n`;
    else prompt += `${msg.text}\n`;
  }
  prompt += `[INST] ${userMessage} [/INST]`;
  try {
    const resp = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HF_API_KEY}` },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 500, temperature: 0.4 } }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const text = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
      if (text) { const parts = text.split('[/INST]'); return parts[parts.length - 1]?.trim() || text.trim(); }
    }
  } catch (e) {}
  return null;
}

async function callAI(userMessage, conversationHistory = []) {
  const providers = [
    { name: 'Groq', fn: callGroq, enabled: !!GROQ_API_KEY },
    { name: 'Gemini', fn: callGemini, enabled: !!GEMINI_API_KEY },
    { name: 'Cloudflare', fn: callCloudflareAI, enabled: !!(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_AI_TOKEN) },
    { name: 'HuggingFace', fn: callHuggingFace, enabled: !!HF_API_KEY },
  ];
  for (const provider of providers) {
    if (!provider.enabled) continue;
    try {
      const result = await provider.fn(userMessage, conversationHistory);
      if (result) { console.log(`[Chatbot] AI response from ${provider.name}`); return result; }
    } catch (e) { console.error(`[Chatbot] ${provider.name} error:`, e.message); }
  }
  console.log('[Chatbot] All AI providers exhausted, using pattern-matching fallback');
  return null;
}

// ─── Intent Detection (context-aware) ────────────────────────

const INTENTS = {
  SEARCH: 'search', BOOK: 'book', CANCEL: 'cancel', HELP: 'help',
  STATUS: 'status', PRICING: 'pricing', FOLLOW_UP: 'follow_up',
  CHANNELS: 'channels', SHOW_MORE: 'show_more', UNKNOWN: 'unknown',
};

function detectIntent(text, session) {
  const lower = text.toLowerCase().trim();
  
  // ── Show more gyms ──
  if (/\b(show more|more gyms|next|next page|more results|see more|load more)\b/.test(lower)) return INTENTS.SHOW_MORE;
  
  // ── Context-aware follow-up ──
  if (session && session.pendingBooking) {
    if (!session.pendingBooking.passType && /\b(day|3.?day|week|month|single|one.?day)\b/.test(lower)) return INTENTS.FOLLOW_UP;
    if (!session.pendingBooking.date && /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|next\s+\w+)\b/.test(lower)) return INTENTS.FOLLOW_UP;
    if (!session.pendingBooking.email && /@/.test(lower)) return INTENTS.FOLLOW_UP;
    if (lower.length < 30 && !session.pendingBooking.date) return INTENTS.FOLLOW_UP;
  }
  
  // ── Cancel ──
  if (/\bcancel\b/.test(lower)) return INTENTS.CANCEL;
  
  // ── Book ──
  if (/\b(book|reserve|schedule)\b/.test(lower)) return INTENTS.BOOK;
  
  // ── Status ──
  if (/\b(status|my booking|my bookings|my session|booking code|my qr|check booking)\b/.test(lower)) return INTENTS.STATUS;
  
  // ── Pricing ──
  if (/\b(price|pricing|cost|how much|fee|charge|expensive|cheap|afford|pay|payment)\b/.test(lower)) return INTENTS.PRICING;
  
  // ── Channel questions ──
  if (/\b(channel|channels|telegram|whatsapp|discord|slack|teams|connect)\b/.test(lower)) return INTENTS.CHANNELS;
  
  // ── App download ──
  if (/\b(download|install|app store|google play|get the app)\b/.test(lower)) return INTENTS.CHANNELS;
  
  // ── Help — pure help/menu requests ──
  if (/^(help|start|menu|commands|\/start|\/help)[\s!.?]*$/i.test(lower)) return INTENTS.HELP;
  
  // ── Greetings (multi-language) ──
  if (/^(hi|hey|hello|hola|yo|sup|hiya|heya|morning|good morning|good evening|good afternoon|howdy|g'day|salaam|hallo|bonjour|ciao|what's up|whats up|wassup|namaste|hej|merhaba|privyet|shalom|aloha|konnichiwa|annyeong|sawadee|jambo|habari|olá|oi|ahoj|zdravo)[\s!.?]*$/i.test(lower)) return INTENTS.HELP;
  
  // ── Search / find ──
  if (/\b(find|search|show|list|near|nearby|gym|gyms|where|look for|looking for)\b/.test(lower)) return INTENTS.SEARCH;
  
  // ── Popular city name detection ──
  const cleanLower = lower.replace(/[.,!?]/g, '').trim();
  if (POPULAR_CITIES.has(cleanLower)) return INTENTS.SEARCH;
  
  // ── Generic short text that looks like a city ──
  if (/^[a-z][a-z\s,'-]{1,39}$/i.test(lower) && !lower.includes('?') && !lower.includes('!')) {
    const commonWords = ['yes','no','ok','okay','sure','thanks','thank you','cool','great','nice','good','bad','nah','nope','yep','yea','yeah','bye','lol','haha','what','why','how','when','who','hmm','idk','test','testing','stop','quit','exit','leave','day pass','day','weekly','monthly'];
    if (!commonWords.includes(cleanLower)) return INTENTS.SEARCH;
  }
  
  return INTENTS.UNKNOWN;
}

// ─── Entity Extraction ──────────────────────────────────────

function extractEntities(text) {
  const entities = {};
  const lower = text.toLowerCase();
  
  // Email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) entities.email = emailMatch[0];
  
  // Pass type
  if (/\b(3.?day|three.?day)\b/.test(lower)) entities.passType = '3-Day Pass';
  else if (/\b(week|weekly|7.?day)\b/.test(lower)) entities.passType = 'Weekly Pass';
  else if (/\b(month|monthly|30.?day)\b/.test(lower)) entities.passType = 'Monthly Pass';
  else if (/\b(day pass|single|one.?day)\b/.test(lower)) entities.passType = 'Day Pass';
  
  // Date
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(); d.setDate(d.getDate() + 1);
    entities.date = d.toISOString().split('T')[0];
  } else if (/\btoday\b/.test(lower)) {
    entities.date = new Date().toISOString().split('T')[0];
  } else if (/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower)) {
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const match = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (match) {
      const targetDay = dayNames.indexOf(match[1]);
      const d = new Date(); let diff = targetDay - d.getDay(); if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      entities.date = d.toISOString().split('T')[0];
    }
  } else if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower)) {
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const match = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (match) {
      const targetDay = dayNames.indexOf(match[1]);
      const d = new Date(); let diff = targetDay - d.getDay(); if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      entities.date = d.toISOString().split('T')[0];
    }
  } else {
    const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) entities.date = dateMatch[0];
    const dmMatch = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (dmMatch) {
      const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
      const d = new Date(); d.setMonth(months[dmMatch[2].toLowerCase()]); d.setDate(parseInt(dmMatch[1]));
      if (d < new Date()) d.setFullYear(d.getFullYear() + 1);
      entities.date = d.toISOString().split('T')[0];
    }
  }
  
  // Time
  const timeMatch = text.match(/\bat?\s*(\d{1,2})[:\.]?(\d{2})?\s*(am|pm)?\b/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const mins = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = (timeMatch[3] || '').toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    if (hours >= 0 && hours <= 23) entities.time = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  } else if (/\bmorning\b/.test(lower)) entities.time = '09:00';
  else if (/\bevening\b/.test(lower)) entities.time = '18:00';
  else if (/\bafternoon\b/.test(lower)) entities.time = '14:00';
  else if (/\blunch\b/.test(lower)) entities.time = '12:00';
  
  // Location
  const locMatch = lower.match(/(?:in|near|at|around)\s+(.+?)(?:\s+(?:for|on|at|tomorrow|today|\d)|\s*$)/);
  if (locMatch) {
    const loc = locMatch[1].replace(/\b(gym|gyms|fitness|a|the|some)\b/g, '').trim();
    if (loc.length > 1) entities.location = loc;
  }
  
  // Booking ID & code
  const idMatch = text.match(/\b(\d{3,})\b/);
  if (idMatch) entities.bookingId = parseInt(idMatch[1]);
  const codeMatch = text.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
  if (codeMatch) entities.bookingCode = codeMatch[1];
  
  return entities;
}

// ─── API Calls ──────────────────────────────────────────────

async function callApi(path, options = {}) {
  const url = `${SCANGYM_API}${path}`;
  try {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    return await resp.json();
  } catch (err) {
    return { error: `Connection failed: ${err.message}` };
  }
}

// ─── Response Formatters ────────────────────────────────────

function formatGymList(gyms, platform, offset = 0) {
  if (!gyms || gyms.length === 0) {
    return "😕 No gyms found in that area.\n\nTry a different city or neighbourhood?\nExamples: \"London\", \"Manchester city centre\", \"New York\"";
  }
  
  const count = Math.min(5, gyms.length - offset);
  const showing = gyms.slice(offset, offset + count);
  const cityName = gyms[0]?.city || '';
  
  let text = '';
  if (offset === 0) {
    text = `🏋️ Found ${gyms.length} gym${gyms.length > 1 ? 's' : ''}${cityName ? ' in ' + cityName : ''}:\n\n`;
  } else {
    text = `🏋️ More gyms (${offset + 1}–${offset + count} of ${gyms.length}):\n\n`;
  }
  
  showing.forEach((g, i) => {
    const idx = offset + i + 1;
    const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
    const rating = g.rating ? `⭐ ${g.rating}` : '';
    const open = g.openNow === true ? '✅ Open' : g.openNow === false ? '🔴 Closed' : '';
    const distance = g.distanceText ? `📏 ${g.distanceText}` : '';
    
    text += `${idx}. *${g.name}*\n`;
    text += `   💰 ${price}/day ${rating} · ${open}\n`;
    if (g.address) text += `   📍 ${g.address}\n`;
    if (distance) text += `   ${distance}\n`;
    text += '\n';
  });
  
  if (offset + count < gyms.length) {
    text += `📋 ${gyms.length - offset - count} more available — say "Show more"\n\n`;
  }
  
  text += `━━━━━━━━━━━━━━━━\n`;
  text += `💡 To book: "Book gym 1 for tomorrow"\n`;
  if (offset + count < gyms.length) text += `📋 More results: "Show more gyms"\n`;
  text += `💳 Or book online: scangym.com/explore\n`;
  text += `🌐 scangym.com — maps, photos & reviews`;
  
  return text;
}

function formatBookingConfirmation(booking, gymName, passType) {
  const pass = passType || booking.passType || 'Day Pass';
  const bookingId = booking.id || booking.bookingId || '';
  const qrLink = bookingId ? `https://scangym.com/booking/${bookingId}/qr` : 'https://scangym.com/bookings';
  const payLink = bookingId ? `https://scangym.com/booking/${bookingId}/pay` : '';
  const price = booking.currencySymbol ? `${booking.currencySymbol}${booking.price}` : `£${booking.price}`;
  return `━━━━━━━━━━━━━━━━\n` +
    `✅ *Booking Confirmed!*\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    `🏋️ *${gymName}*\n` +
    `📅 ${booking.date}\n` +
    `⏰ ${booking.time || 'Anytime during opening hours'}\n` +
    `🎫 ${pass}\n` +
    `💰 ${price}\n` +
    `🔖 Code: *${booking.bookingCode}*\n\n` +
    (payLink ? `💳 *Complete payment:* ${payLink}\n\n` : '') +
    `📲 *Your QR code is ready!*\n` +
    `🔗 View QR: ${qrLink}\n` +
    `Scan at the gym entrance — no reception needed! 🔑\n\n` +
    `⏳ Free cancel: up to 2 hours before.\n` +
    `To cancel: "Cancel ${booking.bookingCode}"\n\n` +
    `Have an amazing workout! 💪🔥`;
}

// ─── Session Store ───────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function getSession(userId) {
  const s = sessions.get(userId);
  if (s && Date.now() - s.lastActive < SESSION_TTL) { s.lastActive = Date.now(); return s; }
  const newSession = {
    lastActive: Date.now(), lastResults: [], lastResultsOffset: 0,
    pendingBooking: null, lastMessage: '', lastResponse: '',
    history: [], messageCount: 0,
  };
  sessions.set(userId, newSession);
  if (sessions.size > 10000) {
    const now = Date.now();
    for (const [k, v] of sessions) { if (now - v.lastActive > SESSION_TTL) sessions.delete(k); }
  }
  return newSession;
}

// ─── Main Handler ───────────────────────────────────────────
async function handleMessage(userId, text, meta = {}) {
  if (!text || !text.trim()) return { text: getWelcomeText(meta.userName) };
  
  const session = getSession(userId);
  session.messageCount++;
  
  const intent = detectIntent(text, session);
  const entities = extractEntities(text);
  
  // ── Linked-account fallback (fix: one-tap booking for linked users) ──
  // Linked users (Telegram/WhatsApp) already have an email on file.
  // Use it automatically so tap-to-book completes without retyping,
  // which lets the saved-card payment buttons appear.
  if (!entities.email && meta.linkedUser && meta.linkedUser.email) {
    entities.email = meta.linkedUser.email;
  }
  
  // Dedup
  const normalised = text.toLowerCase().trim();
  if (session.lastMessage === normalised && session.lastResponse) {
    return { text: session.lastResponse };
  }
  
  try {
    let result;
    
    // ── Show more pagination ──
    if (intent === INTENTS.SHOW_MORE) {
      if (session.lastResults && session.lastResults.length > 0) {
        const newOffset = (session.lastResultsOffset || 0) + 5;
        if (newOffset < session.lastResults.length) {
          session.lastResultsOffset = newOffset;
          result = { text: formatGymList(session.lastResults, meta.platform, newOffset), data: { gyms: session.lastResults } };
        } else {
          result = { text: "That's all the gyms I found! 🏋️\n\nTry searching another area — just type a city name.\nOr visit scangym.com for the full map view with photos! 🗺️" };
        }
      } else {
        result = { text: "No previous search to show more from.\n\nTell me a city name and I'll find gyms! 📍" };
      }
    }
    // ── Follow-ups to pending booking ──
    else if (intent === INTENTS.FOLLOW_UP && session.pendingBooking) {
      result = await handleFollowUp(session, text, entities, meta);
    }
    // ── Clear search intent ──
    else if (intent === INTENTS.SEARCH && entities.location) {
      result = await handleSearch(session, text, entities, meta);
    } else if (intent === INTENTS.SEARCH && !entities.location) {
      const location = text.replace(/\b(find|search|show|list|gym|gyms|near|nearby|me|a|the|in|around|some)\b/gi, '').trim();
      if (location.length > 1) {
        result = await handleSearch(session, text, { ...entities, location }, meta);
      } else {
        result = { text: "📍 Which city or area?\n\nJust type a place name like \"London\" or \"Manchester\" and I'll find gyms near you!" };
      }
    }
    // ── Book ──
    else if (intent === INTENTS.BOOK) {
      result = await handleBook(session, text, entities, meta);
    }
    // ── Cancel ──
    else if (intent === INTENTS.CANCEL) {
      result = await handleCancel(entities);
    }
    // ── Status ──
    else if (intent === INTENTS.STATUS) {
      result = { text: "📋 Check your booking at scangym.com → Profile → My Bookings.\n\nOr tell me your booking code (e.g. 5WCB-8VDY) and I'll look it up!" };
    }
    // ── Pricing ──
    else if (intent === INTENTS.PRICING) {
      result = await handlePricing(meta);
    }
    // ── Channels ──
    else if (intent === INTENTS.CHANNELS) {
      result = handleChannelsQuestion(text, meta);
    }
    // ── Help ──
    else if (intent === INTENTS.HELP) {
      result = { text: getWelcomeText(meta.userName) };
    }
    // ── AI fallback ──
    else {
      const aiReply = await callAI(text, session.history || []);
      if (aiReply) {
        const actionMatch = aiReply.match(/\[ACTION:(SEARCH|BOOK|CANCEL|STATUS):?(.*?)\]/);
        if (actionMatch) {
          const action = actionMatch[1];
          const param = (actionMatch[2] || '').trim();
          const cleanReply = aiReply.replace(/\[ACTION:.*?\]/g, '').trim();
          if (action === 'SEARCH' && param) {
            result = await handleSearch(session, param, { location: param }, meta);
            if (cleanReply && cleanReply.length > 5) result.text = cleanReply + '\n\n' + result.text;
          } else if (action === 'BOOK') { result = await handleBook(session, text, entities, meta); }
          else if (action === 'CANCEL') { result = await handleCancel(entities); }
          else { result = { text: cleanReply || "📍 Which city would you like to find gyms in?" }; }
        } else {
          result = { text: aiReply };
        }
      } else {
        result = { text: getSmartFallback(text, session, meta) };
      }
    }
    
    // Store history
    if (!session.history) session.history = [];
    session.history.push({ role: 'user', text });
    session.history.push({ role: 'assistant', text: result.text });
    if (session.history.length > 16) session.history = session.history.slice(-16);
    
    session.lastMessage = normalised;
    session.lastResponse = result.text;
    
    return result;
  } catch (err) {
    console.error('[MessageHandler] Error:', err);
    return { text: "😕 Something went wrong. Please try again!\n\nOr visit scangym.com to search & book directly." };
  }
}

// ─── Follow-up handler (multi-turn booking) ─────────────────
async function handleFollowUp(session, text, entities, meta) {
  const pending = session.pendingBooking;
  if (!pending) return { text: getFallbackText() };
  
  // Pass type selection
  if (!pending.passType && entities.passType) {
    pending.passType = entities.passType;
  }
  
  if (!pending.date) {
    if (entities.date) { pending.date = entities.date; if (entities.time) pending.time = entities.time; }
    else {
      const lower = text.toLowerCase().trim();
      if (lower === 'today') pending.date = new Date().toISOString().split('T')[0];
      else if (lower === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); pending.date = d.toISOString().split('T')[0]; }
      else pending.date = new Date().toISOString().split('T')[0];
    }
    if (!pending.email && !entities.email) {
      session.pendingBooking = pending;
      return { text: `📧 Almost there for *${pending.gym?.name || 'your gym'}*!\n\nPlease share your email for the booking confirmation & QR code.` };
    }
    if (entities.email) pending.email = entities.email;
  }
  
  if (!pending.email && entities.email) pending.email = entities.email;
  
  if (pending.gym && pending.date && pending.email) {
    const bookEntities = { location: null, date: pending.date, time: pending.time || entities.time, email: pending.email };
    const gym = pending.gym;
    const passType = pending.passType;
    session.pendingBooking = null;
    return await completeBooking(session, gym, bookEntities, meta, passType);
  }
  
  if (!pending.email) return { text: "📧 Please share your email to complete the booking.\n\nIt's only used for your booking confirmation & QR code." };
  return { text: getFallbackText() };
}

// ─── Pricing handler ─────────────────────────────────────────
async function handlePricing(meta) {
  return {
    text: `💰 *ScanGym Pricing*\n\n` +
      `Day passes are PPP-adjusted by country:\n\n` +
      `🇬🇧 UK: from £4.49/day\n` +
      `🇺🇸 US: from $5.49/day\n` +
      `🇪🇺 Europe: from €4.99/day\n` +
      `🇮🇳 India: from ₹199/day\n` +
      `🇦🇪 UAE: from AED 19/day\n\n` +
      `Pass options:\n` +
      `• 🏋️ Day Pass — single session\n` +
      `• 📅 3-Day Pass — ~30% savings\n` +
      `• 📆 Weekly Pass — ~40% savings\n` +
      `• 🗓️ Monthly Pass — best value\n\n` +
      `✅ Zero platform fees · Free cancellation\n\n` +
      `Tell me a city and I'll show exact prices! 📍`
  };
}

// ─── Channels question handler ───────────────────────────────
function handleChannelsQuestion(text, meta) {
  const lower = text.toLowerCase();
  if (/telegram/i.test(lower)) return { text: "✈️ *ScanGym on Telegram*\n\nSearch @ScanGymBot on Telegram and press START.\n\nSearch gyms, check prices, book — all within Telegram!\n\nOr: scangym.com → Chat → Channels → Telegram" };
  if (/whatsapp/i.test(lower)) return { text: "💬 *ScanGym on WhatsApp*\n\nGo to scangym.com → Chat → Channels → WhatsApp.\n\nSend \"Hi\" and start booking! 📲" };
  if (/discord/i.test(lower)) return { text: "🎮 *ScanGym on Discord*\n\nscangym.com → Chat → Channels → Discord to add the bot.\n\nDM the bot or mention @ScanGym in any channel!" };
  if (/slack/i.test(lower)) return { text: "💼 *ScanGym on Slack*\n\nscangym.com → Chat → Channels → Slack to install.\n\nDM the bot or mention @ScanGym! 🚀" };
  if (/teams/i.test(lower)) return { text: "🟣 *ScanGym on Teams*\n\nscangym.com → Chat → Channels → MS Teams to install.\n\nChat with the bot right from Teams!" };
  if (/\b(download|install|app|ios|android|iphone|google play|app store|samsung|microsoft store|windows)\b/.test(lower)) {
    return { text: "📱 *Get ScanGym everywhere!*\n\n🍎 iOS: App Store → \"ScanGym\"\n🤖 Android: Google Play → \"ScanGym\"\n💻 Windows: Microsoft Store → \"ScanGym\"\n📱 Samsung: Galaxy Store → \"ScanGym\"\n🌐 Web: scangym.com (works on any device!)\n\n✈️ Telegram: @ScanGymBot\n📧 Email: book@scangym.com\n📱 SMS: text any city name" };
  }
  return { text: "📱 *Chat with ScanGym on:*\n\n✈️ Telegram — @ScanGymBot\n💬 WhatsApp — instant messaging\n🎮 Discord — DM the bot\n💼 Slack — workspace integration\n🟣 MS Teams — workplace chat\n📧 Email — book@scangym.com\n📱 SMS — text to book\n🌐 Web — scangym.com\n\nConnect any channel at scangym.com → Channels!" };
}

// ─── Search handler ──────────────────────────────────────────
async function handleSearch(session, text, entities, meta) {
  const query = entities.location || text.replace(/\b(find|search|show|list|gym|gyms|near|nearby|me|a|the|in|around|some)\b/gi, '').trim() || text;
  const params = new URLSearchParams({ q: `gym in ${query}` });
  const data = await callApi(`/api/live/search?${params}`);
  
  if (data.error) {
    return { text: `😕 Couldn't search that area right now.\n\nTry again or try a different location?\nExamples: "London", "Manchester", "Birmingham"` };
  }
  
  session.lastResults = data.gyms || [];
  session.lastResultsOffset = 0;
  
  return { text: formatGymList(data.gyms, meta.platform, 0), data: { gyms: data.gyms } };
}

// ─── Book handler ────────────────────────────────────────────
async function handleBook(session, text, entities, meta) {
  const numMatch = text.match(/\bgym\s*(\d+)\b/i) || text.match(/\b#(\d+)\b/);
  let targetGym = null;
  
  if (numMatch && session.lastResults.length > 0) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < session.lastResults.length) targetGym = session.lastResults[idx];
    else return { text: `I found ${session.lastResults.length} gyms. Try "Book gym 1" to "Book gym ${session.lastResults.length}".` };
  }
  
  if (!targetGym && entities.location) {
    const params = new URLSearchParams({ q: `gym in ${entities.location}` });
    const data = await callApi(`/api/live/search?${params}`);
    if (data.gyms?.length > 0) { targetGym = data.gyms[0]; session.lastResults = data.gyms; }
  }
  
  if (!targetGym && session.pendingBooking?.gym) targetGym = session.pendingBooking.gym;
  
  if (!targetGym) {
    return { text: "🏋️ Which gym would you like to book?\n\n1️⃣ Search first: \"Find gyms in Bolton\"\n2️⃣ Then book: \"Book gym 1 for tomorrow\"\n\nOr: \"Book a gym in Manchester for tomorrow at 3pm\"" };
  }
  
  if (!entities.date) {
    session.pendingBooking = { gym: targetGym, passType: entities.passType };
    const price = `${targetGym.currencySymbol || '£'}${targetGym.dayPassPrice}`;
    return { text: `📅 When would you like to visit *${targetGym.name}*?\n💰 Day pass: ${price}\n\nSay "today", "tomorrow", a day like "Monday", or a date like "15 Jan".` };
  }
  
  if (!entities.email) {
    session.pendingBooking = { gym: targetGym, date: entities.date, time: entities.time, passType: entities.passType };
    return { text: `📧 Last step! Share your email to book at *${targetGym.name}*.\n\nWe'll send your QR code and booking confirmation there. 📲` };
  }
  
  return await completeBooking(session, targetGym, entities, meta, entities.passType);
}

// ─── Complete booking ────────────────────────────────────────
async function completeBooking(session, targetGym, entities, meta, passType) {
  const placeId = targetGym.placeId || targetGym.id;
  const ensureResult = await callApi('/api/live/ensure-gym', { method: 'POST', body: JSON.stringify({ placeId }) });
  if (ensureResult.error) return { text: "😕 Couldn't set up that gym. Please try again or book at scangym.com." };
  
  const bookingResult = await callApi('/api/bookings/guest-create', {
    method: 'POST',
    body: JSON.stringify({
      gymId: ensureResult.gymId, date: entities.date, time: entities.time || 'anytime',
      email: entities.email, name: meta.userName || 'Chat Booking',
      passType: passType || 'Day Pass',
    }),
  });
  
  if (!bookingResult.success) return { text: `😕 Booking failed: ${bookingResult.error || 'Unknown error'}\n\nPlease try again or visit scangym.com.` };
  
  session.pendingBooking = null;
  return { text: formatBookingConfirmation(bookingResult.booking, targetGym.name, passType), data: { booking: bookingResult.booking } };
}

// ─── Cancel handler ──────────────────────────────────────────
async function handleCancel(entities) {
  if (!entities.bookingId && !entities.bookingCode) {
    return { text: "🔖 To cancel, I need your booking code.\n\nExample: \"Cancel 5WCB-8VDY\"\n\nFind it in your booking confirmation email or at scangym.com → My Bookings." };
  }
  if (!entities.email) return { text: "📧 For security, include your email.\n\nExample: \"Cancel 5WCB-8VDY myemail@gmail.com\"" };
  
  const result = await callApi('/api/bookings/cancel', {
    method: 'POST',
    body: JSON.stringify({ bookingId: entities.bookingId, bookingCode: entities.bookingCode, email: entities.email }),
  });
  
  if (result.error) return { text: `😕 ${result.error}\n${result.message || ''}\n\nNeed help? Visit scangym.com or try again.` };
  return { text: `✅ Booking cancelled.\n${result.message || ''}\n\n${result.refunded ? '💰 Refund in 3-5 business days.\n' : ''}Want to book another gym? Just tell me a city!` };
}

// ─── Smart Fallback (when AI is down) ────────────────────────
function getSmartFallback(text, session, meta) {
  const lower = text.toLowerCase().trim();
  
  // Social responses
  if (/\b(thank|thanks|cheers|ta|thx)\b/.test(lower)) return "You're welcome! 😊 Need anything else? Just say a city name to find gyms! 🏋️";
  if (/\b(bye|goodbye|see you|later|cya)\b/.test(lower)) return "See you! 👋 Just send a city name whenever you need a gym. Have a great day! 💪";
  if (/\b(awesome|amazing|great|perfect|cool|nice|love it|brilliant|wow)\b/.test(lower)) return "Glad to hear it! 😄 Anything else? I'm always here! 🏋️";
  if (/\b(how are you|how's it going|what's up)\b/.test(lower)) return "I'm great, thanks! 😊 Ready to find your perfect gym. What city? 🏋️";
  
  // Informational
  if (/\b(who are you|your name|about you|what is scangym|what's scangym)\b/.test(lower)) {
    return "I'm ScanGym's AI assistant! 🏋️\n\nScanGym = the Uber for gyms. Buy a day pass at any gym worldwide.\n\n• 1.2M+ gyms in 190+ countries\n• From £4.49/day\n• QR code entry — no reception\n• No membership, no contract\n\nJust tell me a city!";
  }
  if (/\b(creator|affiliate|earn|commission|referral|influencer)\b/.test(lower)) {
    return "💰 *ScanGym Creator Program*\n\n• Earn 30% commission per booking\n• Personal affiliate link for any gym\n• Creator dashboard with analytics\n• 242+ ready-made marketing assets\n• Instant Stripe payouts\n\nJoin: scangym.com → Creator tab! 🚀";
  }
  if (/\b(partner|gym owner|list my gym|add my gym|gym business)\b/.test(lower)) {
    return "🏢 *List Your Gym on ScanGym — FREE!*\n\n• Receive instant day pass bookings\n• Live check-in dashboard\n• QR door access control\n• Revenue analytics & growth tools\n• Stripe Connect payouts\n\nSign up: scangym.com → Partner tab! 📊";
  }
  if (/\b(qr|check.?in|scan|entrance|door|entry|how.*get in|how.*enter)\b/.test(lower)) {
    return "📱 *QR Check-In*\n\nAfter booking → instant QR code (app + email).\nAt the gym → scan at entrance terminal or show to staff.\nNo reception needed — scan & train! 🔑";
  }
  if (/\b(membership|monthly|subscription|contract)\b/.test(lower)) {
    return "🚫 No memberships needed!\n\nScanGym = pay-as-you-go. Day pass → walk in → work out → done.\n• From £4.49\n• No contracts\n• Free cancellation\n• QR code entry\n\nTell me a city! 📍";
  }
  if (/\b(how does|how do|how it works|explain)\b/.test(lower)) {
    return "🏋️ *How ScanGym Works:*\n\n1️⃣ Search for gyms near you\n2️⃣ Pick a gym & pass type\n3️⃣ Pay (from £4.49)\n4️⃣ Get instant QR code\n5️⃣ Scan at gym → you're in!\n\nNo membership, works in 190+ countries!\nTell me a city to start 📍";
  }
  if (/\b(safe|secure|trust|legit|scam|real)\b/.test(lower)) {
    return "🔒 *100% Safe & Secure*\n\n• Stripe-powered payments (bank-grade encryption)\n• Free cancellation 2+ hours before\n• Real gyms verified on Google Maps\n• Used by thousands of gym-goers\n\nTry a day pass — risk-free! 💪";
  }
  if (/\b(refund|money back|charged|receipt)\b/.test(lower)) {
    return "💰 *Refunds & Receipts*\n\n• Cancel 2+ hours before → full refund\n• Refund arrives in 3-5 business days\n• Receipts auto-emailed\n\nTo cancel: \"Cancel [booking-code]\"\nHelp: scangym.com → My Bookings 📋";
  }
  if (/\b(country|countries|international|worldwide|global|work in)\b/.test(lower)) {
    return "🌍 ScanGym works in 190+ countries!\n\nPrices are PPP-adjusted:\n🇬🇧 UK: £4.49 · 🇺🇸 US: $5.49 · 🇮🇳 India: ₹199\n\nTell me your city! 📍";
  }
  if (/\b(tip|advice|workout|exercise|routine|muscle|cardio|weight|protein|diet|nutrition|fitness)\b/.test(lower)) {
    return "💪 Great question! Quick tip: Consistency > intensity. Even 30 mins 3x/week makes a huge difference!\n\nWant me to find a gym near you? Just say a city! 🏋️";
  }
  if (/\b(app|download|ios|android|iphone|google play|app store|samsung|microsoft store|windows)\b/.test(lower)) {
    return "📱 *Get ScanGym:*\n\n🍎 App Store · 🤖 Google Play · 💻 Microsoft Store · 📱 Galaxy Store\n🌐 scangym.com (works on any device!)\n\n✈️ Or chat via @ScanGymBot on Telegram!";
  }
  if (/\b(contact|support|help me|customer service|complaint|issue|problem|bug)\b/.test(lower)) {
    return "📧 *Need help?*\n\n📧 hello@scangym.com\n🌐 scangym.com/support\n💬 Or just tell me your issue right here!\n\nI help with: 🔍 Finding gyms · 📅 Bookings · 💰 Refunds · 👤 Accounts";
  }
  if (/\b(open|hours|when|close|closing|opening|24.?h|24.?7)\b/.test(lower)) {
    return "⏰ Hours vary by gym!\n\nSearch a gym and I'll show which ones are open now ✅\nMany gyms are 24/7!\n\nJust tell me your city 📍";
  }
  if (/\b(group|corporate|team|company|office|bulk|many|multiple)\b/.test(lower)) {
    return "👥 *Group & Corporate Bookings*\n\n• Group day passes available\n• Corporate wellness programs\n• Volume discounts\n\n📧 Email hello@scangym.com for group rates!\nOr book individually — tell me your city! 📍";
  }
  
  return getWelcomeText(meta.userName);
}

// ─── Welcome / Help Text ────────────────────────────────────
function getWelcomeText(userName) {
  const name = userName ? `, ${userName.split(' ')[0]}` : '';
  return `👋 Hey${name}! Welcome to *ScanGym* — the Uber for Gyms 🏋️\n\n` +
    `Skip the membership. Book a day pass at any gym, anywhere.\n\n` +
    `🔍 *Find gyms* — "Gyms in Manchester"\n` +
    `📅 *Book a session* — "Book gym 1 for tomorrow"\n` +
    `💰 *Prices* — "How much is a day pass?"\n` +
    `💳 *Earn money* — "Creator program"\n` +
    `🏢 *Gym owners* — "List my gym"\n` +
    `❌ *Cancel* — "Cancel 5WCB-8VDY"\n\n` +
    `💡 Just type any city name to find gyms!\n\n` +
    `🏋️ 1.2M+ gyms · 🌍 190+ countries · 💰 From £4.49/day`;
}

function getFallbackText() {
  return `I'm ScanGym — your gym day pass assistant! 🏋️\n\n` +
    `Try:\n` +
    `📍 Type a city: "Manchester"\n` +
    `🔍 Search: "Find gyms near me"\n` +
    `📅 Book: "Book gym 1 for tomorrow"\n` +
    `💰 Pricing: "How much?"\n` +
    `💳 Earn: "Creator program"\n\n` +
    `Or visit scangym.com 🌐`;
}

module.exports = { handleMessage, detectIntent, extractEntities, INTENTS };
