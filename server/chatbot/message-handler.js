/**
 * Universal Message Handler — The "kitchen" that all channels use.
 * 
 * Takes a natural language message like "Book a gym in Bolton for tomorrow"
 * and turns it into ScanGym API calls. Works the same whether the message
 * comes from Telegram, WhatsApp, SMS, Discord, or any other channel.
 * 
 * Architecture (like Uber):
 *   User message → Channel Adapter → THIS HANDLER → ScanGym API → Response
 *   
 * The channel adapters (telegram.js, whatsapp.js, etc.) are thin wrappers
 * that receive messages in their format and pass plain text here.
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

const SYSTEM_PROMPT = `You are ScanGym's AI assistant on messaging channels (Telegram, WhatsApp, Discord, SMS).
ScanGym is a universal gym day pass app — like Uber for gyms. Users can book a single-session pass at any gym worldwide for one low price (PPP-adjusted, e.g. £4.49/day UK, $5.49/day US).

Your job: understand what the user wants and respond helpfully in 2-3 short sentences max.

RULES:
- If the user wants to FIND/SEARCH gyms → respond with exactly: [ACTION:SEARCH:<location>] (e.g. [ACTION:SEARCH:London])
- If the user wants to BOOK → respond with exactly: [ACTION:BOOK:<details>]
- If the user wants to CANCEL → respond with exactly: [ACTION:CANCEL]
- If the user asks about STATUS → respond with exactly: [ACTION:STATUS]
- If the user says hi/hello/greetings → give a warm 1-line welcome + briefly explain what you can do
- If the user asks about pricing → explain: day passes start at £4.49 (UK) / $5.49 (US), adjusted by country. No membership needed.
- If the user asks what ScanGym is → explain: universal gym day pass app, book any gym worldwide for a single session
- If the message is unclear or gibberish → ask what city they'd like to find gyms in
- Keep responses short, friendly, use emoji sparingly
- Format for messaging apps (short paragraphs, no HTML)
- NEVER make up gym names or prices — only use [ACTION:SEARCH] to trigger real results`;

async function callGemini(userMessage, conversationHistory = []) {
  if (!GEMINI_API_KEY) return null;

  const contents = [];
  // Add recent conversation for context (last 4 messages max)
  for (const msg of conversationHistory.slice(-4)) {
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
        generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
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

// ─── Intent Detection (keyword-based, no AI dependency) ─────
// Simple but effective — works offline, zero latency, zero cost.
// Can upgrade to OpenAI/Claude later for complex queries.

const INTENTS = {
  SEARCH: 'search',
  BOOK: 'book', 
  CANCEL: 'cancel',
  HELP: 'help',
  STATUS: 'status',
  UNKNOWN: 'unknown',
};

function detectIntent(text) {
  const lower = text.toLowerCase().trim();
  
  // Cancel
  if (/\bcancel\b/.test(lower)) return INTENTS.CANCEL;
  
  // Book
  if (/\b(book|reserve|schedule)\b/.test(lower)) return INTENTS.BOOK;
  
  // Status / my bookings
  if (/\b(status|my booking|my session|booking code)\b/.test(lower)) return INTENTS.STATUS;
  
  // Help — greetings, general questions, non-gym messages
  if (/\b(help|start|hello|hi|hey|menu|commands|what can you|how do|how does|about|who are you|price|pricing|cost)\b/.test(lower)) return INTENTS.HELP;
  
  // Search / find — only when the message clearly wants gym results
  if (/\b(find|search|show|list|near|nearby|gym|gyms|where|city|town)\b/.test(lower)) return INTENTS.SEARCH;
  
  // If it looks like a location name (2+ chars, no special chars, no question marks), try search
  if (/^[a-z\s,'-]{2,40}$/i.test(lower) && !lower.includes('?')) return INTENTS.SEARCH;
  
  // Default: show help instead of garbage search results
  return INTENTS.UNKNOWN;
}

// ─── Entity Extraction ──────────────────────────────────────
// Pull out location, date, time, email from the message.

function extractEntities(text) {
  const entities = {};
  const lower = text.toLowerCase();
  
  // Email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) entities.email = emailMatch[0];
  
  // Date: "tomorrow", "today", "Monday", "2025-01-15", "15 Jan", "next Tuesday"
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    entities.date = d.toISOString().split('T')[0];
  } else if (/\btoday\b/.test(lower)) {
    entities.date = new Date().toISOString().split('T')[0];
  } else {
    const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) entities.date = dateMatch[0];
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
  }
  
  // Location: everything after "in", "near", "at" (excluding known keywords)
  const locMatch = lower.match(/(?:in|near|at|around)\s+(.+?)(?:\s+(?:for|on|at|tomorrow|today|\d)|\s*$)/);
  if (locMatch) {
    const loc = locMatch[1].replace(/\b(gym|gyms|fitness|a|the)\b/g, '').trim();
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
// Returns plain text (channels convert to their own format if needed)

function formatGymList(gyms) {
  if (!gyms || gyms.length === 0) {
    return "😕 No gyms found. Try a different location?\n\nExample: \"Find gyms in London\"";
  }
  
  let text = `🏋️ Found ${gyms.length} gyms:\n\n`;
  gyms.slice(0, 5).forEach((g, i) => {
    const distance = g.distanceText ? ` (${g.distanceText})` : '';
    const rating = g.rating ? ` ⭐${g.rating}` : '';
    const price = `${g.currencySymbol || '£'}${g.dayPassPrice}`;
    const open = g.openNow === true ? ' ✅Open' : g.openNow === false ? ' 🔴Closed' : '';
    text += `${i + 1}. *${g.name}*${distance}\n`;
    text += `   ${price} day pass${rating}${open}\n`;
    text += `   📍 ${g.address}\n\n`;
  });
  
  text += `\n💡 To book, say: "Book gym 1 for tomorrow"\n`;
  text += `Or: "Book [gym name] for [date] at [time]"`;
  
  return text;
}

function formatBookingConfirmation(booking, gymName) {
  return `✅ *Booking Confirmed!*\n\n` +
    `🏋️ ${gymName}\n` +
    `📅 ${booking.date}\n` +
    `⏰ ${booking.time}\n` +
    `💰 £${booking.price}\n` +
    `🔖 Code: ${booking.bookingCode}\n\n` +
    `Complete payment to get your QR entry code.\n` +
    `Free cancellation up to 2 hours before.\n\n` +
    `To cancel: "Cancel booking ${booking.id}"`;
}

// ─── Session Store (per-user conversation state) ─────────────
// Tracks last search results so user can say "Book gym 2"
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

function getSession(userId) {
  const s = sessions.get(userId);
  if (s && Date.now() - s.lastActive < SESSION_TTL) {
    s.lastActive = Date.now();
    return s;
  }
  const newSession = { lastActive: Date.now(), lastResults: [], pendingBooking: null, lastMessage: '', lastResponse: '' };
  sessions.set(userId, newSession);
  // Cleanup old sessions
  if (sessions.size > 10000) {
    const now = Date.now();
    for (const [k, v] of sessions) {
      if (now - v.lastActive > SESSION_TTL) sessions.delete(k);
    }
  }
  return newSession;
}

// ─── Main Handler ───────────────────────────────────────────
/**
 * Process a user message and return a response.
 * 
 * @param {string} userId - Unique user ID (platform-specific, e.g. telegram:12345)
 * @param {string} text - The user's message text
 * @param {object} meta - Optional metadata (userName, platform, etc.)
 * @returns {Promise<{text: string, data?: object}>} Response to send back
 */
