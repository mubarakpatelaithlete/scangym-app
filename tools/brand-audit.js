#!/usr/bin/env node
'use strict';

/**
 * Brand audit — one CTA and one orange per tab, measured on the rendered page.
 *
 * Why this exists
 * ---------------
 * tests/one-orange.test.js and tests/one-cta.test.js grep one-orange.css and
 * one-cta.css for selectors. That catches a rule that was written wrongly. It
 * cannot catch the failure that actually keeps happening: an element that
 * paints itself brand orange and was never added to the stylesheet at all, so
 * there is nothing for a text search to find. one-cta.test.js says so in its
 * own comments — "Caught only by auditing the live site; every static test
 * still passed."
 *
 * Two such elements were live when this file was written:
 *   • .sg-brand-circle — the "S" watermark, one per reel card, so Reels showed
 *     four orange logos at once.
 *   • #sg-sps — the social-proof strip, injected by app-patches-v3.js three
 *     seconds after paint, orange, full width, on Book and Profile.
 *
 * Neither appeared in one-orange.css. Both are obvious the moment you count
 * pixels on the real page, which is what this does.
 *
 * Usage
 *   node tools/brand-audit.js [baseUrl]        # default https://scangym.com
 *   npm run brand:audit
 *
 * Exit code 0 = every tab obeys the rule. 1 = at least one violation.
 * Requires playwright (a devDependency; CI installs it).
 */

const TABS = [
  ['Reels', '/reels'],
  ['Book', '/explore'],
  ['ScanSquad', '/scansquad'],
  ['Partner', '/partner'],
  ['Profile', '/more/profile'],
];

// The strip is injected on a 3s timer, so a shorter settle would report a
// clean page that is about to sprout a second orange surface.
const SETTLE_MS = 6000;

/** Runs in the page. Returns the orange surfaces and CTA-ish elements a user can see. */
const COLLECT = `() => {
  const ORANGE = /(255,\\s*109,\\s*0)|#ff6d00/i;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    if (r.bottom < 0 || r.top > innerHeight) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
  };
  // The bottom tab bar is navigation, not a call to action, and its active tab
  // is meant to be orange. Excluded by design — see one-cta.test.js.
  const inTabBar = (el) => !!el.closest('#sg-tabbar,#sg-boot-tabbar,.sg-tab-bar,nav');
  const label = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40);
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.id || null,
      cls: String(el.className || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.') || null,
      tag: el.tagName.toLowerCase(),
      w: Math.round(r.width), h: Math.round(r.height),
      text: label(el),
    };
  };

  const orange = [];
  document.querySelectorAll('*').forEach((el) => {
    if (!visible(el) || inTabBar(el)) return;
    const s = getComputedStyle(el);
    if (!ORANGE.test(s.backgroundColor) && !ORANGE.test(s.backgroundImage)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 16) return;
    // An orange child inside an orange parent is one surface, not two.
    if (orange.some((o) => o.el.contains(el))) return;
    orange.push({ el, info: describe(el) });
  });

  const ctas = [];
  document.querySelectorAll('button,a,[role=button],[onclick]').forEach((el) => {
    if (!visible(el) || inTabBar(el)) return;
    const s = getComputedStyle(el);
    const filled = ORANGE.test(s.backgroundColor) || ORANGE.test(s.backgroundImage);
    if (filled) ctas.push(describe(el));
  });

  return { orange: orange.map((o) => o.info), ctas };
}`;

async function main() {
  const base = (process.argv[2] || 'https://scangym.com').replace(/\/$/, '');
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('brand-audit needs playwright.  npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });

  const failures = [];
  console.log(`Brand audit — ${base}\n`);

  for (const [name, path] of TABS) {
    const page = await ctx.newPage();
    let res;
    try {
      await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(SETTLE_MS);
      res = await page.evaluate(`(${COLLECT})()`);
    } catch (err) {
      failures.push(`${name}: could not be audited — ${err.message}`);
      await page.close();
      continue;
    }
    await page.close();

    const extraOrange = res.orange.filter((o) => !/-fab$/.test(o.id || ''));
    const ok = res.ctas.length === 1 && extraOrange.length === 0;

    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(10)} ${path}`);
    console.log(`        orange CTAs: ${res.ctas.length}   other orange surfaces: ${extraOrange.length}`);
    for (const c of res.ctas) console.log(`          CTA    ${c.w}x${c.h} #${c.id || '-'} ${JSON.stringify(c.text)}`);
    for (const o of extraOrange) console.log(`          ORANGE ${o.w}x${o.h} <${o.tag}> #${o.id || '-'} .${o.cls || '-'}`);

    if (res.ctas.length !== 1) {
      failures.push(`${name}: ${res.ctas.length} orange CTAs, expected exactly 1`);
    }
    for (const o of extraOrange) {
      failures.push(`${name}: extra orange surface <${o.tag}> #${o.id || '-'} .${o.cls || '-'} (${o.w}x${o.h})`);
    }
  }

  await browser.close();

  if (failures.length) {
    console.error(`\n${failures.length} violation(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\nFix by demoting the element in frontend/public/one-orange.css.');
    process.exit(1);
  }
  console.log('\nAll tabs: exactly one CTA, exactly one orange. ✅');
}

main().catch((e) => { console.error(e); process.exit(2); });
