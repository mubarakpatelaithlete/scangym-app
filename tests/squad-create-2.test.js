/**
 * ScanSquad 2.0 — the rules that stop Create costing us money, and the ones
 * that make a creation worth having.
 *
 * Each test here is a bug we found by using the product as a customer on
 * 2026-09-17, not a hypothetical:
 *
 *  - A signed-out request rendered a $3.78 Seedance clip. The cap was five
 *    clips a day per IP, so one visitor could spend $18.90 and a new IP reset
 *    it. Both halves are covered: /generate demands a creator, and spend is
 *    priced in dollars against what that creator has earned us.
 *  - The sheet said "usually under a minute" for a render measured at 226
 *    seconds, and offered no way to be told when it finished.
 *  - A creator could generate a clip, an image and a caption and own none of
 *    them afterwards.
 *  - Model chips read "Seedance 2.5" and "WAN 3.0", which is a vendor release
 *    name, not an answer to "which one do I tap".
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const spend = require(path.join(ROOT, 'server', 'lib', 'gen-budget'));
const eta = require(path.join(ROOT, 'server', 'lib', 'gen-eta'));
const templates = require(path.join(ROOT, 'server', 'lib', 'gen-templates'));
const models = require(path.join(ROOT, 'server', 'lib', 'gen-models'));
const jobs = require(path.join(ROOT, 'server', 'lib', 'gen-jobs'));
const notify = require(path.join(ROOT, 'server', 'lib', 'gen-notify'));

const ROUTES = ['squad-video', 'squad-image', 'squad-audio', 'squad-music', 'squad-text'];

/** A budget in the shape budgetFor() returns, without touching a database. */
function budget(over = {}) {
  return {
    signedIn: true, tier: 'starter', conversions: 0,
    dailyUsd: 0.6, spentUsd: 0, remainingUsd: 0.6, degraded: false, ...over,
  };
}

// ─── 1. Nobody spends our money anonymously ───────────────────────────────

test('every Create /generate is behind the login gate', () => {
  for (const name of ROUTES) {
    const router = require(path.join(ROOT, 'server', 'routes', name));
    const layer = router.stack.find((l) => l.route && l.route.path === '/generate' && l.route.methods.post);
    assert.ok(layer, `${name} has no POST /generate`);
    const names = layer.route.stack.map((h) => h.handle.name);
    /* requireBillable is requireCreator plus the postpaid checks (a saved card,
       an unpaid balance under the cap, not suspended) — Create bills after the
       render, so the login gate alone is no longer enough.
       @see server/lib/gen-guard.js, server/lib/gen-billing.js */
    assert.ok(
      names.includes('requireCreator') || names.includes('requireBillable'),
      `${name} /generate must require a signed-in creator — a signed-out caller rendered a $3.78 clip on 2026-09-17`,
    );
  }
});

test('a signed-out caller is refused before anything is priced', () => {
  const out = spend.verdict(budget({ signedIn: false, dailyUsd: 0, remainingUsd: 0 }), 3.78);
  assert.equal(out.status, 401);
  assert.equal(out.body.needsLogin, true);
});

test('a free generation still works signed in — the house writer is not gated behind money', () => {
  assert.equal(spend.verdict(budget(), null), null);
  assert.equal(spend.verdict(budget(), 0), null);
});

// ─── 2. The unit is money, and it grows with what a creator earns ─────────

test('a starter creator can run the cheap models and not the premium ones', () => {
  const b = budget();
  assert.equal(spend.verdict(b, 0.4), null, 'Grok Imagine at $0.40 is inside a starter budget');
  const refused = spend.verdict(b, 3.78);
  assert.equal(refused.status, 402);
  assert.equal(refused.body.needsBudget, true);
  assert.match(refused.body.error, /£/, 'the creator is told the price in their own currency');
});

test('spend already made today comes off the budget', () => {
  const refused = spend.verdict(budget({ spentUsd: 0.5, remainingUsd: 0.1 }), 0.4);
  assert.equal(refused.status, 402);
  assert.match(refused.body.error, /left/);
});

test('a pro creator who drives bookings can reach the premium models', () => {
  // pro floor $10, and every booking adds a quarter on top.
  assert.equal(spend.verdict(budget({ tier: 'pro', dailyUsd: 10, remainingUsd: 10 }), 3.78), null);
});

