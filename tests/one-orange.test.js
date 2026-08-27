'use strict';

/**
 * Exactly one orange thing per screen, and it is the voice pill.
 *
 * Orange had spread to the promo strip, the bottom bar, the chat pill, "Start
 * Earning", "Log In" and the ScanSquad avatar. Measured live, Book / Partner /
 * Profile each painted three orange surfaces, and on two of those tabs a pair of
 * them fired the *same* action. A colour that marks everything marks nothing.
 *
 * These tests pin the rule at the only place it is now expressed — one-orange.css
 * — so a future inline gradient cannot quietly reintroduce a second primary.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
// Comments are stripped first: this file explains itself at length and names the
// selectors it demotes in prose, so a naive search finds the commentary, not the rule.
const css = fs.readFileSync(path.join(PUBLIC, 'one-orange.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The page shells that must carry the rule. */
const SHELLS = ['index.html', 'reels/index.html', 'scansquad/index.html'];

/** Every chat personality's pill — these are the elements allowed to stay orange. */
const PILLS = ['#bchat-fab', '#pchat-fab', '#schat-fab', '#rchat-fab', '#mchat-fab'];

/** Things that used to be orange and must now be demoted. */
const DEMOTED = ['#sg-usp-banner', '#sg-continue-banner', '#join-btn', '.dash-avatar'];

/** The CSS block a selector appears in, roughly: text from it to the next `}`. */
function ruleFor(selector) {
  const i = css.indexOf(selector);
  if (i === -1) return null;
  const end = css.indexOf('}', i);
  return css.slice(i, end === -1 ? undefined : end);
}

test('every page shell loads the one-orange rule', () => {
  for (const shell of SHELLS) {
    const html = fs.readFileSync(path.join(PUBLIC, shell), 'utf8');
    assert.ok(/one-orange\.css/.test(html), `${shell} does not load one-orange.css`);
  }
});

test('the voice pill keeps the orange', () => {
  for (const pill of PILLS) {
    assert.ok(css.includes(pill), `one-orange.css never mentions ${pill}`);
  }
  // The pill rule is the only place the brand orange may be painted.
  const pillRule = ruleFor('#bchat-fab');
  assert.ok(/#FF6D00/i.test(pillRule), 'the pill rule must paint the brand orange');
});

test('everything else that was orange is demoted', () => {
  for (const sel of DEMOTED) {
    const rule = ruleFor(sel);
    assert.ok(rule, `one-orange.css does not demote ${sel}`);
    assert.ok(
      /background:\s*(var\(--sg-secondary-bg\)|#111827)/.test(rule),
      `${sel} must be given a neutral background`,
    );
    assert.ok(/background-image:\s*none/.test(rule), `${sel} must clear its orange gradient`);
  }
});

test('no demoted element is left painting the brand orange', () => {
  for (const sel of DEMOTED) {
    const rule = ruleFor(sel);
    assert.ok(!/#FF6D00|#E66200/i.test(rule), `${sel} still paints brand orange`);
  }
});

test('demoted actions stay usable, not hidden', () => {
  // Demoting is a colour change. Anything that removed the element or blocked
  // input would break the tap path for people who cannot use a microphone.
  assert.ok(!/display:\s*none/.test(css), 'one-orange.css must not hide any call to action');
  assert.ok(!/pointer-events:\s*none/.test(css), 'one-orange.css must not disable any call to action');
  assert.ok(!/visibility:\s*hidden/.test(css), 'one-orange.css must not hide any call to action');
});

test('the pill invites speech rather than describing a chat box', () => {
  // It is the single orange element now, so its label carries the product promise.
  const agent = fs.readFileSync(path.join(PUBLIC, 'chat-agent.js'), 'utf8');
  const m = /fab\.innerHTML = T\(([^)]*)\)/.exec(agent);
  assert.ok(m, 'could not find the pill label');
  assert.ok(!/Ask AI/.test(m[1]), 'the pill should no longer say "Ask AI"');
  assert.ok(/Talk/.test(m[1]), 'the pill should invite the visitor to talk');
});
