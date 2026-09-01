/**
 * YouTube reels belong to the feed, and only one of them may be an iframe.
 *
 * The first attempt at this feature was reverted twice, for two different
 * reasons, and both are cheap to reintroduce by accident:
 *
 *  1. The renderer lived in a separate file (reels/social-embed.js) that tried
 *     to monkey-patch `createReel`. Everything in the reels player is scoped to
 *     one IIFE, so that file could never see `createReel` or `allVideos` and did
 *     nothing at all. Social rendering must stay inside the player.
 *  2. It mounted a YouTube iframe for every social slide in the render window.
 *     An iframe is ~2-3 MB of player JS, so the feed became unusable and the
 *     whole thing was switched off in reels.js with a "DISABLED" comment.
 *
 * These tests read the source rather than running a browser, in the style of the
 * rest of this suite: they pin the two decisions above, plus the interleave
 * contract that keeps paging stable.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const REELS_ROUTE = read('server/routes/reels.js');
const SOCIAL_ROUTE = read('server/routes/social-reels.js');
const PLAYER = read('frontend/public/reels/index.html');

test('the feed reads social_reels and tags them for the player', () => {
  assert.match(REELS_ROUTE, /FROM social_reels/, 'the feed must read the table social-reels.js fills');
  assert.match(REELS_ROUTE, /is_approved = true AND is_hidden = false/,
    'hidden or unapproved rows must never reach a visitor');
  assert.match(REELS_ROUTE, /type: 'social'/, 'the player branches on type');
  assert.ok(!/SOCIAL REELS: DISABLED/.test(REELS_ROUTE), 'the disable comment must be gone, not edited around');
});

test('social reels are interleaved, never first, and capped', () => {
  const { interleaveSocial, SOCIAL_EVERY_NTH } = loadHelpers();
  const own = Array.from({ length: 12 }, (_, i) => ({ id: `own_${i}`, type: 'catalog' }));
  const social = Array.from({ length: 3 }, (_, i) => ({ id: `social_${i}`, type: 'social' }));

  const out = interleaveSocial(own, social, SOCIAL_EVERY_NTH);

  assert.equal(out.length, own.length + social.length, 'nothing is dropped');
  assert.notEqual(out[0].type, 'social', 'the first slide must be one of ours — it has to paint instantly');
  assert.equal(out.filter((v) => v.type === 'social').length, 3);
  // At most one social slide in any window of SOCIAL_EVERY_NTH + 1.
  for (let i = 0; i + SOCIAL_EVERY_NTH < out.length; i++) {
    const window = out.slice(i, i + SOCIAL_EVERY_NTH + 1);
    assert.ok(window.filter((v) => v.type === 'social').length <= 1,
      `two social reels inside ${SOCIAL_EVERY_NTH + 1} slides at index ${i}`);
  }
});

test('interleaving is deterministic, so paging cannot duplicate or lose a reel', () => {
  const { interleaveSocial, SOCIAL_EVERY_NTH } = loadHelpers();
  const own = Array.from({ length: 30 }, (_, i) => ({ id: `own_${i}`, type: 'catalog' }));
  const social = Array.from({ length: 8 }, (_, i) => ({ id: `social_${i}`, type: 'social' }));

  const a = interleaveSocial(own, social, SOCIAL_EVERY_NTH).map((v) => v.id);
  const b = interleaveSocial(own, social, SOCIAL_EVERY_NTH).map((v) => v.id);
  assert.deepStrictEqual(a, b, 'same input must give the same order every request');
  assert.equal(new Set(a).size, a.length, 'no reel appears twice');

  // Two consecutive pages must together contain every id exactly once.
  const page1 = a.slice(0, 20);
  const page2 = a.slice(20, 40);
  assert.equal(new Set([...page1, ...page2]).size, a.length);
});

test('an empty social library leaves the feed exactly as it was', () => {
  const { interleaveSocial, SOCIAL_EVERY_NTH } = loadHelpers();
  const own = [{ id: 'a', type: 'catalog' }, { id: 'b', type: 'catalog' }];
  assert.deepStrictEqual(interleaveSocial(own, [], SOCIAL_EVERY_NTH), own);
});

test('at most one YouTube iframe exists at a time', () => {
  assert.match(PLAYER, /function mountSocialEmbed/, 'the embed is mounted on demand');
  assert.match(PLAYER, /function unmountSocialEmbed/, 'and removed again');
  assert.match(PLAYER, /function syncSocialEmbeds/, 'one function owns which slide has it');

  // syncSocialEmbeds must unmount everything that is not the centre slide.
  const sync = PLAYER.slice(PLAYER.indexOf('function syncSocialEmbeds'));
  const body = sync.slice(0, sync.indexOf('\n      }'));
  assert.match(body, /idx !== centerIndex/, 'every non-centre slide is unmounted');
  assert.match(body, /unmountSocialEmbed\(idx\)/);
  assert.match(body, /mountSocialEmbed\(centerIndex\)/);

  // Unmounting must actually drop the iframe; pausing an iframe is not possible.
  const unmount = PLAYER.slice(PLAYER.indexOf('function unmountSocialEmbed'));
  assert.match(unmount.slice(0, unmount.indexOf('\n      }')), /innerHTML = ''/,
    'the iframe must be destroyed, not hidden');
});

test('a social slide renders from its poster, with no iframe in the initial markup', () => {
  const create = PLAYER.slice(PLAYER.indexOf('function createSocialReel'));
  const body = create.slice(0, create.indexOf('\n      function createReel'));
  assert.match(body, /reel-social-poster/, 'the poster carries the slide');
  assert.match(body, /reel-social-embed/, 'an empty container is left for the embed');
  assert.ok(!/createElement\('iframe'\)/.test(body),
    'createSocialReel must not build an iframe — that is what made the feed slow');
  // The onclick lives inside a JS string, so the quotes are backslash-escaped.
  assert.match(body, /_ctaNavigate\(\\?'\/explore\\?'\)/, 'a social reel still offers the Book CTA');
});

test('the dead patch file is gone and nothing loads it', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'frontend/public/reels/social-embed.js')),
    'social-embed.js could never work (IIFE scope) and must not be resurrected');
  // The file may still be named in a comment explaining why it is gone; what
  // must not exist is anything that loads it.
  assert.ok(!/<script[^>]*social-embed\.js/.test(PLAYER), 'no script tag, not even a commented one');
});

test('playback is muted for autoplay, and unmute goes through the player API', () => {
  assert.match(PLAYER, /mute=1/, 'browsers refuse unmuted autoplay without a gesture');
  assert.match(PLAYER, /enablejsapi=1/, 'needed to unmute later');
  assert.match(PLAYER, /func: isMuted \? 'mute' : 'unMute'/, 'the mute button must drive the embed too');
  assert.match(PLAYER, /'https:\/\/www\.youtube\.com'/, 'postMessage is targeted, not "*"');
});

test('we only ever store embeddable, region-correct videos', () => {
  assert.match(SOCIAL_ROUTE, /videoEmbeddable: 'true'/,
    'a non-embeddable video renders as a permanently black slide with no detectable error');
  assert.match(SOCIAL_ROUTE, /regionCode: 'GB'/, 'the queries are UK day-pass queries');
});

/**
 * reels.js pulls in the database and the ranking algorithm at require time, so
 * the pure helpers are read out of the source instead of imported. Keeps the
 * test fast and dependency-free, like the rest of the suite.
 */
function loadHelpers() {
  const src = REELS_ROUTE;
  const nth = src.match(/const SOCIAL_EVERY_NTH = (\d+);/);
  assert.ok(nth, 'SOCIAL_EVERY_NTH must stay a named constant');
  const fnStart = src.indexOf('function interleaveSocial');
  assert.ok(fnStart > 0, 'interleaveSocial must stay a named function');
  const fnEnd = src.indexOf('\n}', fnStart);
  const fnSrc = src.slice(fnStart, fnEnd + 2);
  // eslint-disable-next-line no-new-func
  const interleaveSocial = new Function(`${fnSrc}; return interleaveSocial;`)();
  return { interleaveSocial, SOCIAL_EVERY_NTH: Number(nth[1]) };
}
