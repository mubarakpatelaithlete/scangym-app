/**
 * The decorative-control regression, tested by actually driving the sheet.
 *
 * History: the Create sheet once showed "8s · audio" as a chip while
 * /generate only accepted a prompt and an aspect ratio — the user picked
 * settings that were silently thrown away. The guard for that used to be a
 * regex looking for `durationSeconds: state.durationSeconds` in the source,
 * which stopped meaning anything once the sheet started building its request
 * body from a config array (the right change: shown settings and sent
 * settings now come from ONE list, so they cannot drift).
 *
 * A regex cannot see that guarantee, so this test executes the real file in a
 * minimal DOM, opens the Video sheet, types a prompt, clicks Generate, and
 * asserts on the request that actually leaves the page. It also asserts the
 * opposite case: a mode the server refused must not be able to send anything.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'squad-create.js'), 'utf8');

/* ── a DOM just big enough to run the sheet ─────────────────────────────── */

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = { cssText: '', display: '' };
    this._class = '';
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.parentNode = null;
    this.classList = {
      add: (c) => { if (!this.hasClass(c)) this._class = (this._class + ' ' + c).trim(); },
      remove: (c) => { this._class = this._class.split(/\s+/).filter(x => x && x !== c).join(' '); },
      contains: (c) => this.hasClass(c),
      toggle: (c, on) => { on ? this.classList.add(c) : this.classList.remove(c); },
    };
  }
  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  hasClass(c) { return this._class.split(/\s+/).includes(c); }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c) { c.parentNode = this; this.children.unshift(c); return c; }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i > -1) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  getClientRects() { return []; }
  closest() { return null; }
  descendants() {
    return this.children.flatMap(c => [c, ...c.descendants()]);
  }
  matches(sel) {
    // supports: #id | .cls | .cls[data-mode="x"] | tag[attr*="v"]
    const m = /^(?:#([\w-]+)|\.([\w-]+)|(\w+))?(?:\[([\w-]+)([*^]?=)"([^"]*)"\])?$/.exec(sel);
    if (!m) return false;
    const [, id, cls, tag, attr, op, val] = m;
    if (id && this.id !== id) return false;
    if (cls && !this.hasClass(cls)) return false;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (attr) {
      const have = attr === 'style' ? this.style.cssText : this.getAttribute(attr);
      if (have === null || have === undefined) return false;
      if (op === '*=' ? !String(have).includes(val) : String(have) !== val) return false;
    }
    return true;
  }
  querySelector(sel) { return this.descendants().find(e => e.matches(sel)) || null; }
  querySelectorAll(sel) { return this.descendants().filter(e => e.matches(sel)); }
}

function fire(el, ev) {
  (el.listeners[ev] || []).forEach(fn => fn({ stopPropagation() {} }));
}
const tick = () => new Promise(r => setImmediate(r));

/**
 * Boot the sheet against stubbed endpoints.
 * `modes` is the /api/squad-create/modes payload; `health` the mode health.
 * Returns the sandbox plus every fetch the page made.
 */
function boot({ modes, health }) {
  const calls = [];
  const doc = new El('document');
  doc.head = new El('head');
  doc.body = new El('body');
  doc.readyState = 'complete';
  doc.createElement = (t) => new El(t);
  doc.getElementById = (id) => doc.body.descendants().find(e => e.id === id) || null;
  doc.querySelector = (s) => doc.body.querySelector(s);
  doc.querySelectorAll = (s) => doc.body.querySelectorAll(s);
  doc.addEventListener = () => {};

  const fetchStub = (url, opts) => {
    calls.push({ url, opts });
    const body = url.includes('/api/squad-create/modes') ? { modes }
      : url.endsWith('/health') ? health
        : url.endsWith('/history') ? { jobs: [], quota: { used: 0, limit: 5, remaining: 5 } }
          : { jobId: 'job-1' };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };

  const sandbox = {
    document: doc,
    window: { addEventListener: () => {}, matchMedia: () => ({ matches: false }) },
    location: { pathname: '/creator', origin: 'https://scangym.com' },
    navigator: {},
    fetch: fetchStub,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout,
    requestAnimationFrame: (fn) => fn(),
    console,
    calls,
  };
  sandbox.window.document = doc;
  vm.runInNewContext(SRC, sandbox);
  return sandbox;
}

