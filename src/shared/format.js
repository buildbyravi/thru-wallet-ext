// Pure formatting utilities — safe to import in both UI and background.
// No RPC calls, no keys, no chrome.storage, no side effects.

/** 1 THRU = 1e9 base units. */
export const UNITS_PER_THRU = 1_000_000_000n;

/** Format raw base units as a human-scale THRU amount, trimming trailing zeros. */
export function formatThru(rawUnits) {
  const whole = rawUnits / UNITS_PER_THRU;
  const frac = rawUnits % UNITS_PER_THRU;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Parse a human-entered THRU amount (e.g. "1.5") into exact raw base units.
 * Uses string splitting + BigInt, never parseFloat * 1e9, to avoid floating-point rounding.
 */
export function parseThruAmount(input) {
  const trimmed = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a plain positive number, like 1.5 or 250.');
  }
  const [wholeStr, fracStr = ''] = trimmed.split('.');
  if (fracStr.length > 9) {
    throw new Error('THRU has at most 9 decimal places.');
  }
  const whole = BigInt(wholeStr || '0');
  const frac = BigInt(fracStr.padEnd(9, '0') || '0');
  const units = whole * UNITS_PER_THRU + frac;
  if (units <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }
  return units;
}

/**
 * Format raw token units with an arbitrary decimal scale (token mints declare their own
 * decimals, unlike THRU's fixed 9). Same string-splitting discipline as formatThru.
 */
export function formatTokenAmount(rawUnits, decimals = 9) {
  const d = Math.min(18, Math.max(0, Math.floor(Number(decimals) || 0)));
  const raw = BigInt(rawUnits);
  if (d === 0) return raw.toString();
  const scale = 10n ** BigInt(d);
  const whole = raw / scale;
  const frac = raw % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(d, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Render base units with an asset's own scale, symbol included — the ONE place the "THRU uses
 * the 9-decimal formatter" special case lives. Decoders (shared) and the review card (ui) both
 * call this, so a fee row and a balance row can never disagree about the same number.
 *
 * Throws on a non-integer input; callers that may hold `null` must decide what to show first.
 */
export function formatAssetAmount(amountUnits, decimals, symbol) {
  const scale = Number(decimals);
  const units = typeof amountUnits === 'bigint' ? amountUnits : BigInt(amountUnits);
  const text = scale === 9 && symbol === 'THRU'
    ? formatThru(units)
    : formatTokenAmount(units, scale);
  return `${text} ${symbol}`;
}

/**
 * Parse a human-entered token amount (e.g. "1.5") into raw units for a mint with the given
 * decimals. Same no-float discipline as parseThruAmount — the only difference is the scale.
 */
export function parseTokenAmount(input, decimals = 9) {
  const d = Math.min(18, Math.max(0, Math.floor(Number(decimals) || 0)));
  const trimmed = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a plain positive number, like 1.5 or 250.');
  }
  const [wholeStr, fracStr = ''] = trimmed.split('.');
  if (fracStr.length > d) {
    throw new Error(`This token has at most ${d} decimal place${d === 1 ? '' : 's'}.`);
  }
  const whole = BigInt(wholeStr || '0');
  // d === 0 forces fracStr to be empty (any fraction would already have thrown above).
  const frac = d === 0 ? 0n : BigInt(fracStr.padEnd(d, '0') || '0');
  const units = whole * 10n ** BigInt(d) + frac;
  if (units <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }
  return units;
}

/**
 * Shorten an opaque identifier for display: `head…tail`.
 *
 * THE one implementation of "this string is too long for this row". It had six copies
 * (routes/name.js, domain/account-avatar.js, domain/token-drawer.js, domain/tx-card.js,
 * domain/tx-review/review-card.js and a decoder) before 2026-10-30, each with its own head/tail
 * and its own idea of when a value is "short enough" — so the same address could read two
 * different ways on two screens, and a short string could be made LONGER by truncation.
 *
 * A value is only shortened when the result is genuinely shorter: `head + tail + 4` must fit
 * inside it (the 4 covers the ellipsis and the two visible edge characters that make the value
 * recognisable). `tail: 0` drops the tail entirely.
 *
 * Display only. Never use the result to compare, look up or send anything: the caller keeps the
 * full value, and any surface that truncates must expose the whole string in `title`/`aria-label`
 * or in the detail view.
 */
export function shortenMiddle(value, { head = 8, tail = 6 } = {}) {
  const text = value == null ? '' : String(value);
  const h = Math.max(0, Math.trunc(head));
  const t = Math.max(0, Math.trunc(tail));
  if (text.length <= h + t + 4) return text;
  return t ? `${text.slice(0, h)}…${text.slice(-t)}` : `${text.slice(0, h)}…`;
}

/** An address, shortened the way the wallet's address rows want it: ta12345678…abcdef. */
export function shortAddress(address, { head = 8, tail = 6 } = {}) {
  return shortenMiddle(address, { head, tail });
}

/**
 * @deprecated Use `shortAddress` (same output, better name). Kept because four surfaces call it
 * by this name; it is now a one-line alias of the single implementation above, not a second one.
 */
export function truncateAddress(address) {
  return shortAddress(address, { head: 8, tail: 6 });
}
