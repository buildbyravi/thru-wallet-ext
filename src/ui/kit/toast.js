// Toast — transient, non-blocking notifications. THE notification surface.
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
// THE BLANK-TOAST RULE (added 2026-10-30)
//
// The Domain screen shipped an oversized, nearly empty black bar because three call sites wrote
// `toast('Transaction confirmed')` — a bare string — against a props API. A string destructured
// into the defaulted parameter object, so `title` and `message` were both `''`, and the component
// still built and appended a full-width `.toast` with an icon, an empty `.toast-body` and a close
// button. Nothing failed; the bar just carried no information.
//
// Two rules now make that class of defect impossible to ship silently:
//   1. A string argument means "this is the message": `toast('Saved')` → `{ title: 'Saved' }`.
//   2. A toast with no title AND no message is NEVER rendered. `toast({})` returns an inert
//      handle and touches no DOM, so a malformed call degrades to nothing rather than to chrome.
// `test/test-toast.mjs` drives both, including the exact string form that caused the defect.
//
// STATES
//
// success · info · warning · error · pending. `pending` is for work whose outcome is not known
// yet (a submission in flight): it never expires on its own and is resolved IN PLACE with
// `handle.update({ tone, title, message })`, so the user sees one toast change verdict instead of
// a stack of "submitting…" and "confirmed". A resolved verdict is still never a claim of on-chain
// success — the caller decides the wording, and the transaction pipeline decides what "confirmed"
// means.
//
// Kit rules respected: no bridge, no domain imports, every node from h(), listeners removed
// on dismiss, and timers cleared on dismiss so nothing fires against a detached node.

import { h, clear } from './dom.js';
import { icon } from './icon.js';

const TONE_ICON = { success: 'check', info: 'info', warning: 'warning', error: 'warning', pending: 'spinner' };
const TONE_CLASS = { success: 'toast-success', info: 'toast-info', warning: 'toast-warning', error: 'toast-error', pending: 'toast-pending' };
const DEFAULT_MS = { success: 3000, info: 3500, warning: 5000, error: 6000, pending: 0 };
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

/** Accept the documented props object, or a bare string meaning `{ title }`. */
function normalize(input) {
  if (typeof input === 'string') return { title: input };
  if (!input || typeof input !== 'object') return {};
  return input;
}

function hasContent({ title, message }) {
  return String(title ?? '').trim() !== '' || String(message ?? '').trim() !== '';
}

/** The inert handle a blank or malformed call returns. Nothing is rendered. */
function inertHandle() {
  return { dismiss() {}, update() {}, get el() { return null; } };
}

/**
 * Show a toast.
 *
 * @param {Object|string} input  props object, or a string used as the title
 *   tone      'success' | 'info' | 'warning' | 'error' | 'pending'  (default 'info')
 *   title     short headline (recommended)
 *   message   optional second line
 *   duration  ms before auto-dismiss; 0 keeps it until dismissed. Defaults per tone
 *             (success 3s, info 3.5s, warning 5s, error 6s, pending: never).
 *   action    optional { label, onClick } — one quiet text button (e.g. "Undo", "View")
 *   key       optional stable id. A live toast with the same key is UPDATED in place instead of
 *             stacking a second identical bar (repeated events, retries, pending → verdict).
 * @returns {{ dismiss(): void, update(props: Object): void, el: HTMLElement|null }}
 */
