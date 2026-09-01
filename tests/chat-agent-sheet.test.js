/**
 * The Talk chat opens as a half sheet, not a full-screen panel.
 *
 * The orange Talk button is deliberately unchanged — it is the product's main call
 * to action on all five tabs. What changed is only what it opens: the chat used to
 * cover the whole screen, the one surface in the app that did. Now it is a half
 * sheet dismissed the same two ways as every other sheet, swipe-down or the x.
 *
 * All five tabs share this one factory, so these run the real chat-agent.js in a
 * minimal DOM (no jsdom in this repo) and assert on what dragging actually does —
 * which a source regex cannot see.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'chat-agent.js'), 'utf8');

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = { cssText: '', display: '', transform: '', setProperty(){}, removeProperty(){} };
    this._class = '';
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.parentNode = null;
    this.onclick = null;
    this.rect = { height: 300, top: 0, bottom: 300, width: 400 };
    this.classList = {
      add: (...cs) => cs.forEach(c => { if (!this.hasClass(c)) this._class = (this._class + ' ' + c).trim(); }),
      remove: (...cs) => { this._class = this._class.split(/\s+/).filter(x => x && !cs.includes(x)).join(' '); },
      contains: (c) => this.hasClass(c),
      toggle: (c, on) => { on ? this.classList.add(c) : this.classList.remove(c); },
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    // Enough of a parser for the markup this file writes: nested tags with id/class
    // attributes. Without it, everything the sheet builds by string is invisible to
    // getElementById and the tests pass for the wrong reason.
    this._html = String(html == null ? '' : html);
    this.children = [];
    const stack = [this];
    const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(this._html))) {
      const [, closing, tag, attrs, selfClose, text] = m;
      const top = stack[stack.length - 1];
      if (text !== undefined) { top.textContent += text; continue; }
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const el = new El(tag);
      const id = /id="([^"]*)"/.exec(attrs || '');
      const cls = /class="([^"]*)"/.exec(attrs || '');
      if (id) el.id = id[1];
      if (cls) el.className = cls[1];
      top.appendChild(el);
      const VOID = ['br', 'img', 'input', 'hr'];
      if (!selfClose && !VOID.includes(tag.toLowerCase())) stack.push(el);
    }
  }
  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  hasClass(c) { return this._class.split(/\s+/).includes(c); }
  appendChild(c) {
    if (c.parentNode) c.remove();
    c.parentNode = this; this.children.push(c); return c;
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i > -1) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  getBoundingClientRect() { return this.rect; }
  getClientRects() { return []; }
  focus() {}
  descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
  matches(sel) {
    const m = /^(?:#([\w-]+)|\.([\w-]+)|(\w+))?(?:\[([\w-]+)\])?$/.exec(sel);
    if (!m) return false;
    const [, id, cls, tag, attr] = m;
    if (id && this.id !== id) return false;
    if (cls && !this.hasClass(cls)) return false;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (attr && this.getAttribute(attr) === null) return false;
    return true;
  }
  querySelector(sel) { return this.descendants().find(e => e.matches(sel)) || null; }
  querySelectorAll(sel) { return this.descendants().filter(e => e.matches(sel)); }
}

function touch(el, type, clientY) {
  (el.listeners[type] || []).forEach(fn => fn({ touches: [{ clientY }] }));
}
const tick = () => new Promise(r => setImmediate(r));

/** Boot the factory on a tab, optionally with a native rail already present. */
function boot({ pathname = '/creator' } = {}) {
  const doc = new El('#document');
  doc.head = new El('head');
  doc.body = new El('body');
  doc.documentElement = new El('html');
  doc.readyState = 'complete';
  doc.createElement = (t) => new El(t);
  const all = () => [...doc.head.descendants(), ...doc.body.descendants()];
  doc.getElementById = (id) => all().find(e => e.id === id) || null;
  doc.querySelector = (s) => doc.body.querySelector(s);
  doc.querySelectorAll = (s) => doc.body.querySelectorAll(s);
  doc.addEventListener = () => {};

  const frames = [];
  const winHandlers = {};
  const sandbox = {
    addEventListener: (ev, fn) => { (winHandlers[ev] = winHandlers[ev] || []).push(fn); },
    removeEventListener: () => {},
    winHandlers,
    document: doc,
    location: { pathname, search: '', href: 'https://scangym.com' + pathname },
    navigator: { userAgent: 'test', mediaDevices: {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    console,
    Date,
    Math,
    frames,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(SRC, sandbox);

  sandbox.sgChatAgent.create({
    ns: 'schat',
    paths: /^\/(creator|scansquad)(\/|$)/,
    endpoint: '/api/book/agent',
    avatar: '🏋️', title: 'ScanGym', subtitle: 'sub',
    chips: [], toolLabels: {},
    greetSignedIn: 'hi', greetSignedOut: 'hi out', signedOutReply: 'x',
  });
  // flush the rAF queue the same way a browser would
  sandbox.flush = () => { while (frames.length) frames.shift()(); };
  /** Re-run the agent's own route check, the way the app does when it navigates. */
  sandbox.route = () => (winHandlers.popstate || []).forEach(fn => fn());
  return sandbox;
}

const talkOf = (sb) => sb.document.getElementById('schat-fab');
const sheetOf = (sb) => sb.document.getElementById('schat');

test('the orange Talk button is left exactly as it was', () => {
  const sb = boot({ pathname: '/creator' });
  const talk = talkOf(sb);
  assert.ok(talk, 'the Talk button is gone');
  assert.equal(talk.parentNode, sb.document.body,
    'Talk was moved off the page body — it should stay the floating CTA');
  assert.ok(talk.hasClass('show'), 'Talk is not showing on its own tab');
  assert.ok(/#pchat-fab\{position:fixed;right:14px;z-index:9100/.test(SRC),
    'the orange pill styling changed');
  assert.ok(/pchat-fab-dot"><\/span>Talk/.test(SRC), 'the Talk label changed');
});

test('the chat opens as a half sheet that slides up', () => {
  const sb = boot({ pathname: '/creator' });
  const talk = talkOf(sb);
  talk.onclick();
  const sheet = sheetOf(sb);
  assert.ok(sheet.hasClass('open'), 'the sheet did not open');
  assert.ok(!sheet.hasClass('in'), 'the sheet skipped its slide-up frame');
  sb.flush();
  assert.ok(sheet.hasClass('in'), 'the sheet never slid up');
  assert.ok(/#pchat\{position:fixed;left:0;right:0;top:auto;/.test(SRC),
    'the sheet is anchored to the top again — that is the full-screen panel');
  assert.ok(/height:min\(50vh/.test(SRC), 'the sheet is not half height');
});

test('swiping the handle far enough closes it; a nudge does not', () => {
  const sb = boot({ pathname: '/creator' });
  talkOf(sb).onclick();
  sb.flush();
  const sheet = sheetOf(sb);
  const grab = sb.document.getElementById('schat-grab');
  assert.ok(grab, 'the sheet has no drag handle');
  sheet.rect = { height: 300, top: 0, bottom: 300, width: 400 };

  touch(grab, 'touchstart', 0);
  touch(grab, 'touchmove', 20);
  assert.equal(sheet.style.transform, 'translateY(20px)', 'the sheet does not follow the finger');
  (grab.listeners.touchend || []).forEach(fn => fn({}));
  assert.ok(sheet.hasClass('in'), 'a 20px nudge dismissed the sheet');

  touch(grab, 'touchstart', 0);
  touch(grab, 'touchmove', 200);            // two thirds down
  (grab.listeners.touchend || []).forEach(fn => fn({}));
  assert.ok(!sheet.hasClass('in'), 'a full swipe did not dismiss the sheet');
});

test('the x still closes it', () => {
  const sb = boot({ pathname: '/creator' });
  talkOf(sb).onclick();
  sb.flush();
  const sheet = sheetOf(sb);
  sb.document.getElementById('schat-close').onclick();
  assert.ok(!sheet.hasClass('in'), 'the x did not dismiss the sheet');
});

test('Talk still only appears on its own tab', () => {
  const sb = boot({ pathname: '/book' });
  assert.ok(!talkOf(sb).hasClass('show'), 'Talk showed on another tab');
});
