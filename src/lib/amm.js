// src/lib/amm.js — the wallet's single doorway into the first-party AMM program package
// (`@thru/programs/amm`: Thru team, BSD); G3 of docs/initiatives/AMM.md (DEX swap intents).
//
// Policy carried here so feature code never has to re-derive it:
//   - every amount that crosses the wire is a STRING of base units (INT-06 — DeFi JSON never
//     mints numbers from floats for financial values);
//   - pool addresses are DERIVED from (program, mintA, mintB, fee) via the package, never
//     stored or hardcoded — the same derivation evidence rung q15 verified live
//     (scripts/defi-evidence/2026-10-07-live-chain.json, scripts/probe-amm.mjs);
//   - "no pools yet" is an honest empty answer, never an error: parsePool returns a
//     discriminated result so the DEX READ surface can say supported:false with a reason.
//
// Module-registry docs (docs/initiatives/MODULE_REGISTRY.md) — the lib layer may depend on
// @thru/* packages and shared/ modules only; no services, no features.

import { Pubkey } from '@thru/sdk';
import {
  AMM_PROGRAM_ADDRESS,
  AMM_DEFAULT_SWAP_FEE_BPS,
  AMM_MAX_SWAP_FEE_BPS,
  AMM_BPS_DENOMINATOR,
  AMM_LP_DECIMALS,
  AMM_LP_SCALE,
  AMM_ERROR_LABELS,
  AMM_VAULT_ONE_SEED,
  AMM_VAULT_TWO_SEED,
  deriveAmmPoolAddresses,
  parseAmmPoolMetadata,
  quoteAmmSwapExactIn,
  sortAmmMints,
  createSwapInstruction,
} from '@thru/programs/amm';

export {
  AMM_PROGRAM_ADDRESS,
  AMM_DEFAULT_SWAP_FEE_BPS,
  AMM_MAX_SWAP_FEE_BPS,
  AMM_BPS_DENOMINATOR,
  AMM_LP_DECIMALS,
  AMM_LP_SCALE,
  AMM_ERROR_LABELS,
};

export const VAULT_SEEDS = Object.freeze({ one: AMM_VAULT_ONE_SEED, two: AMM_VAULT_TWO_SEED });

/**
 * Sort two mint addresses into the pool's canonical (mintOne, mintTwo) order. Pure function
 * of the two mints — deterministic, first-party (q15 live-verified at the 2026-10-07 evidence
 * rung, where the program's expected derivation was recomputed and matched).
 */
export function sortMints(mintA, mintB) {
  return sortAmmMints(mintA, mintB);
}

/**
 * Derive the canonical pool address for (mintOne, mintTwo, swapFeeBps) on this node's AMM
 * program. `throughClient` is the SDK Thru client instance (derivation queries the node's
 * program table — same shape as probe-amm.mjs's derive rung).
 *
 * @returns {{ poolAddress: string, poolBytes: Uint8Array, mintOneAddress: string,
 *             mintTwoAddress: string, poolSeed: Uint8Array, lpMintSeed: Uint8Array,
 *             vaultOneSeed: Uint8Array, vaultTwoSeed: Uint8Array, swapFeeBps: number,
 *             inputOrder: 'already-sorted'|'swapped' }}
 */
export function derivePool(throughClient, { ammProgramAddress, mintAAddress, mintBAddress, swapFeeBps = AMM_DEFAULT_SWAP_FEE_BPS }) {
  const derived = deriveAmmPoolAddresses(throughClient, {
    ammProgramAddress: ammProgramAddress ?? AMM_PROGRAM_ADDRESS,
    mintAAddress,
    mintBAddress,
    swapFeeBps,
  });
  return derived;
}

/**
 * Parse raw pool-account bytes into pool metadata, honestly: a missing/short/undecodable
 * account is not an exception here, it is a RESULT ({ok:false, reason}) — the pool simply is
 * not initialized (or is not an AMM pool), and callers surface that as supported:false.
 *
 * @returns {{ ok: true, pool: { isInitialized: boolean, swapFeeBps: number, mintOne: string,
 *            mintTwo: string, vaultOne: string, vaultTwo: string, lpMint: string,
 *            swapPoolAuthority: string } } | { ok: false, reason: 'missing'|'malformed' }}
 */
