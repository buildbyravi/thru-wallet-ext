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

  // No status class on first paint: the health check has not run yet, so the pip stays
  // neutral grey. The old version rendered green immediately, which claimed a connection
  // health nobody had measured — the same offline-honesty rule the history feed follows.
  const pip = h('span', { class: 'current-connection-pip' });
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
    /**
     * Update any subset of the footer's state.
     *
     * Two call forms, one component:
     *   conn.update({ network: 'Alphanet', healthStatus: 'healthy' })   — preferred
     *   conn.update(site, network, latencyMs, healthStatus)             — legacy positional
     *
     * The positional form forced callers to pad with `undefined` for every earlier slot
     * they did not want to touch (update(undefined, undefined, null, 'offline')), which
     * is how an API turns into a footgun. The object form names what changes.
     *
     * @param {Object|{origin: string}} arg1  options object, or the next dApp site
     * @param {string} [nextNet]              legacy: network label
     * @param {number|null} [latencyMs]       legacy: measured latency
     * @param {'healthy'|'slow'|'offline'} [healthStatus] legacy: health state
     */
    update(arg1, nextNet, latencyMs, healthStatus) {
      let nextSite = arg1;
      if (arg1 && typeof arg1 === 'object'
          && !('origin' in arg1)
          && ('site' in arg1 || 'network' in arg1 || 'latencyMs' in arg1 || 'healthStatus' in arg1)) {
        nextSite = arg1.site;
        nextNet = arg1.network;
        latencyMs = arg1.latencyMs;
        healthStatus = arg1.healthStatus;
      }
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
