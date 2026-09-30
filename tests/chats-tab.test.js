const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Chats tab sits between Shop and Profile in the SPA bar', () => {
  const app = read('frontend/public/app.ctr576.js');
  const shop = app.indexOf('aria-label="Shop" onclick="switchTab(\'shop\')"');
  const chats = app.indexOf('aria-label="Chats" onclick="switchTab(\'chats\')"');
  const prof = app.indexOf('aria-label="Profile and settings"');
  assert.ok(shop > 0 && chats > shop && prof > chats);
  assert.match(app, /path==='\/chats'\|\|path\.startsWith\('\/chats\/'\)\)return 'chats'/);
  assert.match(app, /src="\/chats\/app\.html/);
});
test('dm API is mounted and every route requires sign-in', () => {
  assert.match(read('server/server.js'), /app\.use\('\/api\/dm', dmRouter\)/);
  assert.match(read('server/routes/dm.js'), /router\.use\(authenticateUser\)/);
});
test('people search never returns email or phone', () => {
  const src = read('server/routes/dm.js');
  const m = src.match(/users: rows\.map\(\(u\) => \(\{([^}]*)\}/);
  assert.ok(m); assert.doesNotMatch(m[1], /email|phone/);
});
test('dm tables live in /migrations', () => {
  const sql = read('migrations/20260930b_dm_chats.sql');
  for (const t of ['dm_threads', 'dm_messages', 'dm_presence']) assert.match(sql, new RegExp('CREATE TABLE IF NOT EXISTS ' + t));
});
test('chat page has the WhatsApp basics: ticks, typing, last seen, delete, calls & tools tabs', () => {
  const html = read('frontend/public/chats/app.html');
  for (const s of ['✓✓', 'typing…', 'last seen', 'Delete for everyone', 'data-sec="calls"', 'data-sec="tools"', 'data-tab="fav"', 'attachSheet', '/upload']) assert.ok(html.includes(s), s);
});

test('Task 11: Chats/Calls/Tools sit in the bottom band and calls are real WebRTC', () => {
  const fs2 = require('node:fs'), p2 = require('node:path');
  const html = fs2.readFileSync(p2.join(__dirname, '..', 'frontend', 'public', 'chats', 'app.html'), 'utf8');
  assert.ok(/<nav class="seg"/.test(html), 'sections are a bottom nav');
  for (const s of ['RTCPeerConnection', 'callStart', '/calls/log', '/calls/incoming', 'watchIncoming']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('coming next'), 'no "coming soon" placeholder left');
  const calls = require('../server/routes/dm-calls.js');
  assert.equal(typeof calls.mount, 'function');
  const srv = fs2.readFileSync(p2.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.ok(srv.includes('camera=(self)'), 'camera allowed for video calls and photos');
});

test('Task 26: Profile row has a Wallet door and the wallet page can withdraw', () => {
  const fs2 = require('node:fs'), p2 = require('node:path');
  const rails = fs2.readFileSync(p2.join(__dirname, '..', 'frontend', 'public', 'rails.js'), 'utf8');
  assert.ok(rails.includes("key: 'wallet'") && rails.includes("navigate('/wallet')"));
  const app = fs2.readFileSync(p2.join(__dirname, '..', 'frontend', 'public', 'app.ctr576.js'), 'utf8');
  assert.ok(app.includes("_sgWalletGo('_sgWalletWithdraw')"));
});
