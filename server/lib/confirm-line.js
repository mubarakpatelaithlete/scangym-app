/**
 * The sentence a customer says "yes" to.
 *
 * Why this exists: the confirm-before-you-take-money contract was only half kept. The
 * server emitted a `confirm` event carrying the tool's *schema description* ("Book a day
 * pass. Takes payment...") — documentation written for the model, not a question for a
 * human — and the browser threw it away in favour of a string each tab wrote for itself.
 * Those strings covered `book_gym` and `cancel_booking`; `book_and_pay`, the tool that
 * actually charges a saved card off-session, had none on Book, Reels or Profile. The
 * fallback in chat-agent.js is `'Go ahead with this?'`, so the question that spends real
 * money could arrive with no gym, no time and no amount in it — and by voice, that is the
 * whole question.
 *
 * It could not have said the price anyway: `book_and_pay`'s arguments are gymId, date and
 * time. The number lives in the pricing engine. So the line is built here, on the server,
 * from the same quote the charge will use, and the browser is told to prefer it.
 *
 * Rules:
 *   - A money tool never returns null. If the price cannot be fetched we say so plainly
 *     rather than asking for a blind yes.
 *   - The amount shown is the amount charged: same gym row, same priceFor, same time
 *     default as createBooking.
 */
const bookingActions = require('./booking-actions');

/** "today" / "tomorrow" / "Fri 29 Aug" — how a person says a date out loud. */
function sayDate(iso, now = new Date()) {
  if (!iso) return '';
  const day = (d) => d.toISOString().slice(0, 10);
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86400000));
  if (iso === today) return 'today';
  if (iso === tomorrow) return 'tomorrow';

  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

/** 20:00 -> "8pm", 20:30 -> "8.30pm" — spoken, not printed. */
function sayTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return String(hhmm);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour12}.${String(m).padStart(2, '0')}${suffix}` : `${hour12}${suffix}`;
}

async function bookingLine(tool, args, deps) {
  const quote = deps.quoteBooking || bookingActions.quoteBooking;
  const q = await quote({ gymId: args.gymId, date: args.date, time: args.time, deps });

  if (!q.ok) {
    // Never ask for a yes we cannot price.
    return "I could not price that one just now, so I have not booked anything. Shall I try again?";
  }

  const when = `${sayDate(q.date, deps.now)} at ${sayTime(q.time)}`;
  return tool === 'book_and_pay'
    ? `Book ${q.gymName}, ${when} — ${q.display} on your saved card?`
    : `Book ${q.gymName}, ${when} — ${q.display}, paid at the gym?`;
}

async function cancelLine(args, userId, deps) {
  const db = deps.pool || require('../middleware/db');
  try {
    const { rows } = await db.query(
      `SELECT b.booking_date, b.start_time, b.price, b.status, g.name AS gym_name, g.country
         FROM public.bookings b
         LEFT JOIN public.gyms g ON g.id = b.gym_id
        WHERE b.id = $1 AND b.user_id::text = $2::text`,
      [args.bookingId, String(userId)]
    );
    const b = rows[0];
    if (!b) return 'Cancel that booking and refund it?';

    const raw = b.booking_date instanceof Date
      ? b.booking_date.toISOString().slice(0, 10)
      : String(b.booking_date).slice(0, 10);
    const pricing = require('./pricing-engine');
    const { symbol } = pricing.getCurrencyForCountry(b.country || 'GB');
    const when = `${sayDate(raw, deps.now)} at ${sayTime(String(b.start_time).slice(0, 5))}`;

    // A pending booking was never paid for: promising a refund would be a lie.
    const money = b.status === 'pending' || !(Number(b.price) > 0)
      ? 'nothing was paid for it'
      : `${symbol}${Number(b.price).toFixed(2)} comes back to your card`;

    return `Cancel ${b.gym_name || 'that booking'}, ${when} — ${money}?`;
  } catch (err) {
    console.error('[ConfirmLine] could not describe the cancellation:', err.message);
    return 'Cancel that booking and refund it?';
  }
}

/**
 * @param {string} tool    the pending tool name
 * @param {object} args    the arguments the model produced
 * @param {string|number} userId
 * @param {object} [deps]  { quoteBooking, pool, now } for tests
 * @returns {Promise<string|null>} the question to ask, or null for tools that are not
 *   about money (the tab's own copy is fine for those)
 */
async function confirmLine(tool, args = {}, userId = null, deps = {}) {
  try {
    if (tool === 'book_gym' || tool === 'book_and_pay') return await bookingLine(tool, args, deps);
    if (tool === 'cancel_booking') return await cancelLine(args, userId, deps);
    return null;
  } catch (err) {
    console.error('[ConfirmLine] falling back to the tab copy:', err.message);
    return null;
  }
}

module.exports = { confirmLine, _internals: { sayDate, sayTime } };
