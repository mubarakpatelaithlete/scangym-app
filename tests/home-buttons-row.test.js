// Owner 2026-10-03: Home's right-side buttons are one see-through horizontal
// row at the bottom, just above the channel / profile name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/reels/index.html'), 'utf8');

test('Home buttons are a see-through horizontal row above the name', () => {
  const m = html.match(/<style id="sg-home-row">([\s\S]*?)<\/style>/);
  assert.ok(m, 'row style block missing');
  const css = m[1];
  assert.match(css, /#sg-reel-row-host \.reel-actions\.reel-actions\{[^}]*flex-direction:row !important/);
  assert.match(css, /left:8px !important; right:8px !important/);
  assert.match(css, /background:rgba\(20,20,26,\.20\)/);
  assert.match(css, /backdrop-filter:blur/);
  assert.match(css, /\.reel-info\{ right:12px !important; \}/, 'name should use the full width');
  assert.ok(html.indexOf('<style id="sg-home-row">') > html.lastIndexOf('flex-direction:column !important'), 'row rule must come after the old column rule');
});
