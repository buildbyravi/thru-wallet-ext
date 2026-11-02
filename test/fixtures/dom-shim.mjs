// A minimal DOM the review card can actually render into.
//
// `test-route-lifecycle.mjs` carries a 700-line shim for mounting whole routes. The card needs
// far less: element creation, text, attributes, classList and listeners. Keeping a second shim
// small enough to read is the point — it renders REAL card output, so the golden-text assertions
// in `test-tx-review-card.mjs` test what a user would see rather than a regex over source.
//
// It cannot prove layout, fonts, wrapping or scrolling. Nothing here claims a browser pass.

class ShimNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  get firstChild() { return this.childNodes[0] || null; }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }

  remove() { this.parentNode?.removeChild(this); }

  clear() { this.childNodes = []; }

  get isConnected() { return true; }
}

class ShimText extends ShimNode {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.textContent = String(data);
  }
}

class ShimClassList {
  constructor() { this.set = new Set(); }
  add(...names) { for (const n of names) if (n) this.set.add(n); }
  remove(...names) { for (const n of names) this.set.delete(n); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.set.has(name) : Boolean(force);
    if (next) this.set.add(name); else this.set.delete(name);
    return next;
  }
}

class ShimElement extends ShimNode {
  constructor(tagName) {
    super();
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.classList = new ShimClassList();
    this.listeners = new Map();
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this._text = null;
    this.id = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'class') {
      for (const cls of String(value).split(/\s+/)) this.classList.add(cls);
    }
    if (name === 'id') this.id = String(value);
    if (name === 'type') this.type = String(value);
  }

  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }

  getAttributeNames() { return [...this.attributes.keys()]; }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  click() { for (const fn of [...(this.listeners.get('click') || [])]) fn({ target: this, preventDefault() {} }); }

  focus() {}

  get textContent() {
    if (this._text != null) return this._text;
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.childNodes = [];
    this._text = String(value);
  }

  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

  querySelectorAll(selector) {
    const out = [];
    const want = selector.startsWith('.') ? { cls: selector.slice(1) } : { tag: selector.toUpperCase() };
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (want.cls ? child.classList.contains(want.cls) : child.tagName === want.tag) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }

  closest(selector) {
    for (let n = this; n; n = n.parentNode) if (n.nodeType === 1 && n.matches(selector)) return n;
    return null;
  }
}

class ShimDocument extends ShimElement {
  constructor() {
    super('#document');
    this.nodeType = 9;
    this.documentElement = new ShimElement('html');
    this.head = new ShimElement('head');
    this.body = new ShimElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) { return new ShimElement(tagName); }
  createElementNS(_ns, tagName) { return new ShimElement(tagName); }
  createTextNode(data) { return new ShimText(data); }
  getElementById(id) { return this.querySelector(`#${id}`); }
}

export function installDom() {
  const document = new ShimDocument();
  globalThis.document = document;
  globalThis.window = globalThis.window || { location: { href: 'chrome-extension://test/popup.html' } };
  return document;
}

/** Every visible string in a rendered subtree, in document order, one per line. */
export function textLines(node, out = []) {
  if (node._text != null && node._text.trim() !== '') out.push(node._text.trim());
  for (const child of node.childNodes || []) textLines(child, out);
  return out;
}

/** The top-level rows of the card, so a budget test can count what a user sees at once. */
export function visibleBlocks(cardEl) {
  return cardEl.children
    .filter((child) => !child.classList.contains('hidden'))
    .map((child) => ({ tag: child.tagName, cls: [...child.classList.set].join('.'), text: child.textContent }));
}

export { ShimDocument, ShimElement };
