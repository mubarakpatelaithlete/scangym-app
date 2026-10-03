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

test('Home top tabs/categories are a see-through row at the bottom, above the action row', () => {
  const m = html.match(/<style id="sg-home-tabs-row">([\s\S]*?)<\/style>/);
  assert.ok(m, 'tabs row style block missing');
  const css = m[1];
  assert.match(css, /#reels-cat-rail\{position:fixed !important;left:8px !important;right:8px !important;top:auto !important;/);
  assert.match(css, /bottom:calc\(var\(--sg-nav-h,56px\) \+ var\(--sg-safe-b,0px\) \+ 149px\)/, 'must sit above the action row (nav+86px, 55px tall)');
  assert.match(css, /\.reels-cat\[aria-selected="true"\]\{background:rgba\(255,109,0,\.78\)/);
  assert.match(css, /background:rgba\(20,20,26,\.20\)/);
});

test('"Make one like this" is a Make button in the action row', () => {
  assert.match(html, /data-action="make"/);
  assert.match(html, /else if\(action === 'make'\) usePrompt\(video\);/);
  assert.match(html, /html body \.reel-prompt\{ display:none !important; \}/);
});

test('the action row scrolls sideways with full-size buttons, never squeezes them', () => {
  const css = html.match(/<style id="sg-home-row">([\s\S]*?)<\/style>/)[1];
  assert.match(css, /justify-content:flex-start !important/);
  assert.match(css, /flex:0 0 60px !important; width:60px !important; min-width:60px !important/);
  assert.match(css, /overflow-x:auto !important/);
});

test('search sits in the bottom row too', () => {
  const css = html.match(/<style id="sg-home-tabs-row">([\s\S]*?)<\/style>/)[1];
  assert.match(css, /#reels-top-bar #reels-search-button\{position:fixed !important;left:8px !important;top:auto !important;/);
  assert.match(css, /#reels-cat-rail\{left:56px !important;\}/);
});
