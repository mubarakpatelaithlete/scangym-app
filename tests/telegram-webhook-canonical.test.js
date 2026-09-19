/**
 * The Telegram bot went silent in production while /api/chatbot/health still
 * reported `telegram: true`. Cause: the webhook was registered on the apex host
 * (https://scangym.com/...), which 301-redirects to www. Telegram does not
 * follow redirects, so every update came back as
 * "Wrong response from the webhook: 301 Moved Permanently" and was dropped.
 *
 * These tests pin the three things that let that happen:
 *   1. the webhook URL we register is always the canonical www host,
 *   2. /telegram/setup — which repoints the bot — is not open to the world,
 *   3. the profile rail reads the deep probe, so a dot cannot claim live on a
 *      bot that is dropping every message.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the apex host is rewritten to www, because Telegram will not follow the redirect', () => {
  const { canonicalBase } = require('../server/chatbot/canonical-host.js');

  assert.strictEqual(typeof canonicalBase, 'function', 'canonicalBase must be exported');
  assert.strictEqual(canonicalBase('https://scangym.com'), 'https://www.scangym.com');
  assert.strictEqual(canonicalBase('http://scangym.com/'), 'https://www.scangym.com');
  assert.strictEqual(canonicalBase('https://www.scangym.com'), 'https://www.scangym.com');
  // Staging and preview hosts must survive untouched.
  assert.strictEqual(canonicalBase('https://scangym-staging.up.railway.app'), 'https://scangym-staging.up.railway.app');
});

test('the default BASE_URL cannot be the redirecting apex host', () => {
  const src = read('server/chatbot/telegram.js');
  const defaultLine = src.match(/const BASE_URL = .*/)[0];
  assert.ok(
    !/\|\|\s*'https:\/\/scangym\.com'/.test(defaultLine),
    'defaulting BASE_URL to the apex host silently breaks inbound Telegram'
  );
  assert.match(defaultLine, /www\.scangym\.com/);
});

test('the webhook is verified on boot, so a stale registration self-heals', () => {
  const src = read('server/chatbot/telegram.js');
  assert.match(src, /async function ensureWebhook\(\)/, 'ensureWebhook must exist');
  assert.match(src, /module\.exports\.ensureWebhook = ensureWebhook;/, 'ensureWebhook must be exported');
  assert.match(src, /getWebhookInfo/, 'it must read the registered URL before changing it');
  assert.match(read('server/chatbot/index.js'), /ensureWebhook\(\)/, 'ensureWebhook must be called on boot');
});

test('POST /telegram/setup is guarded — an open one hands the bot to anybody', () => {
  const src = read('server/chatbot/telegram.js');
  assert.match(src, /router\.post\('\/setup',\s*requireChatbotAdmin/, '/setup must run through the admin guard');
  assert.match(src, /CHATBOT_ADMIN_KEY/, 'the guard needs a configured key');
  assert.match(src, /res\.status\(503\)/, 'with no key configured, refuse rather than allow');
});

test('the profile rail trusts the deep probe, not just the presence of a token', () => {
  const src = read('frontend/public/profile-rail.js');
  assert.match(src, /health\?deep=1/, 'the rail must ask for deep probes');
  assert.match(src, /probes\[key\]\.live === false/, 'a dead channel must demote the dot');
});

test('deep probes are cached, so one page load does not fan out to ten providers', () => {
  const src = read('server/chatbot/index.js');
  assert.match(src, /PROBE_TTL_MS/);
  assert.match(src, /cachedProbes\(\)/);
});