async function handleMessage(userId, text, meta = {}) {
  if (!text || !text.trim()) {
    return { text: getHelpText() };
  }
  
  const intent = detectIntent(text);
  const entities = extractEntities(text);
  const session = getSession(userId);
  
  // Dedup: if user sends the exact same message again, don't re-process
  const normalised = text.toLowerCase().trim();
  if (session.lastMessage === normalised && session.lastResponse) {
    return { text: session.lastResponse };
  }
  
  try {
    let result;
    
    // For clear intents, use fast keyword path (zero latency)
    if (intent === INTENTS.SEARCH && entities.location) {
      result = await handleSearch(session, text, entities);
    } else if (intent === INTENTS.BOOK) {
      result = await handleBook(session, text, entities, meta);
    } else if (intent === INTENTS.CANCEL) {
      result = await handleCancel(entities);
    } else {
      // ── Gemini AI: intelligent response for everything else ──
      const aiReply = await callGemini(text, session.history || []);
      
      if (aiReply) {
        // Check if Gemini returned an action tag
        const actionMatch = aiReply.match(/\[ACTION:(SEARCH|BOOK|CANCEL|STATUS):?(.*?)\]/);
        
        if (actionMatch) {
          const action = actionMatch[1];
          const param = (actionMatch[2] || '').trim();
          
          if (action === 'SEARCH' && param) {
            // Gemini extracted a location — do the search
            result = await handleSearch(session, param, { location: param });
          } else if (action === 'BOOK') {
            result = await handleBook(session, text, entities, meta);
          } else if (action === 'CANCEL') {
            result = await handleCancel(entities);
          } else if (action === 'STATUS') {
            result = { text: "📋 To check your booking, visit scangym.com or tell me your booking code." };
          } else {
            // SEARCH without location
            result = { text: "📍 Which city would you like to find gyms in?\n\nJust type a city name like \"London\" or \"Manchester\"!" };
          }
        } else {
          // Pure conversational response from Gemini (pricing questions, what is ScanGym, etc.)
          result = { text: aiReply };
        }
      } else {
        // Gemini unavailable — fallback to keyword path
        if (intent === INTENTS.SEARCH) {
          result = await handleSearch(session, text, entities);
        } else if (intent === INTENTS.HELP) {
          result = { text: getHelpText() };
        } else if (intent === INTENTS.STATUS) {
          result = { text: "📋 To check your booking, visit scangym.com or tell me your booking code." };
        } else {
          result = { text: getHelpText() };
        }
      }
    }
    
    // Store conversation history for Gemini context (last 10 messages)
    if (!session.history) session.history = [];
    session.history.push({ role: 'user', text });
    session.history.push({ role: 'assistant', text: result.text });
    if (session.history.length > 10) session.history = session.history.slice(-10);
    
    // Store for dedup
    session.lastMessage = normalised;
    session.lastResponse = result.text;
    
    return result;
  } catch (err) {
    console.error('[MessageHandler] Error:', err);
    return { text: "😕 Something went wrong. Please try again or visit scangym.com directly." };
  }
}

