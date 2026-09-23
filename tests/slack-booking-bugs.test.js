const test = require('node:test');
const assert = require('node:assert');
const { detectIntent, extractEntities, INTENTS } = require('../server/chatbot/message-handler');

test('cancel with an email is a cancel even mid-booking', () => {
  const session = { pendingBooking: { gym: { name: 'X' }, date: '2026-09-24' } };
  assert.strictEqual(detectIntent('Cancel FA78-REYD me@mail.com', session), INTENTS.CANCEL);
});

test('"at 10am" is a time, not a location', () => {
  const e = extractEntities('Book Anytime Fitness Hereford tomorrow at 10am');
  assert.strictEqual(e.location, undefined);
  assert.strictEqual(e.time, '10:00');
});

test('"fitness" or "anytime" does not trigger the location match', () => {
  const e = extractEntities('Book gym 5 for tomorrow 10am');
  assert.strictEqual(e.location, undefined);
});

test('real locations still parse', () => {
  assert.strictEqual(extractEntities('Book a gym in Manchester for tomorrow at 3pm').location, 'manchester');
});

test('today/tomorrow are UK-local dates', () => {
  const uk = (o) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + o * 86400000));
  assert.strictEqual(extractEntities('today').date, uk(0));
  assert.strictEqual(extractEntities('tomorrow').date, uk(1));
});
