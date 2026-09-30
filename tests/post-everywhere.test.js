const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');

test('post-everywhere router and page are mounted', () => {
  assert.match(server, /app\.use\('\/api\/post-everywhere', postEverywhereRouter\)/);
  assert.match(server, /'\/post-everywhere'/);
  assert.ok(fs.existsSync(path.join(root, 'frontend', 'public', 'post-everywhere', 'index.html')));
});

test('supports the main social networks', () => {
  const { APPS } = require('../server/routes/post-everywhere');
  for (const slug of ['twitter', 'facebook_pages', 'instagram_business', 'pinterest', 'youtube_data_api', 'linkedin']) {
    assert.ok(APPS[slug], slug);
  }
});

test('no Pipedream secrets in the source', () => {
  const src = fs.readFileSync(path.join(root, 'server', 'routes', 'post-everywhere.js'), 'utf8');
  assert.doesNotMatch(src, /proj_[A-Za-z0-9]{6,}/);
  assert.match(src, /process\.env\.PIPEDREAM_CLIENT_SECRET/);
});

test('Composio is the main provider; X stays on Pipedream', () => {
  const { APPS } = require('../server/routes/post-everywhere');
  for (const slug of ['facebook_pages', 'instagram_business', 'pinterest', 'youtube_data_api', 'linkedin']) assert.ok(APPS[slug].toolkit, slug);
  assert.ok(!APPS.twitter.toolkit);
  const src = fs.readFileSync(path.join(root, 'server', 'routes', 'post-everywhere.js'), 'utf8');
  assert.match(src, /process\.env\.COMPOSIO_API_KEY/);
});

test('Create results have Post, Edit, Recreate, More versions and Extend (Task 20)', () => {
  const src = fs.readFileSync(path.join(root, 'frontend', 'public', 'squad-create.js'), 'utf8');
  for (const s of ['🚀 Post', '✏️ Edit', '🔁 Recreate', '➕ More versions', '⏩ Extend', "model: 'ltx-extend'"]) assert.ok(src.includes(s), s);
});
