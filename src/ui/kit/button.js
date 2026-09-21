// Button primitive — the dossier's "the button primitive is the product"
// (Task T-01 / Pane f2).
//
// One control for the whole wallet:
//   - four variants (primary | secondary | ghost | danger), three sizes
//   - an inline spinner rendered as .btn__spinner inside .btn__face
//   - the scale(0.98) press depth (styles/components.css)
//   - the pending guard: when onClick returns a promise the button disables
//     itself, sets aria-busy and shows the spinner until the promise settles.
//     The guard owns the whole bridge round-trip, so a double-click can never
//     fire a second tx.send — and it is every screen's default, not each
//     screen's individual responsibility.
//
// Every component in the kit returns { el, update(props), destroy() }. That contract is
// what makes teardown reliable: destroy() removes the exact handler references that were
// added, rather than fresh arrow functions that remove nothing.

import { h, disposer, on } from './dom.js';
import { icon } from './icon.js';

// The dossier variant names map onto BEM modifiers. The plain legacy class is
// emitted alongside it so pre-primitive selectors (`.screen > .btn.text`,
// `.btn.secondary` anchors authored by hand) keep matching while callers
// migrate. 'accent' and 'text' survive as aliases: the dossier palette has a
// single accent CTA per screen region, and it IS the primary; quiet,
// unpadded actions are the ghost.
const VARIANT_CLASSES = {
  primary: ['btn--primary', 'primary'],
  secondary: ['btn--secondary', 'secondary'],
  accent: ['btn--primary', 'accent'],
  danger: ['btn--danger', 'danger'],
  ghost: ['btn--ghost', 'text'],
  text: ['btn--ghost', 'text'],
};
const SIZE_CLASSES = {
  sm: ['btn--sm', 'sm'],
  md: ['btn--md'],
  lg: ['btn--lg', 'lg'],
};

function classesFor(state) {
  return [
    'btn',
    ...(VARIANT_CLASSES[state.variant] ?? VARIANT_CLASSES.secondary),
    ...(SIZE_CLASSES[state.size] ?? SIZE_CLASSES.md),
    state.full === false || state.block === false ? null : 'btn--block',
  ].filter(Boolean);
}

function spinner() {
  return h('span', { class: 'btn__spinner', 'aria-hidden': 'true' });
}

/**
 * @param {Object} props
 *   label      string
 *   variant    'primary' | 'secondary' | 'ghost' | 'danger'
 *              (legacy aliases: 'accent' → primary, 'text' → ghost; default 'secondary')
 *   size       'sm' | 'md' | 'lg'  (default 'md')
 *   type       'button' | 'submit'  (default 'button')
 *   iconName   optional kit icon name, rendered before the label
 *   disabled   boolean
 *   loading    boolean — explicit pending state; spinner in, interactions out
 *   busyLabel  text shown while busy instead of the label (optional)
 *   full       stretch to full width via .btn--block (default true)
 *   block      dossier alias of `full`; either opt-out removes the modifier
 *   title      tooltip / accessible name when there is no label
 *   onClick    handler; if it returns a promise the pending guard engages
 *              until it settles
 */
export function Button(props = {}) {
  const d = disposer();
  let current = { variant: 'secondary', size: 'md', type: 'button', full: true, ...props };
  let busy = Boolean(current.loading);

  const labelNode = h('span', { class: 'btn__label' });
  const face = h('span', { class: 'btn__face' });
  const el = h('button', {
    type: current.type,
    class: classesFor(current),
    title: current.title,
    'aria-busy': String(busy),
    disabled: Boolean(current.disabled) || busy,
  }, face);

  function paint() {
    const children = [];
    if (!busy && current.iconName) {
      children.push(icon(current.iconName, current.size === 'lg' ? 16 : 14));
    }
    labelNode.textContent = busy && current.busyLabel ? current.busyLabel : (current.label ?? '');
    if (labelNode.textContent) children.push(labelNode);
    if (busy) children.push(spinner());
    face.replaceChildren(...children);
  }

  paint();

  // The pending guard. A click handler that returns a promise disables the button until it
  // settles. Doing this once here is what stops "double-click broadcast a second transaction"
  // from being every screen's individual responsibility.
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
    busy = Boolean(next);
    el.disabled = busy || Boolean(current.disabled);
    el.setAttribute('aria-busy', String(busy));
    paint();
  }

  return {
    el,
    setBusy,
    update(next = {}) {
      const prevClasses = classesFor(current);
      current = { ...current, ...next };
      el.classList.remove(...prevClasses);
      el.classList.add(...classesFor(current));
      if ('loading' in next) busy = Boolean(next.loading);
      if ('disabled' in next || 'loading' in next) {
        el.disabled = busy || Boolean(current.disabled);
        el.setAttribute('aria-busy', String(busy));
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
