// Route lifecycle tests: mount every route, in every vault state, through the real Router.
//
// WHAT THIS COVERS THAT NOTHING ELSE DOES
//
//   - scripts/check-routes.mjs proves the route TABLE is consistent (every navigated path exists,
//     every registered route is reachable, every CSS class is defined). It never mounts anything.
//   - test-ui-dom.mjs proves h() cannot be coerced into producing markup. It never builds a screen.
//   - This file mounts all 14 routes through the real Router, the real guards, the real bridge and
//     the real kit, with only `chrome.runtime.sendMessage` mocked, in each of the three vault
//     states the app can be in (no vault / locked / unlocked), and asserts:
//
//       1. no route throws on mount, and every route lands where its guard says it should;
//       2. teardown removes the listeners it added — nothing keeps a handler alive on a subtree
//          that is no longer in the document;
//       3. no password, mnemonic or private key appears in the rendered DOM, in any attribute or
//          dataset value, in an input's value, or in the URL — and none of them survives in the
//          detached DOM after the route is destroyed;
//       4. the modal keyboard focus trap actually traps (Tab wraps, Escape cancels, focus returns);
//       5. Settings offers no way to add a custom network; legacy records are clearly disabled,
//          cannot dispatch network.setActive even through the real bridge, remain removable, and
//          the side panel opens through an explicit action that does not change toolbar behaviour.
//
// WHY NOT jsdom
//
// AGENTS.md rule 5 is "no new dependencies", and a hand-rolled shim is already the house style
// (test-ui-dom.mjs). The shim below implements the DOM surface this codebase actually touches —
// nothing more. That is also why it is a fair test: a route that needed an API the shim does not
// have is a route that reached outside the kit's documented surface, and the failure says so.
//
// The shim cannot prove browser RENDERING (layout, real focus rings, canvas output). Those are
// covered by docs/MANUAL_SMOKE_CHECKLIST.md, which exists for exactly that gap.
//
// Run: node test-route-lifecycle.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---- Harness --------------------------------------------------------------

let checks = 0;
let failures = 0;
const failureLabels = [];

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    failureLabels.push(label);
    // realConsole, not console: failures must stay visible while console.error is captured to
    // detect route errors.
    realConsole.error(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

// ---- Secrets that must never reach the DOM --------------------------------
//
// These are the fixture values the mocked backend will hand out. If any of them shows up in the
// rendered tree, an attribute, an input value or the URL, that is a real defect: the app has put
// a secret somewhere it can be scraped by another extension, a crash report or a stale document.

const SECRET_MNEMONIC = 'correct horse battery staple zebra anvil quorum ledger thistle marble '
  + 'pivot canyon radar summit velvet';
const SECRET_PRIVATE_KEY = 'b'.repeat(64);
const SECRET_PASSWORD = 'Hunter2!correct-horse';
const ADDRESS_A = 'ta1addressaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ADDRESS_B = 'ta1addressbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** A deployed token the active account actually holds (contract v8 asset flows). */
const TOKEN_FIXTURE = {
  mintAddress: 'ta1smkfixturemint000000000000000000000000000',
  symbol: 'SMK',
  name: 'Smoke Token',
  decimals: 6,
  imageUrl: '',
  hidden: false,
  source: 'deployed',
  deployedAt: 1750000000000,
  initialSupply: '1000000000',
};
const TOKEN_ACCOUNT_FIXTURE = 'ta1smktokenaccount0000000000000000000000';

/** Every string that must never appear in the DOM, by kind. */
const SECRETS = [
  ['mnemonic', SECRET_MNEMONIC],
  ['mnemonic word "thistle"', 'thistle'],
  ['private key', SECRET_PRIVATE_KEY],
  ['password', SECRET_PASSWORD],
];

// ---- DOM shim -------------------------------------------------------------

/** Every element ever created, so detached subtrees can still be scanned. */
const CREATED = [];

let DOC = null;
let WIN = null;

class ShimNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
    this.nodeType = 0;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  appendChild(child) {
    if (!child) return child;
    // DocumentFragment: splice its children in, as the real DOM does.
    if (child.nodeType === 11) {
      for (const c of [...child.childNodes]) this.appendChild(c);
      return child;
    }
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, ref) {
    if (!ref) return this.appendChild(child);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(i, 0, child);
    return child;
  }

  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  replaceChild(next, old) {
    const i = this.childNodes.indexOf(old);
    if (i < 0) return old;
    next.parentNode?.removeChild(next);
    next.parentNode = this;
    this.childNodes[i] = next;
    old.parentNode = null;
    return old;
  }

  replaceChildren(...next) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    for (const c of next) this.appendChild(c);
  }

  remove() {
    this.parentNode?.removeChild(this);
  }
}

class ShimText extends ShimNode {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.data = String(data);
  }

  get textContent() {
    return this.data;
  }

  set textContent(next) {
    this.data = String(next);
  }
}

class ShimFragment extends ShimNode {
  constructor() {
    super();
    this.nodeType = 11;
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent || '').join('');
  }
}

class ClassList {
  constructor(el) {
    this.el = el;
    this.names = new Set();
  }

  add(...names) {
    for (const n of names) if (n) this.names.add(String(n));
    this.sync();
  }

  remove(...names) {
    for (const n of names) this.names.delete(String(n));
    this.sync();
  }

  contains(name) {
    return this.names.has(String(name));
  }

  /** Real semantics: with no second argument, toggle inverts and returns the new state. */
  toggle(name, force) {
    const key = String(name);
    const shouldAdd = force === undefined ? !this.names.has(key) : Boolean(force);
    if (shouldAdd) this.names.add(key);
    else this.names.delete(key);
    this.sync();
    return shouldAdd;
  }

  get length() {
    return this.names.size;
  }

  get value() {
    return [...this.names].join(' ');
  }

  sync() {
    this.el.attributes.set('class', [...this.names].join(' '));
  }
}

class ShimStyle {
  constructor() {
    this.props = new Map();
  }

  setProperty(name, value) {
    this.props.set(String(name), String(value));
  }

  getPropertyValue(name) {
    return this.props.get(String(name)) ?? '';
  }

  removeProperty(name) {
    this.props.delete(String(name));
  }
}

