// Add Key screen module — import an additional private key into an existing vault.
//
// Calls bridge.send('account.addImported', { privateKeyHex }).
// On success: emits ACCOUNT_IMPORTED, navigates back or to dashboard.
// Security: private key hex cleared on unmount.

import * as bridge from '../../ui/bridge.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons } from '../icons.js';
import { showToast } from '../toast.js';

/** @type {Array<function>} */
let _unsubs = [];

/**
 * Mount the add-key screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-dashboard" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Import Private Key</h1>
      <span class="subheader-spacer"></span>
    </div>

    <p class="muted">
      Paste a 32-byte private key as hex (64 characters). It will be added as an independent account in this wallet.
    </p>

    <form id="add-key-form" onsubmit="return false;" class="mt-3">
      <label class="field">
        <span>Private Key (Hex)</span>
        <textarea class="textarea-lg mono" id="add-key-input" rows="4" placeholder="e.g. 3f1c9a7b2e4d... (64 hex characters)" autocomplete="off" spellcheck="false" autofocus></textarea>
      </label>

      <p class="error hidden" id="add-key-error"></p>

      <button type="submit" class="btn primary w-100 mt-4" id="add-key-submit-btn">Import Key</button>
      <button type="button" class="btn text w-100 mt-2" data-action="go-dashboard">Cancel</button>
    </form>
  `;

  const form = container.querySelector('#add-key-form');
  const input = container.querySelector('#add-key-input');
  const errorEl = container.querySelector('#add-key-error');
  const submitBtn = container.querySelector('#add-key-submit-btn');

  setTimeout(() => input?.focus(), 50);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const hex = (input?.value || '').trim();
    if (!hex) {
      setError(errorEl, 'Please enter a private key hex string.');
      input?.focus();
      return;
    }

    setError(errorEl, '');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing…';

    try {
      const newAccount = await bridge.send('account.addImported', { privateKeyHex: hex });
      if (input) input.value = '';
      showToast(`Imported ${newAccount.label || 'account'}`, 'success');
      events.emit(Events.ACCOUNT_IMPORTED, newAccount);
      router.navigate('dashboard');
    } catch (err) {
      setError(errorEl, err.message || 'Failed to import private key.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Import Key';
    }
  };

  form?.addEventListener('submit', handleSubmit);
  _unsubs.push(() => form?.removeEventListener('submit', handleSubmit));
}

function setError(el, message) {
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = message;
  }
}

/**
 * Cleanup add-key screen.
 */
export function cleanup() {
  const input = document.getElementById('add-key-input');
  if (input) input.value = '';
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
