/**
 * Code the server imports from the browser bundle must resolve in the image
 * it actually ships in.
 *
 * The pricing fix introduced one shared implementation of the pass maths,
 * `frontend/public/pass-math.js`, imported by the browser via a <script> tag
 * and by the server via `require('../../frontend/public/pass-math.js')`. That
 * path holds in a developer checkout and in the Docker *test* stage, which
 * copies `server/` and `frontend/` side by side — so `npm test` was green, CI
 * was green, and the build was green. The runtime stage flattens the tree:
 *
 *     COPY server/           ./          →  /app/lib, /app/routes, /app/server.js
 *     COPY frontend/public/  ./public/   →  /app/public/pass-math.js
 *
 * `/app/lib/../../frontend/public/pass-math.js` has never existed, so the
 * container threw MODULE_NOT_FOUND on boot, the healthcheck never passed, and
 * the deploy failed. Nothing in the suite exercised the packaged layout.
 *
 * Three things have to hold, so all three are tested:
 *   1. no server file reaches into frontend/ with a raw relative require
 *   2. the resolver knows about the layout the Dockerfile actually produces
 *   3. the consumers boot inside a simulated runtime image
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const { SHARED_DIRS, requireShared } = require('../server/lib/require-shared');

/** Every .js file under server/, excluding dependencies. */
function serverFiles(dir = SERVER, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) serverFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no server file requires frontend code by raw relative path', () => {
  const offenders = [];
  const resolver = path.join(SERVER, 'lib', 'require-shared.js');
  for (const file of serverFiles()) {
    if (file === resolver) continue; // its header quotes the broken require on purpose
    const src = fs.readFileSync(file, 'utf8');
    const re = /require\(\s*['"]([^'"]*\.\.\/frontend\/[^'"]*)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      offenders.push(`${path.relative(ROOT, file)} → ${m[1]}`);
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'these requires break in the runtime image (frontend/ is not copied there); ' +
      `use requireShared() from server/lib/require-shared.js:\n  ${offenders.join('\n  ')}`
  );
});

test('the resolver covers the layout the Dockerfile produces', () => {
  const stages = DOCKERFILE.split(/^FROM /m);
  const runtime = stages[stages.length - 1];
  assert.match(runtime, /COPY server\/ \.\/\n?/, 'server/ is expected at /app');
  const copy = runtime.match(/COPY frontend\/public\/ \.\/([\w.-]+)\//);
  assert.ok(copy, 'the runtime stage must copy frontend/public/ somewhere');
  // require-shared.js lives at /app/lib, so the image path is ../<dest>.
  const expected = `../${copy[1]}`;
  assert.ok(
    SHARED_DIRS.includes(expected),
    `Dockerfile puts shared browser modules at /app/${copy[1]}, but SHARED_DIRS ` +
      `is ${JSON.stringify(SHARED_DIRS)} — add ${JSON.stringify(expected)}`
  );
});

test('the resolver finds the shared maths in this checkout', () => {
  const M = requireShared('pass-math.js');
  assert.strictEqual(typeof M.PASS_MULTIPLIERS, 'object');
  assert.strictEqual(M.PASS_MULTIPLIERS.day, 1.0);
  assert.throws(() => requireShared('not-a-real-shared-module.js'), /not found/);
});

test('the pricing engine boots in a simulated runtime image', () => {
  // Rebuild the runtime layout the Dockerfile produces: server/ at the root,
  // frontend/public/ at ./public. This is the layout that crashed.
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'scangym-image-'));
  try {
    fs.cpSync(SERVER, app, {
      recursive: true,
      filter: (src) => !src.split(path.sep).includes('node_modules'),
    });
    fs.cpSync(path.join(ROOT, 'frontend/public'), path.join(app, 'public'), {
      recursive: true,
      // Only the shared modules matter here; skip the heavy media tree.
      filter: (src) => fs.statSync(src).isDirectory() || src.endsWith('.js'),
    });
    // Dependencies are installed at the image root; point node at the real ones.
    fs.symlinkSync(path.join(SERVER, 'node_modules'), path.join(app, 'node_modules'), 'dir');

    const probe = [
      "const p = require('./lib/pricing-engine');",
      "const r = p.calculatePrice({ countryCode: 'GB', passType: 'weekly' });",
      'if (!r || typeof r.amount !== "number") { throw new Error("no price"); }',
      'process.stdout.write(String(r.amount));',
    ].join('\n');
    const out = execFileSync(process.execPath, ['-e', probe], { cwd: app, encoding: 'utf8' });
    assert.ok(Number(out) > 0, `expected a price from the packaged layout, got "${out}"`);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});
