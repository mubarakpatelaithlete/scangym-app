/**
 * The number in the Create sheet has to be the number on the invoice.
 *
 * Two ways it drifted, both found by reading the catalogue against the vendor
 * pages (2026-09-19):
 *
 *   1. Eleven Music is carried twice — direct at $0.30/min and through fal at
 *      $0.60/min — and the sheet's dedupe keeps the first row. On a deployment
 *      where the direct row is unreachable (a free ElevenLabs plan answers 402)
 *      the creator was quoted 15p for a 30s track that resolved to fal and
 *      billed $0.60.
 *   2. fal publishes that model's price per minute, so a 15s track is not a
 *      quarter of the price. Quoting a fraction of a unit nobody bills in is a
 *      4x under-quote on the shortest option in the sheet.
 *
 * gen-models has no dependencies on purpose, so these assertions run anywhere.
 */

const test = require('node:test');
const assert = require('node:assert');

const models = require('../server/lib/gen-models');

const musicRow = (id) => models.MODELS.find((m) => m.id === id);

test('music through fal is quoted in the whole minutes fal bills', () => {
  const fal = musicRow('eleven-music-fal');
  assert.equal(fal.usdPerMinute, 0.6);
  // 15s and 30s both cost a minute, because a minute is the unit.
  assert.equal(models.estimateUsd(fal, { minutes: 0.25 }), 0.6);
  assert.equal(models.estimateUsd(fal, { minutes: 0.5 }), 0.6);
  // 90s rounds up to two.
  assert.equal(models.estimateUsd(fal, { minutes: 1.5 }), 1.2);
});

test('the direct ElevenLabs row keeps its per-second pricing', () => {
  const direct = musicRow('eleven-music');
  assert.equal(direct.billingIncrementMinutes, undefined);
  assert.equal(models.estimateUsd(direct, { minutes: 0.5 }), 0.15);
});

test('the catalogue quotes the row this deployment can actually reach', () => {
  const falOnly = models.catalogueFor('music', { minutes: 0.5 }, (m) => m.provider === 'fal');
  assert.equal(falOnly.length, 1);
  assert.equal(falOnly[0].id, 'eleven-music-fal');
  assert.equal(falOnly[0].estimateUsd, 0.6, 'the price of the model that will run');

  // With everything reachable the cheap direct row still wins the slot.
  const all = models.catalogueFor('music', { minutes: 0.5 }, () => true);
  assert.equal(all[0].id, 'eleven-music');
});

test('an unreachable catalogue still describes the button', () => {
  // Nothing keyed must not empty the sheet: /health's available:false is what
  // stops the tap, not a blank list the creator cannot make sense of.
  const none = models.catalogueFor('music', { minutes: 0.5 }, () => false);
  assert.ok(none.length >= 1);
});

test('every priced row says what unit its price is in', () => {
  const image = models.catalogueFor('image', { images: 1 });
  assert.ok(image.length > 0);
  image.forEach((row) => assert.equal(row.unit, 'per image'));

  const [music] = models.catalogueFor('music', { minutes: 0.5 }, (m) => m.provider === 'fal');
  assert.equal(music.unit, 'per full minute');
});
