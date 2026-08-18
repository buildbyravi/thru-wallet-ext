// Asset selector for the send flow.
//
// WHY THIS IS DELIBERATELY RESTRICTIVE
//
// The legacy send screen had a full token selector, and selecting a token was a FUND-LOSS BUG.
// screens/send.js built its review label as `${formatThru(amountUnits)} ${_selectedToken.symbol}`
// but then called `bridge.send('tx.send', { toAddress, amountUnits })` with no mint parameter at
// all — and tx.send performs a NATIVE THRU transfer. So picking a token showed "5 MYTOKEN" on the
// confirmation screen while actually moving THRU. It also ran parseThruAmount() on the input,
// which scales by 1e9 regardless of the token's real decimals, and computed its percentage chips
// with parseFloat on a formatted balance string.
//
// Token transfer is not implemented anywhere in the backend: thru-client can deploy a mint but
// has no transfer instruction for one, and reading a holder's token balance needs Token Program
// account semantics that are unverified (docs/BACKEND_GAPS.md C1).
//
// So tokens are LISTED — hiding them would just make the wallet look broken to someone who
// deployed one — but they are not selectable, and they say why. A disabled row with a reason is
// honest; a selectable row that silently sends a different asset is not.

import { h, disposer, isSafeUrl } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { formatThru } from '../../shared/format.js';

/**
 * @param {Object} props
 *   nativeBalance  base-unit string for THRU
 *   tokens         records from token.list
 *   selectedMint   null for native
 *   onSelect       (asset) => void — only ever called with the native asset today
 */
export function AssetSelector({
  nativeBalance = '0',
  tokens = [],
  selectedMint = null,
  onSelect,
} = {}) {
  const d = disposer();
  const el = h('div', { class: 'stack stack-2' });

  // ---- Native THRU: the only sendable asset ------------------------------
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

  el.appendChild(h('section', { class: 'list-group' }, [
    h('header', { class: 'list-group-header' }, h('span', { text: 'Sendable' })),
    h('div', { class: 'list' }, nativeRow),
  ]));

  // ---- Deployed tokens: shown, not selectable ---------------------------
  const visible = (tokens || []).filter((t) => !t.hidden && t.mintAddress);
  if (visible.length) {
    const rows = visible.map((token) => {
      const symbol = token.symbol || 'TOKEN';
      const logo = token.imageUrl && isSafeUrl(token.imageUrl) ? token.imageUrl : null;

      return h('div', { class: 'row', 'aria-disabled': 'true', style: { opacity: '0.55' } }, [
        logo
          ? h('div', { class: 'token-row-logo-stack' }, [
            h('div', { class: 'token-row-avatar' }, h('span', { text: symbol.slice(0, 3).toUpperCase() })),
            h('img', { class: 'token-row-logo', src: logo, alt: '' }),
          ])
          : h('div', { class: 'token-row-avatar' }, h('span', { text: symbol.slice(0, 3).toUpperCase() })),
        h('span', { class: 'row-body' }, [
          h('span', { class: 'row-title', text: symbol }),
          h('span', { class: 'row-sub', text: token.name || 'Deployed token' }),
        ]),
        h('span', { class: 'row-value', text: 'not sendable' }),
      ]);
    });

    el.appendChild(h('section', { class: 'list-group' }, [
      h('header', { class: 'list-group-header' }, [
        h('span', { text: 'Your deployed tokens' }),
        h('span', { class: 'list-group-count', text: String(visible.length) }),
      ]),
      h('div', { class: 'list' }, rows),
      h('p', { class: 'hint', text:
        'Token transfers are not supported yet — the wallet can deploy a mint but cannot move '
        + 'one. These are listed so you can see what you deployed. Only THRU can be sent.' }),
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
