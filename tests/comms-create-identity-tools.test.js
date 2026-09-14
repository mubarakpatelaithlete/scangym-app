/**
 * Buttons v1.0, batches 3–5: Messages, AI coach, Music, Create, Verify — by voice.
 *
 * Fake pool, fake LLM, fake Stripe: SQL, scoping and wording are checked without any
 * service. The things that must hold:
 *   1. a message to a gym reaches the owner through the same notifier as the tap flow,
 *      is tied to the customer (conversations.user_id), and is a confirmed write;
 *   2. the coach and the workout log obey the paid-and-scanned-in gate from one place;
 *   3. an owner answers only messages on gyms they claimed — enforced in the UPDATE;
 *   4. Create writes text with the sheet's own writer and hands every other mode to the
 *      sheet, saying plainly when a mode is not switched on;
 *   5. Verify opens Stripe's hosted page and nothing else can be opened.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'frontend', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

/** Load a lib with ../middleware/db (and optionally other modules) replaced. */
function load(lib, handler, stubs = {}) {
  const calls = [];
  const saved = [];
  function stub(modulePath, exportsObj) {
    const p = require.resolve(modulePath);
    saved.push([p, require.cache[p]]);
    const m = new Module(p, null);
    m.filename = p;
    m.loaded = true;
    m.exports = exportsObj;
    require.cache[p] = m;
  }
  stub(path.join(ROOT, 'server', 'middleware', 'db'), {
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      const out = handler(flat, params, calls.length);
      if (out instanceof Error) throw out;
      return out || { rows: [] };
    },
  });
  for (const [p, e] of Object.entries(stubs)) stub(path.join(ROOT, 'server', p), e);
  // Nested libs (coach-core, identity-core, owner-notify) capture the pool at load, so
  // every server module must be re-required against this test's stub.
  const stubbed = new Set(saved.map(([p]) => p));
  for (const k of Object.keys(require.cache)) {
    if (!stubbed.has(k) && (k.includes(path.sep + 'server' + path.sep + 'lib' + path.sep) || k.includes(path.sep + 'server' + path.sep + 'routes' + path.sep))) delete require.cache[k];
  }
  const libPath = require.resolve(path.join(ROOT, 'server', 'lib', lib));
  const mod = require(libPath);
  delete require.cache[libPath];
  // Only the db stub is restored here. Tools require their collaborators lazily inside
  // run(), so those stubs must outlive load(); the purge above clears them on the next load.
  const [dbPath, prevDb] = saved[0];
  if (prevDb) require.cache[dbPath] = prevDb; else delete require.cache[dbPath];
  return { mod, calls };
}

const GYM = { rows: [{ id: 7, name: 'Iron Works', claimed_by: 'owner-1' }] };

/* ── 3. Messages ─────────────────────────────────────────────────────── */

test('message_gym stores the conversation against the customer and tells the owner through owner-notify', async () => {
  let notified = null;
  const { mod, calls } = load(
    'comms-tools',
    (sql) => {
      if (sql.startsWith('SELECT id, name, claimed_by FROM gyms')) return GYM;
      if (sql.startsWith('INSERT INTO conversations')) return { rows: [{ id: 300 }] };
      return null;
    },
    { 'lib/owner-notify.js': { notifyGymOwner: async (_pool, gym, text, convoId) => { notified = { gym: gym.name, text, convoId }; return { sms: true, email: false }; } } }
  );
  assert.equal(mod.tools.message_gym.write, true, 'confirmed before sending');
  const r = await mod.tools.message_gym.run('user-1', { gymId: 7, message: 'Is the sauna working today?' });
  assert.equal(r.ok, true);
  assert.deepEqual(notified, { gym: 'Iron Works', text: 'Is the sauna working today?', convoId: 300 });
  const convo = calls.find((c) => c.sql.startsWith('INSERT INTO conversations'));
  assert.deepEqual(convo.params, ['Chat with Iron Works', 'user-1', 7], 'tied to the customer and the gym');
  const esc = calls.find((c) => c.sql.startsWith('INSERT INTO chat_escalations'));
  assert.deepEqual(esc.params, [300, 7, 'Is the sauna working today?', true, false]);
  assert.match(r.message, /notified by text/);

  const guest = await mod.tools.message_gym.run(null, { gymId: 7, message: 'hi' });
  assert.equal(guest.ok, false);
});

