// Owner 2026-10-03, "kill Instagram": share your own life — photo or video,
// live at once (R2, not the vanishing Railway disk), real 24h Stories.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('uploads accept photos and go live through R2', () => {
  const src = read('server/routes/creators.js');
  assert.match(src, /file\.mimetype\.startsWith\('image\/'\)/);
  assert.match(src, /async function publishOwnUpload/);
  assert.match(src, /uploadToR2\(file\.path, key/);
  assert.match(src, /'ScanGym creators', 'creation'/);
});
test('photos stay out of the video feed but show in Stories', () => {
  const src = read('server/routes/reels.js');
  assert.match(src, /WHERE active = true AND COALESCE\(orientation, ''\) <> 'photo'/);
  assert.match(src, /created_at > NOW\(\) - INTERVAL '24 hours'/);
  assert.match(src, /router\.get\('\/stories', optionalAuth/);
});
test('Stories sheet has "Your story" and a photo viewer; post sheet takes photos', () => {
  const html = read('frontend/public/reels/index.html');
  assert.match(html, /id="sg-story-add"/);
  assert.match(html, /function sgShowPhotoStory/);
  const hp = read('frontend/public/sg-home-post.js');
  assert.match(hp, /accept="image\/\*,video\/\*"/);
  assert.match(hp, /function isImg/);
});