const VIDEO_LIVE = {
  modes: {
    video: { label: 'Video', api: '/api/squad-video', configured: true },
    text: { label: 'Text', api: null, configured: false, reason: 'not_built' },
  },
  health: { available: true, quota: { used: 0, limit: 5, remaining: 5 } },
};

/** Open a mode's sheet from the rail. */
async function openMode(sb, key) {
  const rail = sb.document.getElementById('sg-sv-rail');
  assert.ok(rail, 'the Create rail was never rendered');
  const btn = rail.querySelector(`.sg-sv-btn[data-mode="${key}"]`);
  assert.ok(btn, `no rail button for ${key}`);
  fire(btn, 'click');
  for (let i = 0; i < 6; i++) await tick();
  return sb.document.getElementById('sg-sv-sheet');
}

test('Generate sends every setting the Video sheet displays', async () => {
  const sb = boot(VIDEO_LIVE);
  for (let i = 0; i < 6; i++) await tick();
  const sheet = await openMode(sb, 'video');
  assert.ok(sheet, 'the Video sheet did not open');

  sheet.querySelector('.sv-prompt').value = 'a bright gym walkthrough';
  const gen = sheet.querySelector('#sv-gen');
  assert.equal(gen.disabled, false, 'Generate stayed disabled for a live, in-quota mode');
  fire(gen, 'click');
  for (let i = 0; i < 6; i++) await tick();

  const post = sb.calls.find(c => c.url === '/api/squad-video/generate');
  assert.ok(post, 'Generate never posted to the video endpoint');
  const body = JSON.parse(post.opts.body);

  // The whole point: the four controls the sheet renders are all in the request.
  assert.equal(body.prompt, 'a bright gym walkthrough');
  for (const field of ['aspectRatio', 'durationSeconds', 'resolution', 'generateAudio']) {
    assert.ok(field in body, `${field} is shown in the sheet but not sent to /generate`);
  }
  assert.equal(body.durationSeconds, 8);
  assert.equal(body.generateAudio, true);
});

test('changing a setting changes what is sent', async () => {
  const sb = boot(VIDEO_LIVE);
  for (let i = 0; i < 6; i++) await tick();
  const sheet = await openMode(sb, 'video');

  // Duration cycles 4 → 6 → 8; it starts at 8, so one tap lands on 4.
  const rows = sheet.querySelector('#sv-settings').children;
  const durationVal = rows[1].children[1];
  fire(durationVal, 'click');

  sheet.querySelector('.sv-prompt').value = 'x';
  fire(sheet.querySelector('#sv-gen'), 'click');
  for (let i = 0; i < 6; i++) await tick();

  const body = JSON.parse(sb.calls.find(c => c.url === '/api/squad-video/generate').opts.body);
  assert.equal(body.durationSeconds, 4, 'the duration the user picked was not the one sent');
});

test('a mode the server refused cannot generate anything', async () => {
  const sb = boot(VIDEO_LIVE);
  for (let i = 0; i < 6; i++) await tick();
  const sheet = await openMode(sb, 'text');

  const gen = sheet.querySelector('#sv-gen');
  assert.equal(gen.disabled, true, 'an unbuilt mode offered a working Generate');
  assert.match(gen.textContent + gen.innerHTML, /Not switched on/,
    'the disabled button does not say why');

  sheet.querySelector('.sv-prompt').value = 'try me';
  fire(gen, 'click');
  for (let i = 0; i < 6; i++) await tick();
  assert.ok(!sb.calls.some(c => c.url && c.url.includes('/generate')),
    'an unconfigured mode still posted a generate request');
});

test('the old decorative settings chip has not come back', () => {
  assert.ok(!/⏱ 8s · 🔊 audio/.test(SRC), 'the decorative settings chip is back');
});
