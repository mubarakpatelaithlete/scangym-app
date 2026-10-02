/** Tasks 156 B5 / 157 B4 / 158 B5 / 159 @mentions / 160-161 My posts / 165 glass. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const mem = require('../server/chatbot/customer-memory');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', f), 'utf8');

const lib = [
  { kind: 'image', prompt: 'Make the gym brighter with orange neon lights', status: 'done' },
  { kind: 'video', prompt: 'battle ropes slow mo | style: cinematic', status: 'done' },
];

test('@mention of a past creation is swapped for its prompt', () => {
  const x = mem.expandMentions('@neon-gym but at sunrise', lib);
  assert.strictEqual(x.used.length, 1);
  assert.match(x.text, /my earlier creation: Make the gym brighter with orange neon lights\) but at sunrise/);
  const y = mem.expandMentions('remake @battle-ropes in 16:9', lib);
  assert.match(y.text, /battle ropes slow mo\) in 16:9/);
  assert.doesNotMatch(y.text, /style:/);
});

test('emails and unknown mentions are left alone', () => {
  assert.strictEqual(mem.expandMentions('mail rjekar73@gmail.com', lib).used.length, 0);
  assert.strictEqual(mem.expandMentions('@unicorn dance', lib).text, '@unicorn dance');
});

test('Create has @ picker, effects row and gym templates', () => {
  const s = pub('squad-create.js');
  assert.match(s, /function mentions\(sh, ta, mode\)/);
  assert.match(s, /expandMentions\(prompt, mode\)/);
  assert.match(s, /FPV drone/);
  assert.match(s, /Gym tour/);
});

test('Home has a real upload with progress and drafts', () => {
  const s = pub('sg-home-post.js');
  assert.match(s, /upload\.onprogress/);
  assert.match(s, /indexedDB/);
  assert.match(pub('reels/index.html'), /sg-home-post\.js/);
  assert.doesNotMatch(pub('reels/index.html'), /alert\('Reel uploaded!/);
});

test('Shop sells prompt / PDF / presentation / affiliate link and shows trust + licence', () => {
  const s = pub('sg-shop.js');
  assert.match(s, /Affiliate link/);
  assert.match(s, /Licence/);
  assert.match(s, /Refund if faulty/);
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'shop.js'), 'utf8');
  assert.match(srv, /kind === 'affiliate'/);
});

test('Profile shows My posts and glass skin is loaded', () => {
  assert.match(pub('sg-account.js'), /\/api\/post-everywhere\/mine/);
  assert.match(pub('sg-glass.css'), /backdrop-filter/);
  assert.match(pub('index.html'), /sg-glass\.css/);
});
