/**
 * How long we wait before deciding you have stopped talking.
 *
 * Every spoken turn paid a flat 750ms of silence before the request even
 * started. Halving it across the board is the obvious move and the wrong one:
 * short utterances are exactly the ones people pause inside —
 * "book me…" *(thinks)* "…a gym near Bolton" — and cutting that in half sends
 * half a sentence to the transcriber.
 *
 * So the wait shrinks with the evidence: once someone has been speaking for
 * SETTLED_MS, a pause almost certainly means they are finished, and we take the
 * short wait. Below that, we stay patient.
 *
 * These tests read the shipped file rather than importing it (voice.js is a
 * browser IIFE that needs AudioContext), and re-implement nothing: the decision
 * function is extracted and run.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'voice.js'),
  'utf8'
);

/** Pull the constants and endOfTurnMs() out of the file and make them runnable. */
function harness() {
  const consts = ['SILENCE_MS', 'SILENCE_SETTLED_MS', 'SETTLED_MS']
    .map((name) => {
      const m = new RegExp(`var ${name} = (\\d+);`).exec(SRC);
      assert.ok(m, `${name} must be declared in voice.js`);
      return `var ${name} = ${m[1]};`;
    })
    .join('\n');

  const fn = /function endOfTurnMs\(\)[\s\S]*?\n  \}/.exec(SRC);
  assert.ok(fn, 'endOfTurnMs() must exist in voice.js');

  const ctx = { live: null, Date };
  vm.createContext(ctx);
  vm.runInContext(`${consts}\n${fn[0]}\nthis.endOfTurnMs = endOfTurnMs;`, ctx);
  return ctx;
}

test('a long, finished phrase gets the short wait', () => {
  const ctx = harness();
  const now = Date.now();
  ctx.live = { heard: true, speechStartedAt: now - 3000, quietSince: now };
  assert.strictEqual(ctx.endOfTurnMs(), 450);
});

test('a short utterance keeps the patient wait — people pause inside those', () => {
  const ctx = harness();
  const now = Date.now();
  ctx.live = { heard: true, speechStartedAt: now - 400, quietSince: now };
  assert.strictEqual(ctx.endOfTurnMs(), 750);
});

test('the boundary is the settled threshold, not an arbitrary number', () => {
  const ctx = harness();
  const now = Date.now();
  ctx.live = { heard: true, speechStartedAt: now - 1500, quietSince: now };
  assert.strictEqual(ctx.endOfTurnMs(), 450, 'exactly settled counts as settled');
  ctx.live = { heard: true, speechStartedAt: now - 1499, quietSince: now };
  assert.strictEqual(ctx.endOfTurnMs(), 750);
});

test('nothing heard yet means the patient wait, never the short one', () => {
  const ctx = harness();
  ctx.live = { heard: false, startedAt: Date.now() - 9000 };
  assert.strictEqual(ctx.endOfTurnMs(), 750);
  ctx.live = null;
  assert.strictEqual(ctx.endOfTurnMs(), 750);
});

test('the short wait is never longer than the patient one', () => {
  const ctx = harness();
  const short = /var SILENCE_SETTLED_MS = (\d+);/.exec(SRC)[1];
  const patient = /var SILENCE_MS = (\d+);/.exec(SRC)[1];
  assert.ok(Number(short) < Number(patient));
  assert.ok(Number(short) >= 300, 'below ~300ms a normal breath ends your turn');
});

test('a new segment forgets the previous phrase length', () => {
  assert.match(
    SRC,
    /live\.speechStartedAt = 0;/,
    'openSegment() must reset speechStartedAt, or the next turn inherits this one'
  );
  const open = /function openSegment\(\)[\s\S]*?\n  \}/.exec(SRC)[0];
  assert.ok(
    open.includes('live.speechStartedAt = 0;'),
    'the reset belongs in openSegment()'
  );
});
