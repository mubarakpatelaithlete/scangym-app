/**
 * Squad Video — generate a gym promo clip from a prompt, on the phone.
 *
 * Powers the ScanSquad "Create" sheet: prompt → a video model → poll → MP4.
 *
 * This route used to be Veo and nothing else. Veo 3.1 Fast bills about $0.15
 * a second, so an 8-second clip is ~$1.20 and a creator making two a day
 * costs roughly £104 a month — around 23 day passes at £4.49 to serve one
 * person's reels. WAN 2.5 renders the same button for about £19 a month. The
 * model is now chosen from lib/gen-models.js, the cheap one is the default,
 * and Veo stays available as an opt-in premium tier (PREMIUM_MODELS_ENABLED).
 * That single change is the largest cost decision in the feature, which is
 * why it is a catalogue row and covered by tests/squad-gen-costs.test.js.
 *
 * Two providers, therefore two paths: Gemini long-running operations (Veo)
 * and the fal queue (everything else), both behind lib/gen-provider.js. A job
 * row remembers which model made it, so a deploy that changes the default
 * cannot orphan a clip that is still rendering on the old one.
 *
 * Storage: finished MP4s go to R2 (cdn path squad-gen/) when configured,
 * else to local disk served from /file/:id.
 *
 * Jobs are rows in squad_video_jobs, with an in-memory Map in front as a
 * per-instance cache. They used to be ONLY in the Map, which cost us twice:
 * a deploy mid-render orphaned the video (the MP4 existed, the pointer did
 * not), and there was no way to show a user what they had already made.
 * The Map is still the fast path; the database is the truth. If the database
 * is unreachable the routes keep working off the Map alone, because a broken
 * history is not a reason to refuse to render.
 *
 * Cost control: 5 renders per user per day (per IP for anonymous). This is
 * now counted with a SELECT over today's rows rather than an in-process
 * counter — the old counter reset on deploy and was per instance, so the
 * real limit was 5 x (number of dynos). Veo Fast preview is billed per
 * second of output, so the cap is a budget guard, not a UX preference.
 *
 * Render settings (duration, resolution, audio, aspect) are whitelisted
 * here, never passed through from the client verbatim.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { optionalAuth } = require('../middleware/auth');
const { requireCreator } = require('../lib/gen-guard');
const spend = require('../lib/gen-budget');
const etaOf = require('../lib/gen-eta');
const pool = require('../middleware/db');
const models = require('../lib/gen-models');
const genProvider = require('../lib/gen-provider');
const genJobs = require('../lib/gen-jobs');

const router = express.Router();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const VEO_MODEL = process.env.VEO_MODEL || 'veo-3.1-fast-generate-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OUT_DIR = path.join('/tmp', 'squad-gen');
const DAILY_CAP = parseInt(process.env.SQUAD_VIDEO_DAILY_CAP || '5', 10);

const jobs = new Map(); // jobId -> { op, status, videoUrl, error, createdAt, filePath } (cache)

/**
 * Allowed render settings. Anything not in here never reaches the model:
 * the client is untrusted, and Veo bills per second of output, so a
 * hand-crafted durationSeconds is a billing hole rather than a bad render.
 */
const ALLOWED = {
  aspectRatio: ['9:16', '16:9'],
  durationSeconds: [4, 6, 8],
  resolution: ['720p', '1080p'],
};
const DEFAULTS = { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true };

/** Coerce a client body into exactly the settings we are willing to send. */
function cleanSettings(body) {
  const b = body || {};
  const pick = (name, value) => (ALLOWED[name].includes(value) ? value : DEFAULTS[name]);
  return {
    aspectRatio: pick('aspectRatio', b.aspectRatio),
    durationSeconds: pick('durationSeconds', Number(b.durationSeconds)),
    resolution: pick('resolution', b.resolution),
    generateAudio: b.generateAudio === undefined ? DEFAULTS.generateAudio : b.generateAudio !== false,
  };
}

function userKey(req) {
  return (req.user && (req.user.id || req.user.userId)) || req.session?.userId || req.ip || 'anon';
}

/**
 * Renders used today. Counted in the database so the cap survives a deploy
 * and is shared across instances. If the database is unreachable we return
 * null, and callers treat "unknown" as "allow" — refusing to render because
 * the history table is down would be the wrong trade.
 */
