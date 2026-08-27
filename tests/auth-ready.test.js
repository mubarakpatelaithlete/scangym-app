/**
 * The session question must be answered once, and announced.
 *
 * Measured live on /partner/, logged out, 4x CPU throttle: the tab painted a
 * placeholder card at 1.1s and then sat unchanged until 6.4s, with zero network
 * activity in between. It was not a slow API — it was a timer. partner-editable
 * could not tell "logged out" from "auth still in flight", because the app
 * bundle's checkAuth() sets state.user on success and says nothing on failure.
 * So it guessed, with a ladder of 12 x 400ms retries = 4.8s, before deciding to
 * render the logged-out Partner page.
 *
 * The fix is a signal, not a shorter guess: checkAuth() now publishes
 * window.__sgAuthReady (a promise that always resolves) and
 * window.__sgAuthResolved (its synchronous form). Consumers await the answer.
 *
 * These tests pin the contract on both sides, and pin the behaviour of the
 * consumer by running the real script against a stub DOM.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');
const APP = read('app.ctr576.js');
const PE = read('partner-editable.js');

// ─── 1. the producer side ────────────────────────────────────────────────────

test('the app bundle publishes __sgAuthReady and __sgAuthResolved', () => {
  assert.match(APP, /window\.__sgAuthResolved\s*=\s*false/);
  assert.match(APP, /window\.__sgAuthReady\s*=\s*checkAuth\(\)/);
  assert.match(APP, /window\.__sgAuthResolved\s*=\s*true/);
});

test('checkAuth is only called once, through the signal', () => {
  const calls = APP.match(/^\s*(window\.__sgAuthReady\s*=\s*)?checkAuth\(\);?/gm) || [];
  assert.equal(calls.length, 1, 'checkAuth() must run exactly once');
});

test('the promise can never reject, so awaiting it can never hang a tab', () => {
  // checkAuth swallows its own errors, and the .then adds no throwing work.
  const body = APP.slice(APP.indexOf('async function checkAuth'));
  assert.match(body.slice(0, 400), /catch\(e\)\s*\{\s*\}/);
});

// ─── 2. the consumer side ────────────────────────────────────────────────────

test('partner-editable awaits the signal instead of laddering', () => {
  assert.match(PE, /await window\.__sgAuthReady/);
  // the old ladder survives only as a fallback for a stale cached bundle
  const ladder = /if\(!window\.__sgAuthReady&&_peAuthRetries<12\)/;
  assert.match(PE, ladder);
});

// ─── 3. what the visitor actually experiences ────────────────────────────────

/**
 * Runs the real partner-editable.js against a stub DOM and reports how much
 * simulated time passes before the logged-out Partner page renders.
 */
function runPartner({ publishSignal, authDelayMs }) {
  let now = 0;
  const timers = [];
  const el = () => new Proxy(function () {}, {
    get(t, k) {
      if (k === Symbol.toPrimitive || k === 'toString') return () => '';
      if (k === 'children' || k === 'childNodes') return [];
      return el();
    },
    set() { return true; },
    apply() { return el(); },
    has() { return true; },
  });
  const win = {
    location: { pathname: '/partner/', href: 'https://scangym.com/partner/', search: '' },
    addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console,
  };
  win.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const sandbox = {
    window: win, self: win, console, fetch: win.fetch,
    document: new Proxy({}, {
      get(t, k) {
        if (k === 'querySelectorAll') return () => [];
        if (k === 'querySelector' || k === 'getElementById') return () => null;
        if (k === 'readyState') return 'complete';
        if (k === 'head' || k === 'body' || k === 'documentElement') return el();
        return () => el();
      },
    }),
    state: { user: null, route: '/partner/' },
    setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
    setInterval: () => 0, clearInterval: () => {}, clearTimeout: () => {},
    requestAnimationFrame: (fn) => { timers.push({ at: now + 16, fn }); },
    requestIdleCallback: (fn) => { timers.push({ at: now + 50, fn }); },
    navigator: { userAgent: 'node' },
    __now: () => now,
  };
  sandbox.Event = function () {};
  win.setTimeout = sandbox.setTimeout;
  vm.createContext(sandbox);
  if (publishSignal) {
    win.__sgAuthResolved = false;
    win.__sgAuthReady = new Promise((res) => {
      timers.push({ at: authDelayMs, fn: () => { win.__sgAuthResolved = true; res(); } });
    });
  }
  // Wrap the real render entry point from inside the script's own scope, so we
  // observe the actual decision rather than a copy of the logic.
  // The script is one big IIFE, so the probe has to be injected inside it,
  // just before the closing "})();", to see the function-scoped renderer.
  const EPILOGUE = ';_peRenderCards=function(){'
    + 'if(window.__peRenderedAt==null)window.__peRenderedAt=__now();};';
  const close = PE.lastIndexOf('})();');
  assert.ok(close > 0, 'partner-editable.js should still be a single IIFE');
  const instrumented = PE.slice(0, close) + EPILOGUE + PE.slice(close);
  vm.runInContext(instrumented, sandbox, { filename: 'partner-editable.js' });
  assert.equal(typeof win._peLoadAndRender, 'function', 'entry point must be exported');
  win._peLoadAndRender();
  return {
    // Drains simulated time, letting awaited promises settle between timers.
    async drain(limitMs) {
      for (let i = 0; i < 400 && win.__peRenderedAt == null; i++) {
        await new Promise((r) => setImmediate(r));
        timers.sort((a, b) => a.at - b.at);
        const t = timers.shift();
        if (!t) { now += 100; if (now > limitMs) break; continue; }
        now = Math.max(now, t.at);
        if (now > limitMs) break;
        t.fn();
      }
      await new Promise((r) => setImmediate(r));
      return win.__peRenderedAt;
    },
  };
}

test('logged-out Partner page renders as soon as the session answer arrives', async () => {
  const at = await runPartner({ publishSignal: true, authDelayMs: 600 }).drain(20000);
  assert.notEqual(at, null, 'the logged-out Partner page must render');
  assert.ok(at <= 700, `expected render at the auth answer (~600ms), got ${at}ms`);
});

test('a stale cached bundle without the signal still recovers via the ladder', async () => {
  const at = await runPartner({ publishSignal: false, authDelayMs: 600 }).drain(20000);
  assert.notEqual(at, null, 'the fallback must still terminate');
  assert.ok(at >= 4000 && at <= 5200,
    `fallback ladder should land near 4.8s, got ${at}ms`);
});

test('the fix is a signal, not merely a shorter guess', () => {
  // A shortened ladder would be a regression risk for slow sessions: it would
  // render the logged-out page over a logged-in owner's dashboard.
  const ladders = PE.match(/_peAuthRetries<(\d+)/g) || [];
  assert.ok(ladders.length > 0);
  assert.ok(PE.includes('await window.__sgAuthReady'),
    'the primary path must await the real answer');
});
