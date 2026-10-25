// DEX feature seam (features are THIN; the registry law — scripts/check-layering.mjs's
// background-features-reach-chain-through-services rule — allows features to import
// services only). All DEX logic, chain seams, and the swap kind-driver live in
// src/background/services/dex-service.js; this file re-exports it so handlers and tests keep
// their historical import path unchanged.
export {
  listPools,
  getPool,
  listPositions,
  quoteSwap,
  quoteLiquidity,
  prepareSwap,
  prepareLiquidity,
  readiness,
  DEX_INTENT_KINDS,
  _patchChainForTests,
  _resetChainForTests,
} from '../../services/dex-service.js';
