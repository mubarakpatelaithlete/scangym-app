/**
 * Buttons v1.0, batch 1: the tab buttons and Share work by voice.
 *
 * "You say it and it is done" for the six tab buttons and Share means three things
 * must hold, and each is checked here without a browser or a database:
 *   1. every agent (Book, ScanSquad, Partner) has go_to_tab and share_my_link, so the
 *      request works from whichever tab the customer is on;
 *   2. a tool result carries a closed `ui` instruction — the model picks a tab from an
 *      enum, it never names a function — and the routes forward it on the tool event;
 *   3. the tab performs only that vocabulary (SGScreen), calling the same function the
 *      button calls, and Share resolves the caller's own handle from their user row.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'frontend', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

function loadScreenTools(handler) {
  const calls = [];
  const dbPath = require.resolve(path.join(ROOT, 'server', 'middleware', 'db'));
  const toolsPath = require.resolve(path.join(ROOT, 'server', 'lib', 'screen-tools'));
  const previousDb = require.cache[dbPath];
  require.cache[dbPath] = new Module(dbPath, null);
  require.cache[dbPath].filename = dbPath;
  require.cache[dbPath].loaded = true;
  require.cache[dbPath].exports = {
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return handler(params) || { rows: [] };
    },
  };
  delete require.cache[toolsPath];
  const mod = require(toolsPath);
  delete require.cache[toolsPath];
  if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
  return { mod, calls };
}

/* ── the tools ─────────────────────────────────────────────────────────── */

test('go_to_tab accepts every switchTab() tab and the names people actually say', async () => {
  const { mod } = loadScreenTools(() => null);
  for (const tab of mod.TABS) {
    const r = await mod.tools.go_to_tab.run(null, { tab });
    assert.deepEqual(r.ui, { action: 'go_to_tab', tab }, tab);
    assert.ok(r.ok && r.message, tab);
  }
  for (const [said, tab] of [['maps', 'book'], ['ScanSquad', 'creator'], ['profile', 'more'], ['wallet', 'more'], ['AI trainer', 'trainer']]) {
    const r = await mod.tools.go_to_tab.run(null, { tab: said });
    assert.equal(r.ui.tab, tab, said);
  }
  const bad = await mod.tools.go_to_tab.run(null, { tab: 'settings; alert(1)' });
  assert.equal(bad.ok, false);
  assert.equal(bad.ui, undefined, 'an unknown tab produces no screen instruction');
});

test('go_to_tab is public; share_my_link needs the caller and uses only their own handle', async () => {
  const { mod, calls } = loadScreenTools((params) =>
    params[0] === 'user-1' ? { rows: [{ referral_handle: 'fit_sam' }] } : { rows: [] }
  );
  assert.ok(mod.PUBLIC_SCREEN_TOOLS.has('go_to_tab'));
  assert.ok(!mod.PUBLIC_SCREEN_TOOLS.has('share_my_link'));
  assert.equal(mod.tools.share_my_link.schema.parameters.properties.handle, undefined, 'the model cannot pass a handle');

  const r = await mod.tools.share_my_link.run('user-1', { via: 'whatsapp' });
  assert.deepEqual(r.ui, { action: 'share', url: 'https://scangym.com/r/fit_sam', via: 'whatsapp' });
  assert.match(calls[0].sql, /SELECT referral_handle FROM public\.users WHERE id = \$1/);
  assert.deepEqual(calls[0].params, ['user-1']);

  const none = await mod.tools.share_my_link.run('user-2', {});
  assert.equal(none.ok, false);
  assert.equal(none.ui, undefined);
  assert.ok(none.needsHandle);
});

test('every agent catalogue carries the screen tools, and the Book agent lets a guest use go_to_tab', () => {
  const book = require(path.join(ROOT, 'server', 'lib', 'book-tools'));
  const squad = require(path.join(ROOT, 'server', 'lib', 'squad-tools'));
  const partner = require(path.join(ROOT, 'server', 'lib', 'partner-tools'));
  for (const cat of [book, squad, partner]) {
    assert.ok(cat.tools.go_to_tab && cat.tools.share_my_link);
    assert.equal(cat.isWrite('go_to_tab'), false);
    assert.equal(cat.isWrite('share_my_link'), false);
  }
  assert.equal(book.needsLogin('go_to_tab'), false);
  assert.equal(book.needsLogin('share_my_link'), true);
});

/* ── the wire and the tab ───────────────────────────────────────────────── */

test('each agent route forwards a tool result\'s ui on the done event', () => {
  for (const r of ['book-agent', 'partner-agent', 'squad-agent']) {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', r + '.js'), 'utf8');
    assert.match(src, /state: 'done', ok: result\.ok !== false, \.\.\.\(result\.ui \? \{ ui: result\.ui \} : \{\}\)/, r);
  }
});

test('chat-agent.js performs only the listed screen actions, via the functions the buttons use', () => {
  const src = read('chat-agent.js');
  assert.ok(src.includes('var SGScreen = (function () {'));
  assert.match(src, /var ACTIONS = \{ go_to_tab: goToTab, share: share, open_gym: openGym, open_write_review: openWriteReview \};/, 'closed vocabulary');
  assert.ok(src.includes('window.switchTab(ui.tab)'), 'tabs move through switchTab, same as the tab bar');
  assert.ok(src.includes("window._sgShareAffiliate(handle"), 'share goes through the Share button\'s own function');
  assert.ok(src.includes("url.indexOf('https://scangym.com/') !== 0) return false"), 'only our own link is ever shared');
  assert.ok(src.includes('if (data.ui) SGScreen.perform(data.ui);'), 'wired to the tool event');
  for (const f of ['book-chat.js', 'squad-chat.js', 'partner-chat.js', 'profile-chat.js', 'reels-chat.js']) {
    assert.ok(read(f).includes("go_to_tab: 'Opening the tab'"), f + ' labels the tool');
  }
});
