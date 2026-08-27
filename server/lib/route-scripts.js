'use strict';

/**
 * Route-aware script priority.
 *
 * index.html loads the same scripts in the same order for every SPA route:
 * a block of deferred patch scripts, then an inline loader that fetches ten
 * more "non-first-paint" scripts at idle after the load event.
 *
 * That list was written from the point of view of the Book tab, and it is
 * wrong for the other tabs. partner-editable.js *is* the Partner tab — it
 * renders the whole page — but it sits in the idle bucket, so on a mid-range
 * phone the Partner tab's real content painted at ~6.4s (measured live, 4x CPU
 * throttle) while the visitor stared at a skeleton. Meanwhile every route pays
 * boot cost for three chat personalities when at most one of them belongs to
 * the tab being served.
 *
 * This module re-prioritises that list for the route actually being requested:
 *
 *   - PROMOTE the script that renders this route out of the idle bucket into a
 *     normal deferred tag, so it parses with the app instead of after it.
 *   - DEMOTE the scripts this route cannot use (the other tabs' chat
 *     personalities) out of the boot path into the idle bucket.
 *
 * Nothing is ever dropped. This is a single-page app: a visitor who lands on
 * /partner and taps through to Book still needs book-chat.js, so demoted
 * scripts still load — just at idle, after the tab in front of the user is
 * interactive. Priority changes, capability does not.
 *
 * Everything here is a best-effort rewrite of the shipped HTML. If a tag or
 * the loader array is not found (index.html was restructured, a filename was
 * bumped), the html is returned untouched — a missed optimisation is invisible,
 * a thrown error is a blank site.
 */

// The script that renders each area of the app, and therefore must not wait
// for idle when that area is what was requested. Key = script filename.
const RENDERERS = {
  'partner-editable.js': ['partner'],
  'wallet-withdraw.js': ['wallet'],
  'admin-dashboard.js': ['admin'],
  // batch3.js draws the "Get ID verified" row, which is the LCP element of the
  // Profile tab — it was sitting in the idle bucket, so the largest element on
  // that tab painted at 1732ms (live, 4x CPU throttle). Same class of
  // mis-bucketing this module was written to fix for partner-editable.js.
  'batch3.js': ['profile'],
};

/**
 * Scripts that must not load at all for areas that cannot use them.
 *
 * This is the one deliberate exception to "priority changes, capability does
 * not" below, and it is safe only because the app bundle already knows how to
 * cope with the file being absent: DashboardPage() renders a placeholder and
 * calls window.sgLoadScript() to fetch it on demand.
 *
 * admin-dashboard.js is 18.6KB that every anonymous visitor downloaded, parsed
 * and then kept warm with a 60-second polling interval, to render a dashboard
 * only staff can open. Value = key is the area allowed to preload it.
 */
const ADMIN_ONLY = {
  'admin-dashboard.js': 'admin',
};

// One chat engine, one personality per tab. The personality for the tab being
// served stays in the boot path; the other two go to idle.
const CHATS = {
  'partner-chat.js': 'partner',
  'squad-chat.js': 'creator',
  'book-chat.js': 'book',
  // areaFor() has no 'reels' area — /reels falls through to 'book' — so the Reels
  // personality is grouped with Book. That is deliberate: it keeps this module's
  // area list and the test that pins it unchanged, and the two tabs share both an
  // agent endpoint and a visitor, who very often goes straight from a reel to
  // booking the gym in it.
  'reels-chat.js': 'book',
  'profile-chat.js': 'profile',
};

/**
 * Which area of the app a path belongs to. Mirrors the route groups used by
 * boot-skeleton.js / route-meta.js.
 * @param {string} pathname
 * @returns {string} area key: partner | creator | wallet | admin | profile | book
 */
