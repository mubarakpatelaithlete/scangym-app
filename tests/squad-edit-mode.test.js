/**
 * Edit — the ninth Create mode, and the first that takes a video *in*.
 *
 * What can go wrong here is not "the button looks wrong", it is money and
 * silent no-ops:
 *   1. a payload that omits a field the vendor requires (fal 422s, or worse,
 *      ignores the setting the creator chose — the Seedream bug, again),
 *   2. an untrusted `videoUrl` reaching the vendor or our own network,
 *   3. a default row that is not the cheap one, or a premium row reachable
 *      without the flag,
 *   4. the registry advertising the mode with no route behind it.
 *
 * No network and no database: the profiles are pure functions and the
 * catalogue is data.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'server', 'lib');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/none';

function loadModels(env = {}) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const p = require.resolve(path.join(LIB, 'gen-models'));
  delete require.cache[p];
  return require(p);
}

const route = require(path.join(ROOT, 'server', 'routes', 'squad-edit'));
const { buildInput, cleanSettings, cleanVideoUrl, promptRequired, EDIT_PROFILES } = route._internals;

// ── the catalogue ─────────────────────────────────────────────────────────

test('edit has exactly one default row and it is the cheap prompt-edit model', () => {
  const models = loadModels();
  const defaults = models.byKind('edit').filter((m) => m.tier === 'default');
  assert.strictEqual(defaults.length, 1);
  assert.strictEqual(defaults[0].id, 'omni-flash-edit');
  assert.strictEqual(models.resolve('edit', undefined).id, 'omni-flash-edit');
});

test('an unknown or premium edit model can only fall down to the default', () => {
  delete process.env.PREMIUM_MODELS_ENABLED;
  const models = loadModels();
  assert.strictEqual(models.resolve('edit', 'no-such-edit').tier, 'default');
  assert.strictEqual(models.resolve('edit', 'kling-o3-4k-edit').tier, 'default');
});

test('the 4K edit row is premium, because it is 14x the default', () => {
  const models = loadModels({ PREMIUM_MODELS_ENABLED: 'true' });
  const cheap = models.resolve('edit', undefined);
  const dear = models.resolve('edit', 'kling-o3-4k-edit');
  assert.strictEqual(dear.tier, 'premium');
  assert.ok(dear.usdPerSecond > cheap.usdPerSecond * 10);
  delete process.env.PREMIUM_MODELS_ENABLED;
});

test('an edit is quoted per second of the source clip, never as free', () => {
  const models = loadModels();
  const m = models.resolve('edit', undefined);
  assert.strictEqual(models.estimateUsd(m, { seconds: 10 }), 0.3);
  assert.strictEqual(models.estimateUsd(m, {}), null, 'no length means no quote, not £0');
});

test('every edit row is a fal row with a payload profile we implement', () => {
  const models = loadModels({ PREMIUM_MODELS_ENABLED: 'true' });
  for (const m of models.byKind('edit')) {
    assert.strictEqual(m.provider, 'fal', `${m.id} must be on fal`);
    assert.ok(EDIT_PROFILES[m.inputProfile], `${m.id} has no payload profile (${m.inputProfile})`);
  }
  delete process.env.PREMIUM_MODELS_ENABLED;
});

test('the edit catalogue never leaks the vendor model path to the client', () => {
  const models = loadModels({ PREMIUM_MODELS_ENABLED: 'true' });
  for (const row of models.catalogueFor('edit', { seconds: 8 })) {
    assert.ok(!('providerModel' in row), 'providerModel must stay server-side');
  }
  delete process.env.PREMIUM_MODELS_ENABLED;
});

// ── the payloads ──────────────────────────────────────────────────────────

test('every profile sends the source clip and the field that vendor requires', () => {
  const models = loadModels({ PREMIUM_MODELS_ENABLED: 'true' });
  const s = cleanSettings({});
  const url = 'https://cdn.example.com/clip.mp4';
  // required fields per model, read from each queue OpenAPI schema 2026-09-28
  const required = {
    'omni-flash-edit': ['video_url', 'prompt'],
    'lucy-restyle': ['video_url', 'prompt'],
    'grok-edit-video': ['video_url', 'prompt'],
    'wan-2.7-edit': ['video_url', 'prompt'],
    'ray-3.2-reframe': ['video_url', 'prompt', 'aspect_ratio'],
    'heygen-dub': ['video_url', 'output_language'],
    'hunyuan-foley': ['video_url', 'text_prompt'],
    'ltx-extend': ['video_url'],
    'kling-o3-4k-edit': ['video_url', 'prompt'],
  };
  for (const m of models.byKind('edit')) {
    const input = buildInput(m, url, 'make it brighter', s);
    assert.strictEqual(input.video_url, url, `${m.id} must pass the source clip`);
    for (const field of required[m.id] || []) {
      assert.ok(input[field] !== undefined && input[field] !== '', `${m.id} must send ${field}`);
    }
  }
  delete process.env.PREMIUM_MODELS_ENABLED;
});

test('the chosen settings reach the vendor rather than being dropped', () => {
  const models = loadModels();
  const s = cleanSettings({ aspectRatio: '16:9', resolution: '1080p', language: 'French', sourceSeconds: 15 });
  assert.strictEqual(buildInput(models.resolve('edit', 'ray-3.2-reframe'), 'https://x/y.mp4', 'p', s).aspect_ratio, '16:9');
  assert.strictEqual(buildInput(models.resolve('edit', 'heygen-dub'), 'https://x/y.mp4', '', s).output_language, 'French');
  assert.strictEqual(buildInput(models.resolve('edit', 'omni-flash-edit'), 'https://x/y.mp4', 'p', s).resolution, '1080p');
  // Grok has no 1080p tier: ask for it and we must send something it accepts.
  assert.strictEqual(buildInput(models.resolve('edit', 'grok-edit-video'), 'https://x/y.mp4', 'p', s).resolution, '720p');
});

test('settings outside the whitelist collapse to the defaults', () => {
  const s = cleanSettings({ sourceSeconds: 600, aspectRatio: '', resolution: '8k', language: 'Klingon' });
  assert.strictEqual(s.sourceSeconds, 8);
  assert.strictEqual(s.aspectRatio, '9:16');
  assert.strictEqual(s.resolution, '720p');
  assert.strictEqual(s.language, 'Spanish');
});

test('only an http(s) clip link is accepted', () => {
  assert.ok(cleanVideoUrl('https://cdn.example.com/a.mp4').url);
  for (const bad of ['', 'not a url', 'file:///etc/passwd', 'data:video/mp4;base64,AAA', 'javascript:alert(1)']) {
    assert.ok(cleanVideoUrl(bad).error, `${bad} must be refused`);
  }
});

test('a prompt is required only for the models that use one', () => {
  const models = loadModels();
  assert.ok(promptRequired(models.resolve('edit', 'omni-flash-edit')));
  assert.ok(!promptRequired(models.resolve('edit', 'heygen-dub')));
  assert.ok(!promptRequired(models.resolve('edit', 'hunyuan-foley')));
});

// ── the wiring ────────────────────────────────────────────────────────────

test('the registry reports edit with a route, gated on the fal key', () => {
  const p = require.resolve(path.join(ROOT, 'server', 'routes', 'squad-create'));
  delete require.cache[p];
  const router = require(p);
  const layer = router.stack.find((l) => l.route && l.route.path === '/modes');
  let payload = null;
  const saved = process.env.FAL_KEY;
  try {
    process.env.FAL_KEY = 'pretend-this-exists';
    layer.route.stack[0].handle({}, { json: (d) => { payload = d; } });
    assert.strictEqual(payload.modes.edit.api, '/api/squad-edit');
    assert.strictEqual(payload.modes.edit.configured, true);

    delete process.env.FAL_KEY;
    layer.route.stack[0].handle({}, { json: (d) => { payload = d; } });
    assert.strictEqual(payload.modes.edit.configured, false, 'no key means not configured');
    assert.strictEqual(payload.modes.edit.reason, 'no_provider');
  } finally {
    if (saved === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = saved;
  }
});

test('the route serves the shape the sheet already polls', () => {
  const paths = route.stack.filter((l) => l.route).map((l) => l.route.path);
  for (const p of ['/health', '/generate', '/status/:jobId', '/history']) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

test('the edit mode has its own daily cap, no looser than video', () => {
  const p = require.resolve(path.join(LIB, 'gen-jobs'));
  delete require.cache[p];
  const jobs = require(p);
  assert.ok(jobs.capFor('edit') <= jobs.capFor('video'));
});

test('the sheet carries the mode and asks for a source clip', () => {
  const sheet = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');
  assert.ok(sheet.includes("key: 'edit'"), 'no edit entry in MODES');
  assert.ok(sheet.includes("api: '/api/squad-edit'"), 'edit entry must point at the route');
  assert.ok(sheet.includes('needsSource'), 'edit must ask for a source clip');
  assert.ok(sheet.includes('body.videoUrl = sourceUrl'), 'the source clip must be posted');
});
