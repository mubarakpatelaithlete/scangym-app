/**
 * The button catalog is the whole board, and it never ships a dead link.
 *
 * The Buttons board (89 cards) is the product's own list of every place a
 * customer should be able to reach ScanGym from. It used to be implemented card
 * by card, with each button carrying its own URL and its own idea of readiness —
 * which is how a link to a store listing that does not exist gets shipped.
 *
 * These tests pin the two properties that matter:
 *   1. every card on the board is represented in the catalog (nothing silently
 *      dropped), and
 *   2. no entry is ever handed to the frontend with a href unless everything it
 *      needs is actually present in this environment.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { catalog, resolve, groups, LISTINGS } = require('../server/lib/buttons-catalog');

/** The Buttons list as read from Trello on 2026-09-14, verbatim. */
const BOARD = require('./fixtures/buttons-board.json');

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

test('every card on the Buttons board exists in the catalog', () => {
  const mapped = new Set(catalog.filter((e) => e.card).map((e) => norm(e.card)));
  const missing = BOARD.filter((c) => !mapped.has(norm(c)));
  assert.deepStrictEqual(missing, [], 'cards on the board with no catalog entry');
});

test('the board is fully covered: 89 cards', () => {
  assert.strictEqual(BOARD.length, 89);
});

test('catalog ids are unique', () => {
  const ids = catalog.map((e) => e.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate button id');
});

test('an entry whose requirement is unmet gets no href', () => {
  const items = resolve({}); // nothing configured at all
  for (const item of items) {
    if (!item.ready) {
      assert.strictEqual(item.href, null, `${item.id} offered a link while not ready`);
      assert.ok(item.note, `${item.id} is not ready but tells the customer nothing`);
    }
  }
});

test('a missing store listing can never be linked', () => {
  const unlisted = Object.entries(LISTINGS).filter(([, url]) => !url).map(([k]) => k);
  const items = resolve(process.env);
  for (const entry of catalog) {
    if (entry.needsUrl && unlisted.includes(entry.needsUrl)) {
      const item = items.find((i) => i.id === entry.id);
      assert.strictEqual(item.ready, false, `${entry.id} claims to be live without a listing URL`);
    }
  }
});

test('a credential appearing turns its button on, with no code change', () => {
  const before = resolve({}).find((i) => i.id === 'ch-telegram');
  const after = resolve({ TELEGRAM_BOT_TOKEN: 'x' }).find((i) => i.id === 'ch-telegram');
  assert.strictEqual(before.ready, false);
  assert.strictEqual(after.ready, true);
  assert.ok(after.href);
});

test('in-app routes need nothing and are always live', () => {
  const items = resolve({});
  const tabs = items.filter((i) => i.id.startsWith('tab-'));
  assert.strictEqual(tabs.length, 6);
  for (const t of tabs) {
    assert.strictEqual(t.ready, true, `${t.id} must not depend on configuration`);
    assert.match(t.href, /^\//);
  }
});

test('every renderable item has a label and a group', () => {
  for (const item of resolve(process.env)) {
    assert.ok(item.label, `${item.id} has no label`);
    assert.ok(item.group, `${item.id} has no group`);
  }
});

test('groups() returns every item exactly once', () => {
  const flat = groups(process.env).reduce((n, g) => n + g.items.length, 0);
  assert.strictEqual(flat, resolve(process.env).length);
});
