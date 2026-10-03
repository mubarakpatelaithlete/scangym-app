// Kill-Snapchat: 👻 view-once snaps in Chats and 🔥 chat streaks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function loadInternals() {
  const src = read('server/routes/dm.js');
  const fn = src.slice(src.indexOf('function streakDays'), src.indexOf("router.post('/threads/:id/snap'"));
  const re = src.match(/const SNAP_RE = (\/.*\/);/)[1];
  // eslint-disable-next-line no-new-func
  return new Function(`const SNAP_RE = ${re}; ${fn}; return { streakDays, SNAP_RE };`)();
}

test('streak counts days in a row, from today or yesterday', () => {
  const { streakDays } = loadInternals();
  const now = new Date('2026-10-03T12:00:00Z');
  assert.strictEqual(streakDays(['2026-10-03', '2026-10-02', '2026-10-01'], now), 3);
  assert.strictEqual(streakDays(['2026-10-02', '2026-10-01'], now), 2);
  assert.strictEqual(streakDays(['2026-10-03', '2026-10-01'], now), 1);
  assert.strictEqual(streakDays(['2026-09-30'], now), 0);
  assert.strictEqual(streakDays([], now), 0);
});

test('snap body only matches random R2 keys', () => {
  const { SNAP_RE } = loadInternals();
  assert.ok(SNAP_RE.test('👻 snap:snaps/0123456789abcdef01234567.jpg'));
  assert.ok(!SNAP_RE.test('👻 snap:videos/x.mp4'));
  assert.ok(!SNAP_RE.test('👻 snap:snaps/../../secret.jpg'));
});

test('snaps open once, only for the other person, and live in R2 not disk', () => {
  const src = read('server/routes/dm.js');
  assert.match(src, /router\.get\('\/snap\/:id'/);
  assert.match(src, /Only your friend can open this snap/);
  assert.match(src, /SET body='👻 Opened'.*WHERE id=\$1 AND body=\$2/);
  assert.match(src, /deleteFromR2\(k\[1\]\)/);
  assert.match(src, /multer\.memoryStorage\(\)/);
  assert.match(src, /Snaps cannot be forwarded/);
});

test('chat page has the snap button, viewer and streak flame', () => {
  const html = read('frontend/public/chats/app.html');
  assert.match(html, /id="snapBtn"/);
  assert.match(html, /window\.openSnap=openSnap/);
  assert.match(html, /\/api\/dm\/snap\//);
  assert.match(html, /t\.streak>=2/);
});
