'use strict';

/**
 * One call to action per tab, as a bar rather than a corner pill.
 *
 * The trap this file guards: the vertical position of every pill is written
 * inline from JS with !important (Reels 69, Book 102, ScanSquad 69, Partner 68,
 * Profile 68 — Book is higher because only it has the 26px #sg-book-summary
 * strip). An inline !important cannot be overridden from a stylesheet, so a
 * `bottom` here would look correct in review and do nothing in the browser.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const raw = fs.readFileSync(path.join(PUBLIC, 'talk-bar.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every tab's voice pill. All five must become the bar. */
const FABS = ['#rchat-fab.show', '#bchat-fab.show', '#schat-fab.show', '#pchat-fab.show', '#mchat-fab.show'];

test('all five tabs get the bar', () => {
  for (const fab of FABS) {
    assert.ok(css.includes(fab), `${fab} is not covered — that tab keeps the old pill`);
  }
});

test('it is a bar, not a pill', () => {
  assert.ok(/left:\s*\d+px\s*!important/.test(css), 'the bar must be anchored to both edges');
  assert.ok(/right:\s*\d+px\s*!important/.test(css), 'the bar must be anchored to both edges');
  assert.ok(/width:\s*auto\s*!important/.test(css), 'a fixed width would keep it pill-sized');
});

test('it does not try to set bottom', () => {
  // Would be dead code: the inline !important from JS always wins.
  assert.ok(!/^\s*bottom:/m.test(css), 'bottom belongs in the JS that writes the inline style');
});

test('it does not resurrect the calls to action one-cta.css hides', () => {
  // An earlier pass at this area forced pills visible and shipped five "Talk"
  // buttons onto Book, Partner and Profile at once. Widening the pill must not
  // become a back door for the four Profile CTAs either.
  const HIDDEN = ['#sg-qr-pass-cta', '#sg-login-alt', '#sg-how-it-works', '#sg-bottom-popup'];
  for (const id of HIDDEN) {
    assert.ok(!css.includes(id), `talk-bar.css must not touch ${id} — it is hidden on purpose`);
  }
});

test('the shells load it', () => {
  for (const shell of ['index.html', 'reels/index.html', 'scansquad/index.html']) {
    const html = fs.readFileSync(path.join(PUBLIC, shell), 'utf8');
    assert.ok(/talk-bar\.css/.test(html), `${shell} does not load talk-bar.css`);
  }
});

test('it never sets display, and only matches the shown pill', () => {
  // All five pills are in the DOM of the SPA at once; chat-agent.js keeps them
  // display:none and adds .show to the current tab's one. An earlier draft of
  // talk-bar.css set `display:flex !important` on the bare ids and rendered
  // FIVE full-width Talk bars on Book, Partner and Profile at the same time.
  // Every unit test passed; only rendering the tabs caught it.
  assert.ok(!/display:/.test(css), 'talk-bar.css must not set display — .show owns that');
  const selectors = css.slice(0, css.indexOf('{'));
  for (const id of ['rchat', 'bchat', 'schat', 'pchat', 'mchat']) {
    assert.ok(
      !new RegExp(`#${id}-fab(?!\\.show)`).test(selectors),
      `#${id}-fab must be matched as #${id}-fab.show, or it styles a hidden pill into view`,
    );
  }
});
