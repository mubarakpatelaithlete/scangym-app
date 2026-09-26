/**
 * Every chatbot can start an image / video / voiceover / music creation
 * (owner request 2026-09-26: "create image, video, audio, music from inside
 * each chatbot"). The chat hands the customer into ScanSquad Create with the
 * mode picked and the idea typed in; billing stays on the site.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { detectCreate, createLink, createReply } = require('../server/chatbot/create-media');

const root = path.join(__dirname, '..');

test('media requests are recognised with the right mode', () => {
  assert.equal(detectCreate('Make an image of a gym at sunrise').kind, 'image');
  assert.equal(detectCreate('create a video of a woman deadlifting in a gym in Leeds').kind, 'video');
  assert.equal(detectCreate('generate a voiceover saying welcome to ScanGym').kind, 'audio');
  assert.equal(detectCreate('make a song about leg day').kind, 'music');
  assert.equal(detectCreate('make a music video about gym').kind, 'video');
});

test('booking and search talk is not mistaken for a creation', () => {
  for (const t of ['Book gym 1 for tomorrow', 'gyms in Manchester', 'make a booking', 'show me gym photos', 'Hi', 'create account', 'track my booking']) {
    assert.equal(detectCreate(t), null, t);
  }
});

test('the link opens Create in the right mode with the idea typed in', () => {
  const link = createLink('music', 'a song about leg day & squats');
  assert.equal(link, 'https://www.scangym.com/creator?mode=music&prompt=a%20song%20about%20leg%20day%20%26%20squats');
  assert.match(createLink('nonsense', 'x'), /mode=video/);
  const r = createReply('image', 'a gym');
  assert.match(r.text, /scangym\.com\/creator\?mode=image/);
});

test('the shared chatbot brain answers creation requests before gym search', async () => {
  const { handleMessage } = require('../server/chatbot/message-handler');
  const r = await handleMessage('test:create-1', 'make a video of a gym in Leeds', { platform: 'telegram' });
  assert.match(r.text, /creator\?mode=video/);
});

test('Create reads ?mode= and still defaults to Video', () => {
  const create = fs.readFileSync(path.join(root, 'frontend/public/squad-create.js'), 'utf8');
  assert.match(create, /qs\.get\('mode'\)/);
  assert.match(create, /\(image\|video\|audio\|music\|text\)/);
});

test('ChatGPT and Claude get a create_media tool', () => {
  const mcp = fs.readFileSync(path.join(root, 'server/routes/mcp.js'), 'utf8');
  assert.match(mcp, /name: 'create_media'/);
  assert.match(mcp, /create_media: createMedia/);
});
