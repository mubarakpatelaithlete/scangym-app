/**
 * Universal Message Handler v2.0 — The "kitchen" that all channels use.
 * 
 * Takes a natural language message like "Book a gym in Bolton for tomorrow"
 * and turns it into ScanGym API calls. Works the same whether the message
 * comes from Telegram, WhatsApp, SMS, Discord, Slack, Teams, or any channel.
 * 
 * Architecture (like Uber):
 *   User message → Channel Adapter → THIS HANDLER → ScanGym API → Response
 *   
 * v2.0 improvements:
 *   - Rich system prompt with full ScanGym product knowledge
 *   - Multi-turn conversation state (pending bookings, follow-ups)
 *   - Better intent detection with context awareness
 *   - Smarter Gemini parameters (lower temp, more tokens)
 *   - Quick-reply suggestions for each response
 */

const SCANGYM_API = (
  process.env.SCANGYM_API_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
  'http://localhost:5000'
).replace(/\/+$/, '');

// ─── Gemini AI for intelligent responses ─────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
6. Scan QR at gym entrance → you're in!

═══ YOUR BEHAVIOUR RULES ═══
When responding:
- Keep answers SHORT (2-4 sentences max) and conversational
- Use emoji naturally but sparingly (1-2 per message)
- Format for messaging apps (short paragraphs, no HTML, no markdown headers)
- Be warm and human — not robotic

When the user wants an ACTION, output the tag AND a brief human message:
- SEARCH gyms → include [ACTION:SEARCH:<location>] in your response (e.g. "Let me find gyms near London for you! [ACTION:SEARCH:London]")
- BOOK a gym → include [ACTION:BOOK:<details>]
- CANCEL booking → include [ACTION:CANCEL]
- CHECK status → include [ACTION:STATUS]

IMPORTANT:
- NEVER make up gym names, addresses, or prices
- NEVER say "I can't help" — always guide the user to search, book, or visit scangym.com
- If the user seems confused, offer 2-3 quick suggestions they can tap/type
- If the user says just a city name (e.g. "Manchester"), treat it as a gym search
- If the user types gibberish or something unrelated, gently redirect: "I'm ScanGym's gym finder! 🏋️ Tell me a city and I'll find gyms near you."
- If the user asks about features you're unsure about, say "Great question! You can check scangym.com for the latest details, or I can help you find & book a gym right now."`;

async function callGemini(userMessage, conversationHistory = []) {
  if (!GEMINI_API_KEY) return null;

  const contents = [];
  // Add recent conversation for context (last 6 messages for better continuity)
  for (const msg of conversationHistory.slice(-6)) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  try {
    const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 400, temperature: 0.4 },
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    console.error('[Chatbot] Gemini error:', e.message);
    return null;
  }
}

// ─── Intent Detection (context-aware) ────────────────────────
// Checks conversation state FIRST, then keyword patterns.

const INTENTS = {
  SEARCH: 'search',
  BOOK: 'book', 
  CANCEL: 'cancel',
  HELP: 'help',
  STATUS: 'status',
  PRICING: 'pricing',
  FOLLOW_UP: 'follow_up',
  UNKNOWN: 'unknown',
};

