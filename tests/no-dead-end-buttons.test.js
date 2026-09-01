/**
 * A button that looks live must go somewhere useful.
 *
 * The Profile rail delegates to the app bundle's channel helpers
 * (_sgOpenDiscord / _sgOpenSlack / _sgOpenMSTeams), which fetch the real
 * invite/install URL from /api/channels/*. The fallbacks for "helper not loaded
 * yet" were the problem:
 *
 *   Discord → window.open('https://discord.com')   ← the marketing homepage.
 *                                                    No bot, no server, nothing
 *                                                    to click. A dead end.
 *   Slack   → nothing happened at all.
 *   Teams   → nothing happened at all.
 *
 * Silence and a homepage are both worse than saying "not ready yet". The
 * fallback now asks the same endpoint the helper would, and only says
 * "being set up" when the server genuinely has no link to give.
 *
 * This is the same no-dead-links policy already applied to the app-store and
 * social buttons in this file (Google Play and Apple are omitted because they
 * 404; x.com/scangym is omitted because it belongs to someone else).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIL = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'profile-rail.js'),
  'utf8'
);

function action(name) {
  const re = new RegExp(name + ':\\s*function[\\s\\S]*?\\n    \\},');
  const m = re.exec(RAIL);
  assert.ok(m, 'profile-rail.js must define an action for ' + name);
  return m[0];
}

test('no channel button opens a bare platform homepage', () => {
  // Root domains with no path: nothing to do when you land there.
  const deadEnds = [
    /window\.open\(\s*['"]https:\/\/discord\.com\/?['"]/,
    /window\.open\(\s*['"]https:\/\/slack\.com\/?['"]/,
    /window\.open\(\s*['"]https:\/\/teams\.microsoft\.com\/?['"]/,
    /window\.open\(\s*['"]https:\/\/(www\.)?instagram\.com\/?['"]/,
    /window\.open\(\s*['"]https:\/\/(www\.)?facebook\.com\/?['"]/,
  ];
  for (const re of deadEnds) {
    assert.doesNotMatch(RAIL, re, 'a button opens a platform homepage: ' + re);
  }
});

test('every chat-channel button has a working fallback when the app bundle helper is missing', () => {
  const expected = {
    discord: '/api/channels/discord/invite',
    slack: '/api/channels/slack/install',
    msteams: '/api/channels/msteams/install',
  };
  for (const [name, endpoint] of Object.entries(expected)) {
    const src = action(name);
    assert.match(
      src,
      /else\s+openFromApi\(/,
      name + ' must fall back to openFromApi when its helper is absent'
    );
    assert.ok(
      src.includes(endpoint),
      name + ' must fall back to ' + endpoint
    );
  }
});

test('the fallback opens the window synchronously, so popup blockers allow it', () => {
  const fn = /function openFromApi\([\s\S]*?\n  \}/.exec(RAIL);
  assert.ok(fn, 'openFromApi must exist');
  const src = fn[0];
  const openAt = src.indexOf('window.open(');
  const fetchAt = src.indexOf('fetch(');
  assert.ok(openAt > -1 && fetchAt > -1, 'openFromApi must open a window and fetch a URL');
  assert.ok(
    openAt < fetchAt,
    'the window must be opened before the fetch, not inside its callback'
  );
});

test('a channel with no link says so instead of failing silently', () => {
  const fn = /function openFromApi\([\s\S]*?\n  \}/.exec(RAIL)[0];
  assert.match(fn, /\.catch\(/, 'a failed lookup must be handled');
  const toasts = fn.match(/toast\(/g) || [];
  assert.ok(
    toasts.length >= 2,
    'both the no-URL and the request-failed paths must tell the customer something'
  );
});

test('Telegram still deep-links to the actual bot', () => {
  assert.match(action('telegram'), /https:\/\/t\.me\/ScanGymBot/);
});
