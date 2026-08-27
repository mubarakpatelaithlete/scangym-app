/**
 * The app must not fire requests it knows will fail.
 *
 * Measured on the live site, logged out, across all five tabs:
 *
 *   /explore       404 /api/stats/live-visitors, 401 /api/bookings
 *   /scansquad     401 /api/creators/membership
 *   /partner       401 /api/gym-partner/dashboard, 404 live-visitors, 401 bookings
 *   /more/profile  401 /api/auth/profile (x2), 404 live-visitors, 401 bookings
 *
 * Two distinct faults:
 *
 * 1. /api/stats/live-visitors has never existed as a route. A previous fix
 *    validated the response rather than removing the call, so a 404 fired every
 *    30 seconds for the entire session while the label kept its static default.
 *
 * 2. The rest are session-only endpoints called with no session. Auth is an
 *    httpOnly express session, so the client cannot see it; a localStorage hint
 *    written at login now gates those calls.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');

const APP = read('app.ctr576.js');

// ─── 1. the endpoint that never existed ──────────────────────────────────────

test('/api/stats/live-visitors is never requested from anywhere', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!/\.(js|html)$/.test(e.name)) continue;
      const body = fs.readFileSync(full, 'utf8');
      // A comment explaining the removal is fine; an actual fetch is not.
      if (/fetch\(\s*['"`][^'"`]*\/api\/stats\/live-visitors/.test(body)) {
        offenders.push(path.relative(PUB, full));
      }
    }
  };
  walk(PUB);
  assert.deepStrictEqual(offenders, [], `still fetching a route that does not exist: ${offenders}`);
});

test('the server genuinely has no live-visitors route (the call was never going to work)', () => {
  const serverDir = path.join(__dirname, '..', 'server');
  let found = false;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      if (fs.readFileSync(full, 'utf8').includes('live-visitors')) found = true;
    }
  };
  walk(serverDir);
  assert.strictEqual(found, false, 'a route now exists — re-enable the poller deliberately');
});

test('the 30-second polling interval is gone', () => {
  assert.doesNotMatch(read('app-patches-v3.js'), /setInterval\(\s*f\s*,\s*30000\s*\)/);
});

// ─── 2. the session hint ─────────────────────────────────────────────────────

function loadSessionHelpers(authed) {
  const start = APP.indexOf('function sgSetSession(');
  assert.notStrictEqual(start, -1, 'sgSetSession missing');
  const marker = 'window.sgAuthedFetch=sgAuthedFetch;';
  const end = APP.indexOf(marker, start);
  assert.notStrictEqual(end, -1, 'sgAuthedFetch export missing');

  const store = authed ? { sg_authed: '1' } : {};
  const calls = [];
  const sandbox = {
    window: {},
    state: { user: null },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    fetch: async (url, opts) => { calls.push({ url, opts }); return { status: 200, ok: true }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(APP.slice(start, end + marker.length), sandbox);
  return { sandbox, calls, store };
}

test('logged out, an authenticated fetch is skipped entirely', async () => {
  const { sandbox, calls } = loadSessionHelpers(false);
  const r = await sandbox.sgAuthedFetch('/api/auth/profile');
  assert.strictEqual(r, null);
  assert.strictEqual(calls.length, 0, 'no request should leave the browser');
});

test('logged in, the request goes out with credentials', async () => {
  const { sandbox, calls } = loadSessionHelpers(true);
  const r = await sandbox.sgAuthedFetch('/api/auth/profile');
  assert.ok(r);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].opts.credentials, 'include');
});

test('a 401 clears the hint so the app self-corrects after a stale flag', async () => {
  const { sandbox, calls, store } = loadSessionHelpers(true);
  sandbox.fetch = async (url, opts) => { calls.push({ url, opts }); return { status: 401 }; };
  const first = await sandbox.sgAuthedFetch('/api/bookings');
  assert.strictEqual(first, null);
  assert.strictEqual(store.sg_authed, undefined, 'hint must be cleared');

  // The next call is now suppressed rather than repeating the 401.
  const before = calls.length;
  await sandbox.sgAuthedFetch('/api/bookings');
  assert.strictEqual(calls.length, before, 'must not retry a known-dead session');
});

test('sgHasSession falls back to state.user when localStorage is unavailable', () => {
  const { sandbox } = loadSessionHelpers(false);
  assert.strictEqual(sandbox.sgHasSession(), false);
  sandbox.state.user = { id: 7 };
  assert.strictEqual(sandbox.sgHasSession(), true);
});

test('a thrown localStorage never breaks the app', () => {
  const { sandbox } = loadSessionHelpers(false);
  sandbox.localStorage.getItem = () => { throw new Error('SecurityError'); };
  assert.doesNotThrow(() => sandbox.sgHasSession());
  assert.doesNotThrow(() => sandbox.sgSetSession(true));
});

// ─── 3. the hint is actually wired to the auth lifecycle ─────────────────────

test('every login success sets the session hint', () => {
  const sets = APP.match(/sgSetSession\(true\)/g) || [];
  assert.strictEqual(sets.length, 4, 'all four login paths must set the hint');
});

test('logout clears the session hint', () => {
  assert.match(APP, /state\.user=null;sgSetSession\(false\);/);
});

// ─── 4. the specific logged-out callers are gated ────────────────────────────

test('/api/bookings catch-up is gated behind a session', () => {
  const b2 = read('batch2.js');
  assert.match(b2, /if\(window\.sgHasSession&&!window\.sgHasSession\(\)\)return;\s*\n\s*fetch\('\/api\/bookings'/);
});

test('/api/gym-partner/dashboard lookup is gated behind a session', () => {
  const b2 = read('batch2.js');
  assert.match(b2, /if\(window\.sgHasSession&&!window\.sgHasSession\(\)\)return null;/);
});

test('/api/auth/profile GET goes through sgAuthedFetch', () => {
  assert.match(APP, /await sgAuthedFetch\('\/api\/auth\/profile'\)/);
  // The bare, ungated GET must be gone.
  assert.doesNotMatch(APP, /await fetch\('\/api\/auth\/profile'\);/);
});

test('scansquad gates its own membership call without depending on the app bundle', () => {
  const ss = read('scansquad/index.html');
  // The page does not load app.ctr576.js, so window.sgHasSession would be
  // undefined there and a window-based guard would silently never fire.
  assert.strictEqual(ss.includes('app.ctr576.js'), false);

  // This used to assert the literal source shape
  //   `localStorage.getItem('sg_authed') !== '1') return;`
  // which #630 deliberately removed: that early return left render() uncalled,
  // so every signed-out visitor got a blank page instead of the join screen.
  // The assertion outlived the code it described and failed for four PRs. What
  // matters is the behaviour — gate the fetch, and still reach the join screen
  // when signed out — so assert that instead, plus a guard against the early
  // return coming back.
  const start = ss.indexOf('async function checkAuth()');
  assert.notStrictEqual(start, -1, 'checkAuth missing');
  const joinIdx = ss.indexOf("state.screen = 'join'", start);
  assert.notStrictEqual(joinIdx, -1, 'signed-out visitors must fall through to the join screen');
  const region = ss.slice(start, joinIdx);

  // The hint is read directly, not through the app bundle's helper.
  assert.match(region, /localStorage\.getItem\('sg_authed'\)/);
  // The membership call happens only on the authed branch...
  assert.match(region, /if\s*\(\s*authed\s*\)/);
  // ...and the read precedes it, so no request can leave before the gate.
  assert.ok(
    region.indexOf("localStorage.getItem('sg_authed')") <
      region.indexOf("fetch('/api/creators/membership'"),
    'guard must precede the fetch'
  );
  // The #630 regression: bailing out on a missing hint skips render().
  assert.doesNotMatch(
    region, /sg_authed'\)\s*!==\s*'1'\s*\)\s*return/,
    'do not early-return on a missing session hint — it leaves render() uncalled'
  );
});

test('_partnerLoadGymProfile bails out before requesting a partner dashboard', () => {
  // Fires on a timer whenever #partner-profile-page exists, including for
  // signed-out visitors. This was the last 401 left on /partner.
  assert.match(APP, /window\._partnerLoadGymProfile=async function\(\)\{[\s\S]{0,400}?if\(!sgHasSession\(\)\) return;/);
});
