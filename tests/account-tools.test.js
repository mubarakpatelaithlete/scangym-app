/**
 * The Profile and Reels tabs can now finish their own jobs by voice.
 *
 * Both tabs point at the Book agent, which knew how to book and nothing else. Ask
 * the Profile tab the two questions it exists for — "where is my pass?", "what's in
 * my wallet?" — and the assistant had no tool to find out. An assistant with no tool
 * and a talkative model is exactly how a made-up balance gets read out loud.
 *
 * So these tests care about two things above all:
 *   1. every answer comes from the caller's own row, and no argument can change whose
 *   2. a failed or empty read is reported as such, never softened into a number
 *
 * The tools are exercised against a fake pool, so the SQL, the scoping and the
 * wording are all checked without a database.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'server', 'lib');

/**
 * Load account-tools with its database replaced. It requires ../middleware/db at
 * module load, so the stub is installed in the module cache first.
 */
function loadTools(handler) {
  const calls = [];
  const dbPath = require.resolve(path.join(ROOT, 'server', 'middleware', 'db'));
  const toolsPath = require.resolve(path.join(LIB, 'account-tools'));
  const fake = {
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      const out = handler(flat, params, calls.length);
      if (out instanceof Error) throw out;
      return out || { rows: [] };
    },
  };
  const previousDb = require.cache[dbPath];
  require.cache[dbPath] = new Module(dbPath, null);
  require.cache[dbPath].filename = dbPath;
  require.cache[dbPath].loaded = true;
  require.cache[dbPath].exports = fake;
  delete require.cache[toolsPath];
  const mod = require(toolsPath);
  delete require.cache[toolsPath];
  if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
  return { tools: mod.tools, calls };
}

const USER = 'user-abc';

/* ── wallet ──────────────────────────────────────────────────────────────── */

test('the wallet answer is the real balance, in pounds', async () => {
  const { tools, calls } = loadTools((sql) => {
    if (/FROM wallets/.test(sql)) return { rows: [{ id: 'w1', balance_pence: 1250, total_loaded_pence: 5000, total_spent_pence: 3750 }] };
    if (/FROM wallet_transactions/.test(sql)) {
      return { rows: [{ type: 'spend', amount_pence: -449, description: 'Day pass', created_at: '2026-08-27T10:00:00Z' }] };
    }
    return { rows: [] };
  });

  const res = await tools.get_my_wallet.run(USER, {});
  assert.equal(res.ok, true);
  assert.equal(res.balance, 12.5);
  assert.equal(res.balanceText, '£12.50');
  assert.equal(res.recent[0].amount, '-£4.49');
  assert.ok(calls.every((c) => !/reconcile/i.test(c.sql)), 'asking a question must not move money');
  assert.ok(calls[0].params.includes(USER), 'the wallet must be looked up by the caller id');
});

test('no wallet row is "empty", not a guess', async () => {
  const { tools } = loadTools(() => ({ rows: [] }));
  const res = await tools.get_my_wallet.run(USER, {});
  assert.equal(res.ok, true);
  assert.equal(res.balance, 0);
  assert.match(res.message, /empty/i);
});

test('a database failure is reported as a failure, with no number in it', async () => {
  const { tools } = loadTools(() => new Error('connection refused'));
  for (const name of ['get_my_wallet', 'get_my_pass', 'get_my_verification', 'get_my_streak', 'get_saved_gyms']) {
    const res = await tools[name].run(USER, {});
    assert.equal(res.ok, false, `${name} must fail loudly`);
    assert.ok(!/£\d/.test(res.message), `${name} must not invent an amount`);
  }
});

test('the transaction count is clamped, whatever the model asks for', async () => {
  for (const [asked, expected] of [[undefined, 5], [3, 3], [999, 10], [0, 5], ['nonsense', 5]]) {
    const { tools, calls } = loadTools((sql) => {
      if (/FROM wallets/.test(sql)) return { rows: [{ id: 'w1', balance_pence: 0, total_loaded_pence: 0, total_spent_pence: 0 }] };
      return { rows: [] };
    });
    await tools.get_my_wallet.run(USER, { recentCount: asked });
    const tx = calls.find((c) => /FROM wallet_transactions/.test(c.sql));
    assert.match(tx.sql, new RegExp(`LIMIT ${expected}\\b`), `recentCount ${asked} should query ${expected}`);
  }
});

/* ── pass ────────────────────────────────────────────────────────────────── */

const BOOKING = {
  id: 'b1', booking_date: '2026-08-29', start_time: '18:00', booking_code: 'SG-4821',
  status: 'confirmed', gym_name: 'Iron Works', address: '12 Tooley St',
};

