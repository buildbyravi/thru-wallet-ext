// Rabby-style Token Selector Drawer Component.

import { Drawer } from './drawer.js';
import { icons } from '../../popup/icons.js';
import { truncateAddress } from '../../shared/format.js';
import { esc, escUrl } from '../../shared/escape.js';
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

      // Rendered order, so a click resolves back to the real object without passing it
      // through markup.
      let renderedTokens = [];

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
              <p class="muted">No tokens match "${esc(query)}"</p>
            </div>
          `;
          return;
        }

        listContainer.innerHTML = filtered.map((t, index) => {
          const isSelected = (t.isNative && !selectedMint) || (t.mintAddress === selectedMint);
          const avatarText = String(t.symbol || '').slice(0, 3).toUpperCase();
          const logoUrl = escUrl(t.imageUrl);

          // Avatar underneath, remote image layered over it. Replaces a
          // style="display:none" fallback that the extension CSP refuses.
          const logoHtml = logoUrl
            ? `<div class="token-selector-logo-stack">
                 <div class="token-selector-avatar">${esc(avatarText)}</div>
                 <img src="${logoUrl}" class="token-selector-logo" alt="" />
               </div>`
            : `<div class="token-selector-avatar">${esc(avatarText)}</div>`;

          // Index only. The previous version serialized the entire token object into a
          // data-token attribute and JSON.parse'd it back on click — attacker-controlled
          // metadata making a round trip through markup, with an unguarded parse at the
          // other end. The object never leaves JS now.
          return `
            <div class="token-selector-item ${isSelected ? 'selected' : ''}" data-index="${index}">
              <div class="token-item-left">
                ${logoHtml}
                <div class="token-item-info">
                  <div class="token-item-symbol-row">
                    <span class="token-item-symbol">${esc(t.symbol)}</span>
                    ${t.isNative ? '<span class="tag-native">Native</span>' : ''}
                  </div>
                  <span class="token-item-name">${esc(t.name)}</span>
                </div>
              </div>
              <div class="token-item-right">
                <span class="token-item-balance mono">${esc(t.balanceDisplay)}</span>
                ${t.mintAddress ? `<span class="token-item-mint mono">${esc(truncateAddress(t.mintAddress))}</span>` : ''}
                ${isSelected ? `<span class="active-check-icon ml-2">${icons.check(14)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('');

        // Keep the rendered order so a click can resolve back to the real object.
        renderedTokens = filtered;
      }

      renderList('');

      searchInput?.addEventListener('input', (e) => {
        renderList(e.target.value);
      });

      listContainer?.addEventListener('click', (e) => {
        const item = e.target.closest('.token-selector-item');
        if (!item) return;
        const tokenData = renderedTokens[Number(item.dataset.index)];
        if (!tokenData) return;
        closeDrawer();
        if (typeof onTokenSelected === 'function') {
          onTokenSelected(tokenData);
        }
      });
    },
  });
}