test('message_gym says so when no one could be notified', async () => {
  const { mod } = load(
    'comms-tools',
    (sql) => (sql.startsWith('SELECT id, name, claimed_by') ? GYM : sql.startsWith('INSERT INTO conversations') ? { rows: [{ id: 1 }] } : null),
    { 'lib/owner-notify.js': { notifyGymOwner: async () => ({ sms: false, email: false }) } }
  );
  const r = await mod.tools.message_gym.run('user-1', { gymId: 7, message: 'hello' });
  assert.equal(r.ok, true);
  assert.match(r.message, /can't promise/);
});

test('read_gym_replies reads only this customer\'s conversations', async () => {
  const { mod, calls } = load('comms-tools', (sql) => {
    if (sql.includes('FROM conversations c')) return { rows: [{ gym_name: 'Iron Works', user_message: 'Sauna?', owner_response: 'Yes, from 6am', status: 'resolved' }, { gym_name: 'Iron Works', user_message: 'Parking?', owner_response: null, status: 'pending' }] };
    return null;
  });
  const r = await mod.tools.read_gym_replies.run('user-1', {});
  assert.equal(r.replies, 1);
  assert.equal(r.waiting, 1);
  assert.match(calls[0].sql, /WHERE c\.user_id = \$1/);
  assert.deepEqual(calls[0].params, ['user-1']);
  assert.match(r.message, /1 reply, 1 still waiting/);
});

test('the owner answers only messages on gyms they claimed, and the customer\'s chat gets the same line as the tap flow', async () => {
  const { mod, calls } = load('partner-tools', (sql, params) => {
    if (sql.startsWith('UPDATE chat_escalations ce SET owner_response')) return params[2] === 'owner-1' ? { rows: [{ id: 5, conversation_id: 300, gym_name: 'Iron Works' }] } : { rows: [] };
    return null;
  });
  assert.equal(mod.tools.reply_to_customer.write, true);
  const ok = await mod.tools.reply_to_customer.run('owner-1', { messageId: 5, reply: 'Yes, from 6am' });
  assert.equal(ok.ok, true);
  assert.match(calls[0].sql, /g\.claimed_by::text = \$3::text/);
  const line = calls.find((c) => c.sql.startsWith('INSERT INTO messages'));
  assert.deepEqual(line.params, [300, '📞 Message from the gym team: Yes, from 6am']);
  const notMine = await mod.tools.reply_to_customer.run('owner-2', { messageId: 5, reply: 'x' });
  assert.equal(notMine.ok, false);
});

/* ── 3. Coach + workouts ─────────────────────────────────────────────── */

test('ask_coach is locked until paid and scanned in, then answers with the shared brief and remembers', async () => {
  const locked = load('comms-tools', (sql) => (sql.includes('booking_checkins') ? { rows: [] } : null));
  const l = await locked.mod.tools.ask_coach.run('user-1', { question: 'Legs today?' });
  assert.equal(l.ok, false);
  assert.ok(l.locked && l.requiresBooking);
  assert.ok(!locked.calls.some((c) => c.sql.startsWith('INSERT INTO coach_conversations')), 'nothing is stored when locked');

  const { mod, calls } = load(
    'comms-tools',
    (sql) => {
      if (sql.includes('booking_checkins')) return { rows: [{ id: 1, gym_id: 7, scan_type: 'entry' }] };
      if (sql.startsWith('SELECT * FROM coach_profiles')) return { rows: [{ fitness_goals: 'strength', experience_level: 'beginner' }] };
      if (sql.startsWith('SELECT role, content FROM coach_conversations')) return { rows: [{ role: 'user', content: 'Legs today?' }] };
      return null;
    },
    { 'lib/llm.js': { streamChat: async (_tag, params) => { assert.match(params.messages[0].content, /Goals: strength/); return { stream: { choices: [{ message: { content: 'Yes — squats, lunges, keep it to 45 minutes.' } }] }, provider: 'fake' }; }, configured: () => true } }
  );
  const r = await mod.tools.ask_coach.run('user-1', { question: 'Legs today?' });
  assert.equal(r.ok, true);
  assert.equal(r.answer, 'Yes — squats, lunges, keep it to 45 minutes.');
  const stored = calls.filter((c) => c.sql.startsWith('INSERT INTO coach_conversations')).map((c) => c.params[1]);
  assert.deepEqual(stored, ['user', 'assistant'], 'both turns are remembered like the Coach screen');
});

test('log_workout writes to workout_logs for the caller at the gym they scanned into', async () => {
  const { mod, calls } = load('comms-tools', (sql) => {
    if (sql.includes('booking_checkins')) return { rows: [{ id: 1, gym_id: 7, scan_type: 'entry' }] };
    if (sql.startsWith('INSERT INTO workout_logs')) return { rows: [{ id: 12 }] };
    return null;
  });
  const r = await mod.tools.log_workout.run('user-1', { workoutType: 'legs', durationMinutes: 45, energyLevel: 4 });
  assert.equal(r.ok, true);
  const ins = calls.find((c) => c.sql.startsWith('INSERT INTO workout_logs'));
  assert.deepEqual(ins.params, ['user-1', 7, 'legs', 45, null, 4]);
  assert.equal(r.message, 'Logged: legs, 45 minutes.');
});

test('the coach route and the voice tool share one gate and one brief', () => {
  const route = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'coach.js'), 'utf8');
  assert.ok(route.includes("require('../lib/coach-core')"), 'the route reads the brief from coach-core');
  assert.ok(!/^function buildCoachSystemPrompt/m.test(route), 'no second copy of the brief in the route');
  const core = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'coach-core.js'), 'utf8');
  assert.ok(core.includes("bc.scan_type = 'entry'"), 'the gate still requires an entry scan');
});

