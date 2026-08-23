/**
 * Book Tools — everything a customer can do on the Book tab by asking.
 *
 * Same shape as partner-tools.js: each tool is { schema, write, run }, the schema is
 * what the model sees, and `write` marks the ones that must be confirmed before they run.
 *
 * The rule that matters here: booking takes money, so book_gym is a write. The agent
 * proposes, the customer says yes, and only then does anything get charged. Reads —
 * finding a gym, checking a price, listing your bookings — just run.
 *
 * Booking itself is delegated to lib/booking-actions, which is the same code path the
 * Book button uses. The assistant must never invent its own price.
 */
const pool = require('../middleware/db');

const money = (n) => '£' + (Number(n) || 0).toFixed(2);

/** ISO date (YYYY-MM-DD) for today / tomorrow, so the model never guesses a date. */
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

const tools = {
  /* ---------- reads ---------- */

  find_gyms: {
    write: false,
    schema: {
      name: 'find_gyms',
      description:
        'Find gyms on ScanGym by name, city or area. Use this whenever the customer names a place ("a gym in Shoreditch", "PureGym Leeds") before doing anything else.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gym name, city, or area to search for.' },
          limit: { type: 'integer', description: 'How many to return (default 5, max 10).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    async run(_userId, args = {}) {
      const q = String(args.query || '').trim();
      if (!q) return { ok: false, message: 'I need a place or gym name to search for.' };

      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
      const { rows } = await pool
        .query(
          `SELECT id, name, address, city, day_pass_price, is_24h, average_rating
             FROM gyms
            WHERE is_accepting_bookings IS NOT FALSE
              AND (name ILIKE $1 OR city ILIKE $1 OR address ILIKE $1)
            ORDER BY average_rating DESC NULLS LAST, id
            LIMIT $2`,
          [`%${q}%`, limit]
        )
        .catch(() => ({ rows: [] }));

      if (!rows.length) {
        return { ok: true, gyms: [], message: `No gyms on ScanGym match "${q}" yet.` };
      }

      return {
        ok: true,
        gyms: rows.map((g) => ({
          id: g.id,
          name: g.name,
          address: g.address,
          city: g.city,
          dayPassPrice: g.day_pass_price ? Number(g.day_pass_price) : null,
          open24h: g.is_24h === true,
          rating: g.average_rating ? Number(g.average_rating) : null,
        })),
      };
    },
  },

  get_gym: {
    write: false,
    schema: {
      name: 'get_gym',
      description: 'Full details for one gym, including the current day pass price.',
      parameters: {
        type: 'object',
        properties: { gymId: { type: 'integer', description: 'The gym id from find_gyms.' } },
        required: ['gymId'],
        additionalProperties: false,
      },
    },
    async run(_userId, args = {}) {
      const { rows } = await pool
        .query(
          `SELECT id, name, address, city, country, day_pass_price, is_24h,
                  is_accepting_bookings, average_rating, total_reviews, opening_hours
             FROM gyms WHERE id = $1`,
          [args.gymId]
        )
        .catch(() => ({ rows: [] }));

      if (!rows.length) return { ok: false, message: "I couldn't find that gym." };
      const g = rows[0];

      return {
        ok: true,
        gym: {
          id: g.id,
          name: g.name,
          address: g.address,
          city: g.city,
          dayPassPrice: g.day_pass_price ? Number(g.day_pass_price) : null,
          open24h: g.is_24h === true,
          acceptingBookings: g.is_accepting_bookings !== false,
          rating: g.average_rating ? Number(g.average_rating) : null,
          reviews: g.total_reviews ? Number(g.total_reviews) : 0,
          openingHours: g.opening_hours || null,
        },
      };
    },
  },

  get_my_bookings: {
    write: false,
    schema: {
      name: 'get_my_bookings',
      description: "The customer's own bookings. Use for \"when is my next session\" or \"what have I booked\".",
      parameters: {
        type: 'object',
        properties: {
          upcomingOnly: { type: 'boolean', description: 'Only future bookings (default true).' },
        },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const upcomingOnly = args.upcomingOnly !== false;
      const { rows } = await pool
        .query(
          `SELECT b.id, b.booking_date, b.start_time, b.total_amount, b.booking_code,
                  b.status, g.name AS gym_name, g.address
             FROM public.bookings b
             LEFT JOIN public.gyms g ON g.id = b.gym_id
            WHERE b.user_id::text = $1::text
              AND b.status NOT IN ('cancelled')
              ${upcomingOnly ? 'AND b.booking_date >= CURRENT_DATE' : ''}
            ORDER BY b.booking_date, b.start_time
            LIMIT 20`,
          [String(userId)]
        )
        .catch(() => ({ rows: [] }));

      return {
        ok: true,
        bookings: rows.map((b) => ({
          id: b.id,
          gymName: b.gym_name,
          address: b.address,
          date: b.booking_date,
          time: b.start_time,
          price: Number(b.total_amount) || 0,
          bookingCode: b.booking_code,
          status: b.status,
        })),
      };
    },
  },

  today_and_tomorrow: {
    write: false,
    schema: {
      name: 'today_and_tomorrow',
      description:
        "Today's and tomorrow's dates. Call this before booking whenever the customer says \"today\", \"tomorrow\" or \"tonight\" — never guess the date.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run() {
      return { ok: true, today: isoDate(0), tomorrow: isoDate(1) };
    },
  },

  /* ---------- write: takes money, always confirmed first ---------- */

  book_gym: {
    write: true,
    schema: {
      name: 'book_gym',
      description:
        'Book a day pass. Takes payment, so it is always confirmed with the customer first. State the gym, date, time and price before calling.',
      parameters: {
        type: 'object',
        properties: {
          gymId: { type: 'integer', description: 'The gym id from find_gyms.' },
          date: { type: 'string', description: 'Date as YYYY-MM-DD.' },
          time: { type: 'string', description: 'Start time as HH:MM (24h). Omit for the next hour.' },
        },
        required: ['gymId', 'date'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const { createBooking } = require('./booking-actions');
      const result = await createBooking({
        userId,
        gymId: args.gymId,
        date: args.date,
        time: args.time,
      });

      if (!result.ok) return { ok: false, message: result.message };

      const b = result.booking;
      return {
        ok: true,
        message: `Booked — ${b.gymName}, ${b.date} at ${b.time}, ${money(b.price)}. Your code is ${b.bookingCode}.`,
        booking: b,
      };
    },
  },
};

/** Tool schemas in OpenAI chat-completions format. */
function openAiTools() {
  return Object.values(tools).map((t) => ({ type: 'function', function: t.schema }));
}

/** Execute a tool by name, always scoped to the authenticated customer. */
async function execute(name, args, userId, req) {
  const tool = tools[name];
  if (!tool) return { ok: false, message: `Unknown tool: ${name}` };
  try {
    return await tool.run(userId, args || {}, req);
  } catch (err) {
    console.error(`[BookTools] ${name} failed:`, err.message);
    return { ok: false, message: 'That action failed — nothing was booked.' };
  }
}

const isWrite = (name) => !!tools[name]?.write;

module.exports = { tools, openAiTools, execute, isWrite };
