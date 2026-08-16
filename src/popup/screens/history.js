// History screen module — transaction history with optional filters.
//
// Fetches history via bridge, renders rows with decoded descriptions.
// Adds filter tabs (All, Sent, Received, Faucet) as a UX improvement
// over the original flat list.

import * as bridge from '../../ui/bridge.js';
import { walletStore } from '../../ui/store.js';
import { icons } from '../icons.js';
import { showToast } from '../toast.js';
import { formatThru, truncateAddress } from '../../shared/format.js';
import { explorerTxUrl } from '../../lib/networks.js';

/** @type {Array<function>} */
let _unsubs = [];
let _activeFilter = 'all';

function historyIconAndClass(entry) {
  if (entry.success === false) return { icon: icons.x(14), cls: 'failed' };
  const kind = entry.kind;
  if (kind === 'sent') return { icon: icons.send(14), cls: 'sent' };
  if (kind === 'received') return { icon: icons.receive(14), cls: 'received' };
  if (kind === 'faucet') return { icon: icons.faucet(14), cls: 'faucet' };
  return { icon: icons.dot(14), cls: 'other' };
}

function historyDescription(entry) {
  const amountUnits = entry.amount ? BigInt(entry.amount) : 0n;
  if (entry.kind === 'sent') return `Sent ${formatThru(amountUnits)} THRU to ${truncateAddress(entry.counterparty)}`;
  if (entry.kind === 'received') return `Received ${formatThru(amountUnits)} THRU from ${truncateAddress(entry.counterparty)}`;
  if (entry.kind === 'faucet') return `Claimed ${formatThru(amountUnits)} THRU from faucet`;
  return `Program call (${truncateAddress(entry.programAddress)})`;
}

/**
 * Mount the history screen.
 * @param {HTMLElement} container
 */
export function mount(container) {
  _activeFilter = 'all';

  container.innerHTML = `
    <div class="subheader">
      <button class="icon-btn" data-action="go-dashboard" data-icon="back" title="Back">${icons.back()}</button>
      <h1>History</h1>
      <span class="subheader-spacer"></span>
    </div>
    <div class="history-filter-row" id="history-filters">
      <button class="filter-chip active" data-filter="all">All</button>
      <button class="filter-chip" data-filter="sent">Sent</button>
      <button class="filter-chip" data-filter="received">Received</button>
      <button class="filter-chip" data-filter="faucet">Faucet</button>
    </div>
    <div id="history-list" class="list"></div>
    <p class="hint" id="history-status"></p>
  `;

  // Filter handlers
  const filterRow = container.querySelector('#history-filters');
  const handleFilterClick = (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    _activeFilter = chip.dataset.filter;
    filterRow.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderEntries(container);
  };
  filterRow?.addEventListener('click', handleFilterClick);
  _unsubs.push(() => filterRow?.removeEventListener('click', handleFilterClick));

  // Copy signature handler
  const listContainer = container.querySelector('#history-list');
  const handleListClick = async (e) => {
    const sigBtn = e.target.closest('[data-sig]');
    if (sigBtn && sigBtn.dataset.sig) {
      await navigator.clipboard.writeText(sigBtn.dataset.sig);
      showToast('Signature copied', 'info');
    }
  };
  listContainer?.addEventListener('click', handleListClick);
  _unsubs.push(() => listContainer?.removeEventListener('click', handleListClick));

  // Load data
  loadHistory(container);
}

async function loadHistory(container) {
  const state = walletStore.getState();
  const account = state.activeAccount;
  if (!account) return;

  const statusEl = container.querySelector('#history-status');
  if (statusEl) statusEl.textContent = 'Loading…';

  try {
    const entries = await bridge.send('tx.listHistory', { address: account.address });
    walletStore.setState({ history: entries, isLoadingHistory: false });
    renderEntries(container);
  } catch (err) {
    if (statusEl) statusEl.textContent = `Couldn't load history: ${err.message}`;
  }
}

function renderEntries(container) {
  const listContainer = container.querySelector('#history-list');
  const statusEl = container.querySelector('#history-status');
  if (!listContainer) return;

  const state = walletStore.getState();
  const entries = state.history || [];
  const network = state.activeNetwork;

  const filtered = _activeFilter === 'all'
    ? entries
    : entries.filter((e) => e.kind === _activeFilter);

  listContainer.innerHTML = '';
  if (statusEl) statusEl.textContent = filtered.length ? '' : (_activeFilter === 'all' ? 'No transactions yet for this account.' : `No ${_activeFilter} transactions.`);

  for (const entry of filtered) {
    const { icon, cls } = historyIconAndClass(entry);
    const row = document.createElement('div');
    row.className = 'row';
    const sigDisplay = entry.signature ? truncateAddress(entry.signature) : 'pending';
    const linkHtml = entry.signature
      ? `<a class="history-explorer-link" href="${explorerTxUrl(network, entry.signature)}" target="_blank" rel="noopener" title="View on explorer">${icons.external()}</a>`
      : '';
    row.innerHTML = `<span class="row-glyph ${cls}">${icon}</span><span class="row-body"><span class="row-title">${historyDescription(entry)}${entry.success === false ? ' (failed)' : ''}</span><span class="history-sig-row"><button type="button" class="history-sig" data-sig="${entry.signature ?? ''}" title="Copy signature">${sigDisplay}</button>${linkHtml}</span></span>`;
    listContainer.appendChild(row);
  }
}

/**
 * Cleanup the history screen.
 */
export function cleanup() {
  for (const unsub of _unsubs) {
    try { unsub(); } catch { /* ignore */ }
  }
  _unsubs = [];
  _activeFilter = 'all';
}