test('an unreachable ledger allows the render rather than faking an outage', () => {
  assert.equal(spend.verdict(budget({ degraded: true, remainingUsd: 0 }), 3.78), null);
});

test('anonymous budget is zero, not undefined — the sheet renders a number', async () => {
  const b = await spend.budgetFor({ ip: '1.2.3.4' });
  assert.equal(b.signedIn, false);
  assert.equal(b.dailyUsd, 0);
  assert.equal(b.remainingUsd, 0);
});

test('the tier floors climb, and nothing exceeds the daily maximum', () => {
  const floors = spend.TIER_FLOOR_USD;
  assert.ok(floors.starter < floors.rising && floors.rising < floors.pro && floors.pro <= floors.legend);
  assert.ok(floors.legend <= spend.MAX_DAILY_USD);
  assert.ok(spend.PER_CONVERSION_USD > 0, 'driving a booking has to be worth something');
});

test('the catalogue says which models this creator can afford, and why not', () => {
  const rows = spend.annotate(models.catalogueFor('video', { seconds: 8 }), budget());
  assert.ok(rows.length >= 4);
  assert.ok(rows.some((r) => r.affordable), 'a starter must be able to make something');
  const locked = rows.filter((r) => !r.affordable);
  for (const row of locked) assert.equal(row.lockedReason, 'budget');
  // Nothing is hidden: the ladder has to be visible to be worth climbing.
  assert.equal(rows.length, models.catalogueFor('video', { seconds: 8 }).length);
});

// ─── 3. Honest waiting times ──────────────────────────────────────────────

test('the ETA is the measured time, not "under a minute"', () => {
  assert.equal(eta.etaSeconds('video', 'seedance-2.5', { seconds: 8 }), 226);
  assert.equal(eta.etaSeconds('video', 'grok-imagine-video', { seconds: 8 }), 73);
  assert.equal(eta.etaSeconds('image', 'gpt-image-2.5'), 21);
  assert.ok(eta.etaSeconds('video', 'kling-3.0-pro', { seconds: 8 }) > 60,
    'a 2-minute render must never be described as under a minute');
});

test('a longer clip is quoted a longer wait', () => {
  const short = eta.etaSeconds('video', 'wan-3.0', { seconds: 4 });
  const long = eta.etaSeconds('video', 'wan-3.0', { seconds: 8 });
  assert.ok(long > short);
});

test('an untimed model still gets a sane estimate rather than nothing', () => {
  assert.ok(eta.etaSeconds('video', 'a-model-we-have-never-run', { seconds: 8 }) > 0);
});

test('time remaining never goes negative, and reads as a sentence', () => {
  assert.equal(eta.remainingSeconds(100, 140), null);
  assert.equal(eta.phrase(eta.remainingSeconds(100, 140)), 'any moment now');
  assert.match(eta.phrase(180), /minutes/);
  assert.match(eta.phrase(20), /seconds/);
});

test('only slow jobs are worth an email', () => {
  assert.equal(eta.worthNotifying(1.4), false, 'a caption that took 1.4s is not news');
  assert.equal(eta.worthNotifying(226), true);
});

test('a finished render emails the creator, a quick one does not', async () => {
  const sent = [];
  const deps = { sendMail: async (m) => { sent.push(m); }, lookupEmail: async () => 'creator@example.com' };
  const slow = {
    id: 'abc', user_id: 'u1', kind: 'video', prompt: 'gym tour',
    video_url: 'https://cdn.scangym.com/squad-gen/abc.mp4',
    created_at: new Date(Date.now() - 200000), completed_at: new Date(),
  };
  assert.deepEqual(await notify.notifyReady(slow, deps), { sent: true });
  assert.match(sent[0].subject, /clip is ready/);
  assert.match(sent[0].text, /cdn\.scangym\.com/);

  const quick = { ...slow, created_at: new Date(Date.now() - 3000) };
  const out = await notify.notifyReady(quick, deps);
  assert.equal(out.sent, false);
  assert.equal(sent.length, 1);
});

test('a failed render is not emailed — the retry is on screen', async () => {
  const out = await notify.notifyReady(
    { id: 'x', user_id: 'u1', kind: 'video', video_url: null, created_at: new Date(Date.now() - 200000) },
    { sendMail: async () => { throw new Error('should not send'); }, lookupEmail: async () => 'c@example.com' },
  );
  assert.equal(out.sent, false);
});

