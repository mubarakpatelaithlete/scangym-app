/**
 * The shortest journey on Telegram was still four steps: tap Menu, read six
 * slash commands, pick one, then type a city. Telegram's menu button can open a
 * Web App instead, so /nearby (which already asks for GPS) is one tap away.
 *
 * Checked live on 2026-09-20 with @ScanGymBot: webhook healthy, commands
 * published, but getChatMenuButton returned {type: 'commands'} and
 * getMyShortDescription returned an empty string. Both are now set on boot, for
 * the same reason ensureWebhook is: configuration that lives only in Telegram's
 * console drifts silently and nothing in a deploy notices.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the menu button opens /nearby as a Web App, not a command list', () => {
  const src = read('server/chatbot/telegram.js');
  const body = src.slice(src.indexOf('async function ensureMenuButton'));
  const fn = body.slice(0, body.indexOf('\n}\n') + 3);

  assert.match(fn, /setChatMenuButton/, 'it must call setChatMenuButton');
  assert.match(fn, /type: 'web_app'/, 'a commands-type button is the slow path we are replacing');
  assert.match(fn, /\$\{BASE_URL\}\/nearby/, 'the Web App URL must follow BASE_URL, not a hardcoded host');
  assert.match(fn, /text: 'Find gyms near me'/);
});

test('the bot profile text is published, so the bot never reads as abandoned', () => {
  const src = read('server/chatbot/telegram.js');
  assert.match(src, /setMyShortDescription/);
  assert.match(src, /setMyDescription/);
  assert.match(src, /const BOT_SHORT_DESCRIPTION\s*=/);
  assert.ok(
    /No membership/.test(src),
    'the one-line pitch is the whole product: no membership, pay per visit'
  );
});

test('both run on boot, next to ensureWebhook', () => {
  const index = read('server/chatbot/index.js');
  assert.match(index, /telegramRouter\.ensureMenuButton\(\)/);
  assert.match(index, /telegramRouter\.ensureProfileText\(\)/);

  const telegram = read('server/chatbot/telegram.js');
  assert.match(telegram, /module\.exports\.ensureMenuButton = ensureMenuButton;/);
  assert.match(telegram, /module\.exports\.ensureProfileText = ensureProfileText;/);
});

test('no token means no calls, so local runs stay quiet', () => {
  const src = read('server/chatbot/telegram.js');
  for (const name of ['ensureMenuButton', 'ensureProfileText']) {
    const body = src.slice(src.indexOf(`async function ${name}`));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    assert.match(fn, /if \(!TELEGRAM_TOKEN\) return \{ ok: false, reason: 'no token' \}/, `${name} must guard on the token`);
  }
});
