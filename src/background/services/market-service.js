// Market data READ surface (M0): assets, snapshots, candles, trades, holders, watchlist.
//
// No project indexer, read API, or oracle is verified today (dossier: discovery/charts
// NO_INDEXER, usd DEPENDENCY_UNVERIFIED — see the capability snapshot). So every gated read
// answers { supported:false, reason } — with FLAG_OFF while build flags are off, then the
// dossier reason once a flag flips but evidence is still missing. Empty results are ONLY
// returned for things that are genuinely empty; no market value is ever fabricated.
//
// The LOCAL watchlist group is storage-only CRUD. It ships with the market feature, so at M0
// it answers FEATURE_DISABLED rather than pretending to persist.

import { gateOrThrow } from './defi/gating.js';

// One definition per method keeps this file a thin honest shell: the wire behavior is decided
// by the gate ladder, which the M0 test probes end-to-end.
const GATE = {
  assetGet: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market asset reads' },
  assetSearch: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market search' },
  snapshot: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market snapshots' },
  candles: { gate: 'DEFI_MARKET', feature: 'charts', env: 'result', label: 'Market candles' },
  trades: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market trades' },
  holders: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market holders' },
};

/**
 * Shared read flow: resolve the gate; if it (hypothetically) clears, fail honestly instead of
 * inventing a data layer — the read path for a verified indexer chain is M1+ work and an
 * unimplemented proceed branch must be loud, never silent.
 */
function gatedRead(def) {
  const { proceed, data } = gateOrThrow(def);
  if (!proceed) return data;
  const err = new Error(`${def.label}: read path is not implemented in this build.`);
  err.code = 'NOT_READY';
  err.retryable = false;
  throw err;
}

export async function getAsset() { return gatedRead(GATE.assetGet); }
export async function searchAssets() { return gatedRead(GATE.assetSearch); }
export async function getSnapshots() { return gatedRead(GATE.snapshot); }
export async function getCandles() { return gatedRead(GATE.candles); }
export async function getTrades() { return gatedRead(GATE.trades); }
export async function getHolders() { return gatedRead(GATE.holders); }

// ---- LOCAL watchlist (L group) ---------------------------------------------
// env:'error' means gateOrThrow itself throws FEATURE_DISABLED while the flag is off; there is
// no silent success path and no partial persistence.
export async function watchlistGet() {
  gateOrThrow({ gate: 'DEFI_MARKET', feature: null, env: 'error', label: 'Market watchlist' });
}
export async function watchlistAdd() {
  gateOrThrow({ gate: 'DEFI_MARKET', feature: null, env: 'error', label: 'Market watchlist' });
}
export async function watchlistRemove() {
  gateOrThrow({ gate: 'DEFI_MARKET', feature: null, env: 'error', label: 'Market watchlist' });
}
