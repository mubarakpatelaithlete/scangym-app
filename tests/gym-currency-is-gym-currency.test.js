/**
 * The price a customer sees must be in the GYM's currency, and an owner-set
 * price must never be currency-converted.
 *
 * Regression: MAA CHIKN (India) had an owner day price of 104.49. The engine
 * treated it as GBP and FX-converted it to INR, returning ₹10,999, and the
 * checkout sheet then printed it with a hardcoded '£' — so an Indian customer
 * was shown "Day Pass £10999.00" for a ₹104 day pass.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { calculateGymPrice } = require('../server/lib/pricing-engine');

test('owner-set price is treated as the gym local currency, not GBP', () => {
  const inr = calculateGymPrice({ gymDayPassPrice: 104.49, countryCode: 'IN', passType: 'day' });
  assert.strictEqual(inr.currency, 'inr');
  assert.strictEqual(inr.symbol, '₹');
  assert.ok(inr.amount < 200, `owner price must not be FX-multiplied, got ${inr.amount}`);
  assert.ok(inr.display.startsWith('₹'), `display must use the gym symbol, got ${inr.display}`);
});

test('a UK gym is unaffected', () => {
  const gb = calculateGymPrice({ gymDayPassPrice: 10, countryCode: 'GB', passType: 'day' });
  assert.strictEqual(gb.currency, 'gbp');
  assert.ok(gb.amount >= 9 && gb.amount <= 11, `got ${gb.amount}`);
});

test('multi-day passes scale from the owner price without FX', () => {
  const day = calculateGymPrice({ gymDayPassPrice: 104.49, countryCode: 'IN', passType: 'day' });
  const weekly = calculateGymPrice({ gymDayPassPrice: 104.49, countryCode: 'IN', passType: 'weekly' });
  assert.ok(weekly.amount > day.amount, 'weekly must cost more than a day');
  assert.ok(weekly.amount < day.amount * 7, 'weekly must be cheaper than 7 day passes');
});

test('the gym-price endpoint sends currency + symbol on every price object', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'pricing.js'), 'utf8');
  const block = src.slice(src.indexOf("router.get('/gym-price'"));
  for (const pt of ['day', "'3day'", 'weekly', 'monthly']) {
    const line = block.split('\n').find((l) => l.trim().startsWith(`${pt}:`) && l.includes('stripeAmount'));
    assert.ok(line, `no price line for ${pt}`);
    assert.ok(line.includes('symbol'), `${pt} price is missing symbol`);
    assert.ok(line.includes('currency'), `${pt} price is missing currency`);
  }
});

test('checkout never falls back to a hardcoded pound sign', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'app.ctr576.js'), 'utf8');
  assert.ok(!src.includes("_priceInfo.symbol||(_serverPrices?'£':'£')"), 'checkout still hardcodes £');
  assert.ok(!/from \\u00a34\.49/.test(src) && !src.includes('from £4.49'), 'a hardcoded "from £4.49" is still in the UI');
});