/* ── 3. Music ─────────────────────────────────────────────────────────── */

test('play_music is a screen action; save_track and get_my_playlists are scoped to the caller', async () => {
  const { mod, calls } = load('comms-tools', (sql) => {
    if (sql.startsWith('SELECT id FROM user_playlists')) return { rows: [] };
    if (sql.startsWith('INSERT INTO user_playlists')) return { rows: [{ id: 3 }] };
    if (sql.startsWith('SELECT id FROM playlist_tracks')) return { rows: [] };
    if (sql.startsWith('SELECT p.id, p.title')) return { rows: [{ id: 3, title: 'My Playlist', tracks: 1 }] };
    return null;
  });
  const p = await mod.tools.play_music.run(null, { action: 'next' });
  assert.deepEqual(p.ui, { action: 'music', command: 'next' });
  assert.ok(mod.PUBLIC_COMMS_TOOLS.has('play_music'), 'anyone can press play');

  const s = await mod.tools.save_track.run('user-1', { trackName: 'Beast Mode 2', artist: 'ScanGym Beats' });
  assert.equal(s.ok, true);
  const ins = calls.find((c) => c.sql.startsWith('INSERT INTO playlist_tracks'));
  assert.deepEqual(ins.params, [3, 'Beast Mode 2', 'ScanGym Beats']);
  assert.deepEqual(calls[0].params, ['user-1', 'My Playlist']);

  const g = await mod.tools.get_my_playlists.run('user-1');
  assert.match(g.message, /My Playlist \(1\)/);
  const guest = await mod.tools.save_track.run(null, { trackName: 'x' });
  assert.equal(guest.ok, false);
});

/* ── 4. Create ────────────────────────────────────────────────────────── */

