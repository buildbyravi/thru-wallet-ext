// App shell: the persistent chrome around every route.
//
// The shell owns that chrome once, so no route has to remember it and every route gets it
// for free. On the unlocked dashboard, the 196px Rabby-style ink header owns the top of the
// screen, so the shell topbar with the wordmark is hidden there.
//
// The footer is the Rabby-style CurrentConnection bar showing connection state and active network.

import { h, disposer } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { CurrentConnection } from '../domain/current-connection.js';
import * as bridge from './bridge.js';

/**
 * @param {{ navigate: Function, onNetworkChange?: Function }} options
 */
export function AppShell({ navigate, onNetworkChange }) {
  const d = disposer();
  let currentNetwork = null;

  // ---- Topbar (for non-dashboard screens) ----------------------------------
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
      // safe fallback
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

  // ---- CurrentConnection Footer -------------------------------------------
  const connectionFooter = CurrentConnection({
    networkLabel: 'Alphanet',
    onNetworkClick: () => navigate('/settings'),
  });

  // Where routes render.
  const outlet = h('main', { class: 'app-outlet' });

  const el = h('div', { class: 'app-shell' }, [topbar, outlet, connectionFooter.el]);

  function isDashboardPath(path) {
    if (path) return path === '/dashboard' || path.startsWith('/dashboard?');
    const hash = typeof window !== 'undefined' ? (window.location?.hash || '') : '';
    const clean = hash.replace(/^#/, '').split('?')[0];
    return !clean || clean === '/' || clean === '/dashboard';
  }

  /**
   * Health and network info fetched after first paint.
   */
  async function refreshNetwork() {
    try {
      const network = await bridge.send('network.getActive');
      const label = network?.label || network?.id || 'Unknown network';
      connectionFooter.update(undefined, label);

      networkBadge.textContent = label;
      networkBadge.classList.toggle('badge-live', network?.isTestnet === false);
      networkBadge.title = network?.isTestnet === false
        ? 'Live network — transactions move real funds'
        : 'Test network';

      currentNetwork = network;
      onNetworkChange?.(network);
    } catch {
      connectionFooter.update(undefined, '—', null, 'offline');
      networkBadge.textContent = '—';
    }
    try {
      const health = await bridge.send('tx.checkHealth');
      const ms = Number(health?.latencyMs);
      const online = health?.status === 'ok' || health?.healthy === true || Number.isFinite(ms);
      if (!online) {
        connectionFooter.update(undefined, undefined, null, 'offline');
      } else {
        connectionFooter.update(undefined, undefined, Number.isFinite(ms) ? ms : null, ms > 800 ? 'slow' : 'healthy');
      }
    } catch {
      connectionFooter.update(undefined, undefined, null, 'offline');
    }
  }

  d.add(bridge.onEvent('networkChanged', () => refreshNetwork()));

  return {
    el,
    outlet,
    get network() {
      return currentNetwork;
    },
    /**
     * Hide chrome on screens that own the whole viewport (unlock, onboarding).
     * On dashboard, topbar is hidden because the 196px ink header owns the top.
     */
    setChromeVisible(visible, path) {
      const onDash = isDashboardPath(path);
      topbar.classList.toggle('hidden', !visible || onDash);
      connectionFooter.el.classList.toggle('hidden', !visible);
    },
    refreshNetwork,
    destroy() {
      connectionFooter.destroy();
      d.dispose();
      el.remove();
    },
  };
}
