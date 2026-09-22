import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';

/**
 * Rabby-style 88px cell in the 3x2 action panel.
 *
 * @param {Object} props
 *   iconName  string kit icon name
 *   label     display label (e.g. 'Send', 'Receive', 'Swap')
 *   badge     optional count or status badge
 *   disabled  boolean
 *   onClick   click handler
 */
export function PanelItem({ iconName, label, badge, disabled = false, onClick }) {
  const d = disposer();
  const children = [];

  let badgeEl = null;
  if (badge) {
    badgeEl = h('span', { class: 'panel-item-badge', text: String(badge) });
    children.push(badgeEl);
  }
  children.push(h('span', { class: 'panel-item-icon' }, icon(iconName, 24)));
  children.push(h('span', { class: 'panel-item-label', text: label }));

  const el = h('button', {
    type: 'button',
    class: 'panel-item',
    disabled: Boolean(disabled),
  }, children);

  if (onClick && !disabled) {
    d.on(el, 'click', onClick);
  }

  return {
    el,
    setBadge(nextBadge) {
      if (nextBadge) {
        if (!badgeEl) {
          badgeEl = h('span', { class: 'panel-item-badge', text: String(nextBadge) });
          el.appendChild(badgeEl);
        } else {
          badgeEl.textContent = String(nextBadge);
        }
      } else if (badgeEl) {
        badgeEl.remove();
        badgeEl = null;
      }
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
