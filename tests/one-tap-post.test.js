// Task 110: one tap Post = your ScanGym profile + every linked social, no confirm, no extra page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('client posts straight away with toScanGym, no confirm dialog', () => {
  const js = read('frontend/public/squad-create.js');
  const post = js.slice(js.indexOf("chip('🚀 Post'"), js.indexOf("chip('✏️ Edit'"));
  assert.match(post, /toScanGym: true/);
  assert.doesNotMatch(post, /window\.confirm/);
});
test('server publishes only the caller\'s own finished video to Home', async () => {
  const src = read('server/routes/post-everywhere.js');
  assert.match(src, /INSERT INTO video_catalog \(name, category, source, url, cdn_key, orientation, dopamine_tier, active\)/);
  assert.match(src, /WHERE user_id = \$1 AND video_url = \$2 AND status = 'done'/);
  const { _internals } = require('../server/routes/post-everywhere.js');
  assert.strictEqual(_internals.displayName({ first_name: 'Rahul', last_name: 'Jekar' }), 'Rahul J.');
  assert.deepStrictEqual(await _internals.postToScanGym({ id: 1 }, { mediaType: 'image', mediaUrl: 'https://x/y.png' }),
    { status: 'skipped', note: 'Home shows videos only' });
});

// Task 113: Tango-style see-through half sheets (no blur, for speed).
test('half sheets are see-through with a light scrim', () => {
  const hs = read('frontend/public/sg-half-sheet.js');
  assert.match(hs, /-scrim\{position:fixed;inset:0;background:rgba\(0,0,0,\.12\);/);
  assert.match(hs, /background:linear-gradient\(to top,rgba\(8,10,18,\.94\)/);
  assert.doesNotMatch(hs, /backdrop-filter/);
});
