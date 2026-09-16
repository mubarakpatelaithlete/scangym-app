/* What a creator sees in the picker is the product, not our supply chain.
   These lock two promises: no wholesaler's name reaches a label or note, and
   the same model never appears twice because we can reach it two ways. */
const test = require('node:test');
const assert = require('node:assert');
const models = require('../server/lib/gen-models.js');

const KINDS = ['text', 'image', 'audio', 'music', 'video'];
const UNITS = { chars: 700, minutes: 0.5, tokensIn: 700, tokensOut: 200, seconds: 8, count: 1 };

test('no vendor plumbing is named in anything a customer reads', () => {
  for (const kind of KINDS) {
    for (const row of models.catalogueFor(kind, UNITS)) {
      const read = `${row.label} ${row.note || ''}`.toLowerCase();
      assert.ok(!/\bfal\b|fal\.ai|openrouter/.test(read), `${kind}/${row.id} leaks a reseller: ${read}`);
    }
  }
});

test('one chip per model, even when two routes reach it', () => {
  for (const kind of KINDS) {
    const labels = models.catalogueFor(kind, UNITS).map((r) => r.label);
    assert.deepStrictEqual([...new Set(labels)], labels, `${kind} shows a duplicate label`);
  }
});

test('the collapsed rows are still reachable behind the scenes', () => {
  // The fal-routed voice and music rows stay in the catalogue so
  // resolveAvailable() can fall through to them; they are just not chips.
  for (const id of ['eleven-v3-fal', 'eleven-music-fal']) {
    assert.ok(models.MODELS.some((m) => m.id === id), `${id} should still exist as a route`);
  }
  assert.ok(!models.catalogueFor('audio', UNITS).some((r) => r.id === 'eleven-v3-fal'));
  assert.ok(!models.catalogueFor('music', UNITS).some((r) => r.id === 'eleven-music-fal'));
});
