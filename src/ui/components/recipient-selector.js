// Rabby-style In-Wallet Accounts & Recent Recipient Selector Drawer.

import { Drawer } from './drawer.js';
import { icons, byteMarkHtml } from '../../popup/icons.js';
import { truncateAddress, formatThru } from '../../shared/format.js';
import * as bridge from '../bridge.js';

function refsEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'hd' ? a.index === b.index : a.keyIndex === b.keyIndex;
}

/**
 * Open the Recipient Drawer to select from in-wallet accounts or recent contacts.
 * @param {Object} options
 * @param {Object} options.currentAccount - The current sender account
 * @param {function(Object): void} options.onRecipientSelected - Callback with { address, label, isOwnAccount }
 */
export async function openRecipientSelector({ currentAccount, onRecipientSelected }) {
  const accounts = await bridge.send('account.list');
  const otherAccounts = accounts.filter((acc) => !refsEqual(acc.ref, currentAccount.ref));

  // Get recent recipients from local storage
  const { thru_recent_recipients: recentList = [] } = await chrome.storage.local.get('thru_recent_recipients');

  const contentHtml = `
    <div class="recipient-drawer-content">
      <div class="search-box mb-3">
        <span class="search-icon">${icons.search(14)}</span>
        <input type="text" id="drawer-recipient-search" placeholder="Search my accounts or ta…" autocomplete="off" />
      </div>

      <div class="recipient-drawer-list" id="drawer-recipient-list">
        <!-- Rendered dynamically -->
      </div>
    </div>
  `;

  Drawer.open({
    title: 'Select Recipient',
    contentHtml,
    onMount: (bodyEl, closeDrawer) => {
      const listContainer = bodyEl.querySelector('#drawer-recipient-list');
      const searchInput = bodyEl.querySelector('#drawer-recipient-search');

      function renderList(query = '') {
        const q = (query || '').trim().toLowerCase();
        const filteredAccounts = q
          ? otherAccounts.filter((a) => a.label.toLowerCase().includes(q) || a.address.toLowerCase().includes(q))
          : otherAccounts;

        const filteredRecent = q
          ? recentList.filter((r) => r.address.toLowerCase().includes(q) || (r.label && r.label.toLowerCase().includes(q)))
          : recentList;

        if (filteredAccounts.length === 0 && filteredRecent.length === 0) {
          listContainer.innerHTML = `
            <div class="empty-state py-4">
              <p class="muted">No other accounts or recent recipients found.</p>
            </div>
          `;
          return;
        }

        let html = '';

        if (filteredAccounts.length > 0) {
          html += `<div class="drawer-section-label">My In-Wallet Accounts</div>`;
          for (const acc of filteredAccounts) {
            html += `
              <div class="account-drawer-item" data-type="own" data-address="${acc.address}" data-label="${acc.label}">
                <div class="account-item-left">
                  ${byteMarkHtml(acc.address, acc.ref)}
                  <div class="account-item-info">
                    <div class="account-name-badge-row">
                      <span class="account-item-name">${acc.label}</span>
                      <span class="tag-subtle">My Account</span>
                    </div>
                    <span class="account-item-addr mono">${truncateAddress(acc.address)}</span>
                  </div>
                </div>
                <div class="account-item-right">
                  <span class="btn-chip">Select</span>
                </div>
              </div>
            `;
          }
        }

        if (filteredRecent.length > 0) {
          html += `<div class="drawer-section-label mt-3">Recent Transfer Addresses</div>`;
          for (const rec of filteredRecent) {
            html += `
              <div class="account-drawer-item" data-type="recent" data-address="${rec.address}" data-label="${rec.label || ''}">
                <div class="account-item-left">
                  <div class="recipient-avatar-circle">${icons.history(14)}</div>
                  <div class="account-item-info">
                    <span class="account-item-name">${rec.label || truncateAddress(rec.address)}</span>
                    <span class="account-item-addr mono">${truncateAddress(rec.address)}</span>
                  </div>
                </div>
                <div class="account-item-right">
                  <span class="btn-chip">Select</span>
                </div>
              </div>
            `;
          }
        }

        listContainer.innerHTML = html;
      }

      renderList('');

      searchInput?.addEventListener('input', (e) => {
        renderList(e.target.value);
      });

      listContainer?.addEventListener('click', (e) => {
        const item = e.target.closest('.account-drawer-item');
        if (!item) return;
        const address = item.dataset.address;
        const label = item.dataset.label;
        const isOwnAccount = item.dataset.type === 'own';
        closeDrawer();
        if (typeof onRecipientSelected === 'function') {
          onRecipientSelected({ address, label, isOwnAccount });
        }
      });
    },
  });
}

/**
 * Save a newly sent address into recent recipients storage.
 * @param {string} address
 * @param {string} [label]
 */
export async function saveRecentRecipient(address, label = null) {
  if (!address) return;
  const { thru_recent_recipients: current = [] } = await chrome.storage.local.get('thru_recent_recipients');
  const filtered = current.filter((r) => r.address.toLowerCase() !== address.toLowerCase());
  const updated = [{ address, label, timestamp: Date.now() }, ...filtered].slice(0, 10);
  await chrome.storage.local.set({ thru_recent_recipients: updated });
}
