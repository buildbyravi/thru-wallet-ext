// Asset selector for the send flow.
//
// HISTORY OF THE 'not sendable' STATE, so it is not reintroduced by accident:
//
// The legacy send screen had a full token selector, and selecting a token was a FUND-LOSS BUG.
// screens/send.js built its review label as `${formatThru(amountUnits)} ${_selectedToken.symbol}`
// but then called `bridge.send('tx.send', { toAddress, amountUnits })` with no mint parameter at
// all — and tx.send performs a NATIVE THRU transfer. So picking a token showed "5 MYTOKEN" on the
// confirmation screen while actually moving THRU. Until contract v8 there was no real token send
// behind the selector, so tokens were listed but deliberately unselectable.
//
// Contract v8 adds `token.transfer` (auth: 'signing'), which sends raw units of the MINT through
// the official Token Program bindings. Selecting a token now really sends that token.
//
// What stays from the defensive era: a token is selectable only when its balance is KNOWN and
// positive. A balance that failed to load renders as "unknown" and unselectable; a proven-empty
// token account renders as "no balance". A row that says why it cannot act is honest; a
// selectable row that cannot complete a send is not.

import { h, disposer, isSafeUrl } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { formatThru, formatTokenAmount } from '../../shared/format.js';

function tokenAvatar(token) {
  const symbol = token.symbol || 'TOKEN';
  const logo = token.imageUrl && isSafeUrl(token.imageUrl) && /^(https?:|data:image\/)/i.test(token.imageUrl)
    ? token.imageUrl
    : null;
  return logo
    ? h('div', { class: 'token-row-logo-stack' }, [
      h('div', { class: 'token-row-avatar' }, h('span', { text: symbol.slice(0, 3).toUpperCase() })),
      h('img', { class: 'token-row-logo', src: logo, alt: '' }),
    ])
    : h('div', { class: 'token-row-avatar' }, h('span', { text: symbol.slice(0, 3).toUpperCase() }));
}

/**
 * @param {Object} props
 *   nativeBalance  base-unit string for THRU
 *   tokens         records from token.list merged with token.getBalances state:
 *                    tokenAccountExists  true/false/null (unknown)
 *                    amountUnits         base-unit string, null when zero or unknown
 *                    error               read failed
 *   selectedMint   null for native
 *   onSelect       (asset) => void — asset is { isNative:true } or a token record
 */
export function AssetSelector({
  nativeBalance = '0',
  tokens = [],
  selectedMint = null,
  onSelect,
} = {}) {
  const d = disposer();
  const el = h('div', { class: 'stack stack-2' });

  // ---- Sendable: native THRU plus every token with a known positive balance ------------
  const sendableRows = [];

  const nativeRow = h('button', {
    type: 'button',
    class: ['row', 'clickable', selectedMint === null ? 'active' : null].filter(Boolean),
    'aria-current': selectedMint === null ? 'true' : null,
  }, [
    h('div', { class: 'token-row-avatar' }, icon('bolt', 15)),
    h('span', { class: 'row-body' }, [
      h('span', { class: 'row-flex', style: { gap: '6px' } }, [
        h('span', { class: 'row-title', text: 'THRU' }),
        h('span', { class: 'tag-native', text: 'Native' }),
      ]),
      h('span', { class: 'row-sub', text: 'Thru Native Token' }),
    ]),
    h('span', { class: 'row-value', text: `${formatThru(BigInt(nativeBalance || '0'))} THRU` }),
  ]);
  d.on(nativeRow, 'click', () => onSelect?.({ symbol: 'THRU', mintAddress: null, isNative: true }));
  sendableRows.push(nativeRow);

  const unavailable = [];

  for (const token of tokens || []) {
    if (token.hidden || !token.mintAddress) continue;
    const symbol = token.symbol || 'TOKEN';
    const decimals = Number.isInteger(token.decimals) ? token.decimals : 0;
    const knowsBalance = token.error !== true && token.tokenAccountExists === true && token.amountUnits != null;
    const balance = knowsBalance ? BigInt(token.amountUnits) : null;
    const sendable = balance != null && balance > 0n;

    if (sendable) {
      const row = h('button', {
        type: 'button',
        class: ['row', 'clickable', selectedMint === token.mintAddress ? 'active' : null].filter(Boolean),
        'aria-current': selectedMint === token.mintAddress ? 'true' : null,
      }, [
        tokenAvatar(token),
        h('span', { class: 'row-body' }, [
          h('span', { class: 'row-title', text: symbol }),
          h('span', { class: 'row-sub', text: token.name || 'Token' }),
        ]),
        h('span', { class: 'row-value', text: `${formatTokenAmount(balance, decimals)} ${symbol}` }),
      ]);
      d.on(row, 'click', () => onSelect?.({ ...token, isNative: false }));
      sendableRows.push(row);
    } else {
      const reason = token.error === true
        ? 'balance unknown'
        : 'no balance';
      unavailable.push(h('div', { class: 'row', 'aria-disabled': 'true', style: { opacity: '0.55' } }, [
        tokenAvatar(token),
        h('span', { class: 'row-body' }, [
          h('span', { class: 'row-title', text: symbol }),
          h('span', { class: 'row-sub', text: token.name || 'Token' }),
        ]),
        h('span', { class: 'row-value', text: reason }),
      ]));
    }
  }

  el.appendChild(h('section', { class: 'list-group' }, [
    h('header', { class: 'list-group-header' }, h('span', { text: 'Sendable' })),
    h('div', { class: 'list' }, sendableRows),
  ]));

  if (unavailable.length) {
    el.appendChild(h('section', { class: 'list-group' }, [
      h('header', { class: 'list-group-header' }, [
        h('span', { text: 'Not sendable right now' }),
        h('span', { class: 'list-group-count', text: String(unavailable.length) }),
      ]),
      h('div', { class: 'list' }, unavailable),
      h('p', { class: 'hint', text:
        'A token needs its own token account with a balance before it can be sent. Incoming '
        + 'transfers create and fund it automatically. "Balance unknown" means the network '
        + 'could not be reached — it is not a zero.' }),
    ]));
  }

  return {
    el,
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
