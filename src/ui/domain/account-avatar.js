// Account identity visuals.
//
// The byte-mark is a deterministic 4x4 grid derived from the address — a visual checksum,
// so a user notices when the active account is not the one they expected. Square = derived
// from a recovery phrase, round = imported private key.
//
// popup/icons.js byteMarkHtml() returns a markup string, which forces callers into
// innerHTML. This builds nodes instead, and fixes a real defect in the original: for an
// empty address `src.charCodeAt((i * 7 + 3) % src.length || 0)` evaluates `% 0` -> NaN -> 0
// for every cell, so every unknown account rendered the SAME flat block. A checksum that
// collides for all placeholder states is worse than none, because it looks like identity.

import { h } from '../kit/dom.js';

/**
 * @param {Object} props
 *   address   string
 *   imported  true for a private-key keyring (renders round)
 *   size      'sm' | 'md' (default 'md')
 */
export function AccountAvatar({ address, imported = false, size = 'md' } = {}) {
  const src = String(address || '');
  const classes = ['byte-mark'];
  if (imported) classes.push('imported');
  if (size === 'sm') classes.push('sm');

  // Fewer than 2 characters cannot produce a meaningful mark. Render an explicitly empty
  // slot so "no account yet" reads as absence rather than as a real identity.
  if (src.length < 2) {
    return h('span', { class: [...classes, 'empty'], 'aria-hidden': 'true' });
  }

  const cells = [];
  for (let i = 0; i < 16; i += 1) {
    const code = src.charCodeAt((i * 7 + 3) % src.length) || 0;
    cells.push(h('i', { class: `m${code % 4}` }));
  }

  return h('span', { class: classes, 'aria-hidden': 'true' }, cells);
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
