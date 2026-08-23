/**
 * Booking actions — the one place a booking gets created.
 *
 * Extracted from routes/booking.js so the REST endpoint and the Book assistant
 * cannot drift apart. The assistant takes money exactly the way the Book button
 * does: same price, same duplicate guard, same end time, same referral discount.
 *
 * Duplicating this logic into a tool file is how you end up with an assistant that
 * charges a different price from the app — the same class of bug as an assistant
 * writing a different column from the dashboard.
 *
 * Returns plain result objects ({ ok, code, message, ... }) rather than touching res,
 * so callers decide how to present a failure: HTTP status, or a sentence spoken aloud.
 */
const crypto = require('crypto');
const pool = require('../middleware/db');
const pricing = require('./pricing-engine');

const PLATFORM_FEE_RATE = 0.1;
const REFERRAL_DISCOUNT_RATE = 0.15;
const MIN_DISCOUNTED_PRICE = 0.5;

/** Human-readable booking code, e.g. 5WCB-8VDY. */
function generateBookingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3) code += '-';
  }
  return code;
}

/** Machine code used by the scanner. */
function generateQRCode() {
  return 'BOOK_' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

/**
 * "anytime" or a missing time means the next hour, capped at 22:00 — the same
 * default the Book screen has always applied.
 */
function resolveTime(time) {
  if (!time || time === 'anytime') {
    const nextHour = Math.min(new Date().getHours() + 1, 22);
    return String(nextHour).padStart(2, '0') + ':00';
  }
  return time;
}

/** A session is one hour. */
function endTimeFor(time) {
  const [hours, mins] = time.split(':').map(Number);
  const endHour = Math.min(hours + 1, 23);
  return String(endHour).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
}

/**
 * Price a day pass at a gym: the owner's price if they set one, otherwise the
 * purchasing-power default for the gym's country. Referral codes take 15% off.
 */
function priceFor(gym, referralCode) {
  const quote = pricing.calculateGymPrice({
    gymDayPassPrice: gym.day_pass_price ? parseFloat(gym.day_pass_price) : null,
    countryCode: gym.country || 'GB',
    passType: 'day',
  });

  let price = quote.amount;
  let discount = 0;

  if (referralCode) {
    discount = Math.round(price * REFERRAL_DISCOUNT_RATE * 100) / 100;
    price = Math.max(price - discount, MIN_DISCOUNTED_PRICE);
  }

  return { price, discount };
}

/**
 * Create a pending booking.
 *
 * @returns {Promise<{ok: true, booking: object} | {ok: false, code: string, message: string}>}
 *   code is one of: missing_fields | gym_not_found | duplicate
 */
async function createBooking({ userId, gymId, date, time, referralCode = null } = {}) {
  if (!userId) {
    return { ok: false, code: 'not_authenticated', message: 'Please log in first.' };
  }
  if (!gymId || !date) {
    return { ok: false, code: 'missing_fields', message: 'A gym and a date are required.' };
  }

  const startTime = resolveTime(time);
  const endTime = endTimeFor(startTime);

  const gym = await pool.query(
    'SELECT id, name, address, country, day_pass_price FROM gyms WHERE id = $1',
    [gymId]
  );
  if (gym.rows.length === 0) {
    return { ok: false, code: 'gym_not_found', message: "I couldn't find that gym." };
  }
  const g = gym.rows[0];

  const { price, discount } = priceFor(g, referralCode);

  const existing = await pool.query(
    `SELECT id FROM public.bookings
      WHERE gym_id = $1 AND user_id = $2 AND booking_date = $3 AND start_time = $4
        AND status NOT IN ('cancelled')
      LIMIT 1`,
    [gymId, userId, date, startTime]
  );
  if (existing.rows.length > 0) {
    return {
      ok: false,
      code: 'duplicate',
      message: 'You already have a booking at this gym for that date and time.',
      existingBookingId: existing.rows[0].id,
    };
  }

  const bookingCode = generateBookingCode();
  const qrCode = generateQRCode();

  const { rows } = await pool.query(
    `INSERT INTO public.bookings
      (gym_id, user_id, booking_date, start_time, end_time, total_amount,
       platform_fee_amount, booking_type, booking_code, qr_code, status, referral_code,
       created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'instant', $8, $9, 'pending', $10, NOW(), NOW())
     RETURNING *`,
    [
      gymId,
      userId,
      date,
      startTime,
      endTime,
      price,
      price * PLATFORM_FEE_RATE,
      bookingCode,
      qrCode,
      referralCode || null,
    ]
  );

  const booking = rows[0];

  return {
    ok: true,
    booking: {
      id: booking.id,
      gymId: booking.gym_id,
      gymName: g.name,
      gymAddress: g.address,
      date: booking.booking_date,
      time: booking.start_time,
      endTime: booking.end_time,
      price: parseFloat(booking.total_amount),
      discount,
      bookingCode: booking.booking_code,
      status: booking.status,
    },
  };
}

module.exports = {
  createBooking,
  generateBookingCode,
  generateQRCode,
  resolveTime,
  endTimeFor,
  priceFor,
};
