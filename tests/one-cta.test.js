'use strict';

/**
 * One call to action per tab, and it is the voice.
 *
 * After one-orange.css the tabs still offered several competing things to press —
 * measured live: Reels 1, Book 2, ScanSquad 3, Partner 3, Profile 5. Profile alone
 * asked you to log in, verify your ID, continue, and talk.
 *
 * These tests pin what one-cta.css removes, and — more importantly — what it must
 * never remove: the way out of a screen, and the ability to type when a microphone
 * is not available.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const raw = fs.readFileSync(path.join(PUBLIC, 'one-cta.css'), 'utf8');
// Comments name the selectors in prose; strip them so searches find real rules.
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

const SHELLS = ['index.html', 'reels/index.html', 'scansquad/index.html'];
const PILLS = ['#bchat-fab', '#pchat-fab', '#schat-fab', '#rchat-fab', '#mchat-fab'];

/** The rule block a selector belongs to. */
function ruleFor(selector) {
  const i = css.indexOf(selector);
  if (i === -1) return null;
  const end = css.indexOf('}', i);
  return css.slice(i, end === -1 ? undefined : end);
}

test('every page shell loads the one-CTA rule', () => {
  for (const shell of SHELLS) {
    const html = fs.readFileSync(path.join(PUBLIC, shell), 'utf8');
    assert.ok(/one-cta\.css/.test(html), `${shell} does not load one-cta.css`);
  }
});

test('one-cta.css loads after one-orange.css', () => {
  // Hiding must win over recolouring; if the order flips, a demoted-but-hidden
  // button could come back purely as a stylesheet ordering accident.
  for (const shell of SHELLS) {
    const html = fs.readFileSync(path.join(PUBLIC, shell), 'utf8');
    assert.ok(
      html.indexOf('one-orange.css') < html.indexOf('one-cta.css'),
      `${shell} loads one-cta.css before one-orange.css`,
    );
  }
});

test('the competing calls to action are removed', () => {
  for (const sel of ['#sg-continue-banner', '#sg-id-row', '#join-btn', '.affiliate-btn']) {
    const rule = ruleFor(sel);
    assert.ok(rule, `one-cta.css does not handle ${sel}`);
    assert.ok(/display:\s*none/.test(rule), `${sel} should be removed from the surface`);
  }
});

test('the voice pill is never hidden', () => {
  // It survives by omission — see below for why it must not be forced visible.
  for (const pill of PILLS) {
    const rule = ruleFor(pill);
    if (rule) assert.ok(!/display:\s*none/.test(rule), `${pill} must not be hidden`);
  }
});

test('the pills are never forced visible', () => {
  // This is a regression test for a bug this file shipped. In the SPA all five
  // personalities load and each builds its own pill; chat-agent.js hides the four
  // that do not belong to the current tab. An earlier version of one-cta.css set
  // `display:inline-flex !important` on all of them to document which element
  // survives, which overrode that logic and put FIVE "Talk" buttons on Book,
  // Partner and Profile — the exact opposite of one call to action.
  //
  // Caught only by auditing the live site; every static test still passed.
  for (const pill of PILLS) {
    const rule = ruleFor(pill);
    if (!rule) continue;
    assert.ok(
      !/display:\s*(inline-flex|flex|block|inline-block)/.test(rule),
      `${pill} must not be forced visible — that breaks per-tab pill hiding`,
    );
  }
});

test('navigation is never removed', () => {
  // Navigation is not a call to action. Hiding the way out of a screen strands
  // people, which is a worse failure than an extra button.
  assert.ok(!/\.sg-more-back/.test(css), 'the Back link must not be hidden');
  assert.ok(!/sg-tab-bar/.test(css), 'the bottom tab bar must not be hidden');
});

test('the partner gym name stays visible, just not tappable', () => {
  // Hiding it would remove the only label telling a partner which gym this is.
  const rule = ruleFor('#partner-name-display');
  assert.ok(rule, 'one-cta.css does not handle #partner-name-display');
  assert.ok(!/display:\s*none/.test(rule), 'the gym name must stay visible');
  assert.ok(/pointer-events:\s*none/.test(rule), 'the gym name should stop being a button');
});

test('typing is still possible when the microphone is not', () => {
  // The single CTA opens the voice panel; that panel must keep a keyboard route,
  // or a blocked microphone becomes a dead end with no way to book at all.
  const agent = fs.readFileSync(path.join(PUBLIC, 'chat-agent.js'), 'utf8');
  assert.ok(/Type instead/.test(agent), 'the voice panel must keep its "Type instead" option');
  assert.ok(/pchat-input/.test(agent), 'the voice panel must keep its text input');
  // …and one-cta.css must not hide them.
  assert.ok(!/pchat-input|pchat-live-type/.test(css), 'one-cta.css must not hide the typing route');
});
