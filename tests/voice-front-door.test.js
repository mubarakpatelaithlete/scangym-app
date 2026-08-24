/**
 * Voice is meant to be the front door, not a door in the way.
 *
 * Observed on live, 24 Aug 2026: opening the Book tab in a browser where the microphone is
 * blocked left an empty chat sheet covering the entire tab — voice-always armed, the sheet
 * opened first, the mic then failed, and the visitor was looking at a chat panel instead of
 * gyms. The tab that sells the product was hidden behind a feature that had already failed.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend/public/chat-agent.js'), 'utf8');

test('the sheet is no longer opened before the microphone is known to work', () => {
  assert.ok(!/startLive: function \(\) \{ build\(\); open\(\); startLive\(\); \}/.test(src),
    'opening before the mic starts is what covered the Book tab');
  assert.ok(src.includes('S.deferOpen = !S.open'), 'the public entry point must defer the takeover');
});

test('voice failing leaves the visitor on the tab, with no empty sheet and no error to dismiss', () => {
  // Scope to startLive's own catch — chat-agent has several .catch blocks.
  const liveStart = src.indexOf('var _live = window.SGVoice');
  const catchAt = src.indexOf('.catch(function (err) {', liveStart);
  const catchBlock = src.slice(catchAt, catchAt + 500);
  assert.ok(catchBlock.includes('if (S.deferOpen)'), 'a deferred open must be abandoned on failure');
  assert.ok(catchBlock.indexOf('return;') < catchBlock.indexOf('setHint('),
    'the hint is only for a sheet the visitor actually opened');
});

test('the sheet opens only once voice is genuinely live', () => {
  assert.ok(src.includes('if (S.deferOpen) { S.deferOpen = false; open(); }'),
    'success path must be what opens the sheet');
  const start = src.indexOf('var _live = window.SGVoice');
  assert.ok(start > -1 && src.indexOf('_live.then', start) > start, 'the start promise must gate the open');
});

test('a visitor who taps the mic themselves still gets the sheet and the error message', () => {
  // toggleMic is the deliberate path: it opens through the normal UI, so deferOpen is not set.
  assert.ok(src.includes('function toggleMic()'), 'the manual path must still exist');
  const manual = src.slice(src.indexOf('function toggleMic()'), src.indexOf('function toggleMicClassic()'));
  assert.ok(!manual.includes('deferOpen'), 'a deliberate tap should not be deferred');
});
