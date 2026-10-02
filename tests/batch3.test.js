// Batch 3: Chats pin message, Shop top creators, Home data saver, Create style presets.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Chats: pin a message, pinned bar jumps to it', () => {
  const h = read('frontend/public/chats/app.html');
  assert.match(h, /data-a="pinm"/);
  assert.match(h, /function pinBar\(\)/);
});
test('Home: Data saver stops prefetching off-screen reels', () => {
  const h = read('frontend/public/reels/index.html');
  assert.match(h, /function prefetchAhead\(fromIndex\)\{\n {8}if\(sgDataSaver\(\)\) return;/);
  assert.match(h, /sgDataSaver\(\) \? 'Data saver: On' : 'Data saver: Off'/);
});
test('Create: Style presets add one style line to the prompt', () => {
  const js = read('frontend/public/squad-create.js');
  assert.match(js, /\\uD83C\\uDFA8 Style/);
  assert.match(js, /' \| style: '/);
});
