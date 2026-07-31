/**
 * ScanSquad Tools — the creator side of the app as a set of callable actions.
 *
 * Mirrors server/lib/partner-tools.js (gym owners) for ScanSquad creators.
 *
 * Two rules run through the whole file:
 *
 * 1. The creator is ALWAYS taken from the authenticated session, never from the
 *    request body. The existing /api/creator-growth and /api/creator-distribution
 *    endpoints identify a creator by a `handle` in the POST body, and handles are
 *    public — so anyone can spend someone else's balance or announce as them.
 *    Nothing here trusts a client-supplied handle: we resolve
 *    users.referral_handle for the logged-in user and use that.
 *
 * 2. Anything that spends money or publishes is marked `write: true`, which makes
 *    the agent stop and ask for a yes before it runs.
 */
const pool = require('../middleware/db');

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const COMMISSION_RATE = 0.25;      // creators earn 25%
const GIVEAWAY_COST_PENCE = 500;   // one £5 day pass credit
const BOOST_PENCE_PER_DAY = 100;
const MIN_WITHDRAWAL_PENCE = 1000; // £10
const BUNDLE_PRESETS = {
  '3for12': { passes: 3, pricePence: 1200, label: '3 gym passes for £12' },
  '5for20': { passes: 5, pricePence: 2000, label: '5 gym passes for £20' },
};

const TIERS = {
  starter: { name: 'Starter', badge: '🌱', at: 0 },
  rising: { name: 'Rising Star', badge: '⭐', at: 10 },
  pro: { name: 'Pro Creator', badge: '🔥', at: 50 },
  legend: { name: 'Legend', badge: '👑', at: 100 },
};

