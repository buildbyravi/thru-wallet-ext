// Export reveal screen module — displays revealed mnemonic or private key securely.
//
// Shows 12-word grid (for HD seed) or monospace hex block (for imported key).
// Provides copy button with clipboard toast.
// Security: wipes secret from memory and DOM on unmount.

import { router } from '../../ui/router.js';
import { icons } from '../icons.js';
import { showToast } from '../toast.js';

/** @type {Array<function>} */
let _unsubs = [];
let _activeSecret = null;

/**
 * Mount the export-reveal screen.
 * @param {HTMLElement} container
 * @param {Object} [params]
 * @param {Object} [params.secret]
 */
export function mount(container, params = {}) {
  _activeSecret = params.secret || null;

  const isHd = _activeSecret?.kind === 'hd';
  const title = isHd ? 'Recovery Phrase' : 'Private Key';
  const warning = isHd
    ? 'This recovery phrase controls every account derived from this seed. Anyone with these words can access all of them.'
    : 'This private key controls only this single imported account. Anyone with this key can access all of its funds.';

  container.innerHTML = `
    <div class="subheader">
      <span class="subheader-spacer"></span>
      <h1>${title}</h1>
      <span class="subheader-spacer"></span>
    </div>

    <div class="danger-box my-2">
      <div class="danger-box-icon">${icons.warning(18)}</div>
      <p class="danger-text">${warning}</p>
    </div>

    ${isHd ? `
      <div class="mnemonic-grid my-3" id="export-mnemonic-grid"></div>
    ` : `
      <div class="monospace-block my-3" id="export-pk-display">${_activeSecret?.privateKeyHex || '—'}</div>
    `}

    <button type="button" class="btn secondary w-100 mt-2" id="export-copy-btn">
      ${icons.copy(14)} Copy ${title}
    </button>

    <button type="button" class="btn primary w-100 mt-3" id="export-done-btn">
      Done
    </button>
  `;

  const copyBtn = container.querySelector('#export-copy-btn');
  const doneBtn = container.querySelector('#export-done-btn');
  const gridEl = container.querySelector('#export-mnemonic-grid');

  if (isHd && _activeSecret?.mnemonic && gridEl) {
    gridEl.innerHTML = '';
    _activeSecret.mnemonic.split(' ').forEach((word, i) => {
      const span = document.createElement('span');
      span.innerHTML = `${i + 1}. <b>${word}</b>`;
      gridEl.appendChild(span);
    });
  }

  const handleCopy = async () => {
    if (!_activeSecret) return;
    const textToCopy = isHd ? _activeSecret.mnemonic : _activeSecret.privateKeyHex;
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      showToast(`${title} copied to clipboard`, 'info');
    }
  };
  copyBtn?.addEventListener('click', handleCopy);

  const handleDone = () => {
    cleanup();
    router.navigate('dashboard');
  };
  doneBtn?.addEventListener('click', handleDone);

  _unsubs.push(
    () => copyBtn?.removeEventListener('click', handleCopy),
    () => doneBtn?.removeEventListener('click', handleDone),
  );
}

/**
 * Cleanup export-reveal screen.
 */
export function cleanup() {
  _activeSecret = null;
  const grid = document.getElementById('export-mnemonic-grid');
  const pkBox = document.getElementById('export-pk-display');
  if (grid) grid.innerHTML = '';
  if (pkBox) pkBox.textContent = '';
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
