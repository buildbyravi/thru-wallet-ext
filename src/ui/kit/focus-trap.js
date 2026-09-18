// Keyboard focus trap for modal surfaces.
//
// WHY THIS EXISTS
//
// `password-prompt.js` set `role="dialog"` and `aria-modal="true"` and stopped there. Those two
// attributes are a *claim* to assistive technology that focus is confined to the dialog, and
// without a trap the claim is false in both directions:
//
//   - Tab from the last control walks focus into the page BEHIND the overlay. The user keeps
//     typing a password into a field that is no longer on screen, or activates a control they
//     cannot see — on a wallet, "the button I just pressed was the one under the modal" is not
//     a cosmetic problem.
//   - a screen reader in browse mode can leave the dialog for the same reason.
//
// So: wrap Tab/Shift+Tab at the edges, keep Escape as the cancel path, and put focus back where
// it came from when the dialog closes (otherwise focus lands on <body> and the next Tab starts
// from the top of the document, which is how keyboard users lose their place).
//
// Deliberately NOT done here:
//   - no `inert`/`aria-hidden` on the background. Chrome supports `inert`, but applying it to
//     the whole app from a kit primitive is a behaviour change for every future caller and needs
//     a browser test first. The Tab wrap covers the keyboard path, which is the one that bites.
//   - no `focusin` guard that yanks focus back on a mouse click outside. The overlay's own
//     mousedown handler already cancels on a backdrop click, so a click cannot leave the dialog
//     open with focus behind it.
//
// The focusable scan is a tree walk with a predicate rather than
// `querySelectorAll('button, input, …')`: identical result for this codebase, no selector engine
// required, and it works in the DOM shim used by test-route-lifecycle.mjs.

import { on } from './dom.js';

const FOCUSABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

/**
 * Can this element receive keyboard focus?
 *
 * Mirrors the browser's own rules closely enough for a dialog: disabled controls, `type=hidden`
 * inputs, anchors with no href, elements hidden by the `.hidden` utility class, and anything
 * with a negative tabindex are all skipped.
 *
 * @param {Element} node
 */
export function isFocusable(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.disabled) return false;
  // `hidden` is checked on the element AND its ancestors: this codebase hides sections with the
  // `.hidden` utility class (display:none) and with the hidden attribute, and a browser will not
  // focus anything inside a display:none subtree. Treating those controls as Tab stops would send
  // focus somewhere invisible, which reads to a keyboard user as "Tab stopped working".
  for (let n = node; n && n.nodeType === 1; n = n.parentNode) {
    if (n.classList?.contains('hidden') || n.hidden || n.hasAttribute?.('hidden')) return false;
  }

  const tag = String(node.tagName || '').toUpperCase();
  const rawTabIndex = typeof node.getAttribute === 'function' ? node.getAttribute('tabindex') : null;
  if (rawTabIndex !== null && Number(rawTabIndex) < 0) return false;

  if (tag === 'INPUT' && String(node.type || '').toLowerCase() === 'hidden') return false;
  if (tag === 'A' && !node.getAttribute?.('href')) return rawTabIndex !== null;

  return FOCUSABLE_TAGS.has(tag) || rawTabIndex !== null;
}

/**
 * Every focusable descendant of `root`, in DOM order.
 * @param {Element} root
 * @returns {Element[]}
 */
export function collectFocusable(root) {
  const out = [];
  if (!root) return out;

  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType !== 1) continue;
      if (isFocusable(child)) out.push(child);
      walk(child);
    }
  };

  walk(root);
  return out;
}

/**
 * Trap Tab focus inside `container` until `destroy()` runs.
 *
 * @param {Element} container the dialog element (the focusable scan starts here)
 * @param {Object} [options]
 *   onEscape     () => void   called on Escape; the caller decides what cancelling means
 *   initial      Element      element to focus on open (defaults to the first focusable)
 *   restoreFocus boolean      put focus back where it was on destroy (default true)
 * @returns {{ destroy: () => void, focusables: () => Element[], focusFirst: () => void }}
 */
export function focusTrap(container, { onEscape, initial = null, restoreFocus = true } = {}) {
  // Captured before anything moves, so destroy() can put it back.
  const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;

  // The container itself is the fallback target when the dialog holds nothing focusable, so it
  // has to be focusable. tabindex="-1" is script-focusable but not a Tab stop, which is exactly
  // what a dialog root wants.
  if (container && !container.getAttribute?.('tabindex')) {
    container.setAttribute('tabindex', '-1');
  }

  function focusables() {
    return collectFocusable(container);
  }

  function focusFirst() {
    const target = initial || focusables()[0] || container;
    try {
      target?.focus?.();
    } catch {
      // A focus failure must never break the dialog it belongs to.
    }
  }

  function contains(node) {
    for (let n = node; n; n = n.parentNode) {
      if (n === container) return true;
    }
    return false;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      if (typeof onEscape === 'function') {
        event.preventDefault?.();
        onEscape();
      }
      return;
    }

    if (event.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) {
      // Nothing to cycle through: hold focus on the dialog rather than letting it leave.
      event.preventDefault?.();
      container?.focus?.();
      return;
    }

    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const first = items[0];
    const last = items[items.length - 1];

    // Focus is somewhere outside the dialog (or nowhere): pull it to the near edge instead of
    // letting this Tab continue its walk through the page behind the overlay.
    if (!contains(active)) {
      event.preventDefault?.();
      (event.shiftKey ? last : first).focus?.();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault?.();
      first.focus?.();
    } else if (event.shiftKey && active === first) {
      event.preventDefault?.();
      last.focus?.();
    }
  }

  // Capture phase on the document: the dialog's own controls are the usual targets, but focus can
  // also sit on the overlay or on <body>, and the trap has to hold in all of those cases.
  const offKeyDown = on(document, 'keydown', onKeyDown, true);

  return {
    focusFirst,
    focusables,
    destroy() {
      offKeyDown();
      if (!restoreFocus) return;
      // Only restore to something still in the document and still focusable; restoring to a node
      // the caller just removed would silently drop focus to <body> anyway.
      const target = previouslyFocused;
      if (!target || target === (typeof document !== 'undefined' ? document.body : null)) return;
      if (!target.parentNode) return;
      try {
        target.focus?.();
      } catch {
        // ignore
      }
    },
  };
}
