/**
 * The outage these tests exist for, in full, because it is the most
 * expensive kind:
 *
 * On 2026-09-16 the production Gemini key could list models and read model
 * metadata perfectly well, while every actual render returned
 * `403 PERMISSION_DENIED — "Your project has been denied access."`
 * Create Video's /health probe was `GET /models/{VEO_MODEL}`, which answered
 * 200. So health reported `available: true`, the sheet offered the button,
 * and every customer who pressed it got a failure — for hours, while three
 * status reports said the feature was live.
 *
 * A health check that passes while the feature is dead is worse than having
 * no health check at all, because it stops anyone looking. The invariants:
 *
 *  1. Health asks whether we may *generate*, not whether the model exists.
 *  2. A blocked project reads as unavailable, with a reason that names the
 *     problem (`provider_denied`), not a vague "key_rejected".
 *  3. The probe never renders anything — it must not cost money to ask.
 *  4. A network blip is not a denial: an unreachable vendor must not switch
 *     a working feature off.
 *  5. A real refusal during generation updates health immediately, rather
 *     than waiting for the next customer to discover it.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const PROVIDER = path.join(ROOT, 'server', 'lib', 'gen-provider');

/** Fresh provider module with fetch replaced, so the access cache is empty. */
function loadProvider(fetchImpl) {
  const id = require.resolve(PROVIDER);
  delete require.cache[id];
  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  const provider = require(PROVIDER);
  delete require.cache[id];
  return { provider, restore: () => { global.fetch = realFetch; } };
}

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('a blocked project is unavailable, and says so by name', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const calls = [];
  const { provider, restore } = loadProvider(async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method, body: opts?.body });
    return reply(403, { error: { message: 'Your project has been denied access. Please contact support.' } });
  });
  try {
    const access = await provider.geminiGenerationAccess('veo-3.1-fast-generate-preview');
    assert.equal(access.ok, false);
    assert.equal(access.reason, 'provider_denied');
    assert.equal(access.status, 403);

    // The probe must hit the generation endpoint. Metadata was the bug.
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /:predictLongRunning/);
    assert.equal(calls[0].method, 'POST');
  } finally { restore(); }
});

test('the probe generates nothing — an empty payload, refused on arguments', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const calls = [];
  const { provider, restore } = loadProvider(async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    // What a healthy project answers: authorized, arguments rejected.
    return reply(400, { error: { message: 'instances is empty' } });
  });
  try {
    const access = await provider.geminiGenerationAccess('veo-3.1-fast-generate-preview');
    assert.equal(access.ok, true, '400 means authorized — only our deliberate nonsense was refused');
    assert.deepEqual(calls[0].instances, [], 'no prompt, so nothing can render and nothing can bill');
    assert.ok(!('parameters' in calls[0]), 'no render parameters either');
  } finally { restore(); }
});

test('a network blip does not switch a working feature off', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const { provider, restore } = loadProvider(async () => { throw new Error('ETIMEDOUT'); });
  try {
    const access = await provider.geminiGenerationAccess('veo-3.1-fast-generate-preview');
    assert.equal(access.ok, true, 'unknown must not mean unavailable');
    assert.equal(access.unverified, true, 'but it must be flagged as unverified, not asserted as fine');
  } finally { restore(); }
});

test('no key is no_api_key, and costs no request at all', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let called = 0;
  const { provider, restore } = loadProvider(async () => { called += 1; return reply(400, {}); });
  try {
    const access = await provider.geminiGenerationAccess('veo-3.1-fast-generate-preview');
    assert.equal(access.ok, false);
    assert.equal(access.reason, 'no_api_key');
    assert.equal(called, 0);
  } finally {
    restore();
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test('the answer is cached, so health polling does not hammer the vendor', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  let called = 0;
  const { provider, restore } = loadProvider(async () => { called += 1; return reply(403, { error: { message: 'denied' } }); });
  try {
    await provider.geminiGenerationAccess('veo-3.1-fast-generate-preview');
    await provider.geminiGenerationAccess('veo-3.1-fast-generate-preview');
    await provider.geminiGenerationAccess('veo-3.1-fast-generate-preview');
    assert.equal(called, 1);
    // ...but a forced check goes out again, for the 9am "is it back yet" case.
    await provider.geminiGenerationAccess('veo-3.1-fast-generate-preview', { force: true });
    assert.equal(called, 2);
  } finally { restore(); }
});

test('a real 403 during generation marks the feature unavailable at once', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  let called = 0;
  const { provider, restore } = loadProvider(async () => { called += 1; return reply(400, {}); });
  try {
    // Health currently believes all is well.
    assert.equal((await provider.geminiGenerationAccess('veo-x')).ok, true);
    // A customer presses the button and Google refuses.
    provider.noteGenerationOutcome('gemini', 'veo-x', { ok: false, status: 403 });
    const after = await provider.geminiGenerationAccess('veo-x');
    assert.equal(after.ok, false, 'a live refusal outranks a stale probe');
    assert.equal(after.reason, 'provider_denied');
    assert.equal(called, 1, 'and it needed no extra request to find out');
  } finally { restore(); }
});

