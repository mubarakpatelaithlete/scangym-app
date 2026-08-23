/**
 * The Book assistant takes customers' money. These tests pin the three properties
 * that make that safe, so a later refactor cannot quietly remove them.
 *
 *   1. Booking is a write, so the UI must confirm it before anything is charged.
 *   2. The assistant does not price anything itself — it calls the same code the
 *      Book button calls. An assistant that computes its own price will eventually
 *      quote a different one from the app.
 *   3. The agent is actually wired into the server and the page.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('booking is a write tool and everything else is a read', () => {
  const tools = require(path.join(ROOT, 'server/lib/book-tools.js'));
  const writes = Object.keys(tools.tools).filter((n) => tools.isWrite(n));

  assert.deepEqual(writes, ['book_gym'], 'book_gym must be the only write tool');
  assert.equal(tools.isWrite('find_gyms'), false, 'searching must not need confirmation');
});

test('the agent hands writes back for confirmation instead of running them', () => {
  const src = read('server/routes/book-agent.js');

  const guard = src.indexOf('bookTools.isWrite(call.name)');
  const confirm = src.indexOf("sse(res, 'confirm'");
  const execute = src.indexOf('bookTools.execute(call.name');

  assert.ok(guard !== -1, 'the tool loop must check isWrite');
  assert.ok(confirm > guard, 'a write must emit a confirm event');
  assert.ok(execute > confirm, 'the unconfirmed path must return before executing');
});

test('the assistant books through booking-actions, not its own SQL', () => {
  const src = read('server/lib/book-tools.js');

  assert.ok(
    /require\(['"]\.\/booking-actions['"]\)/.test(src),
    'book_gym must delegate to lib/booking-actions'
  );
  assert.equal(
    /INSERT INTO[\s\S]{0,40}bookings/i.test(src),
    false,
    'book-tools must not insert bookings directly'
  );
  assert.equal(
    /calculateGymPrice|day_pass_price\s*\*|total_amount\s*=/.test(src),
    false,
    'book-tools must not compute its own price'
  );
});

test('the Book endpoint and the Book button share one booking path', () => {
  const route = read('server/routes/booking.js');

  assert.ok(
    /bookingActions\.createBooking\(/.test(route),
    'POST /api/bookings/create must call the shared createBooking'
  );

  // Scope to the signed-in create handler. The guest and pay-next-visit flows still
  // build their own INSERTs; they are different enough (guest email, IOU status) that
  // folding them in belongs in its own change, not this one.
  const start = route.indexOf("router.post('/create'");
  const end = route.indexOf('router.', start + 10);
  const createHandler = route.slice(start, end);

  assert.ok(start !== -1, 'the /create route should still exist');
  assert.equal(
    /INSERT INTO/i.test(createHandler),
    false,
    'the signed-in create route must not insert bookings itself'
  );
  assert.equal(
    /calculateGymPrice/.test(createHandler),
    false,
    'the signed-in create route must not price the pass itself'
  );
});

test('the Book agent is wired into the server and the page', () => {
  const server = read('server/server.js');
  assert.ok(/require\(['"]\.\/routes\/book-agent['"]\)/.test(server), 'router must be required');
  assert.ok(/app\.use\(['"]\/api\/book['"]/.test(server), 'router must be mounted at /api/book');

  const html = read('frontend/public/index.html');
  assert.ok(/book-chat\.js/.test(html), 'book-chat.js must be loaded by the page');
});

test('book-chat reuses the shared chat engine with its own namespace', () => {
  const src = read('frontend/public/book-chat.js');

  assert.ok(/window\.sgChatAgent\.create\(/.test(src), 'must reuse chat-agent.js');
  assert.ok(/ns:\s*'bchat'/.test(src), 'needs its own namespace to avoid clashing with pchat/schat');
  assert.ok(/endpoint:\s*'\/api\/book\/agent'/.test(src), 'must point at the Book agent');
});
