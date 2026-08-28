/**
 * Two round trips stood between a logged-out visitor and the Partner page.
 *
 * 1. A detour. express.static was mounted with index:false, which stops it
 *    serving a directory's index.html but NOT its 301 directory redirect. So
 *    /partner answered "301 -> /partner/" — measured live at 4x CPU throttle,
 *    85ms of pure round trip (LCP 1188ms on /partner vs 1088ms on /partner/).
 *    The same detour hit /creator, /join, /about, /privacy, /admin, /team,
 *    /scansquad and /upload, and it also shadowed the explicit app.get()
 *    handlers for those paths, which are registered after the static mount.
 *
 * 2. A question the server could already answer. partner-editable must not
 *    render the claim card until the session is known (that would wipe a real
 *    owner's dashboard), so it awaits __sgAuthReady — which waits for
 *    /api/auth/user. For a visitor with no session cookie the server knows the
 *    answer while it is writing the HTML: no req.session.userId => anonymous.
 *
 * These tests pin both fixes, and pin the safety property that matters more
 * than either: the fast path must never sign a logged-in owner out.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'app.ctr576.js'), 'utf8');

// ─── 1. the detour is gone ───────────────────────────────────────────────────

test('the frontend static mount disables directory redirects', () => {
  const mount = SERVER.slice(SERVER.indexOf('express.static(FRONTEND_DIR'));
  const opts = mount.slice(0, mount.indexOf('}));'));
  assert.match(opts, /redirect:\s*false/, 'express.static(FRONTEND_DIR) must set redirect:false');
  assert.match(opts, /index:\s*false/, 'index:false must stay — the SPA catch-all injects runtime config');
});

test('redirect:false really stops the 301 in the express version we ship', async () => {
  // Behavioural, not textual: prove the flag does what the comment claims,
  // against the installed serve-static, with a directory that exists.
  // Dependencies live in server/node_modules (see the Dockerfile test stage).
  const express = require(path.join(ROOT, 'server', 'node_modules', 'express'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-static-'));
  fs.mkdirSync(path.join(dir, 'partner'));
  fs.writeFileSync(path.join(dir, 'partner', 'index.html'), '<html>dir</html>');

  const app = express();
  app.use(express.static(dir, { index: false, redirect: false }));
  app.get('*', (req, res) => res.status(200).send('spa-shell'));
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const port = server.address().port;

  const get = (p) => new Promise((res) => {
    http.get({ port, path: p }, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => res({ status: r.statusCode, location: r.headers.location, body }));
    });
  });

  try {
    const bare = await get('/partner');
    assert.equal(bare.status, 200, `/partner must be answered directly, got ${bare.status} -> ${bare.location}`);
    assert.equal(bare.body, 'spa-shell', '/partner must fall through to the SPA catch-all');
    const slash = await get('/partner/');
    assert.equal(slash.status, 200);
    assert.equal(slash.body, 'spa-shell');
    const asset = await get('/partner/index.html');
    assert.equal(asset.status, 200, 'real files must still be served');
    assert.match(asset.body, /dir/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 2. the server answers the session question in the HTML ─────────────────

test('the SPA shell carries an auth hint only when there is no session', () => {
  const shell = SERVER.slice(SERVER.indexOf("app.get('*'"));
  assert.match(shell, /const isAnonymous = !\(req\.session && req\.session\.userId\)/);
  assert.match(shell, /window\.__sgAuthHint="anonymous"/);
  const hint = shell.slice(shell.indexOf('const authHint'), shell.indexOf('const perfHints'));
  assert.match(hint, /isAnonymous \?/, 'the hint must be conditional — a logged-in visitor gets none');
  assert.match(shell, /\$\{authHint\}/, 'the hint must actually be injected into the shell');
  // The hint is only safe because the shell is never cached by a CDN.
  assert.match(shell, /res\.setHeader\('Cache-Control', 'no-cache'\)/);
});

// ─── 3. the client fast path, and the safety net under it ───────────────────

/** Runs the real auth block from app.ctr576.js against a stub window. */
function runAuthBlock({ hint, authUser, fetchDelayMs = 300 }) {
  const start = APP.indexOf('// Check if user is already logged in');
  const end = APP.indexOf('// ─── State ───');
  assert.ok(start > 0 && end > start, 'the auth block must still be findable in app.ctr576.js');
  const snippet = APP.slice(start, end);

  let renders = 0;
  let partnerRenders = 0;
  const win = { __sgAuthHint: hint };
  const sandbox = {
    window: win,
    console,
    state: { user: null },
    render: () => { renders++; },
    Promise,
    Event: function () {},
    setTimeout,
    fetch: async () => {
      await new Promise((r) => setTimeout(r, fetchDelayMs));
      return { ok: !!authUser, status: authUser ? 200 : 401, json: async () => authUser || {} };
    },
  };
  win.dispatchEvent = () => {};
  win._peLoadAndRender = () => { partnerRenders++; };
  vm.createContext(sandbox);
  vm.runInContext(snippet, sandbox, { filename: 'app-auth-block.js' });
  return {
    win,
    state: sandbox.state,
    counts: () => ({ renders, partnerRenders }),
    settle: async () => {
      await new Promise((r) => setTimeout(r, fetchDelayMs + 50));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
  };
}

test('with the hint, a logged-out visitor never waits for /api/auth/user', async () => {
  const run = runAuthBlock({ hint: 'anonymous', authUser: null });
  assert.equal(run.win.__sgAuthResolved, true, 'the answer must be available synchronously');
  let resolvedImmediately = false;
  await Promise.race([
    run.win.__sgAuthReady.then(() => { resolvedImmediately = true; }),
    new Promise((r) => setImmediate(r)),
  ]);
  assert.ok(resolvedImmediately, '__sgAuthReady must already be resolved, not pending on the network');
  await run.settle();
  assert.equal(run.counts().renders, 0, 'no re-render for a genuinely logged-out visitor');
});

test('without the hint, nothing changes: the answer still waits for the check', async () => {
  const run = runAuthBlock({ hint: undefined, authUser: null });
  assert.equal(run.win.__sgAuthResolved, false, 'no hint means the question is still open');
  await run.settle();
  assert.equal(run.win.__sgAuthResolved, true, 'and it must be answered once the check returns');
});

test('a stale shell cannot sign an owner out: the check still runs and re-renders', async () => {
  // Worst case: service worker serves a cached shell that says "anonymous" to a
  // visitor who does have a session. Consumers render the logged-out view, then
  // the real check lands and we adopt the user.
  const run = runAuthBlock({ hint: 'anonymous', authUser: { id: 42, name: 'Owner' } });
  assert.equal(run.win.__sgAuthResolved, true);
  await run.settle();
  assert.equal(run.state.user && run.state.user.id, 42, 'the session must still be picked up');
  assert.ok(run.counts().renders >= 1, 'the app must re-render for the owner');
  assert.ok(run.counts().partnerRenders >= 1, 'the Partner dashboard must be rebuilt for the owner');
});

test('checkAuth still runs exactly once', () => {
  // The definition is `async function checkAuth()`; every other occurrence is a call.
  const calls = APP.match(/(?<!function )checkAuth\(\)/g) || [];
  assert.equal(calls.length, 1, 'the fast path must reuse the one in-flight check, not start a second');
});
