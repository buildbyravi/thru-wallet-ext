import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';

/**
 * CurrentConnection footer: Rabby layout with Thru precision.
 *
 * Left: Globe icon + connected dApp origin or 'Not connected to any Dapp'.
 * Right: Clickable network status badge with live health pip. Clicking the network
 *        badge navigates to /settings where network selection is configured.
 *
 * @param {Object} props
 *   site            connected dApp site info ({ origin } or null)
 *   networkLabel    display name for the network (default 'Alphanet')
 *   onNetworkClick  handler when clicking the network badge (e.g. navigate to /settings)
 *   onClick         optional fallback handler
 */
export function CurrentConnection({
  site = null,
  networkLabel = 'Alphanet',
  onNetworkClick,
  onClick,
} = {}) {
  const d = disposer();

  const globe = h('div', { class: 'current-connection-globe' }, icon('globe', 13));
  const text = h('span', {
    class: 'current-connection-text',
    text: site?.origin || 'Not connected to any Dapp',
  });
  const dappGroup = h('div', {
    class: 'current-connection-dapp',
    title: site?.origin
      ? `Connected to ${site.origin}`
      : 'Not connected to any Dapp (connector planned in Phase 2)',
  }, [globe, text]);

  const pip = h('span', { class: 'current-connection-pip healthy' });
  const netLabelEl = h('span', { text: networkLabel });
  const latencyEl = h('span', { class: 'current-connection-latency' });

  const netButton = h('button', {
    type: 'button',
    class: 'current-connection-net clickable',
    title: `Network: ${networkLabel} — click to configure in Settings`,
    'aria-label': `Active network ${networkLabel}`,
  }, [pip, netLabelEl, latencyEl]);

  const handleNet = onNetworkClick || onClick;
  if (handleNet) {
    d.on(netButton, 'click', handleNet);
  }

  const el = h('div', {
    class: 'current-connection',
  }, [dappGroup, netButton]);

  return {
    el,
    update(nextSite, nextNet, latencyMs, healthStatus) {
      if (nextSite !== undefined) {
        text.textContent = nextSite?.origin || 'Not connected to any Dapp';
        dappGroup.title = nextSite?.origin
          ? `Connected to ${nextSite.origin}`
          : 'Not connected to any Dapp (connector planned in Phase 2)';
      }
      if (nextNet !== undefined) {
        netLabelEl.textContent = nextNet;
        netButton.title = `Network: ${nextNet} — click to configure in Settings`;
        netButton.setAttribute('aria-label', `Active network ${nextNet}`);
      }
      if (healthStatus !== undefined) {
        pip.classList.remove('healthy', 'slow', 'offline');
        if (healthStatus === 'offline') {
          pip.classList.add('offline');
          latencyEl.textContent = 'offline';
        } else if (healthStatus === 'slow') {
          pip.classList.add('slow');
          latencyEl.textContent = latencyMs ? `${latencyMs}ms` : '';
        } else {
          pip.classList.add('healthy');
          latencyEl.textContent = latencyMs ? `${latencyMs}ms` : '';
        }
      }
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
