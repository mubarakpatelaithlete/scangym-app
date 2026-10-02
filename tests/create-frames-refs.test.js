// Task 103: reference image, start/end frame and reference video in Create (Higgsfield / CapCut / ElevenLabs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('frames go to the proven Veo 3.1 Fast fal endpoints', () => {
  const src = read('server/routes/squad-video.js');
  assert.match(src, /fal-ai\/veo3\.1\/fast\/\$\{withEnd \? 'first-last-frame' : 'image'\}-to-video/);
  assert.match(src, /Add a start frame first/);
  const v = require('../server/routes/squad-video.js')._internals;
  assert.deepStrictEqual(v.withFrames({ prompt: 'p' }, 'https://c/a.jpg', null), { prompt: 'p', image_url: 'https://c/a.jpg' });
  assert.deepStrictEqual(v.withFrames({ prompt: 'p' }, 'https://c/a.jpg', 'https://c/b.jpg'),
    { prompt: 'p', first_frame_url: 'https://c/a.jpg', last_frame_url: 'https://c/b.jpg' });
  assert.strictEqual(v.cleanFrameUrl('http://insecure/a.jpg'), null);
});
test('signed-in upload to R2 for photos and clips', () => {
  const src = read('server/routes/squad-image.js');
  assert.match(src, /router\.post\('\/upload', authenticateUser, uploadLimiter/);
  const i = require('../server/routes/squad-image.js')._internals;
  assert.match(i.refKey('42', 'video/mp4'), /^refs\/42\/\d+_[a-f0-9]{12}\.mp4$/);
});
test('Create shows Reference / Start frame / End frame slots and Upload a video', () => {
  const js = read('frontend/public/squad-create.js');
  assert.match(js, /\\uD83D\\uDCCE Reference image/);
  assert.match(js, /\\uD83D\\uDDBC\\uFE0F Start frame/);
  assert.match(js, /\\uD83C\\uDFC1 End frame/);
  assert.match(js, /\\uD83D\\uDCE4 Upload a video/);
  assert.match(js, /body\.startFrameUrl = state\.video\.__start;/);
});
