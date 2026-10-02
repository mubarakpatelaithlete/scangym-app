// Tasks 108/119, 109, 112/120 batch 2.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Shop: filter chips, Top rated sort and seller store', () => {
  const app = read('frontend/public/app.ctr576.js');
  assert.match(app, /fchip\('under5','Under \\u00a35'\)/);
  assert.match(app, /opt\('rated','Top rated'\)/);
  assert.match(app, /window\._sgShopStore=async function\(handle\)/);
  assert.match(app, /Visit store/);
});
test('Home: Filter keywords hides matching reels; Refresh For You resets', () => {
  const html = read('frontend/public/reels/index.html');
  assert.match(html, /var _kw = sgMutedWords\(\);/);
  assert.match(html, /sgSheetOption\('\\uD83D\\uDEAB', 'Filter keywords'\)/);
  assert.match(html, /o\[11\]\.addEventListener\('click', function\(\)\{ sh\.close\(\); refreshForYou\(\); \}\)/);
});
test('Create: Recent prompts, saved on every Generate', () => {
  const js = read('frontend/public/squad-create.js');
  assert.match(js, /\\uD83D\\uDD58 Recent/);
  assert.match(js, /rememberPrompt\(mode\.key, prompt\);/);
});
