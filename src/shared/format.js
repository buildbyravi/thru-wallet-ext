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

/** Truncate a Thru address for display: ta12345678…abcdef */
export function truncateAddress(address) {
  if (!address || address.length <= 18) return address || '';
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}
