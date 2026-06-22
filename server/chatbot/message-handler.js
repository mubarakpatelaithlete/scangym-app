/**
 * Universal Message Handler v3.0 — The "kitchen" that all channels use.
 * 
 * Takes a natural language message like "Book a gym in Bolton for tomorrow"
 * and turns it into ScanGym API calls. Works the same whether the message
 * comes from Telegram, WhatsApp, SMS, Discord, Slack, Teams, Web, or any channel.
 * 
 * Architecture (like Uber):
 *   User message → Channel Adapter → THIS HANDLER → ScanGym API → Response
 *   
 * v3.0 improvements:
 *   - Gemini retry with exponential backoff (handles 429 rate limiting)
 *   - Model fallback chain: gemini-2.0-flash → gemini-1.5-flash
 *   - Comprehensive hardcoded responses for common queries when AI is down
 *   - Conversation state improvements (longer TTL, better follow-ups)
 *   - Robust error handling with user-friendly messages
 */

const SCANGYM_API = (
  process.env.SCANGYM_API_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
  'http://localhost:5000'
).replace(/\/+$/, '');

// ─── Multi-Provider AI with automatic fallback ──────────────
// Priority: Groq (free, fast) → Gemini (free tier) → Cloudflare Workers AI → HuggingFace
// If ALL fail, falls back to comprehensive pattern-matching responses.

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
ScanGym is the "Uber for gyms" — a universal gym day pass app. Instead of expensive monthly memberships, users buy a single-session pass at any gym worldwide. No contract, no commitment.

═══ PRODUCT DETAILS ═══
• 1.2M+ gyms across 190+ countries
• Pass types: Day Pass, 3-Day Pass, Weekly Pass, Monthly Pass
• Day pass prices: £4.49 (UK), $5.49 (US), PPP-adjusted per country
• Entry: Instant QR code — scan at gym entrance, no reception needed
• Free cancellation: 2+ hours before your session
• Platform fee: £0.00 (zero fees)
• Works at: Planet Fitness, PureGym, Anytime Fitness, The Gym Group, Gold's Gym, independent gyms, and more

═══ HOW BOOKING WORKS ═══
1. Search for gyms near a city/location
2. Pick a gym and pass type
3. Choose date & time
4. Pay (card or saved card — 1 tap)
5. Get instant QR code on your phone
6. Scan QR at gym entrance — you're in!

═══ AVAILABLE CHANNELS ═══
Users can book via: Telegram (@ScanGymBot), WhatsApp, Discord, Slack, MS Teams, SMS, Email, or the website (scangym.com).

═══ YOUR BEHAVIOUR RULES ═══
When responding:
- Keep answers SHORT (2-4 sentences max) and conversational
- Use emoji naturally but sparingly (1-2 per message)
- Format for messaging apps (short paragraphs, no HTML, no markdown headers)
- Be warm and human — not robotic

When the user wants an ACTION, output the tag AND a brief human message:
- SEARCH gyms → include [ACTION:SEARCH:<location>] in your response
- BOOK a gym → include [ACTION:BOOK:<details>]
- CANCEL booking → include [ACTION:CANCEL]
- CHECK status → include [ACTION:STATUS]

IMPORTANT:
- NEVER make up gym names, addresses, or prices
- NEVER say "I can't help" — always guide the user to search, book, or visit scangym.com
- If the user seems confused, offer 2-3 quick suggestions
- If the user says just a city name (e.g. "Manchester"), treat it as a gym search
- If the user types gibberish or something unrelated, gently redirect
- If the user asks about features you're unsure about, say "Check scangym.com for the latest, or I can help you find & book a gym!"`;

/**
 * Call Gemini with retry + model fallback.
 * Handles 429 rate limiting by retrying with backoff,
 * and falls back to secondary models if primary fails.
 */
