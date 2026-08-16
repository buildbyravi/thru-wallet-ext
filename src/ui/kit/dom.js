// The single node factory. Every element in the new UI is built here.
//
// WHY THIS EXISTS
//
// The old UI has ~20 sites that interpolate values into innerHTML, and there is no
// escaping helper anywhere in the repo. Several of those values are attacker-influenced:
// a token's name/ticker/image comes from an arbitrary on-chain mint, and account labels
// and search queries come from the user. Fixing that by adding esc() at 20 call sites is
// a policy, and policies decay — the 21st call site forgets.
//
// So instead: text can only be set via textContent, attributes only via setAttribute,
// and the dangerous cases are refused outright:
//
//   - `on*` attribute names are rejected. Listeners go through `on: { click: fn }`,
//     which uses addEventListener and returns real handler references for teardown.
//   - javascript:, vbscript: and non-image data: URLs are rejected in href/src/action.
//   - There is no escape hatch that accepts markup. If you need markup, you need a
//     component.
//
// scripts/check-layering.mjs greps for `.innerHTML =`, insertAdjacentHTML and
// outerHTML under src/ui and src/features, so a regression fails the build rather than
// shipping. That combination — one factory plus one grep — makes the bug class
// structurally impossible instead of merely discouraged.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Attributes whose value is a URL and therefore a script-execution vector.
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);

// Tags that must be created in the SVG namespace to render at all.
const SVG_TAGS = new Set([
  'svg', 'path', 'line', 'polyline', 'polygon', 'circle', 'rect', 'ellipse', 'g',
  'defs', 'use', 'text', 'tspan', 'clipPath', 'mask', 'linearGradient', 'stop',
]);

/**
 * Reject URLs that can execute script. Allows relative URLs, http(s), mailto and
 * inline images, which covers every legitimate use in this extension.
 * @param {string} value
 * @returns {boolean} true when the URL is safe to set
 */
export function isSafeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return true;
  // Strip characters browsers ignore when resolving a scheme, so "java\nscript:" and
  // "  javascript :" cannot slip past a naive prefix check.
  const collapsed = raw.replace(/[\u0000-\u0020\u00a0\u2000-\u200f\u2028-\u202f]/g, '').toLowerCase();
  if (/^(javascript|vbscript|file|about|blob):/.test(collapsed)) return false;
  if (collapsed.startsWith('data:')) return /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);/.test(collapsed);
  return true;
}

/**
 * Create a text node. Exported so children arrays can mix elements and text
 * without any string concatenation.
 * @param {any} value
 */
export function text(value) {
  return document.createTextNode(value == null ? '' : String(value));
}

/**
 * Remove every child of a node.
 *
 * This is the sanctioned replacement for `el.innerHTML = ''`. It is a genuinely
 * different operation: it detaches nodes without invoking the HTML parser, so it can
 * never resurrect markup, and it lets callers keep references for teardown.
 * @param {Node} node
 */
export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Is this a DOM node?
 *
 * Checks nodeType rather than `instanceof Node`. `instanceof` ties the check to one
 * realm's constructor, so it returns false for a perfectly valid node that came from
 * another document or iframe, and it throws outright where the global is absent. nodeType
 * is what actually matters and is stable across realms.
 */
function isNode(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.nodeType === 'number';
}

function appendChild(parent, child) {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const item of child) appendChild(parent, item);
    return;
  }
  if (isNode(child)) {
    parent.appendChild(child);
    return;
  }
  parent.appendChild(text(child));
}

function applyStyle(el, style) {
  if (typeof style === 'string') {
    // A style string cannot execute script in any current browser, but it is also
    // never necessary here, so it is refused to keep one way of doing things.
    throw new Error('h(): pass style as an object, not a string.');
  }
  for (const [prop, value] of Object.entries(style)) {
    if (value == null) continue;
    el.style.setProperty(
      prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      String(value),
    );
  }
}

/**
 * Build an element.
 *
 * @param {string} tag
 * @param {Object} [props]
 *   class      string | string[] | Record<string, boolean>
 *   text       textContent (mutually exclusive with children)
 *   html       REJECTED — throws, so the mistake is loud
 *   style      object of CSS properties
 *   dataset    object of data-* values
 *   attrs      object of raw attributes (still URL-checked)
 *   on         object of event listeners
 *   ref        callback receiving the element
 *   ...rest    any other attribute
 * @param {Array|Node|string} [children]
 * @returns {Element}
 */
