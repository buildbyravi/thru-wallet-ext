// Button primitive.
//
// Every component in the kit returns { el, update(props), destroy() }. That contract is
// what makes teardown reliable: destroy() removes the exact handler references that were
// added, rather than fresh arrow functions that remove nothing.

import { h, disposer, on } from './dom.js';
import { icon } from './icon.js';
import { toast } from './toast.js';

/**
 * @param {Object} props
 *   label      string
 *   variant    'primary' | 'secondary' | 'accent' | 'text' | 'danger'  (default 'secondary')
 *   size       'sm' | 'md' | 'lg'  (default 'md')
 *   type       'button' | 'submit'  (default 'button')
 *   iconName   optional kit icon name, rendered before the label
 *   disabled   boolean
 *   busyLabel  text shown while busy (default 'Working…')
 *   full       stretch to full width (default true — .btn is width:100%)
 *   title      tooltip / accessible name when there is no label
 *   onClick    handler; if it returns a promise the button self-disables until it settles
 */
export function Button(props = {}) {
  const d = disposer();
  let current = { variant: 'secondary', size: 'md', type: 'button', full: true, ...props };
  let busy = false;
  // A disabled control cannot hold focus: Chrome moves focus to <body> the moment `disabled`
  // is set, and it does not come back when the control is enabled again. Disabling on submit
  // therefore used to silently strand the keyboard — and any sheet opened from that button
  // captured <body> as its "opener", so closing it restored focus to the top of the page.
  // Remember where focus was and hand it back once the button is live again, unless something
  // else (a dialog that just opened) has already taken focus somewhere meaningful.
  let focusBeforeBusy = null;
  function captureFocus() {
    if (typeof document === 'undefined') return;
    if (document.activeElement === el) focusBeforeBusy = el;
  }
  // The browser drops focus to <body> without firing a focus event, so the only reliable way to
  // tell "we were disabled and stole the focus" from "the user clicked somewhere empty" is to
  // remember the element at disable time and restore it once the control is live again.
  function restoreFocusIfStolen() {
    // Keep the memory until the button is actually re-enabled: a route may set `disabled: false`
    // while the button is still busy, and dropping it there would strand focus on <body>.
    if (!focusBeforeBusy || el.disabled) return;
    if (typeof document === 'undefined') return;
    // Someone else (usually a dialog that just opened) has taken focus: leave it alone.
    if (document.activeElement !== document.body) {
      focusBeforeBusy = null;
      return;
    }
    // The button itself must still be on screen; a re-rendered form has replaced it.
    const target = focusBeforeBusy;
    focusBeforeBusy = null;
    try {
      target.focus?.();
    } catch {
      // Focus restoration is a courtesy; never let it break the control.
    }
  }

  const labelNode = h('span', { text: current.label ?? '' });
  const el = h('button', {
    type: current.type,
    class: ['btn', current.variant, current.size !== 'md' ? current.size : null].filter(Boolean),
    title: current.title,
    disabled: current.disabled,
  });

  function paint() {
    el.replaceChildren();
    if (busy) {
      el.appendChild(icon('spinner', 14, { className: 'spinning' }));
      labelNode.textContent = current.busyLabel ?? 'Working…';
    } else {
      if (current.iconName) el.appendChild(icon(current.iconName, current.size === 'lg' ? 16 : 14));
      labelNode.textContent = current.label ?? '';
    }
    if (labelNode.textContent) el.appendChild(labelNode);
  }

  paint();

  // A click handler that returns a promise disables the button until it settles. Doing
  // this once here is what stops "double-click broadcast a second transaction" from being
  // every screen's individual responsibility.
  d.on(el, 'click', async (event) => {
    if (busy || el.disabled || typeof current.onClick !== 'function') return;
    const result = current.onClick(event);
    if (!result || typeof result.then !== 'function') return;
    setBusy(true);
    try {
      await result;
    } finally {
      setBusy(false);
    }
  });

  function setBusy(next) {
    // Capture on the way IN only: at that moment focus is still on this button if the user
    // activated it from the keyboard.
    if (next) captureFocus();
    busy = next;
    el.disabled = next || Boolean(current.disabled);
    el.setAttribute('aria-busy', next ? 'true' : 'false');
    paint();
    if (!next) restoreFocusIfStolen();
  }

  return {
    el,
    setBusy,
    update(next = {}) {
      const prevVariant = current.variant;
      const prevSize = current.size;
      current = { ...current, ...next };
      if (prevVariant !== current.variant) {
        el.classList.remove(prevVariant);
        el.classList.add(current.variant);
      }
      if (prevSize !== current.size) {
        if (prevSize !== 'md') el.classList.remove(prevSize);
        if (current.size !== 'md') el.classList.add(current.size);
      }
      if ('disabled' in next) {
        const wasDisabled = el.disabled;
        if (!wasDisabled && next.disabled) captureFocus();
        el.disabled = Boolean(next.disabled) || busy;
        if (wasDisabled && !el.disabled) restoreFocusIfStolen();
      }
      if ('title' in next) el.title = next.title ?? '';
      paint();
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}

/**
 * Square icon-only button. Requires `title` — an icon button with no accessible name is
 * invisible to screen readers, and several of the old ones are.
 *
 * `className` lets a screen adopt a local icon-button language (e.g. the dashboard's dark
 * header uses .dash-header-btn instead of the white .icon-btn surface) without forking the
 * component. Both classes are applied; the screen's later, equally-specific rules win.
 */
export function IconButton({ iconName, title, size = 16, variant = '', className = '', onClick, disabled } = {}) {
  if (!title) throw new Error('IconButton: `title` is required as the accessible name.');
  const d = disposer();
  const el = h('button', {
    type: 'button',
    class: ['icon-btn', variant, className].filter(Boolean),
    title,
    'aria-label': title,
    disabled,
  }, icon(iconName, size));

  if (typeof onClick === 'function') d.on(el, 'click', onClick);

  return {
    el,
    update({ iconName: nextIcon, title: nextTitle, disabled: nextDisabled } = {}) {
      if (nextIcon) {
        el.replaceChildren(icon(nextIcon, size));
      }
      if (nextTitle) {
        el.title = nextTitle;
        el.setAttribute('aria-label', nextTitle);
      }
      if (nextDisabled !== undefined) el.disabled = Boolean(nextDisabled);
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}

/**
 * Copy-to-clipboard button with transient confirmation.
 *
 * Consolidates copy logic that exists separately on at least four screens, and unlike
 * some of those it surfaces failure instead of silently doing nothing when the clipboard
 * write is refused.
 */
export function CopyButton({ getValue, title = 'Copy', className = '', onResult } = {}) {
  let alive = true;
  let copying = false;
  let timer = null;
  const button = IconButton({
    iconName: 'copy',
    title,
    size: 14,
    className,
    onClick: async () => {
      if (!alive || copying) return;
      const value = typeof getValue === 'function' ? getValue() : getValue;
      if (!value) return;
      copying = true;
      let failure = null;
      try {
        await navigator.clipboard.writeText(String(value));
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Could not copy to clipboard.');
      } finally {
        copying = false;
      }
      if (!alive || !button.el.isConnected) return;
      if (failure) {
        if (typeof onResult === 'function') onResult(failure);
        else toast({ tone: 'error', title: 'Could not copy', message: 'Clipboard was unavailable. Copy manually.' });
        return;
      }
      clearTimeout(timer);
      button.el.classList.add('copied');
      button.update({ iconName: 'check' });
      timer = setTimeout(() => {
        if (!alive) return;
        button.el.classList.remove('copied');
        button.update({ iconName: 'copy' });
      }, 1100);
      onResult?.(null);
    },
  });
  const destroy = button.destroy;
  button.destroy = () => {
    alive = false;
    clearTimeout(timer);
    destroy();
  };
  return button;
}

export { on };
