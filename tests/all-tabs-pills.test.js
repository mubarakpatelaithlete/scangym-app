// Owner 2026-10-04: every button row on every tab uses the Create pill look
// (40px see-through glass pill, icon + 13px label, sideways scroll).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'frontend/public', f), 'utf8');
const js = pub('sg-glass-sheets.js');
const shop = pub('sg-shop.js');

test('one pill look covers every tab', () => {
  for (const s of ['#reels-cat-rail .reels-cat', '#sg-reel-row-host .reel-actions.reel-actions.reel-actions .reel-action:not(.sg-creator)',
    '#sg-sv-rail.sv-float.sv-float .sg-sv-btn', '#sg-profile-rail.sg-rail-scrollable .sg-pr-btn', '.cs-chips.cs-chips .cs-chip',
    '#filters.tabs button', '.seg.seg button', '.sg-pill.sg-pill']) assert.ok(js.includes("'" + s), s);
  assert.ok(js.includes('height:40px!important;min-height:40px!important'));
  assert.ok(js.includes("'border-radius:999px!important;background:rgba(255,255,255,.08)!important;border:1px solid rgba(255,255,255,.18)!important"));
  assert.match(js, /scroll-snap-type:none!important/);
});

test('pills never force display on buttons that rails hide', () => {
  assert.ok(!/\{flex:0 0 auto!important;display:/.test(js));
  assert.ok(js.includes('.tt-action.sg-row-trio:not(.sg-row-hidden)'));
});

test('shop chips and header buttons are pills', () => {
  assert.ok(shop.includes(`class="sg-pill'+(on?' sg-on':'')+'" data-shop-cat=`));
  assert.ok(shop.includes('class="sg-pill" id="sg-shop-orders-btn"'));
  assert.ok(shop.includes('class="sg-pill" id="sg-shop-basket-btn"'));
});
