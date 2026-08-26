'use strict';

/**
 * Route-aware boot skeleton.
 *
 * index.html ships a single boot screen: a centred logo, two grey bars and a
 * three-item tab bar (Reels / Book / Profile). Every SPA route got that same
 * screen until app.ctr576.js (1.6MB) parsed and replaced #app — so a visitor
 * landing on /partner saw a centred search-shaped placeholder and a tab bar
 * missing two of the five real tabs, then watched the whole thing reflow.
 *
 * This module renders the boot screen for the route actually being served:
 * the real five-tab bar with the current tab marked, a skeleton shaped like
 * the page that is coming, and one genuine primary action as a plain <a> so it
 * is tappable before any JavaScript runs. The SPA overwrites #app on boot, so
 * everything here is throwaway markup with no hydration contract.
 *
 * Tab keys, labels, hrefs and icons mirror frontend/public/sg-tabbar.js — that
 * file is the source of truth for the bar on the standalone Reels/ScanSquad
 * pages, and the two bars must not disagree.
 */

const BRAND = '#FF6D00';

const TABS = [
  {
    key: 'reels',
    label: 'Reels',
    href: '/reels',
    icon:
      '<rect x="2" y="2" width="20" height="20" rx="4"></rect>' +
      '<line x1="2" y1="8" x2="22" y2="8"></line>' +
      '<line x1="10" y1="2" x2="10" y2="8"></line>' +
      '<polygon points="10 13 16 16 10 19" fill="rgba(255,255,255,.35)" stroke="none"></polygon>'
  },
  {
    key: 'book',
    label: 'Book',
    href: '/explore',
    icon:
      '<circle cx="11" cy="11" r="7"></circle>' +
      '<line x1="16.5" y1="16.5" x2="21" y2="21"></line>' +
      '<circle cx="11" cy="11" r="2.5" fill="' + BRAND + '" stroke="none"></circle>'
  },
  {
    key: 'creator',
    label: 'ScanSquad',
    href: '/scansquad',
    icon:
      '<rect x="2" y="2" width="20" height="20" rx="4"></rect>' +
      '<circle cx="12" cy="12" r="3" fill="rgba(255,255,255,.3)"></circle>' +
      '<path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke-width="1.5"></path>'
  },
  {
    key: 'partner',
    label: 'Partner',
    href: '/partner',
    icon:
      '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"></path>' +
      '<polyline points="9 22 9 12 15 12 15 22"></polyline>' +
      '<circle cx="12" cy="7" r="1.5" fill="rgba(255,255,255,.3)"></circle>'
  },
  {
    key: 'more',
    label: 'Profile',
    href: '/more/profile',
    icon:
      '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>' +
      '<circle cx="12" cy="7" r="4"></circle>'
  }
];

/**
 * Which tab owns a path. Mirrors tabFor() in app.ctr576.js (line ~732) so the
 * boot bar highlights the same tab the SPA will highlight a second later.
 */
function tabForPath(pathname) {
  const p = normalize(pathname);
  if (/^\/reels(\/|$)/.test(p)) return 'reels';
  if (/^\/(scansquad|creator|creator-hub)(\/|$)/.test(p)) return 'creator';
  if (/^\/(partner|partners|list-your-gym)(\/|$)/.test(p)) return 'partner';
  if (/^\/(more|profile|wallet|settings)(\/|$)/.test(p)) return 'more';
  if (
    p === '/' ||
    /^\/(explore|nearby|search|checkout|booking-success)(\/|$)/.test(p) ||
    /^\/(gym|r)\//.test(p)
  ) {
    return 'book';
  }
  return null;
}

