/**
 * The ScanSquad rail offers eight Create modes, but only the ones with a
 * route AND a provider key can actually run. The bug class these tests guard
 * against is the one this feature has already shipped twice: a control that
 * looks live and does nothing (settings that were sent nowhere, a Generate
 * whose body was never parsed).
 *
 * So the invariants are:
 *  1. The server, not the sheet, decides which modes are usable.
 *  2. A mode with no route is never reported as configured, whatever env
 *     vars happen to be set.
 *  3. A mode with a route but no provider key is never reported as
 *     configured either, and says which of the two is missing.
 *  4. The frontend never enables Generate for a mode the server refused,
 *     and never posts to a mode with no endpoint.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const ROUTE = path.join(ROOT, 'server', 'routes', 'squad-create');
const SHEET = path.join(ROOT, 'frontend', 'public', 'squad-create.js');

/** Run the /modes handler in isolation and capture what it would send. */
function getModes() {
  delete require.cache[require.resolve(ROUTE)];
  const router = require(ROUTE);
  const layer = router.stack.find(l => l.route && l.route.path === '/modes');
  assert.ok(layer, '/modes route is not registered');
  let payload = null;
  layer.route.stack[0].handle({}, { json: d => { payload = d; } });
  return payload.modes;
}

test('every one of the eight modes is reported', () => {
  const modes = getModes();
  for (const key of ['text', 'image', 'video', 'audio', 'music', 'twin', 'clipping', 'ugc']) {
    assert.ok(modes[key], `mode ${key} missing from the registry`);
  }
});

test('a mode with no route is never configured, even with a key set', () => {
  process.env.SQUAD_TEXT_API_KEY = 'pretend-this-exists';
  try {
    const modes = getModes();
    assert.equal(modes.text.configured, false);
    assert.equal(modes.text.reason, 'not_built');
    assert.equal(modes.text.api, null);
  } finally {
    delete process.env.SQUAD_TEXT_API_KEY;
  }
});

test('a built mode with no provider key is not configured, and says so', () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const modes = getModes();
    assert.equal(modes.video.configured, false);
    assert.equal(modes.video.reason, 'no_provider');
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test('a built mode with a provider key is configured and exposes its route', () => {
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
  const modes = getModes();
  assert.equal(modes.video.configured, true);
  assert.equal(modes.video.api, '/api/squad-video');
});

test('the sheet asks the server before enabling anything', () => {
  const src = fs.readFileSync(SHEET, 'utf8');
  assert.match(src, /\/api\/squad-create\/modes/, 'sheet never queries the mode registry');
  // Generate starts disabled and is only released inside the gate.
  assert.match(src, /gen\.disabled = true; \/\/ stays disabled/, 'Generate does not start disabled');
  assert.match(src, /if \(!isConfigured\(mode\)\)/, 'sheet does not gate on the server answer');
});

test('generation refuses to fire for a mode with no endpoint', () => {
  const src = fs.readFileSync(SHEET, 'utf8');
  const start = src.indexOf('function startJob');
  assert.ok(start > -1, 'startJob missing');
  const body = src.slice(start, start + 400);
  assert.match(body, /if \(!isConfigured\(mode\) \|\| !mode\.api\) return;/,
    'startJob can be entered for an unconfigured or endpoint-less mode');
});

test('the mount gives squad-create its own body parser', () => {
  // Lesson from the /api/squad-video outage: routes outside the apiPaths
  // allowlist get no express.json(), so req.body is undefined.
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  assert.match(server, /app\.use\('\/api\/squad-create', express\.json\([^)]*\), squadCreateRouter\)/,
    'squad-create is mounted without its own JSON parser');
});
