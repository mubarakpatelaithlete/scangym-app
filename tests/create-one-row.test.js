// Owner 2026-10-04: Create has one bottom row. The Images/Videos/Edit filter row
// duplicated Image/Video/Edit, so it is gone; Library and All join #sg-sv-rail.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'create-studio.js'), 'utf8');
test('no separate filter chip row is built', () => {
  assert.ok(!/root\.appendChild\(chips\)/.test(cs));
  assert.ok(!/\[\{ key: 'all', chip: 'All' \}\]\.concat\(KINDS\)/.test(cs));
});
test('Library and All go into the bottom row, shown first', () => {
  assert.match(cs, /cs-lib-chip sg-pill cs-row-chip/);
  assert.match(cs, /'cs-chip sg-pill sg-on cs-row-chip', 'All'/);
  assert.match(cs, /querySelector\('#sg-sv-rail\.sv-float'\)/);
  assert.match(cs, /#sg-sv-rail \.cs-row-chip\{order:-1 !important;\}/);
});