async function handleSearch(session, text, entities) {
  const query = entities.location || text.replace(/\b(find|search|show|list|gym|gyms|near|nearby|me|a|the|in)\b/gi, '').trim() || text;
  
  const params = new URLSearchParams({ q: `gym in ${query}` });
  const data = await callApi(`/api/live/search?${params}`);
  
  if (data.error) {
    return { text: `😕 Search failed: ${data.error}\n\nTry: "Find gyms in Bolton"` };
  }
  
  // Store results in session for "Book gym 2" follow-ups
  session.lastResults = data.gyms || [];
  
  return { text: formatGymList(data.gyms), data: { gyms: data.gyms } };
}

async function handleBook(session, text, entities, meta) {
  // Check if user said "Book gym 2" (referencing last search)
  const numMatch = text.match(/\bgym\s*(\d+)\b/i);
  let targetGym = null;
  
  if (numMatch && session.lastResults.length > 0) {
    const idx = parseInt(numMatch[1]) - 1;
    if (idx >= 0 && idx < session.lastResults.length) {
      targetGym = session.lastResults[idx];
    }
  }
  
  // If no gym selected by number, search for it
  if (!targetGym && entities.location) {
    const params = new URLSearchParams({ q: `gym in ${entities.location}` });
    const data = await callApi(`/api/live/search?${params}`);
    if (data.gyms && data.gyms.length > 0) {
      targetGym = data.gyms[0]; // Take the top-ranked result
      session.lastResults = data.gyms;
    }
  }
  
  if (!targetGym) {
    return { 
      text: "🤔 Which gym would you like to book?\n\n" +
        "Try: \"Find gyms in Bolton\" first, then \"Book gym 1 for tomorrow\"\n" +
        "Or: \"Book a gym in Manchester for tomorrow at 3pm\""
    };
  }
  
  // Need a date
  if (!entities.date) {
    session.pendingBooking = { gym: targetGym };
    return { 
      text: `📅 When would you like to visit *${targetGym.name}*?\n\n` +
        `Say "tomorrow", "today", or a date like "2025-01-15"`
    };
  }
  
  // Need an email
  if (!entities.email) {
    session.pendingBooking = { gym: targetGym, date: entities.date, time: entities.time };
    return { 
      text: `📧 Almost there! Please share your email to complete the booking at *${targetGym.name}*.\n\n` +
        `Your email is used for the booking confirmation only.`
    };
  }
  
  // We have everything — make the booking!
  const placeId = targetGym.placeId || targetGym.id;
  
  // Step 1: Ensure gym exists in DB
  const ensureResult = await callApi('/api/live/ensure-gym', {
    method: 'POST',
    body: JSON.stringify({ placeId }),
  });
  
  if (ensureResult.error) {
    return { text: `😕 Couldn't find that gym. Please try again.` };
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
    return { text: `😕 Booking failed: ${bookingResult.error || 'Unknown error'}` };
  }
  
  session.pendingBooking = null;
  return { 
    text: formatBookingConfirmation(bookingResult.booking, targetGym.name),
    data: { booking: bookingResult.booking },
  };
}

async function handleCancel(entities) {
  if (!entities.bookingId && !entities.bookingCode) {
    return { text: "🔖 Please tell me your booking ID to cancel.\n\nExample: \"Cancel booking 123\"" };
  }
  
  if (!entities.email) {
    return { text: "📧 Please include your email for verification.\n\nExample: \"Cancel booking 123 email@example.com\"" };
  }
  
  const result = await callApi('/api/bookings/cancel', {
    method: 'POST',
    body: JSON.stringify({
      bookingId: entities.bookingId,
      email: entities.email,
    }),
  });
  
  if (result.error) {
    return { text: `😕 ${result.error}\n${result.message || ''}` };
  }
  
  return { 
    text: `✅ Booking cancelled.\n${result.message || ''}\n\n${result.refunded ? '💰 Refund will appear in 3-5 business days.' : ''}`
  };
}

function getHelpText() {
  return `👋 *Welcome to ScanGym!*\n\n` +
    `Book a gym session from right here. Here's what I can do:\n\n` +
    `🔍 *Find gyms:*\n` +
    `"Find gyms in Bolton"\n` +
    `"Gyms near Manchester"\n\n` +
    `📅 *Book a session:*\n` +
    `"Book a gym in London for tomorrow at 3pm"\n` +
    `"Book gym 1 for today" (after searching)\n\n` +
    `❌ *Cancel:*\n` +
    `"Cancel booking 123 my@email.com"\n\n` +
    `💡 Just type a city name to start searching!`;
}

module.exports = { handleMessage, detectIntent, extractEntities, INTENTS };
