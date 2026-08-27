/**
 * The lazy chunks must stay loadable, and core must stay split.
 *
 * app.ctr576.js shipped every tab's code to every visitor. The ScanSquad area
 * now lives in sg-scansquad.js, fetched by sg-chunk-loader.js when a ScanSquad
 * route renders and prefetched at idle otherwise.
 *
 * Three ways this silently breaks, one test each:
 *
 *  1. A page function moves to a chunk but its route is missing from
 *     _sgChunkForView(), so navigating there calls an undefined global.
 *  2. Someone edits a moved function back into app.ctr576.js, so the same
 *     global is declared twice and the chunk copy wins by load order — or the
 *     bundle quietly grows back to where it started.
 *  3. The loader stops being loaded before the app bundle, so sgChunkReady is
 *     undefined at first render and the gate is skipped.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');

const APP = read('app.ctr576.js');
const LOADER = read('sg-chunk-loader.js');
const CHUNK = read('sg-scansquad.js');
const INDEX = read('index.html');

// Every page function the chunk owns, i.e. every function _renderInner() calls
// expecting an HTML string back. Must match `pages` in tools/split-bundle.js.
const CHUNK_PAGES = [
  'CreatorsPage', 'CreatorFullPage', 'CreatorDashboardPage',
  'CreatorEarningsPage', 'CreatorSignedOutPage', 'CreatorReelsPage',
];

/* ── 1. the chunk really is out of core, and complete ─────────────────────── */

test('every chunk page function is declared in the chunk, not in core', () => {
  for (const name of CHUNK_PAGES) {
    assert.match(CHUNK, new RegExp(`function ${name}\\s*\\(`),
      `${name} must be defined in sg-scansquad.js`);
    assert.doesNotMatch(APP, new RegExp(`^function ${name}\\s*\\(`, 'm'),
      `${name} must not be declared in app.ctr576.js — it would shadow the chunk`);
  }
});

test('core carries a loading stub for each chunk function it still calls', () => {
  // These are called directly by code that stayed in core, so they must exist
  // as stubs rather than as nothing at all.
  for (const name of ['_loadCreatorEarnings', '_loadCreatorFullPage', '_loadCreatorAnalytics']) {
    assert.match(APP, new RegExp(`window\\.${name}\\s*=\\s*sgChunkStub\\('sg-scansquad','${name}'\\)`),
      `${name} needs a core stub`);
    assert.match(CHUNK, new RegExp(`\\b${name}\\b`), `${name} must exist in the chunk`);
  }
});

test('the dead duplicate TrainerTabPage is gone', () => {
  const hits = APP.match(/^function TrainerTabPage\s*\(/gm) || [];
  assert.strictEqual(hits.length, 1,
    'TrainerTabPage was declared twice; the earlier copy was unreachable dead code');
});

/* ── 2. every chunk route is gated ────────────────────────────────────────── */

test('_sgChunkForView covers every route that renders a chunk page', () => {
  // Pull the gate out of the bundle and run it in isolation.
  const start = APP.indexOf('function _sgChunkForView(');
  assert.notStrictEqual(start, -1, '_sgChunkForView missing');
  const end = APP.indexOf('\nfunction _renderInner(', start);
  assert.notStrictEqual(end, -1);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(APP.slice(start, end) + ';this.gate=_sgChunkForView;', sandbox);
  const gate = sandbox.gate;

  // Each route _renderInner dispatches to a chunk page, taken from the source.
  const routes = [
    '/creators', '/scansquad', '/scansquad/', '/creator', '/creator/',
    '/creator-hub', '/creator-earnings', '/creator-reels',
    '/become-a-creator', '/become-creator', '/upload', '/be',
  ];
  for (const r of routes) {
    assert.strictEqual(gate(r, 'book'), 'sg-scansquad', `${r} must be gated on the chunk`);
  }
  // The tab-based dispatch (tab==='creator' renders CreatorFullPage) too.
  assert.strictEqual(gate('/', 'creator'), 'sg-scansquad');
  // And routes that own nothing in the chunk must not pay for it.
  for (const r of ['/', '/explore', '/nearby', '/partner', '/more/profile', '/checkout']) {
    assert.strictEqual(gate(r, 'book'), '', `${r} must not wait on a chunk`);
  }
});

test('no route renders a chunk page without the gate naming that route', () => {
  // Find `path==='/x'` comparisons on lines that call a chunk page, and check
  // the gate claims each one. Catches a new ScanSquad route added to
  // _renderInner but forgotten in _sgChunkForView.
  const start = APP.indexOf('function _renderInner(');
  const body = APP.slice(start);
  const start2 = APP.indexOf('function _sgChunkForView(');
  const end2 = APP.indexOf('\nfunction _renderInner(', start2);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(APP.slice(start2, end2) + ';this.gate=_sgChunkForView;', sandbox);

  const missing = [];
  for (const line of body.split('\n')) {
    if (!CHUNK_PAGES.some((p) => line.includes(p + '()'))) continue;
    for (const m of line.matchAll(/path==='([^']+)'/g)) {
      if (sandbox.gate(m[1], 'book') !== 'sg-scansquad') missing.push(m[1]);
    }
  }
  assert.deepStrictEqual(missing, [],
    `these routes render a chunk page but are not gated: ${missing}`);
});

/* ── 3. the loader is present, ordered, and side-effect free ──────────────── */