const gbp = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`;

function tierFor(referrals) {
  if (referrals >= 100) return 'legend';
  if (referrals >= 50) return 'pro';
  if (referrals >= 10) return 'rising';
  return 'starter';
}

function nextTier(referrals) {
  const order = ['starter', 'rising', 'pro', 'legend'];
  const current = tierFor(referrals);
  const next = order[order.indexOf(current) + 1];
  if (!next) return null;
  return { key: next, name: TIERS[next].name, needs: TIERS[next].at - referrals };
}

// ── identity ────────────────────────────────────────────────────────────────

/** The creator's handle, from their own user row. Never from the request. */
async function resolveHandle(userId) {
  const { rows } = await pool
    .query('SELECT referral_handle FROM public.users WHERE id = $1', [userId])
    .catch(() => ({ rows: [] }));
  const handle = rows[0]?.referral_handle;
  return handle && HANDLE_RE.test(handle) ? handle : null;
}

async function membershipRow(userId) {
  const { rows } = await pool
    .query('SELECT * FROM creator_memberships WHERE user_id::text = $1::text', [userId])
    .catch(() => ({ rows: [] }));
  return rows[0] || null;
}

const needMember = () => ({
  ok: false,
  needsJoin: true,
  message: "You're not in ScanSquad yet — want me to sign you up? It's free and you earn 25% on every booking.",
});

const needHandle = () => ({
  ok: false,
  needsHandle: true,
  message:
    "You don't have a creator handle set yet, so there's nothing to track earnings against. What's your Instagram or TikTok handle?",
});

/** Available balance = converted commissions − held/paid withdrawals. */
async function availablePence(handle) {
  const earned = await pool
    .query(
      `SELECT COALESCE(SUM(commission_pence), 0)::int AS p
         FROM creator_referrals WHERE creator_handle = $1 AND status = 'converted'`,
      [handle]
    )
    .catch(() => ({ rows: [{ p: 0 }] }));
  const held = await pool
    .query(
      `SELECT COALESCE(SUM(amount_pence) FILTER (WHERE status IN ('approved','paid','pending')), 0)::int AS p
         FROM creator_withdrawals WHERE creator_handle = $1`,
      [handle]
    )
    .catch(() => ({ rows: [{ p: 0 }] }));
  return Math.max(0, earned.rows[0].p - held.rows[0].p);
}

async function holdFunds(handle, pence, note, status) {
  const { rows } = await pool.query(
    `INSERT INTO creator_withdrawals (creator_handle, amount_pence, payment_method, admin_notes, status)
     VALUES ($1, $2, 'creator_spend', $3, $4) RETURNING id`,
    [handle, pence, note, status || 'pending']
  );
  return rows[0].id;
}

/** Resolve membership + handle in one go; returns { handle, membership } or an error object. */
async function requireCreator(userId, { needsHandle = true } = {}) {
  const membership = await membershipRow(userId);
  if (!membership) return { error: needMember() };
  const handle = await resolveHandle(userId);
  if (!handle && needsHandle) return { error: needHandle() };
  return { handle, membership };
}

// ── tools ───────────────────────────────────────────────────────────────────

const tools = {
  /* ---------- reads ---------- */

  get_my_squad_profile: {
    write: false,
    schema: {
      name: 'get_my_squad_profile',
      description:
        "The creator's ScanSquad status: tier, badge, referral count, handle and referral link, plus how far off the next tier they are. Call this first when you need context.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const membership = await membershipRow(userId);
      if (!membership) return needMember();
      const handle = await resolveHandle(userId);
      const referrals = Number(membership.total_referrals) || 0;
      const key = tierFor(referrals);
      return {
        ok: true,
        isMember: true,
        handle: handle || null,
        tier: TIERS[key].name,
        badge: TIERS[key].badge,
        referrals,
        commissionRate: '25%',
        lifetimeFreePremium: !!membership.is_lifetime_free,
        joinedAt: membership.joined_at,
        nextTier: nextTier(referrals),
        referralLink: handle ? `https://scangym.com/r/${handle}` : null,
      };
    },
  },

  get_my_earnings: {
    write: false,
    schema: {
      name: 'get_my_earnings',
      description:
        "The creator's referral earnings: total earned, available to withdraw, money already held or paid out, clicks, conversions and conversion rate.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const { rows } = await pool
        .query(
          `SELECT COUNT(*) FILTER (WHERE status IN ('clicked','converted'))::int AS clicks,
                  COUNT(*) FILTER (WHERE status = 'converted')::int              AS conversions,
                  COALESCE(SUM(commission_pence) FILTER (WHERE status = 'converted'), 0)::int AS earned
             FROM creator_referrals WHERE creator_handle = $1`,
          [handle]
        )
        .catch(() => ({ rows: [{ clicks: 0, conversions: 0, earned: 0 }] }));

      const r = rows[0];
      const available = await availablePence(handle);
      return {
        ok: true,
        handle,
        totalEarned: gbp(r.earned),
        availableToWithdraw: gbp(available),
        heldOrPaidOut: gbp(r.earned - available),
        clicks: r.clicks,
        conversions: r.conversions,
        conversionRate: r.clicks ? `${Math.round((r.conversions / r.clicks) * 1000) / 10}%` : '0%',
        minimumWithdrawal: gbp(MIN_WITHDRAWAL_PENCE),
        commissionRate: '25%',
      };
    },
  },

  get_my_link_performance: {
    write: false,
    schema: {
      name: 'get_my_link_performance',
      description:
        'Which gyms and which traffic sources the creator\'s referral link actually converts on, so they know what to post about next.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'How many gyms to return. Defaults to 5, max 15.' },
        },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 5, 1), 15);

      const gyms = await pool
        .query(
          `SELECT COALESCE(r.gym_id, 'direct') AS gym_id,
                  COUNT(*)::int AS clicks,
                  COUNT(*) FILTER (WHERE r.status = 'converted')::int AS conversions,
                  COALESCE(SUM(r.commission_pence) FILTER (WHERE r.status = 'converted'), 0)::int AS earned
             FROM creator_referrals r
            WHERE r.creator_handle = $1
            GROUP BY COALESCE(r.gym_id, 'direct')
            ORDER BY clicks DESC
            LIMIT $2`,
          [handle, limit]
        )
        .catch(() => ({ rows: [] }));

      const sources = await pool
        .query(
          `SELECT COALESCE(NULLIF(source, ''), 'direct') AS source, COUNT(*)::int AS clicks
             FROM creator_referrals WHERE creator_handle = $1
            GROUP BY 1 ORDER BY clicks DESC LIMIT 6`,
          [handle]
        )
        .catch(() => ({ rows: [] }));

      // Best-effort gym names, same source the analytics route uses.
      const names = {};
      try {
        const ev = await pool.query(
          `SELECT DISTINCT ON (metadata->>'gymId') metadata->>'gymId' AS gym_id,
                  metadata->>'gymName' AS gym_name
             FROM referral_events
            WHERE creator_handle = $1 AND event_type = 'link_generated'
              AND metadata->>'gymId' IS NOT NULL
            ORDER BY metadata->>'gymId', created_at DESC LIMIT 200`,
          [handle]
        );
        for (const row of ev.rows) if (row.gym_id && row.gym_name) names[row.gym_id] = row.gym_name;
      } catch (_) { /* table may not exist yet */ }

      return {
        ok: true,
        handle,
        gyms: gyms.rows.map((g) => ({
          gym: g.gym_id === 'direct' ? 'Direct link (no gym)' : names[g.gym_id] || `Gym ${g.gym_id}`,
          clicks: g.clicks,
          conversions: g.conversions,
          earned: gbp(g.earned),
        })),
        trafficSources: sources.rows.map((s) => ({ source: s.source, clicks: s.clicks })),
        note: gyms.rows.length ? undefined : 'No clicks recorded yet — share the referral link to start tracking.',
      };
    },
  },

  get_leaderboard: {
    write: false,
    schema: {
      name: 'get_leaderboard',
      description: 'The ScanSquad leaderboard by referrals, and where this creator sits on it.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: 'Top N to return. Defaults to 5, max 20.' } },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 5, 1), 20);
      const { rows } = await pool
        .query(
          `SELECT user_id, tier, badge, total_referrals
             FROM creator_memberships ORDER BY total_referrals DESC LIMIT 50`
        )
        .catch(() => ({ rows: [] }));

      const myIndex = rows.findIndex((r) => String(r.user_id) === String(userId));
      return {
        ok: true,
        top: rows.slice(0, limit).map((r, i) => ({
          position: i + 1,
          badge: r.badge,
          tier: r.tier,
          referrals: Number(r.total_referrals) || 0,
          isYou: String(r.user_id) === String(userId),
        })),
        yourPosition: myIndex >= 0 ? myIndex + 1 : null,
        totalCreators: rows.length,
      };
    },
  },

  get_my_content: {
    write: false,
    schema: {
      name: 'get_my_content',
      description:
        "The creator's uploaded reels and their approval status (pending / approved), plus any active boosts.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const uploads = await pool
        .query(
          `SELECT id, caption, category, status, created_at
             FROM creator_uploads WHERE creator_handle = $1
            ORDER BY created_at DESC LIMIT 25`,
          [handle]
        )
        .catch(() => ({ rows: [] }));

      const boosts = await pool
        .query(
          `SELECT upload_id, boost_until FROM creator_boosts
            WHERE creator_handle = $1 AND boost_until > NOW()`,
          [handle]
        )
        .catch(() => ({ rows: [] }));

      const boosted = new Set(boosts.rows.map((b) => b.upload_id));
      return {
        ok: true,
        handle,
        uploads: uploads.rows.map((u) => ({
          id: u.id,
          caption: u.caption,
          category: u.category,
          status: u.status,
          boosted: boosted.has(u.id),
          uploadedAt: u.created_at,
        })),
        pendingReview: uploads.rows.filter((u) => u.status !== 'approved').length,
        boostCostPerDay: gbp(BOOST_PENCE_PER_DAY),
      };
    },
  },

  get_affiliate_link: {
    write: false,
    schema: {
      name: 'get_affiliate_link',
      description:
        "The creator's referral links: their general link, and a deep link straight to a specific gym or one of their reels when they name one. Use this whenever they ask for a link, an affiliate link or a deep link.",
      parameters: {
        type: 'object',
        properties: {
          gymId: { type: 'string', description: 'Deep-link to this gym id, if the creator named a gym.' },
          uploadId: { type: 'string', description: 'Deep-link to one of their own reels, from get_my_content.' },
          source: { type: 'string', description: 'Where they will post it, e.g. instagram, tiktok. Optional.' },
        },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const base = 'https://scangym.com';
      const enc = encodeURIComponent;
      const src = args.source ? `&src=${enc(String(args.source).slice(0, 40))}` : '';
      const links = { general: `${base}/r/${enc(handle)}${src ? '?' + src.slice(1) : ''}` };

      if (args.gymId) {
        links.gym = `${base}/gym/${enc(args.gymId)}?ref=${enc(handle)}${src}`;
      }

      // A reel deep link only exists if the reel is theirs and approved — otherwise the
      // link would 404 and they would post it anyway.
      if (args.uploadId) {
        const { rows } = await pool
          .query(
            `SELECT id, status FROM creator_uploads
              WHERE id = $1 AND creator_handle = $2 LIMIT 1`,
            [args.uploadId, handle]
          )
          .catch(() => ({ rows: [] }));
        if (!rows.length) {
          return {
            ok: false,
            message: "I can't find that reel under your handle — ask me to list your reels and pick one.",
          };
        }
        if (rows[0].status !== 'approved') {
          return {
            ok: false,
            uploadStatus: rows[0].status,
            message: `That reel is still ${rows[0].status}, so a deep link to it would not open yet. Your general link works now: ${links.general}`,
          };
        }
        links.reel = `${base}/reels/${enc(rows[0].id)}?ref=${enc(handle)}${src}`;
      }

      // Same analytics event the /api/referrals/generate-link route writes, so links made
      // in chat show up in link performance too.
      try {
        await pool.query(
          `INSERT INTO referral_events (creator_handle, event_type, metadata, created_at)
           VALUES ($1, 'link_generated', $2, NOW())`,
          [handle, JSON.stringify({ gymId: args.gymId || null, uploadId: args.uploadId || null, source: args.source || null, link: links.reel || links.gym || links.general })]
        );
      } catch (_) { /* analytics table may not exist yet — never block the link */ }

      return {
        ok: true,
        handle,
        links,
        commission: '25% of each booking made through it',
      };
    },
  },

  get_my_toolkit: {
    write: false,
    schema: {
      name: 'get_my_toolkit',
      description:
        'What ready-to-post assets ScanSquad gives creators (city videos, viral templates, cinematic clips, social posts) and where to get them.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run() {
      return {
        ok: true,
        totalAssets: 388,
        categories: [
          { name: 'Ready-to-post city videos', count: 150, note: '10 UK cities × 15 videos' },
          { name: 'Viral video templates', count: 60, note: 'FakeTweet, HotTake, MythBuster' },
          { name: 'AI cinematic gym montages', count: 10 },
          { name: 'City social posts', count: 25, note: 'Post + story per city' },
        ],
        where: 'The Toolkit section of the ScanSquad tab — every asset is a direct download.',
      };
    },
  },

  get_my_schedule: {
    write: false,
    schema: {
      name: 'get_my_schedule',
      description: "The creator's scheduled posts and their follower count on ScanGym.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const posts = await pool
        .query(
          `SELECT id, platform, caption, scheduled_at, status
             FROM scheduled_shares
            WHERE creator_handle = $1
              AND (status = 'pending' OR created_at > NOW() - INTERVAL '14 days')
            ORDER BY scheduled_at ASC LIMIT 25`,
          [handle]
        )
        .catch(() => ({ rows: [] }));

      const followers = await pool
        .query(`SELECT COUNT(*)::int AS c FROM creator_followers WHERE creator_handle = $1`, [handle])
        .catch(() => ({ rows: [{ c: 0 }] }));

      return {
        ok: true,
        handle,
        followers: followers.rows[0].c,
        scheduled: posts.rows.map((p) => ({
          id: p.id,
          platform: p.platform,
          caption: p.caption,
          when: p.scheduled_at,
          status: p.status,
        })),
      };
    },
  },

  /* ---------- writes: the agent must get a yes first ---------- */

  join_squad: {
    write: true,
    schema: {
      name: 'join_squad',
      description:
        'Sign this creator up to ScanSquad (free, 25% commission). Use when they are not a member yet and have said yes.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      if (await membershipRow(userId)) {
        return { ok: true, message: "You're already in ScanSquad." };
      }
      let referrals = 0;
      try {
        const r = await pool.query('SELECT COUNT(*)::int AS c FROM referrals WHERE referrer_id = $1', [userId]);
        referrals = r.rows[0].c;
      } catch (_) { /* referrals table optional */ }

      const key = tierFor(referrals);
      const { rows } = await pool.query(
        `INSERT INTO creator_memberships (user_id, tier, is_lifetime_free, total_referrals, badge, community_name)
         VALUES ($1, $2, $3, $4, $5, 'ScanSquad') RETURNING *`,
        [userId, key, key === 'legend', referrals, TIERS[key].badge]
      );
      return {
        ok: true,
        membership: rows[0],
        message: `You're in ScanSquad as a ${TIERS[key].name} ${TIERS[key].badge}. Next: set your handle so your link tracks earnings.`,
      };
    },
  },

  set_my_handle: {
    write: true,
    schema: {
      name: 'set_my_handle',
      description:
        "Set or change the creator's ScanGym handle, which is also their referral link (scangym.com/r/handle). Only changes it if they do not have one, or if the current one has earned nothing.",
      parameters: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'Letters, numbers, dash and underscore only. No @.' },
        },
        required: ['handle'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const clean = String(args.handle || '')
        .replace(/^@+/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .toLowerCase()
        .slice(0, 50);
      if (!clean) return { ok: false, message: "That handle isn't usable — letters and numbers only." };

      const current = await resolveHandle(userId);
      if (current === clean) return { ok: true, message: `Your handle is already ${clean}.` };

      if (current) {
        const earned = await pool
          .query(
            `SELECT COALESCE(SUM(commission_pence), 0)::int AS p
               FROM creator_referrals WHERE creator_handle = $1 AND status = 'converted'`,
            [current]
          )
          .catch(() => ({ rows: [{ p: 0 }] }));
        if (earned.rows[0].p > 0) {
          return {
            ok: false,
            message: `Your current handle ${current} has ${gbp(earned.rows[0].p)} of earnings against it, so I won't move it — that would orphan the money. Support can migrate it properly.`,
          };
        }
      }

      const taken = await pool
        .query('SELECT id FROM public.users WHERE referral_handle = $1 AND id <> $2', [clean, userId])
        .catch(() => ({ rows: [] }));
      if (taken.rows.length) return { ok: false, message: `${clean} is already taken — try another.` };

      await pool.query('UPDATE public.users SET referral_handle = $1 WHERE id = $2', [clean, userId]);
      return {
        ok: true,
        handle: clean,
        message: `Done — your link is scangym.com/r/${clean}. Put it in your bio.`,
      };
    },
  },

  start_giveaway: {
    write: true,
    schema: {
      name: 'start_giveaway',
      description: `Run a free day pass giveaway for the creator's followers. Costs ${gbp(GIVEAWAY_COST_PENCE)} from their available balance and produces a claim link. One active giveaway at a time.`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const active = await pool
        .query(`SELECT claim_code FROM creator_giveaways WHERE creator_handle = $1 AND status = 'active'`, [handle])
        .catch(() => ({ rows: [] }));
      if (active.rows.length) {
        return {
          ok: false,
          message: `You already have a giveaway running: scangym.com/r/${handle}?giveaway=${active.rows[0].claim_code}`,
        };
      }

      const balance = await availablePence(handle);
      if (balance < GIVEAWAY_COST_PENCE) {
        return {
          ok: false,
          message: `A giveaway costs ${gbp(GIVEAWAY_COST_PENCE)} and you have ${gbp(balance)} available. Earn a bit more first.`,
        };
      }

      const holdId = await holdFunds(handle, GIVEAWAY_COST_PENCE, 'Free Pass Giveaway hold (AI chat)', 'pending');
      const code = require('crypto').randomBytes(6).toString('hex');
      await pool.query(
        `INSERT INTO creator_giveaways (creator_handle, claim_code, funded_withdrawal_id) VALUES ($1,$2,$3)`,
        [handle, code, holdId]
      );
      const url = `https://scangym.com/r/${handle}?giveaway=${code}`;
      return { ok: true, claimUrl: url, message: `Giveaway is live — share ${url}. First follower to claim gets a free pass.` };
    },
  },

  boost_reel: {
    write: true,
    schema: {
      name: 'boost_reel',
      description: `Pin one of the creator's own approved reels to the top of the public feed. Costs ${gbp(BOOST_PENCE_PER_DAY)} per day from their balance. Use get_my_content first to get the reel id.`,
      parameters: {
        type: 'object',
        properties: {
          uploadId: { type: 'integer', description: "The creator's own upload id." },
          days: { type: 'integer', description: '1 to 7 days. Defaults to 1.' },
        },
        required: ['uploadId'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const uploadId = parseInt(args.uploadId, 10);
      if (!uploadId) return { ok: false, message: 'I need the reel id — say "show my reels" and pick one.' };
      const days = Math.min(Math.max(parseInt(args.days, 10) || 1, 1), 7);

      // Ownership: the reel must belong to this handle.
      const own = await pool
        .query(`SELECT id, status FROM creator_uploads WHERE id = $1 AND creator_handle = $2`, [uploadId, handle])
        .catch(() => ({ rows: [] }));
      if (!own.rows.length) return { ok: false, message: "That reel isn't one of yours." };
      if (own.rows[0].status !== 'approved') {
        return { ok: false, message: 'That reel is still waiting on review — boosting only works once it is approved.' };
      }

      const cost = BOOST_PENCE_PER_DAY * days;
      const balance = await availablePence(handle);
      if (balance < cost) {
        return { ok: false, message: `${days} day${days > 1 ? 's' : ''} costs ${gbp(cost)} and you have ${gbp(balance)} available.` };
      }

      await holdFunds(handle, cost, `Reel boost via AI chat: upload ${uploadId} × ${days} day(s)`, 'paid');
      await pool.query(
        `INSERT INTO creator_boosts (creator_handle, upload_id, boost_until)
         VALUES ($1, $2, NOW() + ($3 || ' days')::interval)
         ON CONFLICT (upload_id) DO UPDATE SET
           boost_until = GREATEST(creator_boosts.boost_until, NOW()) + ($3 || ' days')::interval`,
        [handle, uploadId, String(days)]
      );
      return { ok: true, message: `Boosted for ${days} day${days > 1 ? 's' : ''} — ${gbp(cost)} off your balance.` };
    },
  },

  set_bundle_deal: {
    write: true,
    schema: {
      name: 'set_bundle_deal',
      description:
        "Turn on one of the creator's bundle offers for their followers (3 passes for £12, or 5 for £20). The creator funds the bonus credit when it is redeemed.",
      parameters: {
        type: 'object',
        properties: {
          preset: { type: 'string', enum: ['3for12', '5for20'], description: 'Which bundle to run.' },
        },
        required: ['preset'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;
      const preset = BUNDLE_PRESETS[args.preset] ? args.preset : null;
      if (!preset) return { ok: false, message: 'Pick either 3 for £12 or 5 for £20.' };

      await pool.query(
        `INSERT INTO creator_bundles (creator_handle, preset, active)
         VALUES ($1, $2, true)
         ON CONFLICT (creator_handle) DO UPDATE SET preset = $2, active = true, updated_at = NOW()`,
        [handle, preset]
      );
      return { ok: true, message: `${BUNDLE_PRESETS[preset].label} is live on your page.` };
    },
  },

  schedule_post: {
    write: true,
    schema: {
      name: 'schedule_post',
      description:
        "Add a post to the creator's own content calendar with a caption and a time. This is a reminder/planner — it does not publish to Instagram or TikTok for them.",
      parameters: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['instagram', 'tiktok', 'youtube', 'x', 'facebook', 'whatsapp', 'telegram', 'snapchat', 'other'],
          },
          caption: { type: 'string', description: 'The caption to post. Keep it under 500 characters.' },
          scheduledAt: { type: 'string', description: 'ISO 8601 date-time, in the future.' },
        },
        required: ['platform', 'caption', 'scheduledAt'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const caption = String(args.caption || '').trim().slice(0, 500);
      if (!caption) return { ok: false, message: 'I need a caption for that post.' };
      const when = new Date(args.scheduledAt);
      if (isNaN(when.getTime())) return { ok: false, message: 'I could not read that date — when should it go out?' };
      if (when.getTime() < Date.now() - 60_000) return { ok: false, message: 'That time is in the past.' };

      const pending = await pool
        .query(
          `SELECT COUNT(*)::int AS n FROM scheduled_shares
            WHERE creator_handle = $1 AND status = 'pending'`,
          [handle]
        )
        .catch(() => ({ rows: [{ n: 0 }] }));
      if (pending.rows[0].n >= 20) {
        return { ok: false, message: 'You already have 20 posts queued — clear a few first.' };
      }

      const plat = args.platform || 'other';
      const { rows } = await pool.query(
        `INSERT INTO scheduled_shares (creator_handle, platform, caption, share_url, scheduled_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, scheduled_at`,
        [handle, plat, caption, `https://scangym.com/r/${handle}?src=${plat}`, when.toISOString()]
      );
      return { ok: true, id: rows[0].id, message: `Scheduled for ${when.toUTCString()}. I'll keep it on your calendar.` };
    },
  },

  announce_to_followers: {
    write: true,
    schema: {
      name: 'announce_to_followers',
      description:
        "Send a short announcement to the creator's ScanGym followers. Read it back to them before sending — it goes out to real people.",
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'Under 300 characters.' } },
        required: ['message'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const message = String(args.message || '').trim().slice(0, 300);
      if (!message) return { ok: false, message: 'What should the announcement say?' };

      const followers = await pool
        .query(`SELECT COUNT(*)::int AS c FROM creator_followers WHERE creator_handle = $1`, [handle])
        .catch(() => ({ rows: [{ c: 0 }] }));

      await pool.query(
        `INSERT INTO creator_announcements (creator_handle, message) VALUES ($1,$2)`,
        [handle, message]
      );
      return {
        ok: true,
        followers: followers.rows[0].c,
        message: `Sent to your ${followers.rows[0].c} follower${followers.rows[0].c === 1 ? '' : 's'}.`,
      };
    },
  },

  request_withdrawal: {
    write: true,
    schema: {
      name: 'request_withdrawal',
      description: `Request a payout of the creator's available balance. Minimum ${gbp(MIN_WITHDRAWAL_PENCE)}. Always state the exact amount before doing this.`,
      parameters: {
        type: 'object',
        properties: {
          amountPounds: { type: 'number', description: 'Amount in pounds. Omit to withdraw everything available.' },
        },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const { error, handle } = await requireCreator(userId);
      if (error) return error;

      const available = await availablePence(handle);
      let pence = args.amountPounds === undefined ? available : Math.round(Number(args.amountPounds) * 100);
      if (!Number.isFinite(pence) || pence <= 0) return { ok: false, message: 'How much would you like to withdraw?' };
      if (pence > available) {
        return { ok: false, message: `You have ${gbp(available)} available, so I can't request ${gbp(pence)}.` };
      }
      if (pence < MIN_WITHDRAWAL_PENCE) {
        return { ok: false, message: `The minimum payout is ${gbp(MIN_WITHDRAWAL_PENCE)} — you have ${gbp(available)}.` };
      }

      const { rows } = await pool.query(
        `INSERT INTO creator_withdrawals (creator_handle, amount_pence, payment_method, admin_notes, status)
         VALUES ($1,$2,'bank_transfer','Requested via ScanSquad AI chat','pending') RETURNING id`,
        [handle, pence]
      );
      return {
        ok: true,
        id: rows[0].id,
        message: `Payout of ${gbp(pence)} requested — it goes into the next payout run once approved.`,
      };
    },
  },
};

/** Tool schemas in OpenAI chat-completions format. */
function openAiTools() {
  return Object.values(tools).map((t) => ({ type: 'function', function: t.schema }));
}

/** Execute a tool by name, always scoped to the authenticated creator. */
async function execute(name, args, userId, req) {
  const tool = tools[name];
  if (!tool) return { ok: false, message: `Unknown tool: ${name}` };
  try {
    return await tool.run(userId, args || {}, req);
  } catch (err) {
    console.error(`[SquadTools] ${name} failed:`, err.message);
    return { ok: false, message: 'That action failed — nothing was changed.' };
  }
}

const isWrite = (name) => !!tools[name]?.write;

module.exports = {
  tools,
  openAiTools,
  execute,
  isWrite,
  resolveHandle,
  availablePence,
  COMMISSION_RATE,
  GIVEAWAY_COST_PENCE,
  BOOST_PENCE_PER_DAY,
  MIN_WITHDRAWAL_PENCE,
};
