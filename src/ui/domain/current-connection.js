import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';

/**
 * CurrentConnection footer replacing the developer latency footer.
 *
 * Left: Globe icon + 'Not connected to any Dapp' (or active origin).
 * Right: Network name with active green pip dot.
 *
 * @param {Object} props
 *   site          connected dApp site info ({ origin } or null)
 *   networkLabel  display name for the network (default 'Alphanet')
 *   onClick       click handler (navigates to settings or connection manager)
 */
export function CurrentConnection({ site = null, networkLabel = 'Alphanet', onClick } = {}) {
  const d = disposer();
  const globe = h('div', { class: 'current-connection-globe' }, icon('globe', 13));
  const text = h('span', {
    class: 'current-connection-text',
    text: site?.origin || 'Not connected to any Dapp',
  });
  const net = h('span', { class: 'current-connection-net' }, [
    h('span', { text: networkLabel }),
    h('span', { class: 'current-connection-pip' }),
  ]);

  const el = h('button', {
    type: 'button',
    class: 'current-connection',
    title: 'Connection status',
  }, [globe, text, net]);

  if (onClick) {
    d.on(el, 'click', onClick);
  }

  return {
    el,
    update(nextSite, nextNet) {
      if (nextSite !== undefined) {
        text.textContent = nextSite?.origin || 'Not connected to any Dapp';
      }
      if (nextNet !== undefined) {
        net.firstChild.textContent = nextNet;
      }
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