async function callGemini(userMessage, conversationHistory = []) {
  if (!GEMINI_API_KEY) return null;

  const contents = [];
  for (const msg of conversationHistory.slice(-6)) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const requestBody = {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
  };

  // Try each model in the fallback chain
  for (const model of GEMINI_MODELS) {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    // Retry up to 3 times with exponential backoff for rate limiting
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
          // Empty response — try next model
          break;
        }

        if (resp.status === 429) {
          // Rate limited — wait and retry
          const retryAfter = Math.min(2000 * Math.pow(2, attempt), 10000);
          console.log(`[Chatbot] Gemini ${model} rate limited (429), retrying in ${retryAfter}ms (attempt ${attempt + 1}/3)`);
          await new Promise(r => setTimeout(r, retryAfter));
          continue;
        }

        if (resp.status === 503 || resp.status === 500) {
          // Server error — try next model
          console.log(`[Chatbot] Gemini ${model} error ${resp.status}, trying next model`);
          break;
        }

        // Other error — try next model
        console.error(`[Chatbot] Gemini ${model} error: ${resp.status}`);
        break;
      } catch (e) {
        console.error(`[Chatbot] Gemini ${model} fetch error:`, e.message);
        break;
      }
    }
  }

  // All models failed
  return null;
}

/**
 * Call Groq API (free tier: 30 RPM, Llama 3.1 70B — fast and capable)
 * Sign up at console.groq.com for a free API key.
 */
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 400,
          temperature: 0.4,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text;
      }

      if (resp.status === 429) {
        console.log(`[Chatbot] Groq ${model} rate limited, trying next`);
        continue;
      }

      console.log(`[Chatbot] Groq ${model} error: ${resp.status}`);
      break;
    } catch (e) {
      console.error(`[Chatbot] Groq ${model} fetch error:`, e.message);
      break;
    }
  }
  return null;
}

/**
 * Call Cloudflare Workers AI (free tier: 10K tokens/day)
 * Uses @cf/meta/llama-3.1-8b-instruct by default.
 */
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
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CLOUDFLARE_AI_TOKEN}`,
        },
        body: JSON.stringify({ messages, max_tokens: 400 }),
      }
    );

    if (resp.ok) {
      const data = await resp.json();
      const text = data.result?.response;
      if (text) return text;
    }
    console.log(`[Chatbot] Cloudflare AI error: ${resp.status}`);
  } catch (e) {
    console.error('[Chatbot] Cloudflare AI fetch error:', e.message);
  }
  return null;
}

/**
 * Call HuggingFace Inference API (free tier: rate-limited)
 * Uses Mistral-7B-Instruct-v0.3 by default.
 */
async function callHuggingFace(userMessage, conversationHistory = []) {
  if (!HF_API_KEY) return null;

  // Build a simple prompt (HF models vary in format)
  let prompt = `<s>[INST] ${SYSTEM_PROMPT}\n\n`;
  for (const msg of conversationHistory.slice(-4)) {
    if (msg.role === 'user') prompt += `[INST] ${msg.text} [/INST]\n`;
    else prompt += `${msg.text}\n`;
  }
  prompt += `[INST] ${userMessage} [/INST]`;

  try {
    const resp = await fetch(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${HF_API_KEY}`,
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { max_new_tokens: 400, temperature: 0.4 },
        }),
      }
    );

    if (resp.ok) {
      const data = await resp.json();
      const text = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
      if (text) {
        // Strip the prompt from the response
        const parts = text.split('[/INST]');
        return parts[parts.length - 1]?.trim() || text.trim();
      }
    }
    console.log(`[Chatbot] HuggingFace error: ${resp.status}`);
  } catch (e) {
    console.error('[Chatbot] HuggingFace fetch error:', e.message);
  }
  return null;
}

/**
 * Universal AI call — tries all providers in priority order:
 * 1. Groq (fastest, free 30 RPM with Llama 3.1 70B)
 * 2. Gemini (Google, free tier but rate-limited)
 * 3. Cloudflare Workers AI (free 10K tokens/day)
 * 4. HuggingFace Inference (free, slower)
 * 5. Returns null → falls back to pattern-matching
 */
async function callAI(userMessage, conversationHistory = []) {
  // Provider priority chain
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
      if (result) {
        console.log(`[Chatbot] AI response from ${provider.name}`);
        return result;
      }
    } catch (e) {
      console.error(`[Chatbot] ${provider.name} error:`, e.message);
    }
  }

  // All providers failed
  console.log('[Chatbot] All AI providers exhausted, using pattern-matching fallback');
  return null;
}

