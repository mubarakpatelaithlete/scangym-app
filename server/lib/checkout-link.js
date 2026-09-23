'use strict';
/* One place that builds the "pay for this booking" link every chatbot and the
   MCP server hand to customers. The bots used to send /booking/:id/pay, a route
   the site never had — customers landed on "Page Not Found" and could not pay.
   The site's real payment page is /checkout?booking=ID&code=CODE (the booking
   code is the secret that lets a guest open it). */
const DEFAULT_BASE = 'https://www.scangym.com';

function checkoutLink(bookingId, bookingCode, base) {
  const root = String(base || DEFAULT_BASE).replace(/\/+$/, '');
  if (!bookingId || !bookingCode) return `${root}/bookings`;
  return `${root}/checkout?booking=${encodeURIComponent(bookingId)}&code=${encodeURIComponent(bookingCode)}`;
}

/* "2026-09-24T00:00:00.000Z" → "Thu 24 Sep 2026". Leaves anything it can't
   parse untouched. */
function prettyDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

module.exports = { checkoutLink, prettyDate };
