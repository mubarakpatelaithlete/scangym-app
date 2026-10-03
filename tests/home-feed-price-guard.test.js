// Home feed must not die when deferred pricing.js has not run yet.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
test('reels page has a local sgPrice guard', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/reels/index.html'), 'utf8');
  assert.match(html, /var sgPrice = function \(t\) \{\s*if \(typeof window\.sgPrice === 'function' && window\.sgPrice !== sgPrice\)/);
});
