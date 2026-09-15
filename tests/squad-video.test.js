/**
 * The bugs these tests exist for, all in the ScanSquad "Create Video" sheet:
 *
 *  1. The sheet showed "8s · audio" as a chip while /generate only ever
 *     accepted a prompt and an aspect ratio. The duration and the speaker
 *     icon were decoration — the user picked settings that were thrown away.
 *  2. Nothing was whitelisted, so whatever the client sent would have gone
 *     to a model that bills per second of output.
 *  3. Jobs lived only in an in-memory Map, so a deploy mid-render orphaned
 *     the video and the daily cap reset (and was per instance, making the
 *     real limit 5 x dynos).
 *
 * Every assertion below is about not shipping any of those again.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
// Create Video is multi-model now and defaults to WAN 2.5 on fal, because Veo
// bills ~10x per second. Both providers are keyed here so these tests exercise
// the real default rather than silently falling back.
process.env.FAL_KEY = process.env.FAL_KEY || 'test-fal-key';

const ROOT = path.join(__dirname, '..');
const ROUTE = path.join(ROOT, 'server', 'routes', 'squad-video');

/**
 * Load the router with its database replaced, mirroring account-tools.test.js.
 * The route requires ../middleware/db at module load, so the stub goes into
 * the module cache first.
 */
function loadRouter(handler) {
  const calls = [];
  const dbPath = require.resolve(path.join(ROOT, 'server', 'middleware', 'db'));
  const routePath = require.resolve(ROUTE);
  const fake = {
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      const out = handler ? handler(flat, params, calls.length) : null;
      if (out instanceof Error) throw out;
      return out || { rows: [] };
    },
  };
  const previousDb = require.cache[dbPath];
  require.cache[dbPath] = new Module(dbPath, null);
  require.cache[dbPath].filename = dbPath;
  require.cache[dbPath].loaded = true;
  require.cache[dbPath].exports = fake;
  delete require.cache[routePath];
  const router = require(routePath);
  delete require.cache[routePath];
  if (previousDb) require.cache[dbPath] = previousDb;
  else delete require.cache[dbPath];
  return { router, calls };
}

/** Find a registered handler by method + path pattern. */
function handlerFor(router, method, suffix) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === suffix && l.route.methods[method],
  );
  assert.ok(layer, `no ${method.toUpperCase()} ${suffix} route registered`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

/** Minimal req/res doubles — enough for these handlers, nothing more. */
function mockRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const mockReq = (over = {}) => ({ ip: '1.2.3.4', body: {}, params: {}, query: {}, ...over });

function stubFetch(fn) {
  const real = global.fetch;
  global.fetch = fn;
  return () => { global.fetch = real; };
}

/* ── settings are real, and whitelisted ─────────────────────────────────── */

test('the settings the user picks are actually sent to the model', async () => {
  const { router } = loadRouter(() => ({ rows: [{ n: 0 }] }));
  let sent = null;
  let calledUrl = null;
  const restore = stubFetch(async (url, opts) => {
    calledUrl = String(url);
    sent = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ request_id: 'fal-abc' }) };
  });
  try {
    const res = mockRes();
    await handlerFor(router, 'post', '/generate')(
      mockReq({ body: { prompt: 'a gym', aspectRatio: '16:9', durationSeconds: 4, resolution: '1080p', generateAudio: false } }),
      res,
    );
    // The default provider is fal, so the settings arrive in fal's shape.
    // What matters is unchanged from the original bug: the values the user
    // picked reach the model instead of being decoration.
    assert.match(calledUrl, /queue\.fal\.run/);
    assert.strictEqual(sent.aspect_ratio, '16:9');
    assert.strictEqual(sent.duration, 4);
    assert.strictEqual(sent.resolution, '1080p');
    assert.strictEqual(sent.enable_audio, false);
    assert.ok(res.body.jobId, 'a job id comes back');
    assert.strictEqual(res.body.model.id, 'wan-2.5', 'the cheap model is the default');
    assert.ok(res.body.costUsd > 0, 'the sheet is told what it will cost before spending');
  } finally {
    restore();
  }
});

