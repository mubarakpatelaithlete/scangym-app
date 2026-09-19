/**
 * The apex host scangym.com 301-redirects to www.scangym.com.
 *
 * Telegram does not follow redirects on a webhook: a webhook registered on the
 * apex host answered every update with "Wrong response from the webhook: 301
 * Moved Permanently", so the bot went silent while /api/chatbot/health still
 * reported telegram as configured. Any outbound URL we hand to a provider must
 * therefore be canonicalised before it is registered.
 *
 * Other hosts (Railway previews, staging, localhost) are returned untouched.
 */
function canonicalBase(url) {
  return String(url)
    .replace(/^https?:\/\/scangym\.com/i, 'https://www.scangym.com')
    .replace(/\/+$/, '');
}

module.exports = { canonicalBase };
