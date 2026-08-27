'use strict';

/**
 * Voice has to arm on every tab.
 *
 * voice-always.js can only arm the microphone on a route that some chat personality
 * claims via its `paths` regex. Reels and Profile claimed nothing, so on those two
 * tabs current() returned null and voice silently never turned on — including on
 * Reels, the tab a first-time visitor lands on. Nothing failed loudly; the product
 * was just mute.
 *
 * These tests pin the property that was broken: every tab in the bottom navigation
 * is claimed by exactly one personality.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');

const PERSONALITIES = [
  'book-chat.js',
  'squad-chat.js',
  'partner-chat.js',
  'reels-chat.js',
  'profile-chat.js',
];

/**
 * Loads the personality files in a stub window and returns { globalName: cfg }.
 * chat-agent.js itself is replaced with a recorder, so this tests the routing
 * configuration without dragging in the DOM the real engine needs.
 */
function loadPersonalities() {
  const captured = {};
  const win = {
    sgChatAgent: {
      create(cfg) {
        return { __cfg: cfg, onTab: () => cfg.paths.test(win.__path) };
      },
    },
    console: { warn() {} },
  };
  win.window = win;

  const ctx = vm.createContext(win);
  for (const file of PERSONALITIES) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), ctx, { filename: file });
  }

  for (const key of Object.keys(win)) {
    if (/^sg\w+Chat$/.test(key) && win[key] && win[key].__cfg) captured[key] = win[key];
  }
  return { win, captured };
}

/** Which personalities claim a given route. */
function claimants(win, captured, pathname) {
  win.__path = pathname;
  return Object.keys(captured).filter((k) => captured[k].onTab());
}

test('every personality loads and registers itself', () => {
  const { captured } = loadPersonalities();
  assert.deepStrictEqual(
    Object.keys(captured).sort(),
    ['sgBookChat', 'sgPartnerChat', 'sgProfileChat', 'sgReelsChat', 'sgSquadChat'],
  );
});

test('each of the five tabs is claimed by exactly one personality', () => {
  const { win, captured } = loadPersonalities();
  const tabs = {
    '/reels': 'sgReelsChat',
    '/explore': 'sgBookChat',
    '/scansquad/': 'sgSquadChat',
    '/partner/': 'sgPartnerChat',
    '/more/profile': 'sgProfileChat',
  };

  for (const [pathname, expected] of Object.entries(tabs)) {
    const hits = claimants(win, captured, pathname);
    assert.deepStrictEqual(hits, [expected], `${pathname} should be claimed only by ${expected}, got [${hits}]`);
  }
});

test('the two tabs that used to be mute are claimed', () => {
  // The regression itself: before this change both of these returned [].
  const { win, captured } = loadPersonalities();
  assert.notDeepStrictEqual(claimants(win, captured, '/reels'), []);
  assert.notDeepStrictEqual(claimants(win, captured, '/more/profile'), []);
});

test('deep links inside Reels and Profile still reach their agent', () => {
  const { win, captured } = loadPersonalities();
  assert.deepStrictEqual(claimants(win, captured, '/reels/abc123'), ['sgReelsChat']);
  assert.deepStrictEqual(claimants(win, captured, '/profile'), ['sgProfileChat']);
});

test('personalities use distinct namespaces', () => {
  // ns keys DOM ids and localStorage. Two agents sharing one would collide silently;
  // profile-chat.js was written with partner-chat.js's 'pchat' before this caught it.
  const { captured } = loadPersonalities();
  const seen = new Map();
  for (const [name, agent] of Object.entries(captured)) {
    const ns = agent.__cfg.ns;
    assert.ok(!seen.has(ns), `${name} reuses ns '${ns}' already taken by ${seen.get(ns)}`);
    seen.set(ns, name);
  }
});

test('voice-always.js knows about all five personalities', () => {
  // agents() is the list voice arming actually consults; a personality missing from
  // it is a tab where voice never turns on, however good its paths regex is.
  const src = fs.readFileSync(path.join(PUBLIC, 'voice-always.js'), 'utf8');
  const m = src.match(/function agents\(\)\s*\{[\s\S]*?\}/);
  assert.ok(m, 'agents() not found in voice-always.js');
  for (const name of ['sgBookChat', 'sgSquadChat', 'sgPartnerChat', 'sgReelsChat', 'sgProfileChat']) {
    assert.ok(m[0].includes(name), `agents() is missing ${name}`);
  }
});

test('a playing reel no longer blocks voice from arming', () => {
  // The old noisyPage() guard refused to arm whenever any video had sound, which on
  // Reels meant always. Ducking replaced it; the guard must not come back.
  const src = fs.readFileSync(path.join(PUBLIC, 'voice-always.js'), 'utf8');
  assert.ok(!/noisyPage/.test(src), 'noisyPage() is back — voice will be mute on Reels again');
  assert.ok(/function duckAudio\(\)/.test(src), 'ducking is missing');
  assert.ok(/function unduckAudio\(\)/.test(src), 'unducking is missing');
});
