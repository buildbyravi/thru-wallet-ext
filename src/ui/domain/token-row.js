// Asset row: native THRU or a token, built as nodes.
//
// Replaces src/ui/components/token-row.js, which returns an HTML string and therefore forces
// its callers to use innerHTML. Every value here is attacker-controlled — a token's name,
// ticker and image URL come from whatever an arbitrary mint declared — so building nodes and
// setting text via textContent removes the escaping question entirely.
//
// The image also gets a CSS-only fallback: the initials sit underneath and the remote image
// layers over them. The old version used an inline onerror handler, which the extension CSP
// blocks, so the fallback never fired and a broken image left an empty box.

import { h, disposer, isSafeUrl } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { AddressText } from './account-avatar.js';

/**
 * @param {Object} props
 *   symbol        display ticker
 *   name          token name
 *   balanceText   already-formatted balance string, or null when unknown
 *   mintAddress   optional
 *   imageUrl      optional remote logo
 *   isNative      renders the Native badge
 *   stale         balance is cached and possibly out of date
 *   onClick       optional row handler
 */
export function AssetRow({
  symbol, name, balanceText = null, mintAddress = null,
  imageUrl = null, isNative = false, stale = false, onClick,
} = {}) {
  const d = disposer();
  const ticker = String(symbol || 'TOKEN');
  const initials = ticker.slice(0, 3).toUpperCase();

  // Only http(s) and inline images may reach an <img>. h() would drop an unsafe scheme
  // anyway; checking here avoids rendering an empty <img> frame for one.
  const safeLogo = imageUrl && isSafeUrl(imageUrl) && /^(https?:|data:image\/)/i.test(imageUrl)
    ? imageUrl
    : null;

  const avatar = safeLogo
    ? h('div', { class: 'token-row-logo-stack' }, [
      h('div', { class: 'token-row-avatar' }, h('span', { text: initials })),
      h('img', { class: 'token-row-logo', src: safeLogo, alt: '' }),
    ])
    : h('div', { class: 'token-row-avatar' }, isNative
      ? icon('bolt', 15)
      : h('span', { text: initials }));

  const balanceEl = h('span', {
    class: ['row-value', stale ? 'stale' : null].filter(Boolean),
    // A dash means "not known", never 0. Showing 0 for an unfetched balance is a number the
    // user could act on.
    text: balanceText == null ? '—' : String(balanceText),
  });

  const children = [
    avatar,
    h('span', { class: 'row-body' }, [
      h('span', { class: 'row-flex', style: { gap: '6px' } }, [
        h('span', { class: 'row-title', text: ticker }),
        isNative ? h('span', { class: 'tag-native', text: 'Native' }) : null,
      ]),
      mintAddress
        ? AddressText({ address: mintAddress, chars: 5 })
        : h('span', { class: 'row-sub', text: String(name || '') }),
    ]),
    balanceEl,
  ];

  const el = onClick
    ? h('button', { type: 'button', class: 'row clickable' }, children)
    : h('div', { class: 'row' }, children);

  if (onClick) d.on(el, 'click', () => onClick({ symbol: ticker, mintAddress }));

  return {
    el,
    setBalance(text, isStale) {
      balanceEl.textContent = text == null ? '—' : String(text);
      balanceEl.classList.toggle('stale', Boolean(isStale));
    },
    destroy() {
      d.dispose();
      el.remove();
    },
  };
}
