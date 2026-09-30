const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'server/routes/public-api.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');

test('public API is mounted at /api/v1 and key management at /api/developer', () => {
  assert.match(server, /app\.use\('\/api\/v1', v1Router\)/);
  assert.match(server, /app\.use\('\/api\/developer', developerRouter\)/);
  assert.match(server, /\/developers/);
});
test('only a hash of the key is stored', () => {
  assert.match(fs.readFileSync(path.join(root, 'migrations/20260930_api_keys.sql'), 'utf8'), /key_hash\s+TEXT NOT NULL UNIQUE/);
  assert.match(src, /\[userId, name, hashKey\(key\), key\.slice\(0, 14\)\]/);
});
test('v1 is read-only, rate limited and CORS-enabled', () => {
  assert.doesNotMatch(src, /v1Router\.(post|put|patch|delete)\(/);
  assert.match(src, /RATE_PER_MIN = 60/);
  assert.match(src, /Access-Control-Allow-Origin/);
});
test('docs page exists and uses the signed-in session cookie', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/public/developers/index.html'), 'utf8');
  assert.match(html, /credentials:'same-origin'/);
  assert.match(html, /\/api\/developer\/keys/);
});
