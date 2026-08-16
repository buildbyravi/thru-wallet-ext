// Account Detail screen module (Spec §10).
//
// Shows complete metadata for a single account: identicon, nickname, full address,
// derivation path / keyring type, on-chain balance, explorer link, and actions (Rename, Export).

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { router } from '../../ui/router.js';
import { icons, byteMarkHtml } from '../icons.js';
import { showToast } from '../toast.js';
import { formatThru, truncateAddress } from '../../shared/format.js';
import { explorerAddressUrl } from '../../lib/networks.js';
import { getAccountTypeBadge, getDerivationPath } from '../../domain/wallet-model.js';

/** @type {Array<function>} */
let _unsubs = [];
let _currentAccount = null;

/**
 * Mount the account detail screen.
 * @param {HTMLElement} container
 * @param {Object} [params]
 * @param {Object} [params.account]
 */
export async function mount(container, params = {}) {
  _currentAccount = params.account || walletStore.getState().activeAccount;

  if (!_currentAccount) {
    try {
      _currentAccount = await bridge.send('account.getActive');
    } catch {}
  }

  const network = walletStore.getState().activeNetwork;
  const address = _currentAccount?.address || '—';
  const label = _currentAccount?.label || 'Account';
  const badge = getAccountTypeBadge(_currentAccount);
  const derivPath = getDerivationPath(_currentAccount);
  const explorerUrl = _currentAccount ? explorerAddressUrl(network, address) : '#';

  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-dashboard" data-icon="back" title="Back">${icons.back()}</button>
      <h1>Account Details</h1>
      <span class="subheader-spacer"></span>
    </div>

    <div class="account-detail-hero my-3">
      <div class="account-detail-avatar">
        ${byteMarkHtml(address, _currentAccount?.ref)}
      </div>
      <h2 class="account-detail-name">${label}</h2>
      <div class="account-badge-pill">${badge}${derivPath ? ` • ${derivPath}` : ''}</div>
    </div>

    <div class="account-detail-card">
      <div class="account-detail-row">
        <span class="detail-label">Address</span>
        <div class="detail-val-copy">
          <span class="mono detail-address">${address}</span>
          <button type="button" class="icon-btn-ghost sm" id="detail-copy-addr-btn" title="Copy Address">
            ${icons.copy(14)}
          </button>
        </div>
      </div>

      <div class="account-detail-row">
        <span class="detail-label">Network</span>
        <span class="detail-val">${network.label || 'Alphanet'}</span>
      </div>

      <div class="account-detail-row">
        <span class="detail-label">Balance</span>
        <span class="detail-val mono" id="detail-balance-val">Loading…</span>
      </div>
    </div>

    <div class="account-detail-actions mt-3">
      <a class="btn secondary link-btn w-100 mb-2" href="${explorerUrl}" target="_blank" rel="noopener">
        ${icons.external(14)} View on Explorer
      </a>
      <button type="button" class="btn secondary w-100 mb-2" id="detail-rename-btn">
        ${icons.edit(14)} Rename Account
      </button>
      <button type="button" class="btn text danger w-100" id="detail-export-btn">
        ${icons.lock(14)} Export Private Key / Phrase
      </button>
    </div>
  `;

  // Fetch balance for this account
  const balanceValEl = container.querySelector('#detail-balance-val');
  if (_currentAccount && balanceValEl) {
    try {
      const info = await bridge.send('tx.getAccountInfo', { address: _currentAccount.address });
      if (info.exists) {
        const rawUnits = BigInt(info.balance);
        balanceValEl.textContent = `${formatThru(rawUnits)} THRU`;
      } else {
        balanceValEl.textContent = '0 THRU (unfunded)';
      }
    } catch {
      balanceValEl.textContent = '0 THRU';
    }
  }

  // Copy address
  const copyBtn = container.querySelector('#detail-copy-addr-btn');
  const handleCopy = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      showToast('Address copied', 'info');
    }
  };
  copyBtn?.addEventListener('click', handleCopy);

  // Rename button
  const renameBtn = container.querySelector('#detail-rename-btn');
  const handleRename = () => {
    router.navigate('rename-account', { address, name: label });
  };
  renameBtn?.addEventListener('click', handleRename);

  // Export button
  const exportBtn = container.querySelector('#detail-export-btn');
  const handleExport = () => {
    router.navigate('export-password', { ref: _currentAccount?.ref });
  };
  exportBtn?.addEventListener('click', handleExport);

  _unsubs.push(
    () => copyBtn?.removeEventListener('click', handleCopy),
    () => renameBtn?.removeEventListener('click', handleRename),
    () => exportBtn?.removeEventListener('click', handleExport),
  );
}

/**
 * Cleanup account-detail screen.
 */
export function cleanup() {
  _currentAccount = null;
  for (const unsub of _unsubs) {
    try { unsub(); } catch {}
  }
  _unsubs = [];
}
