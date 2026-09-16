/**
 * Create Audio and Create Music.
 *
 * Both run on the same ElevenLabs key, and the whole point of these tests is
 * that "same key" does not mean "same availability". Probed against the live
 * account on 2026-09-16: text-to-speech works on the free tier, while the
 * Music API answers 402 `paid_plan_required`. So Audio ships on, Music ships
 * off-and-honest, and the invariants worth pinning are:
 *
 *  1. Music never reports itself usable on a free plan, and never spends a
 *     request finding out — no vendor call, no 402 rendered as a shrug.
 *  2. Music switches itself on from the account's tier, not from a variable
 *     somebody has to remember to flip.
 *  3. Audio refuses before spending when the shared monthly character
 *     allowance cannot cover the script. The allowance is 10,000 characters
 *     for the entire deployment — about fourteen voiceovers — so "the first
 *     two creators spend everyone's month" is a real failure, not a
 *     hypothetical.
 *  4. An unreadable balance means "carry on", never "refuse": a blip at the
 *     vendor's status endpoint must not switch a working feature off.
 *  5. A mode the server serves is reachable from the sheet. #733 shipped
 *     Create Image server-side while the frontend still had `api: null`, so
 *     the button could never have fired however many keys were set.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const AUDIO = path.join(ROOT, 'server', 'routes', 'squad-audio');
const MUSIC = path.join(ROOT, 'server', 'routes', 'squad-music');
const PROVIDER = path.join(ROOT, 'server', 'lib', 'gen-provider');
const JOBS = path.join(ROOT, 'server', 'lib', 'gen-jobs');

/** Put an object in the module cache under a real module id. */
function stub(modPath, exports) {
  const id = require.resolve(modPath);
  const m = new Module(id, null);
  m.filename = id;
  m.loaded = true;
  m.exports = exports;
  require.cache[id] = m;
  return id;
}

/**
 * Load one of the routes with its provider and job store replaced.
 *
 * @param {string} routePath
 * @param {object} opts
 *   balance   what elevenCharacterQuota() resolves to (null = unreadable)
 *   keyed     whether ELEVENLABS_API_KEY is considered present
 *   generate  optional override for provider.generate
 */
function loadRoute(routePath, opts = {}) {
  const spy = { generated: 0, input: null, recorded: [], finished: [] };
  const provider = {
    configured: (p) => (p === 'elevenlabs' ? opts.keyed !== false : false),
    scrub: (t) => String(t || '').slice(0, 300),
    elevenCharacterQuota: async () => ('balance' in opts ? opts.balance : null),
    cachedElevenTier: () => (opts.balance ? opts.balance.tier : null),
    invalidateCharacterQuota: () => {},
    generate: async (model, input) => {
      spy.generated += 1;
      spy.input = input;
      if (opts.generate) return opts.generate(model, input);
      return { buffer: Buffer.from('fake-mp3-bytes'), contentType: 'audio/mpeg' };
    },
  };
  const jobs = {
    quotaFor: async () => opts.quota || { used: 0, limit: 30, remaining: 30 },
    screenPrompt: () => null,
    recordJob: async (j) => { spy.recorded.push(j); },
    finishJob: async (id, r) => { spy.finished.push({ id, ...r }); },
    loadJob: async () => null,
    historyFor: async () => ({ items: [] }),
  };
  // No R2 in tests: the routes fall back to a data url, which is also the
  // path a deployment with missing storage variables takes.
  const r2 = { r2Configured: () => false, uploadBufferToR2: async () => ({ url: 'https://cdn/x.mp3' }) };

  const ids = [
    stub(PROVIDER, provider),
    stub(JOBS, jobs),
    stub(path.join(ROOT, 'server', 'lib', 'r2-upload'), r2),
  ];
  const routeId = require.resolve(routePath);
  delete require.cache[routeId];
  const router = require(routePath);
  delete require.cache[routeId];
  for (const id of ids) delete require.cache[id];
  return { router, spy };
}

