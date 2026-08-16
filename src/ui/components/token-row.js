// Reusable Token List Item Component.
//
// LEGACY: builds an HTML string, so its callers assign it via innerHTML. Scheduled for
// replacement by a kit component that returns a node. Until then it must be safe, because
// every value below comes from an arbitrary on-chain mint that anyone can deploy.

import { truncateAddress } from '../../shared/format.js';
import { esc, escUrl } from '../../shared/escape.js';

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
  const logoUrl = escUrl(token.imageUrl);

  // The avatar sits UNDERNEATH the image rather than being revealed by an onerror
  // handler. The previous version used inline `onerror="this.style.display='none'..."`,
  // which the extension CSP blocks outright — so the fallback never fired and a broken
  // remote image left an empty box. It also carried style="display:none", now refused by
  // the same policy. CSS stacking needs neither an inline handler nor an inline style.
  const logoHtml = logoUrl
    ? `<div class="token-row-logo-stack">
         <div class="token-row-avatar">${esc(avatarText)}</div>
         <img src="${logoUrl}" class="token-row-logo" alt="" />
       </div>`
    : `<div class="token-row-avatar">${esc(avatarText)}</div>`;

  return `
    <div class="token-row" data-mint="${esc(token.mintAddress || '')}">
      <div class="token-row-left">
        ${logoHtml}
        <div class="token-row-meta">
          <div class="token-row-symbol-group">
            <span class="token-row-symbol">${esc(symbol)}</span>
            ${token.isNative ? '<span class="tag-native">Native</span>' : ''}
          </div>
          <span class="token-row-name">${esc(name)}</span>
        </div>
      </div>
      <div class="token-row-right">
        <span class="token-row-balance mono">${esc(balance)}</span>
        ${token.mintAddress ? `<span class="token-row-mint mono">${esc(truncateAddress(token.mintAddress))}</span>` : ''}
      </div>
    </div>
  `;
}
