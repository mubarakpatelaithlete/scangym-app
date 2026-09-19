'use strict';
/**
 * One button look, everywhere — and only one place that decides it.
 *
 * "Why in reels tab below button are not same colour, same looking like share
 *  button or search button — book button, talk button, ask AI button? Same in
 *  book tab, scansquad tab, partner tab." (owner, 2026-09-19)
 *
 * Five files each painted their own circle: reels/index.html (.reel-action),
 * sg-rail-ui.js (.sg-rr-circle and .tt-action-btn.sgi), sg-scansquad.js
 * (.creator-side-btn, inline tints) and rails.js (.sg-row-trio, colour emoji).
 * rails.css even had a section promising "the same look, every tab" — written by
 * restating the numbers, which is how they drifted apart in the first place.
 *
 * These tests pin the shape of the fix rather than the pixels: the values live
 * once, in one-button.css, every row reads them through var(), and the strip's
 * icons come from the app's single icon table instead of emoji. A future change
 * that goes back to hardcoding a size or a colour in one of the five files fails
 * here, which is the drift these tests exist to catch.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const read = (p) => fs.readFileSync(path.join(PUB, p), 'utf8');

const tokens = read('one-button.css');
const railUi = read('sg-rail-ui.js');
const railsJs = read('rails.js');
const railsCss = read('rails.css');
const reels = read('reels/index.html');
const profileRail = read('profile-rail.js');
const squadCreate = read('squad-create.js');
const chatAgent = read('chat-agent.js');

const TOKENS = [
  '--sg-btn-size',
  '--sg-btn-bg',
  '--sg-btn-border-width',
  '--sg-btn-border-color',
  '--sg-btn-blur',
  '--sg-btn-shadow',
  '--sg-btn-icon',
  '--sg-btn-label-size',
  '--sg-btn-label-weight',
  '--sg-btn-label-color'
];

test('every button token is declared exactly once, in one-button.css', () => {
  const root = tokens.slice(tokens.indexOf(':root'));
  for (const t of TOKENS) {
    const declared = (root.match(new RegExp(`\\n\\s*${t}:`, 'g')) || []).length;
    assert.equal(declared, 1, `${t} is declared ${declared} times`);
  }
  // No other file may declare them — a second declaration is a second answer.
  for (const [name, src] of [['sg-rail-ui.js', railUi], ['rails.css', railsCss],
    ['rails.js', railsJs], ['reels/index.html', reels],
    ['profile-rail.js', profileRail], ['squad-create.js', squadCreate]]) {
    for (const t of TOKENS) {
      assert.ok(!new RegExp(`${t}\\s*:`).test(src), `${name} redeclares ${t}`);
    }
  }
});

test('all five rows read the shared circle instead of restating it', () => {
  const rows = [
    ['reels Share/Save', reels, '.reel-action .icon{'],
    ['reels rail', railUi, "+'.sg-rr-circle{"],
    ['book/partner rail', railUi, '.tt-action-btn.sgi{'],
    ['Book/Talk/Ask AI', railsCss, '.sg-row-slot .sg-row-trio > .tt-action-btn {']
  ];
  for (const [label, src, marker] of rows) {
    const i = src.indexOf(marker);
    assert.ok(i > 0, `${label}: rule ${marker} is gone`);
    const rule = src.slice(i, src.indexOf('}', i));
    assert.match(rule, /var\(--sg-btn-size/, `${label} hardcodes its size`);
    assert.match(rule, /var\(--sg-btn-bg/, `${label} hardcodes its background`);
    assert.match(rule, /var\(--sg-btn-blur/, `${label} does not share the glass`);
  }
  // ScanSquad's rail is styled inline from JS, so its shared look is the
  // !important block in one-button.css instead of a var() in its own file.
  const squad = tokens.slice(tokens.indexOf('.creator-side-btn {'));
  assert.match(squad, /var\(--sg-btn-size[^)]*\) !important/);
  assert.match(squad, /background: var\(--sg-btn-bg[^)]*\) !important/);
});

test('captions are one style, not three', () => {
  for (const [name, src] of [['reels', reels], ['sg-rail-ui.js', railUi], ['rails.css', railsCss]]) {
    assert.match(src, /var\(--sg-btn-label-size/, `${name} has its own caption size`);
    assert.match(src, /var\(--sg-btn-label-color/, `${name} has its own caption colour`);
  }
  // The trio's caption was the odd one out at 72% white.
  assert.ok(!railsCss.includes('rgba(255, 255, 255, .72) !important'),
    'the dimmed trio caption is back');
});

test('Book / Talk / Ask AI draw the app\'s icons, not emoji', () => {
  assert.match(railUi, /try\{window\.SG_ICONS=ICONS;\}catch\(e\)\{\}/,
    'the icon table is no longer shared, so rails.js has to invent glyphs again');
  assert.match(railUi, /\n\s*mic:I\(/, 'no mic icon for Talk');
  assert.match(railUi, /\n\s*sparkle:I\(/, 'no sparkle icon for Ask AI');

  const items = railsJs.slice(railsJs.indexOf('var ITEMS = ['), railsJs.indexOf('];', railsJs.indexOf('var ITEMS = [')));
  for (const key of ['calendar', 'mic', 'sparkle']) {
    assert.ok(items.includes(`'${key}'`), `the trio does not ask for the ${key} icon`);
  }
  const build = railsJs.slice(railsJs.indexOf('function buildTrio('));
  assert.match(build, /window\.SG_ICONS/, 'buildTrio does not use the shared icons');
  assert.match(build, /classList\.add\('sgi'\)/, 'the trio does not take the shared circle class');
  // The emoji stay as a fallback for the framed documents, which load rails.js
  // without sg-rail-ui.js — but only as a fallback.
  assert.match(build, /else \{\s*\n\s*btn\.textContent = it\.emoji;/,
    'the emoji path is no longer a fallback');
});

test('ScanSquad\'s rail is one colour and one icon family', () => {
  const fn = railUi.slice(railUi.indexOf('function labelCreatorRail('));
  assert.match(fn, /CREATOR_ICON=\{/, 'the creator buttons still show raw emoji');
  assert.match(fn, /window\.SG_ICONS/, 'the creator icons come from somewhere else');
  // Its inline tints are overridden, not edited out of the template: the sheet
  // has to keep winning over a style attribute.
  const squad = tokens.slice(tokens.indexOf('.creator-side-btn {'));
  assert.match(squad, /background-image: none !important/,
    'a purple or green inline tint can still show through');
});

test('the "More" circle is stated once', () => {
  const rules = (railUi.match(/\.tt-action\.sgi-more \.tt-action-btn\{/g) || []).length;
  assert.equal(rules, 0, 'sg-rail-ui.js paints the More circle again');
  assert.ok(!railUi.includes('rgba(255,109,0,.2)'), 'the orange More circle is back');
  assert.equal((tokens.match(/\.sgi-more \.tt-action-btn \{/g) || []).length, 1);
});

test('every document that has a strip loads the stylesheet that defines it', () => {
  for (const doc of ['index.html', 'reels/index.html', 'scansquad/index.html']) {
    assert.match(read(doc), /<link rel="stylesheet" href="\/one-button\.css/, `${doc} is missing it`);
  }
});

test('every var() fallback repeats the value the token actually holds', () => {
  // A fallback that disagrees with :root is a second opinion waiting to be seen
  // the one time the stylesheet does not load.
  const root = tokens.slice(tokens.indexOf(':root'), tokens.indexOf('}', tokens.indexOf(':root')));
  const declared = {};
  for (const m of root.matchAll(/(--sg-btn-[a-z-]+):\s*([^;]+);/g)) {
    declared[m[1]] = m[2].trim();
  }
  const norm = (v) => v.replace(/\s+/g, '').toLowerCase();
  for (const [name, src] of [['one-button.css', tokens], ['rails.css', railsCss],
    ['sg-rail-ui.js', railUi], ['rails.js', railsJs], ['reels/index.html', reels],
    ['profile-rail.js', profileRail], ['squad-create.js', squadCreate]]) {
    for (const m of src.matchAll(/var\((--sg-btn-[a-z-]+),([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
      const [, token, fallback] = m;
      assert.ok(declared[token], `${name} reads ${token}, which nothing declares`);
      assert.equal(norm(fallback), norm(declared[token]),
        `${name}: fallback for ${token} is ${fallback.trim()}, the token is ${declared[token]}`);
    }
  }
});

test('the icon is 20px, the size the owner chose', () => {
  assert.match(tokens, /--sg-btn-icon:\s*20px/);
  // Nothing may quietly keep drawing a 22px icon in a strip button.
  assert.ok(!/\.reel-action \.icon svg\{[^}]*22px/.test(reels));
  assert.ok(!/\.sg-pr-circle svg\{width:22px/.test(profileRail));
});

test('the profile and squad-create rails joined the same button', () => {
  for (const [name, src, marker] of [
    ['profile-rail.js', profileRail, "'.sg-pr-circle{"],
    ['squad-create.js', squadCreate, "' .sv-circle{"]
  ]) {
    const i = src.indexOf(marker);
    assert.ok(i > 0, `${name}: ${marker} is gone`);
    const rule = src.slice(i, src.indexOf('}', i));
    for (const t of ['--sg-btn-size', '--sg-btn-bg', '--sg-btn-blur', '--sg-btn-border-color']) {
      assert.ok(rule.includes(t), `${name} still hardcodes ${t.replace('--sg-btn-', '')}`);
    }
  }
  // squad-create's orange tint and glow were the loudest disagreement of all.
  assert.ok(!squadCreate.includes('background:rgba(255,109,0,.18)'), 'the orange tint is back');
  assert.ok(!squadCreate.includes('box-shadow:0 0 14px rgba(255,109,0,.3)'), 'the orange glow is back');
});

test('the chat composer is left out on purpose, and stays out', () => {
  // Documented exclusion: mic and send sit on a solid sheet inside a panel, and
  // send is that panel's primary action. If someone "fixes" it, this fails and
  // they have to read why first.
  assert.match(tokens, /Deliberately NOT in here/);
  assert.ok(!/\.pchat-rnd\{[^}]*--sg-btn-/.test(chatAgent),
    'the chat composer buttons were folded in without updating the note');
});

test('Book in the Reels sidebar is the same button as Share and Save', () => {
  // It was an orange disc while Share, Save and Comment beside it were dark glass.
  // The label under it already says "Book"; colour was carrying no extra meaning.
  assert.ok(!/\.reel-action\[data-action="book"\] \.icon\{[^}]*rgba\(255,109,0/.test(reels),
    'the orange Book disc is back in the Reels sidebar');
  assert.ok(!/\.reel-action\[data-action="book"\][^{]*\{[^}]*(background|border-color)\s*:/.test(reels),
    'Book is being restyled away from the shared button again');
});

test("ScanSquad's create rail draws line icons from the one icon table, not emoji", () => {
  // The circles already matched; the eight modes inside them were colour emoji
  // (✍️ 🖼️ 🎬 …), so the row still looked unlike Share and Save.
  assert.ok(/window\.SG_ICONS/.test(squadCreate),
    'squad-create.js no longer reads the shared icon table');
  assert.match(squadCreate, /iconFor\(mode\)/);
  for (const key of ['pen', 'image', 'film', 'mic', 'music', 'person', 'scissors', 'phone']) {
    assert.ok(new RegExp(`\\n  ${key}:I\\(`).test(railUi),
      `the icon table has no ${key}, so a ScanSquad mode falls back to emoji`);
  }
  // The circle must size an SVG, not only a font.
  assert.ok(/\.sv-circle svg\{[^}]*--sg-btn-icon/.test(squadCreate),
    'the ScanSquad icon is not sized off the shared icon token');
});

test('the profile rail draws its channel icons in white, like every other rail', () => {
  // "yes all white" (owner, 2026-09-19). These were each in their brand palette,
  // so the profile column read as a different family from Share, Save and the
  // ScanSquad row beside it.
  const banned = [
    '#29b6f6', '#7289da', '#e01e5a', '#36c5f0', '#2eb67d', '#ecb22e', '#5b5fc7',
    '#4b53bc', '#d97757', '#F25022', '#7FBA00', '#00A4EF', '#FFB900', '#25f4ee',
    '#fe2c55', '#e1306c', '#1877f2', '#fd5949', '#d6249f', '#285AEB', '#FF6D00'
  ];
  const icons = profileRail.slice(profileRail.indexOf('var ICONS = {'), profileRail.indexOf('};', profileRail.indexOf('var ICONS = {')));
  for (const hex of banned) {
    assert.ok(!icons.toLowerCase().includes(hex.toLowerCase()),
      `the profile rail paints a channel icon ${hex} again`);
  }
  assert.ok(!/url\(#/.test(icons), 'a gradient fill is back in the profile rail icons');
  // Every channel still has an icon — white, not missing.
  for (const key of ['telegram', 'discord', 'slack', 'msteams', 'claude', 'msstore',
                     'install', 'tiktok', 'instagram', 'facebook', 'everything']) {
    assert.ok(new RegExp(`${key}: '<svg`).test(profileRail), `${key} lost its icon`);
  }
});

test('the profile rails use the shared circle, not hand-built 46px emoji buttons', () => {
  // The owner asked the same question once per tab; these two rails in the app
  // bundle were the last place the answer was "because it is built by hand".
  const app = fs.readFileSync(path.join(PUB, 'app.ctr576.js'), 'utf8');
  const profileRails = app.slice(app.indexOf('function MoreHubPage()'),
                                 app.indexOf('CREATOR EARNINGS DASHBOARD'));
  assert.ok(!/width:46px;height:46px/.test(profileRails),
    'a profile rail button is back to a hand-set 46px circle');
  assert.ok(!/rgba\(255,109,0,\.15\)|rgba\(34,197,94,\.12\)/.test(profileRails),
    'a profile rail button is tinted orange or green again');
  for (const icon of ['film', 'shield', 'grid', 'chat', 'more', 'search', 'card', 'help']) {
    assert.ok(profileRails.includes(`sgRailCircle('${icon}'`),
      `the profile rail stopped drawing ${icon} from the shared table`);
  }
  // One door to /login on the signed-out rail, not two side by side.
  const signedOutRail = profileRails.slice(profileRails.indexOf('RIGHT-SIDE BUTTONS \u2014 TikTok style'),
                                           profileRails.indexOf('BOTTOM \u2014 Stats + CTA'));
  const doors = (signedOutRail.match(/navigate\('\/login'\)/g) || []).length;
  assert.equal(doors, 0, 'the signed-out rail has a duplicate sign-in door again');
  // The caption area clears the button band instead of sitting under it.
  assert.ok(!/position:absolute;bottom:12px;left:16px;right:70px/.test(profileRails),
    'the profile stats are back underneath the button band');
});

test('every icon the profile rails ask for exists in the one table', () => {
  for (const icon of ['film', 'shield', 'grid', 'chat', 'more', 'search', 'card', 'help', 'person']) {
    assert.ok(new RegExp(`\\n  ${icon}:I\\(`).test(railUi),
      `${icon} is missing from sg-rail-ui.js's table, so that button would fall back to emoji`);
  }
});

test('the CTA that rides the row draws a shared icon, not an emoji', () => {
  // Last colour glyph in the row after #776-#780: the owner saw it as "Sign in"
  // not matching Book, Talk and Ask AI beside it.
  const table = railUi.slice(railUi.indexOf('var ICONS={'), railUi.indexOf('window.SG_ICONS'));
  const caps = railsJs.slice(railsJs.indexOf('var CAPTIONS = ['), railsJs.indexOf('];', railsJs.indexOf('var CAPTIONS = [')));
  const names = [...caps.matchAll(/'([a-z]+)',\s*'\\u/g)].map((m) => m[1]);
  assert.ok(names.length >= 4, 'the caption table stopped naming icons');
  for (const name of names) {
    assert.ok(new RegExp(`\\n  ${name}:I\\(`).test(table),
      `rails.js asks for the icon "${name}", which is not in the one table`);
  }
  assert.ok(railsJs.includes("(window.SG_ICONS || {})[name]"),
    'rails.js no longer resolves the CTA glyph from the shared table');
  // And its circle reads the tokens rather than carrying its own glass.
  const ico = railsCss.slice(railsCss.indexOf('.sg-cb-ico {'), railsCss.indexOf('.sg-cb-cap'));
  assert.ok(!/rgba\(13, 16, 25, \.62\)/.test(ico), 'the CTA circle has its own background again');
  for (const token of ['--sg-btn-bg', '--sg-btn-blur', '--sg-btn-icon']) {
    assert.ok(ico.includes(token), `the CTA circle stopped reading ${token}`);
  }
});

test('the ScanSquad creator dashboard has no floating side column', () => {
  // The owner asked for Account / Withdraw / More gone from the right edge; the
  // five screens they hid behind are reached from a named strip instead.
  const squadJs = read('sg-scansquad.js');
  const dash = squadJs.slice(squadJs.indexOf('var refLink=\'scangym.com/r/\''),
                             squadJs.indexOf('window._showCreatorScreen'));
  assert.ok(!dash.includes('creator-side-btn'), 'the floating side column is back');
  assert.ok(!dash.includes('creator-more-menu'), 'the More dropdown is back');
  assert.ok(!dash.includes('padding-right:60px'), 'the screens still reserve the gutter for it');
  assert.ok(dash.includes('id="creator-tabs"'), 'the screen switcher strip is missing');
  for (const name of ['Home', 'Analytics', 'Content', 'Earnings', 'Storefront', 'Assets']) {
    assert.ok(dash.includes(`'${name}'`), `${name} can no longer be reached`);
  }
  // Every screen the strip names must exist, or a chip would open nothing.
  const screens = (dash.match(/class="creator-screen"/g) || []).length;
  assert.equal(screens, 6, `the strip names 6 screens but the page renders ${screens}`);
  // And the two coloured link buttons on the home screen are gone.
  const home = dash.slice(dash.indexOf('Screen 0: HOME'), dash.indexOf('Screen 1: ANALYTICS'));
  assert.ok(!/<button/.test(home), 'a coloured Copy or Share button is back on the home screen');
  assert.ok(home.includes('Tap to copy'), 'the referral link can no longer be copied');
});