// ─── Intent Detection (context-aware) ────────────────────────

const INTENTS = {
  SEARCH: 'search',
  BOOK: 'book', 
  CANCEL: 'cancel',
  HELP: 'help',
  STATUS: 'status',
  PRICING: 'pricing',
  FOLLOW_UP: 'follow_up',
  CHANNELS: 'channels',
  UNKNOWN: 'unknown',
};

function detectIntent(text, session) {
  const lower = text.toLowerCase().trim();
  
  // ── Context-aware: Check if this is a follow-up to a pending conversation ──
  if (session && session.pendingBooking) {
    if (!session.pendingBooking.date && /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|next\s+\w+)\b/.test(lower)) {
      return INTENTS.FOLLOW_UP;
    }
    if (!session.pendingBooking.email && /@/.test(lower)) {
      return INTENTS.FOLLOW_UP;
    }
    if (lower.length < 30 && !session.pendingBooking.date) {
      return INTENTS.FOLLOW_UP;
    }
  }
  
  // ── Cancel ──
  if (/\bcancel\b/.test(lower)) return INTENTS.CANCEL;
  
  // ── Book ──
  if (/\b(book|reserve|schedule)\b/.test(lower)) return INTENTS.BOOK;
  
  // ── Status / my bookings ──
  if (/\b(status|my booking|my bookings|my session|booking code|my qr|my code|check booking)\b/.test(lower)) return INTENTS.STATUS;
  
  // ── Pricing questions ──
  if (/\b(price|pricing|cost|how much|fee|charge|expensive|cheap|afford|pay|payment)\b/.test(lower)) return INTENTS.PRICING;
  
  // ── Channel questions ──
  if (/\b(channel|channels|telegram|whatsapp|discord|slack|teams|connect|app|download|install)\b/.test(lower)) return INTENTS.CHANNELS;
  
  // ── Help — greetings, general questions ──
  if (/\b(help|start|menu|commands|what can you|how do|how does|what do you|about|who are you|what is scangym|what's scangym)\b/.test(lower)) return INTENTS.HELP;
  
  // ── Greetings ──
  if (/^(hi|hey|hello|hola|yo|sup|hiya|heya|morning|good morning|good evening|good afternoon|howdy|g'day|salaam|hallo|bonjour|ciao|what's up|whats up|wassup)[\s!.?]*$/i.test(lower)) return INTENTS.HELP;
  
  // ── Search / find — clear gym search intent ──
  if (/\b(find|search|show|list|near|nearby|gym|gyms|where|look for|looking for)\b/.test(lower)) return INTENTS.SEARCH;
  
  // ── City name detection ──
  if (/^[a-z][a-z\s,'-]{1,39}$/i.test(lower) && !lower.includes('?') && !lower.includes('!')) {
    const commonWords = ['yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank you', 'cool', 'great', 'nice', 'good', 'bad', 'nah', 'nope', 'yep', 'yea', 'yeah', 'bye', 'lol', 'haha', 'what', 'why', 'how', 'when', 'who', 'hmm', 'idk', 'test', 'testing', 'stop', 'quit', 'exit', 'leave'];
    if (!commonWords.includes(lower.trim())) {
      return INTENTS.SEARCH;
    }
  }
  
  // ── Default: let Gemini figure it out ──
  return INTENTS.UNKNOWN;
}

// ─── Entity Extraction ──────────────────────────────────────

function extractEntities(text) {
  const entities = {};
  const lower = text.toLowerCase();
  
  // Email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) entities.email = emailMatch[0];
  
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
      const d = new Date(); const today = d.getDay();
      let diff = targetDay - today; if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      entities.date = d.toISOString().split('T')[0];
    }
  } else if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower)) {
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const match = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (match) {
      const targetDay = dayNames.indexOf(match[1]);
      const d = new Date(); const today = d.getDay();
      let diff = targetDay - today; if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      entities.date = d.toISOString().split('T')[0];
    }
  } else {
    const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) entities.date = dateMatch[0];
    const dmMatch = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (dmMatch) {
      const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
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
    if (hours >= 0 && hours <= 23) {
      entities.time = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
  } else if (/\bmorning\b/.test(lower)) {
    entities.time = '09:00';
  } else if (/\bevening\b/.test(lower)) {
    entities.time = '18:00';
  } else if (/\bafternoon\b/.test(lower)) {
    entities.time = '14:00';
  } else if (/\blunch\b/.test(lower)) {
    entities.time = '12:00';
  }
  
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

function formatGymList(gyms, platform) {
  if (!gyms || gyms.length === 0) {
    return "😕 No gyms found in that area.\n\nTry a different city or neighbourhood?\nExamples: \"London\", \"Manchester city centre\", \"Bolton\"";
  }
  
  const count = Math.min(gyms.length, 5);
  let text = `🏋️ Found ${gyms.length} gym${gyms.length > 1 ? 's' : ''}:\n\n`;
  
  gyms.slice(0, count).forEach((g, i) => {
    const distance = g.distanceText ? ` · ${g.distanceText}` : '';
    const rating = g.rating ? ` ⭐ ${g.rating}` : '';
    const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
    const open = g.openNow === true ? ' · ✅ Open now' : g.openNow === false ? ' · 🔴 Closed' : '';
    text += `${i + 1}. *${g.name}*${distance}\n`;
    text += `   💰 ${price}/day${rating}${open}\n`;
    if (g.address) text += `   📍 ${g.address}\n`;
    text += '\n';
  });
  
  if (gyms.length > count) {
    text += `...and ${gyms.length - count} more. Visit scangym.com to see all.\n\n`;
  }
  
  text += `💡 Say "Book gym 1 for tomorrow" to book!\n`;
  text += `Or visit scangym.com for the full experience with maps & photos.`;
  
  return text;
}

function formatBookingConfirmation(booking, gymName) {
  return `✅ *Booking Confirmed!*\n\n` +
    `🏋️ ${gymName}\n` +
    `📅 ${booking.date}\n` +
    `⏰ ${booking.time || 'Anytime'}\n` +
    `💰 £${booking.price}\n` +
    `🔖 Code: *${booking.bookingCode}*\n\n` +
    `📲 Your QR code is ready! Open scangym.com to view it.\n` +
    `Scan it at the gym entrance — no reception needed.\n\n` +
    `Free cancellation up to 2 hours before.\n` +
    `To cancel: "Cancel booking ${booking.bookingCode}"`;
}

// ─── Session Store (per-user conversation state) ─────────────
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

function getSession(userId) {
  const s = sessions.get(userId);
  if (s && Date.now() - s.lastActive < SESSION_TTL) {
    s.lastActive = Date.now();
    return s;
  }
  const newSession = {
    lastActive: Date.now(),
    lastResults: [],
    pendingBooking: null,
    lastMessage: '',
    lastResponse: '',
    history: [],
    messageCount: 0,
  };
  sessions.set(userId, newSession);
  // Cleanup old sessions periodically
  if (sessions.size > 10000) {
    const now = Date.now();
    for (const [k, v] of sessions) {
      if (now - v.lastActive > SESSION_TTL) sessions.delete(k);
    }
  }
  return newSession;
}

// ─── Main Handler ───────────────────────────────────────────
async function handleMessage(userId, text, meta = {}) {
  if (!text || !text.trim()) {
    return { text: getWelcomeText(meta.userName) };
  }
  
  const session = getSession(userId);
  session.messageCount++;
  
  const intent = detectIntent(text, session);
  const entities = extractEntities(text);
  
  // Dedup: if user sends the exact same message again, don't re-process
  const normalised = text.toLowerCase().trim();
  if (session.lastMessage === normalised && session.lastResponse) {
    return { text: session.lastResponse };
  }
  
  try {
    let result;
    
    // ── Handle follow-ups to pending booking first ──
    if (intent === INTENTS.FOLLOW_UP && session.pendingBooking) {
      result = await handleFollowUp(session, text, entities, meta);
    }
    // ── Fast path: clear intents with entities ──
    else if (intent === INTENTS.SEARCH && entities.location) {
      result = await handleSearch(session, text, entities, meta);
    } else if (intent === INTENTS.SEARCH && !entities.location) {
      const location = text.replace(/\b(find|search|show|list|gym|gyms|near|nearby|me|a|the|in|around|some)\b/gi, '').trim();
      if (location.length > 1) {
        result = await handleSearch(session, text, { ...entities, location }, meta);
      } else {
        result = { text: "📍 Which city or area? Just type a place name like \"London\" or \"Manchester\" and I'll find gyms near you!" };
      }
    } else if (intent === INTENTS.BOOK) {
      result = await handleBook(session, text, entities, meta);
    } else if (intent === INTENTS.CANCEL) {
      result = await handleCancel(entities);
    } else if (intent === INTENTS.STATUS) {
      result = { text: "📋 To check your booking, visit scangym.com → Profile → My Bookings.\n\nOr tell me your booking code (e.g. 5WCB-8VDY) and I'll look it up!" };
    } else if (intent === INTENTS.PRICING) {
      result = await handlePricing(meta);
    } else if (intent === INTENTS.CHANNELS) {
      result = handleChannelsQuestion(text, meta);
    } else {
      // ── AI: intelligent response — tries Groq → Gemini → Cloudflare → HuggingFace ──
      const aiReply = await callAI(text, session.history || []);
      
      if (aiReply) {
        // Check if Gemini returned an action tag
        const actionMatch = aiReply.match(/\[ACTION:(SEARCH|BOOK|CANCEL|STATUS):?(.*?)\]/);
        
        if (actionMatch) {
          const action = actionMatch[1];
          const param = (actionMatch[2] || '').trim();
          const cleanReply = aiReply.replace(/\[ACTION:.*?\]/g, '').trim();
          
          if (action === 'SEARCH' && param) {
            result = await handleSearch(session, param, { location: param }, meta);
            if (cleanReply && cleanReply.length > 5) {
              result.text = cleanReply + '\n\n' + result.text;
            }
          } else if (action === 'BOOK') {
            result = await handleBook(session, text, entities, meta);
          } else if (action === 'CANCEL') {
            result = await handleCancel(entities);
          } else if (action === 'STATUS') {
            result = { text: "📋 To check your booking, visit scangym.com → Profile → My Bookings.\n\nOr tell me your booking code and I'll look it up!" };
          } else {
            result = { text: "📍 Which city would you like to find gyms in?\n\nJust type a city name like \"London\" or \"Manchester\"!" };
          }
        } else {
          result = { text: aiReply };
        }
      } else {
        // Gemini unavailable — smart pattern-matching fallback
        result = { text: getSmartFallback(text, session, meta) };
      }
    }
    
    // Store conversation history for Gemini context
    if (!session.history) session.history = [];
    session.history.push({ role: 'user', text });
    session.history.push({ role: 'assistant', text: result.text });
    if (session.history.length > 12) session.history = session.history.slice(-12);
    
    // Store for dedup
    session.lastMessage = normalised;
    session.lastResponse = result.text;
    
    return result;
  } catch (err) {
    console.error('[MessageHandler] Error:', err);
    return { text: "😕 Something went wrong on my end. Please try again!\n\nOr visit scangym.com to search & book directly." };
  }
}

// ─── Follow-up handler (multi-turn booking) ─────────────────
async function handleFollowUp(session, text, entities, meta) {
  const pending = session.pendingBooking;
  if (!pending) return { text: getFallbackText() };
  
  if (!pending.date) {
    if (entities.date) {
      pending.date = entities.date;
      if (entities.time) pending.time = entities.time;
    } else {
      const lower = text.toLowerCase().trim();
      if (lower === 'today') {
        pending.date = new Date().toISOString().split('T')[0];
      } else if (lower === 'tomorrow') {
        const d = new Date(); d.setDate(d.getDate() + 1);
        pending.date = d.toISOString().split('T')[0];
      } else {
        pending.date = new Date().toISOString().split('T')[0];
      }
    }
    
    if (!pending.email && !entities.email) {
      session.pendingBooking = pending;
      const gymName = pending.gym ? pending.gym.name : 'your selected gym';
      return {
        text: `📧 Great! Almost there for *${gymName}*.\n\nPlease share your email for the booking confirmation.`
      };
    }
    if (entities.email) pending.email = entities.email;
  }
  
  if (!pending.email && entities.email) {
    pending.email = entities.email;
  }
  
  if (pending.gym && pending.date && pending.email) {
    const bookEntities = {
      location: null,
      date: pending.date,
      time: pending.time || entities.time,
      email: pending.email,
    };
    const gym = pending.gym;
    session.pendingBooking = null;
    return await completeBooking(session, gym, bookEntities, meta);
  }
  
  if (!pending.email) {
    return {
      text: `📧 Please share your email to complete the booking.\n\nYour email is only used for the booking confirmation.`
    };
  }
  
  return { text: getFallbackText() };
}

// ─── Pricing handler ─────────────────────────────────────────
async function handlePricing(meta) {
  return {
    text: `💰 *ScanGym Pricing*\n\n` +
      `Day passes are PPP-adjusted by country:\n` +
      `🇬🇧 UK: from £4.49/day\n` +
      `🇺🇸 US: from $5.49/day\n` +
      `🇪🇺 Europe: from €4.99/day\n\n` +
      `Multi-day passes available:\n` +
      `• 3-Day Pass — ~30% savings\n` +
      `• Weekly Pass — ~40% savings\n` +
      `• Monthly Pass — best value\n\n` +
      `✅ No platform fees · No hidden charges\n` +
      `✅ Free cancellation (2hr+ before)\n\n` +
      `Tell me a city and I'll show you exact prices!`
  };
}

// ─── Channels question handler ───────────────────────────────
function handleChannelsQuestion(text, meta) {
  const lower = text.toLowerCase();
  
  if (/telegram/i.test(lower)) {
    return { text: "✈️ *ScanGym on Telegram*\n\nSearch @ScanGymBot on Telegram and press START to begin.\n\nYou can search gyms, check prices, and book — all within Telegram!\n\nOr go to scangym.com → Chat → Channels → Telegram to connect." };
  }
  if (/whatsapp/i.test(lower)) {
    return { text: "💬 *ScanGym on WhatsApp*\n\nGo to scangym.com → Chat → Channels → WhatsApp to get our WhatsApp number.\n\nSend \"Hi\" and start booking gyms via WhatsApp! 📲" };
  }
  if (/discord/i.test(lower)) {
    return { text: "🎮 *ScanGym on Discord*\n\nGo to scangym.com → Chat → Channels → Discord to add our bot.\n\nDM the bot or mention @ScanGym in any channel to search & book gyms!" };
  }
  if (/slack/i.test(lower)) {
    return { text: "💼 *ScanGym on Slack*\n\nGo to scangym.com → Chat → Channels → Slack to install the bot.\n\nDM the bot or mention @ScanGym in any channel! 🚀" };
  }
  if (/teams/i.test(lower)) {
    return { text: "🟣 *ScanGym on Teams*\n\nGo to scangym.com → Chat → Channels → Microsoft Teams to install.\n\nChat with the bot to search & book gyms right from Teams!" };
  }
  
  return {
    text: "📱 *Available Channels*\n\n" +
      "You can chat with ScanGym on:\n" +
      "✈️ Telegram — @ScanGymBot\n" +
      "💬 WhatsApp — instant messaging\n" +
      "🎮 Discord — DM the bot\n" +
      "💼 Slack — workspace integration\n" +
      "🟣 MS Teams — workplace chat\n" +
      "📧 Email — book@scangym.com\n" +
      "📱 SMS — text to book\n\n" +
      "Connect any channel at scangym.com → Channels!"
  };
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
  
  return { text: formatGymList(data.gyms, meta.platform), data: { gyms: data.gyms } };
}

// ─── Book handler ────────────────────────────────────────────
async function handleBook(session, text, entities, meta) {
  const numMatch = text.match(/\bgym\s*(\d+)\b/i);
  let targetGym = null;
  
  if (numMatch && session.lastResults.length > 0) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < session.lastResults.length) {
      targetGym = session.lastResults[idx];
    } else {
      return { text: `I only found ${session.lastResults.length} gyms. Try "Book gym 1" to "Book gym ${session.lastResults.length}".` };
    }
  }
  
  if (!targetGym && entities.location) {
    const params = new URLSearchParams({ q: `gym in ${entities.location}` });
    const data = await callApi(`/api/live/search?${params}`);
    if (data.gyms && data.gyms.length > 0) {
      targetGym = data.gyms[0];
      session.lastResults = data.gyms;
    }
  }
  
  if (!targetGym && session.pendingBooking && session.pendingBooking.gym) {
    targetGym = session.pendingBooking.gym;
  }
  
  if (!targetGym) {
    return { 
      text: "🏋️ Which gym would you like to book?\n\n" +
        "1️⃣ Search first: \"Find gyms in Bolton\"\n" +
        "2️⃣ Then book: \"Book gym 1 for tomorrow\"\n\n" +
        "Or try: \"Book a gym in Manchester for tomorrow at 3pm\""
    };
  }
  
  if (!entities.date) {
    session.pendingBooking = { gym: targetGym };
    return { 
      text: `📅 When would you like to visit *${targetGym.name}*?\n\n` +
        `Say "today", "tomorrow", a day like "Monday", or a date like "15 Jan".`
    };
  }
  
  if (!entities.email) {
    session.pendingBooking = { gym: targetGym, date: entities.date, time: entities.time };
    return { 
      text: `📧 Last step! Share your email to book at *${targetGym.name}*.\n\n` +
        `We'll send your QR code and booking confirmation there.`
    };
  }
  
  return await completeBooking(session, targetGym, entities, meta);
}

