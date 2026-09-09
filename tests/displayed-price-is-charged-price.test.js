/**
 * A price on screen must be the price on the card.
 *
 * Regression: the pass sheet showed Weekly £22.45 and Monthly £44.90 while
 * Stripe was charged £22.49 / £44.99, because the browser multiplied the day
 * price (4.49 × 5) and the pricing engine multiplied *and then* charm-rounded.
 * Couple showed £8.08 against a £7.63 charge, and the "save %" labels (20/43/67)
 * did not match the multipliers (10/28/66).
 *
 * The fix is one implementation of the maths, in frontend/public/pass-math.js,
 * required by the server engine and loaded by the browser. These tests fail if
 * anyone re-introduces a hand-rolled multiplier.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'frontend/public/pass-math.js'));
const engine = require(path.join(ROOT, 'server/lib/pricing-engine.js'));

const PASS_TYPES = ['day', '3day', 'weekly', 'monthly'];
const DAY_PRICES = [4.49, 5, 6.99, 12.5, 25];

test('client pass maths matches the pricing engine for every pass and price', () => {
  for (const day of DAY_PRICES) {
    for (const passType of PASS_TYPES) {
      const server = engine.calculateGymPrice({ gymDayPassPrice: day, countryCode: 'GB', passType });
      const client = M.passPrice(day, passType, { currency: 'gbp', symbol: '£' });
      assert.strictEqual(
        client.display, server.display,
        `£${day} ${passType}: browser shows ${client.display}, server charges ${server.display}`
      );
      assert.strictEqual(client.stripeAmount, server.stripeAmount,
        `£${day} ${passType}: stripe amount differs (${client.stripeAmount} vs ${server.stripeAmount})`);
    }
  }
});

test('platform prices are the canonical £4.49 / £11.99 / £22.49 / £44.99', () => {
  const p = engine.getAllPassPrices({ countryCode: 'GB' });
  assert.strictEqual(p.day.display, '£4.49');
  assert.strictEqual(p['3day'].display, '£11.99');
  assert.strictEqual(p.weekly.display, '£22.49');
  assert.strictEqual(p.monthly.display, '£44.99');
});

test('the old naive multiplication is what we are protecting against', () => {
  // 4.49 × 5 = 22.45 — the number that used to be displayed. Assert we no
  // longer produce it, so this test documents the actual bug.
  assert.notStrictEqual(M.passPrice(4.49, 'weekly').display, '£22.45');
  assert.strictEqual(M.passPrice(4.49, 'weekly').display, '£22.49');
  assert.strictEqual(M.passPrice(4.49, 'monthly').display, '£44.99');
});

test('savings labels are derived from the multipliers, not invented', () => {
  assert.strictEqual(M.savePercent('3day'), 10);   // 2.67× for 3 days
  assert.strictEqual(M.savePercent('weekly'), 28); // 5× for 7 days
  assert.strictEqual(M.savePercent('monthly'), 66); // 10× for 30 days
  assert.strictEqual(M.savePercent('couple'), 15); // matches /api/pricing/couple
  assert.strictEqual(M.savePercent('day'), 0);
});

test('couple and group prices match what pricing-extended charges', () => {
  const day = 4.49;
  // routes/pricing-extended.js now charges the shared, charm-rounded amount
  const couple = M.passPrice(day, 'couple');
  const src = fs.readFileSync(path.join(ROOT, 'server/routes/pricing-extended.js'), 'utf8');
  assert.ok(src.includes("PASS_MATH.passPrice(basePrice, 'couple'"),
    'the couple route must charge the shared pass maths, not its own 0.85 × 2');
  assert.ok(src.includes('PASS_MATH.groupPrice('),
    'the group route must charge the shared pass maths');
  assert.ok(couple.amount > 0 && couple.savePercent === 15);
  // group of 4 → 10% off per person
  const g = M.groupPrice(day, 4);
  assert.strictEqual(g.perPerson, Math.round(day * 0.9 * 100) / 100);
  assert.strictEqual(g.savePercent, 10);
});

test('no page multiplies a day price by hand any more', () => {
  const dir = path.join(ROOT, 'frontend/public');
  const naive = /\*\s*(?:2\.67|5|10|1\.8|3\.2)\s*\)?\s*\.toFixed\(2\)/;
  const offenders = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (['assets', 'audio', 'reels'].includes(entry.name)) continue;
        walk(full);
      } else if (entry.name.endsWith('.js') && entry.name !== 'pass-math.js') {
        const src = fs.readFileSync(full, 'utf8');
        if (naive.test(src)) offenders.push(path.relative(ROOT, full));
      }
    }
  };
  walk(dir);
  assert.deepStrictEqual(offenders, [],
    `these files compute a pass price by hand — use sgGymPass() from pricing.js: ${offenders.join(', ')}`);
});

test('the shared maths file is served to the browser before pricing.js', () => {
  const pages = [
    'frontend/public/index.html',
    'frontend/public/reels/index.html',
    'frontend/public/scansquad/index.html',
    'frontend/public/scansquad-dashboard/index.html',
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const math = html.indexOf('/pass-math.js');
    const pricing = html.indexOf('/pricing.js');
    assert.ok(math !== -1, `${page} does not load /pass-math.js`);
    assert.ok(math < pricing, `${page} loads /pricing.js before /pass-math.js`);
  }
});