function normalize(pathname) {
  let p = String(pathname || '/').split('?')[0].split('#')[0];
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

/**
 * The one thing a visitor most likely came to do, as a real link.
 *
 * Only routes with a genuine destination get a call to action. Checkout,
 * booking-success and the gym detail page deliberately get none: interrupting
 * a payment or a confirmation with a placeholder button is worse than a plain
 * skeleton. Every href here is a route the server actually serves.
 */
const PRIMARY_ACTIONS = {
  '/': { label: 'Find gyms near me', href: '/nearby' },
  '/explore': { label: 'Find gyms near me', href: '/nearby' },
  '/nearby': { label: 'Browse all gyms', href: '/explore' },
  '/search': { label: 'Browse all gyms', href: '/explore' },
  '/partner': { label: "List your gym — it's free", href: '/list-your-gym' },
  '/partners': { label: "List your gym — it's free", href: '/list-your-gym' },
  '/creator': { label: 'Join ScanSquad', href: '/scansquad' },
  '/creator-hub': { label: 'Join ScanSquad', href: '/scansquad' },
  '/more/profile': { label: 'Sign in', href: '/login' },
  '/profile': { label: 'Sign in', href: '/login' },
  '/wallet': { label: 'Sign in', href: '/login' }
};

function primaryActionFor(pathname) {
  return PRIMARY_ACTIONS[normalize(pathname)] || null;
}

/* ── markup helpers ─────────────────────────────────────────────────────── */

function bar(width, height, extra) {
  return (
    '<div class="skeleton" style="width:' + width + ';height:' + height +
    'px;border-radius:' + (height > 24 ? 14 : 8) + 'px;' + (extra || '') + '"></div>'
  );
}

function tabBar(activeKey) {
  const items = TABS.map(function (t) {
    const active = t.key === activeKey;
    const stroke = active ? BRAND : 'rgba(255,255,255,.4)';
    const color = active ? BRAND : 'rgba(255,255,255,.62)';
    return (
      '<a href="' + t.href + '" aria-label="' + t.label + '"' +
      (active ? ' aria-current="page"' : '') +
      ' style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px;text-decoration:none">' +
      '<svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:' + stroke +
      ';fill:none;stroke-width:1.8">' + t.icon + '</svg>' +
      '<span style="font-size:11px;font-weight:600;letter-spacing:.2px;color:' + color + '">' +
      t.label + '</span></a>'
    );
  }).join('');

  return (
    '<nav id="sg-boot-tabbar" style="position:fixed;bottom:0;left:0;right:0;height:56px;' +
    'background:rgba(8,8,18,.98);display:flex;align-items:center;justify-content:space-around;' +
    'border-top:1px solid rgba(255,255,255,.06);z-index:9000;' +
    'padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:content-box">' +
    items + '</nav>'
  );
}

function cta(action) {
  if (!action) return '';
  return (
    '<a href="' + action.href + '" style="display:block;width:100%;max-width:340px;' +
    'margin:20px auto 0;padding:15px 20px;border-radius:14px;background:' + BRAND + ';' +
    'color:#fff;font-weight:700;font-size:15px;text-align:center;text-decoration:none;' +
    'box-shadow:0 8px 24px rgba(255,109,0,.25)">' + action.label + '</a>'
  );
}

function wordmark(sub) {
  return (
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">' +
    '<span style="font-size:22px">&#127947;</span>' +
    '<span style="font-family:Sora,sans-serif;font-weight:800;font-size:20px;color:#fff">' +
    'Scan<span style="color:' + BRAND + '">Gym</span></span></div>' +
    (sub
      ? '<p style="color:rgba(255,255,255,.55);font-size:14px;margin:-8px 0 20px">' + sub + '</p>'
      : '')
  );
}

function gymCards(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out +=
      '<div style="display:flex;gap:12px;align-items:center;padding:12px;margin-bottom:10px;' +
      'border-radius:16px;background:rgba(255,255,255,.03)">' +
      bar('72px', 72, 'border-radius:12px;flex:none') +
      '<div style="flex:1">' +
      bar('70%', 14, 'margin-bottom:8px') +
      bar('45%', 12, 'margin-bottom:8px') +
      bar('30%', 12, '') +
      '</div></div>';
  }
  return out;
}

/* ── per-tab skeletons ──────────────────────────────────────────────────── */

function bookSkeleton() {
  return (
    wordmark('') +
    bar('100%', 48, 'margin-bottom:10px') +
    bar('100%', 48, 'margin-bottom:18px') +
    '<div style="display:flex;gap:8px;margin-bottom:18px">' +
    bar('88px', 32, '') + bar('72px', 32, '') + bar('96px', 32, '') +
    '</div>' +
    gymCards(3)
  );
}

function gymSkeleton() {
  return (
    bar('100%', 200, 'border-radius:18px;margin-bottom:16px') +
    bar('60%', 22, 'margin-bottom:10px') +
    bar('40%', 14, 'margin-bottom:20px') +
    bar('100%', 52, '')
  );
}

