// Import wallet screen module — supports 12-word mnemonic phrase OR 32-byte private key (hex).
//
// Encrypts the imported credentials under a new password on this device.
// On success: updates store, emits WALLET_IMPORTED, navigates to dashboard.
// Security: sensitive inputs cleared on unmount.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { events, Events } from '../../ui/events.js';
import { router } from '../../ui/router.js';
import { icons } from '../icons.js';

/** @type {Array<function>} */
let _unsubs = [];
let _importMode = 'mnemonic'; // 'mnemonic' | 'privatekey'

/**
 * Mount the import screen.
 * @param {HTMLElement} container
 * @param {Object} [params]
 * @param {string} [params.mode='mnemonic']
 */
export function mount(container, params = {}) {
  _importMode = params.mode === 'privatekey' ? 'privatekey' : 'mnemonic';

  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-welcome" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Import Wallet</h1>
      <span class="subheader-spacer"></span>
    </div>

    <div class="tab-row mb-3">
      <button type="button" class="tab-btn ${_importMode === 'mnemonic' ? 'active' : ''}" id="import-tab-mnemonic">Recovery Phrase</button>
      <button type="button" class="tab-btn ${_importMode === 'privatekey' ? 'active' : ''}" id="import-tab-pk">Private Key</button>
    </div>

    <form id="import-form" onsubmit="return false;">
      <div id="import-mnemonic-section" class="${_importMode === 'mnemonic' ? '' : 'hidden'}">
        <p class="muted">Enter your 12-word recovery phrase, separated by single spaces.</p>
        <textarea class="textarea-lg" id="import-mnemonic" rows="4" placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12" autocomplete="off" spellcheck="false"></textarea>
      </div>

      <div id="import-pk-section" class="${_importMode === 'privatekey' ? '' : 'hidden'}">
        <p class="muted">Paste your 32-byte private key as hex (64 hex characters).</p>
        <textarea class="textarea-lg mono" id="import-privatekey" rows="4" placeholder="e.g. 3f1c9a7b2e4d... (64 hex characters)" autocomplete="off" spellcheck="false"></textarea>
      </div>

      <label class="field mt-3">
        <span>New Password for this Device</span>
        <input type="password" id="import-password" autocomplete="new-password" minlength="8" placeholder="Minimum 8 characters" />
      </label>

      <p class="error hidden" id="import-error"></p>

      <button type="submit" class="btn primary w-100 mt-4" id="import-submit-btn">Import Wallet</button>
      <button type="button" class="btn text w-100 mt-2" data-action="go-welcome">Cancel</button>
    </form>
  `;

  const form = container.querySelector('#import-form');
  const tabMnemonic = container.querySelector('#import-tab-mnemonic');
  const tabPk = container.querySelector('#import-tab-pk');
  const mnemonicSection = container.querySelector('#import-mnemonic-section');
  const pkSection = container.querySelector('#import-pk-section');
  const mnemonicInput = container.querySelector('#import-mnemonic');
  const pkInput = container.querySelector('#import-privatekey');
  const pwInput = container.querySelector('#import-password');
  const errorEl = container.querySelector('#import-error');
  const submitBtn = container.querySelector('#import-submit-btn');

  const setMode = (mode) => {
    _importMode = mode;
    tabMnemonic?.classList.toggle('active', mode === 'mnemonic');
    tabPk?.classList.toggle('active', mode === 'privatekey');
    mnemonicSection?.classList.toggle('hidden', mode !== 'mnemonic');
    pkSection?.classList.toggle('hidden', mode !== 'privatekey');
    setError(errorEl, '');
    if (mode === 'mnemonic') mnemonicInput?.focus();
    else pkInput?.focus();
  };

  tabMnemonic?.addEventListener('click', () => setMode('mnemonic'));
  tabPk?.addEventListener('click', () => setMode('privatekey'));

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const pw = pwInput?.value || '';
    if (pw.length < 8) {
      setError(errorEl, 'Use at least 8 characters for password.');
      pwInput?.focus();
      return;
    }

    setError(errorEl, '');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing…';

    try {
      if (_importMode === 'privatekey') {
        const pkHex = (pkInput?.value || '').trim();
        if (!pkHex) {
          setError(errorEl, 'Please enter a private key hex string.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Import Wallet';
          return;
        }
        await bridge.send('wallet.importPrivateKey', { privateKeyHex: pkHex, password: pw });
      } else {
        const mnemonic = (mnemonicInput?.value || '').trim();
        if (!mnemonic) {
          setError(errorEl, 'Please enter your 12-word recovery phrase.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Import Wallet';
          return;
        }
        await bridge.send('wallet.importMnemonic', { mnemonic, password: pw });
      }

      if (mnemonicInput) mnemonicInput.value = '';
      if (pkInput) pkInput.value = '';
      if (pwInput) pwInput.value = '';

      walletStore.setState({ hasVault: true, isUnlocked: true });
      events.emit(Events.WALLET_IMPORTED);
      router.navigate('dashboard');
    } catch (err) {
      setError(errorEl, err.message || 'Import failed.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Import Wallet';
    }
  };

  form?.addEventListener('submit', handleSubmit);

  _unsubs.push(
    () => tabMnemonic?.removeEventListener('click', () => setMode('mnemonic')),
    () => tabPk?.removeEventListener('click', () => setMode('privatekey')),
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
 * Cleanup import screen.
 */
export function cleanup() {
  const m = document.getElementById('import-mnemonic');
  const pk = document.getElementById('import-privatekey');
  const pw = document.getElementById('import-password');
  if (m) m.value = '';
  if (pk) pk.value = '';
  if (pw) pw.value = '';
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
