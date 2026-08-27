'use strict';

/**
 * Route-aware script priority.
 *
 * The contract: the script that renders the requested tab leaves the idle
 * bucket, the chat personalities that tab cannot use enter it, and nothing is
 * ever lost — every script present in the shell is still requested on every
 * route, because the SPA lets a visitor walk from any tab to any other.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { applyRouteScripts, areaFor } = require('../server/lib/route-scripts');

const SHELL = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'index.html'),
  'utf8'
);

function lazyList(html) {
  const m = html.match(/var\s+LAZY\s*=\s*\[([^\]]*)\]\s*;/);
  if (!m) return [];
  return (m[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, ''));
}

function eagerTags(html) {
  return (html.match(/<script[^>]*src="\/[^"]+"[^>]*><\/script>/g) || []).map((t) => {
    const m = t.match(/src="([^"]+)"/);
    return m ? m[1].split('?')[0] : '';
  });
}

function allRequested(html) {
  return new Set([...eagerTags(html), ...lazyList(html).map((s) => s.split('?')[0])]);
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// -- area mapping ---------------------------------------------------------

test('areaFor groups the five tabs and their aliases', () => {
  assert.strictEqual(areaFor('/partner'), 'partner');
  assert.strictEqual(areaFor('/partners'), 'partner');
  assert.strictEqual(areaFor('/list-your-gym'), 'partner');
  assert.strictEqual(areaFor('/creator'), 'creator');
  assert.strictEqual(areaFor('/creator-hub'), 'creator');
  assert.strictEqual(areaFor('/scansquad'), 'creator');
  assert.strictEqual(areaFor('/wallet'), 'wallet');
  assert.strictEqual(areaFor('/admin/uploads'), 'admin');
  assert.strictEqual(areaFor('/more/profile'), 'profile');
  assert.strictEqual(areaFor('/explore'), 'book');
  assert.strictEqual(areaFor('/'), 'book');
  assert.strictEqual(areaFor('/gym/anything'), 'book');
});

test('areaFor tolerates junk and trailing slashes', () => {
  assert.strictEqual(areaFor('/PARTNER/'), 'partner');
  assert.strictEqual(areaFor(''), 'book');
  assert.strictEqual(areaFor(null), 'book');
  assert.strictEqual(areaFor(undefined), 'book');
});

// -- promotion -----------------------------------------------------------

test('partner route promotes partner-editable.js into the boot path', () => {
  const out = applyRouteScripts(SHELL, '/partner');
  assert.ok(
    /<script src="\/partner-editable\.js\?[^"]*" defer data-sg-priority="route"><\/script>/.test(out),
    'expected an eager deferred tag for partner-editable.js'
  );
  assert.ok(
    !lazyList(out).some((s) => s.includes('partner-editable')),
    'partner-editable.js must leave the idle bucket'
  );
});

test('the promoted tag is ordered after the app bundle it patches', () => {
  const out = applyRouteScripts(SHELL, '/partner');
  const app = out.indexOf('app.ctr576.js');
  const cta = out.indexOf('continue-cta-flow.js');
  const pe = out.search(/partner-editable\.js[^"]*" defer data-sg-priority/);
  assert.ok(app > -1 && cta > -1 && pe > -1);
  assert.ok(pe > app, 'must come after app.ctr576.js');
  assert.ok(pe > cta, 'must come after continue-cta-flow.js (uses _ctaOpenSheet)');
});

test('book, creator and profile routes leave partner-editable.js at idle', () => {
  for (const p of ['/', '/explore', '/creator', '/more/profile']) {
    const out = applyRouteScripts(SHELL, p);
    assert.ok(
      lazyList(out).some((s) => s.includes('partner-editable')),
      p + ' should keep partner-editable.js in the idle bucket'
    );
    assert.ok(
      !/partner-editable\.js[^"]*" defer data-sg-priority/.test(out),
      p + ' should not promote partner-editable.js'
    );
  }
});

test('wallet promotes wallet-withdraw.js, admin promotes admin-dashboard.js', () => {
  const wallet = applyRouteScripts(SHELL, '/wallet');
  assert.ok(/wallet-withdraw\.js[^"]*" defer data-sg-priority/.test(wallet));
  assert.ok(!lazyList(wallet).some((s) => s.includes('wallet-withdraw')));

  const admin = applyRouteScripts(SHELL, '/admin');
  assert.ok(/admin-dashboard\.js[^"]*" defer data-sg-priority/.test(admin));
  assert.ok(!lazyList(admin).some((s) => s.includes('admin-dashboard')));
  // and one route's renderer is not another's
  assert.ok(!/wallet-withdraw\.js[^"]*" defer data-sg-priority/.test(admin));
});

// -- demotion ------------------------------------------------------------

test('each route keeps its own chat personality in the boot path', () => {
  const owners = {
    '/explore': 'book-chat.js',
    '/partner': 'partner-chat.js',
    '/creator': 'squad-chat.js',
  };
  for (const [p, file] of Object.entries(owners)) {
    const out = applyRouteScripts(SHELL, p);
    assert.ok(
      eagerTags(out).includes('/' + file),
      p + ' must still load ' + file + ' eagerly'
    );
  }
});

test('each route demotes the other tabs chat personalities to idle', () => {
  const out = applyRouteScripts(SHELL, '/partner');
  const eager = eagerTags(out);
  assert.ok(!eager.includes('/book-chat.js'), 'book-chat.js should leave the boot path');
  assert.ok(!eager.includes('/squad-chat.js'), 'squad-chat.js should leave the boot path');
  const lazy = lazyList(out).join(' ');
  assert.ok(lazy.includes('book-chat.js') && lazy.includes('squad-chat.js'));
});

test('profile has no chat personality of its own, so all three go to idle', () => {
  const out = applyRouteScripts(SHELL, '/more/profile');
  const eager = eagerTags(out);
  for (const f of ['/book-chat.js', '/partner-chat.js', '/squad-chat.js']) {
    assert.ok(!eager.includes(f), f + ' should not be in the boot path on profile');
  }
  const lazy = lazyList(out).join(' ');
  for (const f of ['book-chat.js', 'partner-chat.js', 'squad-chat.js']) {
    assert.ok(lazy.includes(f), f + ' must still be requested at idle');
  }
});

test('the shared chat engine and voice are never demoted', () => {
  for (const p of ['/', '/partner', '/creator', '/wallet', '/more/profile']) {
    const eager = eagerTags(applyRouteScripts(SHELL, p));
    assert.ok(eager.includes('/chat-agent.js'), p + ' must keep chat-agent.js eager');
    assert.ok(eager.includes('/voice.js'), p + ' must keep voice.js eager');
    assert.ok(eager.includes('/sg-dock.js'), p + ' must keep sg-dock.js eager');
  }
});

// -- nothing is lost -----------------------------------------------------

test('every route still requests every script the shell shipped', () => {
  const before = allRequested(SHELL);
  for (const p of ['/', '/explore', '/nearby', '/partner', '/creator', '/wallet', '/admin', '/more/profile', '/checkout', '/gym/x']) {
    const after = allRequested(applyRouteScripts(SHELL, p));
    for (const src of before) {
      assert.ok(after.has(src), p + ' dropped ' + src + ' — SPA navigation would break');
    }
    assert.strictEqual(after.size, before.size, p + ' changed the script count');
  }
});

test('the idle bucket never contains the same script twice', () => {
  for (const p of ['/', '/partner', '/creator', '/wallet', '/more/profile']) {
    const lazy = lazyList(applyRouteScripts(SHELL, p)).map((s) => s.split('?')[0]);
    assert.strictEqual(new Set(lazy).size, lazy.length, p + ' has a duplicate idle script');
  }
});

// -- safety --------------------------------------------------------------

test('a shell with no idle loader is returned untouched', () => {
  const plain = '<html><head></head><body><script src="/app.ctr576.js" defer></script></body></html>';
  assert.strictEqual(applyRouteScripts(plain, '/partner'), plain);
});

test('empty, null and non-string input never throws', () => {
  assert.strictEqual(applyRouteScripts('', '/partner'), '');
  assert.strictEqual(applyRouteScripts(null, '/partner'), null);
  assert.strictEqual(applyRouteScripts(undefined, '/partner'), undefined);
});

test('running twice is stable (a proxy re-render cannot double-promote)', () => {
  const once = applyRouteScripts(SHELL, '/partner');
  const twice = applyRouteScripts(once, '/partner');
  assert.strictEqual(twice, once);
});

test('the rewrite only touches script wiring, not the rest of the shell', () => {
  const out = applyRouteScripts(SHELL, '/partner');
  // boot skeleton markers and the app root survive untouched
  for (const marker of ['<!--boot:start-->', '<!--boot:end-->', 'id="app"']) {
    assert.ok(out.includes(marker), 'lost ' + marker);
  }
  assert.ok(out.includes('window.__configPromise'), 'lost the config bootstrap');
});

// -- run -----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + (e && e.message));
  }
}
console.log(`\nroute-scripts: ${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
