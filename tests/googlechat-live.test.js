/**
 * Google Chat — the last of the four channels asked for.
 *
 * Two things are worth pinning. First, this channel has no bot token: Google
 * takes our HTTP response body as the bot's reply, so if we ever answer with a
 * bare 200 the customer hears silence. Second, because there is no token, the
 * only thing standing between this public URL and anyone who finds it is the
 * Bearer JWT check — if that ever becomes advisory, the channel is open.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read('server/chatbot/googlechat.js');

test('the adapter is mounted and parses', () => {
  new vm.Script(SRC); // throws on a syntax error
  const index = read('server/chatbot/index.js');
  assert.ok(/require\('\.\/googlechat'\)/.test(index), 'the adapter must be required');
  assert.ok(/router\.use\('\/googlechat'/.test(index), 'it must be mounted at /googlechat');
});

test('health reports Google Chat, and reports it honestly', () => {
  const index = read('server/chatbot/index.js');
  const health = index.slice(index.indexOf('const channels = {'), index.indexOf('const aiProviders'));
  assert.ok(/googlechat:/.test(health), '/api/chatbot/health must list googlechat');
  assert.ok(
    /googlechat:\s*!!\(process\.env\.GOOGLE_CHAT_AUDIENCE/.test(health),
    'it must reflect real configuration, not a hardcoded true'
  );
  assert.ok(!/\|\|\s*true\)/.test(health), 'no channel may be forced true again');
});

test('requests are proved to come from Google before the bot answers', () => {
  assert.ok(/chat@system\.gserviceaccount\.com/.test(SRC), 'the issuer must be checked');
  assert.ok(/String\(info\.aud\) === String\(AUDIENCE\)/.test(SRC), 'the audience must be checked');

  const verify = SRC.slice(SRC.indexOf('async function verifyGoogleRequest'), SRC.indexOf("router.post('/events'"));
  assert.ok(/catch[\s\S]*return false/.test(verify), 'a failed verification must reject, not pass');

  const handler = SRC.slice(SRC.indexOf("router.post('/events'"));
  assert.ok(
    handler.indexOf('verifyGoogleRequest') < handler.indexOf('handleMessage'),
    'verification must happen before the assistant is invoked'
  );
  assert.ok(/status\(401\)/.test(handler), 'an unverified caller gets 401');
});

test('every path the customer can hit answers with something', () => {
  const handler = SRC.slice(SRC.indexOf("router.post('/events'"));
  for (const kind of ['ADDED_TO_SPACE', 'CARD_CLICKED']) {
    assert.ok(new RegExp(kind).test(handler), `${kind} must be handled`);
  }
  assert.ok(/res\.json\(\{ text: 'Sorry/.test(handler), 'an error still gets a spoken reply, not a stack trace');
  assert.ok(/cardsV2/.test(handler), 'gym results are sent as cards');
});

test('no credential is hardcoded in the adapter', () => {
  assert.ok(!/AIza[0-9A-Za-z_-]{20}/.test(SRC), 'no Google API key in source');
  assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY/.test(SRC), 'no private key in source');
});

test('Google Chat is offered on the channels page', () => {
  assert.ok(/id: 'googlechat'/.test(read('server/routes/channels.js')), 'it must appear in the channel list');
});