async function usedToday(req) {
  try {
    const r = await pool.query(
      // kind is filtered because the table now holds every Create mode: without
      // it, 30 images a day would consume the 5-a-day video budget.
      "SELECT COUNT(*)::int AS n FROM squad_video_jobs WHERE user_id = $1 AND kind = 'video' AND created_at >= date_trunc('day', NOW())",
      [String(userKey(req))],
    );
    return r.rows[0].n;
  } catch (e) {
    console.error('[SquadVideo] quota lookup failed:', e.message);
    return null;
  }
}

async function quotaFor(req) {
  const used = await usedToday(req);
  return { used: used ?? 0, limit: DAILY_CAP, remaining: used === null ? DAILY_CAP : Math.max(0, DAILY_CAP - used) };
}

/** Best-effort persistence: never let a database problem fail a render. */
async function recordJob(id, req, prompt, settings, op, model, costUsd) {
  try {
    await pool.query(
      `INSERT INTO squad_video_jobs
         (id, user_id, op, prompt, params, status, kind, provider, model, cost_usd)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'running', 'video', $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [id, String(userKey(req)), op, prompt, JSON.stringify(settings),
       model?.provider || 'gemini', model?.id || 'veo-3.1-fast', costUsd ?? null],
    );
  } catch (e) {
    console.error('[SquadVideo] could not record job:', e.message);
  }
}

async function finishJob(id, fields) {
  try {
    const r = await pool.query(
      `UPDATE squad_video_jobs
          SET status = $2, video_url = $3, error = $4, completed_at = NOW()
        WHERE id = $1
      RETURNING id, user_id, kind, model, prompt, video_url, created_at, completed_at`,
      [id, fields.status, fields.videoUrl || null, fields.error || null],
    );
    /* Video is the slow mode — 2 to 4 minutes measured — so a creator who left
       the sheet gets told rather than losing the clip they paid for. */
    if (fields.status === 'done' && r.rows[0]) {
      require('../lib/gen-notify').notifyReady(r.rows[0]).catch(() => {});
    }
  } catch (e) {
    console.error('[SquadVideo] could not finish job:', e.message);
  }
}

// ─── GET /health — can this box render video right now? ─────────────────
// Free check: lists models and looks for the Veo id. No generation spend.
router.get('/health', optionalAuth, async (req, res) => {
  const quota = await quotaFor(req);
  /* What this creator can afford, decided before the row is drawn rather than
     after a 402 — and it is what tier-gates Veo and Seedance without hiding
     them. @see lib/gen-budget.js */
  const budget = await spend.budgetFor(req);
  const catalogue = spend.annotate(
    models.catalogueFor('video', { seconds: DEFAULTS.durationSeconds })
      .map((m) => ({ ...m, etaSeconds: etaOf.etaSeconds('video', m.id, { seconds: DEFAULTS.durationSeconds }) })),
    budget,
  );
  const chosen = models.resolveAvailable('video', req.query.model, genProvider.configured);

  // Nothing keyed at all — neither fal nor Gemini.
  if (!chosen) {
    return res.json({ available: false, reason: 'no_api_key', models: catalogue, quota, budget });
  }

  // The cheap default lives on fal, but this box may only have a Gemini key
  // (or vice versa). resolveAvailable() already picked a reachable provider;
  // report on that one rather than on a model we cannot run.
  if (chosen.provider === 'fal') {
    const available = genProvider.configured('fal');
    return res.json({
      available,
      reason: available ? undefined : 'no_api_key',
      model: chosen.id,
      models: catalogue,
      quota,
      budget,
      options: ALLOWED,
      defaults: DEFAULTS,
    });
  }

  if (!GEMINI_KEY) return res.json({ available: false, reason: 'no_api_key', models: catalogue, quota, budget });

  /* Ask whether this key may *generate*, not whether the model exists.
     This probe used to be GET /models/{VEO_MODEL}, which answered 200 on a
     project Google had blocked from generating — so health said
     "available: true" while every customer render returned 403. See
     lib/gen-provider.js#geminiGenerationAccess. Costs nothing and renders
     nothing. */
  const access = await genProvider.geminiGenerationAccess(VEO_MODEL);
  if (access.ok) {
    return res.json({
      available: true,
      unverified: access.unverified || undefined,
      model: chosen.id,
      models: catalogue,
      quota,
      budget,
      options: ALLOWED,
      defaults: DEFAULTS,
    });
  }
  return res.json({
    available: false,
    reason: access.reason,
    status: access.status,
    detail: access.detail,
    models: catalogue,
    quota,
    budget,
  });
});

// ─── POST /generate — kick off a render ──────────────────────────────────
// express.json() is applied per-route here, the same way squad-agent.js and
// partner-agent.js do it. The app-level parser in server.js runs only for an
// allowlist of prefixes and /api/squad-video is not one of them, so without
// this req.body is undefined and every generate answered "prompt required" —
// the feature could never have worked, with or without a valid model key.
router.post('/generate', requireCreator, express.json(), async (req, res) => {
  const prompt = (req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (prompt.length > 1500) return res.status(400).json({ error: 'prompt too long' });

  // Screened before we spend and before the provider sees it: providers ban
  // accounts for prohibited prompts, and a ban takes out every Create mode,
  // not just this request.
  const refusal = genJobs.screenPrompt(prompt);
  if (refusal) return res.status(400).json({ error: refusal });

  const model = models.resolveAvailable('video', req.body?.model, genProvider.configured);
  if (!model) {
    return res.status(503).json({ error: 'Video generation is not configured yet.' });
  }

  const quota = await quotaFor(req);
  if (quota.remaining <= 0) {
    return res.status(429).json({
      error: `Daily limit reached (${DAILY_CAP} videos). Try again tomorrow or grab a ready-made clip from the library.`,
      quota,
    });
  }

  const requested = cleanSettings(req.body);
  // Price and report the length that will actually render. Vendors accept
  // different duration sets (WAN 2.5 is 5s or 10s), so a 4s request becomes a
  // 5s clip — and quoting the 4s would under-charge by a fifth.
  const settings = model.provider === 'fal'
    ? { ...requested, durationSeconds: effectiveSeconds(model, requested.durationSeconds) }
    : requested;
  const costUsd = models.estimateUsd(model, { seconds: settings.durationSeconds });

  /* The reason this route exists in this shape: five clips a day was the cap,
     and five Seedance clips is $18.90 of our money on a caller who never
     signed in. Spend is now priced against the creator's tier and the bookings
     they have driven. @see lib/gen-budget.js */
  const refused = spend.verdict(await spend.budgetFor(req), costUsd);
  if (refused) return res.status(refused.status).json(refused.body);

  try {
    const op = model.provider === 'fal'
      ? (await genProvider.submit(model, falInput(prompt, settings, model))).op
      : await veoSubmit(prompt, settings);

    const jobId = crypto.randomBytes(8).toString('hex');
    jobs.set(jobId, { op, status: 'running', createdAt: Date.now(), model: model.id });
    // GC: drop cached jobs older than 2h — the row in Postgres is the record.
    for (const [k, v] of jobs) if (Date.now() - v.createdAt > 7200000) jobs.delete(k);
    await recordJob(jobId, req, prompt, settings, op, model, costUsd);
    res.json({
      jobId,
      settings,
      model: { id: model.id, label: model.label },
      costUsd,
      /* Measured, per model, not "usually under a minute" — Seedance is 226s.
         @see lib/gen-eta.js */
      etaSeconds: etaOf.etaSeconds('video', model.id, { seconds: settings.durationSeconds }),
      quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 },
    });
  } catch (e) {
    console.error('[SquadVideo] generate error:', e.message);
    res.status(502).json({ error: genProvider.scrub(e.message) || 'Could not reach the video model.' });
  }
});

/**
 * Whitelisted settings → the payload a fal text-to-video model expects.
 *
 * **This table exists because Create Video was broken in production.** The
 * sheet offers 4s, 6s and 8s. WAN 2.5 — the default — accepts `'5'` or
 * `'10'` and nothing else, as does Kling 2.5 Turbo. Verified against the live
 * API on 2026-09-16 with the exact payload this route was sending: fal
 * answers 200 with a request id, the status endpoint then reports
 * `COMPLETED`, and fetching the result returns
 * `422 Input should be '5' or '10'`. No video, every time, for every
 * customer who pressed the button.
 *
 * That failure shape is why it survived: the submit succeeds, so nothing
 * logs an error at send time, and /health only checks that a key exists.
 *
 * fal does *not* reject unknown fields — it ignores them — so the danger is
 * never a loud 422 at submit. It is a setting that silently does nothing:
 * `enable_audio` sent to a model whose flag is `generate_audio` leaves audio
 * on at the vendor default and bills 50% more than the sheet quoted.
 *
 * So each profile declares the durations its vendor actually accepts, and
 * `effectiveSeconds()` maps the creator's choice onto one of them. Rounding
 * is upward: a creator who asked for 4s gets 5s rather than a failure, and
 * the quote is calculated from the 5s that will really render, never from
 * the 4s they tapped. All duration lists and field names are from fal's
 * OpenAPI schemas, read on 2026-09-16.
 */
const VIDEO_PROFILES = {
  /** WAN 2.5 preview. 5s or 10s only, and the audio flag does not exist. */
  'fal-video': {
    durations: [5, 10],
    build: (prompt, s) => ({
      prompt,
      duration: String(s.durationSeconds),
      aspect_ratio: s.aspectRatio,
      resolution: s.resolution,
    }),
  },
  /** Kling 2.5 Turbo: 5s or 10s, no resolution field, no audio field. */
  'kling-2.5': {
    durations: [5, 10],
    build: (prompt, s) => ({
      prompt,
      duration: String(s.durationSeconds),
      aspect_ratio: s.aspectRatio,
    }),
  },
  /** Kling v3: 3–15s as a string, generate_audio, still no resolution. */
  'kling-v3': {
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    build: (prompt, s) => ({
      prompt,
      duration: String(s.durationSeconds),
      aspect_ratio: s.aspectRatio,
      generate_audio: s.generateAudio,
    }),
  },
  /** Seedance 1 Pro: 2–12s as a string, resolution, no audio field. */
  'seedance-1': {
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    build: (prompt, s) => ({
      prompt,
      duration: String(s.durationSeconds),
      aspect_ratio: s.aspectRatio,
      resolution: s.resolution,
    }),
  },
  /** Seedance 2.5: 4–30s as a string, resolution, generate_audio. */
  'seedance-2.5': {
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    build: (prompt, s) => ({
      prompt,
      duration: String(s.durationSeconds),
      aspect_ratio: s.aspectRatio,
      resolution: s.resolution,
      generate_audio: s.generateAudio,
    }),
  },
  /** Veo 3.1 through fal: the duration carries an 's', and it is generate_audio. */
  'veo-fal': {
    durations: [4, 6, 8],
    build: (prompt, s) => ({
      prompt,
      duration: `${s.durationSeconds}s`,
      aspect_ratio: s.aspectRatio,
      resolution: s.resolution,
      generate_audio: s.generateAudio,
    }),
  },
  /** WAN 3.0: a real integer duration, and the audio flag is just `audio`. */
  'wan-3': {
    durations: null, // any integer 2–30
    build: (prompt, s) => ({
      prompt,
      duration: s.durationSeconds,
      aspect_ratio: s.aspectRatio,
      resolution: s.resolution,
      audio: s.generateAudio,
    }),
  },
  /**
   * Grok Imagine: integer duration, no audio, and pinned to 480p. fal
   * publishes $0.05/s at 480p and no rate for 720p on this endpoint, so 480p
   * is the only resolution we can put a price against — and the catalogue
   * row quotes exactly that.
   */
  'grok-video': {
    durations: null,
    build: (prompt, s) => ({
      prompt,
      duration: s.durationSeconds,
      aspect_ratio: s.aspectRatio,
      resolution: '480p',
    }),
  },
};

function profileFor(model) {
  return VIDEO_PROFILES[model?.inputProfile] || VIDEO_PROFILES['fal-video'];
}

/**
 * The duration this model will really render, given what the creator picked.
 *
 * Rounds up to the vendor's next allowed length, because a slightly longer
 * clip is a better answer than a failed one. The caller prices *this* number:
 * quoting the 4s a creator tapped for a clip WAN will render at 5s is the
 * same class of mistake as the Kling row that quoted double.
 */
function effectiveSeconds(model, requested) {
  const { durations } = profileFor(model);
  if (!durations) return requested;
  return durations.find((d) => d >= requested) ?? durations[durations.length - 1];
}

function falInput(prompt, settings, model) {
  const seconds = effectiveSeconds(model, settings.durationSeconds);
  return profileFor(model).build(prompt, { ...settings, durationSeconds: seconds });
}

/** Start a Veo long-running operation and return its name. */
async function veoSubmit(prompt, settings) {
  const r = await fetch(`${API_BASE}/models/${VEO_MODEL}:predictLongRunning?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt }], parameters: settings }),
  });
  const data = await r.json();
  if (!r.ok || !data.name) {
    console.error('[SquadVideo] veo generate failed:', r.status, JSON.stringify(data).slice(0, 300));
    // A real refusal is better evidence than any probe: record it so /health
    // stops advertising a button that just failed, rather than waiting for
    // the next customer to find out.
    genProvider.noteGenerationOutcome('gemini', VEO_MODEL, { ok: false, status: r.status });
    throw new Error(data.error?.message || 'Video model refused the request.');
  }
  genProvider.noteGenerationOutcome('gemini', VEO_MODEL, { ok: true });
  return data.name;
}


