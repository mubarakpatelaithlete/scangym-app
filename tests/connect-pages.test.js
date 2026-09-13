/**
 * One connector page, three assistants.
 *
 * Claude, Grok and Gemini all connect to ScanGym through the same custom MCP
 * connector URL (https://scangym.com/mcp, live since August). What differs is
 * four lines of copy and where the settings page lives — so /claude, /grok and
 * /gemini render from one template. Copying the page twice would mean three
 * files drifting apart the first time the wording changes, which is exactly the
 * accretion the frontend patch chain is being dug out of.
 *
 * What these tests protect:
 *  - a customer never sees an unfilled {{TOKEN}} on the page;
 *  - a page never names the wrong assistant;
 *  - a rail button never points at a route the server does not serve;
 *  - the page keeps telling the truth about account requirements, because the
 *    connector is useless on a free plan and finding that out after three taps
 *    is the failure this whole rail was rebuilt to avoid.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend', 'public');
const connect = require(path.join(ROOT, 'server', 'lib', 'connect-page.js'));
const RAIL = fs.readFileSync(path.join(FRONTEND, 'profile-rail.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('every platform renders with no token left behind', () => {
  for (const slug of connect.slugs()) {
    const html = connect.render(FRONTEND, slug);
    assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/, `${slug} rendered with an unfilled token`);
    assert.ok(html.length > 5000, `${slug} rendered suspiciously short`);
  }
});

test('each page names its own assistant, in the places that matter', () => {
  for (const slug of connect.slugs()) {
    const p = connect.PLATFORMS[slug];
    const html = connect.render(FRONTEND, slug);
    assert.match(html, new RegExp(`<title>Use ScanGym in ${p.name}`), `${slug} title`);
    assert.match(html, new RegExp(`Book a gym in ${p.name}`), `${slug} headline`);
    assert.ok(html.includes(p.settingsUrl), `${slug} must link its own settings page`);
    assert.ok(html.includes(p.settingsBtn), `${slug} must label its own button`);
  }
});

test('a page never sends someone to another assistant’s settings', () => {
  const urls = connect.slugs().map((s) => connect.PLATFORMS[s].settingsUrl);
  for (const slug of connect.slugs()) {
    const html = connect.render(FRONTEND, slug);
    for (const url of urls) {
      if (url === connect.PLATFORMS[slug].settingsUrl) continue;
      assert.ok(!html.includes(url), `${slug} links ${url}`);
    }
  }
});

test('the MCP link on every page is the live one', () => {
  for (const slug of connect.slugs()) {
    const html = connect.render(FRONTEND, slug);
    assert.match(html, /https:\/\/scangym\.com\/mcp/);
  }
});

test('each page says what the connector actually needs', () => {
  // The connector does not work on a free Claude or Grok plan, and Gemini's
  // custom apps are still rolling out. Saying so on the page is the same rule
  // the rail follows: no control claims an action it cannot perform.
  for (const slug of connect.slugs()) {
    const note = connect.PLATFORMS[slug].accountNote;
    assert.ok(note && note.length > 20, `${slug} must carry an account note`);
    assert.ok(connect.render(FRONTEND, slug).includes(note), `${slug} must show it`);
  }
});

test('the server serves a route for every platform, and the rail links them', () => {
  assert.match(
    SERVER,
    /for \(const slug of connectPage\.slugs\(\)\)/,
    'routes must be generated from the platform list, not hand-listed'
  );
  for (const slug of connect.slugs()) {
    assert.ok(
      RAIL.includes(`window.open('/${slug}'`),
      `the rail has no button opening /${slug}`
    );
  }
});

test('every rail button that opens a local path points at a real route', () => {
  const paths = (RAIL.match(/window\.open\('(\/[a-z-]+)'/g) || []).map((m) =>
    m.slice(m.indexOf("'/") + 1, -1)
  );
  assert.ok(paths.length >= 3, 'expected the connector buttons to be found');
  for (const p of new Set(paths)) {
    const slug = p.replace(/^\//, '');
    assert.ok(
      connect.slugs().includes(slug) || SERVER.includes(`app.get('${p}'`),
      `${p} is opened by the rail but nothing serves it`
    );
  }
});

test('an unknown platform is a thrown error, not a half-rendered page', () => {
  assert.throws(() => connect.render(FRONTEND, 'copilot'), /unknown connector platform/);
});

test('the Claude page links where connectors actually live now', () => {
  // Checked in a browser on 2026-09-01: claude.ai/settings/connectors renders
  // only "Connectors have moved to Customize", which is a dead end for a
  // customer following our step 2.
  const url = connect.PLATFORMS.claude.settingsUrl;
  assert.match(url, /customize-connectors/);
  assert.ok(!/claude\.ai\/settings\/connectors$/.test(url), 'the moved URL is back');
});

test('no page invents a plan requirement we have not checked', () => {
  // A custom connector was added and used on a FREE Claude account that day,
  // so "needs a paid plan" would be a lie told to a paying-nothing customer.
  assert.ok(!/paid/i.test(connect.PLATFORMS.claude.accountNote));
  assert.match(connect.PLATFORMS.gemini.accountNote, /Spark/);
});
