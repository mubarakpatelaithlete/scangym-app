/**
 * Three faults found by using the app as a logged-in customer (+44 7796 490796):
 *
 *   1. The Profile tab showed the channel rail TWICE — the app bundle's own rail
 *      already carries Telegram/Discord/Slack/…, and profile-rail.js appended the
 *      whole list into it again.
 *   2. The Discord button opened an "add bot to your server" OAuth screen. A gym
 *      customer does not administer a Discord server, so it dead-ended.
 *   3. A Bolton search replied "Found 20 gyms in 116 Bark St" — the first
 *      result's street stood in for the city.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the city label is what the results agree on, never a street', () => {
  // Reproduces the live reply: Google filled the first result's city with a street.
  const bolton = [
    { city: '116 Bark St' },
    { city: 'Bolton' },
    { city: 'Bolton' },
    { city: 'Farnworth' },
  ];
  const src = read('server/chatbot/message-handler.js');
  const body = src.slice(src.indexOf('function pickCityLabel'));
  const pickCityLabel = new Function(`${body.slice(0, body.indexOf('\n}\n') + 3)}; return pickCityLabel;`)();

  assert.strictEqual(pickCityLabel(bolton), 'Bolton');
  assert.strictEqual(pickCityLabel([{ city: '116 Bark St' }]), '', 'a street alone is no label at all');
  assert.strictEqual(pickCityLabel([]), '');
  assert.strictEqual(pickCityLabel([{ city: 'Manchester' }]), 'Manchester');
});

test('formatGymList uses the agreed label, not gyms[0].city', () => {
  const src = read('server/chatbot/message-handler.js');
  assert.match(src, /const cityName = pickCityLabel\(gyms\)/);
  assert.ok(!/const cityName = gyms\[0\]\?\.city/.test(src), 'the first result must not name the city on its own');
});

test('Discord sends a customer somewhere they can actually chat', () => {
  const src = read('server/routes/channels.js');
  assert.match(src, /integration_type=1/, 'user-install is the customer route — it lets them DM the bot');
  assert.match(src, /preferredUrl/, 'the server, not each client, decides what a customer sees first');
  assert.match(src, /DISCORD_COMMUNITY_INVITE/, 'a real community invite should win when we have one');
  // A QR pass cannot be delivered with send-messages alone.
  assert.match(src, /2048 \+ 16384 \+ 32768/);
  assert.ok(!/permissions=2048&scope=bot'/.test(src), 'the old send-only server invite must be gone');
});

test('the Discord button follows preferredUrl', () => {
  const src = read('frontend/public/app.ctr576.js');
  const fn = src.slice(src.indexOf('window._sgOpenDiscord'), src.indexOf('window._sgOpenSlack'));
  assert.match(fn, /d\.preferredUrl/);
});

test('the rail does not repeat buttons the host rail already shows', () => {
  const src = read('frontend/public/profile-rail.js');
  assert.match(src, /function labelsIn\(host\)/, 'it must read what the host already renders');
  assert.match(src, /buttonList\(labelsIn\(host\)\)/, 'and skip those when extending');
  assert.match(src, /if \(!wanted\.length\) continue;/, 'an emptied group must not leave its header behind');
});

test('Telegram carries the member id, so the bot knows who opened it', () => {
  const src = read('frontend/public/profile-rail.js');
  assert.match(src, /function telegramUrl\(\)/);
  assert.match(src, /\?start=/);
  assert.match(src, /_sgConnectChannel\('telegram', url\)/);
});
