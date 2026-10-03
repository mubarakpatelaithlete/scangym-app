// Owner 2026-10-03: Create sheet is see-through and every button group is one
// horizontal swipe row (no wrapping, no 3/4-column grid of result buttons).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const js = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/squad-create.js'), 'utf8');

test('Create sheet is see-through glass', () => {
  assert.match(js, /'#sg-sv-sheet\{background:rgba\(10,12,20,\.78\) !important;[^']*backdrop-filter:blur/);
  assert.match(js, /'#sg-sv-overlay\{background:rgba\(0,0,0,\.22\)/);
});

test('every button group is one horizontal row', () => {
  assert.match(js, /#sg-sv-sheet \.sv-next\{display:flex !important;grid-template-columns:none !important;\}/);
  assert.match(js, /#sg-sv-sheet \.sv-row,[^']*\[style\*="flex-wrap:wrap"\][^']*\{flex-wrap:nowrap !important;overflow-x:auto !important/);
  // the override comes after the old grid rule so it wins
  assert.ok(js.indexOf('#sg-sv-sheet .sv-next{display:flex') > js.indexOf("'.sv-next{display:grid !important"));
});

test('sg-glass-sheets.js leaves the Create sheet to its own glass', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/sg-glass-sheets.js'), 'utf8');
  assert.match(gs, /el\.id === 'sg-sv-sheet'/);
});

test('every setting is a horizontal row of pills with all options visible', () => {
  assert.match(js, /var choices = el\('div', 'sv-choices'\);/);
  assert.match(js, /var opts = el\('div', 'sv-row sv-opts'\);/);
  assert.match(js, /st\.values\.forEach\(function \(v\) \{/);
  assert.match(js, /state\[mode\.key\]\[st\.key\] = v;/);
  assert.doesNotMatch(js, /var setChip = el\('div', 'sv-mchip', '⚙ Settings ›'\)/, 'no separate Settings screen button');
  assert.match(js, /\.sv-opts \.sv-opt\.on\{background:rgba\(255,109,0,\.78\)/);
});