export function parsePool(rawDataBytes) {
  if (!rawDataBytes || rawDataBytes.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  try {
    const pool = parseAmmPoolMetadata(rawDataBytes);
    if (!pool || !pool.isInitialized) return { ok: false, reason: 'uninitialized' };
    return { ok: true, pool };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/**
 * Constant-product exact-in quote, verbatim first-party math (quoteAmmSwapExactIn). Inputs and
 * outputs are STRING base units. Throws only on non-positive inputs/reserves — callers
 * validate before calling.
 */
export function quoteSwapExactIn({ amountIn, reserveIn, reserveOut, swapFeeBps }) {
  const q = quoteAmmSwapExactIn({
    amountIn: BigInt(amountIn),
    reserveIn: BigInt(reserveIn),
    reserveOut: BigInt(reserveOut),
    swapFeeBps,
  });
  return {
    amountIn: q.amountIn.toString(),
    amountInAfterFee: q.amountInAfterFee.toString(),
    feeAmount: q.feeAmount.toString(),
    amountOut: q.amountOut.toString(),
  };
}

/**
 * Minimum acceptable output under a slippage tolerance, integer-floored (rounding down is the
 * only honest direction for a protection bound: rounding up would promise output we cannot
 * deliver).
 */
export function applySlippage(amountOutUnits, slippageBps) {
  const out = BigInt(amountOutUnits);
  const bps = BigInt(Math.max(0, slippageBps));
  return ((out * (BigInt(AMM_BPS_DENOMINATOR) - bps)) / BigInt(AMM_BPS_DENOMINATOR)).toString();
}

/**
 * Spot price impact of the trade in basis points, integer math: impact = 1 -
 * (out * (reserveIn + amountIn)) / (amountIn * reserveOut), expressed in bps of the constant-
 * product curve. Returns null when the ratio is degenerate (amountIn 0 — a validation bug the
 * service layer refuses before calling).
 */
export function priceImpactBps({ amountInUnits, amountOutUnits, reserveInUnits, reserveOutUnits }) {
  const ain = BigInt(amountInUnits);
  const aout = BigInt(amountOutUnits);
  const rin = BigInt(reserveInUnits);
  const rout = BigInt(reserveOutUnits);
  if (ain === 0n || rout === 0n) return null;
  const num = aout * (rin + ain) * BigInt(AMM_BPS_DENOMINATOR);
  const den = ain * rout;
  const impactScaled = BigInt(AMM_BPS_DENOMINATOR) - (num / den);
  // Floor at 0 (a trade can price BETTER than spot only in pathological integer cases) and
  // cap at 10_000 bps (100%).
  const clamped = impactScaled < 0n ? 0n : impactScaled > BigInt(AMM_BPS_DENOMINATOR) ? BigInt(AMM_BPS_DENOMINATOR) : impactScaled;
  return Number(clamped);
}

/**
 * Resolve swap direction against parsed pool metadata: which side is INPUT (its vault balance
 * is reserveIn) and which is OUTPUT. Returns null when the input mint is not in the pool —
 * honestly, the pair does not include that asset.
 */
export function resolveDirection(poolMetadata, inputMint, outputMint) {
  const { mintOne, mintTwo, vaultOne, vaultTwo } = poolMetadata;
  if (inputMint === mintOne && outputMint === mintTwo) {
    return { inputIndex: 1, vaultIn: vaultOne, vaultOut: vaultTwo, mintIn: mintOne, mintOut: mintTwo };
  }
  if (inputMint === mintTwo && outputMint === mintOne) {
    return { inputIndex: 2, vaultIn: vaultTwo, vaultOut: vaultOne, mintIn: mintTwo, mintOut: mintOne };
  }
  return null;
}

/**
 * Human-facing label for an AMM program revert code (first-party AMM_ERROR_LABELS table), or
 * null when the code is not an AMM error.
 */
export function describeAmmError(code) {
  if (code == null) return null;
  return AMM_ERROR_LABELS[code] ?? null;
}

// The raw swap instruction builder is re-exported for dex-service's execute path only —
// createSwapInstruction returns an async (context) => bytes function the SDK's buildAndSign
// awaits (its account indices resolve through the instruction context, string or bytes).
export { createSwapInstruction };

/**
 * Thru address string ("ta...") → 32-byte pubkey, going through the SDK's own Pubkey codec so
 * the address encoding stays first-party (never re-implemented locally).
 */
export function addressToBytes(address) {
  const out = Pubkey.from(address).toBytes();
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}
