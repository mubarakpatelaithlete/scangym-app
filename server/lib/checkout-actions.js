/**
 * Checkout actions — the one place a spoken booking gets paid for.
 *
 * The Book button's 1-tap flow lives in routes/payment.js (POST /quick-checkout).
 * A voice booking has to do exactly the same thing without a screen, so this module
 * reuses that flow's parts rather than re-implementing them:
 *
 *   - the price and the booking row come from lib/booking-actions (same as the button)
 *   - the QR code comes from routes/payment's generate2ScanQR (same 2-scan token)
 *   - the charge is an off-session PaymentIntent on the customer's saved card
 *
 * Two rules this file exists to enforce:
 *
 *   1. Nothing is charged that the customer has not already said yes to. The agent
 *      confirms the gym, date, time and price first (book_and_pay is a write tool),
 *      and this function is only called after that yes.
 *   2. Saying "yes" twice must not charge twice. Every PaymentIntent carries an
 *      idempotency key derived from the booking row, so a repeated call settles the
 *      same intent instead of taking the money again.
 */
const pool = require('../middleware/db');
const { createBooking } = require('./booking-actions');
const pricing = require('./pricing-engine');

const money = (symbol, n) => symbol + Number(n || 0).toFixed(2);

/** Lazily required so this module can be unit-tested without a Stripe key. */
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith('sk_')) return null;
  try {
    return require('stripe')(key);
  } catch (err) {
    console.error('[Checkout] Stripe init failed:', err.message);
    return null;
  }
}

/** The customer's default saved card, or null if they have never paid before. */
async function defaultCardFor(stripe, customerId) {
  const customer = await stripe.customers.retrieve(customerId);
  const preferred = customer.invoice_settings?.default_payment_method;
  if (preferred) return preferred;

  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  return methods.data[0]?.id || null;
}

/**
 * Book a gym and pay for it in one go, off-session, on the saved card.
 *
 * @returns {Promise<object>} always a plain result:
 *   { ok: true, booking, qr, message }                       — paid and confirmed
 *   { ok: false, code: 'no_saved_card', message, addCardUrl } — first-timer, needs one tap
 *   { ok: false, code: 'requires_action', clientSecret, ... } — 3-D Secure, needs one tap
 *   { ok: false, code: 'declined' | 'duplicate' | ..., message }
 */
async function bookAndPay({ userId, gymId, date, time, referralCode = null, deps = {} } = {}) {
  const stripe = deps.stripe || getStripe();
  if (!stripe) {
    return { ok: false, code: 'not_configured', message: 'Card payments are not set up right now, so I have not booked anything.' };
  }

  const db = deps.pool || pool;
  const make = deps.createBooking || createBooking;

  const userRow = await db.query(
    'SELECT id, stripe_customer_id, email FROM public.users WHERE id = $1',
    [userId]
  );
  const user = userRow.rows[0];
  if (!user) return { ok: false, code: 'not_authenticated', message: 'Please log in first.' };

  if (!user.stripe_customer_id) {
    return {
      ok: false,
      code: 'no_saved_card',
      message: 'You have no card saved yet. Add one once and every booking after this is just your voice.',
      addCardUrl: 'https://scangym.com/checkout?add_card=1',
    };
  }

  const paymentMethodId = await defaultCardFor(stripe, user.stripe_customer_id);
  if (!paymentMethodId) {
    return {
      ok: false,
      code: 'no_saved_card',
      message: 'You have no card saved yet. Add one once and every booking after this is just your voice.',
      addCardUrl: 'https://scangym.com/checkout?add_card=1',
    };
  }

  // Price, duplicate guard and the booking row: same path as the Book button.
  const created = await make({ userId, gymId, date, time, referralCode });
  if (!created.ok) return { ok: false, code: created.code, message: created.message };

  const booking = created.booking;

  const gymRow = await db.query('SELECT country FROM gyms WHERE id = $1', [gymId]);
  const currency = pricing.getCurrencyForCountry(gymRow.rows[0]?.country || 'GB');

  let intent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: pricing.toStripeAmount(booking.price, currency.currency),
        currency: currency.currency,
        customer: user.stripe_customer_id,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          bookingId: String(booking.id),
          gymName: booking.gymName,
          voiceCheckout: 'true',
          ...(referralCode ? { referral_code: referralCode } : {}),
        },
        receipt_email: user.email || undefined,
      },
      // Saying "yes" twice must never charge twice.
      { idempotencyKey: `voice-booking-${booking.id}` }
    );
  } catch (err) {
    if (err.code === 'authentication_required' || err.code === 'payment_intent_authentication_failure') {
      // Leave the booking pending: the customer finishes 3-D Secure with one tap.
      const pi = err.raw?.payment_intent;
      return {
        ok: false,
        code: 'requires_action',
        bookingId: booking.id,
        paymentIntentId: pi?.id || null,
        clientSecret: pi?.client_secret || null,
        message: 'Your bank wants to check it is you. I have held the slot — approve it on your screen and it is done.',
      };
    }

    await db
      .query('UPDATE public.bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', booking.id])
      .catch(() => {});

    return {
      ok: false,
      code: 'declined',
      message:
        err.type === 'StripeCardError'
          ? `Your card was declined, so nothing was charged. ${err.message || ''}`.trim()
          : 'The payment did not go through, so nothing was charged and nothing is booked.',
    };
  }

  if (intent.status !== 'succeeded') {
    await db
      .query('UPDATE public.bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', booking.id])
      .catch(() => {});
    return { ok: false, code: 'declined', message: 'The payment did not complete, so nothing is booked.' };
  }

  // Same 2-scan QR the Book button issues.
  let qr = null;
  try {
    const generate2ScanQR = deps.generate2ScanQR || require('../routes/payment').generate2ScanQR;
    qr = await generate2ScanQR(booking.id, userId, gymId);
  } catch (err) {
    console.error('[Checkout] QR generation failed (booking still paid):', err.message);
  }

  await db.query(
    `UPDATE public.bookings
        SET status = 'confirmed', qr_code = COALESCE($1, qr_code), qr_code_url = $2,
            stripe_payment_intent_id = $3, stripe_payment_status = 'paid', updated_at = NOW()
      WHERE id = $4`,
    [qr?.token || null, qr?.dataUrl || null, intent.id, booking.id]
  );

  return {
    ok: true,
    booking: { ...booking, status: 'confirmed' },
    qr,
    message:
      `Paid and confirmed — ${booking.gymName}, ${booking.date} at ${booking.time}, ` +
      `${money(currency.symbol || '£', booking.price)}. Your code is ${booking.bookingCode}, ` +
      `and the QR is in your bookings.`,
  };
}

module.exports = { bookAndPay };
