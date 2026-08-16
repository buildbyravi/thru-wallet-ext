// HTML escaping for the LEGACY string-building components.
//
// New code must not need this. `src/ui/kit/dom.js` builds nodes and sets text via
// textContent, which makes escaping unnecessary by construction — that is the real fix
// and it is where every migrated screen goes.
//
// This exists because the audit found ~20 innerHTML sinks interpolating values that are
// genuinely attacker-controlled, and no escaping helper anywhere in the repo:
//
//   - token name / ticker / image URL come from an ARBITRARY on-chain mint. Anyone can
//     deploy a token called `"><iframe src=//evil>` and get it rendered in a wallet that
//     lists it.
//   - account labels and search queries are user-supplied.
//
// Those sinks are being deleted route by route, but "wait for the rewrite" is not an
// acceptable interim answer for a wallet. So: escape at the remaining sinks now, and let
// scripts/check-layering.mjs's ratchet drive the count to zero.
//
// Do NOT reach for this in new code. If you are writing a template string containing
// markup, you are in the wrong layer.

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};

/**
 * Escape a value for interpolation into HTML text or a quoted attribute.
 *
 * Backtick and `=` are escaped as well as the usual five. That is deliberate: older
 * Internet Explorer treated backticks as attribute delimiters, and escaping `=` blocks
 * unquoted-attribute injection, which is the failure mode when a template writes
 * `value=${x}` without quotes. rename-account.js:40 does exactly that today.
 *
 * @param {any} value
 * @returns {string}
 */
export function esc(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"'`=]/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Escape a URL for use in an href/src attribute, refusing script-executing schemes.
 *
 * Mirrors the policy in src/ui/kit/dom.js isSafeUrl(): an unsafe scheme yields an empty
 * string rather than a sanitized-but-working URL, so the failure is visible.
 *
 * @param {any} value
 * @returns {string}
 */
export function escUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const collapsed = raw.replace(/[\u0000-\u0020\u00a0\u2000-\u200f\u2028-\u202f]/g, '').toLowerCase();
  if (/^(javascript|vbscript|file|about|blob):/.test(collapsed)) return '';
  if (collapsed.startsWith('data:') && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);/.test(collapsed)) return '';
  return esc(raw);
}

/**
 * Escape a value for a `data-*` attribute holding JSON.
 *
 * token-selector.js round-trips a whole token object through the DOM this way. Passing
 * objects through markup is the wrong pattern — keep them in a JS Map keyed by index —
 * but while it exists it must at least not break out of the attribute.
 *
 * @param {any} value
 * @returns {string}
 */
export function escJsonAttr(value) {
  try {
    return esc(JSON.stringify(value));
  } catch {
    return '';
  }
}
