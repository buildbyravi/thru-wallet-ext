// Opaque account references for URLs.
//
// Routes like `#/account?ref=...` need to name an account. Two things this must NOT do:
//
//   1. Carry a secret. Rabby puts the raw address in the query string; even that is more
//      than necessary, and this codebase has a worse precedent — the old router pushed
//      navigation params verbatim into its history array while create-password.js and
//      export-password.js passed mnemonics and private keys as params. Nothing sensitive
//      goes in a URL here: a ref is a keyring id plus an account index, both of which are
//      already visible in the UI.
//   2. Be trusted on the way back in. A hash is user-editable, so decode() validates
//      shape and rejects anything malformed rather than handing a bad object to the vault.
//
// The encoding is base64url of compact JSON. It is NOT encryption and is not pretending to
// be — it exists so the value is a single opaque token that survives URL parsing, not to
// hide anything.

import { isValidThruAddress } from '../lib/networks.js';

const MAX_REF_LENGTH = 512;

function toBase64Url(input) {
  const b64 = btoa(input);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

/**
 * Encode an account ref for a URL.
 * @param {{ keyringId: string, accountIndex?: number, index?: number }} ref
 * @returns {string}
 */
export function encodeRef(ref) {
  if (!ref || typeof ref !== 'object') throw new Error('encodeRef: a ref object is required.');
  const keyringId = String(ref.keyringId || '');
  if (!keyringId) throw new Error('encodeRef: ref.keyringId is required.');
  const accountIndex = Number(ref.accountIndex ?? ref.index ?? 0);
  // Only these two fields travel. Anything else on the incoming ref is dropped rather
  // than serialized, so a future field carrying something sensitive cannot leak by
  // accident.
  return toBase64Url(JSON.stringify({ k: keyringId, i: accountIndex }));
}

/**
 * Decode a URL ref back into a canonical vault ref.
 * @param {string} token
 * @returns {{ keyringId: string, accountIndex: number }|null} null when invalid
 */
export function decodeRef(token) {
  const raw = String(token || '');
  if (!raw || raw.length > MAX_REF_LENGTH) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(raw));
    const keyringId = String(parsed?.k || '');
    const accountIndex = Number(parsed?.i);
    if (!keyringId) return null;
    if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 100_000) return null;
    // Keyring ids are generated locally as `${type}_${random}`; reject anything that is
    // not shaped like one so a hand-edited hash cannot probe the vault with odd input.
    if (!/^[a-z]+_[A-Za-z0-9_-]{4,64}$/.test(keyringId)) return null;
    return { keyringId, accountIndex };
  } catch {
    return null;
  }
}

/** True when two refs point at the same account. */
export function refsEqual(a, b) {
  if (!a || !b) return false;
  const aKey = a.keyringId || '';
  const bKey = b.keyringId || '';
  if (!aKey || !bKey) return false;
  const aIndex = Number(a.accountIndex ?? a.index ?? 0);
  const bIndex = Number(b.accountIndex ?? b.index ?? 0);
  return aKey === bKey && aIndex === bIndex;
}

/**
 * Validate an address that arrived from a URL before it reaches a send flow.
 * Returns the address when valid, otherwise null.
 * @param {string} value
 */
export function safeAddressParam(value) {
  const addr = String(value || '').trim();
  if (!addr || addr.length > 128) return null;
  return isValidThruAddress(addr) ? addr : null;
}
