'use strict';
/**
 * /join is the standalone "List your gym in 2 minutes" wizard
 * (frontend/public/join/index.html) and is listed in sitemap.xml. Because the
 * static mount runs with index:false and redirect:false, a directory needs its
 * own app.get() or the request falls to the SPA catch-all, whose router has no
 * /join case — so scangym.com/join rendered "Page Not Found".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('the join wizard exists and is in the sitemap', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'frontend', 'public', 'join', 'index.html')));
  const sitemap = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /https:\/\/scangym\.com\/join</);
});

test('/join and /join/ have an explicit handler that serves join/index.html', () => {
  assert.match(server, /app\.get\(\['\/join', '\/join\/'\], \(req, res\) => \{[\s\S]*?sendFile\(path\.join\(FRONTEND_DIR, 'join', 'index\.html'\)\)/);
});

test('the /join handler is registered before the SPA catch-all', () => {
  const join = server.indexOf("app.get(['/join', '/join/']");
  const catchAll = server.search(/app\.get\(['"`]\*['"`]|app\.get\(['"`]\/\*['"`]|app\.use\(\(req, res\) => \{[\s\S]{0,400}index\.html/);
  assert.ok(join > 0);
  assert.ok(catchAll > 0, 'found the SPA catch-all');
  assert.ok(join < catchAll, `/join (${join}) must come before the catch-all (${catchAll})`);
});