/**
 * How long this render has been going and how long is left, in the same shape
 * every mode answers with.
 *
 * The sheet used to print "usually under a minute" and then count upwards past
 * four minutes, which reads as a hang. Both numbers come from measurement
 * (lib/gen-eta.js), and `remainingSeconds` is null once we are past the
 * estimate rather than negative — "any moment now" is the honest phrasing when
 * the vendor is slower than its median.
 */
function timing(job, model) {
  const elapsed = Math.round((Date.now() - (job.createdAt || Date.now())) / 1000);
  const total = etaOf.etaSeconds('video', model && model.id, { seconds: job.durationSeconds || DEFAULTS.durationSeconds });
  return { elapsedSeconds: elapsed, etaSeconds: total, remainingSeconds: etaOf.remainingSeconds(total, elapsed) };
}

// ─── GET /status/:jobId — poll until done ────────────────────────────────
router.get('/status/:jobId', async (req, res) => {
  let job = jobs.get(req.params.jobId);

  // Cache miss is the normal case after a deploy: the Map is gone but the
  // Veo operation is still running and the row remembers which one it is.
  if (!job) {
    try {
      const r = await pool.query(
        'SELECT op, status, video_url, error, model, created_at FROM squad_video_jobs WHERE id = $1',
        [req.params.jobId],
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        /* created_at from the row, not Date.now(): after a deploy the clip has
           already been rendering for minutes, and "0s elapsed" would restart a
           progress bar the creator has been watching. */
        job = {
          op: row.op, status: row.status, videoUrl: row.video_url, error: row.error, model: row.model,
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        };
        jobs.set(req.params.jobId, job);
      }
    } catch (e) {
      console.error('[SquadVideo] status lookup failed:', e.message);
    }
  }

  if (!job) return res.status(404).json({ error: 'unknown job' });
  if (job.status === 'done') return res.json({ status: 'done', videoUrl: job.videoUrl });
  if (job.status === 'error') return res.json({ status: 'error', error: job.error });

  // Poll whoever rendered it, not whoever is default today: a deploy that
  // changes the default must not orphan a clip already running elsewhere.
  const jobModel = models.resolve('video', job.model);
  if (jobModel.provider === 'fal') {
    try {
      const out = await genProvider.poll(jobModel, job.op);
      if (out.status === 'running') {
        return res.json({ status: 'running', queuePosition: out.queuePosition ?? null, ...timing(job, jobModel) });
      }
      if (out.status === 'error') {
        job.status = 'error';
        job.error = out.error;
        await finishJob(req.params.jobId, { status: 'error', error: out.error });
        return res.json({ status: 'error', error: out.error });
      }
      // fal's CDN keeps outputs about 7 days, so the finished MP4 is copied to
      // R2 the same way the Veo path does it — a creator's clip must not
      // vanish from their history after a week.
      job.videoUrl = await rehost(out.url, req.params.jobId);
      job.status = 'done';
      await finishJob(req.params.jobId, { status: 'done', videoUrl: job.videoUrl });
      return res.json({ status: 'done', videoUrl: job.videoUrl });
    } catch (e) {
      console.error('[SquadVideo] fal status error:', e.message);
      return res.json({ status: 'running' }); // transient — keep polling
    }
  }

  try {
    const r = await fetch(`${API_BASE}/${job.op}?key=${GEMINI_KEY}`);
    const data = await r.json();
    if (!data.done) return res.json({ status: 'running' });
    if (data.error) {
      job.status = 'error';
      job.error = (data.error.message || 'generation failed').slice(0, 300);
      await finishJob(req.params.jobId, { status: 'error', error: job.error });
      return res.json({ status: 'error', error: job.error });
    }
    const sample =
      data.response?.generateVideoResponse?.generatedSamples?.[0] ||
      data.response?.generatedVideos?.[0] ||
      null;
    const uri = sample?.video?.uri;
    if (!uri) {
      job.status = 'error';
      job.error = 'model returned no video';
      await finishJob(req.params.jobId, { status: 'error', error: job.error });
      return res.json({ status: 'error', error: job.error });
    }
    // Download server-side (the URI needs the API key; never hand the key to the client)
    const sep = uri.includes('?') ? '&' : '?';
    const vidResp = await fetch(`${uri}${sep}key=${GEMINI_KEY}`);
    if (!vidResp.ok) throw new Error('video download failed: ' + vidResp.status);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const filePath = path.join(OUT_DIR, `${req.params.jobId}.mp4`);
    fs.writeFileSync(filePath, Buffer.from(await vidResp.arrayBuffer()));
    job.filePath = filePath;

    // Prefer R2 → CDN; fall back to serving from this box
    try {
      const { uploadToR2 } = require('../lib/r2-upload');
      const key = `squad-gen/${req.params.jobId}.mp4`;
      const up = await uploadToR2(filePath, key, { contentType: 'video/mp4' });
      job.videoUrl = up?.url || `https://cdn.scangym.com/${key}`;
    } catch (e) {
      job.videoUrl = `/api/squad-video/file/${req.params.jobId}`;
    }
    job.status = 'done';
    await finishJob(req.params.jobId, { status: 'done', videoUrl: job.videoUrl });
    res.json({ status: 'done', videoUrl: job.videoUrl });
  } catch (e) {
    console.error('[SquadVideo] status error:', e.message);
    res.json({ status: 'running' }); // transient — let the client keep polling
  }
});

