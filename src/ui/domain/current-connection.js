import { h, disposer } from '../kit/dom.js';

/** Dashboard footer for measured RPC health and the active network. */
export function CurrentConnection({
  networkLabel = 'Betanet',
  onNetworkClick,
} = {}) {
  const d = disposer();

  const statusText = h('span', {
    class: 'current-connection-text',
    text: 'Checking…',
  });
  const latencyEl = h('span', { class: 'current-connection-latency' });
  const healthGroup = h('div', {
    class: 'current-connection-health',
    title: 'RPC health',
    role: 'status',
    'aria-live': 'polite',
  }, [statusText, latencyEl]);

  // No status class on first paint: the health check has not run yet, so the pip stays
  // neutral grey. The old version rendered green immediately, which claimed a connection
  // health nobody had measured — the same offline-honesty rule the history feed follows.
  const pip = h('span', { class: 'current-connection-pip' });
  const netLabelEl = h('span', { text: networkLabel });

  const netButton = h('button', {
    type: 'button',
    class: 'current-connection-net clickable',
    title: `Network: ${networkLabel} — click to configure in Settings`,
    'aria-label': `Active network ${networkLabel}; open Settings to change`,
  }, [pip, netLabelEl]);

  if (onNetworkClick) {
    d.on(netButton, 'click', onNetworkClick);
  }

  const el = h('div', {
    class: 'current-connection',
  }, [healthGroup, netButton]);

  return {
    el,
    /** Update any subset of the network and RPC-health state. */
    update({ network, latencyMs, healthStatus } = {}) {
      if (network !== undefined) {
        netLabelEl.textContent = network;
        netButton.title = `Network: ${network} — click to configure in Settings`;
        netButton.setAttribute('aria-label', `Active network ${network}; open Settings to change`);
      }
      if (healthStatus !== undefined) {
        pip.classList.remove('healthy', 'slow', 'offline');
        if (healthStatus === 'offline') {
          pip.classList.add('offline');
          statusText.textContent = 'Offline';
          latencyEl.textContent = '';
        } else if (healthStatus === 'slow') {
          pip.classList.add('slow');
          statusText.textContent = 'Slow';
          latencyEl.textContent = Number.isFinite(latencyMs) ? `${latencyMs} ms` : '';
        } else {
          pip.classList.add('healthy');
          statusText.textContent = 'Online';
          latencyEl.textContent = Number.isFinite(latencyMs) ? `${latencyMs} ms` : '';
        }
      }
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
