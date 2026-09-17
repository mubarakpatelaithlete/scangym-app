/**
 * Shared plumbing for the Create modes: per-mode daily caps, job rows,
 * prompt screening.
 *
 * All of this was written inside routes/squad-video.js for one mode. Six more
 * modes are coming and each one needs the same four things, so they live here
 * once. The rules encoded here were learned the hard way and are repeated in
 * the comments so a future reader does not "simplify" them back out:
 *
 *  - Caps are counted in SQL, not in a process variable. An in-process
 *    counter resets on deploy and is per instance, so a "5 a day" cap was
 *    really 5 x (number of dynos) a day.
 *  - Caps are per *mode*. Images cost $0.04 and clips cost up to $2; one
 *    shared counter either starves the cheap mode or fails to guard the
 *    expensive one.
 *  - A database that is down must not stop a generation. History is a nice
 *    to have; refusing to work because the history table is unreachable is
 *    worse than an uncounted render.
 */

const pool = require('../middleware/db');

/** Per-mode daily caps. Video is the expensive one and stays tightest. */
const CAPS = {
  video: parseInt(process.env.SQUAD_VIDEO_DAILY_CAP || '5', 10),
  image: parseInt(process.env.SQUAD_IMAGE_DAILY_CAP || '30', 10),
  audio: parseInt(process.env.SQUAD_AUDIO_DAILY_CAP || '30', 10),
  music: parseInt(process.env.SQUAD_MUSIC_DAILY_CAP || '10', 10),
};

function capFor(kind) {
  return CAPS[kind] || 10;
}

/**
 * Who to count against. Signed-in users by id; everyone else by IP, which is
 * imperfect (shared networks) but is the only handle an anonymous caller has
 * and the cap is a budget guard rather than an entitlement.
 */
function userKey(req) {
  return (req.user && (req.user.id || req.user.userId)) || req.session?.userId || req.ip || 'anon';
}

/**
 * How many generations of this mode the caller has made today.
 * Returns null when the database cannot answer — callers treat null as allow.
 */
async function usedToday(req, kind) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM squad_video_jobs
        WHERE user_id = $1 AND kind = $2 AND created_at >= date_trunc('day', NOW())`,
      [String(userKey(req)), kind],
    );
    return r.rows[0].n;
  } catch (e) {
    console.error(`[SquadGen:${kind}] quota lookup failed:`, e.message);
    return null;
  }
}

async function quotaFor(req, kind) {
  const limit = capFor(kind);
  const used = await usedToday(req, kind);
  return {
    used: used ?? 0,
    limit,
    remaining: used === null ? limit : Math.max(0, limit - used),
  };
}

/** Best-effort persistence: never let a database problem fail a generation. */
async function recordJob({ id, req, kind, prompt, params, op, model, costUsd }) {
  try {
    /* Price the row as well as cost it. Create is postpaid, so the invoice is
       built from these rows the next morning — and the price has to be the one
       quoted at submit time, not one recomputed later against a multiplier or
       an FX rate that has since moved. A render we could not price (the house
       writer, a free path) stores nulls and is simply not billed. */
    const retail = require('./gen-pricing').retail(costUsd);
    await pool.query(
      `INSERT INTO squad_video_jobs
         (id, user_id, op, prompt, params, status, kind, provider, model, cost_usd,
          retail_net_pence, retail_vat_pence, retail_gross_pence)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'running', $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        String(userKey(req)),
        op || null,
        prompt,
        JSON.stringify(params || {}),
        kind,
        model?.provider || null,
        model?.id || null,
        costUsd ?? null,
        retail ? retail.netPence : null,
        retail ? retail.vatPence : null,
        retail ? retail.grossPence : null,
      ],
    );
  } catch (e) {
    console.error(`[SquadGen:${kind}] could not record job:`, e.message);
  }
}

async function finishJob(id, { status, url, error }) {
  try {
    /* RETURNING rather than a second SELECT: the notification needs the row we
       have just written (who, which mode, how long it took), and a slow render
       that nobody is still watching is exactly the case worth an email. */
    const r = await pool.query(
      `UPDATE squad_video_jobs
          SET status = $2, video_url = $3, error = $4, completed_at = NOW()
        WHERE id = $1
      RETURNING id, user_id, kind, model, prompt, video_url, created_at, completed_at`,
      [id, status, url || null, error || null],
    );
    if (status === 'done' && r.rows[0]) {
      // Best effort, never awaited into the caller's critical path.
      require('./gen-notify').notifyReady(r.rows[0]).catch(() => {});
    }
  } catch (e) {
    console.error('[SquadGen] could not finish job:', e.message);
  }
}

async function loadJob(id) {
  try {
    const r = await pool.query(
      `SELECT id, op, status, video_url, error, kind, model, prompt, params, created_at
         FROM squad_video_jobs WHERE id = $1`,
      [id],
    );
    return r.rows[0] || null;
  } catch (e) {
    console.error('[SquadGen] job lookup failed:', e.message);
    return null;
  }
}

