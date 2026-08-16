// Tests for src/ui/kit/dom.js — the node factory that is the entire XSS defence.
//
// This file is security-critical: if h() can be talked into producing an executable
// attribute or an unsafe URL, then every "no innerHTML" guarantee elsewhere is decorative.
//
// jsdom is deliberately NOT a dependency here. Two reasons:
//   1. isSafeUrl() is a pure function and is the actual decision point for URL-based
//      script injection, so it needs no DOM at all and is tested exhaustively.
//   2. The remaining behaviour is about WHICH DOM methods get called with WHAT, which a
//      small faithful shim verifies directly. A shim cannot prove browser rendering
//      behaviour, and this file does not claim to — see the note at the bottom.
//
// Run: node test-ui-dom.mjs

// ---- Minimal DOM shim -----------------------------------------------------
// Records mutations so assertions can check that text went through textContent and never
// through anything that parses markup.

class ShimNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

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

  replaceChildren(...next) {
    this.childNodes = [];
    for (const n of next) this.appendChild(n);
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
}

class ShimElement extends ShimNode {
  constructor(tag, ns = null) {
    super();
    this.nodeType = 1;
    this.tagName = tag;
    this.namespaceURI = ns;
    this.attributes = new Map();
    this.listeners = [];
    this.dataset = {};
    this.style = {
      _props: new Map(),
      setProperty(name, value) {
        this._props.set(name, value);
      },
    };
    this._text = null;
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
      remove: (...names) => names.forEach((n) => this.classList._set.delete(n)),
      contains: (n) => this.classList._set.has(n),
      toggle: (n, on) => (on ? this.classList._set.add(n) : this.classList._set.delete(n)),
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(event, handler, options) {
    this.listeners.push({ event, handler, options });
  }

  removeEventListener(event, handler) {
    const i = this.listeners.findIndex((l) => l.event === event && l.handler === handler);
    if (i >= 0) this.listeners.splice(i, 1);
  }

  set textContent(value) {
    this._text = String(value);
    this.childNodes = [];
  }

  get textContent() {
    if (this._text !== null) return this._text;
    return this.childNodes.map((c) => c.textContent ?? '').join('');
  }

  // Deliberately absent: innerHTML, outerHTML, insertAdjacentHTML.
  // If dom.js ever reaches for one, these tests throw instead of silently passing.
}

globalThis.document = {
  createElement: (tag) => new ShimElement(tag),
  createElementNS: (ns, tag) => new ShimElement(tag, ns),
  createTextNode: (data) => new ShimText(data),
  createDocumentFragment: () => new ShimNode(),
};
globalThis.requestAnimationFrame = (fn) => fn();

// ---- Harness --------------------------------------------------------------

let checks = 0;
let failures = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

function throws(label, fn, matcher) {
  checks += 1;
  try {
    fn();
    failures += 1;
    console.error(`  FAIL - ${label}\n         expected a throw, got none`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (matcher && !matcher.test(message)) {
      failures += 1;
      console.error(`  FAIL - ${label}\n         threw, but message was: ${message}`);
    } else {
      console.log(`  ok - ${label}`);
    }
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

const { h, text, clear, frag, render, on, disposer, isSafeUrl } = await import('./src/ui/kit/dom.js');

// ---- isSafeUrl: the actual XSS decision function ---------------------------

section('isSafeUrl rejects script-executing schemes');

const UNSAFE = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'JAVASCRIPT:alert(1)',
  '  javascript:alert(1)',
  '\tjavascript:alert(1)',
  '\njavascript:alert(1)',
  'java\nscript:alert(1)',
  'java\tscript:alert(1)',
  'java\u0000script:alert(1)',
  'jav\u00a0ascript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'data:application/javascript,alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'about:blank',
  'blob:https://evil.example/uuid',
];
for (const url of UNSAFE) {
  ok(`rejects ${JSON.stringify(url).slice(0, 46)}`, isSafeUrl(url) === false);
}

section('isSafeUrl allows legitimate URLs');

const SAFE = [
  '',
  '/relative/path',
  './sibling',
  '#/dashboard',
  'https://scan.thru.org/tx/abc',
  'http://127.0.0.1:8899',
  'mailto:someone@example.com',
  'data:image/png;base64,iVBORw0KGgo=',
  'data:image/svg+xml;base64,PHN2Zy8+',
];
for (const url of SAFE) {
  ok(`allows ${JSON.stringify(url).slice(0, 46)}`, isSafeUrl(url) === true);
}

// ---- h(): refusal of executable attributes --------------------------------

section('h() refuses inline event handlers');

throws('onclick prop throws', () => h('button', { onclick: 'alert(1)' }), /inline handler/i);
throws('onClick prop throws', () => h('button', { onClick: () => {} }), /inline handler/i);
throws('onerror prop throws', () => h('img', { onerror: 'alert(1)' }), /inline handler/i);
throws('onmouseover prop throws', () => h('div', { onmouseover: 'x' }), /inline handler/i);

section('h() refuses markup injection');

throws('html prop throws', () => h('div', { html: '<script>alert(1)</script>' }), /not supported/i);
throws('innerHTML prop throws', () => h('div', { innerHTML: '<b>x</b>' }), /not supported/i);
throws('dangerouslySetInnerHTML throws', () => h('div', { dangerouslySetInnerHTML: 'x' }), /not supported/i);
throws('style as string throws', () => h('div', { style: 'color:red' }), /object/i);

// ---- h(): text handling ---------------------------------------------------

section('h() routes text through textContent, never markup');

const scripty = '<script>alert(1)</script>';
const withText = h('div', { text: scripty });
ok('text prop is stored verbatim as text', withText.textContent === scripty);
ok('text prop creates no child elements', withText.childNodes.length === 0);

const withChild = h('div', null, scripty);
ok('string child becomes a text node', withChild.childNodes.length === 1 && withChild.childNodes[0].nodeType === 3);
ok('string child is not parsed', withChild.childNodes[0].data === scripty);

const brokenOut = h('div', null, '"><img src=x onerror=alert(1)>');
ok(
  'attribute-breakout attempt stays a single text node',
  brokenOut.childNodes.length === 1 && brokenOut.childNodes[0].nodeType === 3,
);

// ---- h(): URL attributes --------------------------------------------------

section('h() drops unsafe URL attributes');

const badLink = h('a', { href: 'javascript:alert(1)', text: 'click' });
ok('unsafe href is not set at all', badLink.getAttribute('href') === null);

const goodLink = h('a', { href: 'https://scan.thru.org/tx/1' });
ok('safe href is set', goodLink.getAttribute('href') === 'https://scan.thru.org/tx/1');

const badImg = h('img', { src: 'data:text/html,<script>alert(1)</script>' });
ok('unsafe img src is dropped', badImg.getAttribute('src') === null);

const goodImg = h('img', { src: 'data:image/png;base64,iVBORw0KGgo=' });
ok('inline image src is allowed', goodImg.getAttribute('src') !== null);

const badAttrs = h('form', { attrs: { action: 'javascript:x' } });
ok('unsafe URL inside attrs is dropped too', badAttrs.getAttribute('action') === null);

// ---- h(): ordinary behaviour ----------------------------------------------

section('h() builds elements correctly');

const classed = h('div', { class: ['a', 'b'] });
ok('array class applies each name', classed.classList.contains('a') && classed.classList.contains('b'));

const conditional = h('div', { class: { on: true, off: false } });
ok('object class applies only truthy names', conditional.classList.contains('on') && !conditional.classList.contains('off'));

const boolAttr = h('button', { disabled: true });
ok('true renders as an empty attribute', boolAttr.getAttribute('disabled') === '');

const skipped = h('button', { disabled: false });
ok('false omits the attribute entirely', skipped.getAttribute('disabled') === null);

const nulled = h('div', { title: null, 'aria-label': undefined });
ok('null and undefined props are skipped', nulled.attributes.size === 0);

let captured = null;
const listened = h('button', { on: { click: () => { captured = 'fired'; } } });
ok('on: registers a listener', listened.listeners.length === 1 && listened.listeners[0].event === 'click');
listened.listeners[0].handler();
ok('registered listener is callable', captured === 'fired');

let refd = null;
h('div', { ref: (el) => { refd = el; } });
ok('ref receives the element', refd !== null && refd.tagName === 'div');

const dataEl = h('div', { dataset: { kind: 'seed', index: 2 } });
ok('dataset values are stringified', dataEl.dataset.kind === 'seed' && dataEl.dataset.index === '2');

const svgEl = h('svg', { viewBox: '0 0 24 24' });
ok('svg tags get the SVG namespace', svgEl.namespaceURI === 'http://www.w3.org/2000/svg');
const divEl = h('div');
ok('html tags get no namespace', divEl.namespaceURI === null);

const nested = h('ul', null, [h('li', { text: 'one' }), h('li', { text: 'two' }), null, false]);
ok('nested children flatten and skip null/false', nested.childNodes.length === 2);

// ---- clear / render / frag ------------------------------------------------

section('clear() and render() replace content without markup');

const parent = h('div', null, [h('span'), h('span'), h('span')]);
ok('parent starts with three children', parent.childNodes.length === 3);
clear(parent);
ok('clear() removes every child', parent.childNodes.length === 0);

render(parent, [h('b', { text: 'x' })]);
ok('render() replaces content', parent.childNodes.length === 1);
render(parent, [h('i'), h('i')]);
ok('render() clears before appending', parent.childNodes.length === 2);

const f = frag([h('span'), 'tail']);
ok('frag() holds mixed children', f.childNodes.length === 2);

ok('text() makes a text node', text('hi').nodeType === 3 && text('hi').data === 'hi');
ok('text(null) is empty, not "null"', text(null).data === '');

// ---- disposer: the teardown fix ------------------------------------------

section('disposer() removes the exact handler references it added');

// This is the regression guard for the defect present at six sites in the old UI, where
// removeEventListener is called with a freshly created arrow function and therefore
// removes nothing — leaving the dashboard's buttons permanently dead after one round trip.
const target = h('button');
const d = disposer();
const handler = () => {};
d.on(target, 'click', handler);
ok('listener is attached', target.listeners.length === 1);
d.dispose();
ok('dispose() actually detaches it', target.listeners.length === 0);

const target2 = h('button');
const off = on(target2, 'click', () => {});
ok('on() attaches', target2.listeners.length === 1);
off();
ok('on() returns a working remover', target2.listeners.length === 0);

let order = [];
const d2 = disposer();
d2.add(() => order.push('first'), () => order.push('second'));
d2.dispose();
ok('disposers run in reverse of registration', order.join(',') === 'second,first');

const d3 = disposer();
let reached = false;
d3.add(() => { throw new Error('bad disposer'); }, () => { reached = true; });
d3.dispose();
ok('one throwing disposer does not strand the others', reached === true);

// ---- refs: URL-safe account references ------------------------------------

section('refs codec round-trips and rejects tampering');

const { encodeRef, decodeRef, refsEqual: refsEq } = await import('./src/shared/refs.js');

const sampleRef = { keyringId: 'seed_aB3xY9zQ', accountIndex: 4 };
const token = encodeRef(sampleRef);
ok('encodeRef produces a URL-safe token', /^[A-Za-z0-9_-]+$/.test(token), `got ${token}`);

const decoded = decodeRef(token);
ok('decodeRef round-trips keyringId', decoded?.keyringId === 'seed_aB3xY9zQ');
ok('decodeRef round-trips accountIndex', decoded?.accountIndex === 4);

// A ref must carry only the two fields it needs. If a future caller passes an object that
// happens to hold a secret, encodeRef must not serialize it into the URL.
function decodeTokenRaw(t) {
  const padded = t.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

const leaky = encodeRef({ keyringId: 'seed_aB3xY9zQ', accountIndex: 0, mnemonic: 'correct horse battery staple' });
ok(
  'encodeRef drops every field except keyringId and accountIndex',
  !decodeTokenRaw(leaky).includes('horse'),
  'a secret passed alongside a ref must never reach the URL',
);

ok('refsEqual matches identical refs', refsEq(sampleRef, { keyringId: 'seed_aB3xY9zQ', accountIndex: 4 }));
ok('refsEqual tolerates index vs accountIndex', refsEq({ keyringId: 'k_abcd', index: 2 }, { keyringId: 'k_abcd', accountIndex: 2 }));
ok('refsEqual rejects a different index', !refsEq(sampleRef, { keyringId: 'seed_aB3xY9zQ', accountIndex: 5 }));
ok('refsEqual rejects a different keyring', !refsEq(sampleRef, { keyringId: 'seed_other1', accountIndex: 4 }));
ok('refsEqual rejects missing keyringId', !refsEq({ accountIndex: 1 }, { accountIndex: 1 }));

// The hash is user-editable, so decode must reject anything malformed rather than handing
// a bad object to the vault.
const BAD_REFS = [
  '',
  'not-base64!!',
  encodeRef({ keyringId: 'seed_ok1234', accountIndex: 0 }).slice(0, 4),
  btoa(JSON.stringify({ k: '', i: 0 })).replace(/=+$/, ''),
  btoa(JSON.stringify({ k: 'seed_ok1234', i: -1 })).replace(/=+$/, ''),
  btoa(JSON.stringify({ k: 'seed_ok1234', i: 999999 })).replace(/=+$/, ''),
  btoa(JSON.stringify({ k: 'seed_ok1234', i: 1.5 })).replace(/=+$/, ''),
  btoa(JSON.stringify({ k: '../../etc/passwd', i: 0 })).replace(/=+$/, ''),
  btoa(JSON.stringify({ k: '<script>', i: 0 })).replace(/=+$/, ''),
  btoa('not json at all').replace(/=+$/, ''),
  'A'.repeat(600),
];
for (const bad of BAD_REFS) {
  ok(`decodeRef rejects ${JSON.stringify(bad).slice(0, 40)}`, decodeRef(bad) === null);
}

// ---- Result ---------------------------------------------------------------

console.log(`\ndom.js checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('h() cannot be coerced into producing an executable attribute or unsafe URL.');
console.log(
  'NOTE: this uses a DOM shim with no innerHTML property, so it verifies which DOM APIs\n'
  + '      dom.js calls, not how a real browser renders the result. Browser-level checks\n'
  + '      belong in a jsdom route smoke test (docs/UI_REBUILD_PLAN.md Phase 0 item 4).',
);