export function toast(input = {}) {
  const props = normalize(input);
  if (!hasContent(props)) return inertHandle();

  const key = props.key == null ? null : String(props.key);

  // Same key, already on screen: resolve the existing toast in place. This is what keeps a
  // retried action from stacking, and what lets a `pending` toast become its own verdict.
  if (key) {
    for (const existing of live) {
      if (existing.key === key) {
        existing.update(props);
        return existing;
      }
    }
  }

  const root = ensureHost();

  // Never stack more than MAX_VISIBLE: the oldest one yields, so a burst of events cannot
  // cover the action grid.
  while (live.size >= MAX_VISIBLE) {
    live.values().next().value.dismiss();
  }

  const state = {
    tone: props.tone,
    title: props.title,
    message: props.message,
    duration: props.duration,
    action: props.action,
  };
  const toneKeyOf = (tone) => (TONE_ICON[tone] ? tone : 'info');

  const removers = [];
  let timer = null;
  let gone = false;

  const iconEl = h('span', { class: 'toast-icon' });
  const body = h('div', { class: 'toast-body' });
  const el = h('div', { class: 'toast' });

  let closeBtn = null;

  function listen(target, event, handler) {
    if (!target) return;
    target.addEventListener(event, handler);
    removers.push(() => target.removeEventListener(event, handler));
  }

  function arm() {
    clearTimeout(timer);
    const ms = state.duration === undefined ? DEFAULT_MS[toneKeyOf(state.tone)] : state.duration;
    if (!ms) return;
    timer = unref(setTimeout(dismiss, ms));
  }

  /** Re-render the body from `state`. Called once on create and again by `update()`. */
  function paint() {
    const toneKey = toneKeyOf(state.tone);
    // Toggle through classList rather than re-assigning className: a wholesale assignment would
    // drop `.open` mid-life and blink an updated toast out and back in.
    el.classList.remove(...Object.values(TONE_CLASS));
    el.classList.add(TONE_CLASS[toneKey]);
    el.setAttribute('role', toneKey === 'error' ? 'alert' : 'status');
    // `data-tone` (not `dataset`) because `h()`/the DOM shim agree on attributes, keeps the tone
    // readable by tests, and never becomes a selector the stylesheet depends on.
    el.setAttribute('data-tone', toneKey);

    clear(iconEl);
    iconEl.appendChild(icon(TONE_ICON[toneKey], 14, toneKey === 'pending' ? { className: 'spinning' } : {}));

    clear(body);
    if (String(state.title ?? '').trim()) body.appendChild(h('p', { class: 'toast-title', text: String(state.title) }));
    if (String(state.message ?? '').trim()) body.appendChild(h('p', { class: 'toast-message', text: String(state.message) }));
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

  const handle = {
    key,
    dismiss,
    /**
     * Resolve or replace this toast in place (e.g. pending → success/error). A patch that would
     * leave no message is refused: the toast is dismissed instead of becoming an empty bar.
     */
    update(patch = {}) {
      if (gone) return;
      const next = normalize(patch);
      for (const field of ['tone', 'title', 'message', 'duration', 'action']) {
        if (next[field] !== undefined) state[field] = next[field];
      }
      if (!hasContent(state)) {
        dismiss();
        return;
      }
      // Rebuild the action slot whenever the action is REPLACED or CLEARED. Testing the new value
      // (`next.action !== undefined`) rather than the merged one is what makes
      // `update({ action: null })` remove a button that is already on screen.
      if (next.action !== undefined) {
        clear(actionSlot);
        const node = buildAction();
        if (node) actionSlot.appendChild(node);
      }
      paint();
      arm();
    },
    get el() {
      return gone ? null : el;
    },
  };

  const actionSlot = h('span');

  function buildAction() {
    if (!state.action || !state.action.label || !actionSlot) return null;
    const actionBtn = h('button', { type: 'button', class: 'toast-action', text: String(state.action.label) });
    listen(actionBtn, 'click', () => {
      try {
        state.action?.onClick?.();
      } finally {
        dismiss();
      }
    });
    return actionBtn;
  }

  closeBtn = h('button', {
    type: 'button',
    class: 'toast-close',
    title: 'Dismiss',
    'aria-label': 'Dismiss notification',
  }, icon('x', 12));

  paint();

  const actionNode = buildAction();
  if (actionNode) actionSlot.appendChild(actionNode);

  el.appendChild(iconEl);
  el.appendChild(body);
  el.appendChild(actionSlot);
  el.appendChild(closeBtn);

  listen(closeBtn, 'click', dismiss);
  // Reading takes time: hovering or focusing pauses the countdown.
  listen(el, 'mouseenter', () => clearTimeout(timer));
  listen(el, 'mouseleave', arm);
  listen(el, 'focusin', () => clearTimeout(timer));
  listen(el, 'focusout', arm);

  live.add(handle);
  root.appendChild(el);
  requestAnimationFrame(() => { if (!gone) el.classList.add('open'); });
  arm();

  return handle;
}

/**
 * Dismiss every visible toast.
 *
 * Called by the shell on lock and on network switch: a message produced on one screen or one
 * network must not still be on screen after the wallet locks or the chain changes. (Before
 * 2026-10-30 this export existed and only a test called it, so toasts outlived both.)
 */
export function dismissAllToasts() {
  for (const t of [...live]) t.dismiss();
}

/** Read-only view of what is on screen — used by tests and diagnostics, never by features. */
export function activeToasts() {
  return [...live].map((t) => ({
    key: t.key,
    tone: t.el?.getAttribute?.('data-tone') ?? null,
    text: t.el?.textContent ?? '',
  }));
}
