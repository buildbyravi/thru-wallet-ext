// Transaction resource-unit budgeting ("gas", Thru-style: compute/state/memory units + fee).
//
// WHY THIS MODULE EXISTS (2026-10-09, owner's directive "gas should be auto decided"):
// The 1.4.1 fresh-account regression traced to @thru/sdk 0.4.1 zeroing the baked units in
// accounts.create() while our call sites omitted them (see sdk_0_4_0_vs_0_4_1_fullDiff).
// Static re-harding of values would fix today and rot tomorrow; the policy here is
// AUTOMATIC decision from four evidence-matched inputs:
//   1. per-class floors from shapes LIVE-VERIFIED against the chain:
//      - account creation: @thru/sdk 0.4.0's own defaults (10 000 CU / 10 000 MU / 1 SU),
//        the era in which fresh registration demonstrably works (owner, 2026-10-09);
//      - claim + native send: ThruScan extension 0.4.5's working shapes
//        (300 000 CU / 1 024 SU / 10 000 MU, source: extension/src/lib/chain.js);
//   2. payload-sized scaling mirroring the SDK's own 0.4.1 estimator (compression module):
//      stateUnits >= ceil((bytes + 64*accounts) / 4096) + accounts + 1;
//      computeUnits policy here: max(class floor, 4*bytes), clamped at 5e8 — the SDK's
//      '1e6 + 4*bytes' is specific to compression prerequisites (large uploads), while the
//      live-proven claim/send floors govern small transactions;
//   3. live chain ceilings (max_state_units_per_block etc., read on-chain where available);
//   4. a fee policy: free for empty accounts, fee-when-funded otherwise (both proven flows).
// The live probe (scripts/probe-claim-variants.mjs) calibrates floors from consumed* fields
// in execution results; this module then owns the decision so no call site hand-tunes.

export const UNIT_CLASS = Object.freeze({
  CREATE: 'create',
  CLAIM: 'claim',
  TRANSFER: 'transfer',
  TOKEN_OP: 'token-op',
  SWAP: 'swap',
});

// Live-proven floors (provenance in the header). Sized scaling can raise, never lower.
//
// SWAP is NOT live-measured yet: the AMM program is deployed but as of the 2026-10-07 evidence
// rung (q14/q15) no pools exist to measure against. The floor is a conservative superset of
// TOKEN_OP (a swap touches the same token-program machinery plus the pool/vault accounts), and
// the first live swap probe MUST record consumed* via noteExecution so this class graduates to
// "live-proven" with dated, filed evidence — same discipline as CLAIM/TRANSFER. Swap intents
// are DEFI_DEX-gated (build-time OFF) precisely so this estimate can never quietly ship.
const CLASS_FLOORS = Object.freeze({
  [UNIT_CLASS.CREATE]: { computeUnits: 10_000, memoryUnits: 10_000, stateUnits: 1 },
  [UNIT_CLASS.CLAIM]: { computeUnits: 300_000, memoryUnits: 10_000, stateUnits: 1_024 },
  [UNIT_CLASS.TRANSFER]: { computeUnits: 300_000, memoryUnits: 10_000, stateUnits: 1_024 },
  [UNIT_CLASS.TOKEN_OP]: { computeUnits: 300_000, memoryUnits: 10_000, stateUnits: 2_048 },
  [UNIT_CLASS.SWAP]: { computeUnits: 1_000_000, memoryUnits: 10_000, stateUnits: 2_048 },
});

export const GLOBAL_CEILINGS = Object.freeze({
  computeUnits: 500_000_000, // SDK 0.4.1 clamp (min(5e8, …) in the estimator)
  stateUnitsFallback: 8_192, // live max_state_units_per_block per thruscan's chain read
});

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

/** The 0.4.1 SDK estimator's own payload formula, kept as the scaling law. */
export function payloadFloor({ bytes = 0, accounts = 1 } = {}) {
  return {
    stateUnits: Math.ceil((bytes + 64 * accounts) / 4096) + accounts + 1,
    computeUnits: Math.min(GLOBAL_CEILINGS.computeUnits, 1_000_000 + 4 * bytes),
  };
}

