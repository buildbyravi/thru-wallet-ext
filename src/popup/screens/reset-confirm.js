// Reset confirmation screen module.
//
// Warns the user that local storage will be wiped.
// On confirm: calls bridge.send('wallet.reset'), clears state & history, emits WALLET_RESET, navigates to welcome.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons } from '../icons.js';
import { showToast } from '../toast.js';

/** @type {Array<function>} */
let _unsubs = [];

/**
 * Mount the reset confirmation screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-unlock" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Reset Wallet</h1>
      <span class="subheader-spacer"></span>
    </div>

    <div class="danger-box my-3">
      <div class="danger-box-icon">${icons.warning(24)}</div>
      <h2>Reset this device?</h2>
      <p class="muted">
        This removes the encrypted vault and keys from this browser extension.
        It does <strong>not</strong> touch any on-chain assets.
      </p>
      <p class="danger-text mt-2">
        Only proceed if you have your 12-word recovery phrase or private keys safely backed up elsewhere.
      </p>
    </div>

    <button type="button" class="btn danger w-100" id="reset-confirm-btn">Yes, Reset This Wallet</button>
    <button type="button" class="btn text w-100 mt-2" data-action="go-unlock">Cancel</button>
  `;

  const confirmBtn = container.querySelector('#reset-confirm-btn');
  const handleConfirm = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Resetting…';

    try {
      await bridge.send('wallet.reset');
      walletStore.setState({
        hasVault: false,
        isUnlocked: false,
        activeAccount: null,
        activeRef: null,
        accounts: [],
        hasSeed: false,
        balance: '0',
        balanceRaw: '0',
        history: [],
      });
      events.emit(Events.WALLET_RESET);
      router.clearHistory();
      showToast('Wallet reset complete', 'info');
      router.navigate('welcome');
    } catch (err) {
      showToast(`Reset failed: ${err.message}`, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Yes, Reset This Wallet';
    }
  };

  confirmBtn?.addEventListener('click', handleConfirm);
  _unsubs.push(() => confirmBtn?.removeEventListener('click', handleConfirm));
}

/**
 * Cleanup the reset confirmation screen.
 */
export function cleanup() {
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
