'use strict';
/* Bugs 15 + 16 (owner request 2026-09-28): natural "cancel my booking" lists
   only active bookings; memory phrasings reach the memory answer. */
const test = require('node:test');
const assert = require('node:assert');
const mem = require('../server/chatbot/customer-memory');

function fakeDb(bookings) {
  const store = new Map();
  return {
    async query(sql, params) {
      if (/FROM user_channels/.test(sql)) return { rows: [{ user_id: 7, email: 'a@b.com', first_name: 'Sam' }] };
      if (/SELECT data FROM chatbot_memory/.test(sql)) return { rows: store.has(params[0]) ? [{ data: JSON.parse(store.get(params[0])) }] : [] };
      if (/INSERT INTO chatbot_memory/.test(sql)) { store.set(params[0], params[1]); return { rows: [] }; }
      if (/FROM public.bookings/.test(sql)) return { rows: bookings };
      return { rows: [] };
    },
  };
}
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const meta = { platform: 'telegram', verified: true };

test('"cancel my booking" with one active booking asks YES, then cancels it', async () => {
  mem._linkCache.clear();
  const { handleMessage } = require('../server/chatbot/message-handler');
  const cancelled = [];
  const d = { pool: fakeDb([{ id: 9, booking_date: tomorrow, start_time: '18:00', booking_code: 'AAAA-BBBB', gym_name: 'JD Gym' }]),
    cancelBooking: async (o) => { cancelled.push(o); return { ok: true, refunded: true, message: '' }; }, awaitSave: true };
  const a = await handleMessage('telegram:900', 'cancel my booking', meta, d);
  assert.match(a.text, /Cancel this booking\?/);
  assert.match(a.text, /AAAA-BBBB/);
  const b = await handleMessage('telegram:900', 'YES', meta, d);
  assert.match(b.text, /Cancelled/);
  assert.deepEqual(cancelled, [{ userId: '7', bookingId: 9 }]);
});

test('expired bookings are not offered; none active says so', async () => {
  mem._linkCache.clear();
  const { handleMessage } = require('../server/chatbot/message-handler');
  const today = new Date().toISOString().slice(0, 10);
  const d = { pool: fakeDb([{ id: 3, booking_date: today, start_time: '00:00', booking_code: 'OLD1-OLD1', gym_name: 'X' }]), awaitSave: true };
  const a = await handleMessage('telegram:901', 'please cancel my gym', meta, d);
  assert.match(a.text, /no active bookings/);
});

test('memory phrasings route to memory', () => {
  for (const t of ['check shared memory context', 'do you remember me', 'who am I', 'show my memory', 'what do you know about me'])
    assert.equal(mem.detectMemoryAsk(t), 'memory', t);
  assert.equal(mem.detectMemoryAsk('check my library'), 'library');
  assert.equal(mem.detectMemoryAsk('book a gym in London'), null);
});