// ─── 4. A creation belongs to somebody ────────────────────────────────────

test('My Creations and the counts are signed-in only', () => {
  const router = require(path.join(ROOT, 'server', 'routes', 'squad-create'));
  for (const [method, p] of [['get', '/library'], ['post', '/events'], ['get', '/events/summary']]) {
    const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
    assert.ok(layer, `no ${method.toUpperCase()} ${p}`);
    assert.ok(layer.route.stack.map((h) => h.handle.name).includes('requireCreator'), `${p} must require a creator`);
  }
});

test('budget and templates stay readable without a login — that is how the tab decides what to show', () => {
  const router = require(path.join(ROOT, 'server', 'routes', 'squad-create'));
  for (const p of ['/budget', '/templates', '/modes']) {
    const layer = router.stack.find((l) => l.route && l.route.path === p);
    assert.ok(layer, `no GET ${p}`);
    assert.ok(!layer.route.stack.map((h) => h.handle.name).includes('requireCreator'), `${p} must not need a login`);
  }
});

test('an event is only recorded for a real action on a real asset', async () => {
  assert.deepEqual(await jobs.recordEvent({ userId: 'u1', assetId: 'a1', action: 'like' }), { ok: false, reason: 'bad_action' });
  assert.deepEqual(await jobs.recordEvent({ userId: 'u1', action: 'share' }), { ok: false, reason: 'missing_ids' });
  assert.deepEqual(await jobs.recordEvent({ assetId: 'a1', action: 'share' }), { ok: false, reason: 'missing_ids' });
});

test('the library survives a database that will not answer', async () => {
  const out = await jobs.libraryFor('u1');
  assert.ok(Array.isArray(out.items), 'an empty list, never an exception into the sheet');
});

// ─── 5. Chips a creator can choose between ────────────────────────────────

test('every model on offer says what it is for', () => {
  for (const kind of ['text', 'image', 'video']) {
    for (const row of models.catalogueFor(kind, { seconds: 8, images: 1, tokensIn: 700, tokensOut: 200 })) {
      assert.ok(row.role, `${row.id} has no role — "${row.label}" alone is a vendor release name`);
    }
  }
});

test('a role never names a wholesaler', () => {
  // Same rule as tests/customer-facing-catalogue.test.js: ScanGym is the seller.
  const banned = /\b(fal|fal\.ai|openrouter|reseller|wholesale)\b/i;
  for (const role of Object.values(models.ROLES)) assert.ok(!banned.test(role), `role leaks plumbing: ${role}`);
});

test('the starters carry the whole recipe, not just a sentence', () => {
  for (const kind of ['text', 'image', 'video', 'audio', 'music']) {
    const list = templates.forMode(kind);
    assert.ok(list.length >= 8, `${kind} needs enough openers to be useful, has ${list.length}`);
    for (const t of list) {
      assert.ok(t.label && t.prompt && t.settings, `${kind} starter "${t.label}" is incomplete`);
      assert.ok(t.prompt.length > 30, 'a starter prompt has to be better than what a creator would type');
    }
  }
});

test('video starters default to a model a new creator can actually afford', () => {
  const cheap = models.catalogueFor('video', { seconds: 8 })
    .filter((m) => m.estimateUsd != null && m.estimateUsd <= budget().remainingUsd)
    .map((m) => m.id);
  const withModel = templates.forMode('video').filter((t) => t.model);
  assert.ok(withModel.length >= 5, 'most starters should pin a model rather than inherit whatever is first');
  for (const t of withModel) {
    assert.ok(cheap.includes(t.model), `starter "${t.label}" points at ${t.model}, which a starter creator cannot afford`);
  }
});

test('no starter invents a price or a gym we do not sell', () => {
  const all = Object.values(templates.all()).flat();
  for (const t of all) {
    const prices = t.prompt.match(/£\s?\d+/g) || [];
    for (const p of prices) {
      assert.match(p.replace(/\s/g, ''), /^£(5|40)$/, `"${t.label}" quotes ${p}; only the live day pass (£5) and the membership it beats (£40) may appear`);
    }
  }
});
