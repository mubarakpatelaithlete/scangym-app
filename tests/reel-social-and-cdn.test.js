// Tasks 52, 54 and 57 (owner, 2026-09-30).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Task 52: Home reels show Like, Comment, Save, Share, Repost in TikTok order', () => {
  const reels = read('frontend/public/reels/index.html');
  for (const a of ['like', 'comment', 'repost']) {
    assert.match(reels, new RegExp(`data-action="${a}"`), `${a} button missing`);
    assert.match(reels, new RegExp(`action === '${a}'`), `${a} has no handler`);
  }
  const catalogRow = reels.slice(reels.indexOf("/* Task 52: TikTok order"), reels.indexOf('Earn action removed'));
  const order = ['_sb.lead', 'data-action="save"', 'data-action="share"', '_sb.tail', 'SHOP_ACTION'].map((s) => catalogRow.indexOf(s));
  assert.ok(order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])), 'order is Like/Comment, Save, Share, Repost, Shop');
  assert.match(read('server/server.js'), /app\.use\('\/api\/reels\/social', reelSocialRouter\)/);
  assert.match(read('migrations/20260930c_reel_social.sql'), /CREATE TABLE IF NOT EXISTS reel_comments/);
  assert.match(read('server/routes/reel-social.js'), /router\.post\('\/:id\/like', authenticateUser/, 'writes need a signed-in customer');
});

test('Task 54: Book and Partner sit last in the Profile row', () => {
  const css = read('frontend/public/rails.css');
  assert.match(css, /\[data-sg-row-act="book"\][^{]*\{ order: 90 !important; \}/);
  assert.match(css, /button\[aria-label="Partner"\] \{ order: 91 !important; \}/);
});

test('Task 57: a finished fal file is re-hosted on cdn.scangym.com, and never lost', async () => {
  const { rehostToCdn } = require('../server/lib/gen-provider')._internals;
  const falUrl = 'https://v3b.fal.media/files/b/abc_DEF.png';
  const okFetch = async () => ({ ok: true, headers: new Map([['content-type', 'image/png'], ['content-length', '3']]), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  const uploads = [];
  const r2 = { r2Configured: () => true, uploadBufferToR2: async (buf, key) => { uploads.push(key); return { url: `https://cdn.scangym.com/${key}` }; } };
  assert.equal(await rehostToCdn(falUrl, 'image', 'req-1', { r2, fetch: okFetch }), 'https://cdn.scangym.com/gen/image/req-1.png');
  assert.deepEqual(uploads, ['gen/image/req-1.png']);
  // No R2, a failing download or a failing upload: fal's url comes back unchanged.
  assert.equal(await rehostToCdn(falUrl, 'image', 'x', { r2: { ...r2, r2Configured: () => false }, fetch: okFetch }), falUrl);
  assert.equal(await rehostToCdn(falUrl, 'image', 'x', { r2, fetch: async () => { throw new Error('net'); } }), falUrl);
  assert.equal(await rehostToCdn(falUrl, 'image', 'x', { r2: { ...r2, uploadBufferToR2: async () => { throw new Error('r2'); } }, fetch: okFetch }), falUrl);
  // Not fal: left alone.
  assert.equal(await rehostToCdn('https://cdn.scangym.com/a.png', 'image', 'x', { r2, fetch: okFetch }), 'https://cdn.scangym.com/a.png');
});
