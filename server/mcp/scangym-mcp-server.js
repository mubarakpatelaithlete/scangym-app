#!/usr/bin/env node
/**
 * ScanGym MCP Server — Book a gym from Claude, Cursor, or any MCP client.
 * 
 * Model Context Protocol (MCP) server that exposes ScanGym's gym search
 * and booking APIs as tools that AI assistants can call.
 * 
 * Tools:
 *   search_gyms      — Find gyms by location or name
 *   get_gym_details   — Get full details, pricing, hours, photos for a gym
 *   book_gym_session  — Book a day pass at a gym
 *   cancel_booking    — Cancel an existing booking
 * 
 * Usage:
 *   SCANGYM_API_URL=https://scangym.com node scangym-mcp-server.js
 * 
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "scangym": {
 *         "command": "node",
 *         "args": ["/path/to/scangym-mcp-server.js"],
 *         "env": { "SCANGYM_API_URL": "https://scangym.com" }
 *       }
 *     }
 *   }
 */

const SCANGYM_API = (process.env.SCANGYM_API_URL || 'https://scangym.com').replace(/\/+$/, '');

// ─── MCP Protocol over stdio (JSON-RPC 2.0) ─────────────────
// The MCP spec uses JSON-RPC messages over stdin/stdout.
// We implement the minimum: initialize, tools/list, tools/call.

const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, terminal: false });

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  
  // MCP uses newline-delimited JSON
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (line) {
      try {
        handleMessage(JSON.parse(line));
      } catch (e) {
        sendError(null, -32700, 'Parse error: ' + e.message);
      }
    }
  }
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ─── Tool Definitions ────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_gyms',
    description: 'Search for gyms by location name or coordinates. Returns a ranked list of nearby gyms with prices, ratings, and availability. Example: "gyms in Bolton" or "gyms near me" with lat/lng.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query, e.g. "gym in Bolton", "fitness centre London", "CrossFit near Manchester"',
        },
        latitude: {
          type: 'number',
          description: 'User latitude for nearby search (more accurate than text query)',
        },
        longitude: {
          type: 'number',
          description: 'User longitude for nearby search',
        },
        radius: {
          type: 'number',
          description: 'Search radius in meters (default 5000, max 50000)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_gym_details',
    description: 'Get full details for a specific gym including pricing, opening hours, photos, reviews, and address. Use the placeId from search results.',
    inputSchema: {
      type: 'object',
      properties: {
        placeId: {
          type: 'string',
          description: 'Google Places ID of the gym (from search results)',
        },
      },
      required: ['placeId'],
    },
  },
  {
    name: 'book_gym_session',
    description: 'Book a day pass at a gym. Creates a booking and returns a booking code + payment link. The user pays via the link, then gets a QR code for gym entry.',
    inputSchema: {
      type: 'object',
      properties: {
        placeId: {
          type: 'string',
          description: 'Google Places ID of the gym to book',
        },
        date: {
          type: 'string',
          description: 'Booking date in YYYY-MM-DD format',
        },
        time: {
          type: 'string',
          description: 'Preferred start time in HH:MM format (24h), or "anytime" for flexible',
        },
        email: {
          type: 'string',
          description: 'User email for booking confirmation and receipt',
        },
        name: {
          type: 'string',
          description: 'User name for the booking',
        },
      },
      required: ['placeId', 'date', 'email'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel a gym booking. Free cancellation up to 2 hours before the session. Refund is automatic if paid.',
    inputSchema: {
      type: 'object',
      properties: {
        bookingId: {
          type: 'number',
          description: 'The booking ID to cancel',
        },
        email: {
          type: 'string',
          description: 'Email used when booking (for verification)',
        },
      },
      required: ['bookingId', 'email'],
    },
  },
];

// ─── Tool Implementations ────────────────────────────────────

async function callApi(path, options = {}) {
  const url = `${SCANGYM_API}${path}`;
  try {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    return await resp.json();
  } catch (err) {
    return { error: `API request failed: ${err.message}` };
  }
}

async function searchGyms(args) {
  const { query, latitude, longitude, radius } = args;

  // Use nearby search if coordinates provided, text search otherwise
  if (latitude && longitude) {
    const params = new URLSearchParams({
      lat: String(latitude),
      lng: String(longitude),
      radius: String(radius || 5000),
    });
    const data = await callApi(`/api/live/nearby?${params}`);
    if (data.error) return { error: data.error };

    const gyms = (data.gyms || []).slice(0, 10).map(formatGym);
    return {
      total: data.total || gyms.length,
      gyms,
      tip: 'Use get_gym_details with a placeId to see full info. Use book_gym_session to book.',
    };
  }

  if (!query) {
    return { error: 'Please provide a search query (e.g. "gym in Bolton") or latitude/longitude coordinates.' };
  }

  const params = new URLSearchParams({ q: query });
  if (latitude && longitude) {
    params.set('lat', String(latitude));
    params.set('lng', String(longitude));
  }
  const data = await callApi(`/api/live/search?${params}`);
  if (data.error) return { error: data.error };

  const gyms = (data.gyms || []).slice(0, 10).map(formatGym);
  return {
    total: data.total || gyms.length,
    gyms,
    tip: 'Use get_gym_details with a placeId to see full info. Use book_gym_session to book.',
  };
}

function formatGym(g) {
  return {
    placeId: g.placeId || g.id,
    name: g.name,
    address: g.address,
    distance: g.distanceText || null,
    price: `${g.currencySymbol || '£'}${g.dayPassPrice} day pass`,
    rating: g.rating ? `${g.rating}★ (${g.totalReviews} reviews)` : 'No reviews yet',
    openNow: g.openNow === true ? 'Open now' : g.openNow === false ? 'Closed' : 'Unknown',
    rankingScore: g.rankingScore || null,
  };
}

async function getGymDetails(args) {
  const { placeId } = args;
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
    googleMaps: gym.googleMapsUrl,
    pricing: {
      dayPass: `${pricing.currencySymbol || '£'}${pricing.dayPassPrice}`,
      currency: pricing.currency,
    },
    rating: {
      google: rating.google ? `${rating.google}★ (${rating.googleTotal} reviews)` : 'No Google reviews',
      scangym: rating.scangym ? `${rating.scangym.average}★ (${rating.scangym.total} ScanGym reviews)` : 'No ScanGym reviews yet',
    },
    openingHours: hours.weekday || [],
    isOpenNow: hours.isOpen,
    photos: (data.photos || []).slice(0, 3).map(p => p.url),
    bookingTip: `To book, use book_gym_session with placeId "${placeId}", a date (YYYY-MM-DD), and the user's email.`,
  };
}