test('the loader is loaded before the app bundle', () => {
  // Compare <script> tags only. index.html also has a <link rel=preload> for
  // the app bundle much earlier in <head>, which says nothing about execution
  // order — an earlier version of this test compared raw indexOf and failed on
  // the preload.
  const tag = (file) => {
    const m = INDEX.match(new RegExp(`<script src="/${file.replace(/\./g, '\\.')}(\\?[^"]*)?" defer></script>`));
    assert.ok(m, `${file} must be a deferred script tag in index.html`);
    return INDEX.indexOf(m[0]);
  };
  // Both plain deferred tags, so document order is execution order.
  assert.ok(tag('sg-chunk-loader.js') < tag('app.ctr576.js'),
    'the loader must come first — app.ctr576.js calls sgChunkReady() on first render');
});

test('the loader exposes its API and fetches a chunk at most once', async () => {
  const scripts = [];
  const sandbox = {
    console: { warn() {}, log() {} },
    document: {
      readyState: 'loading',
      createElement: () => ({ set src(v) { this._src = v; }, get src() { return this._src; } }),
      head: { appendChild(s) { scripts.push(s); setTimeout(() => s.onload(), 0); } },
      body: { appendChild() {} },
      getElementById: () => null,
    },
    window: {},
    setTimeout,
    requestAnimationFrame: (f) => f(),
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LOADER, sandbox);

  for (const fn of ['sgChunk', 'sgChunkReady', 'sgOnChunk', 'sgChunkStub', 'sgPrefetchChunks']) {
    assert.strictEqual(typeof sandbox.window[fn], 'function', `${fn} must be exposed`);
  }

  assert.strictEqual(sandbox.window.sgChunkReady('sg-scansquad'), false);
  // Concurrent callers share one request.
  const [a, b] = await Promise.all([
    sandbox.window.sgChunk('sg-scansquad'),
    sandbox.window.sgChunk('sg-scansquad'),
  ]);
  assert.strictEqual(a, true);
  assert.strictEqual(b, true);
  assert.strictEqual(scripts.length, 1, 'a chunk must be fetched only once');
  assert.strictEqual(sandbox.window.sgChunkReady('sg-scansquad'), true);
  // And a later caller does not refetch.
  await sandbox.window.sgChunk('sg-scansquad');
  assert.strictEqual(scripts.length, 1);
});

test('a chunk URL comes from the injected manifest when there is one', async () => {
  const scripts = [];
  const sandbox = {
    console: { warn() {} },
    document: {
      readyState: 'complete',
      createElement: () => ({}),
      head: { appendChild(s) { scripts.push(s); setTimeout(() => s.onload(), 0); } },
      body: { appendChild() {} },
      getElementById: () => null,
    },
    window: { __sgChunks: { 'sg-scansquad': '/sg-scansquad.abcd1234.js' } },
    setTimeout,
    requestAnimationFrame: (f) => f(),
    addEventListener() {},
  };
  Object.assign(sandbox, sandbox.window);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LOADER, sandbox);
  await sandbox.window.sgChunk('sg-scansquad');
  assert.strictEqual(scripts[0].src, '/sg-scansquad.abcd1234.js',
    'must use the content-hashed URL so the chunk can be cached immutably');
});

test('a failed chunk load resolves false and can be retried', async () => {
  let attempts = 0;
  const sandbox = {
    console: { warn() {} },
    document: {
      readyState: 'complete',
      createElement: () => ({}),
      head: {
        appendChild(s) {
          attempts++;
          setTimeout(() => (attempts === 1 ? s.onerror() : s.onload()), 0);
        },
      },
      body: { appendChild() {} },
      getElementById: () => null,
    },
    window: {},
    setTimeout,
    requestAnimationFrame: (f) => f(),
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(LOADER, sandbox);

  assert.strictEqual(await sandbox.window.sgChunk('sg-scansquad'), false,
    'a failed load must resolve false, never reject');
  assert.strictEqual(sandbox.window.sgChunkReady('sg-scansquad'), false);
  assert.strictEqual(await sandbox.window.sgChunk('sg-scansquad'), true,
    'a failure must not be cached — the next navigation retries');
  assert.strictEqual(attempts, 2);
});

/* ── 4. size budget ───────────────────────────────────────────────────────── */

test('core stays under its size budget', () => {
  // Source bytes, pre-minification, so the number is stable and reviewable.
  // Before the split app.ctr576.js was 1,668,000 bytes. The budget is the
  // measured size plus ~2% headroom: it is here to catch a whole tab being
  // pasted back into core, not to police ordinary edits. If you add a feature
  // and this fails, raise it in the same commit and say why in the message.
  const CORE_BUDGET = 1_450_000;
  const size = Buffer.byteLength(APP);
  assert.ok(size < CORE_BUDGET,
    `app.ctr576.js is ${size} bytes, over the ${CORE_BUDGET} budget. ` +
    'Did a lazy area get merged back in? See tools/split-bundle.js.');
});

test('the chunk is worth splitting and is not empty', () => {
  const size = Buffer.byteLength(CHUNK);
  assert.ok(size > 100_000, `sg-scansquad.js is only ${size} bytes — did the split run?`);
});

test('the chunk declares no globals core also declares', () => {
  // Both files are plain scripts sharing one global scope, so a name declared
  // in both means the chunk silently overwrites core on load.
  const chunkFns = [...CHUNK.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
  assert.ok(chunkFns.length > 5, 'expected the chunk to declare several functions');
  for (const name of chunkFns) {
    assert.doesNotMatch(APP, new RegExp(`^function ${name}\\s*\\(`, 'm'),
      `${name} is declared in both core and the chunk`);
  }
});
