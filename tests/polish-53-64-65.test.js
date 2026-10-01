// Tasks 53/64/65 "10/10" pass (owner, 2026-10-01).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pub = (f) => path.join(__dirname, '..', 'frontend', 'public', f);
const read = (f) => fs.readFileSync(pub(f), 'utf8');

test('Task 53: every Create model has its own GIF', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'gen-models.js'), 'utf8');
  const ids = [...src.matchAll(/\bid:\s*'([a-z0-9._-]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 30);
  for (const id of ids) assert.ok(fs.existsSync(pub('img/model-gif/' + id + '.gif')), 'missing GIF for ' + id);
  assert.match(read('create-studio.js'), /\/img\/model-gif\//);
});

test('Task 64: TikTok caption block (@handle, caption, sound line)', () => {
  const html = read('reels/index.html');
  assert.match(html, /function tikTokCaption/);
  assert.match(html, /reel-handle/);
  assert.match(html, /Original sound/);
});

test('Task 65: every starter product has a cover', () => {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'shop-starter', 'products.json'), 'utf8'));
  for (const p of list) assert.ok(fs.existsSync(pub('img/shop/' + p.slug + '.webp')), 'missing cover ' + p.slug);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'shop-starter.js'), 'utf8'), /cover_image_url/);
});