// ─── GET /history — this user's recent clips ────────────────────────────
// The reason the jobs table exists: without it the sheet could only ever
// show the clip you made in this session, on this instance.
router.get('/history', optionalAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, prompt, params, status, video_url, error, created_at
         FROM squad_video_jobs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [String(userKey(req))],
    );
    res.json({ jobs: r.rows, quota: await quotaFor(req) });
  } catch (e) {
    console.error('[SquadVideo] history failed:', e.message);
    res.json({ jobs: [], quota: { used: 0, limit: DAILY_CAP, remaining: DAILY_CAP }, degraded: true });
  }
});

// ─── GET /file/:jobId — local-disk fallback when R2 is absent ────────────
router.get('/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'not found' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(job.filePath).pipe(res);
});

/**
 * Copy a provider's temporary output URL to R2 and return the durable link.
 *
 * Falls back to the provider URL if R2 is not configured or the copy fails:
 * a link that works for a week is better than no link at all, and this runs
 * inside a poll the client is waiting on.
 */
async function rehost(url, jobId) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('download failed: ' + resp.status);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const filePath = path.join(OUT_DIR, `${jobId}.mp4`);
    fs.writeFileSync(filePath, Buffer.from(await resp.arrayBuffer()));
    const { uploadToR2 } = require('../lib/r2-upload');
    const key = `squad-gen/${jobId}.mp4`;
    const up = await uploadToR2(filePath, key, { contentType: 'video/mp4' });
    return up?.url || `https://cdn.scangym.com/${key}`;
  } catch (e) {
    console.warn('[SquadVideo] could not re-host clip, using provider URL:', e.message);
    return url;
  }
}

module.exports = router;
module.exports._internals = { falInput, cleanSettings, VIDEO_PROFILES, effectiveSeconds, profileFor };
