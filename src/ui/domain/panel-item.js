import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';

/**
 * Rabby-style square cell in the 3-column action panel (aspect-ratio 1/1 via the shared
 * `.panel-item` class — every tile, Send/Receive/Domain/Faucet alike, is one geometry;
 * scripts/check-panel-tiles.mjs pins that parity).
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
