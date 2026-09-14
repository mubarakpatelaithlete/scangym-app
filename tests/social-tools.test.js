/**
 * Buttons v1.0, batch 2: Calendar, Facilities, Reviews and Photos by voice.
 *
 * Exercised against a fake pool, so the SQL, the scoping and the wording are checked
 * without a database. What matters most:
 *   1. reads answer from the gym's own rows and say "none yet" rather than invent;
 *   2. leave_review is a confirmed write, one per gym, scoped to the caller, and is
 *      tied to a visit only when a qualifying one exists;
 *   3. an owner can only reply to reviews of a gym they claimed — the scoping is in
 *      the UPDATE itself, not a check the model could skip;
 *   4. pictures are handed to the screen through the closed SGScreen vocabulary.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'frontend', 'public');

function load(lib, handler) {
  const calls = [];
  const dbPath = require.resolve(path.join(ROOT, 'server', 'middleware', 'db'));
  const libPath = require.resolve(path.join(ROOT, 'server', 'lib', lib));
  const previousDb = require.cache[dbPath];
  require.cache[dbPath] = new Module(dbPath, null);
  require.cache[dbPath].filename = dbPath;
  require.cache[dbPath].loaded = true;
  require.cache[dbPath].exports = {
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      const out = handler(flat, params, calls.length);
      if (out instanceof Error) throw out;
      return out || { rows: [] };
    },
  };
  delete require.cache[libPath];
  const mod = require(libPath);
  delete require.cache[libPath];
  if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
  return { mod, calls };
}

const GYM = { rows: [{ id: 7, name: 'Iron Works', opening_hours: { mon: '06:00-22:00' }, is_24h: false }] };

test('get_schedule lists every date with its weekday and marks closures from the overrides table', async () => {
  const { mod, calls } = load('social-tools', (sql) => {
    if (sql.startsWith('SELECT id, name, opening_hours')) return GYM;
    if (sql.includes('gym_schedule_overrides')) return { rows: [{ override_date: mod_today(1), is_closed: true, open_time: null, close_time: null, reason: 'Bank holiday' }] };
    return null;
  });
  const r = await mod.tools.get_schedule.run(null, { gymId: 7, days: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.dates.length, 3);
  assert.equal(r.dates[0].date, mod.isoDate(0));
  assert.ok(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(r.dates[0].weekday));
  assert.equal(r.dates[1].closed, true, 'the override marks tomorrow closed');
  assert.equal(r.changes[0].reason, 'Bank holiday');
  assert.deepEqual(calls[1].params, [7, mod.isoDate(0), mod.isoDate(2)], 'the window is exactly the days asked for');
  assert.match(r.message, /1 changed day/);

  const none = await mod.tools.get_schedule.run(null, { gymId: 'abc' });
  assert.equal(none.ok, false);
});

function mod_today(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test('get_facilities reads gym_amenities and says so when nothing is listed', async () => {
  const { mod } = load('social-tools', (sql) => {
    if (sql.startsWith('SELECT id, name FROM gyms')) return GYM;
    if (sql.includes('gym_amenities')) return { rows: [{ has_shower: true, shower_free: false, has_wifi: true, has_locker: false }] };
    return null;
  });
  const r = await mod.tools.get_facilities.run(null, { gymId: 7 });
  assert.deepEqual(r.facilities, [{ name: 'Showers', free: false }, { name: 'WiFi', free: true }]);
  assert.match(r.message, /showers, wifi/);

  const empty = load('social-tools', (sql) => (sql.startsWith('SELECT id, name FROM gyms') ? GYM : { rows: [] }));
  const e = await empty.mod.tools.get_facilities.run(null, { gymId: 7 });
  assert.equal(e.ok, true);
  assert.deepEqual(e.facilities, []);
  assert.match(e.message, /hasn't listed/);
});

test('get_reviews gives the real average and count, never a number for a gym with none', async () => {
  const { mod, calls } = load('social-tools', (sql) => {
    if (sql.startsWith('SELECT id, name FROM gyms')) return GYM;
    if (sql.startsWith('SELECT COUNT(*)::int AS total')) return { rows: [{ total: 2, avg: 4.5 }] };
    if (sql.includes('FROM reviews WHERE gym_id')) return { rows: [{ id: 1, rating: 5, comment: 'Great', owner_response: 'Thanks', created_at: new Date('2026-09-01'), verified_visit: true }] };
    return null;
  });
  const r = await mod.tools.get_reviews.run(null, { gymId: 7, sort: 'lowest', limit: 50 });
  assert.equal(r.averageRating, 4.5);
  assert.equal(r.totalReviews, 2);
  assert.equal(r.reviews[0].ownerReply, 'Thanks');
  assert.match(calls[2].sql, /ORDER BY rating ASC/);
  assert.equal(calls[2].params[1], 10, 'limit is capped');

  const none = load('social-tools', (sql) => (sql.startsWith('SELECT id, name FROM gyms') ? GYM : sql.startsWith('SELECT COUNT') ? { rows: [{ total: 0, avg: 0 }] } : { rows: [] }));
  const n = await none.mod.tools.get_reviews.run(null, { gymId: 7 });
  assert.equal(n.averageRating, null);
  assert.match(n.message, /no reviews yet/);
});

test('leave_review is a confirmed write, one per gym, tied to a recent visit when there is one', async () => {
  const { mod, calls } = load('social-tools', (sql, params) => {
    if (sql.startsWith('SELECT id, name FROM gyms')) return GYM;
    if (sql.startsWith('SELECT id FROM reviews WHERE user_id')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM bookings')) return { rows: [{ id: 99 }] };
    if (sql.startsWith('INSERT INTO reviews')) return { rows: [{ id: 501 }] };
    return null;
  });
  assert.equal(mod.tools.leave_review.write, true, 'the route asks before posting');
  const r = await mod.tools.leave_review.run('user-1', { gymId: 7, rating: 5, comment: 'Spotless' });
  assert.equal(r.ok, true);
  assert.equal(r.reviewId, 501);
  assert.equal(r.verifiedVisit, true);
  const ins = calls.find((c) => c.sql.startsWith('INSERT INTO reviews'));
  assert.deepEqual(ins.params, [7, 'user-1', 99, 5, 'Spotless'], 'gym, caller, their visit, stars, words');
  assert.ok(calls.some((c) => c.sql.startsWith('UPDATE gyms SET average_rating')), 'the gym card average is refreshed like the screen does');

  const dup = load('social-tools', (sql) => (sql.startsWith('SELECT id, name FROM gyms') ? GYM : sql.startsWith('SELECT id FROM reviews') ? { rows: [{ id: 3 }] } : null));
  const d = await dup.mod.tools.leave_review.run('user-1', { gymId: 7, rating: 4 });
  assert.equal(d.ok, false);
  assert.ok(d.alreadyReviewed);
  assert.ok(!dup.calls.some((c) => c.sql.startsWith('INSERT')), 'nothing is inserted twice');

  const bad = await mod.tools.leave_review.run('user-1', { gymId: 7, rating: 9 });
  assert.equal(bad.ok, false);
  const guest = await mod.tools.leave_review.run(null, { gymId: 7, rating: 5 });
  assert.equal(guest.ok, false);
});

test('photos are shown on the screen, never described; add_photo hands over to the review form', async () => {
  const { mod } = load('social-tools', (sql) => {
    if (sql.startsWith('SELECT id, name FROM gyms')) return GYM;
    if (sql.includes('FROM review_media')) return { rows: [{ id: 1, media_type: 'photo', url: '/x.jpg', created_at: new Date(), rating: 5, comment: 'nice' }] };
    return null;
  });
  const r = await mod.tools.get_gym_photos.run(null, { gymId: 7 });
  assert.equal(r.photos, 1);
  assert.deepEqual(r.ui, { action: 'open_gym', gymId: 7, section: 'photos' });

  const none = load('social-tools', (sql) => (sql.startsWith('SELECT id, name FROM gyms') ? GYM : { rows: [] }));
  const n = await none.mod.tools.get_gym_photos.run(null, { gymId: 7 });
  assert.equal(n.ui, undefined, 'nothing to show, so the screen is left alone');
  assert.match(n.message, /Nobody has posted/);

  const add = await mod.tools.add_photo.run('user-1', {});
  assert.deepEqual(add.ui, { action: 'open_write_review' });
  const guest = await mod.tools.add_photo.run(null, {});
  assert.equal(guest.ok, false);
});

test("an owner's reply is scoped in the UPDATE to gyms they claimed", async () => {
  const { mod, calls } = load('partner-tools', (sql, params) => {
    if (sql.startsWith('UPDATE reviews r SET owner_response')) {
      return params[2] === 'owner-1' ? { rows: [{ id: 42, rating: 3, gym_name: 'Iron Works' }] } : { rows: [] };
    }
    return null;
  });
  assert.equal(mod.tools.reply_to_review.write, true);
  const ok = await mod.tools.reply_to_review.run('owner-1', { reviewId: 42, reply: 'Sorry about the showers — fixed now.' });
  assert.equal(ok.ok, true);
  assert.match(calls[0].sql, /g\.claimed_by::text = \$3::text/);
  assert.deepEqual(calls[0].params.slice(1), [42, 'owner-1']);

  const notMine = await mod.tools.reply_to_review.run('owner-2', { reviewId: 42, reply: 'Hi' });
  assert.equal(notMine.ok, false);
  const empty = await mod.tools.reply_to_review.run('owner-1', { reviewId: 42, reply: '   ' });
  assert.equal(empty.ok, false);
});

test('the Book agent carries the social tools, reads are public, and the screen knows the two new actions', () => {
  const book = require(path.join(ROOT, 'server', 'lib', 'book-tools'));
  for (const t of ['get_schedule', 'get_facilities', 'get_reviews', 'leave_review', 'get_gym_photos', 'add_photo']) assert.ok(book.tools[t], t);
  for (const t of ['get_schedule', 'get_facilities', 'get_reviews', 'get_gym_photos']) assert.equal(book.needsLogin(t), false, t + ' is public');
  assert.equal(book.needsLogin('leave_review'), true);
  assert.equal(book.needsLogin('add_photo'), true);

  const src = fs.readFileSync(path.join(PUB, 'chat-agent.js'), 'utf8');
  assert.match(src, /var ACTIONS = \{ go_to_tab: goToTab, share: share, open_gym: openGym, open_write_review: openWriteReview, music: music, open_create: openCreate, open_url: openUrl \};/);
  assert.ok(src.includes('window.openGym(id)') && src.includes('window.openWriteReviewModal()'));

  const confirm = require(path.join(ROOT, 'server', 'lib', 'confirm-line'));
  return confirm
    .confirmLine('leave_review', { gymId: 7, rating: 5, comment: 'Spotless' }, 'u', { pool: { query: async () => ({ rows: [{ name: 'Iron Works' }] }) } })
    .then((line) => assert.equal(line, 'Post a 5-star review of Iron Works saying "Spotless"? It\'s public.'));
});