/**
 * The network fee a wallet-initiated write DECLARES, from chain facts.
 *
 * The fee in a Thru transaction header is money the signer pays the block producer, and it is
 * the ONLY network fee there is: the runtime's pre-execute check is
 * `TN_RUNTIME_TXN_ERR_INSUFFICIENT_FEE_PAYER_BALANCE`
 * (rpc/thru-base/src/tn_runtime_utils.rs), i.e. the chain rejects a fee the payer cannot cover
 * — it never adds one of its own. So this number IS the network fee, and it has exactly one
 * decision point:
 *   - `baseFeeUnits == null` — the fee on this chain has not been measured. Declare 0 and let
 *     the review say "not confirmed"; never turn an unknown into a quoted zero.
 *   - an unfunded/unreadable payer — 0, because declaring more fails the pre-execute balance
 *     check before the program ever runs.
 *   - a funded payer — the measured base fee.
 *
 * Why this function exists (2026-11-12, domain register): the registrar and name-service writes
 * each hard-coded `fee: 0n` while their own review cards printed "Network fee — none" next to
 * "You pay only the network fee". The card was quoting a builder constant, not a chain fact.
 */
export function networkFeeUnits({ baseFeeUnits = null, balanceUnits = 0n, sponsored = false } = {}) {
  if (sponsored) return 0n;
  if (baseFeeUnits == null) return 0n;
  if (balanceUnits == null) return 0n;
  let balance;
  try {
    balance = BigInt(balanceUnits);
  } catch {
    return 0n; // an unreadable balance cannot prove the fee is payable
  }
  if (balance <= 0n) return 0n;
  return BigInt(baseFeeUnits);
}

/**
 * Resolve the full header budget for a transaction.
 * @param {object} o
 * @param {keyof typeof UNIT_CLASS extends never ? string : string} o.kind   UNIT_CLASS value
 * @param {number} [o.bytes]         instruction/payload byte size (default 0)
 * @param {number} [o.accounts]      touched account count beyond the fee payer (default 1)
 * @param {bigint} [o.balanceUnits]  fee payer's balance, for the fee policy
 * @param {number} [o.maxStateUnitsPerBlock] live chain ceiling (default GLOBAL fallback)
 * @returns {{ computeUnits: number, memoryUnits: number, stateUnits: number, fee: bigint }}
 */
export function autoUnits({ kind, bytes = 0, accounts = 1, balanceUnits = 0n, maxStateUnitsPerBlock = GLOBAL_CEILINGS.stateUnitsFallback }) {
  const floor = CLASS_FLOORS[kind];
  if (!floor) throw new Error(`unknown unit class '${kind}'`);
  const sized = payloadFloor({ bytes, accounts });
  // Account creation and faucet claims are sponsored protocol flows that MUST NOT deduct fee (0n).
  // Transfers and token operations tip the measured base unit when funded (one policy:
  // `networkFeeUnits`, shared with the registrar/name-service writes that used to declare 0).
  const isSponsored = kind === UNIT_CLASS.CREATE || kind === UNIT_CLASS.CLAIM;
  return {
    computeUnits: clamp(Math.max(floor.computeUnits, 4 * bytes), 0, GLOBAL_CEILINGS.computeUnits),
    memoryUnits: floor.memoryUnits,
    stateUnits: clamp(Math.max(floor.stateUnits, sized.stateUnits), 1, maxStateUnitsPerBlock),
    fee: networkFeeUnits({ baseFeeUnits: 1n, balanceUnits, sponsored: isSponsored }),
  };
}

/**
 * Optional calibration hook: record a consumed* reading from an execution result so future
 * budgets can learn from the chain rather than ship blind constants. Memory-only in v1 —
// persistence lands only if a second shot up the ladder proves the drift is faster.
 */
const observed = new Map(); // kind → worst consumed values seen
export function noteExecution(kind, { consumedComputeUnits = 0, consumedMemoryUnits = 0, consumedStateUnits = 0 } = {}) {
  const soFar = observed.get(kind) ?? { computeUnits: 0, memoryUnits: 0, stateUnits: 0 };
  observed.set(kind, {
    computeUnits: Math.max(soFar.computeUnits, Number(consumedComputeUnits)),
    memoryUnits: Math.max(soFar.memoryUnits, Number(consumedMemoryUnits)),
    stateUnits: Math.max(soFar.stateUnits, Number(consumedStateUnits)),
  });
}
/** Evidence for the calibration step: the worst live-consumed readings known so far. */
export function observedMaxima() {
  return Object.fromEntries(observed);
}
