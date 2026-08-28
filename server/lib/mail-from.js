/**
 * Who our email says it is from — in the two shapes the two senders need.
 *
 * `SMTP_FROM` on production is `ScanGym Bookings <bookings@scangym.com>`. That is a
 * valid RFC 5322 From header, and nodemailer (booking confirmations, wallet emails)
 * accepts it happily. **SendGrid's JSON API does not**: it wants a bare address in
 * `from.email` and rejects the display-name form with a 400.
 *
 * Both files that send through the JSON API passed the whole string straight through,
 * so every one of those sends failed with the customer being told "I could not email
 * you" — including the email login code, from the day it shipped. The address was
 * never wrong; the shape was.
 *
 * So: one place that knows how to read the variable, and a fallback that is a bare
 * address, so a missing variable cannot reintroduce the same 400.
 */
const DEFAULT_ADDRESS = 'bookings@scangym.com';
const DEFAULT_NAME = 'ScanGym';

/** @returns {{email: string, name: string}} */
function mailFrom(raw = process.env.SMTP_FROM) {
  const value = String(raw || '').trim();
  if (!value) return { email: DEFAULT_ADDRESS, name: DEFAULT_NAME };

  // "Display Name <someone@example.com>"
  const bracketed = value.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>$/);
  if (bracketed) {
    const name = bracketed[1].replace(/^["'\s]+|["'\s]+$/g, '');
    return { email: bracketed[2], name: name || DEFAULT_NAME };
  }

  // A bare address, which is what most of these variables hold.
  if (/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(value)) return { email: value, name: DEFAULT_NAME };

  // Anything else (a name with no address, a typo) would be rejected by the API.
  // A send that works from the default address beats a 400 nobody sees.
  console.error('[MailFrom] SMTP_FROM is not a usable address, falling back:', value.slice(0, 60));
  return { email: DEFAULT_ADDRESS, name: DEFAULT_NAME };
}

module.exports = { mailFrom, DEFAULT_ADDRESS, DEFAULT_NAME };