function detectIntent(text, session) {
  const lower = text.toLowerCase().trim();
  
  // ── Context-aware: Check if this is a follow-up to a pending conversation ──
  if (session && session.pendingBooking) {
    // User is in a booking flow — check if this answers a pending question
    if (!session.pendingBooking.date && /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|next\s+\w+)\b/.test(lower)) {
      return INTENTS.FOLLOW_UP;
    }
    if (!session.pendingBooking.email && /@/.test(lower)) {
      return INTENTS.FOLLOW_UP;
    }
    // If they type a short response that could be a date/time answer
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
  
  // ── Help — greetings, general questions ──
  if (/\b(help|start|menu|commands|what can you|how do|how does|what do you|about|who are you|what is scangym|what's scangym)\b/.test(lower)) return INTENTS.HELP;
  
  // ── Greetings (separate from help — get a warmer response) ──
  if (/^(hi|hey|hello|hola|yo|sup|hiya|heya|morning|good morning|good evening|good afternoon|howdy|g'day|salaam|hallo|bonjour|ciao)[\s!.?]*$/i.test(lower)) return INTENTS.HELP;
  
  // ── Search / find — clear gym search intent ──
  if (/\b(find|search|show|list|near|nearby|gym|gyms|where|look for|looking for)\b/.test(lower)) return INTENTS.SEARCH;
  
  // ── City name detection — if it's JUST a city/place name (2-40 chars, only letters/spaces) ──
  // But be careful: don't treat random words as cities
  if (/^[a-z][a-z\s,'-]{1,39}$/i.test(lower) && !lower.includes('?') && !lower.includes('!')) {
    // Known city patterns or short phrases — likely a location search
    const commonWords = ['yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank you', 'cool', 'great', 'nice', 'good', 'bad', 'nah', 'nope', 'yep', 'yea', 'yeah', 'bye', 'lol', 'haha', 'what', 'why', 'how', 'when', 'who', 'hmm', 'idk', 'test', 'testing'];
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
  
  // Date: "tomorrow", "today", "Monday", "2025-01-15", "15 Jan", "next Tuesday"
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
    // Also match "15 Jan", "Jan 15", "15/01", "01/15" patterns
    const dmMatch = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (dmMatch) {
      const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const d = new Date(); d.setMonth(months[dmMatch[2].toLowerCase()]); d.setDate(parseInt(dmMatch[1]));
      if (d < new Date()) d.setFullYear(d.getFullYear() + 1);
      entities.date = d.toISOString().split('T')[0];
    }
  }
  
  // Time: "at 3pm", "at 15:00", "at 3:30pm", "morning", "evening"
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
  
  // Location: everything after "in", "near", "at", "around" (excluding known keywords)
  const locMatch = lower.match(/(?:in|near|at|around)\s+(.+?)(?:\s+(?:for|on|at|tomorrow|today|\d)|\s*$)/);
  if (locMatch) {
    const loc = locMatch[1].replace(/\b(gym|gyms|fitness|a|the|some)\b/g, '').trim();
    if (loc.length > 1) entities.location = loc;
  }
  
  // Booking ID for cancel/status
  const idMatch = text.match(/\b(\d{3,})\b/);
  if (idMatch) entities.bookingId = parseInt(idMatch[1]);
  
  // Booking code (e.g., 5WCB-8VDY)
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
      // Treat the whole message as a location search
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
    } else {
      // ── Gemini AI: intelligent response for everything else ──
      const aiReply = await callGemini(text, session.history || []);
      
      if (aiReply) {
        // Check if Gemini returned an action tag
        const actionMatch = aiReply.match(/\[ACTION:(SEARCH|BOOK|CANCEL|STATUS):?(.*?)\]/);
        
        if (actionMatch) {
          const action = actionMatch[1];
          const param = (actionMatch[2] || '').trim();
          // Strip the action tag from the visible response
          const cleanReply = aiReply.replace(/\[ACTION:.*?\]/g, '').trim();
          
          if (action === 'SEARCH' && param) {
            result = await handleSearch(session, param, { location: param }, meta);
            // Prepend Gemini's friendly message if it had one
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
          // Pure conversational response from Gemini
          result = { text: aiReply };
        }
      } else {
        // Gemini unavailable — smart fallback
        if (intent === INTENTS.HELP) {
          result = { text: getWelcomeText(meta.userName) };
        } else {
          result = { text: getFallbackText() };
        }
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
  
  // User is providing a missing piece of the booking
  if (!pending.date) {
    // They might be answering "when?"
    if (entities.date) {
      pending.date = entities.date;
      if (entities.time) pending.time = entities.time;
    } else {
      // Try to parse as a date from Gemini
      const lower = text.toLowerCase().trim();
      if (lower === 'today') {
        pending.date = new Date().toISOString().split('T')[0];
      } else if (lower === 'tomorrow') {
        const d = new Date(); d.setDate(d.getDate() + 1);
        pending.date = d.toISOString().split('T')[0];
      } else {
        // Let Gemini interpret it
        pending.date = new Date().toISOString().split('T')[0]; // Default to today
      }
    }
    
    // Now check if we still need email
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
  
  // If we now have everything, complete the booking
  if (pending.gym && pending.date && pending.email) {
    const bookEntities = {
      location: null,
      date: pending.date,
      time: pending.time || entities.time,
      email: pending.email,
    };
    // Reset pending state before booking
    const gym = pending.gym;
    session.pendingBooking = null;
    
    return await completeBooking(session, gym, bookEntities, meta);
  }
  
  // Still missing something
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

// ─── Search handler ──────────────────────────────────────────
async function handleSearch(session, text, entities, meta) {
  const query = entities.location || text.replace(/\b(find|search|show|list|gym|gyms|near|nearby|me|a|the|in|around|some)\b/gi, '').trim() || text;
  
  const params = new URLSearchParams({ q: `gym in ${query}` });
  const data = await callApi(`/api/live/search?${params}`);
  
  if (data.error) {
    return { text: `😕 Couldn't search that area right now.\n\nTry again or try a different location?\nExamples: "London", "Manchester", "Birmingham"` };
  }
  
  // Store results in session for "Book gym 2" follow-ups
  session.lastResults = data.gyms || [];
  
  return { text: formatGymList(data.gyms, meta.platform), data: { gyms: data.gyms } };
}

// ─── Book handler ────────────────────────────────────────────
async function handleBook(session, text, entities, meta) {
  // Check if user said "Book gym 2" (referencing last search)
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
  
  // If no gym selected by number, search for it
  if (!targetGym && entities.location) {
    const params = new URLSearchParams({ q: `gym in ${entities.location}` });
    const data = await callApi(`/api/live/search?${params}`);
    if (data.gyms && data.gyms.length > 0) {
      targetGym = data.gyms[0];
      session.lastResults = data.gyms;
    }
  }
  
  // Check pending booking from previous interaction
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
  
  // Need a date
  if (!entities.date) {
    session.pendingBooking = { gym: targetGym };
    return { 
      text: `📅 When would you like to visit *${targetGym.name}*?\n\n` +
        `Say "today", "tomorrow", a day like "Monday", or a date like "15 Jan".`
    };
  }
  
  // Need an email
  if (!entities.email) {
    session.pendingBooking = { gym: targetGym, date: entities.date, time: entities.time };
    return { 
      text: `📧 Last step! Share your email to book at *${targetGym.name}*.\n\n` +
        `We'll send your QR code and booking confirmation there.`
    };
  }
  
  // We have everything — complete the booking
  return await completeBooking(session, targetGym, entities, meta);
}

// ─── Complete booking (shared by book + follow-up) ───────────
async function completeBooking(session, targetGym, entities, meta) {
  const placeId = targetGym.placeId || targetGym.id;
  
  // Step 1: Ensure gym exists in DB
  const ensureResult = await callApi('/api/live/ensure-gym', {
    method: 'POST',
    body: JSON.stringify({ placeId }),
  });
  
  if (ensureResult.error) {
    return { text: `😕 Couldn't set up that gym. Please try again or visit scangym.com to book directly.` };
  }
  
  // Step 2: Create guest booking
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

// Keep backward-compatible export name
function getHelpText() {
  return getWelcomeText();
}

module.exports = { handleMessage, detectIntent, extractEntities, INTENTS };