test('a successful render clears a previous denial', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const { provider, restore } = loadProvider(async () => reply(403, { error: { message: 'denied' } }));
  try {
    assert.equal((await provider.geminiGenerationAccess('veo-y')).ok, false);
    provider.noteGenerationOutcome('gemini', 'veo-y', { ok: true });
    assert.equal((await provider.geminiGenerationAccess('veo-y')).ok, true, 'proof of work beats a cached denial');
  } finally { restore(); }
});

test('health reports the denial rather than the model catalogue looking fine', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const savedFal = process.env.FAL_KEY;
  delete process.env.FAL_KEY; // production: Gemini only, which is how the lie happened

  const providerId = require.resolve(PROVIDER);
  const routeId = require.resolve(path.join(ROOT, 'server', 'routes', 'squad-video'));
  const realFetch = global.fetch;
  global.fetch = async () => reply(403, { error: { message: 'Your project has been denied access.' } });
  delete require.cache[providerId];
  delete require.cache[routeId];
  try {
    const router = require(path.join(ROOT, 'server', 'routes', 'squad-video'));
    const layer = router.stack.find((l) => l.route && l.route.path === '/health' && l.route.methods.get);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await handler({ ip: '1.2.3.4', query: {}, body: {}, params: {} }, res);

    assert.equal(res.body.available, false, 'this is the assertion that was missing all along');
    assert.equal(res.body.reason, 'provider_denied');
    assert.ok(Array.isArray(res.body.models), 'the catalogue is still reported — it just is not evidence');
  } finally {
    global.fetch = realFetch;
    delete require.cache[providerId];
    delete require.cache[routeId];
    if (savedFal !== undefined) process.env.FAL_KEY = savedFal;
  }
});

/**
 * The second half of the same lie: /health told the truth while
 * /api/squad-create/modes still said video was configured, because the
 * registry only checked that a key existed. The sheet reads the registry, so
 * the button stayed on offer.
 */
test('the mode registry stops offering a mode whose provider has refused us', () => {
  const providerId = require.resolve(PROVIDER);
  const routeId = require.resolve(path.join(ROOT, 'server', 'routes', 'squad-create'));
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  delete require.cache[providerId];
  delete require.cache[routeId];

  const getModes = () => {
    const router = require(path.join(ROOT, 'server', 'routes', 'squad-create'));
    const layer = router.stack.find((l) => l.route && l.route.path === '/modes');
    let payload = null;
    layer.route.stack[0].handle({}, { json: (d) => { payload = d; } });
    return payload.modes;
  };

  try {
    const provider = require(PROVIDER);

    // Nothing known yet: stay optimistic, the route's own health is the
    // authority and going dark on no evidence is its own outage.
    assert.equal(getModes().video.configured, true);

    // Now Google has refused an actual render.
    provider.noteGenerationOutcome('gemini', 'veo-3.1-fast-generate-preview', { ok: false, status: 403 });
    delete require.cache[routeId];
    const denied = getModes().video;
    assert.equal(denied.configured, false, 'a key we are not allowed to use is not a working mode');
    assert.equal(denied.reason, 'provider_denied');

    // And when access comes back, so does the button.
    provider.noteGenerationOutcome('gemini', 'veo-3.1-fast-generate-preview', { ok: true });
    delete require.cache[routeId];
    assert.equal(getModes().video.configured, true);
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
    delete require.cache[providerId];
    delete require.cache[routeId];
  }
});
