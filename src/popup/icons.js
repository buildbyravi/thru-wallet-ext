/**
 * Shared inline-SVG icon set (stroke-based, 24-unit viewBox, currentColor).
 * One place to add icons as the wallet grows; keeps markup out of popup.js
 * string templates. All icons render at the size passed in.
 */

function svg(size, inner, viewBox = '0 0 24 24') {
  return `<svg width="${size}" height="${size}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const icons = {
  send: (s = 16) => svg(s, '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>'),
  receive: (s = 16) => svg(s, '<path d="M17 7L7 17"/><path d="M16 17H7V8"/>'),
  faucet: (s = 16) => svg(s, '<path d="M12 5v14"/><path d="M5 12h14"/>'),
  history: (s = 16) => svg(s, '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 3"/>'),
  back: (s = 16) => svg(s, '<path d="M15 18l-6-6 6-6"/>'),
  copy: (s = 14) => svg(s, '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  lock: (s = 15) => svg(s, '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  check: (s = 14) => svg(s, '<path d="M20 6L9 17l-5-5"/>'),
  external: (s = 12) => svg(s, '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>'),
  x: (s = 14) => svg(s, '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'),
  dot: (s = 14) => svg(s, '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
  plus: (s = 14) => svg(s, '<path d="M12 5v14"/><path d="M5 12h14"/>'),
  // v1.1 additions
  warning: (s = 14) => svg(s, '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none"/>'),
  shield: (s = 14) => svg(s, '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  checkCircle: (s = 14) => svg(s, '<circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/>'),
  eye: (s = 14) => svg(s, '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: (s = 14) => svg(s, '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>'),
  refresh: (s = 14) => svg(s, '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
  chevronDown: (s = 12) => svg(s, '<path d="M6 9l6 6 6-6"/>'),
};

/**
 * Byte-mark identicon: 16 cells, each mapped from a character of the
 * address to one of 4 ramp colors. Deterministic per address, so the
 * same account always shows the same mark — a visual checksum.
 * Square = seed-derived (hd), round = imported key.
 */
export function byteMarkHtml(address, ref, { small = false } = {}) {
  const src = address || '';
  let cells = '';
  for (let i = 0; i < 16; i++) {
    const code = src.charCodeAt((i * 7 + 3) % src.length || 0) || 0;
    cells += `<i class="m${code % 4}"></i>`;
  }
  const classes = ['byte-mark'];
  if (ref && ref.kind !== 'hd') classes.push('imported');
  if (small) classes.push('sm');
  return `<span class="${classes.join(' ')}" aria-hidden="true">${cells}</span>`;
}