test('create_content writes text with the sheet\'s writer and hands other modes to the sheet — or says they are off', async () => {
  const { mod } = load(
    'squad-tools',
    () => null,
    {
      'routes/squad-text.js': { writePost: async (b) => ({ text: 'Train anywhere. £4.49.', tone: b.tone || 'Punchy', length: 'Short' }) },
      'routes/squad-create.js': { MODES: { text: { label: 'Text', ready: () => true, api: '/api/squad-text' }, video: { label: 'Video', env: 'X_VIDEO_KEY', api: '/api/squad-video' }, image: { label: 'Image', env: 'X_IMAGE_KEY', api: null } } },
    }
  );
  const t = await mod.tools.create_content.run('u', { mode: 'text', prompt: 'a caption about training anywhere', tone: 'Punchy' });
  assert.equal(t.ok, true);
  assert.equal(t.text, 'Train anywhere. £4.49.');
  assert.deepEqual(t.ui, { action: 'open_create', mode: 'text', prompt: 'a caption about training anywhere', result: 'Train anywhere. £4.49.' });

  process.env.X_VIDEO_KEY = 'k';
  const v = await mod.tools.create_content.run('u', { mode: 'video', prompt: 'sunrise run' });
  assert.equal(v.ok, true);
  assert.ok(v.handoff);
  assert.deepEqual(v.ui, { action: 'open_create', mode: 'video', prompt: 'sunrise run' });
  delete process.env.X_VIDEO_KEY;
  const off = await mod.tools.create_content.run('u', { mode: 'video', prompt: 'x' });
  assert.equal(off.ok, false);
  assert.ok(off.notAvailable);

  const img = await mod.tools.create_content.run('u', { mode: 'image', prompt: 'x' });
  assert.equal(img.ok, false);
  assert.match(img.message, /hasn't been built/);
  assert.equal(img.ui, undefined);
});

test('the text writer is exported by the route, not duplicated', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'squad-text.js'), 'utf8');
  assert.ok(src.includes('module.exports.writePost = writePost;'));
  assert.equal((src.match(/async function writePost\(/g) || []).length, 1);
});

/* ── 5. Verify ────────────────────────────────────────────────────────── */

test('start_verification opens Stripe Identity for the caller, and the route uses the same function', async () => {
  const { mod } = load(
    'account-tools',
    () => null,
    { 'lib/identity-core.js': { startVerification: async (uid) => (uid === 'done' ? { ok: true, alreadyVerified: true } : { ok: true, url: 'https://verify.stripe.com/start/abc' }) } }
  );
  const r = await mod.tools.start_verification.run('user-1');
  assert.deepEqual(r.ui, { action: 'open_url', url: 'https://verify.stripe.com/start/abc' });
  const d = await mod.tools.start_verification.run('done');
  assert.equal(d.verified, true);
  assert.equal(d.ui, undefined);
  const g = await mod.tools.start_verification.run(null);
  assert.equal(g.ok, false);

  const route = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'identity.js'), 'utf8');
  assert.ok(route.includes("require('../lib/identity-core')") && route.includes('await startVerification(req.user.id'));
  assert.ok(!route.includes('verificationSessions.create'), 'the session is created in one place');
});

/* ── the wire and the tab ─────────────────────────────────────────────── */

test('SGScreen: closed vocabulary, music through the player state, URLs only from the allow-list', () => {
  const src = read('chat-agent.js');
  assert.match(src, /var ACTIONS = \{ go_to_tab: goToTab, share: share, open_gym: openGym, open_write_review: openWriteReview, music: music, open_create: openCreate, open_url: openUrl \};/);
  assert.ok(src.includes("var URL_ALLOW = ['https://verify.stripe.com/', 'https://scangym.com/'];"));
  assert.ok(src.includes('window._sgMusicPlaying = cmd !== \'pause\';'), 'music drives the same state MusicTabPage reads');
  assert.ok(src.includes('window.sgSquadCreate.open('), 'create goes through the sheet\'s own entry point');
  assert.ok(read('squad-create.js').includes('window.sgSquadCreate = {'), 'the sheet exposes open(mode, prompt, result)');
  for (const f of ['book-chat.js', 'profile-chat.js', 'reels-chat.js']) assert.ok(read(f).includes("ask_coach: 'Asking your coach'"), f);
  assert.ok(read('partner-chat.js').includes("reply_to_customer: 'Sending your reply'"));
  assert.ok(read('squad-chat.js').includes("create_content: 'Creating'"));
});

test('owner notification lives in one lib, used by the receptionist chat and the voice tool', () => {
  const chat = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'chat.js'), 'utf8');
  assert.ok(chat.includes("require('../lib/owner-notify')"));
  assert.ok(!chat.includes('async function sendOwnerSMS'), 'no second copy in the route');
  const lib = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'owner-notify.js'), 'utf8');
  assert.ok(lib.includes('async function sendOwnerSMS') && lib.includes('async function notifyGymOwner'));
});

test('the migration gives conversations a customer and a gym', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations', '20260914_conversations_owner.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT;/);
  assert.match(sql, /ALTER TABLE conversations ADD COLUMN IF NOT EXISTS gym_id\s+INTEGER;/);
});
