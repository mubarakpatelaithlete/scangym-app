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

// ─── v10: ONE database schema ────────────────────────────────────────────────
const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const serverJsFiles = (() => {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  walk(SRV);
  return out;
})();

test('one schema: no server file creates or alters tables outside /migrations', () => {
  const offenders = [];
  for (const p of serverJsFiles) {
    if (p.endsWith(path.join('db', 'migrate.js'))) continue; // the runner is allowed to
    const src = stripComments(fs.readFileSync(p, 'utf8'));
    const m = src.match(/\b(CREATE TABLE|ALTER TABLE|CREATE INDEX|CREATE UNIQUE INDEX|DROP TABLE)\b/i);
    if (m) offenders.push(`${path.relative(SRV, p)} (${m[1]})`);
  }
  assert.deepStrictEqual(offenders, [], 'schema changes belong in a /migrations file, not in server code');
});

test('one schema: every table is created exactly once, and only in /migrations', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
  assert.ok(files.length >= 4, 'the baseline migrations are missing');
  const seen = new Map();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8').replace(/^\s*--.*$/gm, '');
    for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([\w.]+)"?/gi)) {
      const table = m[1].replace(/^public\./, '').toLowerCase();
      assert.ok(!seen.has(table), `table ${table} is created twice (${seen.get(table)} and ${f})`);
      seen.set(table, f);
    }
  }
  assert.ok(seen.size > 50, `expected the full baseline, found ${seen.size} tables`);
});

test('one schema: every migration is idempotent (safe to re-run on the live db)', () => {
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    assert.ok(!/\$\{/.test(sql), `${f} contains a JS template placeholder`);
    // Split on statement boundaries, but keep DO $$ ... $$ blocks whole.
        const body = sql.replace(/^\s*--.*$/gm, '').replace(/DO \$\$[\s\S]*?END \$\$;/g, '');
    for (const raw of body.split(';')) {
      const st = raw.replace(/\s+/g, ' ').trim();
      if (!st) continue;
      if (/^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX)\b/i.test(st)) {
        assert.match(st, /IF NOT EXISTS/i, `${f}: not idempotent -> ${st.slice(0, 80)}`);
      }
      if (/^ALTER TABLE/i.test(st)) {
        assert.ok(/IF NOT EXISTS|IF EXISTS/i.test(st), `${f}: not idempotent -> ${st.slice(0, 80)}`);
      }
      assert.ok(!/^(ALTER|CREATE) .*ADD CONSTRAINT/i.test(st), `${f}: unguarded ADD CONSTRAINT -> ${st.slice(0, 80)}`);
    }
  }
});

test('one schema: user id columns can hold a UUID, because users.id is one', () => {
  const sql = fs.readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .join('\n')
    .replace(/^\s*--.*$/gm, '');
  for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([\w.]+)"?\s*\(([\s\S]*?)\n\)/gi)) {
    const [, table, body] = m;
    const bad = body.split('\n').find((l) => /^\s*\w*user_id\s+(INTEGER|INT|BIGINT|SMALLINT)\b/i.test(l));
    assert.ok(!bad, `${table}: user_id must be VARCHAR/TEXT/UUID, users.id is a UUID -> ${(bad || '').trim()}`);
  }
});

test('one schema: exactly one connection pool', () => {
  const pools = serverJsFiles.filter((p) => /new Pool\(/.test(stripComments(fs.readFileSync(p, 'utf8'))));
  assert.deepStrictEqual(pools.map((p) => path.relative(SRV, p)), [path.join('middleware', 'db.js')]);
});

test('one schema: the migration runner is wired into startup', () => {
  const runner = require(path.join(SRV, 'db', 'migrate.js'));
  assert.strictEqual(typeof runner.runMigrations, 'function');
  const files = runner.migrationFiles();
  assert.deepStrictEqual(files, [...files].sort(), 'migrations must run in filename order');
  const server = fs.readFileSync(path.join(SRV, 'server.js'), 'utf8');
  assert.match(server, /require\('\.\/db\/migrate'\)/, 'server.js does not run the migrations');
});

test('one schema: routes the frontend calls are actually mounted', () => {
  const server = fs.readFileSync(path.join(SRV, 'server.js'), 'utf8');
  for (const p of ['/api/ai-trainer', '/api/gym-mgmt']) {
    assert.ok(server.includes(`app.use('${p}'`), `${p} is called by the app but never mounted`);
  }
});

// ─── v11: ONE location engine, ONE toast ─────────────────────────────────────
test('one location engine: only location.js talks to the browser geolocation API', () => {
  const offenders = [];
  for (const f of jsFiles) {
    if (f === 'location.js') continue;
    const s = stripComments(read(f));
    if (/navigator\.geolocation\.(getCurrentPosition|watchPosition)\s*\(/.test(s)) offenders.push(f);
  }
  // app.ctr576.js keeps one live watchPosition for the fast first fix; nothing else may ask.
  assert.deepStrictEqual(offenders, ['app.ctr576.js'], 'ask window.sgLocation instead of the browser directly');
  const core = stripComments(read('app.ctr576.js'));
  assert.ok(!/navigator\.geolocation\.getCurrentPosition\s*\(/.test(core), 'core must use sgLocation.get(), not its own one-off GPS calls');
});

test('one location engine: one cache key, and the old ones are migrated away', () => {
  const engine = read('location.js');
  assert.match(engine, /window\.sgLocation\s*=/, 'the location engine is gone');
  assert.match(engine, /CACHE_KEY\s*=\s*'sg_gps'/);
  assert.match(engine, /LEGACY_KEYS\s*=\s*\['scangym_last_location', 'sg_location_cache'\]/);
  for (const f of jsFiles) {
    const s = stripComments(read(f));
    if (f !== 'location.js') {
      assert.ok(!/'scangym_last_location'|'sg_location_cache'/.test(s), `${f} still reads an old location cache key`);
      assert.ok(!/localStorage\.(get|set)Item\('sg_gps'/.test(s), `${f} reads/writes the location cache directly instead of via sgLocation`);
    }
  }
});

test('one location engine: it is loaded, and the file it replaced is gone', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(html.includes('/location.js'), 'location.js is not loaded');
  assert.ok(!html.includes('robust-location.js'), 'the old location file is still referenced');
  assert.ok(!fs.existsSync(path.join(PUB, 'robust-location.js')), 'robust-location.js still exists');
  assert.ok(html.indexOf('/location.js') < html.indexOf('<script src="/app.ctr576.js'), 'the engine must load before the app');
});

test('one toast: sgToast is defined exactly once', () => {
  const defs = jsFiles.filter((f) => /window\.sgToast\s*=\s*function/.test(stripComments(read(f))));
  assert.deepStrictEqual(defs, ['app.ctr576.js']);
  assert.match(read('app.ctr576.js'), /navigator\.onLine === false|navigator\.onLine===false/, 'the offline hint was lost when the wrapper was removed');
});