function quietSkeleton(title) {
  return (
    wordmark(title) +
    bar('100%', 64, 'margin-bottom:12px') +
    bar('100%', 64, 'margin-bottom:12px') +
    bar('55%', 14, '')
  );
}

function partnerSkeleton() {
  return (
    wordmark('Your gym, your bookings') +
    '<div style="display:flex;gap:10px;margin-bottom:16px">' +
    bar('50%', 76, 'border-radius:16px') + bar('50%', 76, 'border-radius:16px') +
    '</div>' +
    bar('100%', 120, 'border-radius:16px;margin-bottom:16px') +
    gymCards(2)
  );
}

function creatorSkeleton() {
  return (
    wordmark('Earn by sharing gyms') +
    bar('100%', 110, 'border-radius:18px;margin-bottom:16px') +
    '<div style="display:flex;gap:10px;margin-bottom:16px">' +
    bar('33%', 64, 'border-radius:14px') +
    bar('33%', 64, 'border-radius:14px') +
    bar('33%', 64, 'border-radius:14px') +
    '</div>' +
    gymCards(2)
  );
}

function profileSkeleton() {
  return (
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:22px">' +
    bar('64px', 64, 'border-radius:50%;flex:none') +
    '<div style="flex:1">' + bar('55%', 16, 'margin-bottom:8px') + bar('35%', 12, '') + '</div>' +
    '</div>' +
    bar('100%', 96, 'border-radius:16px;margin-bottom:16px') +
    bar('100%', 52, 'margin-bottom:10px') +
    bar('100%', 52, 'margin-bottom:10px') +
    bar('100%', 52, '')
  );
}

function walletSkeleton() {
  return (
    wordmark('') +
    bar('100%', 120, 'border-radius:18px;margin-bottom:18px') +
    bar('40%', 14, 'margin-bottom:14px') +
    gymCards(2)
  );
}

function defaultSkeleton() {
  return (
    wordmark('') +
    bar('100%', 48, 'margin-bottom:12px') +
    bar('100%', 48, 'margin-bottom:16px') +
    bar('60%', 14, '')
  );
}

function bodyFor(pathname) {
  const p = normalize(pathname);
  if (/^\/gym\//.test(p)) return gymSkeleton();
  if (p === '/checkout') return quietSkeleton('Securing your pass…');
  if (p === '/booking-success') return quietSkeleton('Confirming your booking…');
  if (/^\/(partner|partners)$/.test(p)) return partnerSkeleton();
  if (p === '/list-your-gym') return quietSkeleton('List your gym');
  if (/^\/(creator|creator-hub)$/.test(p)) return creatorSkeleton();
  if (/^\/(more|profile)(\/|$)/.test(p)) return profileSkeleton();
  if (p === '/wallet') return walletSkeleton();
  if (p === '/' || /^\/(explore|nearby|search)$/.test(p)) return bookSkeleton();
  return defaultSkeleton();
}

/**
 * Build the boot screen for a path.
 */
function renderSkeleton(pathname) {
  const activeTab = tabForPath(pathname);
  const action = primaryActionFor(pathname);

  return (
    '<div style="max-width:520px;margin:0 auto;padding:56px 18px 96px">' +
    bodyFor(pathname) +
    cta(action) +
    '</div>' +
    tabBar(activeTab) +
    // The bar is a boot placeholder. sg-tabbar.js hides itself inside an iframe
    // (reels embeds the app), so this one must do the same or an embedded view
    // gets a stray bar for the second before the SPA takes over.
    '<script>(function(){try{if(window.top!==window.self){var n=' +
    'document.getElementById("sg-boot-tabbar");if(n)n.remove();}}catch(e){' +
    'var m=document.getElementById("sg-boot-tabbar");if(m)m.remove();}})();</script>'
  );
}

const START = '<!--boot:start-->';
const END = '<!--boot:end-->';

/**
 * Swap the boot block in the shell for the one belonging to this route.
 * If the markers are missing the shell is returned untouched — a missing
 * skeleton is a cosmetic regression, a thrown error is a blank site.
 */
function applyBootSkeleton(html, pathname) {
  if (typeof html !== 'string') return html;
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  if (start === -1 || end === -1 || end < start) return html;
  return (
    html.slice(0, start + START.length) +
    renderSkeleton(pathname) +
    html.slice(end)
  );
}

module.exports = {
  applyBootSkeleton,
  renderSkeleton,
  tabForPath,
  primaryActionFor,
  TABS,
  START,
  END
};
