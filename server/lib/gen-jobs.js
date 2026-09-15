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
    await pool.query(
      `INSERT INTO squad_video_jobs
         (id, user_id, op, prompt, params, status, kind, provider, model, cost_usd)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'running', $6, $7, $8, $9)
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
      ],
    );
  } catch (e) {
    console.error(`[SquadGen:${kind}] could not record job:`, e.message);
  }
}

async function finishJob(id, { status, url, error }) {
  try {
    await pool.query(
      `UPDATE squad_video_jobs
          SET status = $2, video_url = $3, error = $4, completed_at = NOW()
        WHERE id = $1`,
      [id, status, url || null, error || null],
    );
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

module.exports = {
  CAPS,
  capFor,
  userKey,
  quotaFor,
  recordJob,
  finishJob,
  loadJob,
  historyFor,
  screenPrompt,
};
