// Market data READ surface (M0 gate behavior + G1-C read layer): assets, snapshots, candles,
// trades, holders, watchlist.
//
// No project indexer, read API, or oracle is verified today (dossier: discovery/charts
// NO_INDEXER, usd DEPENDENCY_UNVERIFIED — see the capability snapshot). So every gated read
// answers { supported:false, reason } — with FLAG_OFF while build flags are off, then the
// dossier reason once a flag flips but evidence is still missing. Empty results are ONLY
// returned for things that are genuinely empty; no market value is ever fabricated.
//
// G1-C: the past-gate path is no longer a bare NOT_READY throw. It assembles each answer from
// independent slices (defi/market-reads.js) through the coalescing read cache
// (defi/read-cache.js) — chain reads before index reads, per-slice honest states, genesis-
// bound cache keys. Today the dossier rung (discovery/charts unsupported) still resolves
// first, so the wire is byte-identical to M0; when evidence flips a row, the layer behind the
// gate is already real.
//
// The LOCAL watchlist group is storage-only CRUD. It ships with the market feature, so it
// answers FEATURE_DISABLED rather than pretending to persist.

import { gateOrThrow, unsupportedResult } from './defi/gating.js';
import * as registry from './registry-service.js';
import * as riskService from './risk-service.js';
import { createReadCache } from './defi/read-cache.js';
import { assembleAssetGet, assembleSnapshots } from './defi/market-reads.js';

// One definition per method keeps the gate layer the single source of truth for wire behavior:
// the M0 test probes every method end-to-end.
const GATE = {
  assetGet: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market asset reads' },
  assetSearch: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market search' },
  snapshot: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market snapshots' },
  candles: { gate: 'DEFI_MARKET', feature: 'charts', env: 'result', label: 'Market candles' },
  trades: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market trades' },
  holders: { gate: 'DEFI_MARKET', feature: 'discovery', env: 'result', label: 'Market holders' },
};

const REGISTRY_NETWORK = 'betanet';

// Shared coalescing cache for all market slices. In-memory only; genesis binding is by key,
// not sweep — keys carry the runtime fingerprint, so a chain reset retires every entry.
const marketCache = createReadCache({ maxEntries: 256 });

/**
 * The environment the slice layer resolves against, built from the ONE registry/facts/risk.
 * chainReads/indexReads stay undefined until an evidence-pinned reader exists; the slice
 * ladder treats missing sources as honest no-answer, never as zero/empty data.
 */
function marketEnv() {
  return {
    networkId: REGISTRY_NETWORK,
    fingerprint: registry.currentChainFingerprint(REGISTRY_NETWORK) ?? '',
    now: Date.now(),
    dossier: {
      discovery: registry.getFeature('discovery'),
      charts: registry.getFeature('charts'),
      usd: registry.getFeature('usd'),
      launchMint: registry.getFeature('launchMint'),
    },
    facts: registry.getProgramFacts(REGISTRY_NETWORK),
    risk: async (assetId) => {
      try {
        return { supported: true, data: await riskService.assessAsset({ assetId }) };
      } catch (err) {
        // DEFI_RISK flag off or risk gate unsupported → the slice says so honestly.
        return unsupportedResult(err?.code === 'FEATURE_DISABLED' ? 'FLAG_OFF' : (err?.reason ?? 'DEPENDENCY_UNVERIFIED'));
      }
    },
    cache: marketCache,
    ttlMs: { header: 60_000, price: 15_000, charts: 15_000, trades: 5_000, holders: 60_000 },
  };
}

/** Exposed for tests: the coalescing cache behind the market slices. */
export function _getMarketCacheForTests() {
  return marketCache;
}

/**
 * Shared read flow: resolve the gate; on a cleared gate the caller either runs its slice
 * assembly (assetGet, snapshot — the G1-C layer is real there) or throws NOT_READY, per the
 * G0 rule that an unimplemented proceed branch is loud, never silent.
 */
function gatedOrNull(def) {
  const { proceed, data } = gateOrThrow(def);
  if (!proceed) return data;
  return null; // gate cleared — the caller must answer honestly
}

function notReady(label) {
  const err = new Error(`${label}: read path is not implemented in this build.`);
  err.code = 'NOT_READY';
  err.retryable = false;
  throw err;
}

export async function getAsset({ assetId } = {}) {
  const gated = gatedOrNull(GATE.assetGet);
  if (gated !== null) return gated;
  return assembleAssetGet(assetId, marketEnv());
}

export async function searchAssets() {
  const gated = gatedOrNull(GATE.assetSearch);
  if (gated !== null) return gated;
  notReady(GATE.assetSearch.label);
}

export async function getSnapshots({ assetIds } = {}) {
  const gated = gatedOrNull(GATE.snapshot);
  if (gated !== null) return gated;
  return assembleSnapshots(assetIds ?? [], marketEnv());
}

export async function getCandles() {
  const gated = gatedOrNull(GATE.candles);
  if (gated !== null) return gated;
  notReady(GATE.candles.label);
}
export async function getTrades() {
  const gated = gatedOrNull(GATE.trades);
  if (gated !== null) return gated;
  notReady(GATE.trades.label);
}
export async function getHolders() {
  const gated = gatedOrNull(GATE.holders);
  if (gated !== null) return gated;
  notReady(GATE.holders.label);
}

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
