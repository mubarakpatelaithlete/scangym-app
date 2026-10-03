// Owner 2026-10-03: see-through bottom sheets + button rows on ALL tabs, and the
// 10 customer-QA fixes (fake unread badges, surge legend, Gyms button, top strip,
// ScanSquad back arrow, hashtag titles, Pulse empty + far-away gyms, off-topic tabs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const SHELLS = ['index.html', 'reels/index.html', 'scansquad/index.html', 'creator/index.html',
  'chats/app.html', 'pulse/index.html', 'ideas/index.html', 'upload/index.html'];

test('every tab shell loads the glass-sheet skin', () => {
  for (const s of SHELLS) assert.match(read('frontend/public/' + s), /\/sg-glass-sheets\.js/, s);
  const js = read('frontend/public/sg-glass-sheets.js');
  assert.match(js, /backdrop-filter:blur/);
  assert.doesNotThrow(() => new Function(js));
});

test('signed-out Chats shows no fake unread badges', () => {
  const html = read('frontend/public/chats/app.html');
  const so = html.slice(html.indexOf('function signedOut'), html.indexOf('function signedOut') + 3000);
  assert.ok(!/class="badge">1</.test(so));
});

test('Pricing no longer draws a surge / rush-hour bar', () => {
  const js = read('frontend/public/app.ctr576.js');
  assert.ok(!/Rush hour/.test(js));
  assert.match(js, /Same price all day/);
});

test('Gyms button hidden on Login/Pricing; strip clears the S mark', () => {
  const js = read('frontend/public/sg-rail-ui.js');
  assert.match(js, /data-route\^="\/login"\] #sg-continue-banner/);
  assert.match(js, /data-route\^="\/pricing"\] #sg-continue-banner/);
  assert.match(js, /min-height:56px;box-sizing:border-box;padding:6px 12px 6px 52px/);
  assert.match(read('frontend/public/scansquad/index.html'), /\.header-back\{margin-left:34px/);
});

test('Ideas titles drop hashtags', () => {
  const html = read('frontend/public/ideas/index.html');
  const src = html.match(/function cleanTitle\(n\) \{[\s\S]*?\n  \}/)[0];
  const cleanTitle = new Function(src + '; return cleanTitle;')();
  assert.strictEqual(cleanTitle('Leg day burner #Shorts #gym'), 'Leg day burner');
  assert.strictEqual(cleanTitle('#shorts'), 'Gym idea');
});

test('Pulse: starter posts when empty, gyms near you only', () => {
  const html = read('frontend/public/pulse/index.html');
  assert.match(html, /STARTERS/);
  assert.match(html, /\/api\/guest\/gyms\?lat=/);
  assert.ok(!/fetch\('\/api\/guest\/gyms'\)/.test(html));
});

test('Home top row is fitness only', () => {
  const html = read('frontend/public/reels/index.html');
  for (const k of ['drama', 'movie', 'podcast']) assert.ok(!html.includes("['" + k + "'"), k);
});
