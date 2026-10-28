// Shared helpers for review decoders.
//
// Everything here is pure and formatting-only. The rule that matters: amounts are carried as
// exact base-unit strings and rendered ONLY through src/shared/format.js. A decoder must not
// divide by 1e9 itself, and it must never turn "we could not read this" into a number.

import { formatAssetAmount } from '../../format.js';

/**
 * Render base units with the asset's own scale. The scale rule itself lives in
 * `shared/format.js` (`formatAssetAmount`) so the review CARD — which renders the same fee and
 * balance numbers — cannot drift from the decoders.
 */
export function displayAmount(amountUnits, decimals, symbol) {
  return formatAssetAmount(amountUnits, decimals, symbol);
}

/**
 * One asset movement. `verified:false` means the symbol/decimals are user-supplied rather
 * than read from the mint — the UI must not present those numbers as chain truth.
 */
export function movement({
  symbol,
  name = null,
  mintAddress = null,
  decimals,
  amountUnits,
  verified,
  note = null,
}) {
  return {
    symbol: String(symbol),
    name: name ? String(name) : null,
    mintAddress: mintAddress ? String(mintAddress) : null,
    decimals: Number(decimals),
    amountUnits: String(amountUnits),
    verified: Boolean(verified),
    note: note ? String(note) : null,
  };
}

/** A label/value row in "what you are doing". */
export function row(label, value, extra = {}) {
  return {
    label: String(label),
    value: value == null ? '' : String(value),
    above: extra.above ? String(extra.above) : null,
    mono: extra.mono === true,
    tone: extra.tone ?? 'default',
  };
}

/**
 * A warning. `blocking:true` is a PROVEN reason the transaction cannot be signed (the chain
 * would reject it, or the wallet forbids it). An unreadable value is a warning WITHOUT
 * blocking, because "I could not check" is not the same fact as "this will fail".
 */
export function warn(id, severity, title, detail, { blocking = false } = {}) {
  return {
    id,
    severity,
    title: String(title),
    detail: String(detail ?? ''),
    blocking: Boolean(blocking),
  };
}

/** An explicit user acknowledgement the review requires before signing. */
export function acknowledgement(id, label) {
  return { id: String(id), label: String(label) };
}

/**
 * The fee block. A network whose fee has not been measured reports supported:false with the
 * reason; it never inherits another chain's number (see tx.estimateFee's provenance rule).
 */
export function feeBlock({
  supported,
  amountUnits = null,
  reserveUnits = null,
  source = null,
  note = '',
  symbol = 'THRU',
  decimals = 9,
}) {
  return {
    supported: Boolean(supported),
    symbol,
    decimals,
    amountUnits: amountUnits == null ? null : String(amountUnits),
    reserveUnits: reserveUnits == null ? null : String(reserveUnits),
    source: source ? String(source) : null,
    note: String(note ?? ''),
  };
}

/** An asset-moving instruction, named only when the wallet genuinely knows the layout. */
export function instruction(name, { decoded = true, note = null } = {}) {
  return { name: String(name), decoded: Boolean(decoded), note: note ? String(note) : null };
}

/** One account role in the instruction's account table. */
export function accountRole(role, address) {
  return { role: String(role), address: String(address) };
}

/**
 * Execution block. `program.verified` is true only when the address came from a pin the
 * repository can point at (network config / first-party package re-export), never because the
 * transaction merely named it.
 */
export function executionBlock({
  program = null,
  instructions = [],
  accounts = [],
  raw = null,
} = {}) {
  return { program, instructions, accounts, raw };
}
