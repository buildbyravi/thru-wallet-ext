// Rename account screen module — update nickname / label for any account.
//
// Calls bridge.send('account.setLabel', { address, label }).
// On success: emits ACCOUNT_RENAMED, shows toast, navigates back.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons } from '../icons.js';
import { showToast } from '../toast.js';

/** @type {Array<function>} */
let _unsubs = [];
let _targetAddress = null;

/**
 * Mount the rename-account screen.
 * @param {HTMLElement} container
 * @param {Object} [params]
 * @param {string} [params.address]
 * @param {string} [params.name]
 */
export function mount(container, params = {}) {
  _targetAddress = params.address || walletStore.getState().activeAccount?.address || '';
  const currentName = params.name || walletStore.getState().activeAccount?.label || '';

  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-dashboard" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Rename Account</h1>
      <span class="subheader-spacer"></span>
    </div>

    <div class="monospace-block my-2" id="rename-address-display">${_targetAddress}</div>

    <form id="rename-form" class="mt-3">
      <label class="field">
        <span>Account Nickname</span>
        <input type="text" id="rename-input" value="${currentName}" placeholder="e.g. Primary Savings" maxlength="32" autocomplete="off" autofocus />
      </label>

      <p class="error hidden" id="rename-error"></p>

      <button type="submit" class="btn primary w-100 mt-4" id="rename-save-btn">Save Name</button>
      <button type="button" class="btn text w-100 mt-2" data-action="go-dashboard">Cancel</button>
    </form>
  `;

  const form = container.querySelector('#rename-form');
  const input = container.querySelector('#rename-input');
  const errorEl = container.querySelector('#rename-error');
  const saveBtn = container.querySelector('#rename-save-btn');

  setTimeout(() => {
    input?.focus();
    input?.select();
  }, 50);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const newName = (input?.value || '').trim();
    if (!_targetAddress) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      await bridge.send('account.setLabel', { address: _targetAddress, label: newName });
      showToast('Account renamed', 'success');

      // Update active account if it was the renamed one
      const active = walletStore.getState().activeAccount;
      if (active && active.address.toLowerCase() === _targetAddress.toLowerCase()) {
        walletStore.setState({ activeAccount: { ...active, label: newName } });
      }

      events.emit(Events.ACCOUNT_RENAMED, { address: _targetAddress, label: newName });
      router.navigate('dashboard');
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message || 'Failed to rename account.';
        errorEl.classList.remove('hidden');
      }
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Name';
    }
  };

  form?.addEventListener('submit', handleSubmit);
  _unsubs.push(() => form?.removeEventListener('submit', handleSubmit));
}

/**
 * Cleanup rename-account screen.
 */
export function cleanup() {
  _targetAddress = null;
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
