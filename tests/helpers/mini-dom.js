'use strict';

/**
 * The smallest DOM that can hold a bottom sheet.
 *
 * There is no jsdom in this repo and adding one for two files is not worth the
 * dependency, so tests that need to run real frontend code use this. It is the
 * element model from tests/chat-agent-sheet.test.js, lifted out so more than
 * one test can use it: enough innerHTML parsing that getElementById finds what
 * a sheet built from a string, plus listeners, classList and click/touch.
 */

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = { cssText: '', display: '', transform: '', opacity: '', setProperty() {}, removeProperty() {} };
    this._class = '';
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.parentNode = null;
    this.onclick = null;
    this.scrollTop = 0;
    this.rect = { height: 500, top: 200, bottom: 700, width: 414 };
    this.classList = {
      add: (...cs) => cs.forEach((c) => { if (!this.hasClass(c)) this._class = (this._class + ' ' + c).trim(); }),
      remove: (...cs) => { this._class = this._class.split(/\s+/).filter((x) => x && !cs.includes(x)).join(' '); },
      contains: (c) => this.hasClass(c),
      toggle: (c, on) => { on ? this.classList.add(c) : this.classList.remove(c); },
    };
  }

  get innerHTML() { return this._html; }
  set innerHTML(html) {
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
      const val = /value="([^"]*)"/.exec(attrs || '');
      if (id) el.id = id[1];
      if (cls) el.className = cls[1];
      if (val) el.value = val[1];
      top.appendChild(el);
      const VOID = ['br', 'img', 'input', 'hr', 'meta', 'link'];
      if (!selfClose && !VOID.includes(tag.toLowerCase())) stack.push(el);
    }
  }

  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  hasClass(c) { return this._class.split(/\s+/).includes(c); }
  get firstChild() { return this.children[0] || null; }

  appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    if (c.parentNode) c.remove();
    const i = this.children.indexOf(ref);
    c.parentNode = this;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
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
  focus() {}
  click() { if (typeof this.onclick === 'function') this.onclick({ stopPropagation() {} }); }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
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
  querySelector(sel) { return this.descendants().find((e) => e.matches(sel)) || null; }
  querySelectorAll(sel) { return this.descendants().filter((e) => e.matches(sel)); }
}

/** A document plus a window-ish sandbox, ready for vm.runInNewContext. */
function makeSandbox({ pathname = '/', extras = {} } = {}) {
  const doc = new El('#document');
  doc.head = new El('head');
  doc.body = new El('body');
  doc.readyState = 'complete';
  doc.createElement = (t) => new El(t);
  doc.docListeners = {};
  doc.addEventListener = (ev, fn) => { (doc.docListeners[ev] = doc.docListeners[ev] || []).push(fn); };
  doc.removeEventListener = () => {};
  const all = () => [...doc.head.descendants(), ...doc.body.descendants()];
  doc.getElementById = (id) => all().find((e) => e.id === id) || null;
  doc.querySelector = (s) => doc.body.querySelector(s) || doc.head.querySelector(s);
  doc.querySelectorAll = (s) => [...doc.head.querySelectorAll(s), ...doc.body.querySelectorAll(s)];

  const store = {};
  const sandbox = {
    document: doc,
    location: { pathname, search: '', href: 'https://scangym.com' + pathname },
    navigator: { userAgent: 'test' },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: (fn) => { fn(); return 1; },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    console, Date, Math, JSON, encodeURIComponent, parseInt, parseFloat, Number, String,
    ...extras,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  return { sandbox, doc };
}

/** Fire a listener registered with addEventListener. */
function fire(el, type, event = {}) {
  (el.listeners[type] || []).forEach((fn) => fn(event));
}

/** Fire a document-level listener (Escape, etc). */
function fireDoc(doc, type, event = {}) {
  (doc.docListeners[type] || []).forEach((fn) => fn(event));
}

const tick = () => new Promise((r) => setImmediate(r));

module.exports = { El, makeSandbox, fire, fireDoc, tick };
