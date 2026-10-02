const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Chats tab sits between Shop and Profile in the SPA bar', () => {
  const app = (read('frontend/public/app.ctr576.js') + read('frontend/public/sg-shop.js'));
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
  assert.ok(/<nav class="seg"/.test(html), 'sections nav exists');
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

test('Tasks 28/29: ChatGPT and Grok guides use the signed-in connector (create + library)', () => {
  const fs = require('node:fs'); const path = require('node:path');
  for (const p of ['chatgpt', 'grok']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', p, 'index.html'), 'utf8');
    assert.match(html, /MCP_URL = 'https:\/\/www\.scangym\.com\/mcp\/account'/, p);
  }
  const rail = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'profile-rail.js'), 'utf8');
  assert.match(rail, /window\.open\('\/chatgpt', '_blank'\)/);
});

test('Task 66: Chats looks like WhatsApp: top section tabs, flat icons, useful signed-out view', () => {
  const html = read('frontend/public/chats/app.html');
  const top = html.indexOf('<div class="top">'), nav = html.indexOf('<nav class="seg"'), list = html.indexOf('<div id="list"');
  assert.ok(top > 0 && nav > top && nav < list, 'sections sit in the header, not a 2nd bottom bar');
  const markup = html.slice(html.indexOf('<body>'), html.indexOf('<script>', html.indexOf('<body>')));
  for (const e of ['📷', '🔍', '🧰', '📞']) assert.ok(!markup.slice(0, markup.indexOf('<!-- CHAT VIEW')).includes(e), 'no emoji icon ' + e);
  for (const s of ['ScanGym Assistant', 'wa.me/12052094512', 't.me/ScanGymBot', 'Sign in to chat']) assert.ok(html.includes(s), s);
});

test('Task 66 WhatsApp pass: voice notes, reply, forward, pin/mute/archive, unread divider, viewer, retry', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'public', 'chats', 'app.html'), 'utf8');
  for (const s of ['MediaRecorder', 'voice-note.', 'startReply', 'forwardSheet', 'Pin chat', 'Mute notifications', 'Archive chat', 'unread message', "v.id='viewer'", 'Tap to retry', 'Contact info', 'id="toBot"', 'function fmt']) assert.ok(html.includes(s), s);
});

test('Task 66 round 2: search in chat, star, delete for me, drafts, / quick replies, labels, mark unread, swipe reply, big emoji, voice speed', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'public', 'chats', 'app.html'), 'utf8');
  for (const s of ['chatSearch', 'Starred messages', 'Delete for me', 'LOC.draft', 'function qpop', 'labelSheet', 'Mark as unread', 'Swipe a message right', 'b.big', 'vspd']) assert.ok(html.includes(s), s);
});

// Task 107/118 step 1: reactions + edit message (WhatsApp, Telegram, Discord).
test('Chats: server has react + edit routes and syncs recent messages', () => {
  const dm = read('server/routes/dm.js');
  assert.match(dm, /router\.post\('\/messages\/:id\/react'/);
  assert.match(dm, /router\.patch\('\/messages\/:id'/);
  assert.match(dm, /recent: recent\.map/);
  assert.ok(fs.existsSync(path.join(root, 'migrations/20261002_dm_react_edit.sql')));
});
test('Chats: long-press menu has emoji bar + Edit; bubbles show reactions + edited', () => {
  const html = read('frontend/public/chats/app.html');
  assert.match(html, /var RX=\['👍','❤️','😂','😮','😢','🙏'\]/);
  assert.match(html, /data-a="edit">✏️ Edit/);
  assert.match(html, /rxHtml\(m\)/);
  assert.match(html, /class="edt">edited/);
});

// Task 107 batch 2: greeting + away messages, wallpaper, export chat.
test('Chats: greeting/away auto-replies are stored and sent by the server', () => {
  const dm = read('server/routes/dm.js');
  assert.match(dm, /router\.put\('\/business'/);
  assert.match(dm, /autoReply\(t\.id, t\.user_a === uid \? t\.user_b : t\.user_a\)/);
  assert.match(read('migrations/20261002c_dm_business.sql'), /CREATE TABLE IF NOT EXISTS dm_business/);
});
test('Chats: contact info has Wallpaper + Export chat; menu has Greeting & away', () => {
  const html = read('frontend/public/chats/app.html');
  assert.match(html, /data-i="wall"/);
  assert.match(html, /data-i="export"/);
  assert.match(html, /data-a="biz">💼 Greeting & away messages/);
  assert.match(html, /S\.open=id;[^\n]*applyWall\(\);/);
});
