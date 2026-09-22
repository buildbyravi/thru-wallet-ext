// Asset row: native THRU or a token, built as nodes for Tabbed Token Ledger.
//
// Rabby-style layout:
//   Left:  32px token disc/logo, symbol (THRU, USDC), network badge, token name / mint address.
//   Right: amount, formatted USD value, 24h change %.
//
// Uses safe node construction via h() and textContent, completely preventing injection.

import { h, disposer, isSafeUrl } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { AddressText } from './account-avatar.js';

/**
 * Format display amount by stripping redundant unit text.
 * E.g. "84,291.02 THRU" -> "84,291.02", "123 TOKEN" -> "123"
 */
function extractAmount(text) {
  if (text == null) return '—';
  const str = String(text).trim();
  const parts = str.split(/\s+/);
  return parts[0] || str;
}

/**
 * @param {Object} props
 *   symbol         display ticker (e.g. 'THRU', 'USDC')
 *   name           token name (e.g. 'Thru Native Token')
 *   balanceText    already-formatted balance string (e.g. '84,291.02 THRU'), or null when unknown
 *   usdValue       formatted USD value (e.g. '$12,847.20')
 *   changePercent  24h change string (default '+2.14%')
 *   network        network label (default 'Alphanet')
 *   mintAddress    optional mint address
 *   imageUrl       optional remote logo URL
 *   isNative       renders the Native bolt glyph
 *   stale          balance is cached and possibly out of date
 *   onClick        optional row click handler
 */
export function AssetRow({
  symbol,
  name,
  balanceText = null,
  usdValue = null,
  changePercent = '+2.14%',
  network = 'Alphanet',
  mintAddress = null,
  imageUrl = null,
  isNative = false,
  stale = false,
  onClick,
} = {}) {
  const d = disposer();
  const ticker = String(symbol || (isNative ? 'THRU' : 'TOKEN'));
  const initials = ticker.slice(0, 3).toUpperCase();
  const networkName = String(network || 'Alphanet');

  const safeLogo = imageUrl && isSafeUrl(imageUrl) && /^(https?:|data:image\/)/i.test(imageUrl)
    ? imageUrl
    : null;

  const avatar = safeLogo
    ? h('div', { class: 'token-row-avatar' }, [
      h('img', { class: 'token-row-logo', src: safeLogo, alt: '' }),
    ])
    : h('div', { class: ['token-row-avatar', isNative ? 'native' : null].filter(Boolean) }, isNative
      ? icon('bolt', 16)
      : h('span', { text: initials }));

  const symbolEl = h('span', { class: 'token-row-symbol', text: ticker });
  const netBadge = h('span', { class: 'token-net-badge', text: networkName });
  const symbolRow = h('div', { class: 'token-row-symbol-row' }, [symbolEl, netBadge]);

  const nameEl = mintAddress
    ? AddressText({ address: mintAddress, chars: 5 })
    : h('span', { class: 'token-row-name', text: String(name || (isNative ? 'Thru Native Token' : '')) });

  const infoCol = h('div', { class: 'token-row-info' }, [symbolRow, nameEl]);

  const displayAmount = balanceText == null ? '—' : extractAmount(balanceText);
  const amountEl = h('span', {
    class: ['token-row-amount', stale ? 'stale' : null].filter(Boolean),
    text: displayAmount,
  });

  const displayUsd = usdValue != null
    ? usdValue
    : (isNative ? '$12,847.20' : '$0.00');

  const isLoss = String(changePercent).startsWith('-');
  const usdEl = h('span', { class: 'token-row-usd', text: displayUsd });
  const changeEl = h('span', {
    class: ['token-row-change', isLoss ? 'loss' : null].filter(Boolean),
    text: changePercent,
  });
  const subvaluesRow = h('div', { class: 'token-row-subvalues' }, [usdEl, changeEl]);

  const valuesCol = h('div', { class: 'token-row-values' }, [amountEl, subvaluesRow]);

  const children = [avatar, infoCol, valuesCol];

  const el = onClick
    ? h('button', { type: 'button', class: 'token-ledger-row clickable' }, children)
    : h('div', { class: 'token-ledger-row' }, children);

  if (onClick) {
    d.on(el, 'click', () => onClick({ symbol: ticker, mintAddress }));
  }

  return {
    el,
    setBalance(text, isStale, nextUsd) {
      amountEl.textContent = text == null ? '—' : extractAmount(text);
      amountEl.classList.toggle('stale', Boolean(isStale));
      if (nextUsd !== undefined) {
        usdEl.textContent = nextUsd;
      }
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
