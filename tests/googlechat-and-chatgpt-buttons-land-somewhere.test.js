/**
 * Two profile-tab buttons went nowhere: Google Chat called
 * /api/channels/googlechat/install (404 — the route did not exist), and there
 * was no ChatGPT button at all even though the MCP connector flow already
 * worked for Claude. Both now land on a guided page, and the MCP link points at
 * the canonical www host (the apex 301s).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const rail = read('frontend/public/profile-rail.js');
const server = read('server/server.js');
const channels = read('server/routes/channels.js');

test('the rail offers Google Chat and ChatGPT', () => {
  assert.match(rail, /\['googlechat', 'Google Chat'\]/);
  assert.match(rail, /\['chatgpt', 'ChatGPT'\]/);
});

test('both buttons have an icon and an action', () => {
  for (const key of ['googlechat', 'chatgpt']) {
    assert.ok(new RegExp(`\\n    ${key}: '<svg`).test(rail), `${key} icon missing`);
    assert.ok(new RegExp(`    ${key}: function \\(\\)`).test(rail), `${key} action missing`);
  }
});

test('the pages they open are actually served', () => {
  assert.match(server, /app\.get\('\/chatgpt'/);
  assert.match(server, /app\.get\('\/googlechat'/);
  for (const p of ['frontend/public/chatgpt/index.html', 'frontend/public/googlechat/index.html']) {
    assert.ok(fs.existsSync(path.join(root, p)), `${p} missing`);
  }
});

test('the Google Chat install route exists and reports whether it is live', () => {
  assert.match(channels, /router\.get\('\/googlechat\/install'/);
  assert.match(channels, /configured/);
});

test('MCP connector links use the canonical www host', () => {
  for (const p of ['frontend/public/claude/index.html', 'frontend/public/chatgpt/index.html']) {
    const html = read(p);
    assert.ok(!/https:\/\/scangym\.com\/mcp/.test(html), `${p} still uses the redirecting apex host`);
    assert.match(html, /https:\/\/www\.scangym\.com\/mcp/);
  }
});

test('the Google Chat page offers Telegram as a fallback', () => {
  assert.match(read('frontend/public/googlechat/index.html'), /t\.me\/ScanGymBot/);
});