// ─── Complete booking (shared by book + follow-up) ───────────
async function completeBooking(session, targetGym, entities, meta) {
  const placeId = targetGym.placeId || targetGym.id;
  
  const ensureResult = await callApi('/api/live/ensure-gym', {
    method: 'POST',
    body: JSON.stringify({ placeId }),
  });
  
  if (ensureResult.error) {
    return { text: `😕 Couldn't set up that gym. Please try again or visit scangym.com to book directly.` };
  }
  
  const bookingResult = await callApi('/api/bookings/guest-create', {
    method: 'POST',
    body: JSON.stringify({
      gymId: ensureResult.gymId,
      date: entities.date,
      time: entities.time || 'anytime',
      email: entities.email,
      name: meta.userName || 'Chat Booking',
    }),
  });
  
  if (!bookingResult.success) {
    return { text: `😕 Booking failed: ${bookingResult.error || 'Unknown error'}\n\nPlease try again or visit scangym.com.` };
  }
  
  session.pendingBooking = null;
  return { 
    text: formatBookingConfirmation(bookingResult.booking, targetGym.name),
    data: { booking: bookingResult.booking },
  };
}

// ─── Cancel handler ──────────────────────────────────────────
async function handleCancel(entities) {
  if (!entities.bookingId && !entities.bookingCode) {
    return { text: "🔖 To cancel, I need your booking code.\n\nExample: \"Cancel 5WCB-8VDY\"\n\nYou can find it in your booking confirmation email or at scangym.com → My Bookings." };
  }
  
  if (!entities.email) {
    return { text: "📧 For security, please include your email.\n\nExample: \"Cancel 5WCB-8VDY myemail@gmail.com\"" };
  }
  
  const result = await callApi('/api/bookings/cancel', {
    method: 'POST',
    body: JSON.stringify({
      bookingId: entities.bookingId,
      bookingCode: entities.bookingCode,
      email: entities.email,
    }),
  });
  
  if (result.error) {
    return { text: `😕 ${result.error}\n${result.message || ''}\n\nNeed help? Visit scangym.com or try again.` };
  }
  
  return { 
    text: `✅ Booking cancelled successfully.\n${result.message || ''}\n\n${result.refunded ? '💰 Refund will appear in 3-5 business days.\n' : ''}Want to book another gym? Just tell me a city!`
  };
}

