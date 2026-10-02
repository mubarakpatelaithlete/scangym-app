/**
 * Five defects found by walking the live app as a signed-in customer
 * (all 5 tabs, then all 70 routes the router can reach), 2026-10-02.
 *
 * Each one was invisible to the existing suite because the suite reads source
 * for patterns it already knows about. These pin the specific regressions:
 *
 *   1. /top-creators printed the literal text "${c.badge}" — a nested template
 *      literal whose inner placeholders were backslash-escaped, so they shipped
 *      as characters instead of values.
 *   2. The signed-in /login screen said "Logged in as null": it read
 *      state.user.phone, and email and Google accounts have no phone number.
 *   3. /progress and /tutorials sat on "Loading..." forever. Their fetch lived
 *      in an inline <script> inside a string assigned through innerHTML, and
 *      the HTML spec says such a script never executes. The fix re-creates
 *      every inline script after render, in the core render path, rather than
 *      rewriting each page.
 *   4. The Profile tab showed 0 sessions / 0 gyms to a member with real
 *      bookings: /api/auth/profile was only fetched on /more/profile, and two
 *      readers still expected camelCase where the API sends snake_case.
 *   5. Every Create tab load fired POST /api/v2/creator-apply, which has never
 *      existed server-side (server/routes/creators.js says so in a comment).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('frontend/public/app.ctr576.js');

test('the top creators leaderboard interpolates, it does not print ${c.badge}', () => {
  assert.ok(
    !APP.includes('\\${c.badge}') && !APP.includes('\\${c.name}'),
    'escaped placeholders are back in the leaderboard — they render as literal text'
  );
  assert.ok(APP.includes('${c.badge}'), 'the leaderboard template lost its badge placeholder');
});

test('the signed-in login screen names the member, never null', () => {
  const marker = 'Logged in as ${';
  const at = APP.indexOf(marker);
  assert.ok(at > 0, 'the signed-in login screen no longer greets the member');
  const expr = APP.slice(at + marker.length, APP.indexOf('}</p>', at));
  assert.ok(
    expr.includes('name') && expr.includes('email'),
    'the greeting reads only one identity field; phone-less accounts render "null"'
  );
});

test('inline scripts injected through innerHTML are re-executed after render', () => {
  assert.ok(
    /querySelectorAll\('#app script'\)/.test(APP),
    'the render path no longer hydrates inline scripts — string-built pages will hang on "Loading..."'
  );
  const hydrate = APP.slice(APP.indexOf("querySelectorAll('#app script')"));
  assert.ok(
    hydrate.includes("createElement('script')") && hydrate.includes('replaceChild'),
    'inline scripts must be re-created to run; copying the node is not enough'
  );
});

test('the profile screens load their stats, and read the shape the API sends', () => {
  assert.ok(
    /path==='\/more'\|\|path==='\/more\/profile'/.test(APP) && APP.includes('_sgProfileStatsLoaded'),
    'the Profile tab no longer fetches /api/auth/profile — stats fall back to 0'
  );
  assert.ok(
    !/u\.stats\?\.totalSessions\|\|0/.test(APP),
    'a stats reader expects camelCase; /api/auth/profile sends total_bookings / gyms_visited'
  );
});

test('nothing calls the creator-apply endpoint that never existed', () => {
  assert.ok(
    !/fetch\('\/api\/v2\/creator-apply'/.test(APP),
    'the dead /api/v2/creator-apply call is back — it 404s on every Create tab load'
  );
});

test('a booking confirmation without a reference offers a way out', () => {
  const at = APP.indexOf("We can't find that booking");
  assert.ok(at > 0, 'the empty state for a broken confirmation link is gone');
  const block = APP.slice(at, at + 1200);
  assert.ok(
    block.includes("navigate('/my-bookings')") && block.includes("navigate('/explore')"),
    'the empty state must offer bookings and search, not just an error line'
  );
});

test('a signed-in non-admin is told so, not sent back to the login screen', () => {
  assert.ok(
    APP.includes('No admin access on this account'),
    '/dashboard and /admin send signed-in members to /login, which tells them they are logged in'
  );
});

test('the password step offers the email-code route that actually works', () => {
  assert.ok(
    APP.includes('Forgot password? Email me a 6-digit code'),
    'a wrong password is a dead end again: the emailcode step exists but nothing links to it'
  );
});
