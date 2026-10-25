// Dex feature backend (M0 contract-first drop). Lives under src/background/features/dex per
// docs/MODULE_BOUNDARIES.md: feature code in feature modules, the router stays a thin seam.
//
// Swap/pool capabilities depend on the AMM program, which has zero live verification
// (dossier Q14-Q19 → PROGRAM_NOT_VERIFIED), so with flags on these methods STILL answer
// explicitly-unsupported. Quotes are READ-class computations (no signing, callable while
// locked) and carry supported:false in their wire shape; prepares throw FEATURE_DISABLED.
//
// There is deliberately no math here: no constant-product estimates, no tolerance math, no
// price derivation — everything waits for the verified pool model (exit-before-entry, DEFI R2:
// remove-liquidity verifies before add-liquidity enables; add before a sell would be building
// on an unverified path).

import { gateOrThrow } from '../../services/defi/gating.js';

const GATES = {
  listPools: { gate: 'DEFI_READ', feature: 'pools', env: 'result', label: 'Pools' },
  getPool: { gate: 'DEFI_READ', feature: 'pools', env: 'result', label: 'Pool detail' },
  positions: { gate: 'DEFI_READ', feature: 'pools', env: 'error', label: 'Pool positions' },
  quote: { gate: 'DEFI_DEX', feature: 'swap', env: 'result', label: 'Swap quotes' },
  quoteLiquidity: { gate: 'DEFI_DEX', feature: 'pools', env: 'result', label: 'Liquidity quotes' },
  prepareSwap: { gate: 'DEFI_DEX', feature: 'swap', env: 'error', label: 'Swap preparation' },
  prepareLiquidity: { gate: 'DEFI_DEX', feature: 'pools', env: 'error', label: 'Liquidity preparation' },
};

function readOrUnsupported(def) {
  const { proceed, data } = gateOrThrow(def);
  if (!proceed) return data;
  const err = new Error(`${def.label}: read path is not implemented in this build.`);
  err.code = 'NOT_READY';
  err.retryable = false;
  throw err;
}

// READ
export async function listPools() { return readOrUnsupported(GATES.listPools); }
export async function getPool() { return readOrUnsupported(GATES.getPool); }
export async function listPositions() { return readOrUnsupported(GATES.positions); }

// PREPARE (read-shaped quotes + intent-bound prepares)
export async function quoteSwap() { return readOrUnsupported(GATES.quote); }
export async function quoteLiquidity() { return readOrUnsupported(GATES.quoteLiquidity); }
export async function prepareSwap() { return readOrUnsupported(GATES.prepareSwap); }
export async function prepareLiquidity() { return readOrUnsupported(GATES.prepareLiquidity); }