test('the pass comes back with the entry code and whether it was scanned', async () => {
  const { tools, calls } = loadTools((sql) => {
    if (/FROM public\.bookings/.test(sql)) return { rows: [BOOKING] };
    if (/FROM booking_qr_codes/.test(sql)) return { rows: [{ id: 'qr1', created_at: 'x' }] };
    if (/FROM booking_checkins/.test(sql)) return { rows: [{ scan_type: 'entry', scanned_at: '2026-08-29T18:02:00Z' }] };
    return { rows: [] };
  });

  const res = await tools.get_my_pass.run(USER, {});
  assert.equal(res.hasPass, true);
  assert.equal(res.entryCode, 'SG-4821');
  assert.equal(res.qrReady, true);
  assert.equal(res.scanned, true);

  const booking = calls.find((c) => /FROM public\.bookings/.test(c.sql));
  assert.match(booking.sql, /b\.user_id::text = \$1::text/, 'the booking must be scoped to the caller');
  const qr = calls.find((c) => /FROM booking_qr_codes/.test(c.sql));
  assert.ok(qr.params.includes(USER), 'the QR row must also be scoped to the caller');
});

test('asking about a specific booking still cannot reach anyone else\'s', async () => {
  const { tools, calls } = loadTools((sql) => (/FROM public\.bookings/.test(sql) ? { rows: [BOOKING] } : { rows: [] }));
  await tools.get_my_pass.run(USER, { bookingId: "b2' OR 1=1 --" });
  const booking = calls.find((c) => /FROM public\.bookings/.test(c.sql));
  assert.match(booking.sql, /b\.user_id::text = \$1::text/);
  assert.match(booking.sql, /b\.id::text = \$2::text/, 'the id must be a parameter, never interpolated');
  assert.equal(booking.params[0], USER);
  assert.equal(booking.params[1], "b2' OR 1=1 --", 'and it travels as a value, so it cannot be SQL');
});

test('no upcoming session says exactly that', async () => {
  const { tools } = loadTools(() => ({ rows: [] }));
  const res = await tools.get_my_pass.run(USER, {});
  assert.equal(res.ok, true);
  assert.equal(res.hasPass, false);
  assert.match(res.message, /no upcoming session/i);
});

/* ── verification ────────────────────────────────────────────────────────── */

test('ID status tells the truth in all three states', async () => {
  const cases = [
    [{ identity_verified: true, identity_session_id: 's1' }, /verified/i, true],
    [{ identity_verified: false, identity_session_id: 's1' }, /not verified yet/i, false],
    [{ identity_verified: false, identity_session_id: null }, /not started/i, false],
  ];
  for (const [row, pattern, verified] of cases) {
    const { tools } = loadTools(() => ({ rows: [row] }));
    const res = await tools.get_my_verification.run(USER);
    assert.equal(res.verified, verified);
    assert.match(res.message, pattern);
  }
});

/* ── saved gyms ──────────────────────────────────────────────────────────── */

test('saving a gym by voice lands where the heart button puts it', async () => {
  let inserted = null;
  const { tools, calls } = loadTools((sql, params) => {
    if (/FROM gyms WHERE id/.test(sql)) return { rows: [{ id: 'g1', name: 'Iron Works' }] };
    if (/FROM gym_boards/.test(sql)) return { rows: [{ id: 'board1' }] };
    if (/INSERT INTO gym_saves/.test(sql)) { inserted = params; return { rows: [] }; }
    return { rows: [] };
  });

  const res = await tools.save_gym.run(USER, { gymId: 'g1' });
  assert.equal(res.ok, true);
  assert.equal(res.saved, true);
  assert.match(res.message, /Iron Works saved/);
  assert.deepEqual(inserted, [USER, 'g1', 'Iron Works', 'board1']);
  const ins = calls.find((c) => /INSERT INTO gym_saves/.test(c.sql));
  assert.match(ins.sql, /ON CONFLICT \(user_id, gym_id\) DO NOTHING/, 'saving twice must not error');
});

test('a first save creates the default board, exactly like the screen does', async () => {
  let madeBoard = false;
  const { tools } = loadTools((sql) => {
    if (/FROM gyms WHERE id/.test(sql)) return { rows: [{ id: 'g1', name: 'Iron Works' }] };
    if (/FROM gym_boards/.test(sql)) return { rows: [] };
    if (/INSERT INTO gym_boards/.test(sql)) { madeBoard = true; return { rows: [{ id: 'newboard' }] }; }
    return { rows: [] };
  });
  const res = await tools.save_gym.run(USER, { gymId: 'g1' });
  assert.equal(res.ok, true);
  assert.ok(madeBoard, "the first save must create the customer's list");
});