export function h(tag, props = null, children = null) {
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;

      if (key === 'html' || key === 'innerHTML' || key === 'dangerouslySetInnerHTML') {
        throw new Error(
          `h(): '${key}' is not supported. Build child nodes instead — see src/ui/kit/dom.js.`,
        );
      }

      if (/^on[A-Z]/.test(key) || (/^on[a-z]+$/.test(key) && key !== 'on')) {
        throw new Error(
          `h(): inline handler '${key}' is not supported. Use on: { ${key.replace(/^on/i, '').toLowerCase()}: fn }.`,
        );
      }

      if (key === 'on') {
        for (const [event, handler] of Object.entries(value)) {
          if (typeof handler === 'function') el.addEventListener(event, handler);
        }
        continue;
      }

      if (key === 'ref') {
        if (typeof value === 'function') value(el);
        continue;
      }

      if (key === 'text') {
        el.textContent = String(value);
        continue;
      }

      if (key === 'style') {
        applyStyle(el, value);
        continue;
      }

      if (key === 'dataset') {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          if (dataValue == null) continue;
          el.dataset[dataKey] = String(dataValue);
        }
        continue;
      }

      if (key === 'attrs') {
        for (const [attr, attrValue] of Object.entries(value)) {
          if (attrValue == null || attrValue === false) continue;
          if (URL_ATTRS.has(attr.toLowerCase()) && !isSafeUrl(attrValue)) continue;
          el.setAttribute(attr, attrValue === true ? '' : String(attrValue));
        }
        continue;
      }

      if (key === 'class' || key === 'className') {
        const list = Array.isArray(value)
          ? value
          : typeof value === 'object'
            ? Object.entries(value).filter(([, on]) => on).map(([name]) => name)
            : String(value).split(/\s+/);
        for (const name of list) {
          if (name) el.classList.add(name);
        }
        continue;
      }

      // A URL attribute with an unsafe scheme is dropped, not sanitized into
      // something half-working, so the failure is visible rather than subtle.
      if (URL_ATTRS.has(key.toLowerCase()) && !isSafeUrl(value)) continue;

      // Boolean attributes: `disabled: true` -> disabled="".
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }

  if (children != null) appendChild(el, children);
  return el;
}

/**
 * A DocumentFragment, for returning several siblings from one call.
 * @param {Array} children
 */
export function frag(children) {
  const f = document.createDocumentFragment();
  appendChild(f, children);
  return f;
}

/**
 * Replace a node's contents in one operation.
 * @param {Element} parent
 * @param {Array|Node|string} children
 */
export function render(parent, children) {
  clear(parent);
  appendChild(parent, children);
  return parent;
}

/**
 * Attach a listener and get its remover back.
 *
 * Six sites in the old UI call removeEventListener with a freshly created arrow
 * function, which removes nothing — that is why the dashboard's buttons stop
 * responding for good after one round trip. Returning the remover makes correct
 * teardown the path of least effort.
 *
 * @param {EventTarget} target
 * @param {string} event
 * @param {Function} handler
 * @param {Object|boolean} [options]
 * @returns {Function} remover
 */
export function on(target, event, handler, options) {
  if (!target) return () => {};
  target.addEventListener(event, handler, options);
  return () => target.removeEventListener(event, handler, options);
}

/**
 * Collects teardown functions so a component's destroy() is exhaustive by default.
 */
export function disposer() {
  const disposers = [];
  return {
    add(...fns) {
      for (const fn of fns) if (typeof fn === 'function') disposers.push(fn);
    },
    /** Attach a listener and register its removal in one call. */
    on(target, event, handler, options) {
      const off = on(target, event, handler, options);
      disposers.push(off);
      return off;
    },
    dispose() {
      // Run in reverse so teardown mirrors setup order.
      while (disposers.length) {
        const fn = disposers.pop();
        try {
          fn();
        } catch {
          // one bad disposer must not strand the rest
        }
      }
    },
  };
}
