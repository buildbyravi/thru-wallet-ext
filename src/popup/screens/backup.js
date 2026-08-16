// Backup screen module — presents the 12-word recovery phrase for confirmation.
//
// Shows numbered 12-word grid, copy helper, confirmation check.
// On continue: navigates to dashboard.
// Security: wipes mnemonic DOM and memory on unmount.

import { router } from '../../ui/router.js';
import { icons } from '../icons.js';
import { showToast } from '../toast.js';

/** @type {Array<function>} */
let _unsubs = [];
let _activeMnemonic = null;

/**
 * Mount the backup screen.
 * @param {HTMLElement} container
 * @param {Object} [params]
 * @param {string} [params.mnemonic]
 */
export function mount(container, params = {}) {
  _activeMnemonic = params.mnemonic || '';

  container.innerHTML = `
    <div class="subheader">
      <span class="subheader-spacer"></span>
      <h1>Secret Recovery Phrase</h1>
      <span class="subheader-spacer"></span>
    </div>

    <div class="security-warning-card my-2">
      <span class="security-card-icon">${icons.shield(18)}</span>
      <div class="security-card-text">
        <strong>Never share these 12 words</strong>
        <span>Anyone with this phrase can access all derived accounts and steal your funds.</span>
      </div>
    </div>

    <div class="mnemonic-grid" id="mnemonic-grid">
      <!-- Words rendered here -->
    </div>

    <button type="button" class="btn secondary w-100 mt-2" id="backup-copy-btn">
      ${icons.copy(14)} Copy Phrase
    </button>

    <label class="checkbox-field mt-3">
      <input type="checkbox" id="backup-confirmed" />
      <span>I've written down and safely stored my recovery phrase</span>
    </label>

    <button type="button" class="btn primary w-100 mt-3" id="backup-continue" disabled>
      Continue to Wallet
    </button>
  `;

  const gridEl = container.querySelector('#mnemonic-grid');
  const copyBtn = container.querySelector('#backup-copy-btn');
  const confirmCheck = container.querySelector('#backup-confirmed');
  const continueBtn = container.querySelector('#backup-continue');

  // Render 12-word grid
  if (_activeMnemonic && gridEl) {
    gridEl.innerHTML = '';
    _activeMnemonic.split(' ').forEach((word, i) => {
      const span = document.createElement('span');
      span.innerHTML = `${i + 1}. <b>${word}</b>`;
      gridEl.appendChild(span);
    });
  }

  // Copy phrase
  const handleCopy = async () => {
    if (_activeMnemonic) {
      await navigator.clipboard.writeText(_activeMnemonic);
      showToast('Recovery phrase copied to clipboard', 'info');
    }
  };
  copyBtn?.addEventListener('click', handleCopy);

  // Checkbox toggle
  const handleCheck = (e) => {
    if (continueBtn) {
      continueBtn.disabled = !e.target.checked;
    }
  };
  confirmCheck?.addEventListener('change', handleCheck);

  // Continue to dashboard
  const handleContinue = () => {
    _activeMnemonic = null;
    if (gridEl) gridEl.innerHTML = '';
    router.navigate('dashboard');
  };
  continueBtn?.addEventListener('click', handleContinue);

  _unsubs.push(
    () => copyBtn?.removeEventListener('click', handleCopy),
    () => confirmCheck?.removeEventListener('change', handleCheck),
    () => continueBtn?.removeEventListener('click', handleContinue),
  );
}

/**
 * Cleanup backup screen.
 */
export function cleanup() {
  _activeMnemonic = null;
  const grid = document.getElementById('mnemonic-grid');
  if (grid) grid.innerHTML = '';
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
