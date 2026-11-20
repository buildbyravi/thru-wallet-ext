// Token avatar visual component.
//
// Centralizes token representation (custom token logos, native THRU branding,
// and text initials fallbacks) to prevent scattered markup across screens.

import { h, isSafeUrl } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { NATIVE_TOKEN, APP_ICON_URL } from '../../shared/tokens.js';

export { NATIVE_TOKEN, APP_ICON_URL };

/**
 * Render a token avatar node (image or symbol initials).
 *
 * @param {Object} props
 *   symbol    string (e.g. 'THRU' or 'USDC')
 *   imageUrl  optional image URL
 *   isNative  boolean (true for native THRU)
 *   size      'sm' | 'md' (default 'md')
 *   className optional extra class
 *   glyphOnly decorative mode: use existing local/embedded logo or a generic SVG, never text
 * @returns {Element}
 */
export function TokenAvatar({
  symbol = 'TOKEN',
  imageUrl = null,
  isNative = false,
  size = 'md',
  className = null,
  glyphOnly = false,
} = {}) {
  const ticker = String(symbol || (isNative ? NATIVE_TOKEN.symbol : 'TOKEN'));
  const logoPatterns = glyphOnly ? /^data:image\//i : /^(https?:|data:image\/)/i;
  const safeLogo = imageUrl && isSafeUrl(imageUrl) && logoPatterns.test(imageUrl)
    ? imageUrl
    : (isNative ? NATIVE_TOKEN.logoUrl : null);

  const classes = ['token-row-avatar'];
  if (isNative) classes.push('native');
  if (size === 'sm') classes.push('sm');
  if (className) classes.push(className);

  if (safeLogo) {
    return h('div', { class: classes }, [
      h('img', { class: 'token-row-logo', src: safeLogo, alt: glyphOnly ? '' : ticker }),
    ]);
  }

  if (glyphOnly) return h('div', { class: classes }, icon('coins', 12));

  const initials = ticker.slice(0, 3).toUpperCase();
  return h('div', { class: classes }, [
    h('span', { text: initials }),
  ]);
}
