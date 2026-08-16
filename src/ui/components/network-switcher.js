// Rabby-style Network Switcher Drawer Component.

import { Drawer } from './drawer.js';
import { icons } from '../../popup/icons.js';
import * as bridge from '../bridge.js';
import { showToast } from '../../popup/toast.js';

/**
 * Open the Network Switcher Drawer.
 * @param {Object} options
 * @param {function(Object): void} options.onNetworkSwitched - Callback when switched
 */
export async function openNetworkSwitcher({ onNetworkSwitched }) {
  const networks = await bridge.send('network.list');
  const activeConfig = await bridge.send('network.getActive');

  const contentHtml = `
    <div class="network-drawer-content">
      <p class="drawer-desc mb-3">Select the active blockchain network for RPC transactions and block explorer links.</p>
      <div class="network-drawer-list" id="drawer-network-list">
        ${networks.map((net) => {
          const isActive = net.id === activeConfig.id;
          return `
            <div class="network-drawer-item ${isActive ? 'active' : ''}" data-id="${net.id}">
              <div class="network-item-left">
                <span class="status-dot ${isActive ? 'healthy' : 'muted'}"></span>
                <div class="network-item-info">
                  <span class="network-item-name">${net.label}</span>
                  <span class="network-item-url mono">${net.rpcUrl}</span>
                </div>
              </div>
              <div class="network-item-right">
                ${net.isTestnet ? '<span class="tag-subtle">Testnet</span>' : '<span class="tag-accent">Mainnet</span>'}
                ${isActive ? `<span class="active-check-icon">${icons.check(16)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  Drawer.open({
    title: 'Switch Network',
    contentHtml,
    onMount: (bodyEl, closeDrawer) => {
      const list = bodyEl.querySelector('#drawer-network-list');
      list?.addEventListener('click', async (e) => {
        const item = e.target.closest('.network-drawer-item');
        if (!item) return;
        const networkId = item.dataset.id;
        try {
          const newConfig = await bridge.send('network.setActive', { networkId });
          showToast(`Switched to ${newConfig.label}`, 'info');
          closeDrawer();
          if (typeof onNetworkSwitched === 'function') {
            onNetworkSwitched(newConfig);
          }
        } catch (err) {
          showToast(`Could not switch network: ${err.message}`, 'error');
        }
      });
    },
  });
}