async function bookGymSession(args) {
  const { placeId, date, time, email, name } = args;

  if (!placeId || !date || !email) {
    return { error: 'placeId, date, and email are required.' };
  }

  // Step 1: Ensure gym exists in our DB (creates record if needed)
  const ensureResult = await callApi('/api/live/ensure-gym', {
    method: 'POST',
    body: JSON.stringify({ placeId }),
  });

  if (ensureResult.error) {
    return { error: `Could not find gym: ${ensureResult.error}` };
  }

  const gymId = ensureResult.gymId;
  const gymName = ensureResult.name;

  // Step 2: Create guest booking (no auth required)
  const bookingResult = await callApi('/api/bookings/guest-create', {
    method: 'POST',
    body: JSON.stringify({
      gymId,
      date,
      time: time || 'anytime',
      email,
      name: name || 'MCP Booking',
    }),
  });

  if (!bookingResult.success) {
    return { error: bookingResult.error || 'Booking failed' };
  }

  const b = bookingResult.booking;
  return {
    success: true,
    bookingCode: b.bookingCode,
    gymName: b.gymName || gymName,
    date: b.date,
    time: b.time,
    price: `£${b.price}`,
    status: b.status,
    paymentLink: `${SCANGYM_API}/booking/${b.id}/pay`,
    message: `Booking created! The user needs to complete payment at the link above. After paying, they'll receive a QR code for gym entry. Free cancellation up to 2 hours before the session.`,
  };
}

async function cancelBooking(args) {
  const { bookingId, email } = args;
  if (!bookingId || !email) {
    return { error: 'bookingId and email are required' };
  }

  const result = await callApi('/api/bookings/cancel', {
    method: 'POST',
    body: JSON.stringify({ bookingId, email }),
  });

  if (result.error) {
    return { error: result.error, message: result.message };
  }

  return {
    success: true,
    refunded: result.refunded,
    message: result.message,
  };
}

// ─── MCP Message Handler ─────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      sendResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'scangym',
          version: '1.0.0',
        },
      });
      break;

    case 'notifications/initialized':
      // Client acknowledged init — no response needed
      break;

    case 'tools/list':
      sendResult(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      let result;
      try {
        switch (toolName) {
          case 'search_gyms':
            result = await searchGyms(toolArgs);
            break;
          case 'get_gym_details':
            result = await getGymDetails(toolArgs);
            break;
          case 'book_gym_session':
            result = await bookGymSession(toolArgs);
            break;
          case 'cancel_booking':
            result = await cancelBooking(toolArgs);
            break;
          default:
            sendError(id, -32601, `Unknown tool: ${toolName}`);
            return;
        }
      } catch (err) {
        sendError(id, -32603, `Tool execution failed: ${err.message}`);
        return;
      }

      sendResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      });
      break;
    }

    default:
      if (id != null) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
      // Notifications (no id) for unknown methods are silently ignored per spec
  }
}

// Handle clean shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Log to stderr (stdout is reserved for MCP protocol)
process.stderr.write('ScanGym MCP server started — waiting for MCP client connection...\n');
