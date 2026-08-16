// Create password screen module — first step of new wallet creation.
//
// Prompts for master password (min 8 chars), confirms match, calls bridge.send('wallet.create').
// On success: passes mnemonic to backup screen via router params.
// Security: sensitive passwords cleared immediately on navigation.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons } from '../icons.js';

/** @type {Array<function>} */
let _unsubs = [];

/**
 * Mount the create-password screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-welcome" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Set Password</h1>
      <span class="subheader-spacer"></span>
    </div>

    <p class="muted">
      This password encrypts your keys locally on this device. If you lose it, your 12-word recovery phrase is the only way to restore access.
    </p>

    <form id="create-pw-form" onsubmit="return false;" class="mt-3">
      <label class="field">
        <span>Password</span>
        <input type="password" id="create-password" autocomplete="new-password" minlength="8" placeholder="Minimum 8 characters" autofocus />
      </label>

      <label class="field mt-3">
        <span>Confirm Password</span>
        <input type="password" id="create-password-confirm" autocomplete="new-password" minlength="8" placeholder="Re-enter password" />
      </label>

      <p class="error hidden" id="create-error"></p>

      <button type="submit" class="btn primary w-100 mt-4" id="create-pw-submit-btn">Create Wallet</button>
      <button type="button" class="btn text w-100 mt-2" data-action="go-welcome">Cancel</button>
    </form>
  `;

  const form = container.querySelector('#create-pw-form');
  const pwInput = container.querySelector('#create-password');
  const pw2Input = container.querySelector('#create-password-confirm');
  const errorEl = container.querySelector('#create-error');
  const submitBtn = container.querySelector('#create-pw-submit-btn');

  setTimeout(() => pwInput?.focus(), 50);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const pw = pwInput?.value || '';
    const pw2 = pw2Input?.value || '';

    if (pw.length < 8) {
      setError(errorEl, 'Use at least 8 characters.');
      pwInput?.focus();
      return;
    }
    if (pw !== pw2) {
      setError(errorEl, "Passwords don't match.");
      pw2Input?.focus();
      return;
    }

    setError(errorEl, '');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating keys…';

    try {
      const result = await bridge.send('wallet.create', { password: pw });
      if (pwInput) pwInput.value = '';
      if (pw2Input) pw2Input.value = '';

      walletStore.setState({ hasVault: true, isUnlocked: true });
      events.emit(Events.WALLET_CREATED);

      // Navigate to backup screen passing mnemonic
      router.navigate('backup', { mnemonic: result.mnemonic });
    } catch (err) {
      setError(errorEl, err.message || 'Failed to create wallet.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Wallet';
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
 * Cleanup create-password screen.
 */
export function cleanup() {
  const pw1 = document.getElementById('create-password');
  const pw2 = document.getElementById('create-password-confirm');
  if (pw1) pw1.value = '';
  if (pw2) pw2.value = '';
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
