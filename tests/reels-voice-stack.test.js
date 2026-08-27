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

const REELS_HTML = path.join(__dirname, '..', 'frontend', 'public', 'reels', 'index.html');
const html = fs.readFileSync(REELS_HTML, 'utf8');

/** Position of a script tag's src in the document, or -1. */
function at(file) {
  const m = new RegExp(`<script[^>]*src="/${file.replace('.', '\\.')}[^"]*"`).exec(html);
  return m ? m.index : -1;
}

test('the Reels page loads the whole voice chain', () => {
  for (const file of ['voice.js', 'chat-agent.js', 'reels-chat.js', 'voice-always.js']) {
    assert.ok(at(file) > -1, `reels/index.html is missing ${file} — voice cannot arm on Reels`);
  }
});

test('the voice chain is in a working order', () => {
  // chat-agent.js defines sgChatAgent, which reels-chat.js calls at parse time;
  // voice-always.js reads the finished personalities to decide which tab it is on.
  assert.ok(at('chat-agent.js') < at('reels-chat.js'), 'chat-agent.js must precede reels-chat.js');
  assert.ok(at('reels-chat.js') < at('voice-always.js'), 'reels-chat.js must precede voice-always.js');
  assert.ok(at('voice.js') < at('chat-agent.js'), 'voice.js must precede chat-agent.js');
});

test('the voice scripts are deferred so the feed still paints first', () => {
  // Reels is a video feed; a blocking script here costs first paint on the landing tab.
  for (const file of ['voice.js', 'chat-agent.js', 'reels-chat.js', 'voice-always.js']) {
    const tag = new RegExp(`<script[^>]*src="/${file.replace('.', '\\.')}[^"]*"[^>]*>`).exec(html);
    assert.ok(tag, `${file} tag not found`);
    assert.ok(/\sdefer\b/.test(tag[0]), `${file} must be deferred on the Reels page`);
  }
});

test('the chat pill is docked on Reels', () => {
  // sg-dock.js owns the bottom edge; without it the pill collides with the tab bar.
  assert.ok(at('sg-dock.js') > -1, 'reels/index.html is missing sg-dock.js');
});
