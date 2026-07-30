/**
 * Live visitor tracker — real social-proof numbers, no fakery.
 *
 * Science: Booking.com-style urgency/social proof ("X people browsing now")
 * measurably lifts conversion, but ONLY when honest — fake counters destroy
 * trust (and violate consumer law in the UK/EU). This middleware counts
 * distinct visitors seen in the last 5 minutes, in memory (no DB, no PII
 * stored — IPs are hashed and pruned).
 */
const crypto = require('crypto');

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const seen = new Map(); // hash -> lastSeen ts

function prune(now) {
  for (const [k, ts] of seen) {
    if (now - ts > WINDOW_MS) seen.delete(k);
  }
}

// Prune periodically so the map can't grow unbounded between requests
setInterval(() => prune(Date.now()), 60 * 1000).unref();

function track(req, res, next) {
  try {
    // Only count real page/API activity from browsers, skip health checks & bots
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (ua && !/bot|crawler|spider|pingdom|uptime|monitor/.test(ua)) {
      const ip = req.headers['x-forwarded-for']
        ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
        : req.ip || req.connection?.remoteAddress || '';
      if (ip) {
        const key = crypto.createHash('sha1').update(ip + '|' + ua).digest('hex').slice(0, 16);
        seen.set(key, Date.now());
      }
    }
  } catch (e) { /* never block a request over stats */ }
  next();
}

function getCount() {
  prune(Date.now());
  return seen.size;
}

module.exports = { track, getCount };
