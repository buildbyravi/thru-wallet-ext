// Button primitive.
//
// Every component in the kit returns { el, update(props), destroy() }. That contract is
// what makes teardown reliable: destroy() removes the exact handler references that were
// added, rather than fresh arrow functions that remove nothing.

import { h, disposer, on } from './dom.js';
import { icon } from './icon.js';

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
    busy = next;
    el.disabled = next || Boolean(current.disabled);
    el.setAttribute('aria-busy', next ? 'true' : 'false');
    paint();
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
      if ('disabled' in next) el.disabled = Boolean(next.disabled) || busy;
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
 */
export function IconButton({ iconName, title, size = 16, variant = '', onClick, disabled } = {}) {
  if (!title) throw new Error('IconButton: `title` is required as the accessible name.');
  const d = disposer();
  const el = h('button', {
    type: 'button',
    class: ['icon-btn', variant].filter(Boolean),
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
export function CopyButton({ getValue, title = 'Copy', onResult } = {}) {
  const button = IconButton({
    iconName: 'copy',
    title,
    size: 14,
    onClick: async () => {
      const value = typeof getValue === 'function' ? getValue() : getValue;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(String(value));
        button.el.classList.add('copied');
        button.update({ iconName: 'check' });
        setTimeout(() => {
          button.el.classList.remove('copied');
          button.update({ iconName: 'copy' });
        }, 1100);
        onResult?.(null);
      } catch (error) {
        onResult?.(error instanceof Error ? error : new Error('Could not copy to clipboard.'));
      }
    },
  });
  return button;
}

export { on };