function areaFor(pathname) {
  const p = String(pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (p === '/partner' || p.startsWith('/partner/') || p === '/partners' || p === '/list-your-gym') return 'partner';
  if (p === '/creator' || p.startsWith('/creator') || p === '/scansquad') return 'creator';
  if (p === '/wallet' || p.startsWith('/wallet/')) return 'wallet';
  if (p.startsWith('/admin')) return 'admin';
  if (p === '/profile' || p === '/more/profile' || p.startsWith('/more')) return 'profile';
  return 'book';
}

/** Escape a string for use inside a RegExp. */
function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the inline idle-loader array and return its entries plus the exact
 * source text of the array literal, so it can be rewritten in place.
 * @param {string} html
 * @returns {{entries: string[], literal: string}|null}
 */
function readLazyArray(html) {
  const m = html.match(/var\s+LAZY\s*=\s*(\[[^\]]*\])\s*;/);
  if (!m) return null;
  const entries = [];
  const re = /'([^']+)'/g;
  let hit;
  while ((hit = re.exec(m[1])) !== null) entries.push(hit[1]);
  if (!entries.length) return null;
  return { entries, literal: m[1] };
}

/** '/partner-editable.js?v=1.3' -> 'partner-editable.js' */
function fileOf(src) {
  return String(src).split('?')[0].split('/').filter(Boolean).pop() || '';
}

/**
 * Re-prioritise the boot scripts in the shipped shell for one route.
 * @param {string} html  full index.html
 * @param {string} pathname  the request path
 * @returns {string} html with scripts re-prioritised, or the input unchanged
 */
function applyRouteScripts(html, pathname) {
  if (typeof html !== 'string' || !html) return html;

  try {
    const area = areaFor(pathname);
    const lazy = readLazyArray(html);
    if (!lazy) return html;

    let out = html;
    let entries = lazy.entries.slice();
    const promoted = [];

    // 1. Promote this area's renderer out of the idle bucket.
    for (const [file, areas] of Object.entries(RENDERERS)) {
      if (!areas.includes(area)) continue;
      const idx = entries.findIndex((e) => fileOf(e) === file);
      if (idx === -1) continue;
      promoted.push(entries[idx]);
      entries.splice(idx, 1);
    }

    // 1b. Drop admin-only scripts for every other area (loaded on demand).
    for (const [file, owner] of Object.entries(ADMIN_ONLY)) {
      if (owner === area) continue;
      const idx = entries.findIndex((e) => fileOf(e) === file);
      if (idx !== -1) entries.splice(idx, 1);
    }

    // 2. Demote the chat personalities this route cannot use.
    const demoted = [];
    for (const [file, owner] of Object.entries(CHATS)) {
      if (owner === area) continue;
      const tag = out.match(new RegExp('\\n?[ \\t]*<script[^>]*src="/' + esc(file) + '(\\?[^"]*)?"[^>]*></script>', 'i'));
      if (!tag) continue;
      const src = tag[0].match(/src="([^"]+)"/i);
      if (!src) continue;
      out = out.replace(tag[0], '');
      demoted.push(src[1]);
    }

    // Demoted scripts load after everything already in the idle bucket that
    // the current route might still want, but before nothing — order inside
    // the bucket is the order they were listed in the shell.
    entries = entries.concat(demoted);

    // 3. Write the new idle list back into the inline loader.
    const literal = '[' + entries.map((e) => "'" + e + "'").join(',') + ']';
    out = out.replace(lazy.literal, literal);

    // 4. Emit promoted scripts as ordinary deferred tags, immediately before
    //    the inline loader, so they keep their position relative to the
    //    scripts they patch (app.ctr576.js, continue-cta-flow.js ...).
    if (promoted.length) {
      const anchor = out.match(/[ \t]*<script>\s*\n?\s*\/\* PERF/);
      const tags = promoted
        .map((src) => '<script src="' + src + '" defer data-sg-priority="route"></script>')
        .join('\n');
      if (anchor) {
        out = out.replace(anchor[0], '\n' + tags + '\n' + anchor[0]);
      } else {
        // No anchor: fall back to just before </body> — still eager, still
        // ordered after the app bundle.
        out = out.replace(/<\/body>/i, tags + '\n</body>');
      }
    }

    return out;
  } catch (e) {
    return html;
  }
}

module.exports = { applyRouteScripts, areaFor };
