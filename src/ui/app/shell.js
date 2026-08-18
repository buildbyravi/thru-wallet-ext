// App shell: the persistent chrome around every route.
//
// The rebuilt stack mounts a route straight into #app, so a route renders only its own
// <section class="screen">. The legacy tree kept the topbar and footer as SIBLINGS of the
// screens inside .app, which is why switching to the new stack made the wordmark and the
// network footer disappear — the routes never included them.
//
// The shell owns that chrome once, so no route has to remember it and every route gets it
// for free.

import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import * as bridge from './bridge.js';

/**
 * @param {{ navigate: Function, onNetworkChange?: Function }} options
 */
export function AppShell({ navigate, onNetworkChange }) {
  const d = disposer();
  let currentNetwork = null;

  // ---- Topbar -------------------------------------------------------------
  //
  // The network badge is not decoration. Once mainnet exists, "which chain am I on" is the
  // difference between a test transfer and a real one, so it is shown permanently next to the
  // wordmark and styled differently for a live network.
  const networkBadge = h('span', { class: 'badge', text: '…' });

  const settingsBtn = h('button', {
    type: 'button',
    class: 'icon-btn',
    title: 'Settings',
    'aria-label': 'Settings',
  }, icon('settings', 16));
  d.on(settingsBtn, 'click', () => navigate('/settings'));

  const lockBtn = h('button', {
    type: 'button',
    class: 'icon-btn danger-hover',
    title: 'Lock wallet',
    'aria-label': 'Lock wallet',
  }, icon('lock', 15));
  d.on(lockBtn, 'click', async () => {
    try {
      await bridge.send('wallet.lock');
    } catch {
      // The lockStateChanged event drives the redirect; a failure here is still safe
      // because the route guard re-checks lock state on the next navigation.
    }
    navigate('/unlock', { replace: true });
  });

  const topbar = h('header', { class: 'topbar' }, [
    h('div', { class: 'row-flex' }, [
      h('div', { class: 'wordmark' }, h('span', { text: 'thru wallet' })),
      networkBadge,
    ]),
    h('div', { class: 'topbar-right' }, [settingsBtn, lockBtn]),
  ]);

  // ---- Footer: network + status ------------------------------------------
  const dot = h('span', { class: 'foot-dot' });
  const netLabel = h('span', { text: 'Connecting…' });
  const latency = h('span', { class: 'foot-latency' });

  const footer = h('button', {
    type: 'button',
    class: 'foot clickable',
    title: 'Network status',
  }, [dot, netLabel, latency]);
  d.on(footer, 'click', () => navigate('/settings'));

  // Where routes render.
  const outlet = h('main', { class: 'app-outlet' });

  const el = h('div', { class: 'app-shell' }, [topbar, outlet, footer]);

  /**
   * Health is fetched AFTER first paint, never before. system.bootstrap used to await a
   * live checkNetworkHealth() call, which meant the popup could not render until the RPC
   * answered — the "loading wallet" delay.
   */
  async function refreshNetwork() {
    try {
      const network = await bridge.send('network.getActive');
      const label = network?.label || network?.id || 'Unknown network';
      netLabel.textContent = label;

      // A live network must never look like a test one. `isTestnet` existed in the config for
      // a long time and drove nothing; it now drives both the badge and faucet visibility.
      networkBadge.textContent = label;
      networkBadge.classList.toggle('badge-live', network?.isTestnet === false);
      networkBadge.title = network?.isTestnet === false
        ? 'Live network — transactions move real funds'
        : 'Test network';

      currentNetwork = network;
      onNetworkChange?.(network);
    } catch {
      netLabel.textContent = 'Network unavailable';
      networkBadge.textContent = '—';
    }
    try {
      const health = await bridge.send('tx.checkHealth');
      const ms = Number(health?.latencyMs);
      const online = health?.status === 'ok' || health?.healthy === true || Number.isFinite(ms);
      dot.classList.remove('healthy', 'slow', 'offline');
      if (!online) {
        dot.classList.add('offline');
        latency.textContent = 'offline';
      } else {
        dot.classList.add(ms > 800 ? 'slow' : 'healthy');
        latency.textContent = Number.isFinite(ms) ? `${ms}ms` : '';
      }
    } catch {
      dot.classList.remove('healthy', 'slow');
      dot.classList.add('offline');
      latency.textContent = 'offline';
    }
  }

  d.add(bridge.onEvent('networkChanged', () => refreshNetwork()));

  return {
    el,
    outlet,
    get network() {
      return currentNetwork;
    },
    /** Hide chrome on screens that own the whole viewport (unlock, onboarding). */
    setChromeVisible(visible) {
      topbar.classList.toggle('hidden', !visible);
      footer.classList.toggle('hidden', !visible);
    },
    refreshNetwork,
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