function handlerFor(router, method, suffix) {
  const layer = router.stack.find((l) => l.route && l.route.path === suffix && l.route.methods[method]);
  assert.ok(layer, `no ${method.toUpperCase()} ${suffix} registered`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const mockReq = (over = {}) => ({ ip: '1.2.3.4', body: {}, params: {}, query: {}, ...over });

const FREE = { tier: 'free', used: 0, limit: 10000, remaining: 10000, resetsAt: null };
const PAID = { tier: 'creator', used: 0, limit: 100000, remaining: 100000, resetsAt: null };

// ─── Audio ────────────────────────────────────────────────────────────────

test('audio: health is unavailable and says why with no key', async () => {
  const { router } = loadRoute(AUDIO, { keyed: false });
  const res = mockRes();
  await handlerFor(router, 'get', '/health')(mockReq(), res);
  assert.equal(res.body.available, false);
  assert.equal(res.body.reason, 'no_api_key');
});

test('audio: health is available on a free plan — speech works there', async () => {
  const { router } = loadRoute(AUDIO, { balance: FREE });
  const res = mockRes();
  await handlerFor(router, 'get', '/health')(mockReq(), res);
  assert.equal(res.body.available, true);
  assert.equal(res.body.characters.remaining, 10000);
  assert.equal(res.body.characters.tier, 'free');
});

test('audio: a spent monthly allowance is not "available"', async () => {
  const { router } = loadRoute(AUDIO, { balance: { ...FREE, used: 10000, remaining: 0 } });
  const res = mockRes();
  await handlerFor(router, 'get', '/health')(mockReq(), res);
  assert.equal(res.body.available, false, 'a key with no characters left is a button that fails on tap');
  assert.equal(res.body.reason, 'monthly_characters_spent');
});

test('audio: a script longer than the chosen length is refused before spending', async () => {
  const { router, spy } = loadRoute(AUDIO, { balance: FREE });
  const res = mockRes();
  await handlerFor(router, 'post', '/generate')(
    mockReq({ body: { prompt: 'x'.repeat(400), length: '15s' } }), res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /15s of speech fits about 350/);
  assert.equal(spy.generated, 0, 'nothing should reach the vendor');
});

test('audio: refuses when the month cannot cover the script, and says how much is left', async () => {
  const { router, spy } = loadRoute(AUDIO, { balance: { ...FREE, used: 9960, remaining: 40 } });
  const res = mockRes();
  await handlerFor(router, 'post', '/generate')(
    mockReq({ body: { prompt: 'x'.repeat(200) } }), res,
  );
  assert.equal(res.statusCode, 429);
  assert.match(res.body.error, /40 characters left of 10000/);
  assert.equal(spy.generated, 0);
});

test('audio: an unreadable balance does not block generation', async () => {
  const { router, spy } = loadRoute(AUDIO, { balance: null });
  const res = mockRes();
  await handlerFor(router, 'post', '/generate')(mockReq({ body: { prompt: 'Any gym, £5 a day.' } }), res);
  assert.equal(res.statusCode, 200, 'a status blip must not switch voiceovers off');
  assert.equal(spy.generated, 1);
});

test('audio: a voiceover comes back playable, recorded and counted', async () => {
  const { router, spy } = loadRoute(AUDIO, { balance: FREE });
  const res = mockRes();
  await handlerFor(router, 'post', '/generate')(
    mockReq({ body: { prompt: 'Any gym. Five pounds a day.', voice: 'Hype', length: '15s' } }), res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'done', 'speech finishes inside the request');
  assert.match(res.body.audioUrl, /^data:audio\/mpeg;base64,/);
  assert.equal(res.body.settings.voice, 'Hype');
  assert.equal(res.body.quota.remaining, 29);
  assert.equal(spy.finished[0].status, 'done', 'the row is the record, and it is done');
});

test('audio: an unknown voice falls back to a preset, never to a raw vendor id', async () => {
  const { router, spy } = loadRoute(AUDIO, { balance: FREE });
  const res = mockRes();
  await handlerFor(router, 'post', '/generate')(
    mockReq({ body: { prompt: 'Hello.', voice: 'nonexistent-voice-id' } }), res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.settings.voice, 'Coach');
  const { VOICES } = require(AUDIO)._internals;
  assert.ok(Object.values(VOICES).includes(spy.input.voiceId), 'only catalogued voice ids reach the vendor');
});

test('audio: a vendor failure is recorded as a failed job, not a silent 500', async () => {
  const { router, spy } = loadRoute(AUDIO, {
    balance: FREE,
    generate: async () => { throw new Error('speech model refused the request (401)'); },
  });
  const res = mockRes();
  await handlerFor(router, 'post', '/generate')(mockReq({ body: { prompt: 'Hello.' } }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(spy.finished[0].status, 'error');
});

// ─── Music ────────────────────────────────────────────────────────────────

test('music: a free plan reports paid_plan_required, not a missing key', async () => {
  const { router } = loadRoute(MUSIC, { balance: FREE });
  const res = mockRes();
  await handlerFor(router, 'get', '/health')(mockReq(), res);
  assert.equal(res.body.available, false);
  assert.equal(res.body.reason, 'paid_plan_required');
  assert.match(res.body.note, /paid ElevenLabs plan/);
});

test('music: generate refuses on a free plan without calling the vendor', async () => {
  const { router, spy } = loadRoute(MUSIC, { balance: FREE });
  const res = mockRes();
  await handlerFor(router, 'post', '/generate')(mockReq({ body: { prompt: 'gym loop' } }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.reason, 'paid_plan_required');
  assert.match(res.body.error, /Try Create Audio/);
  assert.equal(spy.generated, 0, 'a known-402 request is not worth making');
});

test('music: a paid plan switches it on with no code change', async () => {
  const { router, spy } = loadRoute(MUSIC, { balance: PAID });
  const res = mockRes();
  await handlerFor(router, 'get', '/health')(mockReq(), res);
  assert.equal(res.body.available, true);

  const gen = mockRes();
  await handlerFor(router, 'post', '/generate')(
    mockReq({ body: { prompt: 'gym loop', genre: 'Epic', length: '60s' } }), gen,
  );
  assert.equal(gen.statusCode, 200);
  assert.equal(gen.body.status, 'done');
  assert.equal(spy.input.ms, 60000, 'length is sent to the vendor in ms');
  assert.match(spy.input.prompt, /cinematic/, 'genre becomes a style hint in the prompt');
});

test('music: an unknown tier stays off rather than guessing', async () => {
  const { router } = loadRoute(MUSIC, { balance: null });
  const res = mockRes();
  await handlerFor(router, 'get', '/health')(mockReq(), res);
  assert.equal(res.body.available, false);
  assert.equal(res.body.reason, 'paid_plan_required');
});

// ─── Registry and sheet ───────────────────────────────────────────────────

test('the registry reports audio built and music plan-gated', () => {
  const routePath = path.join(ROOT, 'server', 'routes', 'squad-create');
  const saved = process.env.ELEVENLABS_API_KEY;
  const savedFlag = process.env.ELEVENLABS_MUSIC_ENABLED;
  process.env.ELEVENLABS_API_KEY = 'pretend-this-exists';
  delete process.env.ELEVENLABS_MUSIC_ENABLED;
  try {
    delete require.cache[require.resolve(routePath)];
    const router = require(routePath);
    const layer = router.stack.find((l) => l.route && l.route.path === '/modes');
    let payload = null;
    layer.route.stack[0].handle({}, { json: (d) => { payload = d; } });
    const modes = payload.modes;

    assert.equal(modes.audio.api, '/api/squad-audio');
    assert.equal(modes.audio.configured, true, 'speech runs on the free plan');

    assert.equal(modes.music.api, '/api/squad-music');
    assert.equal(modes.music.configured, false);
    assert.equal(
      modes.music.reason, 'paid_plan_required',
      'a key is present and the route exists — no_provider would send someone hunting for a variable',
    );
  } finally {
    if (saved === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved;
    if (savedFlag !== undefined) process.env.ELEVENLABS_MUSIC_ENABLED = savedFlag;
    delete require.cache[require.resolve(routePath)];
  }
});

test('every mode the server serves is reachable from the sheet', () => {
  // The #733 regression: Create Image existed server-side while the sheet
  // still had api: null, so Generate could never fire.
  const sheet = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');
  const routePath = path.join(ROOT, 'server', 'routes', 'squad-create');
  delete require.cache[require.resolve(routePath)];
  const { MODES } = require(routePath);
  for (const [key, def] of Object.entries(MODES)) {
    if (!def.api) continue;
    const entry = new RegExp(`key: '${key}',[\\s\\S]{0,120}?api: ('([^']*)'|null)`).exec(sheet);
    assert.ok(entry, `mode ${key} not found in the sheet`);
    assert.equal(
      entry[2], def.api,
      `the sheet must post ${key} to ${def.api} — api: null means a button that cannot fire`,
    );
  }
});

test('the server mounts every built mode', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const routePath = path.join(ROOT, 'server', 'routes', 'squad-create');
  delete require.cache[require.resolve(routePath)];
  const { MODES } = require(routePath);
  for (const def of Object.values(MODES)) {
    if (!def.api) continue;
    assert.ok(server.includes(`app.use('${def.api}'`), `${def.api} is declared but never mounted`);
  }
});
