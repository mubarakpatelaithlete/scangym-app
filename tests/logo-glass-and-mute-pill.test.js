// Owner 2026-10-04: S logo is see-through with an orange border on every tab;
// Home has no "Tap for sound" pill, sound is on by default and Mute is a pill in the row.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '..', 'frontend', 'public');
const css = fs.readFileSync(path.join(pub, 'brand-mark.css'), 'utf8');
const reels = fs.readFileSync(path.join(pub, 'reels', 'index.html'), 'utf8');

test('logo is glass with an orange border', () => {
  assert.match(css, /background:\s*rgba\(255,\s*255,\s*255,\s*\.08\)/);
  assert.match(css, /border:\s*2px solid #FF6D00/);
});
test('no Tap for sound pill on Home', () => {
  assert.ok(!/>\s*Tap for sound\s*</.test(reels));
});
test('sound is on unless the user muted', () => {
  assert.match(reels, /localStorage\.getItem\('sg_muted'\) === '1'/);
});
test('Mute is a pill in the like/comment row', () => {
  assert.match(reels, /\+ muteButton\(\)/);
  assert.match(reels, /data-action="mute"/);
});
