// Feedback primitives: error banners, empty states, loading, and page chrome.

import { h, disposer } from './dom.js';
import { icon } from './icon.js';

/**
 * A dismissible-free inline banner for screen-level messages.
 * @param {{ tone?: 'error'|'warning'|'info', message?: string }} props
 */
export function Banner({ tone = 'error', message = '' } = {}) {
  const toneClass = tone === 'error' ? 'error' : ['notice', tone === 'warning' ? 'warning' : ''].filter(Boolean);
  const textEl = h('span', { text: message });
  const el = h('div', {
    class: toneClass,
    role: tone === 'error' ? 'alert' : 'status',
  }, textEl);
  if (!message) el.classList.add('hidden');

  return {
    el,
    set(nextMessage, nextTone) {
      textEl.textContent = nextMessage ? String(nextMessage) : '';
      el.classList.toggle('hidden', !nextMessage);
      if (nextTone && nextTone !== tone) {
        el.classList.remove('error', 'notice', 'warning');
        if (nextTone === 'error') el.classList.add('error');
        else el.classList.add('notice', nextTone === 'warning' ? 'warning' : '');
        el.setAttribute('role', nextTone === 'error' ? 'alert' : 'status');
      }
    },
    clear() {
      this.set('');
    },
    destroy() {
      el.remove();
    },
  };
}

/**
 * Empty state for a list that has nothing in it — distinct from a list that is still
 * loading and from one that failed. Conflating those three is why several current screens
 * show a permanent blank area when the network is down.
 */
export function Empty({ iconName = 'info', title = 'Nothing here yet', body = '' } = {}) {
  return {
    el: h('div', { class: 'empty-state' }, [
      h('div', { class: 'empty-state-icon' }, icon(iconName, 20)),
      h('p', { class: 'empty-state-title', text: title }),
      body ? h('p', { class: 'hint center', text: body }) : null,
    ]),
  };
}

/** Inline spinner with an accessible label. */
export function Spinner({ label = 'Loading' } = {}) {
  return {
    el: h('div', { class: 'row-flex center', role: 'status', 'aria-live': 'polite' }, [
      icon('spinner', 16, { className: 'spinning' }),
      h('span', { class: 'hint', text: label }),
    ]),
  };
}

/**
 * Screen header: back affordance, centred title, optional right slot.
 *
 * Mirrors Rabby's PageHeader. The back action is a real button with an accessible name,
 * unlike several current back buttons that carry only a title attribute.
 */
export function PageHeader({ title, onBack, right = null, backLabel = 'Back' } = {}) {
  const d = disposer();
  const titleEl = h('h1', { text: title ?? '' });

  let left;
  if (typeof onBack === 'function') {
    left = h('button', {
      type: 'button',
      class: 'icon-btn',
      title: backLabel,
      'aria-label': backLabel,
    }, icon('back', 16));
    d.on(left, 'click', onBack);
  } else {
    left = h('span', { class: 'subheader-spacer' });
  }

  const el = h('div', { class: 'subheader' }, [
    left,
    titleEl,
    right ?? h('span', { class: 'subheader-spacer' }),
  ]);

  return {
    el,
    setTitle(next) {
      titleEl.textContent = next ?? '';
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}

/**
 * Bottom-pinned action row. Keeps a short form's buttons at the foot of the panel instead
 * of floating mid-screen, which is what .screen's flex:1 inside a 580px shell causes.
 */
export function Actions(children) {
  return { el: h('div', { class: 'screen-actions' }, children) };
}

/** Vertical stack with a token-sized gap. Spacing belongs to the container. */
export function Stack(children, { gap = 4 } = {}) {
  return h('div', { class: ['stack', `stack-${gap}`] }, children);
}

/** Horizontal row. */
export function Row(children, { between = false, gap = 2 } = {}) {
  return h('div', {
    class: ['row-flex', between ? 'between' : null, `stack-${gap}`].filter(Boolean),
  }, children);
}