// ─── Smart Fallback (when Gemini is down) ────────────────────
function getSmartFallback(text, session, meta) {
  const lower = text.toLowerCase().trim();
  
  // Common conversational patterns
  if (/\b(thank|thanks|cheers|ta|thx)\b/.test(lower)) {
    return "You're welcome! 😊 Let me know if you need anything else. Happy to help find gyms anytime! 🏋️";
  }
  if (/\b(bye|goodbye|see you|later|cya)\b/.test(lower)) {
    return "See you! 👋 When you're ready to hit the gym, just send a city name. Have a great day! 💪";
  }
  if (/\b(awesome|amazing|great|perfect|cool|nice|love it|brilliant)\b/.test(lower)) {
    return "Glad to hear it! 😄 Anything else I can help with? I'm always here to find gyms or help with bookings! 🏋️";
  }
  if (/\b(how are you|how's it going|what's up)\b/.test(lower)) {
    return "I'm great, thanks for asking! 😊 Ready to help you find the perfect gym. What city are you looking in? 🏋️";
  }
  if (/\b(who are you|your name|about you)\b/.test(lower)) {
    return "I'm ScanGym's AI assistant! 🏋️ I help you find and book gym day passes anywhere in the world — no membership needed. Just tell me a city to get started!";
  }
  if (/\b(membership|monthly|subscription|contract)\b/.test(lower)) {
    return "🚫 *No memberships needed!*\n\nScanGym is pay-as-you-go — buy a day pass, walk in, work out, done.\n\n• Day passes from £4.49\n• No contracts or commitments\n• Free cancellation\n• QR code entry\n\nTell me a city to find gyms!";
  }
  if (/\b(how does|how do|how it works|explain)\b/.test(lower)) {
    return "🏋️ *How ScanGym Works:*\n\n1️⃣ Search for gyms near you\n2️⃣ Pick a gym & pass type\n3️⃣ Pay (from £4.49)\n4️⃣ Get instant QR code\n5️⃣ Scan at gym entrance — you're in!\n\nNo membership, no contract. Just tell me a city to start! 📍";
  }
  if (/\b(safe|secure|trust|legit|scam|real)\b/.test(lower)) {
    return "🔒 *100% safe & secure*\n\n• Stripe-powered payments (bank-grade encryption)\n• Free cancellation up to 2 hours before\n• Real gyms verified on Google Maps\n• QR code entry — instant access\n• Used by thousands of gym-goers\n\nTry it with a day pass — risk-free! 💪";
  }
  if (/\b(refund|money back|charged|receipt)\b/.test(lower)) {
    return "💰 *Refunds & Receipts*\n\n• Cancel 2+ hours before → full refund\n• Refund appears in 3-5 business days\n• Receipts sent to your email automatically\n\nTo cancel: \"Cancel [your-booking-code]\"\nNeed help? Visit scangym.com → My Bookings 📋";
  }
  
  // Default: guide them to search
  return getWelcomeText(meta.userName);
}

// ─── Welcome / Help Text ────────────────────────────────────
function getWelcomeText(userName) {
  const name = userName ? `, ${userName.split(' ')[0]}` : '';
  return `👋 Hey${name}! I'm ScanGym — your gym day pass assistant.\n\n` +
    `I can help you:\n` +
    `🔍 Find gyms — "Gyms in Manchester"\n` +
    `📅 Book a session — "Book a gym in London for tomorrow"\n` +
    `💰 Check prices — "How much is a day pass?"\n` +
    `❌ Cancel — "Cancel booking 5WCB-8VDY"\n\n` +
    `Just type a city name to get started! 🏋️`;
}

function getFallbackText() {
  return `I'm your ScanGym gym finder! 🏋️\n\n` +
    `Try one of these:\n` +
    `• Type a city: "Manchester"\n` +
    `• Search: "Find gyms near me"\n` +
    `• Book: "Book a gym in London for tomorrow"\n` +
    `• Pricing: "How much?"\n\n` +
    `Or visit scangym.com for the full experience!`;
}

function getHelpText() {
  return getWelcomeText();
}

module.exports = { handleMessage, detectIntent, extractEntities, INTENTS };
