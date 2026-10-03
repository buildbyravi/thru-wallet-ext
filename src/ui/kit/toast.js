// Toast — transient, non-blocking notifications.
//
// WHY THIS EXISTS
//
// The dashboard used Banner (an inline `.notice` inserted into the document flow) for one-line
// feedback such as "Security & Approvals coming soon". An inline banner:
//   - reflows the dashboard (the action grid jumps down), which reads as a layout bug;
//   - looks like a form error (grey box, left rule, no icon, no dismiss);
//   - stays until the next load() and is completely hidden when a sheet is open above it.
//
// A toast is fixed-position, sits above every sheet (z-index 2100 > .modal-overlay 2000),
// announces itself through an aria-live region, and removes itself. Persistent STATE (for
// example "balance could not be verified") still belongs in a Banner; a toast is for
// EVENTS ("Token added", "Address copied", "Side panel unavailable").
//
// Kit rules respected: no bridge, no domain imports, every node from h(), listeners removed
// on dismiss, and timers cleared on dismiss so nothing fires against a detached node.

import { h } from './dom.js';
import { icon } from './icon.js';

const TONE_ICON = { success: 'check', info: 'info', warning: 'warning', error: 'warning' };
const DEFAULT_MS = { success: 3000, info: 3500, warning: 5000, error: 6000 };
const MAX_VISIBLE = 2;
const EXIT_MS = 160;

let host = null;
const live = new Set();

function ensureHost() {
  if (host && host.parentNode) return host;
  host = h('div', {
    class: 'toast-host',
    role: 'region',
    'aria-label': 'Notifications',
    'aria-live': 'polite',
  });
  document.body.appendChild(host);
  return host;
}

function unref(timer) {
  // Node timers (the DOM-shim test run) must not keep the process alive.
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

/**
 * Show a toast.
 *
 * @param {Object} props
 *   tone      'success' | 'info' | 'warning' | 'error'  (default 'info')
 *   title     short headline (recommended)
 *   message   optional second line
 *   duration  ms before auto-dismiss; 0 keeps it until dismissed. Defaults per tone.
 *   action    optional { label, onClick } — one quiet text button (e.g. "Undo", "View")
 * @returns {{ dismiss(): void }}
 */
export function toast({ tone = 'info', title = '', message = '', duration, action = null } = {}) {
  const root = ensureHost();

  // Never stack more than MAX_VISIBLE: the oldest one yields, so a burst of events cannot
  // cover the action grid.
  while (live.size >= MAX_VISIBLE) {
    live.values().next().value.dismiss();
  }

  const toneKey = TONE_ICON[tone] ? tone : 'info';
  const removers = [];
  let timer = null;
  let gone = false;

  const iconEl = h('span', { class: 'toast-icon' }, icon(TONE_ICON[toneKey], 14));
  const body = h('div', { class: 'toast-body' }, [
    title ? h('p', { class: 'toast-title', text: String(title) }) : null,
    message ? h('p', { class: 'toast-message', text: String(message) }) : null,
  ]);
  const actionBtn = action && action.label
    ? h('button', { type: 'button', class: 'toast-action', text: String(action.label) })
    : null;
  const closeBtn = h('button', {
    type: 'button',
    class: 'toast-close',
    title: 'Dismiss',
    'aria-label': 'Dismiss notification',
  }, icon('x', 12));

  const el = h('div', {
    class: ['toast', `toast-${toneKey}`],
    role: toneKey === 'error' ? 'alert' : 'status',
  }, [iconEl, body, actionBtn, closeBtn]);

  function listen(target, event, handler) {
    if (!target) return;
    target.addEventListener(event, handler);
    removers.push(() => target.removeEventListener(event, handler));
  }

  function arm() {
    const ms = duration === undefined ? DEFAULT_MS[toneKey] : duration;
    if (!ms) return;
    clearTimeout(timer);
    timer = unref(setTimeout(dismiss, ms));
  }

  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    for (const off of removers.splice(0)) off();
    live.delete(handle);
    el.classList.add('leaving');
    unref(setTimeout(() => el.remove(), EXIT_MS));
  }

  const handle = { dismiss };

  listen(closeBtn, 'click', dismiss);
  if (actionBtn) {
    listen(actionBtn, 'click', () => {
      try {
        action.onClick?.();
      } finally {
        dismiss();
      }
    });
  }
  // Reading takes time: hovering or focusing pauses the countdown.
  listen(el, 'mouseenter', () => clearTimeout(timer));
  listen(el, 'mouseleave', arm);
  listen(el, 'focusin', () => clearTimeout(timer));
  listen(el, 'focusout', arm);

  live.add(handle);
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  arm();

  return handle;
}

/** Dismiss every visible toast (route teardown, lock, network switch). */
export function dismissAllToasts() {
  for (const t of [...live]) t.dismiss();
}