test('choosing Veo still sends Veo-shaped settings to Gemini', async () => {
  // The premium path must keep working: the same picked settings, translated
  // for the other provider rather than dropped.
  process.env.PREMIUM_MODELS_ENABLED = 'true';
  const { router } = loadRouter(() => ({ rows: [{ n: 0 }] }));
  let sent = null;
  let calledUrl = null;
  const restore = stubFetch(async (url, opts) => {
    calledUrl = String(url);
    sent = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ name: 'operations/abc' }) };
  });
  try {
    const res = mockRes();
    await handlerFor(router, 'post', '/generate')(
      mockReq({ body: { prompt: 'a gym', model: 'veo-3.1-fast', aspectRatio: '16:9', durationSeconds: 4, resolution: '1080p', generateAudio: false } }),
      res,
    );
    assert.match(calledUrl, /generativelanguage\.googleapis\.com/);
    assert.deepStrictEqual(sent.parameters, {
      aspectRatio: '16:9',
      durationSeconds: 4,
      resolution: '1080p',
      generateAudio: false,
    });
    assert.strictEqual(res.body.model.id, 'veo-3.1-fast');
  } finally {
    restore();
    delete process.env.PREMIUM_MODELS_ENABLED;
  }
});

test('Veo cannot be reached unless premium is explicitly enabled', async () => {
  // The regression that would quietly cost ~£104/creator/month: a request
  // naming the dear model must fall back to the cheap one, not honour it.
  const { router } = loadRouter(() => ({ rows: [{ n: 0 }] }));
  let calledUrl = null;
  const restore = stubFetch(async (url) => {
    calledUrl = String(url);
    return { ok: true, json: async () => ({ request_id: 'fal-abc' }) };
  });
  try {
    const res = mockRes();
    await handlerFor(router, 'post', '/generate')(
      mockReq({ body: { prompt: 'a gym', model: 'veo-3.1-fast' } }),
      res,
    );
    assert.match(calledUrl, /queue\.fal\.run/, 'must not reach Gemini');
    assert.strictEqual(res.body.model.id, 'wan-2.5');
  } finally {
    restore();
  }
});

test('settings the client invents are replaced by defaults, never forwarded', async () => {
  const { router } = loadRouter(() => ({ rows: [{ n: 0 }] }));
  let sent = null;
  const restore = stubFetch(async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ request_id: 'fal-abc' }) };
  });
  try {
    await handlerFor(router, 'post', '/generate')(
      mockReq({ body: { prompt: 'a gym', aspectRatio: '4:3', durationSeconds: 3600, resolution: '8k' } }),
      mockRes(),
    );
    assert.strictEqual(sent.duration, 8, '3600s would be a billing hole');
    assert.strictEqual(sent.aspect_ratio, '9:16');
    assert.strictEqual(sent.resolution, '720p');
  } finally {
    restore();
  }
});

/* ── the cap is counted in the database, not in the process ─────────────── */

test('the daily cap is a database count, so it survives a deploy', async () => {
  const { router, calls } = loadRouter((sql) =>
    /COUNT\(\*\)/.test(sql) ? { rows: [{ n: 5 }] } : { rows: [] },
  );
  const restore = stubFetch(async () => {
    throw new Error('must not reach the model when the cap is spent');
  });
  try {
    const res = mockRes();
    await handlerFor(router, 'post', '/generate')(mockReq({ body: { prompt: 'x' } }), res);
    assert.strictEqual(res.statusCode, 429);
    assert.match(res.body.error, /Daily limit reached/);
    assert.strictEqual(res.body.quota.remaining, 0);
    assert.ok(
      calls.some((c) => /FROM squad_video_jobs/.test(c.sql) && /COUNT/.test(c.sql)),
      'the cap must be counted in Postgres, not an in-process Map',
    );
  } finally {
    restore();
  }
});

test('a database that is down does not block rendering', async () => {
  const { router } = loadRouter(() => new Error('db is down'));
  let reached = false;
  const restore = stubFetch(async () => {
    reached = true;
    return { ok: true, json: async () => ({ request_id: 'fal-abc' }) };
  });
  try {
    const res = mockRes();
    await handlerFor(router, 'post', '/generate')(mockReq({ body: { prompt: 'x' } }), res);
    assert.ok(reached, 'a broken history table must not stop a render');
    assert.ok(res.body.jobId);
  } finally {
    restore();
  }
});

/* ── persistence ────────────────────────────────────────────────────────── */

