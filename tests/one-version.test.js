/**
 * Guards for the "one single version" clean-up (one single version clean-up).
 *
 * These are deliberately dumb text checks on the shipped files. Every one of
 * them corresponds to a duplicate we deleted; if a future patch re-adds its own
 * bottom bar, its own price string, its own card fetch or its own sky-high
 * z-index, this fails instead of the duplicate quietly coming back.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const SRV = path.join(__dirname, '..', 'server');
const jsFiles = fs.readdirSync(PUB).filter((f) => f.endsWith('.js') && f !== 'sw.js');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
/* Comments are allowed to mention what we deleted (that is the point of them),
   so the guards look at code with comments stripped. */
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const all = () => jsFiles.map((f) => [f, stripComments(read(f))]);

test('one bottom bar: no file re-creates a second continue banner', () => {
  const banned = ['partner-continue-banner', 'creator-continue-banner', 'profile-continue-banner'];
  for (const [f, s] of all()) {
    for (const id of banned) {
      assert.ok(!s.includes(id), `${f} references deleted banner id ${id} — use window.sgBottomBar instead`);
    }
  }
});

test('one bottom bar: only app.ctr576.js creates #sg-continue-banner', () => {
  for (const [f, s] of all()) {
    if (f === 'app.ctr576.js') continue;
    assert.ok(!/id\s*=\s*["']sg-continue-banner/.test(s) && !/createElement\([^)]*\)[^;]*sg-continue-banner/.test(s),
      `${f} builds the bottom bar itself — call window.sgBottomBar.show(owner, {...})`);
  }
});

test('one price source: no hardcoded pass prices or currency fallbacks', () => {
  const price = /[£$€]\s?(4\.49|11\.99|22\.49|44\.99|44\.90|6\.99)/g;
  const fallback = /currencySymbol\s*\|\|\s*['"]£['"]/;
  for (const [f, s] of all()) {
    if (f === 'pricing.js') continue; // the one source
    /* Allowed: a literal kept as the fallback of a sgPriceDisplay() call. */
    const offenders = [...s.matchAll(price)].filter((m) => !s.slice(Math.max(0, m.index - 60), m.index).includes('sgPriceDisplay'));
    assert.equal(offenders.length, 0, `${f} hardcodes a pass price (${offenders.map((m) => m[0]).join(', ')}) — use sgPriceDisplay()/sgAmount() from pricing.js`);
    assert.ok(!fallback.test(s), `${f} hardcodes a currency fallback — use pricing.js`);
  }
});

test('one payment path: nothing calls /api/payments or the card endpoints directly', () => {
  for (const [f, s] of all()) {
    assert.ok(!s.includes('/api/payments/'), `${f} uses the deleted /api/payments prefix`);
    if (f === 'app.ctr576.js') {
      const direct = s.match(/fetch\(\s*['"]\/api\/payment\/(saved-cards|setup-card|confirm-setup|set-default-card)/g) || [];
      assert.equal(direct.length, 0, `app.ctr576.js fetches card endpoints directly (${direct.join(', ')}) — use window.sgCards`);
    } else {
      assert.ok(!/\/api\/payment\/(saved-cards|setup-card|confirm-setup|set-default-card)/.test(s),
        `${f} talks to the card endpoints directly — use window.sgCards`);
    }
    assert.ok(!s.includes('/api/payment/setup-intent') && !s.includes('/api/payment/confirm-card'),
      `${f} uses a deleted alias endpoint`);
    assert.ok(!s.includes('/api/payment/guest-checkout'), `${f} calls the endpoint that never existed`);
  }
});

test('window.sgCards is the single card API and exposes the whole flow', () => {
  const s = read('app.ctr576.js');
  for (const m of ['listRaw', 'list', 'defaultCard', 'setDefault', 'remove', 'saveCard']) {
    assert.ok(new RegExp('\\b' + m + '\\s*[:(]').test(s), `window.sgCards.${m} is missing`);
  }
});

test('one z-index scale: no sky-high literals anywhere', () => {
  const files = [...all(), ['index.html', fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')]];
  for (const [f, s] of files) {
    for (const m of s.matchAll(/z-index:\s*(\d{4,})/g)) {
      assert.ok(Number(m[1]) <= 11500, `${f} sets z-index:${m[1]} — use the --sg-z-* scale in app.ctr576.js`);
    }
  }
});

test('the z-index scale itself is defined and ordered', () => {
  const s = read('app.ctr576.js');
  const m = s.match(/:root\{--sg-z-bottom-bar:(\d+);--sg-z-tab-bar:(\d+);--sg-z-sheet:(\d+);--sg-z-usp:(\d+);--sg-z-overlay:(\d+);--sg-z-toast:(\d+);--sg-z-confetti:(\d+)\}/);
  assert.ok(m, 'the :root --sg-z-* scale is missing from app.ctr576.js');
  const nums = m.slice(1).map(Number);
  for (let i = 1; i < nums.length; i++) {
    assert.ok(nums[i] > nums[i - 1], `the scale is out of order at position ${i}: ${nums.join(' < ')}`);
  }
});

test('no dead API routes are called: server 404s unknown /api paths', () => {
  const s = fs.readFileSync(path.join(SRV, 'server.js'), 'utf8');
  assert.ok(/app\.all\(\s*\/\^\\\/\(api\|mcp\)\\\//.test(s) || /api\|mcp/.test(s),
    'the JSON 404 guard for unknown /api and /mcp routes is gone');
});

test('server mounts one payment prefix', () => {
  const s = fs.readFileSync(path.join(SRV, 'server.js'), 'utf8');
  assert.ok(!/app\.use\(\s*['"]\/api\/payments['"]/.test(s), "the second '/api/payments' mount is back");
});

test('deleted server routes stay deleted', () => {
  const s = fs.readFileSync(path.join(SRV, 'routes', 'payment.js'), 'utf8');
  for (const r of ["'/setup-intent'", "'/confirm-card'", "'/admin-add-card'"]) {
    assert.ok(!s.includes('router.post(' + r), `payment.js re-added ${r}`);
  }
  assert.ok(!/paymentMethods\.create\(\s*\{[^}]*number/s.test(s),
    'payment.js takes a raw card number again — card details must only reach Stripe.js');
});

/* ── v7: ONE withdraw / payout sheet ─────────────────────────────────
   The unified sheet lives in wallet-withdraw.js (_sgWalletWithdraw /
   _sgWalletAddMethod). The old per-tab wallet sheets in app.ctr576.js and
   their round2 / batch3 / continue-cta-flow copies were deleted. */
test('one withdraw sheet: only wallet-withdraw.js builds one', () => {
  for (const [f, s] of all()) {
    if (f === 'wallet-withdraw.js') continue;
    assert.ok(!/_sgOpenSheet\(\s*['"]sg-(creator|partner)-wallet-sheet/.test(s),
      `${f} rebuilds an old per-tab wallet sheet — the unified one is _sgWalletWithdraw()`);
  }
  assert.ok(/window\._sgWalletWithdraw\s*=/.test(read('wallet-withdraw.js')),
    'the unified withdraw sheet (_sgWalletWithdraw) is gone');
});

test('one withdraw sheet: the deleted old handlers stay deleted', () => {
  const gone = ['_sgLoadCreatorWallet', '_sgLoadPartnerWallet', '_ctaSaveWithdrawMethod',
    '_ctaConfirmWithdraw', '_showConfirmWithdrawSheet', '_showAddWithdrawSheet',
    '_ctaSelectWithdrawOpt', 'r2ShowAddWithdrawSheet', 'fixWithdraw'];
  for (const [f, s] of all()) {
    for (const n of gone) {
      assert.ok(!new RegExp(`(window\\.${n}\\s*=|function\\s+${n}\\s*\\()`).test(s),
        `${f} re-added ${n} — withdrawals must go through _sgWalletWithdraw()`);
    }
  }
});

test('one withdraw sheet: every legacy withdraw name routes to the unified one', () => {
  const s = all().map(([, x]) => x).join('\n');
  for (const n of ['_creatorWithdraw', '_partnerWithdraw', '_sgCreatorWithdraw',
    '_sgCreatorWithdrawToBank', '_sgPartnerWithdrawToBank',
    '_sgCreatorAddWithdrawMethod', '_sgPartnerAddWithdrawMethod']) {
    for (const m of s.matchAll(new RegExp(`window\\.${n}\\s*=\\s*(?:async\\s*)?function[^;]{0,400}`, 'g'))) {
      assert.ok(/_sgWalletWithdraw|_sgWalletAddMethod|_sgUnifiedWithdraw/.test(m[0]),
        `${n} was given its own withdraw logic again instead of calling the unified sheet`);
    }
  }
});

test('no /api/referrals/withdraw or payout-request call outside the unified sheet', () => {
  for (const [f, s] of all()) {
    if (f === 'wallet-withdraw.js') continue;
    assert.ok(!/\/api\/(referrals\/withdraw|gym-partner\/withdraw-request)/.test(s),
      `${f} posts a withdrawal itself — only wallet-withdraw.js may talk to the payout API`);
  }
});

// ─── v8: ONE admin / CEO dashboard ───────────────────────────────────────────
test('one admin dashboard: only admin-dashboard.js builds it', () => {
  for (const [f, s] of all()) {
    if (f === 'admin-dashboard.js') continue;
    assert.ok(!/_sgAdminDashboardPage\s*=\s*function/.test(s),
      `${f} defines a second admin dashboard page builder`);
  }
  const admin = read('admin-dashboard.js');
  assert.ok(/window\._sgAdminDashboardPage\s*=\s*function/.test(admin),
    'the real admin dashboard page builder is gone');
});

test('one admin dashboard: the old CEO page stays deleted', () => {
  const gone = ['sgLoadCeoStats', 'sgCeoExport', '_loadAdminStatus'];
  const app = read('app.ctr576.js');
  for (const n of gone) {
    assert.ok(!new RegExp(`(window\\.${n}\\s*=\\s*(?:async\\s*)?function|function\\s+${n}\\s*\\()`).test(app),
      `app.ctr576.js re-added ${n} — the old CEO dashboard is replaced by admin-dashboard.js`);
  }
  assert.ok(!/ceo-metric-val|id="ceo-bookings"|ceo-period-bar/.test(app),
    'app.ctr576.js still renders the old CEO dashboard markup');
});

test('one admin dashboard: DashboardPage/CeoDashboardPage only route to the new page', () => {
  const s = all().map(([, x]) => x).join('\n');
  const defs = [...s.matchAll(/window\.(?:DashboardPage|CeoDashboardPage)\s*=[\s\S]{0,400}?\n};/g)];
  assert.ok(defs.length >= 1, 'nothing defines DashboardPage/CeoDashboardPage any more');
  for (const m of defs) {
    assert.ok(/_sgAdminDashboardPage|_sgAdminDashboardBoot/.test(m[0]),
      'a dashboard entry point renders its own page instead of the one admin dashboard');
  }
  assert.ok(!/^function\s+(DashboardPage|CeoDashboardPage)\s*\(/m.test(read('app.ctr576.js')),
    'app.ctr576.js still declares its own DashboardPage/CeoDashboardPage function');
});

test('one admin stats endpoint: /api/stats/admin-status is gone', () => {
  const stats = fs.readFileSync(path.join(SRV, "routes", "stats.js"), 'utf8');
  assert.ok(!/['"]\/admin-status['"]/.test(stats),
    'the old /api/stats/admin-status route is back — admin metrics come from /api/stats/admin-dashboard (admin-only auth)');
  for (const [f, s] of all()) {
    assert.ok(!/\/api\/stats\/admin-status/.test(s),
      `${f} still calls the deleted /api/stats/admin-status`);
  }
});

// ─── v9: ONE chat engine ─────────────────────────────────────────────────────
test('one chat engine: only chat-agent.js implements the chat', () => {
  const engine = read('chat-agent.js');
  assert.ok(/window\.sgChatAgent\s*=\s*\{\s*create/.test(engine), 'the chat engine factory is gone');
  for (const f of ['partner-chat.js', 'squad-chat.js']) {
    const s = stripComments(read(f));
    assert.ok(/window\.sgChatAgent\.create\(/.test(s), `${f} no longer uses the shared chat engine`);
    // A personality file is configuration: no streaming, no rendering, no styles.
    for (const re of [/getReader\(/, /new TextDecoder/, /injectStyles/, /document\.createElement\('style'\)/,
      /SpeechRecognition/, /getBoundingClientRect/]) {
      assert.ok(!re.test(s), `${f} re-implements chat machinery (${re}) instead of configuring chat-agent.js`);
    }
    assert.ok(s.split('\n').length < 200, `${f} is growing its own copy of the chat again`);
  }
});

test('one chat engine: each chat keeps its own namespace and endpoint', () => {
  const p = read('partner-chat.js');
  const s = read('squad-chat.js');
  assert.ok(/ns:\s*'pchat'/.test(p) && /endpoint:\s*'\/api\/partner\/agent'/.test(p));
  assert.ok(/ns:\s*'schat'/.test(s) && /endpoint:\s*'\/api\/squad\/agent'/.test(s));
  assert.ok(!/'pchat'/.test(s) && !/'schat'/.test(p), 'the two chats share a DOM namespace');
});

test('one chat engine: chat-agent.js loads before the two personalities', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const at = (f) => html.indexOf(f);
  assert.ok(at('chat-agent.js') > -1, 'chat-agent.js is not in index.html');
  assert.ok(at('chat-agent.js') < at('partner-chat.js'), 'chat-agent.js must be before partner-chat.js');
  assert.ok(at('chat-agent.js') < at('squad-chat.js'), 'chat-agent.js must be before squad-chat.js');
});
