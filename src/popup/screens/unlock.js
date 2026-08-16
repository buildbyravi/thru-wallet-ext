// Unlock screen module — password prompt for existing locked vault.
//
// Authenticates password against encrypted vault via bridge.
// On success: updates store, emits WALLET_UNLOCKED, navigates to dashboard.
// Security: cleans up password field on unmount, never persists raw password.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons } from '../icons.js';

/** @type {Array<function>} */
let _unsubs = [];

/**
 * Mount the unlock screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  container.innerHTML = `
    <div class="unlock-container">
      <div class="unlock-brand">
        <div class="unlock-icon-wrap">${icons.lock(28)}</div>
        <h1>Welcome Back</h1>
        <p class="muted">Enter your password to unlock your Thru Wallet.</p>
      </div>

      <form id="unlock-form" class="unlock-form">
        <label class="field">
          <span>Password</span>
          <div class="password-input-wrap">
            <input type="password" id="unlock-password" autocomplete="current-password" placeholder="Enter password" autofocus />
            <button type="button" class="icon-btn-ghost password-toggle" id="unlock-toggle-pw" title="Show/hide password">
              ${icons.eye(16)}
            </button>
          </div>
        </label>
        <p class="error hidden" id="unlock-error"></p>

        <button type="submit" class="btn primary w-100" id="unlock-btn">Unlock</button>
        <button type="button" class="btn text danger w-100 mt-2" data-action="go-reset-confirm">Reset wallet on this device</button>
      </form>
    </div>
  `;

  const form = container.querySelector('#unlock-form');
  const pwInput = container.querySelector('#unlock-password');
  const toggleBtn = container.querySelector('#unlock-toggle-pw');
  const errorEl = container.querySelector('#unlock-error');
  const unlockBtn = container.querySelector('#unlock-btn');

  // Focus input
  setTimeout(() => pwInput?.focus(), 50);

  // Toggle password visibility
  const handleTogglePw = () => {
    if (!pwInput) return;
    const isPw = pwInput.type === 'password';
    pwInput.type = isPw ? 'text' : 'password';
    if (toggleBtn) {
      toggleBtn.innerHTML = isPw ? icons.eyeOff(16) : icons.eye(16);
    }
  };
  toggleBtn?.addEventListener('click', handleTogglePw);

  // Submit unlock
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const pw = pwInput?.value || '';
    if (!pw) {
      setError(errorEl, 'Please enter your password.');
      return;
    }

    setError(errorEl, '');
    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Unlocking…';

    try {
      await bridge.send('wallet.unlock', { password: pw });
      if (pwInput) pwInput.value = '';
      walletStore.setState({ isUnlocked: true });
      events.emit(Events.WALLET_UNLOCKED);
      router.navigate('dashboard');
    } catch (err) {
      setError(errorEl, err.message || 'Incorrect password.');
      if (pwInput) {
        pwInput.value = '';
        pwInput.focus();
      }
    } finally {
      unlockBtn.disabled = false;
      unlockBtn.textContent = 'Unlock';
    }
  };

  form?.addEventListener('submit', handleSubmit);

  _unsubs.push(
    () => toggleBtn?.removeEventListener('click', handleTogglePw),
    () => form?.removeEventListener('submit', handleSubmit),
  );
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
 * Cleanup the unlock screen.
 */
export function cleanup() {
  const pwInput = document.getElementById('unlock-password');
  if (pwInput) pwInput.value = '';
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
