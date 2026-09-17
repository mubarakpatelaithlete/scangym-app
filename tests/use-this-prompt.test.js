/**
 * "Use this prompt" — TikTok's "Use this sound" loop for a text-to-video app:
 * every reel offers the prompt it was made from, one tap into Create.
 *
 * Owner's two decisions, both pinned here: a reel with no prompt still shows the
 * button and opens Create EMPTY (not hidden), and the prompt TEXT is the label.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const reels = fs.readFileSync(path.join(root, 'frontend', 'public', 'reels', 'index.html'), 'utf8');
const create = fs.readFileSync(path.join(root, 'frontend', 'public', 'squad-create.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'server', 'routes', 'reels.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '20260917_video_catalog_prompt.sql'), 'utf8');

test('a reel carries its prompt from the database to the feed', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS prompt TEXT/, 'the column is not added idempotently');
  assert.ok(!/NOT NULL/.test(migration.split('ALTER TABLE')[1].split(';')[0]),
    'the column must stay nullable: stock reels have no prompt');
  assert.match(migration, /vc\.cdn_key = j\.id OR vc\.url LIKE/,
    'the backfill does not tie a prompt to the job that rendered the file');
  assert.match(route, /variants_ready, prompt/, 'the feed query does not select the prompt');
  assert.match(route, /prompt: row\.prompt \|\| null/, 'the feed does not expose the prompt');
});

test('the button is on every reel, shows the prompt, and never hides itself', () => {
  assert.match(reels, /promptBtn\.className = 'reel-prompt'/, 'the button is not rendered');
  assert.match(reels, /pText \|\| 'Make one like this'/,
    'a reel without a prompt loses the button instead of opening Create empty');
  assert.ok(!/video\.prompt[^\n]*return;/.test(reels), 'the button is skipped when there is no prompt');
  assert.match(reels, /\.rp-text/, 'the prompt text is not the label');
  assert.match(reels, /rp-long \.rp-text span\{[^}]*animation:rpMarquee/,
    'a long prompt is not made readable');
  assert.match(reels, /prefers-reduced-motion:reduce\)\{[\s\S]{0,200}animation:none/,
    'the scrolling label ignores reduced-motion');
});

test('the tap lands in Create, prefilled, in the app or standalone', () => {
  assert.match(reels, /\(window\.top \|\| window\)\.location\.href = url/,
    'the button navigates the iframe instead of the app, so Create opens inside the reel window');
  assert.match(reels, /'\/creator' \+ \(p \? \('\?prompt=' \+ encodeURIComponent/, 'the prompt is not passed');
  assert.match(create, /function openFromUrl/, 'Create never reads the prompt it was handed');
  assert.match(create, /loadModes\(\)\.then\(paintDots\)\.then\(openFromUrl\)/,
    'Create opens the sheet before it knows which modes exist');
  assert.match(create, /history\.replaceState/, 'a refresh would reopen the sheet');
  assert.match(create, /sgSquadCreate\.open\('video'/, 'the prompt does not open the Video mode');
});
