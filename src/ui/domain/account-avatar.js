// Account identity visuals.
//
// The avatar is a TYPE glyph, not per-account identity: the seed box for accounts derived
// from a recovery phrase, the key for imported private keys. (The old deterministic 4x4
// address byte-mark was deleted 2026-10-02 in favour of the Rabby-style glyphs — note the
// trade-off in plain terms: two accounts of the same type now look identical here, so the
// NAME is what distinguishes them. If per-account distinction is wanted back, tint the
// glyph background from the address rather than restoring the nibble grid.)
//
// The deleted popup/icons.js byteMarkHtml() returned a markup string, which forced callers
// into innerHTML. This builds nodes instead, and keeps the empty-address guard: fewer than
// 2 characters cannot produce a meaningful mark, so "no account yet" renders as an
// explicitly empty slot rather than as a real identity.

import { h } from '../kit/dom.js';
import { icon } from '../kit/icon.js';

/**
 * @param {Object} props
 *   address   string
 *   imported  true for a private-key keyring (renders key icon)
 *   size      'sm' | 'md' | 'lg' (default 'md')
 */
export function AccountAvatar({ address, imported = false, size = 'md' } = {}) {
  const src = String(address || '');
  const classes = ['byte-mark'];
  if (imported) classes.push('imported');
  if (size === 'sm') classes.push('sm');
  if (size === 'lg') classes.push('lg');

  // Fewer than 2 characters cannot produce a meaningful mark. Render an explicitly empty
  // slot so "no account yet" reads as absence rather than as a real identity.
  if (src.length < 2) {
    return h('span', { class: [...classes, 'empty'], 'aria-hidden': 'true' });
  }

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 24 : 18;
  return h('span', { class: classes, 'aria-hidden': 'true' }, [
    icon(imported ? 'key' : 'seed', iconSize),
  ]);
}

/**
 * Truncated address in monospace with an optional copy affordance.
 * @param {{ address: string, chars?: number }} props
 */
export function AddressText({ address, chars = 6 } = {}) {
  const addr = String(address || '');
  const short = addr.length > chars * 2 + 3
    ? `${addr.slice(0, chars)}…${addr.slice(-chars)}`
    : addr;
  return h('span', {
    class: 'mono truncate',
    text: short,
    // The full value is exposed to assistive tech and on hover, so truncation is a
    // display concern only and never hides what the user is acting on.
    title: addr,
    'aria-label': addr,
  });
}
