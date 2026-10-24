// Risk assessment READ surface (M0). Facts-only: every entry derives from the evidence-pinned
// registry/capability snapshot. No scores, no advice, no "warning fatigue" prose — the dossier
// service contract (green/grey/yellow/red, facts before warnings, offline-safe) is implemented
// here against the snapshot so the behavior is real the moment DEFI_RISK ships.
//
// Gate env is 'error': RiskReport cannot carry a supported:false variant, so a disabled gate
// answers FEATURE_DISABLED instead of a fake-empty report.

import { gateOrThrow } from './defi/gating.js';
// Facts derive from the registry's post-binding view (G1-A): identical under alignment,
// NETWORK_RESET-aware when the seed chain drifts.
import * as registry from './registry-service.js';
import { SNAPSHOT_META } from './defi/capability-snapshot.js';

const getFeature = (key) => registry.getFeature(key);
const programFacts = () => registry.getProgramFacts();

const GATE = { gate: 'DEFI_RISK', feature: null, env: 'error', label: 'Risk assessment' };

/**
 * Derive the RiskReport for an asset from snapshot facts. With no verified feeds, no verified
 * programs, and no USD source, the honest report for ANY asset is "unverified" with the
 * blocking facts stated. This function never receives feed or chain input it cannot source.
 */
function deriveRiskReport(assetId) {
  const facts = {
    assetId,
    registry: {
      networkId: SNAPSHOT_META.networkId,
      registryVersion: SNAPSHOT_META.registryVersion,
      // Evidence-backed addresses or null, straight from the seed — no derived claims.
      programs: programFacts(),
    },
    feed: { hasVerifiedFeed: false, feedCount: 0 },
    usd: { sourceVerified: false, reason: getFeature('usd')?.reason ?? null },
    launch: {
      mintPathVerified: false,
      curveProgram: null, // no curve/launch program found package-side or live (Q20)
    },
  };

  const warnings = [];
  const push = (code, severity, how) => warnings.push({ code, severity, how });

  push(
    'ASSET_UNVERIFIED',
    'red',
    'No verified feed, registry listing, or live verification exists for this asset id. '
      + 'Treat all displayed metadata as unverified user-supplied or attacker-controlled text.',
  );
  push(
    'USD_UNAVAILABLE',
    'grey',
    'No verified USD source (oracle record unverified, probe pending). USD values must render '
      + 'as a dash, never as a derived guess.',
  );
  const launchRow = getFeature('launchMint');
  if (launchRow?.state !== 'enabled') {
    push(
      'LAUNCH_PATH_UNVERIFIED',
      'grey',
      `Token launch path is not verified (${launchRow?.reason ?? 'UNSUPPORTED'}); creation `
        + 'flows must stay gated off even if the UI is reachable.',
    );
  }
  const feedRows = [getFeature('charts'), getFeature('discovery')].filter(Boolean);
  if (feedRows.some((f) => f.state !== 'enabled')) {
    push(
      'MARKET_DATA_ABSENT',
      'grey',
      'No indexer or market-data pipeline is verified; any price/volume/chart display for this '
        + 'asset would be fabricated here and is therefore absent.',
    );
  }

  // maxSeverity is the max of emitted warnings (facts themselves never leave grey).
  const ORDER = ['none', 'grey', 'yellow', 'red'];
  const maxSeverity = warnings.reduce(
    (max, w) => (ORDER.indexOf(w.severity) > ORDER.indexOf(max) ? w.severity : max),
    'none',
  );

  return {
    facts,
    warnings,
    maxSeverity,
    listStatus: 'unverified', // strict allowlist exists only when a verified feed exists (FEEDS)
    freshness: { asOf: SNAPSHOT_META.updatedAt, maxAgeSec: null, stale: false },
  };
}

export async function assessAsset({ assetId }) {
  // env:'error' — throws FEATURE_DISABLED while the flag is off. The derivation below is real
  // and tested (fixtures drive it with the flag flipped in-memory): it changes only when the
  // evidence changes.
  gateOrThrow(GATE);
  return deriveRiskReport(assetId);
}
