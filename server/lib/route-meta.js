/**
 * Per-route page metadata for the SPA shell.
 *
 * Every non-API route used to be served the identical index.html: one <title>,
 * one description, one canonical URL. Share a Partner link, a ScanSquad link or a
 * checkout link and they all previewed as "ScanGym - Book a Gym. Anywhere.", and
 * search engines saw a single page where the product has five tabs.
 *
 * This module maps a request path to the title/description/canonical it should
 * carry, and rewrites the shell's head tags in place. It is pure string work on a
 * cached template — no extra I/O per request.
 */

const SITE = 'https://scangym.com';
const DEFAULT_KEY = '/';

// Only paths served by the SPA catch-all belong here. /reels, /scansquad and /about
// are served from their own HTML files and already carry their own head tags.
// Ordered: the first matching prefix wins, so /creator-hub does not fall into /creator.
const ROUTES = [
  ['/explore', {
    title: 'Book a Gym Near You — ScanGym',
    description: 'Search gyms near you and book a day pass in seconds. No membership, QR entry, pay only when you go.',
  }],
  ['/nearby', {
    title: 'Gyms Near Me — ScanGym',
    description: 'See which gyms are open around you right now, with distance, price and amenities before you book.',
  }],
  ['/checkout', {
    title: 'Checkout — ScanGym',
    description: 'Confirm and pay for your gym day pass. Secure checkout, instant QR entry pass.',
    noindex: true,
  }],
  ['/booking-success', {
    title: 'Booking Confirmed — ScanGym',
    description: 'Your gym day pass is confirmed. Show your QR code at the door to get in.',
    noindex: true,
  }],
  ['/creator-hub', {
    title: 'Creator Hub — ScanSquad | ScanGym',
    description: 'Track your reels, referrals and payouts in one place.',
  }],
  ['/creator-reels', {
    title: 'Your Reels — ScanSquad | ScanGym',
    description: 'Upload and manage the gym reels that earn you day-pass commission.',
  }],
  ['/creator', {
    title: 'ScanSquad — Earn by Sharing Gyms | ScanGym',
    description: 'Join ScanSquad: post gym reels, share your link and earn on every day pass you drive.',
  }],
  ['/partners', {
    title: 'List Your Gym — ScanGym Partners',
    description: 'Fill empty off-peak hours. List your gym on ScanGym, keep your pricing, get paid per visit.',
  }],
  ['/partner', {
    title: 'List Your Gym — ScanGym Partners',
    description: 'Fill empty off-peak hours. List your gym on ScanGym, keep your pricing, get paid per visit.',
  }],
  ['/profile', {
    title: 'Your Passes & Profile — ScanGym',
    description: 'Your upcoming day passes, QR entry codes, wallet balance and booking history.',
    noindex: true,
  }],
  ['/wallet', {
    title: 'Wallet — ScanGym',
    description: 'Your ScanGym balance, credits and payout history.',
    noindex: true,
  }],
  [DEFAULT_KEY, {
    title: 'ScanGym - Book a Gym. Anywhere.',
    description: 'Find and book gyms near you. 24-hour day passes, QR entry, no membership needed.',
  }],
];

/** Resolve the metadata for a request path. Never throws; always returns an object. */
function metaForPath(pathname) {
  const clean = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (clean !== '/') {
    for (const [prefix, meta] of ROUTES) {
      if (prefix !== DEFAULT_KEY && (clean === prefix || clean.startsWith(prefix + '/'))) {
        return { ...meta, canonical: SITE + prefix };
      }
    }
  }
  const fallback = ROUTES.find(([k]) => k === DEFAULT_KEY)[1];
  return { ...fallback, canonical: SITE + '/' };
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Rewrite the <title>, description, canonical and og/twitter tags of the shell.
 * Unknown or already-correct markup is left untouched.
 */
function applyMeta(html, pathname) {
  const meta = metaForPath(pathname);
  const title = escapeAttr(meta.title);
  const desc = escapeAttr(meta.description);
  const url = escapeAttr(meta.canonical);

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${desc}">`)
    .replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
      `<link rel="canonical" href="${url}">`)
    .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:url" content="${url}">`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${title}">`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${desc}">`)
    .replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:title" content="${title}">`)
    .replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:description" content="${desc}">`);

  if (meta.noindex && !/name="robots"/i.test(out)) {
    out = out.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
  }
  return out;
}

module.exports = { metaForPath, applyMeta, ROUTES, SITE };
