/**
 * Patches must not survive the thing they patched.
 *
 * The patch chain accretes: a file is added to fix a screen, the screen is
 * rebuilt, and the patch stays — still parsed, still running its timers, now
 * aiming at an element that no longer exists. `app-patches-v3.js` had the
 * clearest example. `addOwnerControls()` injected a panel into
 *
 *     #sg-owner-controls  /  [class*="owner-controls"]
 *
 * and wired its buttons to
 *
 *     PUT /api/gym-mgmt/:id/quick-toggle
 *     PUT /api/gym-mgmt/:id/quick-price
 *
 * None of those four things exist: not the element, not either route. The panel
 * could never appear, and the buttons could only ever 404 — but the file still
 * ran a MutationObserver over document.body with subtree:true for every visitor,
 * on every page, for the whole session, waiting for it.
 *
 * These tests keep it deleted, and generalise a little: a patch script may not
 * call an /api/ path the server does not serve, and may not watch the whole
 * document body for an element nothing renders.
 *
 * See docs/PATCH-CHAIN-REMOVAL-PLAN.md — this is phase 1.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'frontend', 'public');
const ROUTES = path.join(ROOT, 'server', 'routes');

const PATCHES = [
  'app-patches.js',
  'app-patches-v3.js',
  'round2.js',
  'round3.js',
  'round4-ui.js',
  'round5-ui.js',
  'ui-polish.js',
  'batch2.js',
  'batch3.js',
  'batch4.js',
];

const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');
/** Code only: a comment explaining why something was deleted is not the thing. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// Routers can be nested (chatbot/index.js does router.use('/web', webchatRouter)),
// so a path is served if its mount exists in server.js and every segment after it
// is declared somewhere in the router tree.
const routerSources = [];
for (const dir of [ROUTES, path.join(ROOT, 'server', 'chatbot')]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.js')) routerSources.push(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
const allRoutes = routerSources.join('\n');
const serverJs = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('the dead owner quick-controls patch stays deleted', () => {
  const src = code('app-patches-v3.js');
  for (const gone of [
    'addOwnerControls',
    'sgOwnerQuickToggle',
    'sgOwnerQuickPrice',
    'owner-controls',
    'quick-toggle',
    'quick-price',
  ]) {
    assert.ok(
      !src.includes(gone),
      `${gone} must not come back as live code (a comment explaining the removal is fine)`
    );
  }
});

test('no patch script watches the whole page for an element nothing renders', () => {
  const markup = fs
    .readdirSync(PUB)
    .filter((f) => f.endsWith('.html') || f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(PUB, f), 'utf8'))
    .join('\n')
    // `el.id = 'sg-foo'` and `el.id='sg-foo'` are the same creation.
    .replace(/\s*=\s*/g, '=');

  for (const file of PATCHES) {
    const src = code(file);
    if (!src.includes('MutationObserver')) continue;
    // Every id the file waits for must be created somewhere.
    const ids = src.match(/#sg-[a-z0-9-]+/g) || [];
    for (const id of new Set(ids)) {
      const bare = id.slice(1);
      const created =
        markup.includes(`id="${bare}"`) ||
        markup.includes(`id='${bare}'`) ||
        markup.includes(`id=\`${bare}\``);
      assert.ok(created, `${file} observes ${id}, which nothing ever creates`);
    }
  }
});

test('patch scripts only call API paths the server actually serves', () => {
  const skip = /:|\$\{|\+/; // templated paths are checked by their own suites
  for (const file of PATCHES) {
    const src = code(file);
    const calls = src.match(/['"]\/api\/[a-z0-9/-]+/gi) || [];
    for (const raw of new Set(calls)) {
      const url = raw.slice(1);
      if (skip.test(url)) continue;
      const parts = url.split('/').filter(Boolean); // ['api','gym-mgmt',...]
      const mount = '/' + parts.slice(0, 2).join('/'); // '/api/gym-mgmt'
      assert.ok(
        serverJs.includes(`'${mount}'`) || serverJs.includes(`"${mount}"`),
        `${file} calls ${url}, but nothing is mounted at ${mount}`
      );
      // What follows the mount must be declared somewhere in the router tree.
      // Routers nest, so accept any tail: chatbot/index.js mounts '/web' and
      // webchat.js declares '/message', while gym-partner.js declares the whole
      // '/claim/verification-status' in one string.
      if (parts.length < 3) continue;
      let declared = serverJs.includes(url);
      for (let i = 2; i < parts.length && !declared; i++) {
        const tail = '/' + parts.slice(i).join('/');
        declared = new RegExp(`['"\`]${tail}(['"\`/?])`).test(allRoutes);
      }
      assert.ok(
        declared,
        `${file} calls ${url}, but no router declares anything matching it`
      );
    }
  }
});
