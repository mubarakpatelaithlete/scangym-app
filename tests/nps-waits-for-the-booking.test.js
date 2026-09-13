/**
 * The NPS survey must never appear before the customer has finished paying.
 *
 * On 2026-09-13 a guest tapped "Book this gym" → "Continue as guest" → typed an
 * email, and four seconds later "How likely are you to recommend ScanGym?"
 * slid over the card form. nps-survey.js matched any POST whose URL contained
 * '/api/bookings' — which includes /api/bookings/guest-create, the PENDING
 * booking made before the payment sheet — and even /api/bookings/cancel.
 *
 * These tests load the trigger logic with a stub DOM and pin:
 *   - pending-booking and cancel calls do not trigger the survey
 *   - genuine confirmation calls do
 *   - the survey waits while a checkout sheet is on screen
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'nps-survey.js'),
  'utf8'
);

function boot({ elements = {} } = {}) {
  const calls = [];
  const timers = [];
  const store = {};
  const ctx = {
    console,
    URL,
    Date,
    JSON,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    location: { origin: 'https://scangym.com', pathname: '/' },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    document: {
      getElementById: (id) => elements[id] || null,
      querySelector: () => null,
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, querySelectorAll: () => [], set innerHTML(v) {} }),
      body: { appendChild() {} },
    },
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    },
  };
  ctx.window = ctx;
  ctx.window.fetch = ctx.fetch;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, timers, store };
}

async function flush() { await new Promise((r) => setImmediate(r)); }

test('a pending guest booking does not trigger the survey', async () => {
  const { ctx, timers } = boot();
  await ctx.window.fetch('/api/bookings/guest-create', { method: 'POST' });
  await flush();
  assert.strictEqual(timers.length, 0, 'guest-create must not schedule the survey');
});

test('cancelling a booking does not trigger the survey', async () => {
  const { ctx, timers } = boot();
  await ctx.window.fetch('/api/bookings/cancel', { method: 'POST' });
  await flush();
  assert.strictEqual(timers.length, 0);
});

test('a confirmed payment does trigger the survey', async () => {
  const { ctx, timers } = boot();
  await ctx.window.fetch('/api/payment/confirm-intent', { method: 'POST' });
  await flush();
  assert.strictEqual(timers.length, 1, 'confirm-intent must schedule the survey');
});

test('the survey waits while the card form is still on screen', async () => {
  const { ctx, timers, store } = boot({ elements: { 'sg-guest-card': {} } });
  await ctx.window.fetch('/api/payment/confirm-intent', { method: 'POST' });
  await flush();
  timers.shift().fn(); // the SHOW_DELAY_MS timer fires
  assert.strictEqual(store['scangym_nps_asked_at'], undefined, 'survey must not open over the card form');
  assert.ok(timers.length >= 1, 'it must re-check later instead');
});

test('the old substring match on /api/bookings is gone', () => {
  assert.doesNotMatch(SRC, /'\/api\/bookings',/, "'/api/bookings' prefix must not be a confirm endpoint");
});
