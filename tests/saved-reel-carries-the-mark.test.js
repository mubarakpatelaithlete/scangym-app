/**
 * Save must never hand over a clean file.
 *
 * TikTok's Save path composites the logo server-side at request time and the
 * unwatermarked master never goes out through it. ScanGym's route did the same
 * thing, with two ways out: if FFmpeg threw it fell through to the raw CDN
 * proxy (download still 200s, video carries no link), and ?raw=1 skipped the
 * stamp for anyone who typed it. Both are closed; these tests keep them closed.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const routes = read('server/routes/reels.js');
const lib = read('server/lib/video-watermark.js');
const saveRoute = routes.slice(
  routes.indexOf("router.get('/download/:cdnKey'"),
  routes.indexOf("router.get('/download-clean/:cdnKey'"),
);

test('the Save route exists and is the stamped one', () => {
  assert.ok(saveRoute.length > 0, 'Save route not found');
  assert.match(saveRoute, /getWatermarkedVideo\(cdnKey, linkHandle\)/,
    'Save no longer asks for a stamped file');
});

test('a failed stamp is retried, never swapped for the clean CDN file', () => {
  assert.match(saveRoute, /safeMode: true/, 'no text-only retry after a failed stamp');
  assert.ok(!/cdn\.scangym\.com/.test(saveRoute),
    'the Save route can still reach the clean CDN file directly');
  assert.match(saveRoute, /503/, 'a total failure must answer 503, not a clean video');
  assert.match(saveRoute, /still_preparing/, 'no machine-readable reason on the 503');
});

test('the 503 body cannot be saved as a broken .mp4', () => {
  // Content-Type/Disposition must be set after the stamp exists, or the phone
  // writes the JSON error to disk as a video file.
  const disposition = saveRoute.indexOf('Content-Disposition');
  const firstFail = saveRoute.indexOf('still_preparing');
  assert.ok(disposition > firstFail,
    'download headers are set before the failure path returns');
});

test('the unstamped master is admin-only', () => {
  assert.ok(!/req\.query\.raw/.test(routes), 'the public ?raw=1 bypass is back');
  const clean = routes.slice(routes.indexOf("router.get('/download-clean/:cdnKey'"));
  assert.match(clean.slice(0, 200), /authenticateUser, requireAdmin/,
    'the clean master is not behind admin auth');
});

test('the stamp drifts between corners like TikTok', () => {
  // A mark in one fixed corner is croppable; TikTok cycles position.
  assert.match(lib, /enable='lt\(mod\(t/, 'no phase-A window on the stamp');
  assert.match(lib, /enable='gte\(mod\(t/, 'no phase-B window on the stamp');
  assert.match(lib, /split=2\[wmA\]\[wmB\]/, 'the logo is not fed to both corners');
});

test('safe mode drops the fragile filters but keeps the link', () => {
  const fn = lib.slice(lib.indexOf('function addWatermark'), lib.indexOf('async function getWatermarkedVideo'));
  assert.match(fn, /const hasLogo = !safeMode/, 'safe mode still tries the logo overlay');
  const safeBranch = fn.slice(fn.lastIndexOf('} else {'));
  assert.ok(!/scale2ref|overlay=/.test(safeBranch), 'safe mode still uses scale2ref/overlay');
  assert.match(safeBranch, /textChain/, 'safe mode does not draw the link line');
});

test('cached files from the old stamp are not reused for the new one', () => {
  assert.match(lib, /'wm4'/, 'the cache tag was not bumped for the drifting stamp');
  assert.match(lib, /safeMode \? 'safe' : ''/, 'text-only output shares the full stamp cache key');
});
