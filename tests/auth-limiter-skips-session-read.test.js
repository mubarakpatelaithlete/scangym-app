// Regression: the /api/auth rate limiter (10 requests / 15 min per IP) used to count
// GET /api/auth/user — the session check every page load makes. A logged-in user who
// opened the app a few times was shown "Log in to view your profile" for 15 minutes
// even though their cookie was valid. The limiter is for OTP attempts (POSTs) only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('the auth limiter is still mounted on /api/auth', () => {
  assert.ok(/app\.use\('\/api\/auth',\s*authLimiter\)/.test(src));
});

test('the auth limiter skips read-only requests (GET /api/auth/user)', () => {
  const m = src.match(/const authLimiter\s*=\s*rateLimit\(\{([\s\S]*?)\}\);/);
  assert.ok(m, 'authLimiter definition not found');
  const body = m[1];
  assert.ok(/skip:\s*\(req\)\s*=>[^,\n]*req\.method === 'GET'/.test(body), 'authLimiter must skip GET requests');
});
