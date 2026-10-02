// Task 109 step 1 (TikTok Home): Watch history + Picture-in-picture in the reel long-press menu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/reels/index.html'), 'utf8');

test('every reel you land on is remembered (last 100)', () => {
  assert.match(html, /currentIndex {2}= index;\n {8}sgRememberWatch\(allVideos\[index\]\);/);
  assert.match(html, /localStorage\.setItem\('sg_watch_history', JSON\.stringify\(l\.slice\(0, 100\)\)\)/);
});
test('long-press menu has Watch history and (when supported) Picture-in-picture', () => {
  assert.match(html, /sgSheetOption\('\\uD83D\\uDD58', 'Watch history'\)/);
  assert.match(html, /pipVid\.requestPictureInPicture\(\)/);
  assert.match(html, /o\[9\]\.addEventListener\('click', function\(\)\{ sh\.close\(\); openWatchHistory\(\); \}\)/);
});
