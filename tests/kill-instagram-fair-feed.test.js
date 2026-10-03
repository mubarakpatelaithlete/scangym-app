// Kill-Instagram items 2-5 (owner, 2026-10-03): ad cap, real creators,
// Book this gym, fair reach for new posts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const src = read('server/routes/reels.js');

/* Pull the pure helpers out of reels.js so the test needs no DB. */
function load(name) {
  const start = src.indexOf('function ' + name + '(');
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
}
const AD = "const AD_CATEGORIES = new Set(['promo', 'cmo content', 'ready-to-post', 'price compare', 'city promo']);";
// eslint-disable-next-line no-new-func
const lib = new Function(AD + 'const FAIR_REACH_HOURS = 72; const FAIR_REACH_SLOTS = 5;'
  + load('spaceAds') + load('fairReach') + load('postedBy') + 'return { spaceAds, fairReach, postedBy };')();

test('item 2: ads are capped at 1 per N real clips, never piled at the end', () => {
  const real = Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, category: 'AI Cinematic' }));
  const ads = Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i, category: 'Promo' }));
  const out = lib.spaceAds(real.concat(ads), 6);
  assert.strictEqual(out.filter((v) => v.category === 'Promo').length, 2);
  assert.notStrictEqual(out[0].category, 'Promo');
  for (let i = 1; i < out.length; i++) assert.ok(!(out[i].category === 'Promo' && out[i - 1].category === 'Promo'), 'two ads in a row');
});

test('item 5: new posts get guaranteed early slots, never slot 0', () => {
  const now = Date.now();
  const old = Array.from({ length: 30 }, (_, i) => ({ id: 'o' + i, source: 'cdn' }));
  const fresh = Array.from({ length: 8 }, (_, i) => ({ id: 'f' + i, source: 'creation', createdAt: new Date(now - 3600e3).toISOString() }));
  const stale = { id: 'old-post', source: 'creation', createdAt: new Date(now - 10 * 86400e3).toISOString() };
  const out = lib.fairReach(old.concat([stale], fresh), 3, now);
  assert.strictEqual(out.length, 39);
  assert.notStrictEqual(out[0].source, 'creation');
  assert.strictEqual(out.slice(0, 10).filter((v) => v.source === 'creation').length, 5);
  assert.ok(out.indexOf(stale) > 10, 'old posts get no lift');
  const other = lib.fairReach(old.concat(fresh), 4, now).slice(0, 10).map((v) => v.id).join();
  assert.notStrictEqual(other, out.slice(0, 10).map((v) => v.id).join(), 'slots rotate by seed');
});

test('item 3: creator name comes from the post, same key as Stories/Follow', () => {
  assert.strictEqual(lib.postedBy('Leg day \u00b7 by Rahul J.'), 'Rahul J.');
  assert.strictEqual(lib.postedBy('Promo clip'), '');
  assert.match(src, /decorateOwnPosts\(feed\)/);
  assert.match(src, /avatar: photos\[/);
});

test('item 4: gym tag flows from composer to upload to feed to a Book button', () => {
  assert.match(read('migrations/20261003_video_gym_tag.sql'), /ADD COLUMN IF NOT EXISTS gym_id INTEGER/);
  assert.match(read('server/routes/creators.js'), /publishOwnUpload\(req\.user, file, caption, req\.body\.gym_id\)/);
  assert.match(src, /gym_id, created_at/);
  assert.match(read('frontend/public/sg-home-post.js'), /fd\.append\('gym_id', gymId\)/);
  const html = read('frontend/public/reels/index.html');
  assert.match(html, /sg-book-gym/);
  assert.match(html, /sg-home-post\.js\?v=1\.4/);
});
