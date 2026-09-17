/**
 * The owner's list of 2026-09-17, evening: a shared reel link opened the top of
 * the feed instead of that reel, saved reels carried no ScanGym mark, the Book
 * rail's date/pass labels did not follow what he picked, and Book Share produced
 * no affiliate link. Each assertion below names the behaviour, not the code.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', f), 'utf8');
const srv = (f) => fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8');

test('a shared reel link reaches the feed inside the iframe', () => {
  const app = pub('app.ctr576.js');
  assert.match(app, /src="\/reels\/'\s*\+\s*_rq\s*\+\s*'"/,
    'the reels iframe src is fixed again, so ?v= never reaches the feed');
  assert.match(app, /\['v',\s*'ref'\]/, 'the reel id and the referral handle are not both forwarded');
  const feed = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'reels', 'index.html'), 'utf8');
  assert.match(feed, /urlParams\.get\('v'\)/, 'the feed no longer reads the deep-link id');
});

test('Book Share asks the server for the handle instead of dead-ending', () => {
  const app = pub('app.ctr576.js');
  const fn = app.slice(app.indexOf('window._sgShareGymLink=function'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /fetch\('\/api\/auth\/user'/, 'no server lookup for a missing referral handle');
  assert.match(body, /_sgShareHandleRetry/, 'the retry is unbounded — it could loop forever');
  assert.ok(body.indexOf('_sgShareHandleRetry=false') !== -1, 'the retry latch is never cleared');
});

test('the rail date, pass and payment labels follow the booking state', () => {
  const rail = pub('sg-rail-ui.js');
  assert.match(rail, /var railLabelSync=/, 'the label sync is gone');
  assert.match(rail, /ENHANCERS=\[[^\]]*railLabelSync\]/, 'the sync is not on the shared tick');
  assert.match(rail, /showCalendarPicker/, 'the date button is not matched by what it does');
  assert.match(rail, /addEventListener\('click'[\s\S]{0,160}setTimeout\(tick/,
    'labels only update on the 600ms tick, which reads as "not real-time"');
});

test('a downloaded reel carries the orange disc logo, not just text', () => {
  const wm = srv('lib/video-watermark.js');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'server', 'assets', 'scangym-watermark.png')),
    'the watermark logo asset is missing — downloads would fall back to text');
  assert.match(wm, /filter_complex/, 'the logo is not overlaid onto the video');
  assert.match(wm, /scale2ref/, 'the logo is not scaled to the video, so it will be wrong on 1080p');
  assert.match(wm, /_wm3_/, 'the cache key was not bumped, so old text-only files keep being served');
  assert.match(wm, /hasLogo/, 'a missing asset would produce an unbranded download with no fallback');
});