test('a started job is written to squad_video_jobs', async () => {
  const { router, calls } = loadRouter(() => ({ rows: [{ n: 0 }] }));
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ request_id: 'fal-xyz' }) }));
  try {
    await handlerFor(router, 'post', '/generate')(
      mockReq({ body: { prompt: 'squat racks' } }),
      mockRes(),
    );
    const insert = calls.find((c) => /INSERT INTO squad_video_jobs/.test(c.sql));
    assert.ok(insert, 'the job must be recorded, or history and the cap are fiction');
    assert.ok(insert.params.includes('squat racks'));
    assert.ok(insert.params.includes('fal-xyz'), 'the provider job id is what lets polling resume after a deploy');
    assert.ok(insert.params.includes('wan-2.5'), 'the row remembers which model rendered it');
    assert.ok(insert.params.includes('fal'), 'and which provider, so a changed default cannot orphan it');
  } finally {
    restore();
  }
});

test('polling an unknown job recovers it from the database instead of 404ing', async () => {
  const { router } = loadRouter((sql) =>
    /SELECT op, status/.test(sql)
      ? { rows: [{ op: 'operations/abc', status: 'done', video_url: 'https://cdn/x.mp4', error: null }] }
      : { rows: [] },
  );
  const res = mockRes();
  await handlerFor(router, 'get', '/status/:jobId')(mockReq({ params: { jobId: 'gone-from-cache' } }), res);
  assert.strictEqual(res.body.status, 'done');
  assert.strictEqual(res.body.videoUrl, 'https://cdn/x.mp4');
});

test('history returns this user\'s finished clips and their quota', async () => {
  const rows = [{ id: 'a', prompt: 'gym tour', status: 'done', video_url: 'https://cdn/a.mp4' }];
  const { router } = loadRouter((sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 2 }] };
    if (/FROM squad_video_jobs/.test(sql)) return { rows };
    return { rows: [] };
  });
  const res = mockRes();
  await handlerFor(router, 'get', '/history')(mockReq(), res);
  assert.deepStrictEqual(res.body.jobs, rows);
  assert.deepStrictEqual(res.body.quota, { used: 2, limit: 5, remaining: 3 });
});

test('health reports remaining renders so the sheet never guesses', async () => {
  const { router } = loadRouter(() => ({ rows: [{ n: 1 }] }));
  const restore = stubFetch(async () => ({ ok: true }));
  try {
    const res = mockRes();
    await handlerFor(router, 'get', '/health')(mockReq(), res);
    assert.strictEqual(res.body.available, true);
    assert.deepStrictEqual(res.body.quota, { used: 1, limit: 5, remaining: 4 });
    assert.ok(res.body.options, 'the sheet needs the allowed values to render its controls');
    assert.ok(Array.isArray(res.body.models) && res.body.models.length > 1,
      'the sheet needs the model menu, with a price against each one');
    assert.ok(res.body.models.every((m) => m.estimateUsd > 0), 'every offered model is priced');
  } finally {
    restore();
  }
});

/* ── the body never arrived at all ──────────────────────────────────────── */

test('/generate parses its JSON body, so a prompt actually reaches the handler', async () => {
  const { router } = loadRouter(() => ({ rows: [{ n: 0 }] }));
  const layer = router.stack.find((l) => l.route && l.route.path === '/generate');
  const names = layer.route.stack.map((h) => h.name);
  assert.ok(
    names.includes('jsonParser'),
    'no body parser on /generate: server.js only parses an allowlist of /api prefixes and ' +
    '/api/squad-video is not one of them, so req.body is undefined and every call ' +
    'answers "prompt required"',
  );
});

/* ── the decorative-control regression ──────────────────────────────────── */

test('the sheet still declares all four video controls in one place', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');
  assert.ok(!/\u23f1 8s \u00b7 \ud83d\udd0a audio/.test(src), 'the decorative settings chip is back');
  // The sheet now builds its request body by iterating the SAME list it
  // renders, so shown and sent cannot drift. That guarantee is exercised for
  // real in squad-create-sends-settings.test.js (minimal DOM, real click);
  // here we only pin that the four controls are still declared.
  for (const field of ['durationSeconds', 'resolution', 'generateAudio', 'aspectRatio']) {
    assert.ok(
      new RegExp("key: '" + field + "'").test(src),
      `${field} is no longer a declared video setting`,
    );
  }
});