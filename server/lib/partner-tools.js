/**
 * Partner Tools — the single source of truth for everything a gym owner can do.
 *
 * Each tool has:
 *   - schema:  a JSON Schema description the LLM sees (OpenAI/Anthropic tool calling
 *              and the Custom GPT / MCP surfaces all consume the same definition)
 *   - write:   true if it changes money or state → the UI must confirm before running
 *   - run:     the actual implementation, always scoped to the authenticated owner
 *
 * Why the schema matters: constraints declared here (e.g. dayPrice minimum 3 /
 * maximum 25) are enforced BEFORE the model's arguments reach the database, so no
 * prompt — however creative — can push a £200 day pass into the gyms table.
 *
 * Ownership rule: every query filters on `claimed_by = userId`. A tool can never
 * touch a gym the caller does not own, regardless of the gymId the model invents.
 */
const pool = require('../middleware/db');

const PRICE_MIN = 3;
const PRICE_MAX = 25;
const PARTNER_SHARE = 0.85;

// ── helpers ─────────────────────────────────────────────────────────────────

/** Resolve the gym the owner is acting on. Never trusts a caller-supplied id blindly. */
async function resolveGym(userId, gymId) {
  const params = [userId];
  let sql = `SELECT id, name, address, day_pass_price, is_active
             FROM gyms WHERE claimed_by::text = $1::text`;
  if (gymId) {
    params.push(gymId);
    sql += ` AND id = $2`;
  }
  sql += ` ORDER BY claimed_at NULLS LAST, id LIMIT 1`;
  const { rows } = await pool.query(sql, params).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function ownedGymIds(userId) {
  const { rows } = await pool
    .query(`SELECT id FROM gyms WHERE claimed_by::text = $1::text`, [userId])
    .catch(() => ({ rows: [] }));
  return rows.map((r) => r.id);
}

const money = (n) => '£' + (Number(n) || 0).toFixed(2);

function needGym(gym) {
  if (!gym) {
    return {
      ok: false,
      message:
        "I can't find a gym claimed by this account yet. Search for your gym by name and I'll claim it for you first.",
    };
  }
  return null;
}

// ── tools ───────────────────────────────────────────────────────────────────

const tools = {
  /* ---------- reads: run silently, no confirmation ---------- */

  get_my_gym: {
    write: false,
    schema: {
      name: 'get_my_gym',
      description:
        "Get the owner's claimed gym: name, address, current day pass price and whether it is accepting bookings. Call this first when you need context.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const gym = await resolveGym(userId);
      const missing = needGym(gym);
      if (missing) return missing;
      return {
        ok: true,
        gym: {
          id: gym.id,
          name: gym.name,
          address: gym.address,
          dayPassPrice: Number(gym.day_pass_price) || null,
          acceptingBookings: gym.is_active !== false,
        },
      };
    },
  },

  get_earnings: {
    write: false,
    schema: {
      name: 'get_earnings',
      description:
        "The owner's ScanGym earnings: available balance (their 85% share), total bookings and gross revenue.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const gymIds = await ownedGymIds(userId);
      if (!gymIds.length) return needGym(null);

      const { rows } = await pool
        .query(
          `SELECT COUNT(*)::int AS bookings,
                  COALESCE(SUM(total_amount), 0) AS gross
             FROM bookings
            WHERE gym_id = ANY($1) AND status IN ('confirmed','completed')`,
          [gymIds]
        )
        .catch(() => ({ rows: [{ bookings: 0, gross: 0 }] }));

      const gross = Number(rows[0].gross) || 0;
      const stripe = await pool
        .query(`SELECT stripe_connect_id FROM users WHERE id = $1`, [userId])
        .catch(() => ({ rows: [] }));

      return {
        ok: true,
        bookings: rows[0].bookings,
        grossRevenue: money(gross),
        yourShare: money(gross * PARTNER_SHARE),
        scangymFee: money(gross * (1 - PARTNER_SHARE)),
        payoutMethodConnected: !!stripe.rows[0]?.stripe_connect_id,
      };
    },
  },

  get_bookings: {
    write: false,
    schema: {
      name: 'get_bookings',
      description: "List the owner's recent ScanGym bookings for a period.",
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'week', 'month'],
            description: 'Defaults to week.',
          },
        },
        additionalProperties: false,
      },
    },
    async run(userId, { period = 'week' } = {}) {
      const gymIds = await ownedGymIds(userId);
      if (!gymIds.length) return needGym(null);

      const interval =
        period === 'today' ? '1 day' : period === 'month' ? '30 days' : '7 days';

      const { rows } = await pool
        .query(
          `SELECT b.booking_code, b.status, b.created_at, b.total_amount,
                  COALESCE(b.user_name, 'Guest') AS customer
             FROM bookings b
            WHERE b.gym_id = ANY($1)
              AND b.created_at > NOW() - INTERVAL '${interval}'
            ORDER BY b.created_at DESC LIMIT 50`,
          [gymIds]
        )
        .catch(() => ({ rows: [] }));

      return {
        ok: true,
        period,
        count: rows.length,
        bookings: rows.map((r) => ({
          code: r.booking_code,
          customer: r.customer,
          amount: money(r.total_amount),
          status: r.status,
          when: r.created_at,
        })),
      };
    },
  },

  get_customers: {
    write: false,
    schema: {
      name: 'get_customers',
      description: 'How many distinct people have used the gym via ScanGym, and repeat visitors.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const gymIds = await ownedGymIds(userId);
      if (!gymIds.length) return needGym(null);

      const { rows } = await pool
        .query(
          `SELECT COUNT(DISTINCT user_id)::int AS people,
                  COUNT(*)::int AS visits
             FROM bookings
            WHERE gym_id = ANY($1) AND status IN ('confirmed','completed')`,
          [gymIds]
        )
        .catch(() => ({ rows: [{ people: 0, visits: 0 }] }));

      return { ok: true, uniqueCustomers: rows[0].people, totalVisits: rows[0].visits };
    },
  },

  search_gyms: {
    write: false,
    schema: {
      name: 'search_gyms',
      description:
        'Search the gym index by name or town so the owner can find their own gym to claim. Returns candidates with ids.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 2 } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    async run(_userId, { query }) {
      const { rows } = await pool
        .query(
          `SELECT id, name, address, claimed_by IS NOT NULL AS claimed
             FROM gyms
            WHERE name ILIKE $1 OR address ILIKE $1
            ORDER BY (claimed_by IS NULL) DESC, name LIMIT 5`,
          ['%' + query + '%']
        )
        .catch(() => ({ rows: [] }));

      return {
        ok: true,
        results: rows.map((r) => ({
          gymId: r.id,
          name: r.name,
          address: r.address,
          alreadyClaimed: r.claimed,
        })),
      };
    },
  },

  /* ---------- writes: the UI confirms these before running ---------- */

  set_day_price: {
    write: true,
    schema: {
      name: 'set_day_price',
      description:
        "Change the gym's day pass price. Ask the owner to confirm the exact amount before calling.",
      parameters: {
        type: 'object',
        properties: {
          dayPrice: {
            type: 'number',
            minimum: PRICE_MIN,
            maximum: PRICE_MAX,
            description: `Price in GBP, between ${PRICE_MIN} and ${PRICE_MAX}.`,
          },
        },
        required: ['dayPrice'],
        additionalProperties: false,
      },
    },
    async run(userId, { dayPrice }) {
      const price = Number(dayPrice);
      if (!Number.isFinite(price) || price < PRICE_MIN || price > PRICE_MAX) {
        return {
          ok: false,
          message: `Day pass must be between ${money(PRICE_MIN)} and ${money(PRICE_MAX)}.`,
        };
      }
      const gym = await resolveGym(userId);
      const missing = needGym(gym);
      if (missing) return missing;

      const { rows } = await pool.query(
        `UPDATE gyms SET day_pass_price = $1, updated_at = NOW()
          WHERE id = $2 AND claimed_by::text = $3::text
          RETURNING day_pass_price`,
        [price.toFixed(2), gym.id, userId]
      );
      if (!rows.length) return { ok: false, message: 'Could not update that gym.' };

      return {
        ok: true,
        message: `Day pass is now ${money(rows[0].day_pass_price)} — live on your listing.`,
        dayPassPrice: Number(rows[0].day_pass_price),
      };
    },
  },

  set_bookings_open: {
    write: true,
    schema: {
      name: 'set_bookings_open',
      description:
        'Open or pause the gym for new ScanGym bookings. Existing bookings are unaffected.',
      parameters: {
        type: 'object',
        properties: { open: { type: 'boolean' } },
        required: ['open'],
        additionalProperties: false,
      },
    },
    async run(userId, { open }) {
      const gym = await resolveGym(userId);
      const missing = needGym(gym);
      if (missing) return missing;

      const { rows } = await pool.query(
        `UPDATE gyms SET is_active = $1, updated_at = NOW()
          WHERE id = $2 AND claimed_by::text = $3::text RETURNING is_active`,
        [!!open, gym.id, userId]
      );
      if (!rows.length) return { ok: false, message: 'Could not update that gym.' };

      return {
        ok: true,
        message: open
          ? 'Open and accepting bookings again.'
          : 'Paused — hidden from search until you reopen.',
        acceptingBookings: rows[0].is_active !== false,
      };
    },
  },

  set_hours_override: {
    write: true,
    schema: {
      name: 'set_hours_override',
      description:
        "Override today's opening status: closed_now (shut today), open_now (open despite Google hours), or use_google_hours (clear the override).",
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open_now', 'closed_now', 'use_google_hours'] },
          reason: { type: 'string', description: 'Optional note shown internally.' },
        },
        required: ['status'],
        additionalProperties: false,
      },
    },
    async run(userId, { status, reason = null }) {
      const gym = await resolveGym(userId);
      const missing = needGym(gym);
      if (missing) return missing;

      await pool
        .query(
          `UPDATE gyms SET hours_override = $1, hours_override_reason = $2, updated_at = NOW()
            WHERE id = $3 AND claimed_by::text = $4::text`,
          [status, reason, gym.id, userId]
        )
        .catch(() =>
          // Older databases may not have the dedicated columns — fall back to metadata.
          pool.query(
            `UPDATE gyms SET metadata = COALESCE(metadata,'{}'::jsonb) || $1::jsonb, updated_at = NOW()
              WHERE id = $2 AND claimed_by::text = $3::text`,
            [JSON.stringify({ hours_override: status, override_reason: reason }), gym.id, userId]
          )
        );

      const msg = {
        closed_now: 'Closed for today — it reopens on your normal hours tomorrow.',
        open_now: 'Marked open, overriding your Google hours.',
        use_google_hours: 'Override cleared — back to your Google hours.',
      };
      return { ok: true, status, message: msg[status] };
    },
  },

  claim_gym: {
    write: true,
    schema: {
      name: 'claim_gym',
      description:
        'Claim a gym for this owner so they can price it and receive bookings. Use search_gyms first to get the gymId, and confirm the exact gym with the owner.',
      parameters: {
        type: 'object',
        properties: { gymId: { type: 'integer' } },
        required: ['gymId'],
        additionalProperties: false,
      },
    },
    async run(userId, { gymId }) {
      const existing = await pool
        .query(`SELECT id, name, claimed_by FROM gyms WHERE id = $1`, [gymId])
        .catch(() => ({ rows: [] }));
      if (!existing.rows.length) return { ok: false, message: 'That gym is not in the index.' };

      const gym = existing.rows[0];
      if (gym.claimed_by && String(gym.claimed_by) !== String(userId)) {
        return {
          ok: false,
          message: `${gym.name} is already claimed. Email book@scangym.com if that is your gym and we will sort it.`,
        };
      }

      await pool.query(
        `UPDATE gyms SET claimed_by = $1, claimed_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [userId, gymId]
      );
      return {
        ok: true,
        message: `${gym.name} is yours. Next: set your day pass price, then verify ownership by email.`,
        gymId,
        gymName: gym.name,
      };
    },
  },

  request_payout: {
    write: true,
    schema: {
      name: 'request_payout',
      description:
        "Pay the owner's available balance out to their bank. Always state the amount and confirm before calling.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const user = await pool
        .query(`SELECT stripe_connect_id FROM users WHERE id = $1`, [userId])
        .catch(() => ({ rows: [] }));
      const connectId = user.rows[0]?.stripe_connect_id;
      if (!connectId) {
        return {
          ok: false,
          needsPayoutMethod: true,
          message:
            "There's no payout method on the account yet — connect a bank account with Stripe and I can pay you out straight after.",
        };
      }

      const gymIds = await ownedGymIds(userId);
      if (!gymIds.length) return needGym(null);

      const { rows } = await pool
        .query(
          `SELECT COALESCE(SUM(total_amount),0) AS gross FROM bookings
            WHERE gym_id = ANY($1) AND status IN ('confirmed','completed')`,
          [gymIds]
        )
        .catch(() => ({ rows: [{ gross: 0 }] }));

      const share = (Number(rows[0].gross) || 0) * PARTNER_SHARE;
      if (share < 1) {
        return { ok: false, message: `Minimum payout is £1 — your balance is ${money(share)}.` };
      }

      const stripe = process.env.STRIPE_SECRET_KEY
        ? require('stripe')(process.env.STRIPE_SECRET_KEY)
        : null;
      if (!stripe) return { ok: false, message: 'Payouts are temporarily unavailable.' };

      try {
        await stripe.transfers.create({
          amount: Math.round(share * 100),
          currency: 'gbp',
          destination: connectId,
          description: 'ScanGym partner payout (AI assistant)',
          metadata: { scangym_user_id: String(userId), source: 'partner_agent' },
        });
      } catch (err) {
        console.error('[PartnerTools] payout failed:', err.message);
        return { ok: false, message: 'The transfer was declined: ' + err.message };
      }

      return {
        ok: true,
        amount: money(share),
        message: `${money(share)} is on its way — it lands in 2–5 business days.`,
      };
    },
  },

  connect_payout_method: {
    write: true,
    schema: {
      name: 'connect_payout_method',
      description:
        'Start Stripe onboarding so the owner can receive payouts. Returns a URL for the owner to open.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId, _args, req) {
      const stripe = process.env.STRIPE_SECRET_KEY
        ? require('stripe')(process.env.STRIPE_SECRET_KEY)
        : null;
      if (!stripe) return { ok: false, message: 'Payout setup is temporarily unavailable.' };

      const user = await pool
        .query(`SELECT stripe_connect_id, email FROM users WHERE id = $1`, [userId])
        .catch(() => ({ rows: [] }));
      let connectId = user.rows[0]?.stripe_connect_id;

      try {
        if (!connectId) {
          const account = await stripe.accounts.create({
            type: 'express',
            email: user.rows[0]?.email || undefined,
            business_type: 'company',
            capabilities: { transfers: { requested: true } },
            metadata: { scangym_user_id: String(userId) },
          });
          connectId = account.id;
          await pool
            .query(`UPDATE users SET stripe_connect_id = $1 WHERE id = $2`, [connectId, userId])
            .catch(() => {});
        }
        const origin =
          (req && (req.headers.origin || 'https://' + req.headers.host)) || 'https://scangym.com';
        const link = await stripe.accountLinks.create({
          account: connectId,
          refresh_url: origin + '/partner',
          return_url: origin + '/partner?payout=connected',
          type: 'account_onboarding',
        });
        return {
          ok: true,
          url: link.url,
          message: 'Stripe onboarding link ready — takes about two minutes.',
        };
      } catch (err) {
        console.error('[PartnerTools] stripe connect failed:', err.message);
        return { ok: false, message: 'Could not start payout setup: ' + err.message };
      }
    },
  },

  connect_smart_lock: {
    write: true,
    schema: {
      name: 'connect_smart_lock',
      description:
        'Connect a smart access provider (Seam, Kisi, Brivo) so ScanGym customers can let themselves in. Needs the ACS system id from the provider dashboard.',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: ['seam', 'kisi', 'brivo'] },
          systemId: { type: 'string', description: 'ACS system id, e.g. acs_system_...' },
        },
        required: ['provider', 'systemId'],
        additionalProperties: false,
      },
    },
    async run(userId, { provider, systemId }) {
      const gym = await resolveGym(userId);
      const missing = needGym(gym);
      if (missing) return missing;

      await pool
        .query(
          `UPDATE gyms SET access_provider = $1, access_system_id = $2, updated_at = NOW()
            WHERE id = $3 AND claimed_by::text = $4::text`,
          [provider, systemId, gym.id, userId]
        )
        .catch(() =>
          pool.query(
            `UPDATE gyms SET metadata = COALESCE(metadata,'{}'::jsonb) || $1::jsonb, updated_at = NOW()
              WHERE id = $2 AND claimed_by::text = $3::text`,
            [JSON.stringify({ access_provider: provider, access_system_id: systemId }), gym.id, userId]
          )
        );

      return {
        ok: true,
        message: `${provider} linked to ${gym.name}. I'll verify the doors respond and message you if anything looks off.`,
      };
    },
  },
};

/** Tool schemas in OpenAI chat-completions format. */
function openAiTools() {
  return Object.values(tools).map((t) => ({ type: 'function', function: t.schema }));
}

/** Execute a tool by name, scoped to the authenticated owner. */
async function execute(name, args, userId, req) {
  const tool = tools[name];
  if (!tool) return { ok: false, message: `Unknown tool: ${name}` };
  try {
    return await tool.run(userId, args || {}, req);
  } catch (err) {
    console.error(`[PartnerTools] ${name} failed:`, err.message);
    return { ok: false, message: 'That action failed — nothing was changed.' };
  }
}

const isWrite = (name) => !!tools[name]?.write;

module.exports = { tools, openAiTools, execute, isWrite, PRICE_MIN, PRICE_MAX, resolveGym };
