/**
 * Email chatbot journey test 2026-09-28: rebook parsed "Wordsworth St" as a
 * city, "Show my shared library" searched Los Angeles, and email senders were
 * never recognised (no `verified`), so library/memory/create never linked.
 */
const test = require('node:test');
const assert = require('node:assert');
const mem = require('../server/chatbot/customer-memory');
const { senderVerified } = require('../server/chatbot/email');
const { detectIntent } = require('../server/chatbot/message-handler');

test('shared library phrases reach the library', () => {
  for (const t of ['Show my shared library', 'show me my saved library', 'library', 'my library', 'open my library']) {
    assert.equal(mem.detectMemoryAsk(t), 'library', t);
  }
  for (const t of ['gyms in Leeds', 'my bookings', 'Book gym 1 for tomorrow']) assert.equal(mem.detectMemoryAsk(t), null, t);
});

test('rebook is a booking, not a search', () => {
  if (!detectIntent) return;
  assert.equal(detectIntent('Rebook the same gym, Elite Boxing Bolton, Wednesday at 11am', {}), 'book');
  assert.equal(detectIntent('re-book please', {}), 'book');
});

test('email sender is verified only by its own domain', () => {
  assert.equal(senderVerified({ dkim: '{@gmail.com : pass}' }, 'rjekar73@gmail.com'), true);
  assert.equal(senderVerified({ dkim: '{@mail.gmail.com : pass}' }, 'a@gmail.com'), true);
  assert.equal(senderVerified({ SPF: 'pass' }, 'a@gmail.com'), true);
  assert.equal(senderVerified({ dkim: '{@evil.com : pass}', SPF: 'fail' }, 'a@gmail.com'), false);
  assert.equal(senderVerified({ dkim: '{@gmail.com : fail}' }, 'a@gmail.com'), false);
  assert.equal(senderVerified({}, 'a@gmail.com'), false);
});