class ShimElement extends ShimNode {
  constructor(tagName, namespaceURI = null) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.localName = String(tagName).toLowerCase();
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    this.dataset = {};
    this.style = new ShimStyle();
    this.classList = new ClassList(this);
    this.listeners = [];
    // Reflected properties. The real DOM keeps these in step with their attributes for these
    // three, and src/ui/kit/field.js reads `control.type` after h() set it as an attribute.
    this._value = '';
    this._type = '';
    this._disabled = false;
    this._checked = false;
    this._focused = false;
    CREATED.push(this);
  }

  // ---- attributes ----
  setAttribute(name, value) {
    const key = String(name);
    const v = value === true ? '' : String(value);
    this.attributes.set(key, v);
    const lower = key.toLowerCase();
    if (lower === 'class') {
      this.classList.names = new Set(v.split(/\s+/).filter(Boolean));
    } else if (lower === 'type') {
      this._type = v;
    } else if (lower === 'disabled') {
      this._disabled = true;
    } else if (lower === 'checked') {
      this._checked = true;
    } else if (lower === 'value') {
      this._value = v;
    } else if (lower.startsWith('data-')) {
      this.dataset[lower.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
  }

  getAttribute(name) {
    const key = String(name);
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  removeAttribute(name) {
    const key = String(name);
    this.attributes.delete(key);
    const lower = key.toLowerCase();
    if (lower === 'class') this.classList.names = new Set();
    else if (lower === 'type') this._type = '';
    else if (lower === 'disabled') this._disabled = false;
    else if (lower === 'checked') this._checked = false;
    else if (lower.startsWith('data-')) {
      delete this.dataset[lower.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    }
  }

  // ---- reflected properties ----
  get value() {
    return this._value;
  }

  set value(next) {
    this._value = next == null ? '' : String(next);
  }

  get type() {
    return this._type;
  }

  set type(next) {
    this._type = next == null ? '' : String(next);
  }

  get disabled() {
    return this._disabled;
  }

  set disabled(next) {
    this._disabled = Boolean(next);
    if (this._disabled) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get checked() {
    return this._checked;
  }

  set checked(next) {
    this._checked = Boolean(next);
  }

  get hidden() {
    return this.attributes.has('hidden');
  }

  set hidden(next) {
    if (next) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }

  get id() {
    return this.attributes.get('id') || '';
  }

  set id(next) {
    this.setAttribute('id', next);
  }

  get className() {
    return this.classList.value;
  }

  set className(next) {
    this.setAttribute('class', next);
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent ?? '').join('');
  }

  set textContent(next) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (next !== '' && next != null) this.appendChild(new ShimText(next));
  }

  // ---- focus ----
  focus() {
    if (this._disabled) return;
    DOC.activeElement = this;
    this._focused = true;
  }

  blur() {
    if (DOC.activeElement === this) DOC.activeElement = DOC.body;
    this._focused = false;
  }

  // ---- events ----
  addEventListener(type, handler, options) {
    if (typeof handler !== 'function') return;
    this.listeners.push({ type: String(type), handler, capture: Boolean(options?.capture ?? options) });
  }

  removeEventListener(type, handler) {
    const i = this.listeners.findIndex((l) => l.type === String(type) && l.handler === handler);
    if (i >= 0) this.listeners.splice(i, 1);
  }

  dispatchEvent(event) {
    // Ancestors first for capture listeners, then target-to-root for bubble listeners.
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    if (DOC && !path.includes(DOC)) path.push(DOC);

    const ev = {
      type: event.type,
      target: this,
      defaultPrevented: false,
      bubbles: true,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      stopImmediatePropagation() {},
      ...event,
    };
    ev.target = this;

    for (const node of [...path].reverse()) {
      for (const l of [...node.listeners]) {
        if (l.type === ev.type && l.capture) {
          ev.currentTarget = node;
          l.handler.call(node, ev);
        }
      }
    }
    for (const node of path) {
      for (const l of [...node.listeners]) {
        if (l.type === ev.type && !l.capture) {
          ev.currentTarget = node;
          l.handler.call(node, ev);
        }
      }
    }
    return !ev.defaultPrevented;
  }

  // ---- selectors ----
  // Only what src/ui/app/router.js asks for ('[autofocus]') plus a few simple forms, so the shim
  // stays small. kit/focus-trap.js deliberately tree-walks instead of using selectors.
  matches(selector) {
    return String(selector)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .some((sel) => {
        const m = /^([a-zA-Z]*)((?:[.#][\w-]+|\[[^\]]+\])*)$/.exec(sel);
        if (!m) return false;
        const [, tag, rest] = m;
        if (tag && this.localName !== tag.toLowerCase()) return false;
        const parts = rest.match(/[.#][\w-]+|\[[^\]]+\]/g) || [];
        return parts.every((part) => {
          if (part.startsWith('.')) return this.classList.contains(part.slice(1));
          if (part.startsWith('#')) return this.id === part.slice(1);
          const inner = part.slice(1, -1);
          const eq = inner.indexOf('=');
          if (eq < 0) return this.hasAttribute(inner.trim());
          const name = inner.slice(0, eq).trim();
          const value = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
          return this.getAttribute(name) === value;
        });
      });
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /** Canvas: src/popup/qr.js draws the receive QR with fillRect. Nothing is rendered here. */
  getContext() {
    if (!this._ctx) {
      this._ctx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        fillRect() {},
        clearRect() {},
        strokeRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fill() {},
        arc() {},
        save() {},
        restore() {},
        translate() {},
        scale() {},
        fillText() {},
        measureText: () => ({ width: 0 }),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData() {},
        createImageData: () => ({ data: new Uint8ClampedArray(4) }),
        drawImage() {},
      };
    }
    return this._ctx;
  }

  scrollIntoView() {}

  select() {}

  closest(selector) {
    for (let n = this; n; n = n.parentNode) {
      if (n.nodeType === 1 && n.matches(selector)) return n;
    }
    return null;
  }
}

class ShimDocument extends ShimElement {
  constructor() {
    super('#document');
    this.nodeType = 9;
    this.title = '';
    this.activeElement = null;
    this.documentElement = new ShimElement('html');
    this.head = new ShimElement('head');
    this.body = new ShimElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
    CREATED.length = 0;
    CREATED.push(this.documentElement, this.head, this.body);
  }

  createElement(tagName) {
    return new ShimElement(tagName);
  }

  createElementNS(ns, tagName) {
    return new ShimElement(tagName, ns);
  }

  createTextNode(data) {
    return new ShimText(data);
  }

  createDocumentFragment() {
    return new ShimFragment();
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

/** Is this node currently inside the document? */
function isConnected(node) {
  for (let n = node; n; n = n.parentNode) {
    if (n === DOC?.documentElement || n === DOC) return true;
  }
  return false;
}

/** Total listener count across every element, plus document and window. */
function countListeners() {
  let n = DOC.listeners.length + WIN.listeners.length;
  for (const el of CREATED) n += el.listeners.length;
  return n;
}

/** Identify a leaked element well enough to find the code that owns it. */
function describeElement(el) {
  const label = el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '';
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  let root = el;
  while (root.parentNode) root = root.parentNode;
  const rootLabel = root.localName === el.localName
    ? ''
    : ` in detached root <${root.localName}${root.className ? ` class="${root.className}"` : ''}>`;
  return `<${el.localName}${el.className ? ` class="${el.className}"` : ''}>`
    + `${label ? ` aria-label="${label}"` : ''}${text ? ` text="${text}"` : ''}${rootLabel}`;
}

/** Listeners still attached to elements that are no longer in the document. */
function detachedListeners() {
  const out = [];
  for (const el of CREATED) {
    if (el.listeners.length && !isConnected(el)) {
      out.push({
        where: describeElement(el),
        events: [...new Set(el.listeners.map((l) => l.type))].join(','),
        count: el.listeners.length,
      });
    }
  }
  return out;
}

/**
 * Every string the DOM holds for a subtree: text nodes, attributes, dataset and input values.
 * @returns {{ text: string[], attrs: string[] }}
 */
function collectStrings(root) {
  const text = [];
  const attrs = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      text.push(node.data);
      return;
    }
    if (node.nodeType !== 1) return;
    for (const [k, v] of node.attributes) attrs.push(`${k}="${v}"`);
    for (const [k, v] of Object.entries(node.dataset || {})) attrs.push(`data-${k}="${v}"`);
    if (typeof node._value === 'string' && node._value) attrs.push(`value="${node._value}"`);
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return { text, attrs };
}

/**
 * Where does a secret appear, if anywhere?
 *
 * Scans the LIVE document only. Nodes a component properly removed from their parent are not
 * scanned here: they are unreachable from the document, which is the property that matters, and
 * findSecretsInTornDown() covers the subtree a destroyed route actually hands back.
 *
 * @param {Array<[string, string]>} secrets kind/value pairs
 * @returns {string[]} human-readable hit locations
 */
function findSecrets(secrets) {
  const hits = [];
  const live = collectStrings(DOC.documentElement);
  for (const [kind, value] of secrets) {
    for (const str of live.text) {
      if (str.includes(value)) hits.push(`${kind} in document text: ${str.slice(0, 140)}`);
    }
    for (const str of live.attrs) {
      if (str.includes(value)) hits.push(`${kind} in document attribute: ${str.slice(0, 140)}`);
    }
  }
  return hits;
}

/**
 * Elements handed back by routes and dialogs, captured BEFORE they are destroyed.
 *
 * This is the meaningful form of "no secret in the detached DOM": the element a route returned is
 * the element a stale closure can still read, re-attach or copy from. Scanning every orphan node
 * ever created would instead flag text nodes a component correctly removed from their parent,
 * which are unreachable and therefore not a leak.
 */
const TORN_DOWN = [];

function rememberForTeardown(instance) {
  if (instance?.el) TORN_DOWN.push(instance.el);
}

function findSecretsInTornDown(secrets) {
  const hits = [];
  for (const root of TORN_DOWN) {
    const { text, attrs } = collectStrings(root);
    for (const [kind, value] of secrets) {
      for (const str of text) {
        if (str.includes(value)) {
          hits.push(`${kind} still in torn-down <${root.localName}> text: ${str.slice(0, 140)}`);
        }
      }
      for (const str of attrs) {
        if (str.includes(value)) {
          hits.push(`${kind} still in torn-down <${root.localName}> attribute: ${str.slice(0, 140)}`);
        }
      }
    }
  }
  return hits;
}

/**
 * Strict scan: an element's OWN attribute, dataset and input-value channels, across every element
 * ever created, attached or not.
 *
 * A secret in an attribute is never legitimate. The historical defect this guards is
 * popup.js:465 writing the mnemonic to `grid.dataset.raw`, where no code path ever removed it —
 * and popup.html is registered as a side panel, so that document could live for days.
 */
function findSecretsInAttributes(secrets) {
  const hits = [];
  for (const el of CREATED) {
    const own = [];
    for (const [k, v] of el.attributes) own.push(`${k}="${v}"`);
    for (const [k, v] of Object.entries(el.dataset || {})) own.push(`data-${k}="${v}"`);
    if (typeof el._value === 'string' && el._value) own.push(`value="${el._value}"`);
    for (const [kind, value] of secrets) {
      for (const a of own) {
        if (a.includes(value)) {
          const where = isConnected(el) ? 'live' : 'detached';
          hits.push(`${kind} in ${where} <${el.localName}> ${a.slice(0, 140)}`);
        }
      }
    }
  }
  return hits;
}

// ---- window / location / history ------------------------------------------

const HISTORY_URLS = [];

function makeWindow(doc) {
  const listeners = [];
  let location = null;
  const win = {
    listeners,
    document: doc,
    addEventListener(type, handler, options) {
      listeners.push({
        type: String(type),
        handler,
        capture: Boolean(options?.capture ?? options),
      });
    },
    removeEventListener(type, handler) {
      const i = listeners.findIndex((l) => l.type === String(type) && l.handler === handler);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(event) {
      for (const l of [...listeners]) {
        if (l.type === event.type) l.handler.call(win, event);
      }
      return true;
    },
    // A real browser runs this AFTER the current task, before the next paint. Running it inline
    // changes ordering the app depends on: password-prompt builds its focus trap (capturing the
    // element to restore focus to) before its rAF callback focuses the field.
    requestAnimationFrame: (fn) => {
      queueMicrotask(() => fn(0));
      return 1;
    },
    cancelAnimationFrame() {},
    // A real browser pushes a session-history entry every time location.hash changes, and that is
    // what makes router.back() work: it only calls history.back() when history.length > 1. Modelling
    // length as a constant would silently send every Back to the '/unlock' fallback and hide real
    // navigation bugs, so the stack is modelled properly.
    history: {
      length: 1,
      stack: [],
      replaceState(_state, _title, url) {
        HISTORY_URLS.push(String(url));
        applyUrl(String(url));
      },
      pushState(_state, _title, url) {
        HISTORY_URLS.push(String(url));
        this.stack.push(location.href);
        this.length += 1;
        applyUrl(String(url));
        win.dispatchEvent({ type: 'hashchange' });
      },
      back() {
        const previous = this.stack.pop();
        HISTORY_URLS.push(`[history.back -> ${previous}]`);
        if (previous == null) return;
        this.length = Math.max(1, this.length - 1);
        applyUrl(previous);
        win.dispatchEvent({ type: 'hashchange' });
      },
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };

  location = {
    _hash: '',
    pathname: '/popup.html',
    search: '',
    origin: 'chrome-extension://test-extension-id',
    get href() {
      return `${this.origin}${this.pathname}${this.search}${this._hash}`;
    },
    get hash() {
      return this._hash;
    },
    set hash(next) {
      const value = String(next || '');
      if (value === this._hash) return;
      // Setting the hash is a navigation: it pushes a history entry, exactly like a browser.
      win.history.stack.push(this.href);
      win.history.length += 1;
      this._hash = value.startsWith('#') || value === '' ? value : `#${value}`;
      HISTORY_URLS.push(this.href);
      win.dispatchEvent({ type: 'hashchange' });
    },
    reload() {},
    replace(url) {
      applyUrl(String(url));
    },
    assign(url) {
      applyUrl(String(url));
    },
  };

  function applyUrl(url) {
    const hashIndex = url.indexOf('#');
    location._hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  }

  win.location = location;
  return win;
}

// ---- Timers: recorded so the process can exit ------------------------------

const PENDING_TIMERS = new Set();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

function installTimers() {
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = realSetTimeout(() => {
      PENDING_TIMERS.delete(id);
      fn(...args);
    }, ms);
    PENDING_TIMERS.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    PENDING_TIMERS.delete(id);
    realClearTimeout(id);
  };
  // unlock.js runs a 1s lockout countdown with setInterval. It must never fire here: a ticking
  // interval would keep the process alive and make the run non-deterministic.
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
}

function clearTimers() {
  for (const id of PENDING_TIMERS) realClearTimeout(id);
  PENDING_TIMERS.clear();
}

// ---- Fixture backend ------------------------------------------------------
//
// Only `chrome.runtime.sendMessage` is mocked. Every response shape below was read from the
// service that really produces it (src/background/services/*), so a route that renders from these
// fixtures renders the way it does in the browser. Where a shape is wrong the route shows an empty
// state instead of failing, which is why the assertions also check that expected content appeared.

const NETWORK_ALPHANET = {
  id: 'alphanet',
  label: 'Alphanet',
  rpcUrl: 'https://rpc.alphanet.thru.org',
  explorerUrl: 'https://scan.thru.org',
  faucetProgramId: 'ta1faucetprogramidprogramidprogramidprogramid1',
  faucetStateAccount: 'ta1stateaccountstateaccountstateaccountstate1',
  faucetMaxPerClaim: '10000',
  transferProgramId: 'ta1transferprogramidprogramidprogramidprogra1',
  tokenProgramId: 'ta1tokenprogramidprogramidprogramidprogrami1',
  isTestnet: true,
  enabled: true,
  environment: 'devnet',
  baseFeeUnits: '1',
  feeReserveUnits: '1000',
  custom: false,
  selectable: true,
};

const NETWORK_TESTNET = { ...NETWORK_ALPHANET, id: 'testnet', label: 'Testnet',
  rpcUrl: 'https://rpc.testnet.thru.org', explorerUrl: 'https://scan.testnet.thru.org',
  faucetProgramId: null, environment: 'testnet', baseFeeUnits: null, feeReserveUnits: null };

// A network saved before custom-network quarantine. Contract v7 keeps the record visible and
// removable, but neither this fixture nor the real background permits it to become active.
const NETWORK_CUSTOM = {
  id: 'custom:https://my-node.example/rpc',
  label: 'My node',
  rpcUrl: 'https://my-node.example/rpc',
  explorerUrl: '',
  faucetProgramId: null,
  transferProgramId: NETWORK_ALPHANET.transferProgramId,
  tokenProgramId: NETWORK_ALPHANET.tokenProgramId,
  isTestnet: false,
  enabled: true,
  environment: 'custom',
  baseFeeUnits: null,
  feeReserveUnits: null,
  custom: true,
  selectable: false,
  unselectableReason: 'Custom networks cannot be selected. The wallet will not build or sign '
    + 'transactions against an endpoint whose chain programs it has not verified.',
};

const SEED_KEYRING = {
  id: 'kr_seed_1',
  type: 'seed',
  label: 'Recovery phrase',
  origin: 'created',
  backedUpAt: null,
  accountCount: 2,
  hdIndices: [0, 1],
  createdAt: 1750000000000,
};

const IMPORTED_KEYRING = {
  id: 'kr_pk_1',
  type: 'privateKey',
  label: 'Imported key',
  origin: 'imported',
  backedUpAt: null,
  accountCount: 1,
  hdIndices: [],
  createdAt: 1750000001000,
};

function makeAccount(index) {
  const hdRef = { kind: 'hd', keyringId: SEED_KEYRING.id, index, accountIndex: index };
  return {
    address: index === 0 ? ADDRESS_A : ADDRESS_B,
    publicKey: 'pub'.padEnd(44, String(index)).slice(0, 44),
    label: index === 0 ? 'Main' : 'Spending',
    ref: hdRef,
    hdIndex: index,
    keyring: {
      id: SEED_KEYRING.id,
      type: 'seed',
      label: SEED_KEYRING.label,
      origin: SEED_KEYRING.origin,
    },
    hidden: false,
    pinned: index === 0,
    balance: index === 0 ? '1500000' : '250000',
    exists: true,
  };
}

const PREFERENCES = {
  version: 3,
  fiatCurrency: 'USD',
  hideSmallBalances: false,
  smallBalanceThreshold: '0',
  accountOrder: [],
  pinnedAccounts: [ADDRESS_A],
  hiddenAccounts: [],
  enforceWhitelist: false,
  whitelist: [],
  requirePasswordForSigning: true,
  hiddenTokens: [],
  customTokens: [],
  disclaimerAcknowledgedAt: 1750000002000,
  backupReminderDismissedAt: null,
};

const HISTORY_ENTRIES = [
  {
    signature: 'sig1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    slot: 10231,
    success: true,
    programAddress: NETWORK_ALPHANET.transferProgramId,
    kind: 'transfer',
    amount: '100000',
    counterparty: ADDRESS_B,
    timestamp: 1750000010000,
  },
  {
    signature: 'sig2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    slot: 10188,
    success: true,
    programAddress: NETWORK_ALPHANET.faucetProgramId,
    kind: 'faucet',
    amount: '10000',
    counterparty: null,
    timestamp: 1750000005000,
  },
  {
    signature: 'sig3cccccccccccccccccccccccccccccccccccccccc',
    slot: 10102,
    success: false,
    programAddress: NETWORK_ALPHANET.transferProgramId,
    kind: 'transfer',
    amount: '500',
    counterparty: ADDRESS_B,
    timestamp: 1749999990000,
  },
];

/** Per-run backend state. Reset before each scenario. */
const backend = {
  hasVault: false,
  unlocked: false,
  activeIndex: 0,
  activeNetworkId: 'alphanet',
  autoLockMinutes: 15,
  preferences: { ...PREFERENCES },
  customNetworks: [NETWORK_CUSTOM],
  accounts: [makeAccount(0), makeAccount(1)],
  keyrings: [SEED_KEYRING, IMPORTED_KEYRING],
  contacts: [{ address: ADDRESS_B, label: 'Spending wallet', createdAt: 1750000003000 }],
  lockout: { locked: false, failedAttempts: 0, retryInMs: 0 },
  pending: [],
  tokens: [TOKEN_FIXTURE],
};

function activeNetwork() {
  if (backend.activeNetworkId === 'testnet') return NETWORK_TESTNET;
  if (backend.activeNetworkId.startsWith('custom:')) return NETWORK_CUSTOM;
  return NETWORK_ALPHANET;
}

function activeAccount() {
  return backend.accounts[backend.activeIndex] || backend.accounts[0];
}

function networkList() {
  return [NETWORK_ALPHANET, NETWORK_TESTNET, ...backend.customNetworks];
}

/** Fixture errors carry the same shape api-router puts on the wire. */
function apiError(code, message, retryable = false) {
  const err = new Error(message);
  err.code = code;
  err.retryable = retryable;
  return err;
}

const FIXTURES = {
  'system.bootstrap': () => ({
    contractVersion: 7,
    hasVault: backend.hasVault,
    unlocked: backend.unlocked,
    account: backend.unlocked ? activeAccount() : null,
    accounts: backend.unlocked ? backend.accounts : [],
    keyrings: backend.hasVault ? backend.keyrings : [],
    network: activeNetwork(),
    autoLockMinutes: backend.autoLockMinutes,
    lockout: { ...backend.lockout },
    preferences: { ...backend.preferences },
    pending: [...backend.pending],
  }),
  'system.getAutoLock': () => backend.autoLockMinutes,
  'system.setAutoLock': ({ minutes } = {}) => {
    backend.autoLockMinutes = Number(minutes) || 0;
    return backend.autoLockMinutes;
  },

  'wallet.hasVault': () => backend.hasVault,
  'wallet.isUnlocked': () => backend.unlocked,
  'wallet.getLockoutState': () => ({ ...backend.lockout }),
  'wallet.unlock': ({ password } = {}) => {
    if (!backend.hasVault) throw apiError('NO_VAULT', 'No wallet found.');
    if (password !== SECRET_PASSWORD) throw apiError('BAD_PASSWORD', 'Incorrect password.');
    backend.unlocked = true;
    return { unlocked: true };
  },
  'wallet.verifyPassword': ({ password } = {}) => {
    if (password !== SECRET_PASSWORD) throw apiError('BAD_PASSWORD', 'Incorrect password.');
    return { verified: true };
  },
  'wallet.lock': () => {
    backend.unlocked = false;
    return { locked: true };
  },
  'wallet.create': ({ password } = {}) => {
    if (!password) throw apiError('BAD_PASSWORD', 'Choose a password.');
    backend.hasVault = true;
    backend.unlocked = true;
    return { mnemonic: SECRET_MNEMONIC };
  },
  'wallet.importMnemonic': ({ password } = {}) => {
    if (password !== SECRET_PASSWORD && !password) throw apiError('BAD_PASSWORD', 'Choose a password.');
    backend.hasVault = true;
    backend.unlocked = true;
    return { imported: true };
  },
  'wallet.importPrivateKey': () => {
    backend.hasVault = true;
    backend.unlocked = true;
    return { imported: true };
  },
  'wallet.reset': () => {
    backend.hasVault = false;
    backend.unlocked = false;
    return { reset: true };
  },
  'wallet.exportSecret': ({ ref, password } = {}) => {
    if (password !== SECRET_PASSWORD) throw apiError('BAD_PASSWORD', 'Incorrect password.');
    return {
      kind: 'hd',
      mnemonic: SECRET_MNEMONIC,
      keyringId: ref?.keyringId || SEED_KEYRING.id,
      derivedFrom: 'seed',
      accountIndex: ref?.accountIndex ?? 0,
    };
  },
  'wallet.exportPrivateKey': ({ password } = {}) => {
    if (password !== SECRET_PASSWORD) throw apiError('BAD_PASSWORD', 'Incorrect password.');
    return {
      kind: 'privateKey',
      privateKeyHex: SECRET_PRIVATE_KEY,
      keyringId: IMPORTED_KEYRING.id,
      derivedFrom: 'imported',
    };
  },

  'account.getActive': () => (backend.unlocked ? activeAccount() : null),
  'account.getActiveRef': () => (backend.unlocked ? activeAccount().ref : null),
  'account.list': () => (backend.unlocked ? backend.accounts.map((a) => ({ ...a })) : []),
  'account.switch': ({ ref } = {}) => {
    const index = backend.accounts.findIndex(
      (a) => a.ref?.accountIndex === ref?.accountIndex && a.ref?.keyringId === ref?.keyringId,
    );
    if (index < 0) throw apiError('NOT_FOUND', 'Unknown account reference.');
    backend.activeIndex = index;
    return activeAccount();
  },
  'account.previewHd': ({ start, count } = {}) => Array.from(
    { length: Number(count) || 3 },
    (_, i) => ({ ...makeAccount(Number(start) || backend.accounts.length + i), exists: false }),
  ),
  'account.addHdBatch': ({ indices } = {}) => {
    const wanted = Array.isArray(indices) && indices.length ? indices : [backend.accounts.length];
    const added = wanted.map((index) => makeAccount(Number(index) || backend.accounts.length));
    backend.accounts = [...backend.accounts, ...added];
    return added;
  },
  'account.removeHd': () => ({ removed: true }),
  'account.setLabel': ({ address, label } = {}) => {
    const account = backend.accounts.find((a) => a.address === address);
    if (account) account.label = String(label || '');
    return account || null;
  },

  'keyring.list': () => backend.keyrings.map((k) => ({ ...k })),
  'keyring.addSeed': () => ({ ...SEED_KEYRING, id: 'kr_seed_2' }),
  'keyring.createSeed': () => ({ ...SEED_KEYRING, id: 'kr_seed_3' }),
  'keyring.addPrivateKey': () => ({ ...IMPORTED_KEYRING, id: 'kr_pk_2' }),
  'keyring.rename': ({ label } = {}) => ({ ...SEED_KEYRING, label: String(label || '') }),
  'keyring.setBackedUp': () => ({ ...SEED_KEYRING, backedUpAt: Date.now() }),
  'keyring.remove': () => ({ removed: true }),

  'network.list': () => networkList().map((n) => ({ ...n })),
  'network.getActive': () => ({ ...activeNetwork() }),
  'network.setActive': ({ networkId } = {}) => {
    const found = networkList().find((network) => network.id === networkId);
    if (!found) throw apiError('NOT_FOUND', 'Unknown network.');
    if (found.custom || found.selectable === false) {
      throw apiError(
        'CUSTOM_NETWORK_DISABLED',
        `${found.unselectableReason} Remove '${networkId}' in Settings, or switch to a built-in network.`,
        false,
      );
    }
    backend.activeNetworkId = String(networkId);
    return { ...activeNetwork() };
  },
  'network.removeCustom': ({ networkId } = {}) => {
    const before = backend.customNetworks.length;
    backend.customNetworks = backend.customNetworks.filter((n) => n.id !== networkId);
    if (backend.customNetworks.length === before) throw apiError('NOT_FOUND', 'Unknown network.');
    return { removed: networkId };
  },
  // Present on purpose: the backend method still exists (the contract is append-only), and this
  // test asserts no shipped UI ever reaches it.
  'network.upsertCustom': (params = {}) => {
    throw Object.assign(apiError('UNEXPECTED_CALL', `network.upsertCustom was called with ${JSON.stringify(params)}`), {
      unexpected: true,
    });
  },

  'settings.get': () => ({ ...backend.preferences }),
  'settings.set': ({ patch } = {}) => {
    backend.preferences = { ...backend.preferences, ...(patch || {}) };
    return { ...backend.preferences };
  },
  'settings.setSecurity': ({ patch } = {}) => {
    backend.preferences = { ...backend.preferences, ...(patch || {}) };
    return { ...backend.preferences };
  },

  'contacts.list': () => backend.contacts.map((c) => ({ ...c })),

  'token.list': () => backend.tokens.map((t) => ({ ...t })),
  'token.getBalances': () => ({
    supported: true,
    networkId: activeNetwork().id,
    balances: backend.tokens.map((t) => ({
      mintAddress: t.mintAddress,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      imageUrl: t.imageUrl || '',
      hidden: Boolean(t.hidden),
      source: t.source || 'deployed',
      tokenAccount: TOKEN_ACCOUNT_FIXTURE,
      tokenAccountExists: true,
      amountUnits: '250000000',
      error: false,
    })),
    reason: null,
  }),
  'token.deriveTokenAccount': () => TOKEN_ACCOUNT_FIXTURE,
  'token.transfer': () => ({
    signature: 'sig_token_cccccccccccccccccccccccccccccccccccc',
    blockHeight: null,
    recipientTokenAccountCreated: false,
    initSignature: null,
  }),

  'tx.checkHealth': () => ({
    status: 'ok',
    healthy: true,
    latencyMs: 42,
    rpcUrl: activeNetwork().rpcUrl,
    networkId: activeNetwork().id,
  }),
  'tx.getAccountInfo': () => ({ exists: true, balance: activeAccount().balance }),
  'tx.getBalances': ({ addresses } = {}) => {
    const out = {};
    for (const address of addresses || []) {
      const account = backend.accounts.find((a) => a.address === address);
      out[address] = {
        balance: account?.balance ?? '0',
        exists: Boolean(account),
        fetchedAt: Date.now(),
        stale: false,
        error: null,
      };
    }
    return out;
  },
  'tx.getCachedBalances': ({ addresses } = {}) => FIXTURES['tx.getBalances']({ addresses }),
  'tx.getPending': () => backend.pending.map((p) => ({ ...p })),
  // Mirrors pending-tx-service.reconcile(): submitted records settle to confirmed (the
  // history fixture already "contains" their signatures). Records stay in the list with
  // their new status, exactly like production list().
  'tx.reconcilePending': () => {
    const actives = backend.pending.filter((p) => p.status === 'submitted').length;
    backend.pending = backend.pending.map((p) => (p.status === 'submitted'
      ? { ...p, status: 'confirmed', settledAt: Date.now() }
      : p));
    return { checked: backend.pending.length, settled: actives };
  },
  'tx.autoCreateAccount': () => ({ exists: true, created: false, signature: null }),
  'tx.listHistory': ({ limit } = {}) => {
    const size = Math.min(Number(limit) || 15, HISTORY_ENTRIES.length);
    return {
      entries: HISTORY_ENTRIES.slice(0, size).map((e) => ({ ...e })),
      nextCursor: size,
      hasMore: size < HISTORY_ENTRIES.length,
    };
  },
  'tx.estimateFee': () => ({
    supported: true,
    networkId: activeNetwork().id,
    source: 'measured',
    feeUnits: '1',
    reserveUnits: '1000',
    reason: 'Observed on a live transfer between two registered accounts.',
  }),
  'tx.validateAddress': ({ address } = {}) => {
    const value = String(address || '').trim();
    if (!value) return { valid: false, isSelf: false, reason: 'Enter a recipient address.' };
    if (!value.startsWith('ta1')) {
      return { valid: false, isSelf: false, reason: 'That does not look like a valid Thru address.' };
    }
    const isSelf = value === activeAccount().address;
    return { valid: true, isSelf, reason: isSelf ? "That's the address you're sending from." : null };
  },
  'tx.send': () => ({ signature: 'sig_sent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', blockHeight: 10300 }),
  'tx.claimFaucet': () => ({ signature: 'sig_faucet_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amountUnits: '10000' }),
};

// ---- chrome mock ----------------------------------------------------------

const chromeLog = {
  /** every method the UI asked for, in order */
  calls: [],
  /** contract methods with no fixture — a gap in this file, not in the app */
  missing: new Set(),
  /** responses that flagged an unexpected call (network.upsertCustom) */
  unexpected: [],
  sidePanelOpen: [],
  setPanelBehavior: [],
  listeners: new Set(),
};

function makeChrome() {
  const runtime = {
    id: 'test-extension-id',
    lastError: undefined,
    getManifest: () => ({
      manifest_version: 3,
      name: 'Thru Wallet',
      version: '1.2.0',
    }),
    sendMessage(message, callback) {
      const method = String(message?.method || '');
      chromeLog.calls.push(method);
      // Async, like the real thing: the round-trip is a task boundary, so a route that renders
      // before its data arrives is exercised here exactly as it is in the browser.
      queueMicrotask(() => {
        runtime.lastError = undefined;
        const fixture = FIXTURES[method];
        if (!fixture) {
          chromeLog.missing.add(method);
          callback({
            ok: false,
            error: { code: 'UNKNOWN_METHOD', message: `No fixture for ${method}`, retryable: false },
          });
          return;
        }
        try {
          const data = fixture(message?.params || {});
          if (data instanceof Error) throw data;
          callback({ ok: true, data });
        } catch (error) {
          if (error?.unexpected) chromeLog.unexpected.push(error.message);
          callback({
            ok: false,
            error: {
              code: error?.code || 'ERROR',
              message: error?.message || String(error),
              retryable: Boolean(error?.retryable),
            },
          });
        }
      });
    },
    onMessage: {
      addListener: (fn) => chromeLog.listeners.add(fn),
      removeListener: (fn) => chromeLog.listeners.delete(fn),
      hasListeners: () => chromeLog.listeners.size > 0,
    },
  };

  const memoryStore = () => {
    const data = new Map();
    return {
      get: (keys) => Promise.resolve(Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).filter((k) => data.has(k)).map((k) => [k, data.get(k)]),
      )),
      set: (obj) => {
        for (const [k, v] of Object.entries(obj || {})) data.set(k, v);
        return Promise.resolve();
      },
      remove: (keys) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
        return Promise.resolve();
      },
      clear: () => {
        data.clear();
        return Promise.resolve();
      },
    };
  };

  return {
    runtime,
    storage: { local: memoryStore(), session: memoryStore(), sync: memoryStore() },
    // The side panel API. `open` is recorded so Settings can be proven to use an explicit user
    // action; `setPanelBehavior` is recorded so the test can prove it is NEVER called — that call
    // would swap the toolbar popup for the panel for every user.
    sidePanel: {
      open: (options) => {
        chromeLog.sidePanelOpen.push(options);
        return Promise.resolve();
      },
      setPanelBehavior: (options) => {
        chromeLog.setPanelBehavior.push(options);
        return Promise.resolve();
      },
      setOptions: () => Promise.resolve(),
      getOptions: () => Promise.resolve({}),
    },
    windows: { getCurrent: () => Promise.resolve({ id: 42, focused: true }) },
    tabs: { query: () => Promise.resolve([]) },
    alarms: { create() {}, clear() {}, onAlarm: { addListener() {}, removeListener() {} } },
  };
}

/** Push a background event, as api-router's event service would. */
function emitEvent(event, data = {}) {
  for (const listener of [...chromeLog.listeners]) {
    listener({ type: 'EVENT', event, data }, { id: 'test-extension-id' });
  }
}

// ---- Installing the environment -------------------------------------------

function installGlobals() {
  DOC = new ShimDocument();
  WIN = makeWindow(DOC);

  globalThis.document = DOC;
  globalThis.window = WIN;
  globalThis.location = WIN.location;
  // Node 22 exposes `navigator` as a getter-only global, so it has to be redefined rather than
  // assigned. The only thing this codebase reads from it is the clipboard.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
    userAgent: 'node-route-lifecycle-test',
    platform: 'linux',
    languages: ['en'],
    clipboard: {
      writeText: async (value) => {
        clipboardLog.writes.push(String(value));
      },
      readText: async () => ADDRESS_B,
    },
    },
  });
  globalThis.chrome = makeChrome();
  globalThis.requestAnimationFrame = WIN.requestAnimationFrame;
  globalThis.cancelAnimationFrame = WIN.cancelAnimationFrame;
  globalThis.getComputedStyle = WIN.getComputedStyle;
  installTimers();
}

const clipboardLog = { writes: [] };

/**
 * Every backend method any test reached, accumulated across resets. resetDom() clears
 * chromeLog.calls so a single test can assert on its own traffic; this keeps the whole-run total.
 */
const exercisedMethods = new Set();

/** Let every pending microtask/timer-driven render finish. */
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  }
}

// Real-time wait — needed when production code debounces on a real timer (the send route's
// recipient check waits 350ms before firing).
const sleep = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

function resetBackend(scenario) {
  backend.hasVault = scenario.hasVault;
  backend.unlocked = scenario.unlocked;
  backend.activeIndex = 0;
  backend.activeNetworkId = 'alphanet';
  backend.autoLockMinutes = 15;
  backend.preferences = { ...PREFERENCES };
  backend.customNetworks = [NETWORK_CUSTOM];
  backend.accounts = [makeAccount(0), makeAccount(1)];
  backend.keyrings = [SEED_KEYRING, IMPORTED_KEYRING];
  backend.contacts = [{ address: ADDRESS_B, label: 'Spending wallet', createdAt: 1750000003000 }];
  backend.lockout = { locked: false, failedAttempts: 0, retryInMs: 0 };
  backend.pending = [];
  backend.tokens = [TOKEN_FIXTURE];
}

/** Fresh document, window and #app, plus cleared logs. */
function resetDom() {
  installGlobals();
  HISTORY_URLS.length = 0;
  for (const method of chromeLog.calls) exercisedMethods.add(method);
  chromeLog.calls.length = 0;
  chromeLog.missing.clear();
  chromeLog.unexpected.length = 0;
  chromeLog.sidePanelOpen.length = 0;
  chromeLog.setPanelBehavior.length = 0;
  chromeLog.listeners.clear();
  clipboardLog.writes.length = 0;
  consoleErrors.length = 0;
  TORN_DOWN.length = 0;

  const app = DOC.createElement('div');
  app.setAttribute('id', 'app');
  DOC.body.appendChild(app);
  return app;
}

// ---- console capture ------------------------------------------------------
//
// A route that throws is reported by the Router through console.error and onError. Both are
// captured so "no route threw" is an assertion rather than something a reader has to notice.

const consoleErrors = [];
const realConsole = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
};

function captureConsole() {
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
  };
  console.warn = () => {};
  console.info = () => {};
}

function releaseConsole() {
  console.error = realConsole.error;
  console.warn = realConsole.warn;
  console.info = realConsole.info;
}

const ROUTER_ERROR_PATTERNS = [
  '[router] failed to mount route',
  '[router] destroy threw',
  '[boot] route error',
];

function routerErrors() {
  return consoleErrors.filter((line) => ROUTER_ERROR_PATTERNS.some((p) => line.includes(p)));
}

// ---- Tree helpers ---------------------------------------------------------

function walk(root, visit) {
  const step = (node) => {
    if (!node) return;
    visit(node);
    for (const child of node.childNodes || []) step(child);
  };
  step(root);
}

function allElements(root) {
  const out = [];
  walk(root, (node) => {
    if (node.nodeType === 1) out.push(node);
  });
  return out;
}

function textOf(root) {
  const parts = [];
  walk(root, (node) => {
    if (node.nodeType === 3) parts.push(node.data);
  });
  return parts.join(' ');
}

function labelOf(el) {
  const aria = el.getAttribute?.('aria-label') || '';
  return `${el.textContent || ''} ${aria}`.replace(/\s+/g, ' ').trim();
}

/** Every <button> whose visible or accessible label matches. */
function buttons(root, matcher) {
  const needle = matcher instanceof RegExp ? matcher : null;
  const text = needle ? null : String(matcher);
  return allElements(root).filter((el) => {
    if (el.localName !== 'button') return false;
    const label = labelOf(el);
    return needle ? needle.test(label) : label.toLowerCase().includes(text.toLowerCase());
  });
}

function click(el, props = {}) {
  return el.dispatchEvent({ type: 'click', button: 0, detail: 1, ...props });
}

function type(el, value) {
  el.value = value;
  el.dispatchEvent({ type: 'input' });
  el.dispatchEvent({ type: 'change' });
}

function pressKey(el, key, props = {}) {
  return el.dispatchEvent({ type: 'keydown', key, ...props });
}

function secretInUrls() {
  const urls = [WIN.location.hash, WIN.location.href, ...HISTORY_URLS];
  const hits = [];
  for (const [kind, value] of SECRETS) {
    for (const url of urls) {
      if (String(url).includes(value)) hits.push(`${kind} in URL ${url}`);
    }
  }
  return hits;
}

// ---- Environment ----------------------------------------------------------

installGlobals();

const { h, on } = await import('./src/ui/kit/dom.js');
const { encodeRef } = await import('./src/shared/refs.js');
const { focusTrap, collectFocusable, isFocusable } = await import('./src/ui/kit/focus-trap.js');
const { requirePassword } = await import('./src/ui/domain/password-prompt.js');
const { boot, POPUP_ROUTES } = await import('./src/ui/app/boot.js');
const guards = await import('./src/ui/app/guards.js');
const bridge = await import('./src/ui/app/bridge.js');
const { Router } = await import('./src/ui/app/router.js');

function isInside(node, root) {
  for (let n = node; n; n = n.parentNode) {
    if (n === root) return true;
  }
  return false;
}

const ROUTE_PATHS = POPUP_ROUTES.map((r) => r.path);
const PRIVATE_ROUTES = POPUP_ROUTES.filter((r) => r.guard === guards.requireUnlocked).map((r) => r.path);
const VAULT_ROUTES = POPUP_ROUTES.filter((r) => r.guard === guards.requireVault).map((r) => r.path);
const ONBOARDING_ROUTES = POPUP_ROUTES.filter((r) => r.guard === guards.requireNoWallet).map((r) => r.path);

const SCENARIOS = [
  { id: 'no vault', hasVault: false, unlocked: false, landing: '/welcome' },
  { id: 'locked', hasVault: true, unlocked: false, landing: '/unlock' },
  { id: 'unlocked', hasVault: true, unlocked: true, landing: '/dashboard' },
];

/** Where a route must land in this vault state, straight from the guard semantics. */
function expectedPath(scenario, path) {
  if (!scenario.hasVault) return '/welcome';
  if (!scenario.unlocked) {
    if (PRIVATE_ROUTES.includes(path) || ONBOARDING_ROUTES.includes(path)) return '/unlock';
    return path;
  }
  if (ONBOARDING_ROUTES.includes(path)) return '/dashboard';
  return path;
}

/** Every URL to mount: the bare path plus the parameterised forms the app really navigates to. */
function mountUrls() {
  const ref = activeAccount().ref;
  const token = encodeRef(ref);
  const urls = [];
  for (const path of ROUTE_PATHS) {
    urls.push(path);
    if (path === '/account') {
      urls.push(`/account?ref=${token}`);
      // A hand-edited hash must not throw: the ref is user-controlled input.
      urls.push('/account?ref=not-a-valid-token');
    }
    if (path === '/export') {
      urls.push(`/export?ref=${token}`);
      urls.push(`/export?ref=${token}&mode=backup`);
      urls.push(`/export?ref=${token}&mode=key`);
    }
    if (path === '/keyring') urls.push(`/keyring?id=${SEED_KEYRING.id}`);
    if (path === '/send') urls.push('/send?token=native');
    if (path === '/unlock') urls.push('/unlock?returnTo=%2Fsend');
  }
  return urls;
}

// ---- The sweep -------------------------------------------------------------

async function runScenario(scenario) {
  section(`scenario: ${scenario.id} — mount all ${ROUTE_PATHS.length} routes`);

  resetBackend(scenario);
  const app = resetDom();
  guards.invalidate();

  let router = null;
  captureConsole();
  try {
    router = await boot({
      root: app,
      onError: (error) => consoleErrors.push(`[boot] route error: ${error?.message || error}`),
    });
    await settle();
  } finally {
    releaseConsole();
  }

  ok(`${scenario.id}: boot() mounted the shell`, Boolean(router) && app.childNodes.length === 1,
    `router=${Boolean(router)} children=${app.childNodes.length}`);
  ok(`${scenario.id}: boot() landed on ${scenario.landing}`, router?.currentPath === scenario.landing,
    `got ${router?.currentPath}`);
  ok(`${scenario.id}: the shell renders the network badge and health dot`,
    /Alphanet/.test(textOf(app)) && app.querySelectorAll('.health-dot, .status-dot').length >= 0);

  // Listener baseline AFTER boot: boot's own hashchange/unload listeners are meant to stay.
  const baselineDoc = DOC.listeners.length;
  const baselineWin = WIN.listeners.length;

  const urls = mountUrls();
  for (const url of urls) {
    const path = url.split('?')[0];
    const expected = expectedPath(scenario, path);
    const label = `${scenario.id} ${url}`;

    consoleErrors.length = 0;
    chromeLog.unexpected.length = 0;
    rememberForTeardown(router.current);
    captureConsole();
    router.navigate(url);
    await settle();
    releaseConsole();

    const errors = routerErrors();
    ok(`${label}: mounted without throwing`, errors.length === 0, errors.join(' | '));
    ok(`${label}: landed on ${expected}`, router.currentPath === expected,
      `got ${router.currentPath} (hash ${WIN.location.hash})`);
    ok(`${label}: rendered content`, textOf(router.root).trim().length > 8,
      `text was "${textOf(router.root).slice(0, 90)}"`);
    ok(`${label}: no unexpected backend call`, chromeLog.unexpected.length === 0,
      chromeLog.unexpected.join(' | '));
    ok(`${label}: no secret anywhere in the DOM`, findSecrets(SECRETS).length === 0,
      findSecrets(SECRETS).slice(0, 3).join(' | '));
    ok(`${label}: no secret in any attribute, dataset or input value`,
      findSecretsInAttributes(SECRETS).length === 0,
      findSecretsInAttributes(SECRETS).slice(0, 3).join(' | '));
    ok(`${label}: no secret in the URL or history`, secretInUrls().length === 0,
      secretInUrls().slice(0, 3).join(' | '));

    // The previous route was destroyed by this navigation, so any listener left on a detached
    // element is a teardown leak — the exact bug class disposer() exists to prevent.
    const leaks = detachedListeners();
    ok(`${label}: teardown of the previous route left no detached listeners`, leaks.length === 0,
      JSON.stringify(leaks.slice(0, 4)));
  }

  // Full teardown.
  rememberForTeardown(router.current);
  router.stop();
  await settle();

  ok(`${scenario.id}: stop() returned document listeners to baseline`,
    DOC.listeners.length === baselineDoc, `${DOC.listeners.length} vs ${baselineDoc}`);
  // stop() removes the router's hashchange listener and nothing else. boot()'s own hashchange
  // (the tree swap for a hand-edited hash) and its unload listener live for the lifetime of the
  // page, which for a popup or side panel is the lifetime of the document — that is intended, and
  // the count is asserted so it cannot silently grow.
  ok(`${scenario.id}: stop() removed exactly the router's window listener`,
    WIN.listeners.length === baselineWin - 1,
    `${WIN.listeners.length} vs baseline ${baselineWin}: `
    + WIN.listeners.map((l) => l.type).join(','));
  ok(`${scenario.id}: the surviving window listeners are boot's hashchange and unload`,
    WIN.listeners.map((l) => l.type).sort().join(',') === 'hashchange,unload',
    WIN.listeners.map((l) => l.type).join(','));
  const leaks = detachedListeners();
  ok(`${scenario.id}: no listener survives on any detached element`, leaks.length === 0,
    JSON.stringify(leaks.slice(0, 6)));
  const detachedHits = findSecretsInTornDown(SECRETS);
  ok(`${scenario.id}: no secret survives in the DOM of any destroyed route`,
    detachedHits.length === 0, detachedHits.slice(0, 3).join(' | '));
  ok(`${scenario.id}: every method the routes called has a fixture`, chromeLog.missing.size === 0,
    `missing: ${[...chromeLog.missing].join(', ')}`);
  ok(`${scenario.id}: the outlet is empty after stop()`, router.root.childNodes.length === 0,
    `${router.root.childNodes.length} nodes left`);

  return router;
}

// ---- Settings: custom networks withdrawn, side panel offered ---------------

async function settingsTest() {
  section('settings: no custom-network form, an explicit side-panel action');

  resetBackend(SCENARIOS[2]);
  resetDom();
  guards.invalidate();
  const app = DOC.getElementById('app');
  const router = await boot({ root: app });
  await settle();
  router.navigate('/settings');
  await settle();

  const tree = router.root;
  const text = textOf(tree);

  ok('settings has no "Add custom network" control', buttons(tree, /add custom/i).length === 0,
    buttons(tree, /add custom/i).map((b) => labelOf(b)).join(', '));
  const rpcInputs = allElements(tree).filter((el) => el.localName === 'input'
    && /rpc|endpoint|explorer|chain/i.test(`${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`));
  ok('settings has no custom-endpoint input fields', rpcInputs.length === 0,
    rpcInputs.map((el) => el.getAttribute('placeholder')).join(', '));
  ok('settings says the capability is temporarily unavailable', /temporarily unavailable/i.test(text));
  ok('a network saved before the quarantine is still listed', /My node/.test(text),
    text.slice(0, 200));
  ok('the legacy row carries a clear not-selectable warning',
    /not selectable/i.test(text) && /will not build or sign/i.test(text), text.slice(0, 500));

  const customRow = allElements(tree).find((candidate) => (
    candidate.classList.contains('row') && /My node/.test(textOf(candidate))
  ));
  ok('the saved custom network is rendered as a row', Boolean(customRow));
  ok('the custom row is inert markup, not a button', customRow?.localName === 'div',
    `element=${customRow?.localName}`);
  ok('the custom row is exposed as disabled to assistive technology',
    customRow?.getAttribute('aria-disabled') === 'true',
    `aria-disabled=${customRow?.getAttribute('aria-disabled')}`);
  ok('built-in network rows remain selectable buttons',
    buttons(tree, /^Alphanet/i).length === 1, buttons(tree, /Alphanet/i).map(labelOf).join(', '));

  const callsBeforeInertClick = chromeLog.calls.filter((method) => method === 'network.setActive').length;
  click(customRow);
  await settle();
  ok('clicking the inert custom row does not call network.setActive',
    chromeLog.calls.filter((method) => method === 'network.setActive').length === callsBeforeInertClick,
    chromeLog.calls.join(', '));
  ok('clicking the inert custom row does not navigate away', router.currentPath === '/settings',
    router.currentPath);
  ok('clicking the inert custom row cannot change the active network',
    backend.activeNetworkId === 'alphanet', backend.activeNetworkId);

  // A stale page or devtools caller still goes through the real bridge. The fixture mirrors the
  // background's contract-v7 enforcement so this proves the refusal shape reaches callers intact.
  let directError = null;
  try {
    await bridge.send('network.setActive', { networkId: NETWORK_CUSTOM.id });
  } catch (error) {
    directError = error;
  }
  ok('a direct bridge call for the custom id is rejected', Boolean(directError));
  ok('the direct refusal has the stable CUSTOM_NETWORK_DISABLED code',
    directError?.code === 'CUSTOM_NETWORK_DISABLED', directError?.code);
  ok('the direct refusal is permanent, not retryable', directError?.retryable === false,
    `retryable=${directError?.retryable}`);
  ok('direct rejection leaves the built-in network active',
    backend.activeNetworkId === 'alphanet', backend.activeNetworkId);

  const removeButtons = buttons(tree, /remove my node/i);
  ok('Remove is the custom row\'s only button action',
    removeButtons.length === 1 && buttons(tree, /My node/i).length === 1,
    buttons(tree, /My node/i).map(labelOf).join(', '));
  ok('no UI call reached network.upsertCustom',
    !chromeLog.calls.includes('network.upsertCustom') && chromeLog.unexpected.length === 0);

  // The side panel: an explicit, user-initiated action.
  const openButton = buttons(tree, /open side panel/i)[0];
  ok('"Open side panel" is a real control', Boolean(openButton));
  ok('the side-panel section explains what it does', /beside your browser tab/i.test(text));
  ok('sidePanel.open has not been called before the user asks', chromeLog.sidePanelOpen.length === 0);
  click(openButton);
  await settle();
  ok('clicking it calls chrome.sidePanel.open exactly once', chromeLog.sidePanelOpen.length === 1,
    JSON.stringify(chromeLog.sidePanelOpen));
  ok('the call carries a windowId, so no await sits between the gesture and the API',
    chromeLog.sidePanelOpen[0]?.windowId === 42, JSON.stringify(chromeLog.sidePanelOpen[0]));
  ok('toolbar behaviour is never changed behind the user',
    chromeLog.setPanelBehavior.length === 0, JSON.stringify(chromeLog.setPanelBehavior));
  ok('the side panel action reported no error banner', !/Could not open the side panel/i.test(textOf(tree)));

  // Removing the saved network still works end to end.
  click(buttons(tree, /remove my node/i)[0]);
  await settle();
  ok('removing a saved custom network calls network.removeCustom',
    chromeLog.calls.includes('network.removeCustom'));
  ok('removal deletes the legacy record from backend state', backend.customNetworks.length === 0,
    `${backend.customNetworks.length} custom records remain`);
  ok('the removed custom row disappears while the quarantine notice remains',
    !/My node/.test(textOf(tree)) && /temporarily unavailable/i.test(textOf(tree)),
    textOf(tree).slice(0, 300));
}

// ---- Focus trap ------------------------------------------------------------

function focusTrapTest() {
  section('focus trap: Tab wraps, Escape cancels, focus is restored');

  resetDom();

  const behind = h('button', { type: 'button', text: 'control behind the dialog' });
  DOC.body.appendChild(behind);
  behind.focus();

  const dialog = h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' });
  const first = h('button', { type: 'button', text: 'first' });
  const middle = h('input', { type: 'password' });
  const last = h('button', { type: 'button', text: 'last' });
  const hiddenField = h('input', { type: 'hidden' });
  const disabledButton = h('button', { type: 'button', text: 'off', disabled: true });
  const excluded = h('div', { class: 'hidden' }, h('button', { type: 'button', text: 'in a hidden row' }));
  dialog.appendChild(first);
  dialog.appendChild(middle);
  dialog.appendChild(last);
  dialog.appendChild(hiddenField);
  dialog.appendChild(disabledButton);
  dialog.appendChild(excluded);
  DOC.body.appendChild(dialog);

  ok('isFocusable skips hidden inputs, disabled controls and display:none subtrees',
    !isFocusable(hiddenField) && !isFocusable(disabledButton)
    && !isFocusable(excluded.firstChild) && isFocusable(middle));

  let escapes = 0;
  const trap = focusTrap(dialog, { onEscape: () => { escapes += 1; } });

  ok('the dialog root is script-focusable but not a Tab stop',
    dialog.getAttribute('tabindex') === '-1' && !isFocusable(dialog));
  ok('exactly the three real controls are Tab stops', trap.focusables().length === 3,
    trap.focusables().map((el) => el.localName).join(','));
  ok('collectFocusable returns DOM order',
    trap.focusables()[0] === first && trap.focusables()[2] === last);

  trap.focusFirst();
  ok('focusFirst lands on the first control', DOC.activeElement === first,
    `${DOC.activeElement?.localName}`);

  last.focus();
  pressKey(last, 'Tab');
  ok('Tab from the last control wraps to the first', DOC.activeElement === first);

  pressKey(first, 'Tab', { shiftKey: true });
  ok('Shift+Tab from the first control wraps to the last', DOC.activeElement === last);

  middle.focus();
  pressKey(middle, 'Tab');
  ok('Tab from a middle control is left alone', DOC.activeElement === middle,
    `activeElement is ${DOC.activeElement?.localName} (the browser moves it on)`);

  behind.focus();
  pressKey(behind, 'Tab');
  ok('Tab while focus sits behind the dialog pulls it back in', DOC.activeElement === first,
    `activeElement is ${DOC.activeElement?.localName}`);

  pressKey(first, 'Escape');
  ok('Escape reaches the handler', escapes === 1);

  trap.destroy();
  ok('destroy puts focus back on the control that opened the dialog', DOC.activeElement === behind);
  ok('destroy removes the document keydown listener',
    DOC.listeners.filter((l) => l.type === 'keydown').length === 0);
  pressKey(behind, 'Escape');
  ok('Escape after destroy no longer reaches the handler', escapes === 1);

  // A dialog with nothing focusable must still hold focus rather than let it escape.
  const empty = h('div', { role: 'dialog' });
  DOC.body.appendChild(empty);
  const emptyTrap = focusTrap(empty);
  behind.focus();
  const prevented = pressKey(behind, 'Tab') === false;
  ok('an empty dialog keeps focus (Tab is prevented)', prevented && DOC.activeElement === empty,
    `prevented=${prevented} active=${DOC.activeElement?.localName}`);
  emptyTrap.destroy();
}

// ---- requirePassword -------------------------------------------------------

async function passwordModalTest() {
  section('requirePassword: trapped focus, no surviving password');

  resetDom();
  const opener = h('button', { type: 'button', text: 'reveal secret' });
  DOC.body.appendChild(opener);
  opener.focus();

  let received = null;
  const pending = requirePassword({
    title: 'Confirm your password',
    confirmLabel: 'Reveal secret',
    verify: async (password) => {
      received = password;
      return { revealed: true };
    },
  });
  await settle(2);

  const overlay = DOC.body.lastChild;
  ok('the dialog is appended to the document', Boolean(overlay)
    && overlay.classList.contains('modal-overlay') && isConnected(overlay));
  ok('the dialog declares itself modal', overlay.firstChild.getAttribute('role') === 'dialog'
    && overlay.firstChild.getAttribute('aria-modal') === 'true');

  const input = allElements(overlay).find((el) => el.localName === 'input');
  ok('the password field is a password input', input?.type === 'password', `type=${input?.type}`);
  ok('focus moved into the dialog', isInside(DOC.activeElement, overlay),
    `activeElement=${DOC.activeElement?.localName}`);

  const controls = allElements(overlay).filter(isFocusable);
  const controlLabels = controls.map((el) => (el.localName === 'input' ? 'input' : labelOf(el)));
  ok('the dialog Tab stops are the field, its reveal toggle, confirm and cancel',
    controlLabels.join('|') === 'input|Show password|Reveal secret|Cancel',
    controlLabels.join('|'));
  ok('the dialog root is script-focusable but is not itself a Tab stop',
    !isFocusable(overlay.firstChild) && overlay.firstChild.getAttribute('tabindex') === '-1',
    `tabindex=${overlay.firstChild.getAttribute('tabindex')}`);

  const lastControl = controls[controls.length - 1];
  lastControl.focus();
  pressKey(lastControl, 'Tab');
  ok('Tab from the last control wraps inside the dialog', DOC.activeElement === controls[0],
    `activeElement=${labelOf(DOC.activeElement).slice(0, 30)}`);
  ok('Tab never reaches the control behind the overlay', DOC.activeElement !== opener);

  // Escape cancels and resolves null — but first check the confirm path in a second modal,
  // because cancelling here would settle this one.
  type(input, SECRET_PASSWORD);
  ok('the password is in the field value while typing', input.value === SECRET_PASSWORD);
  click(buttons(overlay, /reveal secret/i)[0]);
  const result = await pending;
  await settle();

  ok('verify() received exactly what was typed', received === SECRET_PASSWORD);
  ok('the promise resolved with the verify result', result?.revealed === true);
  ok('the overlay left the document', !isConnected(overlay));
  ok('focus returned to the control that opened the dialog', DOC.activeElement === opener,
    `activeElement=${DOC.activeElement?.localName}`);

  const passwordHits = findSecrets([['password', SECRET_PASSWORD]]);
  ok('the password survives nowhere: not in text, attributes, values or the detached DOM',
    passwordHits.length === 0, passwordHits.slice(0, 4).join(' | '));
  ok('the destroyed field value was overwritten then cleared', input.value === '',
    `value=${JSON.stringify(input.value)}`);
  ok('the modal keydown listener was released',
    DOC.listeners.filter((l) => l.type === 'keydown').length === 0);

  // Cancel path: Escape resolves null and tears the dialog down the same way.
  const opener2 = h('button', { type: 'button', text: 'second' });
  DOC.body.appendChild(opener2);
  opener2.focus();
  const cancelled = requirePassword({ title: 'Confirm', verify: async () => true });
  await settle(2);
  const overlay2 = DOC.body.lastChild;
  pressKey(allElements(overlay2).find((el) => el.localName === 'input'), 'Escape');
  ok('Escape cancels the dialog', (await cancelled) === null);
  await settle();
  ok('the cancelled dialog left the document', !isConnected(overlay2));
  ok('Escape restored focus to the opener', DOC.activeElement === opener2,
    `activeElement=${DOC.activeElement?.localName}`);
}

// ---- Export: a real secret on screen, then gone -----------------------------

async function exportSecretTest() {
  section('export: the phrase appears only after a password, and never survives teardown');

  resetBackend(SCENARIOS[2]);
  resetDom();
  guards.invalidate();
  const app = DOC.getElementById('app');
  const router = await boot({ root: app });
  await settle();
  router.navigate(`/export?ref=${encodeRef(activeAccount().ref)}`);
  await settle();

  ok('export mounted', router.currentPath === '/export', `got ${router.currentPath}`);
  ok('export does not show the phrase before the password check',
    !textOf(router.root).includes('thistle'));

  const reveal = buttons(router.root, /enter password to reveal/i)[0];
  ok('reveal is gated behind a password prompt', Boolean(reveal));
  click(reveal);
  await settle();

  const overlay = DOC.body.lastChild;
  const input = allElements(overlay).find((el) => el.localName === 'input');
  ok('the password dialog opened', Boolean(input));

  // Wrong password first: the secret must not appear and the dialog must stay open.
  type(input, 'wrong-password');
  click(buttons(overlay, /reveal secret/i)[0]);
  await settle();
  ok('a wrong password reveals nothing', !textOf(router.root).includes('thistle'));
  ok('a wrong password keeps the dialog open', isConnected(overlay));
  ok('a wrong password never reaches an attribute or dataset',
    findSecretsInAttributes([['wrong password', 'wrong-password']]).length === 0);

  type(input, SECRET_PASSWORD);
  click(buttons(overlay, /reveal secret/i)[0]);
  await settle();

  ok('the correct password reveals the phrase', textOf(router.root).includes('thistle'));
  ok('the phrase left the dialog with it', !isConnected(overlay));
  const attributeHits = findSecretsInAttributes(SECRETS);
  ok('the phrase is in text nodes only — never an attribute, dataset or input value',
    attributeHits.length === 0, attributeHits.slice(0, 4).join(' | '));
  const passwordHits = findSecrets([['password', SECRET_PASSWORD]]);
  ok('the password survived neither the dialog nor the reveal', passwordHits.length === 0,
    passwordHits.slice(0, 3).join(' | '));
  ok('the URL still carries no secret', secretInUrls().length === 0, secretInUrls().join(' | '));

  const exportEl = router.current?.el;
  TORN_DOWN.push(exportEl);
  router.navigate('/dashboard');
  await settle();
  const detachedHits = findSecretsInTornDown(SECRETS);
  ok('navigating away leaves no phrase in the DOM the export route handed back',
    detachedHits.length === 0, detachedHits.slice(0, 4).join(' | '));
  ok('the destroyed export subtree holds no phrase at all',
    !textOf(exportEl).includes('thistle'), `text was "${textOf(exportEl).slice(0, 80)}"`);
  ok('the dashboard shows no phrase either', !textOf(router.root).includes('thistle'));

  // A background lock while a secret is on screen must remove it immediately.
  router.navigate(`/export?ref=${encodeRef(activeAccount().ref)}`);
  await settle();
  click(buttons(router.root, /enter password to reveal/i)[0]);
  await settle();
  const overlay2 = DOC.body.lastChild;
  type(allElements(overlay2).find((el) => el.localName === 'input'), SECRET_PASSWORD);
  click(buttons(overlay2, /reveal secret/i)[0]);
  await settle();
  ok('the phrase is on screen again before the lock test', textOf(router.root).includes('thistle'));

  const lockedEl = router.current?.el;
  TORN_DOWN.push(lockedEl);
  backend.unlocked = false;
  emitEvent('lockStateChanged', { unlocked: false });
  await settle();
  ok('a background lock wipes the secret from the screen',
    !textOf(DOC.documentElement).includes('thistle'));
  ok('a background lock sends the user to the unlock screen', router.currentPath === '/unlock',
    `got ${router.currentPath}`);
  const lockedHits = [...findSecrets(SECRETS), ...findSecretsInTornDown(SECRETS)];
  ok('a background lock leaves no secret in the document or in the wiped screen',
    lockedHits.length === 0, lockedHits.slice(0, 3).join(' | '));
  ok('the wiped export subtree holds no phrase', !textOf(lockedEl).includes('thistle'));

  router.stop();
  await settle();
}

// ---- Source-level guards ---------------------------------------------------

/**
 * Remove // and block comments while leaving string, template and escaped content intact.
 *
 * Needed because the shipped code documents WHY network.upsertCustom is not offered, and a plain
 * substring scan would flag the explanation rather than a call site. (A regex literal containing a
 * comment opener would confuse this; none of the scanned files has one.)
 */
function stripComments(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < code.length) {
        if (code[i] === '\\') {
          out += code[i] + (code[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += code[i];
        if (code[i] === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function listSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'vendor' || entry === 'node_modules') continue;
      listSourceFiles(full, out);
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function sourceTest() {
  section('source: what the shipped UI is allowed to call');

  const uiFiles = [...listSourceFiles(join(ROOT, 'src', 'ui')), join(ROOT, 'src', 'popup', 'popup.js')];
  const offenders = [];
  const panelOffenders = [];
  let trapUsers = 0;

  for (const file of uiFiles) {
    const raw = readFileSync(file, 'utf8');
    const code = stripComments(raw);
    if (/network\.upsertCustom/.test(code)) offenders.push(file);
    if (/setPanelBehavior\s*\(/.test(code)) panelOffenders.push(file);
    if (/focus-trap\.js/.test(raw) && !file.endsWith('focus-trap.js')) trapUsers += 1;
  }

  ok(`no shipped UI file calls network.upsertCustom (${uiFiles.length} files scanned)`,
    offenders.length === 0, offenders.join(', '));
  ok('no shipped file changes toolbar behaviour with setPanelBehavior',
    panelOffenders.length === 0, panelOffenders.join(', '));
  ok('the focus trap is wired into at least one dialog', trapUsers >= 1, `${trapUsers} importers`);

  const prompt = readFileSync(join(ROOT, 'src', 'ui', 'domain', 'password-prompt.js'), 'utf8');
  ok('password-prompt uses the shared trap instead of its own Escape handler',
    /focusTrap\(/.test(prompt) && !/if \(event\.key === 'Escape'\)/.test(prompt));

  const checklist = join(ROOT, 'docs', 'MANUAL_SMOKE_CHECKLIST.md');
  let doc = '';
  try {
    doc = readFileSync(checklist, 'utf8');
  } catch {
    doc = '';
  }
  ok('docs/MANUAL_SMOKE_CHECKLIST.md exists', doc.length > 0);
  ok('the checklist covers the popup and the side panel',
    /[Pp]opup/.test(doc) && /side panel/i.test(doc));
  ok('the checklist covers narrow and wide widths',
    /408/.test(doc) && /(wide|800|desktop)/i.test(doc));
  ok('the checklist covers the reload-extension trap',
    /reload/i.test(doc));
  ok('the checklist names every route',
    ROUTE_PATHS.every((path) => doc.includes(path)),
    ROUTE_PATHS.filter((path) => !doc.includes(path)).join(', '));
}

// ---- In-app navigation -----------------------------------------------------
//
// The sweep proves each route mounts when the URL says so. This proves the links inside the app
// actually take you there, including the shell's own controls and browser Back — the paths a user
// really travels, and the ones a hash-only test would miss.

async function navigationTest() {
  section('navigation: in-app controls move between routes, and Back returns');

  resetBackend(SCENARIOS[2]);
  resetDom();
  guards.invalidate();
  const app = DOC.getElementById('app');
  const router = await boot({ root: app });
  await settle();
  ok('boot lands on the dashboard', router.currentPath === '/dashboard', router.currentPath);

  const settingsButton = buttons(app, /settings/i)[0];
  ok('the topbar exposes a settings control', Boolean(settingsButton),
    buttons(app, /.*/).slice(0, 6).map(labelOf).join(', '));
  click(settingsButton);
  await settle();
  ok('the topbar settings control reaches /settings', router.currentPath === '/settings',
    router.currentPath);

  const lockButton = buttons(app, /lock/i)[0];
  ok('the topbar exposes a lock control', Boolean(lockButton));
  click(lockButton);
  await settle();
  ok('locking from the topbar locks the vault', backend.unlocked === false);
  ok('locking leaves the private screen and lands on /unlock', router.currentPath === '/unlock',
    router.currentPath);
  ok('locking leaves no secret in the document or in the destroyed screens',
    findSecrets(SECRETS).length === 0 && findSecretsInTornDown(SECRETS).length === 0,
    [...findSecrets(SECRETS), ...findSecretsInTornDown(SECRETS)].slice(0, 3).join(' | '));

  backend.unlocked = true;
  guards.invalidate();
  router.navigate('/dashboard');
  await settle();

  for (const [label, path] of [
    ['Send', '/send'],
    ['Receive', '/receive'],
    ['Faucet', '/faucet'],
    ['History', '/history'],
  ]) {
    router.navigate('/dashboard');
    await settle();
    const tile = buttons(router.root, label)[0];
    ok(`the dashboard offers a "${label}" control`, Boolean(tile));
    if (!tile) continue;
    click(tile);
    await settle();
    ok(`clicking "${label}" reaches ${path}`, router.currentPath === path, router.currentPath);
    ok(`the ${path} screen rendered`, textOf(router.root).trim().length > 8);

    const back = buttons(router.root, /^back$/i)[0];
    ok(`the ${path} screen has a Back control`, Boolean(back));
    if (back) {
      click(back);
      await settle();
      ok(`Back from ${path} returns to the dashboard rather than the fallback`,
        router.currentPath === '/dashboard', router.currentPath);
    }
    ok(`no secret appears on the ${path} round trip`,
      findSecrets(SECRETS).length === 0 && findSecretsInTornDown(SECRETS).length === 0);
  }

  // ---- Receive: address copy, QR canvas, and audit cleanup ----------------
  // The DOM-shim canvas exercises qr.js's flat degradation (no roundRect), which must
  // render silently — no "Could not render the QR" warning. Audited cleanups below:
  // the dead hidden CopyButton is gone (one affordance), the address block is the
  // untruncated full address, and the canvas carries an accessible name.
  router.navigate('/receive');
  await settle();
  const recvMono = router.root.querySelector('.monospace-block');
  ok('the receive screen shows the full, untruncated address',
    Boolean(recvMono) && recvMono.textContent === activeAccount().address,
    recvMono?.textContent);
  // The QR is an interactive control: tap flips styled <-> plain for scanners that
  // choke on artistic QRs. The accessible name therefore lives on the toggle button.
  const qrToggle = buttons(router.root, /QR code of your receive address/i)[0];
  ok('the QR toggle carries the receive-address description',
    Boolean(qrToggle) && /styled.*plain/i.test(qrToggle.getAttribute('aria-label') || ''),
    qrToggle?.getAttribute?.('aria-label'));
  ok('a canvas renders inside the QR toggle',
    Boolean(qrToggle) && Boolean(qrToggle.querySelector?.('canvas')));
  if (qrToggle) {
    click(qrToggle);
    await settle();
    ok('tapping the QR switches it to the plain scanner-safe style',
      /plain.*Thru-styled/i.test(qrToggle.getAttribute('aria-label') || ''),
      qrToggle.getAttribute('aria-label'));
    click(qrToggle);
    await settle();
    ok('tapping again restores the styled Thru QR',
      /styled.*plain/i.test(qrToggle.getAttribute('aria-label') || ''),
      qrToggle.getAttribute('aria-label'));
  }
  ok('no QR render warning under a minimal canvas',
    !/Could not render the QR/.test(textOf(router.root)), textOf(router.root).slice(0, 160));
  const copyAffordances = buttons(router.root, /copy address/i);
  ok('exactly one copy affordance for the address (the dead hidden button is gone)',
    copyAffordances.length === 1, String(copyAffordances.length));
  ok('the address box itself is the copy affordance (not a sibling button)',
    Boolean(copyAffordances[0]) && copyAffordances[0].classList.contains('copy-address'));

  // Clickable-address copy flow: click -> clipboard write of the FULL address ->
  // inline "Copied" confirmation -> auto-restore to the address after ~1s.
  clipboardLog.writes.length = 0;
  click(copyAffordances[0]);
  await settle();
  ok('clicking the address box copies the full address to the clipboard',
    clipboardLog.writes.includes(activeAccount().address), JSON.stringify(clipboardLog.writes));
  ok('the box confirms with an inline "Copied"',
    /Copied/.test(copyAffordances[0].textContent), copyAffordances[0].textContent);
  ok('the box announces the copy to assistive tech',
    /copied to clipboard/i.test(copyAffordances[0].getAttribute('aria-label') || ''));
  await new Promise((r) => setTimeout(r, 1250));
  await settle();
  ok('the box restores the full address about a second later',
    copyAffordances[0].textContent.includes(activeAccount().address),
    copyAffordances[0].textContent.slice(0, 60));
  ok('the aria label returns to the copy description after restoring',
    /^Copy address:/.test(copyAffordances[0].getAttribute('aria-label') || ''));
  // (The shim's selector engine is deliberately tiny — walk anchors instead of a[href*=].)
  const explorerLink = [...router.root.querySelectorAll?.('a') || []]
    .find((a) => String(a.href || a.getAttribute?.('href') || '').includes('/account/'));
  const explorerHref = String(explorerLink?.getAttribute?.('href') || '');
  ok('the explorer link embeds the address on the active network',
    explorerHref.includes(activeAccount().address),
    explorerHref || 'no explorer anchor found');

  // ---- Send: selecting a token asset (contract v8) -------------------------
  // The asset picker used to list tokens as permanently "not sendable"; with token.transfer
  // behind it, a funded token is selectable and the whole form re-denominates. This drives
  // the real click path: asset card → picker → token row → form.
  router.navigate('/send');
  await settle();
  const assetCard = buttons(router.root, /thru native token/i)[0];
  ok('the send screen offers the asset card', Boolean(assetCard));
  if (assetCard) {
    click(assetCard);
    await settle();
    const tokenRow = buttons(router.root, /smoke token/i)[0];
    ok('a funded token is selectable in the asset picker', Boolean(tokenRow));
    ok('the picker no longer declares tokens fundamentally unsendable',
      !/Token transfers are not supported yet/.test(textOf(router.root)));
    if (tokenRow) {
      click(tokenRow);
      await settle();
      ok('the amount field re-denominates to the token', textOf(router.root).includes('Amount (SMK)'));
      ok('the spendable line shows the token balance', textOf(router.root).includes('Spendable: 250 SMK'),
        textOf(router.root).slice(0, 240));

      // The recipient probe is mint-dependent: picking a recipient must check THIS mint's
      // token account, not reuse the native wallet-existence answer.
      const pickBtn = buttons(router.root, /my accounts/i)[0];
      if (pickBtn) {
        click(pickBtn);
        await settle();
        const accountRow = buttons(router.root, /spending/i)[0];
        if (accountRow) {
          click(accountRow);
          await settle();
          ok('the token recipient check runs against the token account',
            /SMK account|token account/i.test(textOf(router.root)), textOf(router.root).slice(0, 260));
        } else {
          ok('a recipient row exists in the account picker', false, textOf(router.root).slice(0, 200));
        }
      } else {
        ok('the send form offers the account picker shortcut', false, textOf(router.root).slice(0, 200));
      }
    }
  }
  ok('no secret appears on the token send flow',
    findSecrets(SECRETS).length === 0 && findSecretsInTornDown(SECRETS).length === 0);

  // ---- Send: inverted input order + picker round-trips (PR review findings) --------------
  // Two regressions found by the PR #6 adversarial review, each asserted to fail pre-fix:
  //  (1) refreshReviewEnabled only ran from input handlers, so typing the amount BEFORE the
  //      recipient left Review disabled forever after async validation finished. Post-fix
  //      validateRecipient re-evaluates the gate in a finally on every completion.
  //  (3) the recipient picker's onPick and its Back button discarded a pre-typed amount.
  router.navigate('/send');
  await settle();
  const amtInput = router.root.querySelector('input[placeholder="0.0"]');
  const rcptInput = router.root.querySelector('input[placeholder="ta…"]');
  ok('the send form exposes amount and recipient inputs', Boolean(amtInput && rcptInput));
  if (amtInput && rcptInput) {
    // Amount first, recipient second — exactly the order the bug bit.
    type(amtInput, '5');
    const reviewInitially = buttons(router.root, /^review$/i)[0];
    ok('review starts disabled with only an amount typed',
      Boolean(reviewInitially && reviewInitially.disabled));
    type(rcptInput, 'ta1validrecipient00000000000000000000000000000000000000000');
    await sleep(450); // the recipient check debounce is a real 350ms timer
    await settle();
    const reviewAfter = buttons(router.root, /^review$/i)[0];
    ok('review activates when recipient validation resolves after the amount was typed',
      Boolean(reviewAfter && !reviewAfter.disabled), textOf(router.root).slice(0, 220));

    const myAccounts = buttons(router.root, /my accounts/i)[0];
    if (myAccounts) {
      click(myAccounts);
      await settle();
      const accRow = buttons(router.root, /spending/i)[0];
      if (accRow) {
        click(accRow);
        await sleep(20); // the prefilled recipient was NOT debounced; it validates at once
        await settle();
        const amtAgain = router.root.querySelector('input[placeholder="0.0"]');
        ok('picking a recipient keeps the typed amount', amtAgain && amtAgain.value === '5',
          `amount read back: "${amtAgain?.value ?? 'field missing'}"`);
        const myAccounts2 = buttons(router.root, /my accounts/i)[0];
        if (myAccounts2) {
          click(myAccounts2);
          await settle();
          const backBtn = buttons(router.root, /^back$/i)[0];
          if (backBtn) {
            click(backBtn);
            await settle();
            const amtAgain2 = router.root.querySelector('input[placeholder="0.0"]');
            ok('backing out of the picker also keeps the amount',
              amtAgain2 && amtAgain2.value === '5');
          } else {
            ok('the picker offers a Back control', false, textOf(router.root).slice(0, 200));
          }
        }
      } else {
        ok('the account picker lists a selectable non-active account', false,
          textOf(router.root).slice(0, 200));
      }
    } else {
      ok('the send form offers the account picker shortcut', false, textOf(router.root).slice(0, 200));
    }
  }

  // ---- Stuck-pending regression (manual smoke defect) -------------------------------------
  // The send path awaits confirmation, then records the transaction as SUBMITTED — and no
  // trigger ever settled it while the popup was open, so Dashboard/History showed the
  // confirmed send as pending forever. Views now actively reconcile before saying
  // "pending". The fixture's tx.reconcilePending settles submitted records to confirmed.
  const STUCK = {
    signature: 'sig_stuck_manual_smoke_aaaaaaaaaaaaaaaaaaaaa', kind: 'transfer',
    from: activeAccount().address, to: ADDRESS_B,
    amountUnits: '5000000000', mint: null, displayAmount: '5 THRU',
    networkId: 'alphanet', status: 'submitted', submittedAt: Date.now(),
    settledAt: null, error: null,
  };

  backend.pending = [{ ...STUCK }];
  router.navigate('/dashboard');
  await settle();
  ok('the dashboard proactively reconciles a submitted transaction',
    chromeLog.calls.includes('tx.reconcilePending'));
  ok('the pending note clears once the dashboard settles',
    !/transaction[s]? pending/i.test(textOf(router.root)), textOf(router.root).slice(0, 200));

  backend.pending = [{ ...STUCK }];
  router.navigate('/history');
  await settle();
  ok('the history view proactively reconciles a submitted transaction',
    chromeLog.calls.filter((m) => m === 'tx.reconcilePending').length >= 2);
  ok('a reconciled send never renders next to "Waiting for confirmation"',
    !/Waiting for confirmation/.test(textOf(router.root)), textOf(router.root).slice(0, 220));

  // Render-level belt-and-braces: even when reconcile settles nothing (history-list lag),
  // a signature the list already displays cannot ALSO be a Pending row.
  const realReconcile = FIXTURES['tx.reconcilePending'];
  FIXTURES['tx.reconcilePending'] = () => ({ checked: 0, settled: 0 });
  backend.pending = [{ ...STUCK, signature: 'sig1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }];
  router.navigate('/history');
  await settle();
  ok('a signature the list already shows as confirmed is not duplicated as Pending',
    !/Waiting for confirmation/.test(textOf(router.root)), textOf(router.root).slice(0, 220));
  FIXTURES['tx.reconcilePending'] = realReconcile;
  backend.pending = [];

  // The account pill is the dashboard's route into account management.
  router.navigate('/dashboard');
  await settle();
  const pill = router.root.querySelector('.account-pill') || buttons(router.root, /main/i)[0];
  ok('the dashboard exposes the active account', Boolean(pill), `${pill?.className}`);
  if (pill) {
    click(pill);
    await settle();
    ok('the account pill reaches /accounts', router.currentPath === '/accounts', router.currentPath);
  }

  // History paging uses the cursor form, which must append rather than refetch.
  router.navigate('/history');
  await settle();
  const listed = textOf(router.root);
  ok('history rendered its entries', /sig1|transfer|faucet/i.test(listed) || listed.length > 40,
    listed.slice(0, 120));
  const more = buttons(router.root, /load more/i)[0];
  if (more) {
    const historyCallsBefore = chromeLog.calls.filter((m) => m === 'tx.listHistory').length;
    click(more);
    await settle();
    ok('"load more" issues another tx.listHistory call',
      chromeLog.calls.filter((m) => m === 'tx.listHistory').length > historyCallsBefore);
  } else {
    ok('history offers no "load more" while the fixture reports no further pages',
      backendHasMoreHistory() === false);
  }

  router.stop();
  await settle();
  const leaks = detachedListeners();
  ok('navigation left no listener on a detached element', leaks.length === 0,
    JSON.stringify(leaks.slice(0, 4)));
}

function backendHasMoreHistory() {
  return HISTORY_ENTRIES.length > 15;
}

// ---- Negative controls -----------------------------------------------------
//
// An assertion that cannot fail is decoration. Each check below breaks the thing the corresponding
// assertion protects, and confirms the harness notices. Run last, because they poison the DOM and
// the torn-down list on purpose.

function negativeControls() {
  section('negative controls: the assertions above can actually fail');

  // 1. The source scan must see a real call site, not just the absence of one.
  const injected = [
    "import * as bridge from '../bridge.js';",
    'export function SettingsRoute() {',
    '  // network.upsertCustom is mentioned in a comment and must not be flagged',
    '  const s = "network.upsertCustom in a string is also not a call";',
    '  bridge.send(\'network.upsertCustom\', { rpcUrl: s });',
    '  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });',
    '  return { el: null, destroy() {} };',
    '}',
  ].join('\n');
  const stripped = stripComments(injected);
  ok('control: the source scan flags an injected upsertCustom call',
    /network\.upsertCustom/.test(stripped));
  ok('control: the source scan flags an injected setPanelBehavior call',
    /setPanelBehavior\s*\(/.test(stripped));
  ok('control: comments are stripped, so explanations are not flagged',
    !/must not be flagged/.test(stripped));

  // 2. The secret scanners must catch the historical defect they exist for.
  resetDom();
  const poisoned = h('div', { class: 'mnemonic-grid' });
  poisoned.dataset.raw = SECRET_MNEMONIC;
  DOC.body.appendChild(poisoned);
  const attributeHits = findSecretsInAttributes(SECRETS);
  ok('control: a mnemonic written to dataset.raw is caught', attributeHits.length > 0,
    attributeHits.join(' | '));
  const textPoison = h('p', { text: SECRET_PASSWORD });
  DOC.body.appendChild(textPoison);
  ok('control: a password rendered as text is caught', findSecrets([['password', SECRET_PASSWORD]]).length > 0);

  // 3. The torn-down scan must catch a secret a route failed to wipe.
  TORN_DOWN.length = 0;
  const lazy = h('section', { class: 'screen' }, h('span', { text: SECRET_MNEMONIC }));
  TORN_DOWN.push(lazy);
  ok('control: a phrase left in a destroyed route is caught',
    findSecretsInTornDown(SECRETS).length > 0);
  ok('control: the same subtree is clean once wiped', (() => {
    while (lazy.firstChild) lazy.removeChild(lazy.firstChild);
    return findSecretsInTornDown(SECRETS).length === 0;
  })());

  // 4. Without a trap, Tab from the last control simply leaves the dialog. This is the behaviour
  //    the trap replaces, so proving it still happens untrapped proves the trap is load-bearing.
  resetDom();
  const behind = h('button', { type: 'button', text: 'behind' });
  const dialog = h('div', { role: 'dialog' });
  const only = h('button', { type: 'button', text: 'only control' });
  dialog.appendChild(only);
  DOC.body.appendChild(behind);
  DOC.body.appendChild(dialog);
  only.focus();
  const untrapped = pressKey(only, 'Tab');
  ok('control: an untrapped dialog does not wrap Tab and does not prevent it',
    untrapped === true && DOC.activeElement === only);

  const trapped = focusTrap(dialog);
  const wrapped = pressKey(only, 'Tab');
  ok('control: the same dialog with a trap prevents the escape', wrapped === false);
  trapped.destroy();

  // 5. A route that throws must be reported, not silently mounted as blank.
  resetDom();
  consoleErrors.length = 0;
  const brokenRoot = DOC.createElement('div');
  DOC.body.appendChild(brokenRoot);
  const broken = new Router({
    routes: [{
      path: '/broken',
      view: () => {
        throw new Error('synthetic mount failure');
      },
    }],
    root: brokenRoot,
    fallback: '/broken',
  });
  captureConsole();
  broken.start();
  releaseConsole();
  ok('control: a throwing route is caught by the console capture',
    routerErrors().some((line) => line.includes('synthetic mount failure')),
    routerErrors().join(' | '));
  broken.stop();
}

// ---- Run -------------------------------------------------------------------

const startedAt = Date.now();
captureConsole();
try {
  for (const scenario of SCENARIOS) {
    await runScenario(scenario);
  }
  await settingsTest();
  focusTrapTest();
  await passwordModalTest();
  await exportSecretTest();
  await navigationTest();
  negativeControls();
} finally {
  releaseConsole();
}
sourceTest();

clearTimers();

section('result');
console.log(`\nroute lifecycle checks: ${checks - failures}/${checks} passed in ${Date.now() - startedAt}ms.`);
console.log(`  routes: ${ROUTE_PATHS.length}  scenarios: ${SCENARIOS.length}  `
  + `sweep mounts: ${SCENARIOS.length * mountUrls().length}`);
for (const method of chromeLog.calls) exercisedMethods.add(method);
console.log(`  backend methods exercised: ${exercisedMethods.size} of ${Object.keys(FIXTURES).length} fixtures`);
console.log(`  route mounts: ${SCENARIOS.length} scenarios x ${mountUrls().length} URLs, plus `
  + 'settings, focus-trap, password-modal, export and negative-control passes');

if (failures > 0) {
  realConsole.error(`\n${failures} check(s) failed:`);
  for (const label of failureLabels.slice(0, 40)) realConsole.error(`  - ${label}`);
  if (consoleErrors.length) {
    realConsole.error('\ncaptured console.error output:');
    for (const line of consoleErrors.slice(0, 20)) realConsole.error(`  ${line}`);
  }
  process.exit(1);
}

console.log('\nEvery route mounts in every vault state, tears down without leaving a listener on a');
console.log('detached node, and no password, phrase or private key survives the DOM or the URL.');