async function historyFor(req, kind, limit = 20) {
  try {
    const r = await pool.query(
      `SELECT id, prompt, params, status, video_url, error, kind, model, created_at
         FROM squad_video_jobs
        WHERE user_id = $1 AND kind = $2
        ORDER BY created_at DESC
        LIMIT $3`,
      [String(userKey(req)), kind, limit],
    );
    return { jobs: r.rows };
  } catch (e) {
    console.error(`[SquadGen:${kind}] history failed:`, e.message);
    return { jobs: [], degraded: true };
  }
}

/**
 * Prompt screening, before we spend anything.
 *
 * Providers ban accounts for generating prohibited content, and a ban takes
 * out every Create button at once — not just the request that caused it. That
 * makes a cheap local check worth having even though it is crude: it costs
 * nothing, and the failure it prevents is total.
 *
 * This is deliberately a small list of categories that would put the account
 * at risk, not a profanity filter. A gym app's prompts are about training;
 * anything matching here is not a creator having an off day.
 */
const BLOCKED = [
  /\bnude|naked|nsfw|porn|sexual\b/i,
  /\bchild|minor|underage|teen\b/i,
  /\bgore|beheading|mutilat/i,
  /\bhow to (make|build) (a )?(bomb|weapon|gun)\b/i,
];

/** @returns {null | string} null when acceptable, else the reason to show. */
function screenPrompt(prompt) {
  for (const rx of BLOCKED) {
    if (rx.test(prompt)) {
      return 'That prompt is outside what we can generate. Try describing the training, the gym or the vibe.';
    }
  }
  return null;
}


/**
 * Everything this creator has made, newest first, across every mode.
 *
 * "My Creations", the thing the sheet could not show. Per-mode history existed
 * (historyFor), so a creator could see their clips inside the Video sheet and
 * their images inside the Image sheet and nowhere see their work — and the row
 * carried the url but not the prompt they wrote, so a good result could not be
 * re-run or tweaked. Both are the same query with the columns nobody selected.
 *
 * Text is included: a caption is a creation. It has no url, which is exactly
 * how the client tells the two apart.
 */
async function libraryFor(userId, { limit = 40, kind = null } = {}) {
  try {
    const params = [String(userId), Math.min(100, Math.max(1, limit))];
    const kindClause = kind ? ' AND kind = $3' : '';
    if (kind) params.push(kind);
    const r = await pool.query(
      `SELECT id, kind, model, prompt, params, status, video_url AS url, error,
              cost_usd, download_count, share_count, created_at, completed_at
         FROM squad_video_jobs
        WHERE user_id = $1${kindClause}
        ORDER BY created_at DESC
        LIMIT $2`,
      params,
    );
    return { items: r.rows };
  } catch (e) {
    console.error('[SquadGen] library failed:', e.message);
    return { items: [], degraded: true };
  }
}

/**
 * Record that a creator downloaded or shared something.
 *
 * These counts used to live in localStorage, which meant they were lost on a
 * new phone and could never feed the tier ladder that decides who earns what —
 * the dashboard was showing a number that only existed on that device. One row
 * per creator per asset per action: tapping Share twice is still one share, so
 * the count moves and the row does not multiply.
 *
 * Covers both the ready-made library assets and generated jobs; `assetKind`
 * says which, and a generated asset also bumps the counter on its own job row
 * so "which of my creations actually got posted" is one query.
 */
async function recordEvent({ userId, assetId, action, assetKind = 'library' }) {
  if (!userId || !assetId) return { ok: false, reason: 'missing_ids' };
  if (action !== 'download' && action !== 'share') return { ok: false, reason: 'bad_action' };
  try {
    await pool.query(
      `INSERT INTO squad_asset_events (user_id, asset_id, asset_kind, action)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, asset_id, action)
       DO UPDATE SET count = squad_asset_events.count + 1, last_at = NOW()`,
      [String(userId), String(assetId), assetKind, action],
    );
    if (assetKind === 'generated') {
      const column = action === 'share' ? 'share_count' : 'download_count';
      await pool.query(
        `UPDATE squad_video_jobs SET ${column} = ${column} + 1 WHERE id = $1 AND user_id = $2`,
        [String(assetId), String(userId)],
      );
    }
    return { ok: true };
  } catch (e) {
    console.error('[SquadGen] could not record asset event:', e.message);
    return { ok: false, reason: 'db' };
  }
}

/**
 * The creator's own totals, and which asset ids they have already acted on —
 * what the library grid used to read out of localStorage to grey out a tile.
 */
async function eventSummaryFor(userId) {
  try {
    const r = await pool.query(
      `SELECT action, asset_id, count FROM squad_asset_events WHERE user_id = $1`,
      [String(userId)],
    );
    const summary = { downloads: 0, shares: 0, downloaded: [], shared: [] };
    for (const row of r.rows) {
      if (row.action === 'download') { summary.downloads += row.count; summary.downloaded.push(row.asset_id); }
      if (row.action === 'share') { summary.shares += row.count; summary.shared.push(row.asset_id); }
    }
    return summary;
  } catch (e) {
    console.error('[SquadGen] event summary failed:', e.message);
    return { downloads: 0, shares: 0, downloaded: [], shared: [], degraded: true };
  }
}

module.exports = {
  CAPS,
  capFor,
  userKey,
  quotaFor,
  recordJob,
  finishJob,
  loadJob,
  historyFor,
  libraryFor,
  recordEvent,
  eventSummaryFor,
  screenPrompt,
};
