'use strict';

/**
 * The Reels page must actually carry the voice stack.
 *
 * /reels is not the SPA. It is a standalone SSR page (frontend/public/reels/index.html,
 * served by serveReelsWithPrefetch), so nothing index.html loads exists there by default.
 *
 * This was missed once already: a Reels chat personality was added to the SPA, shipped,
 * and changed nothing on /reels — because that page never loads chat-agent.js or
 * voice-always.js at all. Routing was fixed for a page that never runs the code.
 *
 * These tests assert the page carries the whole chain, in the order the chain needs.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');

/**
 * Every tab that has been split out of the SPA into its own page, and the chat
 * personality each one needs. Add a page here when a tab is split out — that is
 * the moment voice silently stops working on it, which is how both /reels and
 * /scansquad ended up mute in production.
 */
const STANDALONE_PAGES = {
  reels: 'reels-chat.js',
  scansquad: 'squad-chat.js',
};

function htmlFor(dir) {
  return fs.readFileSync(path.join(PUBLIC, dir, 'index.html'), 'utf8');
}

/** Position of a script tag's src in the document, or -1. */
function at(html, file) {
  const m = new RegExp(`<script[^>]*src="/${file.replace('.', '\\.')}[^"]*"`).exec(html);
  return m ? m.index : -1;
}

for (const [dir, personality] of Object.entries(STANDALONE_PAGES)) {
  const html = htmlFor(dir);
  const chain = ['voice.js', 'chat-agent.js', personality, 'voice-always.js'];

  test(`/${dir} loads the whole voice chain`, () => {
    for (const file of chain) {
      assert.ok(at(html, file) > -1, `${dir}/index.html is missing ${file} — voice cannot arm there`);
    }
  });

  test(`/${dir} has the voice chain in a working order`, () => {
    // chat-agent.js defines sgChatAgent, which the personality calls at parse time;
    // voice-always.js reads the finished personalities to decide which tab it is on.
    assert.ok(at(html, 'voice.js') < at(html, 'chat-agent.js'), 'voice.js must precede chat-agent.js');
    assert.ok(at(html, 'chat-agent.js') < at(html, personality), `chat-agent.js must precede ${personality}`);
    assert.ok(at(html, personality) < at(html, 'voice-always.js'), `${personality} must precede voice-always.js`);
  });

  test(`/${dir} defers the voice scripts so the page still paints first`, () => {
    for (const file of chain) {
      const tag = new RegExp(`<script[^>]*src="/${file.replace('.', '\\.')}[^"]*"[^>]*>`).exec(html);
      assert.ok(tag, `${file} tag not found`);
      assert.ok(/\sdefer\b/.test(tag[0]), `${file} must be deferred on the ${dir} page`);
    }
  });

  test(`/${dir} docks its chat pill`, () => {
    // sg-dock.js owns the bottom edge; without it the pill collides with the tab bar.
    assert.ok(at(html, 'sg-dock.js') > -1, `${dir}/index.html is missing sg-dock.js`);
  });
}
