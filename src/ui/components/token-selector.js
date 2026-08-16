// Rabby-style Token Selector Drawer Component.

import { Drawer } from './drawer.js';
import { icons } from '../../popup/icons.js';
import { truncateAddress } from '../../shared/format.js';
import * as bridge from '../bridge.js';

/**
 * Open the Rabby-style Token Selection Drawer.
 * @param {Object} options
 * @param {Object} options.activeAccount
 * @param {string} options.nativeBalanceStr
 * @param {string} [options.selectedMint=null]
 * @param {function(Object): void} options.onTokenSelected
 */
export async function openTokenSelector({ activeAccount, nativeBalanceStr, selectedMint = null, onTokenSelected }) {
  let deployedTokens = [];
  try {
    deployedTokens = await bridge.send('token.list');
  } catch (err) {
    console.warn('Could not load token list:', err);
  }

  // Native THRU token
  const tokens = [
    {
      symbol: 'THRU',
      name: 'Thru Native Token',
      decimals: 9,
      mintAddress: null,
      isNative: true,
      balanceDisplay: nativeBalanceStr || '0',
    },
    ...deployedTokens.map((t) => ({
      symbol: t.ticker || 'TOKEN',
      name: t.name || 'Token',
      decimals: t.decimals || 6,
      mintAddress: t.mintAddress,
      imageUrl: t.imageUrl,
      isNative: false,
      balanceDisplay: t.initialSupply ? Number(t.initialSupply).toLocaleString() : '0',
    })),
  ];

  const contentHtml = `
    <div class="token-selector-drawer">
      <div class="search-box mb-3">
        <span class="search-icon">${icons.search(14)}</span>
        <input type="text" id="drawer-token-search" placeholder="Search by name, symbol or ta…" autocomplete="off" />
      </div>

      <div class="token-selector-list" id="drawer-token-list">
        <!-- Rendered dynamically -->
      </div>
    </div>
  `;

  Drawer.open({
    title: 'Select Token',
    contentHtml,
    onMount: (bodyEl, closeDrawer) => {
      const listContainer = bodyEl.querySelector('#drawer-token-list');
      const searchInput = bodyEl.querySelector('#drawer-token-search');

      function renderList(query = '') {
        const q = (query || '').trim().toLowerCase();
        const filtered = q
          ? tokens.filter((t) =>
              t.symbol.toLowerCase().includes(q) ||
              t.name.toLowerCase().includes(q) ||
              (t.mintAddress && t.mintAddress.toLowerCase().includes(q))
            )
          : tokens;

        if (filtered.length === 0) {
          listContainer.innerHTML = `
            <div class="empty-state py-4">
              <p class="muted">No tokens match "${query}"</p>
            </div>
          `;
          return;
        }

        listContainer.innerHTML = filtered.map((t) => {
          const isSelected = (t.isNative && !selectedMint) || (t.mintAddress === selectedMint);
          const avatarText = t.symbol.slice(0, 3).toUpperCase();
          const logoHtml = t.imageUrl
            ? `<img src="${t.imageUrl}" class="token-selector-logo" alt="${t.symbol}" /><div class="token-selector-avatar fallback" style="display:none;">${avatarText}</div>`
            : `<div class="token-selector-avatar">${avatarText}</div>`;

          return `
            <div class="token-selector-item ${isSelected ? 'selected' : ''}" data-token='${JSON.stringify(t).replace(/'/g, '&apos;')}'>
              <div class="token-item-left">
                ${logoHtml}
                <div class="token-item-info">
                  <div class="token-item-symbol-row">
                    <span class="token-item-symbol">${t.symbol}</span>
                    ${t.isNative ? '<span class="tag-native">Native</span>' : ''}
                  </div>
                  <span class="token-item-name">${t.name}</span>
                </div>
              </div>
              <div class="token-item-right">
                <span class="token-item-balance mono">${t.balanceDisplay}</span>
                ${t.mintAddress ? `<span class="token-item-mint mono">${truncateAddress(t.mintAddress)}</span>` : ''}
                ${isSelected ? `<span class="active-check-icon ml-2">${icons.check(14)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }

      renderList('');

      searchInput?.addEventListener('input', (e) => {
        renderList(e.target.value);
      });

      listContainer?.addEventListener('click', (e) => {
        const item = e.target.closest('.token-selector-item');
        if (!item) return;
        const tokenData = JSON.parse(item.dataset.token);
        closeDrawer();
        if (typeof onTokenSelected === 'function') {
          onTokenSelected(tokenData);
        }
      });
    },
  });
}
