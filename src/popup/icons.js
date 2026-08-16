/**
 * Shared inline-SVG icon set (stroke-based, 24-unit viewBox, currentColor).
 * NEVER use emojis or raw unicode character fallbacks. Always SVG.
 */

function svg(size, inner, viewBox = '0 0 24 24') {
  return `<svg width="${size}" height="${size}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const icons = {
  send: (s = 16) => svg(s, '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>'),
  receive: (s = 16) => svg(s, '<line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/>'),
  faucet: (s = 16) => svg(s, '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  history: (s = 16) => svg(s, '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/><polyline points="12 7 12 12 15 15"/>'),
  back: (s = 16) => svg(s, '<polyline points="15 18 9 12 15 6"/>'),
  copy: (s = 14) => svg(s, '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  lock: (s = 15) => svg(s, '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  check: (s = 14) => svg(s, '<polyline points="20 6 9 17 4 12"/>'),
  external: (s = 12) => svg(s, '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  x: (s = 14) => svg(s, '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  dot: (s = 14) => svg(s, '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
  plus: (s = 14) => svg(s, '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  warning: (s = 14) => svg(s, '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  shield: (s = 14) => svg(s, '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  checkCircle: (s = 14) => svg(s, '<circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/>'),
  eye: (s = 14) => svg(s, '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: (s = 14) => svg(s, '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'),
  refresh: (s = 14) => svg(s, '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
  chevronDown: (s = 12) => svg(s, '<polyline points="6 9 12 15 18 9"/>'),
  chevronRight: (s = 12) => svg(s, '<polyline points="9 18 15 12 9 6"/>'),
  chevronUp: (s = 12) => svg(s, '<polyline points="18 15 12 9 6 15"/>'),
  edit: (s = 14) => svg(s, '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
  search: (s = 14) => svg(s, '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  rocket: (s = 16) => svg(s, '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
  sparkle: (s = 16) => svg(s, '<path d="M12 2l2.4 7.4L22 12l-7.6 2.6L12 22l-2.4-7.4L2 12l7.6-2.6z"/>'),
  expand: (s = 14) => svg(s, '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
  coins: (s = 16) => svg(s, '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><line x1="7" y1="6" x2="9" y2="6"/><line x1="8" y1="5" x2="8" y2="7"/>'),
  bolt: (s = 16) => svg(s, '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  target: (s = 16) => svg(s, '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  user: (s = 14) => svg(s, '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  clipboard: (s = 14) => svg(s, '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'),
  swap: (s = 16) => svg(s, '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  trendingUp: (s = 16) => svg(s, '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  arrowDown: (s = 16) => svg(s, '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
  key: (s = 14) => svg(s, '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L21 8"/>'),
  settings: (s = 16) => svg(s, '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  info: (s = 14) => svg(s, '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  trash: (s = 14) => svg(s, '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  wallet: (s = 16) => svg(s, '<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><circle cx="16" cy="14" r="1"/>'),
};

/**
 * Byte-mark identicon: 16 cells, each mapped from a character of the
 * address to one of 4 ramp colors. Deterministic per address, so the
 * same account always shows the same mark — a visual checksum.
 * Square = seed-derived (hd), round = imported key.
 */
export function byteMarkHtml(address, ref, { small = false } = {}) {
  const src = String(address || '');
  const classes = ['byte-mark'];
  if (ref && ref.kind !== 'hd') classes.push('imported');
  if (small) classes.push('sm');

  // With an empty or placeholder address every cell used to collapse to m0
  // (`% src.length` is `% 0` -> NaN -> 0), producing an identical flat block for
  // every unknown account and quietly destroying the checksum property. Render an
  // explicitly empty mark instead, so "no address yet" reads as a blank slot rather
  // than as a real identity.
  if (src.length < 2) {
    return `<span class="${classes.join(' ')} empty" aria-hidden="true"></span>`;
  }

  let cells = '';
  for (let i = 0; i < 16; i++) {
    const code = src.charCodeAt((i * 7 + 3) % src.length) || 0;
    cells += `<i class="m${code % 4}"></i>`;
  }
  return `<span class="${classes.join(' ')}" aria-hidden="true">${cells}</span>`;
}
