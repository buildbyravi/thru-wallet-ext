// Export password screen module — re-authenticates password before revealing sensitive secrets.
//
// Calls bridge.send('wallet.exportSecret', { ref, password }).
// On success: navigates to export-reveal screen passing the secret in router params.
// Security: password cleared immediately on submit or navigation.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { router } from '../../ui/router.js';
import { icons } from '../icons.js';

/** @type {Array<function>} */
let _unsubs = [];
let _targetRef = null;

/**
 * Mount the export-password screen.
 * @param {HTMLElement} container
 * @param {Object} [params]
 * @param {Object} [params.ref] - Account ref to export (defaults to active account)
 */
export async function mount(container, params = {}) {
  try {
    _targetRef = params.ref || (await bridge.send('account.getActiveRef'));
  } catch {
    _targetRef = null;
  }

  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-dashboard" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Confirm Password</h1>
      <span class="subheader-spacer"></span>
    </div>

    <div class="security-warning-card my-3">
      <span class="security-card-icon">${icons.warning(18)}</span>
      <div class="security-card-text">
        <strong>Exporting Account Secret</strong>
        <span>Re-enter your master password to reveal your recovery phrase or private key.</span>
      </div>
    </div>

    <form id="export-pw-form">
      <label class="field">
        <span>Password</span>
        <input type="password" id="export-password" autocomplete="current-password" placeholder="Enter master password" autofocus />
      </label>

      <p class="error hidden" id="export-password-error"></p>

      <button type="submit" class="btn primary w-100 mt-4" id="export-pw-submit-btn">Reveal Secret</button>
      <button type="button" class="btn text w-100 mt-2" data-action="go-dashboard">Cancel</button>
    </form>
  `;

  const form = container.querySelector('#export-pw-form');
  const pwInput = container.querySelector('#export-password');
  const errorEl = container.querySelector('#export-password-error');
  const submitBtn = container.querySelector('#export-pw-submit-btn');

  setTimeout(() => pwInput?.focus(), 50);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const pw = pwInput?.value || '';
    if (!pw) {
      setError(errorEl, 'Please enter your password.');
      pwInput?.focus();
      return;
    }

    setError(errorEl, '');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying…';

    try {
      const secret = await bridge.send('wallet.exportSecret', {
        ref: _targetRef,
        password: pw,
      });

      if (pwInput) pwInput.value = '';
      // Navigate to reveal screen with secret
      router.navigate('export-reveal', { secret });
    } catch (err) {
      setError(errorEl, err.message || 'Incorrect password.');
      if (pwInput) {
        pwInput.value = '';
        pwInput.focus();
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reveal Secret';
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
 * Cleanup export-password screen.
 */
export function cleanup() {
  const pw = document.getElementById('export-password');
  if (pw) pw.value = '';
  _targetRef = null;
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
