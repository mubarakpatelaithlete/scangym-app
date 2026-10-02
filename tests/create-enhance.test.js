// Task 120 step 1: ✨ Enhance prompt + 🎲 Surprise me in Create (Higgsfield / CapCut / ElevenLabs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('server: rate-limited enhance endpoint returns a cleaned prompt', () => {
  const src = read('server/routes/squad-image.js');
  assert.match(src, /router\.post\('\/enhance', express\.json\(\{ limit: '8kb' \}\), enhanceLimiter/);
  const { _internals } = require('../server/routes/squad-image.js');
  assert.strictEqual(_internals.cleanEnhanced('Prompt: "a cat in neon rain" '), 'a cat in neon rain');
  assert.strictEqual(_internals.cleanEnhanced(''), '');
});
test('client: Enhance, Undo and Surprise me sit under the prompt box', () => {
  const js = read('frontend/public/squad-create.js');
  assert.match(js, /\\u2728 Enhance prompt/);
  assert.match(js, /\/api\/squad-image\/enhance/);
  assert.match(js, /\\uD83C\\uDFB2 Surprise me/);
  assert.match(read('frontend/public/index.html'), /squad-create\.js\?v=\d+\.\d+/);
});
