/**
 * "Cancel my booking" — the Profile tab's core action, spoken.
 *
 * The risk being pinned here is drift: a second cancellation path that forgets the
 * ownership check, the two-hour window, or the refund would let the assistant cancel
 * a session the Cancel button would have refused, or take a session away without
 * giving the money back. So the tool must go through lib/booking-actions, the route
 * must go through the same function, and cancelling must require a spoken yes.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('cancel_booking exists, is a write, and delegates to booking-actions', () => {
  const tools = require(path.join(ROOT, 'server/lib/book-tools.js'));
  assert.ok(tools.tools.cancel_booking, 'the assistant must be able to cancel');
  assert.equal(tools.isWrite('cancel_booking'), true, 'cancelling must be confirmed first');

  const src = read('server/lib/book-tools.js');
  const tool = src.slice(src.indexOf('cancel_booking: {'), src.indexOf('book_and_pay: {'));
  assert.ok(/cancelBooking\(/.test(tool), 'the tool must call cancelBooking');
  assert.ok(!/UPDATE\s+public\.bookings/i.test(tool), 'the tool must not write its own SQL');
});

test('the REST route and the assistant share one cancellation policy', () => {
  const route = read('server/routes/booking.js');
  assert.ok(
    /cancelBooking\(\{\s*userId: req\.session\.userId/.test(route),
    'the logged-in cancel endpoint must use the shared action'
  );
});

test('the policy itself is still enforced in one place', () => {
  const src = read('server/lib/booking-actions.js');
  const fn = src.slice(src.indexOf('async function cancelBooking'));
  assert.ok(/hoursUntilStart < 2/.test(fn), 'the two-hour free-cancellation window must survive');
  assert.ok(/b\.user_id::text = \$2::text/.test(fn), 'a customer may only cancel their own booking');
  assert.ok(/refunds\.create/.test(fn), 'a paid booking must be refunded');
  assert.ok(
    fn.indexOf('refund_failed') < fn.indexOf("SET status = 'cancelled', stripe_payment_status"),
    'a failed refund must abort before the booking is cancelled'
  );
});

test('Profile offers cancelling by voice and labels it while it runs', () => {
  const profile = read('frontend/public/profile-chat.js');
  assert.ok(/Cancel my booking/.test(profile), 'the Profile tab must offer it as a chip');
  assert.ok(/cancel_booking:/.test(profile), 'the tool must have a spoken label');
  assert.ok(/cancel_booking/.test(read('frontend/public/book-chat.js')), 'Book must label it too');
});
