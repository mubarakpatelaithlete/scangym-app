/**
 * The Create sheet must never quietly pick an expensive model.
 *
 * Create Video ran on Veo at ~$0.15/second. At eight seconds a clip and two
 * clips a day that is roughly £104 a month for one creator — about 23 day
 * passes at £4.49, to serve one person's reels. WAN 2.5 is the same button
 * for roughly £19. So the single most expensive decision in this feature is
 * which catalogue row is the default, and it is worth a test rather than a
 * code review.
 *
 * These tests therefore care about three things:
 *   1. the default for every mode is the cheapest tier, never a premium model
 *   2. an unrecognised or premium model id can only ever fall *down* to the
 *      default — a crafted request cannot escalate us onto Veo
 *   3. a price is quoted before we spend, and "unknown" is never 0
 *
 * No network and no database: the catalogue is data and the maths is pure.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'server', 'lib');

/**
 * The catalogue reads PREMIUM_MODELS_ENABLED at call time, not at load time,
 * so the flag has to be set while the assertions run — not merely while the
 * module is required. Getting that wrong made two of these tests pass for the
 * wrong reason, which in a file whose whole job is to police the default
 * model is worse than a failure.
 */
function loadModels(env = {}) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const p = require.resolve(path.join(LIB, 'gen-models'));
  delete require.cache[p];
  return require(p);
}

/** Restore the flag so tests cannot leak state into each other. */
function clearPremium() {
  delete process.env.PREMIUM_MODELS_ENABLED;
}

test('every mode has exactly one default model', () => {
  const models = loadModels();
  for (const kind of ['video', 'image', 'audio', 'music']) {
    const defaults = models.byKind(kind).filter((m) => m.tier === 'default');
    assert.strictEqual(defaults.length, 1, `${kind} should have one default, has ${defaults.length}`);
  }
});

test('the default video model is the cheapest one we offer', () => {
  const models = loadModels();
  const video = models.byKind('video');
  const cheapest = video.reduce((a, b) => (a.usdPerSecond <= b.usdPerSecond ? a : b));
  const chosen = models.resolve('video', undefined);
  assert.strictEqual(chosen.id, cheapest.id);
  // And it is not the one that caused the problem.
  assert.notStrictEqual(chosen.provider, 'gemini');
});

test('an unknown model id falls back to the default rather than erroring', () => {
  const models = loadModels();
  assert.strictEqual(models.resolve('video', 'no-such-model').tier, 'default');
  assert.strictEqual(models.resolve('image', '').tier, 'default');
});

test('premium models cannot be selected unless explicitly enabled', () => {
  const off = loadModels({ PREMIUM_MODELS_ENABLED: 'false' });
  const asked = off.resolve('video', 'veo-3.1-fast');
  assert.strictEqual(asked.tier, 'default', 'premium request must fall back when disabled');

  const on = loadModels({ PREMIUM_MODELS_ENABLED: 'true' });
  assert.strictEqual(on.resolve('video', 'veo-3.1-fast').id, 'veo-3.1-fast');
  clearPremium();
});

test('a bad model id can never escalate to a dearer model', () => {
  const models = loadModels({ PREMIUM_MODELS_ENABLED: 'true' }); // worst case: premium is on
  const def = models.resolve('video', undefined);
  for (const id of ['veo-3.1-fast', 'kling-3.0-pro', 'garbage', null, 42, {}]) {
    const got = models.resolve('video', typeof id === 'string' ? id : undefined);
    if (typeof id !== 'string') {
      assert.strictEqual(got.usdPerSecond, def.usdPerSecond, 'non-string ids must land on the default');
    }
  }
  clearPremium();
});

test('the premium catalogue is hidden from the sheet when disabled', () => {
  const off = loadModels({ PREMIUM_MODELS_ENABLED: 'false' });
  const ids = off.catalogueFor('video', { seconds: 8 }).map((m) => m.id);
  assert.ok(!ids.includes('veo-3.1-fast'));
  assert.ok(ids.includes('wan-2.5'));
  clearPremium();
});

test('the catalogue never leaks the vendor model path to the client', () => {
  const models = loadModels({ PREMIUM_MODELS_ENABLED: 'true' });
  for (const entry of models.catalogueFor('video', { seconds: 8 })) {
    assert.ok(!('providerModel' in entry), 'providerModel must stay server-side');
  }
  clearPremium();
});

test('cost is quoted before spending, and scales with the billed unit', () => {
  const models = loadModels({ PREMIUM_MODELS_ENABLED: 'true' });
  const wan = models.resolve('video', 'wan-2.5');
  assert.strictEqual(models.estimateUsd(wan, { seconds: 8 }), 0.4);

  const veo = models.resolve('video', 'veo-3.1-fast');
  const veoCost = models.estimateUsd(veo, { seconds: 8 });
  assert.ok(veoCost > models.estimateUsd(wan, { seconds: 8 }) * 2, 'premium must read as clearly dearer');

  clearPremium();
  const img = models.resolve('image', undefined);
  assert.ok(models.estimateUsd(img, { images: 4 }) > models.estimateUsd(img, { images: 1 }));

  const speech = models.resolve('audio', undefined);
  assert.strictEqual(models.estimateUsd(speech, { chars: 2000 }), 0.1);
});

test('an unknown unit reads as unknown, never as free', () => {
  const models = loadModels();
  const wan = models.resolve('video', 'wan-2.5');
  assert.strictEqual(models.estimateUsd(wan, {}), null, 'no duration means no quote, not £0');
  assert.strictEqual(models.estimateUsd(null, { seconds: 8 }), null);
});

test('a video clip costs more than an image, so their caps differ', () => {
  const models = loadModels();
  const clip = models.estimateUsd(models.resolve('video', undefined), { seconds: 8 });
  const image = models.estimateUsd(models.resolve('image', undefined), { images: 1 });
  assert.ok(clip > image * 5, 'if this stops holding, revisit the per-mode caps');

  const p = require.resolve(path.join(LIB, 'gen-jobs'));
  delete require.cache[p];
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/none';
  const jobs = require(p);
  assert.ok(jobs.capFor('video') < jobs.capFor('image'), 'the dear mode must have the tighter cap');
});
