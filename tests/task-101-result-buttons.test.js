// Task 101 (owner, 2026-10-02): every Create result offers Edit, Extend, More
// versions, Different model, Post, Reference, Tag and Sell — under the result,
// where a phone can see them without scrolling.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the result row has all eight actions', () => {
  const s = read('frontend/public/squad-create.js');
  for (const label of ['🚀 Post', '✏️ Edit', '➕ More versions', '⏩ Extend', '🔀 Different model', '📎 Reference', '🏷️ Tag', '💰 Sell']) {
    assert.ok(s.includes("chip('" + label), 'missing ' + label);
  }
});

test('the actions come before Share/Download, in one scrollable line', () => {
  const s = read('frontend/public/squad-create.js');
  assert.match(s, /out\.appendChild\(nextRow\(url, mode, jobId\)\);\s*out\.appendChild\(row\);/);
  assert.match(s, /\.sv-next\{flex-wrap:nowrap;overflow-x:auto/);
});

test('a reference goes to the server, which uses the Nano Banana /edit endpoint', () => {
  assert.match(read('frontend/public/squad-create.js'), /body\.referenceUrl = state\.image\.__ref/);
  const { _internals: I } = require('../server/routes/squad-image.js');
  const input = I.buildInput({ inputProfile: 'nano-banana-2' }, 'p', { count: 1, aspectRatio: '9:16' }, 'https://cdn.scangym.com/a.jpg');
  assert.deepStrictEqual(input.image_urls, ['https://cdn.scangym.com/a.jpg']);
  assert.strictEqual(I.buildInput({}, 'p', { count: 1 }).image_urls, undefined);
  assert.strictEqual(I.cleanReferenceUrl('http://x/a.jpg'), null);
  assert.strictEqual(I.cleanReferenceUrl('javascript:alert(1)'), null);
  assert.strictEqual(I.referenceModel({ id: 'nano-banana-2', providerModel: 'fal-ai/nano-banana-2' }).providerModel, 'fal-ai/nano-banana-2/edit');
  assert.strictEqual(I.referenceModel({ id: 'seedream-v4', providerModel: 'x/y/z' }).providerModel, 'fal-ai/nano-banana/edit');
});

test('Sell lists the creation itself, only if it is the seller’s own finished job', () => {
  const shop = read('server/routes/shop.js');
  assert.match(shop, /fileFromCreation\(req\.user\.id/);
  assert.match(shop, /WHERE user_id = \$1 AND video_url = \$2 AND status = 'done'/);
  const app = read('frontend/public/app.ctr576.js');
  assert.match(app, /form\.append\('sourceUrl',src\)/);
});
