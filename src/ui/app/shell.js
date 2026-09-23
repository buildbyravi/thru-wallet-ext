// App shell: the persistent chrome around every route.
//
// The shell owns that chrome once, so no route has to remember it and every route gets it
// for free. Every screen the shell wraps owns its own header — the dashboard's 196px
// Rabby-style ink header, and a PageHeader (with a Back button) on every sub-screen — so
// the shell topbar with the wordmark is hidden on all of them: on the dashboard it would
// duplicate the ink header, and on sub-screens it used to stack a second header above
// each screen's PageHeader. It stays in the shell as chrome of last resort for a future
// route that has no header of its own.
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

  // Hidden from first paint: no current screen can show it (see file header). A future
  // header-less route opts in by toggling the class off in setChromeVisible.
  const topbar = h('header', { class: ['topbar', 'hidden'] }, [
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
      connectionFooter.update({ network: label });

      networkBadge.textContent = label;
      networkBadge.classList.toggle('badge-live', network?.isTestnet === false);
      networkBadge.title = network?.isTestnet === false
        ? 'Live network — transactions move real funds'
        : 'Test network';

      currentNetwork = network;
      onNetworkChange?.(network);
    } catch {
      connectionFooter.update({ network: '—', healthStatus: 'offline' });
      networkBadge.textContent = '—';
    }
    try {
      const health = await bridge.send('tx.checkHealth');
      const ms = Number(health?.latencyMs);
      const online = health?.status === 'ok' || health?.healthy === true || Number.isFinite(ms);
      if (!online) {
        connectionFooter.update({ healthStatus: 'offline' });
      } else {
        connectionFooter.update({
          latencyMs: Number.isFinite(ms) ? ms : null,
          healthStatus: ms > 800 ? 'slow' : 'healthy',
        });
      }
    } catch {
      connectionFooter.update({ healthStatus: 'offline' });
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
     * The topbar is hidden on every screen — the dashboard's 196px ink header and
     * each sub-screen's PageHeader both already own the top, so the shell topbar
     * would be a duplicate header (it stays in the shell only as chrome for a
     * future header-less route). The connection footer is the MIRROR rule: it
     * belongs to the dashboard only. Sub-screens (send, receive, history,
     * settings, accounts) keep their own headers and bottom actions, and the
     * pinned 40px footer used to crowd the viewport and block those controls,
     * so it stays hidden there.
     */
    setChromeVisible(visible, path) {
      topbar.classList.add('hidden');
      connectionFooter.el.classList.toggle('hidden', !visible || !isDashboardPath(path));
    },
    refreshNetwork,
    destroy() {
      connectionFooter.destroy();
      d.dispose();
      el.remove();
    },
  };
}
