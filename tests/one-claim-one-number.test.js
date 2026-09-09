/**
 * The site must not contradict itself.
 *
 * Found while walking the site as a first-time customer (8 Sep 2026):
 *   • /pricing said "LIVE PRICING · changes by time of day"; the FAQ two taps
 *     away said "same price any time of day" (the FAQ was right — surge pricing
 *     was removed in pricing engine v4.1).
 *   • /pricing listed "Basic £4.49" and "Standard £4.49" — same price, more
 *     features, which reads as a bug or a trick.
 *   • /how-it-works promised "guest checkout available" and /my-bookings said
 *     an account "is created automatically", while every booking path ends at a
 *     sign-in wall.
 *   • ScanSquad advertised "440+ ready-to-post clips" on one screen and "242+"
 *     on another.
 *   • The document shipped without an <h1>.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('frontend/public/app.ctr576.js');

test('nothing claims prices change by time of day', () => {
  const banned = [
    /Changes by time of day/i,
    /busy = slightly higher/i,
  ];
  for (const re of banned) {
    assert.ok(!re.test(APP), `pricing is flat — remove copy matching ${re}`);
  }
  assert.ok(/any time of day/i.test(APP), 'the flat-price promise should still be stated');
});

test('no two pass tiers are sold at the same price with different features', () => {
  const tiers = [...APP.matchAll(/data-tier-price="(\w+)">\$\{sgPrice\('(\w+)'\)\.display\}/g)]
    .map((m) => ({ tier: m[1], pass: m[2] }));
  assert.ok(tiers.length >= 4, 'expected the four pricing tiers to read from sgPrice()');
  const passes = tiers.map((t) => t.pass);
  assert.strictEqual(new Set(passes).size, passes.length,
    `two tiers show the same pass price: ${passes.join(', ')}`);
});

test('we do not promise guest checkout we cannot deliver', () => {
  assert.ok(!/guest checkout available/i.test(APP),
    '/how-it-works must not promise guest checkout while the booking flow requires sign-in');
  assert.ok(!/one is created automatically/i.test(APP),
    '/my-bookings must not claim an account is created automatically');
});

test('the creator asset count comes from one constant', () => {
  const cfg = read('frontend/public/squad-config.js');
  const declared = cfg.match(/var COUNT = (\d+)/);
  assert.ok(declared, 'squad-config.js must declare the count');
  const count = declared[1];

  const files = ['frontend/public/app.ctr576.js', 'frontend/public/squad-create.js',
    'frontend/public/sg-scansquad.js'];
  for (const f of files) {
    const src = read(f);
    const numbers = [...src.matchAll(/(\d{3})\+\s*(?:ready|assets|Assets|ready-made|ready-to-post)/g)]
      .map((m) => m[1]);
    for (const n of numbers) {
      assert.strictEqual(n, count,
        `${f} advertises ${n}+ assets but squad-config.js says ${count}`);
    }
  }
});

test('the shell ships an h1', () => {
  const html = read('frontend/public/index.html');
  assert.ok(/<h1[\s>]/.test(html), 'index.html must contain an h1 for search engines');
});

test('the sign-in sheet validates a phone before the SMS provider does', () => {
  assert.ok(/Enter a UK mobile, e\.g\. 07123 456789/.test(APP),
    'client-side validation must catch obviously wrong UK numbers');
  const auth = read('server/routes/auth.js');
  assert.ok(/\^\\\+\[1-9\]\\d\{7,14\}\$/.test(auth),
    'send-code must validate E.164 before calling the provider');
  assert.ok(!/detail: data\.message/.test(auth),
    'the provider\'s own error text must never be returned to the browser');
});

test('internal dashboard pages are gated server-side', () => {
  const server = read('server/server.js');
  for (const route of ["app.get('/admin', requireInternalPage", "app.get('/ceo-dashboard', requireInternalPage", "app.get('/admin/uploads', requireInternalPage"]) {
    assert.ok(server.includes(route), `missing gate: ${route}`);
  }
});

test('the busy-time label renders an emoji, not a Python escape', () => {
  assert.ok(!/\\U0001F7E1/.test(APP),
    '\\U0001F7E1 is a Python escape — it printed literally as "U0001F7E1 Moderate"');
  assert.ok(/\\u\{1F7E1\}/.test(APP), 'use the JS \\u{...} form');
});
