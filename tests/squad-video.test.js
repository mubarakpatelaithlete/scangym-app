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
const mockReq = (over = {}) => ({ ip: '1.2.3.4', body: {}, params: {}, ...over });

function stubFetch(fn) {
  const real = global.fetch;
  global.fetch = fn;
  return () => { global.fetch = real; };
}

/* ── settings are real, and whitelisted ─────────────────────────────────── */

test('the settings the user picks are actually sent to the model', async () => {
  const { router } = loadRouter(() => ({ rows: [{ n: 0 }] }));
  let sent = null;
  const restore = stubFetch(async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ name: 'operations/abc' }) };
  });
  try {
    const res = mockRes();
    await handlerFor(router, 'post', '/generate')(
      mockReq({ body: { prompt: 'a gym', aspectRatio: '16:9', durationSeconds: 4, resolution: '1080p', generateAudio: false } }),
      res,
    );
    assert.deepStrictEqual(sent.parameters, {
      aspectRatio: '16:9',
      durationSeconds: 4,
      resolution: '1080p',
      generateAudio: false,
    }, 'the chosen settings must reach Veo, not be dropped like the old 8s chip');
    assert.ok(res.body.jobId, 'a job id comes back');
  } finally {
    restore();
  }
});

test('settings the client invents are replaced by defaults, never forwarded', async () => {
  const { router } = loadRouter(() => ({ rows: [{ n: 0 }] }));
  let sent = null;
  const restore = stubFetch(async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ name: 'operations/abc' }) };
  });
  try {
    await handlerFor(router, 'post', '/generate')(
      mockReq({ body: { prompt: 'a gym', aspectRatio: '4:3', durationSeconds: 3600, resolution: '8k' } }),
      mockRes(),
    );
    assert.strictEqual(sent.parameters.durationSeconds, 8, '3600s would be a billing hole');
    assert.strictEqual(sent.parameters.aspectRatio, '9:16');
    assert.strictEqual(sent.parameters.resolution, '720p');
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
    return { ok: true, json: async () => ({ name: 'operations/abc' }) };
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
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ name: 'operations/xyz' }) }));
  try {
    await handlerFor(router, 'post', '/generate')(
      mockReq({ body: { prompt: 'squat racks' } }),
      mockRes(),
    );
    const insert = calls.find((c) => /INSERT INTO squad_video_jobs/.test(c.sql));
    assert.ok(insert, 'the job must be recorded, or history and the cap are fiction');
    assert.ok(insert.params.includes('squat racks'));
    assert.ok(insert.params.includes('operations/xyz'), 'the operation name is what lets polling resume after a deploy');
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

test('the sheet has no fake settings label, and sends every control it shows', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');
  assert.ok(!/⏱ 8s · 🔊 audio/.test(src), 'the decorative settings chip is back');
  for (const field of ['durationSeconds', 'resolution', 'generateAudio', 'aspectRatio']) {
    assert.ok(
      new RegExp(field + '\\s*:\\s*state\\.' + field).test(src),
      `${field} is shown in the sheet but not sent to /generate`,
    );
  }
});
