// Receive screen module — shows QR code and address for receiving THRU.
//
// Reads activeAccount from the store, renders QR and copy functionality.
// No security-sensitive operations.

import { walletStore } from '../../ui/store.js';
import { icons } from '../icons.js';
import { renderQR } from '../qr.js';
import { showToast } from '../toast.js';
import { explorerAddressUrl } from '../../lib/networks.js';

/** @type {Array<function>} */
let _unsubs = [];

/**
 * Mount the receive screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  const state = walletStore.getState();
  const account = state.activeAccount;
  const network = state.activeNetwork;
  const address = account?.address || '—';
  const explorerUrl = account ? explorerAddressUrl(network, address) : '#';

  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-dashboard" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Receive</h1>
      <span class="subheader-spacer"></span>
    </div>
    <div class="qr-container">
      <canvas id="receive-qr" width="200" height="200"></canvas>
    </div>
    <p class="muted center">Scan or copy this address to receive THRU on alphanet.</p>
    <div class="monospace-block" id="receive-address-display">${address}</div>
    <button class="btn secondary" id="receive-copy-btn">Copy address</button>
    <a class="btn secondary link-btn" id="receive-explorer-link" href="${explorerUrl}" target="_blank" rel="noopener">View on explorer</a>
  `;

  // Render QR code
  const canvas = container.querySelector('#receive-qr');
  if (canvas && account) {
    renderQR(canvas, address);
  }

  // Copy handler
  const copyBtn = container.querySelector('#receive-copy-btn');
  const handleCopy = async () => {
    if (account) {
      await navigator.clipboard.writeText(address);
      showToast('Address copied', 'info');
    }
  };
  copyBtn?.addEventListener('click', handleCopy);

  _unsubs.push(() => copyBtn?.removeEventListener('click', handleCopy));
}

/**
 * Cleanup the receive screen.
 */
export function cleanup() {
  for (const unsub of _unsubs) {
    try { unsub(); } catch { /* ignore */ }
  }
  _unsubs = [];
}
