/**
 * HTTP MCP endpoint for the ScanGym ChatGPT app (Apps SDK).
 *
 * Implements the MCP Streamable HTTP transport (JSON responses):
 *   POST /mcp  — JSON-RPC: initialize, notifications/initialized,
 *                tools/list, tools/call
 *   GET  /mcp  — 405 (no server-initiated stream needed)
 *
 * Tools mirror server/mcp/scangym-mcp-server.js (stdio version) but run
 * in-process against our own public API, so ChatGPT web/mobile and review
 * test cases hit the exact same logic users do.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const SERVER_INFO = { name: 'scangym', version: '1.1.1' };
const PROTOCOL_VERSION = '2025-03-26';

function apiBase() {
  return process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 5000}`;
}

async function callApi(path, options = {}) {
  try {
    const resp = await fetch(`${apiBase()}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    return await resp.json();
  } catch (err) {
    return { error: `API request failed: ${err.message}` };
  }
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(amount, symbol = '£') {
  const numeric = toNumber(amount);
  return numeric != null && numeric > 0 ? `${symbol}${numeric.toFixed(2)}` : 'Price shown on ScanGym';
}

function formatGym(g) {
  const symbol = g.currencySymbol || g.pricing?.currencySymbol || '£';
  const dayPassPrice = toNumber(g.dayPassPrice ?? g.pricing?.dayPassPrice);
  return {
    placeId: g.placeId || g.id,
    name: g.name,
    address: g.address,
    distance: g.distanceText || null,
    price: `${formatMoney(dayPassPrice, symbol)} day pass`,
    rating: g.rating ? `${g.rating}★ (${g.totalReviews} reviews)` : 'No reviews yet',
    openNow: g.openNow === true ? 'Open now' : g.openNow === false ? 'Closed' : 'Unknown',
  };
}

// ─── Tool definitions ────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_gyms',
    title: 'Search Gyms',
    description: 'Search for gyms by city/location name or coordinates. Returns a ranked list of nearby gyms with prices, ratings, and availability.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "gym in Bolton", "fitness centre London"' },
        latitude: { type: 'number', description: 'User latitude for nearby search' },
        longitude: { type: 'number', description: 'User longitude for nearby search' },
        radius: { type: 'number', description: 'Search radius in meters (default 5000, max 50000)' },
      },
      required: [],
    },
  },
  {
    name: 'get_gym_details',
    title: 'Get Gym Details',
    description: 'Get full details for a specific gym including pricing, opening hours, photos, reviews, and address. Use the placeId from search results.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        placeId: { type: 'string', description: 'Google Places ID of the gym (from search results)' },
      },
      required: ['placeId'],
    },
  },
  {
    name: 'check_availability',
    title: 'Check Availability',
    description: 'Check whether a gym appears available for a requested date/time. Read-only; does not create a booking.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        placeId: { type: 'string', description: 'Google Places ID of the gym' },
        date: { type: 'string', description: 'Requested booking date in YYYY-MM-DD format' },
        time: { type: 'string', description: 'Requested start time HH:MM (24h), or "anytime"' },
      },
      required: ['placeId', 'date'],
    },
  },
  {
    name: 'book_gym_session',
    title: 'Book Gym Session',
    description: 'Reserve a provisional day-pass slot at a gym. Requires confirmed=true after the user has reviewed the gym, date/time, and email. The reservation is completed later on scangym.com; nothing is finalized inside ChatGPT.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        placeId: { type: 'string', description: 'Google Places ID of the gym to book' },
        date: { type: 'string', description: 'Booking date in YYYY-MM-DD format' },
        time: { type: 'string', description: 'Preferred start time HH:MM (24h), or "anytime"' },
        email: { type: 'string', description: 'User email for booking confirmation and receipt' },
        name: { type: 'string', description: 'User name for the booking' },
        confirmed: { type: 'boolean', description: 'Must be true only after the user explicitly confirms the gym, date/time, and email.' },
      },
      required: ['placeId', 'date', 'email', 'confirmed'],
    },
  },
  {
    name: 'cancel_booking',
    title: 'Cancel Booking',
    description: 'Cancel a gym booking. Free cancellation up to 2 hours before the session.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        bookingId: { type: 'number', description: 'The booking ID to cancel' },
        email: { type: 'string', description: 'Email used when booking (for verification)' },
        bookingCode: { type: 'string', description: 'Booking code from the confirmation (e.g. 9MW6-959Q)' },
      },
      required: ['bookingId', 'email', 'bookingCode'],
    },
  },
];

// ─── Tool implementations ────────────────────────────────────

async function searchGyms({ query, latitude, longitude, radius }) {
  if (latitude && longitude) {
    const params = new URLSearchParams({ lat: String(latitude), lng: String(longitude), radius: String(radius || 5000) });
    const data = await callApi(`/api/live/nearby?${params}`);
    if (data.error) return { error: data.error };
    return { total: data.total || (data.gyms || []).length, gyms: (data.gyms || []).slice(0, 10).map(formatGym) };
  }
  if (!query) return { error: 'Provide a search query (e.g. "gym in Bolton") or latitude/longitude.' };
  const data = await callApi(`/api/live/search?${new URLSearchParams({ q: query })}`);
  if (data.error) return { error: data.error };
  return { total: data.total || (data.gyms || []).length, gyms: (data.gyms || []).slice(0, 10).map(formatGym) };
}

async function getGymDetails({ placeId }) {
  if (!placeId) return { error: 'placeId is required' };
  const data = await callApi(`/api/live/place/${encodeURIComponent(placeId)}`);
  if (data.error) return { error: data.error };
  const gym = data.gym || {};
  const pricing = data.pricing || {};
  const rating = data.rating || {};
  const hours = data.openingHours || {};
  return {
    name: gym.name,
    address: gym.address,
    phone: gym.phone || 'Not listed',
    website: gym.website || 'Not listed',
    pricing: { dayPass: formatMoney(pricing.dayPassPrice, pricing.currencySymbol || '£'), currency: pricing.currency },
    rating: {
      google: rating.google ? `${rating.google}★ (${rating.googleTotal} reviews)` : 'No Google reviews',
      scangym: rating.scangym ? `${rating.scangym.average}★ (${rating.scangym.total} ScanGym reviews)` : 'No ScanGym reviews yet',
    },
    openingHours: hours.weekday || [],
    isOpenNow: hours.isOpen,
    photos: (data.photos || []).slice(0, 3).map(p => p.url),
  };
}

async function checkAvailability({ placeId, date, time }) {
  if (!placeId || !date) return { error: 'placeId and date are required.' };
  const data = await callApi(`/api/live/place/${encodeURIComponent(placeId)}`);
  if (data.error) return { error: data.error };
  const pricing = data.pricing || {};
  const hours = data.openingHours || {};
  return {
    available: true,
    provisional: true,
    gymName: (data.gym || {}).name,
    address: (data.gym || {}).address,
    date,
    time: time || 'anytime',
    price: formatMoney(pricing.dayPassPrice, pricing.currencySymbol || '£'),
    isOpenNow: hours.isOpen,
    openingHours: hours.weekday || [],
    message: 'ScanGym can create a provisional booking for this gym. Confirm gym, date/time, and email with the user before booking.',
  };
}

async function bookGymSession({ placeId, date, time, email, name, confirmed }) {
  if (!placeId || !date || !email) return { error: 'placeId, date, and email are required.' };
  if (confirmed !== true) {
    return {
      confirmationRequired: true,
      message: 'Ask the user to confirm the gym, date/time, and email, then call again with confirmed=true. The reservation is completed later on scangym.com.',
      requestedBooking: { placeId, date, time: time || 'anytime', email, name: name || null },
    };
  }
  const ensureResult = await callApi('/api/live/ensure-gym', { method: 'POST', body: JSON.stringify({ placeId }) });
  if (ensureResult.error) return { error: `Could not find gym: ${ensureResult.error}` };
  const bookingResult = await callApi('/api/bookings/guest-create', {
    method: 'POST',
    body: JSON.stringify({ gymId: ensureResult.gymId, date, time: time || 'anytime', email, name: name || 'ChatGPT Booking' }),
  });
  if (!bookingResult.success) return { error: bookingResult.error || 'Booking failed' };
  const b = bookingResult.booking;
  return {
    success: true,
    bookingId: b.id,
    bookingCode: b.bookingCode,
    gymName: b.gymName || ensureResult.name,
    date: b.date,
    time: b.time,
    price: `${b.currency === 'GBP' ? '£' : ''}${b.price}`,
    status: b.status,
    paymentLink: b.paymentUrl,
    message: 'Booking created! Finish the reservation at the link to receive the QR entry code. Free cancellation up to 2 hours before the session.',
  };
}

async function cancelBooking({ bookingId, email, bookingCode }) {
  if (!bookingId || !email || !bookingCode) return { error: 'bookingId, email and bookingCode are required' };
  const result = await callApi('/api/bookings/cancel', { method: 'POST', body: JSON.stringify({ bookingId, email, bookingCode }) });
  if (result.error) return { error: result.error, message: result.message };
  return { success: true, refunded: result.refunded, message: result.message };
}

const HANDLERS = {
  search_gyms: searchGyms,
  get_gym_details: getGymDetails,
  check_availability: checkAvailability,
  book_gym_session: bookGymSession,
  cancel_booking: cancelBooking,
};

// ─── JSON-RPC over HTTP ──────────────────────────────────────

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleRpc(msg) {
  const { id, method, params } = msg || {};
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'notifications/initialized':
      return null; // notification — no response body
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      console.log(`[MCP] tools/call ${params?.name} args=${JSON.stringify(params?.arguments || {})}`);
      const handler = HANDLERS[params?.name];
      if (!handler) return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await handler(params?.arguments || {});
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: Boolean(result && result.error),
        });
      } catch (err) {
        console.error(`[MCP] tool ${params?.name} failed:`, err);
        return rpcError(id, -32603, `Tool execution failed: ${err.message}`);
      }
    }
    default:
      if (String(method || '').startsWith('notifications/')) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function isInitialize(body) {
  if (Array.isArray(body)) return body.some((m) => m && m.method === 'initialize');
  return body && body.method === 'initialize';
}

router.post('/', async (req, res) => {
  const body = req.body;
  try {
    // Streamable HTTP transport: assign a session ID on initialize and
    // echo/accept it on subsequent requests so clients (ChatGPT) keep the
    // connector alive for the whole conversation.
    if (isInitialize(body)) {
      res.setHeader('Mcp-Session-Id', crypto.randomUUID());
    } else if (req.headers['mcp-session-id']) {
      res.setHeader('Mcp-Session-Id', req.headers['mcp-session-id']);
    }
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map(handleRpc))).filter(Boolean);
      if (responses.length === 0) return res.status(202).end();
      return res.json(responses);
    }
    const response = await handleRpc(body);
    if (!response) return res.status(202).end();
    return res.json(response);
  } catch (err) {
    console.error('[MCP] request failed:', err);
    return res.status(500).json(rpcError(body?.id ?? null, -32603, 'Internal error'));
  }
});

// Server-initiated SSE stream. We never push messages, but clients that open
// this stream must not get a hard 405 mid-conversation — keep it open with
// periodic keep-alive comments instead.
router.get('/', (req, res) => {
  const accept = String(req.headers.accept || '');
  if (!accept.includes('text/event-stream')) {
    return res
      .status(405)
      .json({ error: 'Method Not Allowed. POST JSON-RPC messages to this endpoint.' });
  }
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (req.headers['mcp-session-id']) {
    res.setHeader('Mcp-Session-Id', req.headers['mcp-session-id']);
  }
  res.flushHeaders?.();
  res.write(': connected\n\n');
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15000);
  req.on('close', () => clearInterval(keepAlive));
});

router.delete('/', (req, res) => {
  res.status(200).end();
});

module.exports = router;
