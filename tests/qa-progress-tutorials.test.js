/**
 * Follow-up to the live customer walk-through: three defects that only became
 * visible once inline scripts actually ran (PR #1004 made them run).
 *
 *   1. The Equipment Tutorials row built `navigate('/tutorials/x'' )` — the
 *      escaped quotes inside the nested string collapsed, so the whole inline
 *      script was a syntax error and the page stayed on "Loading...". The row
 *      now uses HTML entities inside the attribute, which survive both layers.
 *   2. ai-features.js declared its own `optionalAuth` stub that set nothing, so
 *      `req.user` was always undefined and GET /api/ai/progress returned 401
 *      "Login required" to every signed-in member.
 *   3. A 401 or 500 is not a thrown error, so the Progress page rendered
 *      "undefined Sessions" instead of an empty state.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('frontend/public/app.ctr576.js');
const AI = read('server/routes/ai-features.js');

test('the tutorials row does not nest raw quotes inside its onclick', () => {
  assert.ok(
    !APP.includes("navigate(\\'/tutorials/"),
    'the escaped-quote form is back — it collapses and breaks the whole inline script'
  );
  assert.ok(
    APP.includes('navigate(&#39;/tutorials/'),
    'the tutorials row lost its navigate handler'
  );
});

test('the progress endpoint reads the session instead of a do-nothing stub', () => {
  assert.ok(
    /const \{ optionalAuth \} = require\('\.\.\/middleware\/auth'\)/.test(AI),
    'ai-features.js is back to a local optionalAuth stub; req.user will always be undefined'
  );
  assert.ok(
    /router\.get\('\/progress', optionalAuth,/.test(AI),
    '/progress must run the session middleware or it answers 401 to signed-in members'
  );
  assert.ok(
    !/function optionalAuth\(req, res, next\) \{\s*\/\/ Simplified/.test(AI),
    'the stub middleware is back'
  );
});

test('progress and tutorials show an empty state instead of undefined or Loading', () => {
  assert.ok(
    APP.includes('No workouts logged yet'),
    'a non-OK /api/ai/progress response renders "undefined Sessions" again'
  );
  assert.ok(
    APP.includes('Equipment guides are unavailable right now'),
    'a failed tutorials fetch leaves the page on "Loading..." again'
  );
});

test('one broken inline script cannot stop the others from running', () => {
  const at = APP.indexOf("querySelectorAll('#app script')");
  assert.ok(at > 0, 'inline script hydration is gone');
  const block = APP.slice(at, at + 600);
  assert.ok(
    block.includes('try{') && block.includes('inline script failed to run'),
    'hydration must guard each script individually'
  );
});
