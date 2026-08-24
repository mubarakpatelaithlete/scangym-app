/**
 * The patch chain must stay consistent between index.html and the build.
 *
 * index.html loaded 20 deferred scripts. Ten are the historical "patch pile"
 * (app-patches, round2..round5, ui-polish, phase2-improvements, tabs-v4,
 * continue-cta-flow) — each monkey-patches the app after it boots, so their
 * execution order is load-bearing: a patch that runs before the thing it
 * patches silently does nothing.
 *
 * build.js concatenates them into one artifact in index.html's order. The
 * danger is drift: someone adds an 11th patch script to index.html and the
 * build quietly leaves it out, or reorders it. These tests fail loudly instead.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'frontend', 'public');
const BUILD = fs.readFileSync(path.join(ROOT, 'server', 'build.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');

/** The ordered list build.js will concatenate. */
function patchChain() {
  const m = BUILD.match(/const PATCH_CHAIN = \[([\s\S]*?)\];/);
  assert.ok(m, 'PATCH_CHAIN missing from build.js');
  const sandbox = {};
  vm.createContext(sandbox);
  // Spread into a native array: values built inside a vm context carry that
  // realm's Array prototype, which deepStrictEqual treats as a difference.
  return [...vm.runInContext(`[${m[1]}]`, sandbox)];
}

/** Deferred scripts in index.html, in document order. */
function indexScripts() {
  return [...INDEX.matchAll(/<script\s+src="\/([^"?]+)(?:\?[^"]*)?"\s+defer><\/script>/g)].map(
    (x) => x[1]
  );
}

test('every file in the patch chain exists', () => {
  for (const name of patchChain()) {
    assert.ok(fs.existsSync(path.join(PUB, name)), `${name} is in PATCH_CHAIN but not on disk`);
  }
});

test('the patch chain matches index.html order exactly', () => {
  const chain = patchChain();
  const listed = indexScripts().filter((f) => chain.includes(f));
  assert.deepStrictEqual(
    listed,
    chain,
    'build.js would concatenate these in a different order than the browser runs them'
  );
});

test('the patch chain is contiguous in index.html', () => {
  // If a non-patch script were interleaved, merging would move code across it
  // and change execution order.
  const listed = indexScripts();
  const chain = patchChain();
  const positions = chain.map((f) => listed.indexOf(f));
  for (let i = 1; i < positions.length; i++) {
    assert.strictEqual(
      positions[i],
      positions[i - 1] + 1,
      `${chain[i]} is not immediately after ${chain[i - 1]} in index.html`
    );
  }
});

test('no patch script uses document.currentScript', () => {
  // currentScript resolves to the bundle after merging, silently changing meaning.
  for (const name of patchChain()) {
    const body = fs.readFileSync(path.join(PUB, name), 'utf8');
    assert.strictEqual(
      /document\.currentScript/.test(body),
      false,
      `${name} relies on document.currentScript and cannot be safely merged`
    );
  }
});

test('every patch script parses on its own', () => {
  for (const name of patchChain()) {
    const body = fs.readFileSync(path.join(PUB, name), 'utf8');
    assert.doesNotThrow(() => new vm.Script(body), `${name} has a syntax error`);
  }
});

test('the concatenated chain parses as one script', () => {
  // A file ending in an expression must not fuse with the next one. build.js
  // prefixes each part with a semicolon; this proves the result is valid.
  const merged = patchChain()
    .map((n) => `/* ${n} */\n;${fs.readFileSync(path.join(PUB, n), 'utf8')}\n`)
    .join('\n');
  assert.doesNotThrow(() => new vm.Script(merged), 'merged patch chain does not parse');
});

test('build.js fails loudly rather than silently dropping a patch', () => {
  assert.match(BUILD, /PATCH_CHAIN does not match index\.html order/);
  assert.match(BUILD, /process\.exit\(1\)/);
});

test('the merged bundle is content-hashed for cache busting', () => {
  const m = BUILD.match(/const ASSETS_TO_HASH = \[([\s\S]*?)\];/);
  assert.ok(m, 'ASSETS_TO_HASH missing');
  assert.match(m[1], /'sg-patches\.js'/, 'sg-patches.js must be hashed or clients will cache it forever');
});
