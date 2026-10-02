// Task 66 (C): no orange Sign in bar for logged-out; sign-in half sheet opens on Like/Post/Buy/Create.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Profile: logged-out visitors get no orange bar', () => {
  assert.match(read('frontend/public/sg-rail-ui.js'), /if\(!u\)\{window\.sgBottomBar\.hide\('profile'\);return;\}/);
});
test('sg-signin-ask.js wraps the auth sheet and Shop buy, and retitles per action', () => {
  global.window = { _sgShowAuthSheet: function () {}, _sgShopBuy: function () {} };
  global.location = { href: '' };
  require('../frontend/public/sg-signin-ask.js');
  assert.ok(global.window._sgShowAuthSheet.__sgAsk);
  assert.ok(global.window._sgShopBuy.__sgAsk);
  assert.strictEqual(global.window._sgSignInAsk.titleFor('like'), 'Sign in to like this video');
  assert.strictEqual(global.window._sgSignInAsk.titleFor('buy'), 'Sign in to buy');
  assert.strictEqual(typeof global.window.sgAskSignIn, 'function');
  assert.match(read('frontend/public/index.html'), /sg-signin-ask\.js\?v=/);
});
test('Create: Post and Generate open the sign-in sheet when logged out', () => {
  const s = read('frontend/public/squad-create.js');
  assert.match(s, /sgAskSignIn\('post'\)/);
  assert.match(s, /sgAskSignIn\('create'\)/);
});