test('removing is explicit: only saved:false deletes', async () => {
  let deleted = 0;
  const handler = (sql) => {
    if (/FROM gyms WHERE id/.test(sql)) return { rows: [{ id: 'g1', name: 'Iron Works' }] };
    if (/DELETE FROM gym_saves/.test(sql)) { deleted++; return { rows: [] }; }
    if (/FROM gym_boards/.test(sql)) return { rows: [{ id: 'board1' }] };
    return { rows: [] };
  };

  const a = loadTools(handler);
  await a.tools.save_gym.run(USER, { gymId: 'g1' });               // default
  const b = loadTools(handler);
  await b.tools.save_gym.run(USER, { gymId: 'g1', saved: true });  // explicit save
  assert.equal(deleted, 0, 'saving must never delete — a misheard "save it" cannot wipe a gym');

  const c = loadTools(handler);
  const res = await c.tools.save_gym.run(USER, { gymId: 'g1', saved: false });
  assert.equal(deleted, 1);
  assert.equal(res.saved, false);
  assert.match(res.message, /removed from your list/i);
});

test('an unknown gym changes nothing and says so', async () => {
  const { tools, calls } = loadTools((sql) => (/FROM gyms WHERE id/.test(sql) ? { rows: [] } : { rows: [] }));
  const res = await tools.save_gym.run(USER, { gymId: 'nope' });
  assert.equal(res.ok, false);
  assert.match(res.message, /not changed your list/i);
  assert.ok(!calls.some((c) => /INSERT INTO gym_saves|DELETE FROM gym_saves/.test(c.sql)));
});

test('the saved list is the caller\'s, and an empty list says so', async () => {
  const { tools, calls } = loadTools(() => ({ rows: [] }));
  const res = await tools.get_saved_gyms.run(USER);
  assert.equal(res.ok, true);
  assert.deepEqual(res.gyms, []);
  assert.match(res.message, /Nothing saved yet/i);
  assert.ok(calls[0].params.includes(USER));
});

/* ── how the agent sees them ─────────────────────────────────────────────── */

test('the Book agent exposes the account tools, and none of them is public', () => {
  const bookTools = require(path.join(LIB, 'book-tools'));
  for (const name of ['get_my_wallet', 'get_my_pass', 'get_my_verification', 'get_my_streak', 'get_saved_gyms', 'save_gym']) {
    assert.ok(bookTools.tools[name], `${name} must be callable by the agent`);
    assert.equal(bookTools.needsLogin(name), true, `${name} must require a session — it reads someone's account`);
  }
  // Money still confirms; saving a gym does not, on purpose.
  assert.equal(bookTools.isWrite('book_and_pay'), true);
  assert.equal(bookTools.isWrite('save_gym'), false);
});

test('no tool takes a user id from the model', () => {
  const src = fs.readFileSync(path.join(LIB, 'account-tools.js'), 'utf8');
  const schemas = src.match(/properties: \{[\s\S]*?\}/g) || [];
  for (const s of schemas) {
    assert.ok(!/userId|user_id|customerId/i.test(s), 'a tool argument must never name a user — scope comes from the session');
  }
});

test('every account tool declares a schema the model can actually call', () => {
  const { tools } = loadTools(() => ({ rows: [] }));
  for (const [name, t] of Object.entries(tools)) {
    assert.equal(t.schema.name, name, 'the schema name must match the key the agent dispatches on');
    assert.equal(t.schema.parameters.type, 'object');
    assert.equal(t.schema.parameters.additionalProperties, false, `${name} must reject invented arguments`);
    assert.ok(t.schema.description.length > 30, `${name} needs a description worth reading`);
    assert.equal(typeof t.run, 'function');
  }
});

test('the tabs that gained the tools show them, and the prompt knows about them', () => {
  const pub = path.join(ROOT, 'frontend', 'public');
  const profile = fs.readFileSync(path.join(pub, 'profile-chat.js'), 'utf8');
  for (const name of ['get_my_pass', 'get_my_wallet', 'get_my_verification', 'get_my_streak', 'get_saved_gyms']) {
    assert.match(profile, new RegExp(name + ':'), `the Profile tab must label ${name} while it runs`);
  }
  const reels = fs.readFileSync(path.join(pub, 'reels-chat.js'), 'utf8');
  assert.match(reels, /save_gym:/, 'the Reels tab must label saving');

  const prompt = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'book-agent.js'), 'utf8');
  assert.match(prompt, /get_my_wallet/, 'the agent must be told the account tools exist');
  assert.match(prompt, /do not ask them to confirm/, 'saving must not add a tap');
});
