/**
 * The Telegram button is the only channel customers can fully use, so its
 * commands have to be discoverable and account linking has to survive the
 * apex→www redirect. Both were broken:
 *   - nothing called setMyCommands, so Telegram's Menu button listed nothing;
 *   - /start <token> POSTed to the apex host, which 301s, so linking died.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'chatbot', 'telegram.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'server', 'chatbot', 'index.js'), 'utf8');

test('the command menu is published to Telegram', () => {
  assert.match(src, /setMyCommands/);
  assert.match(src, /module\.exports\.ensureCommands = ensureCommands/);
});

test('boot publishes the command menu', () => {
  assert.match(index, /telegramRouter\.ensureCommands\(\)/);
});

test('every published command is handled by the parser', () => {
  const menu = src.match(/const BOT_COMMANDS = \[([\s\S]*?)\];/);
  assert.ok(menu, 'BOT_COMMANDS list not found');
  const commands = [...menu[1].matchAll(/command: '([a-z]+)'/g)].map(m => m[1]);
  assert.ok(commands.length >= 5, 'menu should not be empty');
  for (const c of commands) {
    assert.ok(new RegExp(`case '/${c}'`).test(src), `/${c} is advertised but not handled`);
  }
});

test('account linking does not POST to the redirecting apex host', () => {
  assert.ok(!/https:\/\/scangym\.com' \) \+ '\/api\/channels\/telegram\/verify/.test(src));
  assert.ok(!src.includes("(process.env.BASE_URL || 'https://scangym.com')"),
    'verify must use the canonical BASE_URL');
  assert.match(src, /\$\{BASE_URL\}\/api\/channels\/telegram\/verify/);
});
