// Task 104 step 1: Stories (Instagram/Snapchat/Facebook) + daily streak (Snapchat) on Home.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('server: /api/reels/stories = newest creator posts, topped up from the catalogue', () => {
  const src = read('server/routes/reels.js');
  assert.match(src, /router\.get\('\/stories'/);
  assert.match(src, /source = 'creation' ORDER BY created_at DESC LIMIT 20/);
});
test('Home: ⭕ Stories leads the rail and opens circles; streak counts days in a row', () => {
  const html = read('frontend/public/reels/index.html');
  assert.match(html, /label:'\\u2B55 Stories', value:'stories:'/);
  assert.match(html, /if\(cat\.value === 'stories:'\)\{ openStories\(\); return; \}/);
  assert.match(html, /st\.n = st\.last === y \? \(st\.n \|\| 0\) \+ 1 : 1;/);
});
