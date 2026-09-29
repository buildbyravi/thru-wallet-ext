// Sheet — the ONE bottom-sheet scaffold (Rabby's <Popup/> over antd Drawer, in this kit's terms).
//
// WHY THIS EXISTS
//
// password-prompt.js, tx-detail-sheet.js and token-drawer.js each hand-built the same ~40 lines:
// create .modal-overlay + .modal-card, backdrop mousedown closes, focus trap, append to body,
// add `.open` on the next frame, close-exactly-once, destroy owned components, dispose listeners,
// remove the node, call onClose. Three copies means three places to fix the next focus bug.
// security-sheet.js and token-drawer.js now use this; migrating password-prompt.js and
// tx-detail-sheet.js is a mechanical follow-up (see docs/06_MODULAR_REUSE_AUDIT.md).
//
// Contract (same shape as every kit component: el + destroy):
//
//   const sheet = Sheet({ label, className, dismissible, onEscape, onClose });
//   sheet.card            the .modal-card.tx-sheet element — append your views to it
//   sheet.d               a disposer: sheet.d.on(target, event, handler) is removed on close
//   sheet.track(c)        register a component; its destroy() runs on close; returns c
//   sheet.cleanup(fn)     register a teardown fn (timers, in-flight guards, row lists)
//   sheet.setDismissible  false while a save is in flight: backdrop + Escape do nothing
//   sheet.open({ onOpen }) attach, animate in, focus the first control, then call onOpen
//   sheet.close()         idempotent; order: release trap -> cleanups -> owned -> d -> node -> onClose
//   sheet.closed          true once closed (guard every await with it)
//
// Teardown order matters: the trap is released FIRST so focus returns to the opener while the
// node is still in the document (restoring afterwards would land on <body>).

import { h, disposer } from './dom.js';
import { focusTrap } from './focus-trap.js';

/**
 * @param {Object} props
 *   label        accessible name of the dialog (required)
 *   className    extra class(es) on the card, e.g. 'token-drawer'
 *   dismissible  backdrop click / Escape close the sheet (default true)
 *   onEscape     () => void   overrides the default Escape action (which is close)
 *   onClose      () => void   called exactly once when the sheet closes
 */
export function Sheet({ label, className = null, dismissible = true, onEscape = null, onClose = null } = {}) {
  if (!label) throw new Error('Sheet: `label` is required as the dialog\'s accessible name.');

  const d = disposer();
  const owned = [];
  const cleanups = [];
  let canDismiss = Boolean(dismissible);
  let trap = null;
  let closed = false;

  const card = h('div', {
    class: ['modal-card', 'tx-sheet', className].filter(Boolean),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
  });
  const overlay = h('div', { class: 'modal-overlay tx-sheet-overlay' }, card);

  function close() {
    if (closed) return;
    closed = true;
    trap?.destroy();
    trap = null;
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // one bad cleanup must not strand the rest
      }
    }
    for (const c of owned.splice(0)) c.destroy?.();
    d.dispose();
    overlay.remove();
    onClose?.();
  }

  // Backdrop click closes; a click inside the card must not.
  d.on(overlay, 'mousedown', (event) => {
    if (canDismiss && event.target === overlay) close();
  });

  trap = focusTrap(card, {
    onEscape: () => {
      if (!canDismiss) return;
      if (typeof onEscape === 'function') onEscape();
      else close();
    },
  });

  return {
    el: overlay,
    card,
    d,
    get closed() {
      return closed;
    },
    track(component) {
      owned.push(component);
      return component;
    },
    cleanup(fn) {
      if (typeof fn === 'function') cleanups.push(fn);
    },
    setDismissible(next) {
      canDismiss = Boolean(next);
    },
    open({ onOpen } = {}) {
      if (closed) return;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        if (closed) return;
        overlay.classList.add('open');
        trap?.focusFirst();
        onOpen?.();
      });
    },
    close,
    destroy: close,
  };
}
