// Rabby-style Account Switcher Drawer Component.
// Uses domain wallet-model grouping and pure SVG icons.

import { Drawer } from './drawer.js';
import { icons, byteMarkHtml } from '../../popup/icons.js';
import { truncateAddress } from '../../shared/format.js';
import * as bridge from '../bridge.js';
import { showToast } from '../../popup/toast.js';
import { router } from '../router.js';

function refsEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'hd' ? a.index === b.index : a.keyIndex === b.keyIndex;
}

/**
 * Open the Rabby-style Account Switcher Drawer.
 * @param {Object} options
 * @param {function(Object): void} options.onAccountSwitched - Callback when switched
 * @param {function(): void} [options.onAddKeyRequested] - Callback when user wants to import key
 */
export async function openAccountSwitcher({ onAccountSwitched, onAddKeyRequested }) {
  const accounts = await bridge.send('account.list');
  const activeRef = await bridge.send('account.getActiveRef');
  const hasSeed = await bridge.send('wallet.hasSeed');

  const contentHtml = `
    <div class="account-drawer-content">
      <div class="search-box mb-3">
        <span class="search-icon">${icons.search(14)}</span>
        <input type="text" id="drawer-accounts-search" placeholder="Search by name or ta…" autocomplete="off" />
      </div>

      <div class="account-drawer-list" id="drawer-accounts-list">
        <!-- Rendered dynamically -->
      </div>

      <div class="account-drawer-footer">
        ${hasSeed ? `
          <button type="button" class="btn secondary w-100 mb-2" id="drawer-add-hd-btn">
            ${icons.plus(14)} Derive New Account
          </button>
        ` : ''}
        <button type="button" class="btn text w-100" id="drawer-import-key-btn">
          ${icons.plus(14)} Import Private Key
        </button>
      </div>
    </div>
  `;

  Drawer.open({
    title: 'Switch Account',
    contentHtml,
    onMount: (bodyEl, closeDrawer) => {
      const listContainer = bodyEl.querySelector('#drawer-accounts-list');
      const searchInput = bodyEl.querySelector('#drawer-accounts-search');
      const addHdBtn = bodyEl.querySelector('#drawer-add-hd-btn');
      const importKeyBtn = bodyEl.querySelector('#drawer-import-key-btn');

      function renderList(query = '') {
        const q = (query || '').trim().toLowerCase();
        const filtered = q
          ? accounts.filter((acc) => acc.label.toLowerCase().includes(q) || acc.address.toLowerCase().includes(q))
          : accounts;

        if (filtered.length === 0) {
          listContainer.innerHTML = `
            <div class="empty-state py-4">
              <p class="muted">No accounts match "${query}"</p>
            </div>
          `;
          return;
        }

        const hdAccounts = filtered.filter((a) => a.ref?.kind === 'hd');
        const importedAccounts = filtered.filter((a) => a.ref?.kind === 'imported');

        let html = '';

        if (hdAccounts.length > 0) {
          html += `<div class="drawer-section-label">HD Seed Accounts</div>`;
          for (const acc of hdAccounts) {
            const isActive = refsEqual(acc.ref, activeRef);
            html += `
              <div class="account-drawer-item ${isActive ? 'active' : ''}" data-ref='${JSON.stringify(acc.ref)}' data-address="${acc.address}" data-name="${acc.label}">
                <div class="account-item-left">
                  ${byteMarkHtml(acc.address, acc.ref)}
                  <div class="account-item-info">
                    <span class="account-item-name">${acc.label}</span>
                    <span class="account-item-addr mono">${truncateAddress(acc.address)}</span>
                  </div>
                </div>
                <div class="account-item-right">
                  <button type="button" class="icon-btn-ghost detail-btn" title="View Account Details">
                    ${icons.info(14)}
                  </button>
                  <button type="button" class="icon-btn-ghost rename-btn" title="Rename">
                    ${icons.edit(14)}
                  </button>
                  ${isActive ? `<span class="active-check-icon">${icons.check(16)}</span>` : ''}
                </div>
              </div>
            `;
          }
        }

        if (importedAccounts.length > 0) {
          html += `<div class="drawer-section-label mt-3">Imported Private Keys</div>`;
          for (const acc of importedAccounts) {
            const isActive = refsEqual(acc.ref, activeRef);
            html += `
              <div class="account-drawer-item ${isActive ? 'active' : ''}" data-ref='${JSON.stringify(acc.ref)}' data-address="${acc.address}" data-name="${acc.label}">
                <div class="account-item-left">
                  ${byteMarkHtml(acc.address, acc.ref)}
                  <div class="account-item-info">
                    <span class="account-item-name">${acc.label}</span>
                    <span class="account-item-addr mono">${truncateAddress(acc.address)}</span>
                  </div>
                </div>
                <div class="account-item-right">
                  <button type="button" class="icon-btn-ghost detail-btn" title="View Account Details">
                    ${icons.info(14)}
                  </button>
                  <button type="button" class="icon-btn-ghost rename-btn" title="Rename">
                    ${icons.edit(14)}
                  </button>
                  ${isActive ? `<span class="active-check-icon">${icons.check(16)}</span>` : ''}
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

      listContainer?.addEventListener('click', async (e) => {
        const item = e.target.closest('.account-drawer-item');
        if (!item) return;

        const addr = item.dataset.address;
        const currentName = item.dataset.name || '';
        const targetAcc = accounts.find((a) => a.address.toLowerCase() === addr.toLowerCase());

        // Detail button
        if (e.target.closest('.detail-btn')) {
          e.stopPropagation();
          closeDrawer();
          router.navigate('account-detail', { account: targetAcc });
          return;
        }

        // Rename button
        if (e.target.closest('.rename-btn')) {
          e.stopPropagation();
          closeDrawer();
          router.navigate('rename-account', { address: addr, name: currentName });
          return;
        }

        // Switch account
        const ref = JSON.parse(item.dataset.ref);
        const switched = await bridge.send('account.switch', { ref });
        showToast(`Switched to ${switched.label}`, 'info');
        closeDrawer();
        if (typeof onAccountSwitched === 'function') {
          onAccountSwitched(switched);
        }
      });

      addHdBtn?.addEventListener('click', async () => {
        addHdBtn.disabled = true;
        addHdBtn.textContent = 'Deriving…';
        try {
          const newAccount = await bridge.send('account.addHd');
          showToast(`Created ${newAccount.label}`, 'success');
          closeDrawer();
          if (typeof onAccountSwitched === 'function') {
            onAccountSwitched(newAccount);
          }
        } catch (err) {
          showToast(`Derive failed: ${err.message}`, 'error');
          addHdBtn.disabled = false;
          addHdBtn.textContent = '+ Derive New Account';
        }
      });

      importKeyBtn?.addEventListener('click', () => {
        closeDrawer();
        if (typeof onAddKeyRequested === 'function') {
          onAddKeyRequested();
        } else {
          router.navigate('add-key');
        }
      });
    },
  });
}
