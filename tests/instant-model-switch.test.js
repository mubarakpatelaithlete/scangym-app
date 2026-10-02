// Task 102: switch model in one tap inside Create + Veo (Gemini API) never gets generateAudio.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const js = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/squad-create.js'), 'utf8');

test('model chips are an always-visible one-tap strip; picking one keeps the sheet open', () => {
  assert.match(js, /host\.className = 'sv-row sv-mstrip';/);
  assert.match(js, /paintPill\(\); \/\/ instant: price \+ header update in place/);
  assert.doesNotMatch(js, /openChips = false; host\.style\.display = 'none';/);
  assert.match(js, /All models \\u203a/);
});
test('Veo via the Gemini API: generateAudio is dropped, the rest is kept', () => {
  const { _internals } = require('../server/routes/squad-video.js');
  assert.deepStrictEqual(
    _internals.veoParams({ aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true }),
    { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p' });
});
