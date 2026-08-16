// Reusable Token List Item Component.

import { truncateAddress } from '../../shared/format.js';

/**
 * Render HTML for a token list row item.
 * @param {Object} token
 * @param {string} token.symbol
 * @param {string} token.name
 * @param {string} token.balanceDisplay
 * @param {string} [token.mintAddress]
 * @param {string} [token.imageUrl]
 * @param {boolean} [token.isNative=false]
 * @returns {string} HTML string
 */
export function renderTokenRow(token) {
  const symbol = token.symbol || 'TOKEN';
  const name = token.name || 'Token';
  const balance = token.balanceDisplay || '0';
  const avatarText = symbol.slice(0, 3).toUpperCase();

  const logoHtml = token.imageUrl
    ? `<img src="${token.imageUrl}" class="token-row-logo" alt="${symbol}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="token-row-avatar fallback" style="display:none;">${avatarText}</div>`
    : `<div class="token-row-avatar">${avatarText}</div>`;

  return `
    <div class="token-row" data-mint="${token.mintAddress || ''}">
      <div class="token-row-left">
        ${logoHtml}
        <div class="token-row-meta">
          <div class="token-row-symbol-group">
            <span class="token-row-symbol">${symbol}</span>
            ${token.isNative ? '<span class="tag-native">Native</span>' : ''}
          </div>
          <span class="token-row-name">${name}</span>
        </div>
      </div>
      <div class="token-row-right">
        <span class="token-row-balance mono">${balance}</span>
        ${token.mintAddress ? `<span class="token-row-mint mono">${truncateAddress(token.mintAddress)}</span>` : ''}
      </div>
    </div>
  `;
}
