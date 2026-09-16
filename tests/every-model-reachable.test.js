/**
 * "Is every model available to ScanGym customers?"
 *
 * It was not, and the gap was not only missing keys. Three separate walls
 * stood between a customer and the catalogue:
 *
 *  1. No text model could be chosen at all — captions ran on whatever
 *     lib/llm.js had, with no picker and no way to ask for Claude or Gemini.
 *  2. Every video and image row sat behind a single vendor key, so one
 *     blocked Google project (403 PERMISSION_DENIED, 2026-09-16) took out
 *     the only working video model with no alternative route to the same
 *     model.
 *  3. The sheet asked each mode's /health for its catalogue — prices,
 *     labels, the cheap default — and then **threw it away**. Even a fully
 *     keyed deployment offered the customer no choice whatsoever.
 *
 * These tests pin the fixes: a text picker that degrades instead of failing,
 * the same model reachable through more than one provider, and a sheet that
 * actually renders what the server offers.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'server', 'lib');

function loadModels() {
  const p = require.resolve(path.join(LIB, 'gen-models'));
  delete require.cache[p];
  return require(p);
}

// ─── The catalogue covers the five buttons ────────────────────────────────

test('every Create mode with a route has at least one model row', () => {
  const models = loadModels();
  for (const kind of ['text', 'image', 'audio', 'music', 'video']) {
    assert.ok(models.byKind(kind).length > 0, `${kind} has no models to offer`);
  }
});

test('the text row covers the five vendors a creator asked for, on one key', () => {
  const models = loadModels();
  const text = models.byKind('text');
  for (const id of ['gpt-5.6', 'claude-5', 'gemini-3', 'kimi-k2.5', 'grok-4.5']) {
    const row = text.find((m) => m.id === id);
    assert.ok(row, `${id} is not in the catalogue`);
    assert.equal(row.provider, 'openrouter', 'five vendor accounts is five billing relationships');
    assert.ok(row.providerModel.includes('/'), 'a vendor slug, not a marketing name');
  }
  const providers = new Set(text.map((m) => m.provider));
  assert.equal(providers.size, 1, 'one key should reach all of them');
});

test('a caption is priced in fractions of a penny, so the choice is voice not cost', () => {
  const models = loadModels();
  for (const row of models.byKind('text')) {
    const usd = models.estimateUsd(row, { tokensIn: 700, tokensOut: 200 });
    assert.ok(usd != null, `${row.id} has no price`);
    assert.ok(usd < 0.01, `${row.id} costs ${usd} for one caption`);
  }
});

test('Veo is reachable through fal as well as Google, so one blocked project is not an outage', () => {
  const models = loadModels();
  const veo = models.byKind('video').filter((m) => m.label.startsWith('Veo'));
  assert.ok(veo.length >= 2, 'a single-provider model is a single point of failure');
  assert.deepEqual(
    [...new Set(veo.map((m) => m.provider))].sort(),
    ['fal', 'gemini'],
    'the same model, two ways in',
  );
});

test('a fal key alone can serve every media mode', () => {
  const models = loadModels();
  for (const kind of ['image', 'video']) {
    const rows = models.byKind(kind).filter((m) => m.provider === 'fal');
    assert.ok(rows.length > 0, `${kind} has no fal row, so one key cannot light it up`);
  }
});

test('ElevenLabs v3 is offered but is not the default, because it is 3x Flash', () => {
  const models = loadModels();
  const v3 = models.byKind('audio').find((m) => m.id === 'eleven-v3');
  assert.ok(v3, 'v3 is generally available and was verified against the live account');
  assert.equal(v3.tier, 'standard');
  const dflt = models.resolve('audio', undefined);
  assert.equal(dflt.id, 'eleven-flash-v2.5', 'the default stays the cheapest row');
  assert.ok(
    models.estimateUsd(v3, { chars: 1000 }) > models.estimateUsd(dflt, { chars: 1000 }),
    'and the dearer row must read as dearer',
  );
});

// ─── The text picker degrades, never fails ────────────────────────────────

function loadTextRoute() {
  const id = require.resolve(path.join(ROOT, 'server', 'routes', 'squad-text'));
  delete require.cache[id];
  const mod = require(id);
  delete require.cache[id];
  return mod;
}

test('an unknown or unkeyed model falls back to the house writer instead of failing', () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const { pickNamedModel } = loadTextRoute()._internals;
    assert.equal(pickNamedModel({ model: 'claude-5' }), null, 'no key means no picker, not an error');
    assert.equal(pickNamedModel({ model: 'not-a-model' }), null);
    assert.equal(pickNamedModel({}), null);

    process.env.OPENROUTER_API_KEY = 'pretend-this-exists';
    const { pickNamedModel: picker } = loadTextRoute()._internals;
    assert.equal(picker({ model: 'claude-5' }).providerModel, 'anthropic/claude-sonnet-5');
    assert.equal(picker({ model: 'house' }), null, 'the house writer stays selectable');
    assert.equal(picker({ model: '../../etc/passwd' }), null, 'ids are matched, never interpolated');
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved;
  }
});

test('text health offers the picker only when there is a key behind it', async () => {
  const saved = process.env.OPENROUTER_API_KEY;
  /* Health is async since it also reports the creator's daily budget
     (server/lib/gen-budget.js), so the body has to be awaited — a synchronous
     read of it was null and the assertions below silently passed on nothing. */
  const call = async () => {
    const router = loadTextRoute();
    const layer = router.stack.find((l) => l.route && l.route.path === '/health' && l.route.methods.get);
    let body = null;
    await layer.route.stack[layer.route.stack.length - 1].handle(
      { ip: '1.2.3.4', query: {} },
      { json: (d) => { body = d; } },
    );
    return body;
  };
  try {
    delete process.env.OPENROUTER_API_KEY;
    assert.deepEqual((await call()).models, [], 'an empty list renders a button with no dropdown');

    process.env.OPENROUTER_API_KEY = 'pretend-this-exists';
    const withKey = await call();
    assert.ok(withKey.models.length >= 5);
    assert.ok(!('providerModel' in withKey.models[0]), 'vendor slugs stay server-side');
    assert.ok(withKey.models.every((m) => m.estimateUsd != null), 'a price is quoted before spending');
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved;
  }
});

// ─── The sheet renders what the server offers ─────────────────────────────

test('the sheet renders the catalogue instead of discarding it', () => {
  const sheet = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');
  assert.match(sheet, /function renderModelPicker/, 'no picker means no customer choice');
  assert.match(sheet, /renderModelPicker\(sh, mode, d\)/, 'the picker must be fed the health payload');
  assert.match(sheet, /body\.model = state\[mode\.key\]\.__model/, 'the choice must reach the server');
  assert.match(sheet, /list\.length < 2/, 'one model is furniture, not a dropdown');
});

test('the sheet does not disable a mode whose health reports configured instead of available', () => {
  // Text answers { ok, configured }, the media modes answer { available }.
  // A check written for one shape silently disabled the other.
  const sheet = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');
  assert.match(sheet, /d\.available === undefined/, 'both health shapes must be handled');
});
