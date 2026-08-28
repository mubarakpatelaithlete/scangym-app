/**
 * Nobody is ever asked to say yes to a number they have not been told.
 *
 * The confirm-before-you-take-money contract was only half kept. The server emitted the
 * tool's *schema description* as the confirmation summary and the browser discarded it for
 * a string each tab wrote itself — and those strings covered `book_gym` and
 * `cancel_booking` only. `book_and_pay`, the tool that charges a saved card off-session,
 * had no line on Book, Reels or Profile, so it fell through to chat-agent.js's last-resort
 * `'Go ahead with this?'`: no gym, no time, no amount. Spoken aloud, that is the entire
 * question.
 *
 * These tests pin the fix:
 *   1. Every money tool produces a line naming the gym, the when and the amount.
 *   2. The amount comes from the pricing engine, not from the model's arguments.
 *   3. An unpriceable booking asks for nothing at all rather than a blind yes.
 *   4. The browser prefers the server's line over its own copy.
 *   5. A pending (never-paid) booking is not promised a refund.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { confirmLine } = require(path.join(ROOT, 'server/lib/confirm-line.js'));

const NOW = new Date('2026-08-28T18:00:00Z');

const quoteOk = async ({ gymId, date, time }) => ({
  ok: true,
  gymId,
  gymName: 'Gym Nation',
  date,
  time: time || '20:00',
  price: 5,
  discount: 0,
  symbol: '£',
  display: '£5.00',
});

/* ── 1 + 2: the money tools always name gym, when and amount ───────────────── */

for (const tool of ['book_gym', 'book_and_pay']) {
  test(`${tool} confirmation names the gym, the time and the price`, async () => {
    const line = await confirmLine(
      tool,
      { gymId: 7, date: '2026-08-28', time: '20:00' },
      'u1',
      { quoteBooking: quoteOk, now: NOW }
    );

    assert.match(line, /Gym Nation/, 'must name the gym');
    assert.match(line, /£5\.00/, 'must name the amount');
    assert.match(line, /8pm/, 'must name the time in words a person says');
    assert.match(line, /\?$/, 'must be a question');
    assert.doesNotMatch(line, /^Go ahead with this\?$/);
  });
}

test('book_and_pay says the money is leaving the saved card', async () => {
  const line = await confirmLine(
    'book_and_pay',
    { gymId: 7, date: '2026-08-28', time: '20:00' },
    'u1',
    { quoteBooking: quoteOk, now: NOW }
  );
  assert.match(line, /saved card/);
});

test('the price is the pricing engine\'s, not one the model passed in', async () => {
  // The model offers a price it remembered from a search; the quote disagrees. The
  // customer must hear the one that will actually be charged.
  const line = await confirmLine(
    'book_and_pay',
    { gymId: 7, date: '2026-08-28', time: '20:00', price: 99 },
    'u1',
    { quoteBooking: quoteOk, now: NOW }
  );
  assert.match(line, /£5\.00/);
  assert.doesNotMatch(line, /99/);
});

test('today and tomorrow are spoken as words', async () => {
  const today = await confirmLine(
    'book_and_pay', { gymId: 7, date: '2026-08-28' }, 'u1', { quoteBooking: quoteOk, now: NOW }
  );
  assert.match(today, /today/);

  const tomorrow = await confirmLine(
    'book_and_pay', { gymId: 7, date: '2026-08-29' }, 'u1', { quoteBooking: quoteOk, now: NOW }
  );
  assert.match(tomorrow, /tomorrow/);
});

/* ── 3: no price, no question ──────────────────────────────────────────────── */

test('an unpriceable booking never asks for a blind yes', async () => {
  const line = await confirmLine(
    'book_and_pay',
    { gymId: 999, date: '2026-08-28' },
    'u1',
    { quoteBooking: async () => ({ ok: false, code: 'gym_not_found' }), now: NOW }
  );
  assert.doesNotMatch(line, /^Go ahead with this\?$/);
  assert.match(line, /not booked anything/i);
});

test('a thrown quote falls back to the tab copy rather than crashing the turn', async () => {
  const line = await confirmLine(
    'book_and_pay',
    { gymId: 7, date: '2026-08-28' },
    'u1',
    { quoteBooking: async () => { throw new Error('db down'); }, now: NOW }
  );
  assert.strictEqual(line, null, 'null hands the wording back to the tab, it does not throw');
});

test('tools that move no money keep the tab\'s own wording', async () => {
  assert.strictEqual(await confirmLine('save_gym', { gymId: 7 }, 'u1', {}), null);
});

/* ── 5: cancellations tell the truth about the refund ──────────────────────── */

function poolWith(row) {
  return { async query() { return { rows: row ? [row] : [] }; } };
}

test('cancelling a paid booking says what comes back', async () => {
  const line = await confirmLine('cancel_booking', { bookingId: 3 }, 'u1', {
    now: NOW,
    pool: poolWith({
      booking_date: '2026-08-29', start_time: '20:00', price: '5.00',
      status: 'confirmed', gym_name: 'Gym Nation', country: 'GB',
    }),
  });
  assert.match(line, /Gym Nation/);
  assert.match(line, /£5\.00 comes back/);
});

test('cancelling an unpaid booking does not promise a refund', async () => {
  const line = await confirmLine('cancel_booking', { bookingId: 3 }, 'u1', {
    now: NOW,
    pool: poolWith({
      booking_date: '2026-08-29', start_time: '20:00', price: '5.00',
      status: 'pending', gym_name: 'Gym Nation', country: 'GB',
    }),
  });
  assert.match(line, /nothing was paid/);
  assert.doesNotMatch(line, /comes back/);
});

/* ── 4: the wiring, both ends ──────────────────────────────────────────────── */

test('the book agent sends the priced line as the confirm summary', () => {
  const src = read('server/routes/book-agent.js');
  assert.match(src, /confirmLine\(call\.name, args, userId\)/,
    'the confirm event must be built from the priced line');
  assert.match(src, /spoken: !!line/,
    'the browser needs to know the line is authoritative');
});

test('the browser prefers the server line over its own copy', () => {
  const src = read('frontend/public/chat-agent.js');
  assert.match(src, /if \(evt && evt\.spoken && evt\.summary\) return evt\.summary;/);
  assert.match(src, /confirmSummary\(data\.tool, data\.args, data\)/,
    'the confirm event must be passed through so the server line can be used');
});

test('every tab labels the tool that charges the card', () => {
  for (const tab of ['book-chat.js', 'reels-chat.js', 'profile-chat.js']) {
    assert.match(read('frontend/public/' + tab), /book_and_pay:/,
      tab + ' must have a progress label for book_and_pay');
  }
});

/* ── the dead-key fix: knowing a provider is down must be acted on ─────────── */

test('a broken key is benched by the watchdog, not by a customer', () => {
  const selfCheck = read('server/lib/self-check.js');
  assert.match(selfCheck, /applyVerdictToLLM/,
    'self-check must tell llm.js what it found');
  assert.match(selfCheck, /llm\.bench\(name, 0\)/,
    'a recovered key must be un-benched in the same run');

  const llm = read('server/lib/llm.js');
  assert.match(llm, /function bench\(label, ms\)/);
  assert.match(llm, /module\.exports = \{[^}]*bench/);
});

test('the model is told the date instead of spending a round-trip on it', () => {
  const src = read('server/routes/book-agent.js');
  assert.match(src, /function dateLine\(/);
  assert.match(src, /role: 'system', content: dateLine\(\)/,
    'the date must be built per request, not baked in at boot');
});
