// DeFi registry service (G1-A, 2026-10-05).
//
// The single owner of DeFi program/feed/feature records and capability derivation. Before
// this existed, program-service and gating read the evidence snapshot directly; those reads
// now go through here so verification state, genesis binding, and invalidation live in ONE
// place (appendix B placement: registry is a distinct background service, not a feature; the
// feature adapters that consume it arrive with swap/pool work).
//
// B3 genesis binding — STATELESS, no storage:
//   The seed embeds the chain fingerprint it was verified against (SEED_FINGERPRINT in
//   ./defi/capability-snapshot.js, pinned by test). At read time the runtime fingerprint is
//   re-derived from networks.js via the SAME chainFingerprint() the history cache uses — an
//   offline value that changes exactly when the managed program set changes (i.e. a genesis
//   swap). If the two differ, every seed-derived capability downgrades to NETWORK_RESET:
//   records are statements about the seed chain and never silently follow it to a new one.
//   Because the seed pin is data in the snapshot (not a live computation), this check is
//   restart-proof and needs zero chrome.storage traffic on the read path.
//
// Feeds: no publisher is verified today, so the feed registry is an empty, typed list with
// verification gates documented. Nothing here fabricates a feed.
//
// Events: the first detected alignment TRANSITION emits capabilitiesChanged (S7 — emitted on
// real state change, never on schedule). Boot does not fire: the first read establishes the
// baseline silently.

import { SNAPSHOT_META, PROGRAMS, FEATURES, LIMITS, SEED_FINGERPRINT } from './defi/capability-snapshot.js';
import { chainFingerprint } from './history-service.js';
import { getNetworkConfig } from '../../lib/networks.js';
import { emitCapabilitiesChanged } from './event-service.js';
import { listMethodNames } from '../../shared/contract/manifest.js';
import { isDefiMethod, getDefiSpec } from '../../shared/contract/defi-schema.js';
import { isDefiFeatureEnabled } from '../../shared/flags.js';

const REGISTRY_NETWORK = SNAPSHOT_META.networkId;

/** Runtime chain fingerprint (offline). null for unknown/custom ids. */
export function currentChainFingerprint(networkId) {
  try {
    return chainFingerprint(getNetworkConfig(networkId));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Test seam (documented like history-service.chainFingerprint): alignment is a pure function
// of two strings; tests inject a stale runtime fingerprint to prove the B3 invalidation path
// without editing networks.js. Production never overrides.
// ---------------------------------------------------------------------------
let fingerprintOverride = null;
export function _setFingerprintForTests(value) {
  fingerprintOverride = typeof value === 'string' ? value : null;
}

function runtimeFingerprint(networkId) {
  return fingerprintOverride ?? currentChainFingerprint(networkId);
}

/**
 * Is the runtime chain the one the seed evidence was verified against?
 * @param {string} [networkId]
 */
export function isGenesisAligned(networkId = REGISTRY_NETWORK) {
  if (networkId !== REGISTRY_NETWORK) return false;
  const current = runtimeFingerprint(networkId);
  return current !== null && current === SEED_FINGERPRINT;
}

/**
 * Post-binding view of one feature row. On a genesis mismatch, EVERY seed-derived row —
 * including wallet-core 'enabled' rows — downgrades to unsupported/NETWORK_RESET: the facts
 * behind it belong to a chain that no longer exists (R12 fail-closed, B3).
 */
export function getFeature(key, { networkId = REGISTRY_NETWORK } = {}) {
  const row = FEATURES.find((f) => f.key === key) ?? null;
  if (!row) return null;
  if (networkId !== REGISTRY_NETWORK || !isGenesisAligned(networkId)) {
    return {
      ...row,
      state: 'unsupported',
      reason: 'NETWORK_RESET',
      evidenceRef: [...row.evidenceRef, 'genesis binding: seed fingerprint stale — re-verify before trusting'],
    };
  }
  return row;
}

/** Post-binding program facts: recorded seed values (a statement about the seed chain). */
export function getProgramFacts(networkId = REGISTRY_NETWORK) {
  if (networkId !== REGISTRY_NETWORK) return null;
  const facts = {};
  for (const program of PROGRAMS) facts[program.role] = program.address;
  return facts;
}

/** The typed feed registry. Empty is the truth today: no publisher key is pinned anywhere. */
export function listFeeds(networkId = REGISTRY_NETWORK) {
  if (networkId !== REGISTRY_NETWORK) return null;
  return [];
}

export function getProgramRecords(networkId = REGISTRY_NETWORK) {
  if (networkId !== REGISTRY_NETWORK) return null;
  return PROGRAMS.map((p) => ({ ...p }));
}

/**
 * The full registry record. `features`/`programs` are the records as seeded; consumers must
 * use getFeature()/deriveCapabilities() for the post-binding view.
 */
export function getRegistry(networkId = REGISTRY_NETWORK) {
  if (networkId !== REGISTRY_NETWORK) return null;
  return {
    networkId: REGISTRY_NETWORK,
    registryVersion: SNAPSHOT_META.registryVersion,
    matrixVersion: SNAPSHOT_META.matrixVersion,
    seededAt: SNAPSHOT_META.updatedAt,
    seedFingerprint: SEED_FINGERPRINT,
    currentFingerprint: runtimeFingerprint(networkId),
    genesisAligned: isGenesisAligned(networkId),
    programs: getProgramRecords(networkId),
    feeds: listFeeds(networkId),
    features: FEATURES.map((f) => getFeature(f.key, { networkId })),
    limits: { ...LIMITS },
  };
}

// ---------------------------------------------------------------------------
// Capability derivation (the Capabilities wire payload)
// ---------------------------------------------------------------------------

function deriveFeatureCapabilities(networkId) {
  const aligned = isGenesisAligned(networkId);
  const caps = {};
  for (const row of FEATURES) {
    if (!aligned) {
      caps[row.key] = { supported: false, reason: 'NETWORK_RESET' };
      continue;
    }
    caps[row.key] = row.state === 'enabled' ? true : { supported: false, reason: row.reason };
  }
  return caps;
}

/**
 * Capabilities.methodCapabilities: EVERY method in the contract (wallet-core true; DeFi via
 * the same gate ladder the handlers use), so the matrix can never silently drift from the
 * shipped surface. Flags dominate the dossier: with flags off a method answers FLAG_OFF even
 * while the registry is misaligned (a flag-off method was unreachable either way).
 */
function deriveMethodCapabilities(networkId) {
  const caps = {};
  for (const method of listMethodNames()) {
    if (!isDefiMethod(method)) {
      caps[method] = true;
      continue;
    }
    const { spec } = getDefiSpec(method);
    if (spec.gate === 'always') {
      caps[method] = true;
      continue;
    }
    if (!isDefiFeatureEnabled(spec.gate)) {
      caps[method] = { supported: false, reason: 'FLAG_OFF' };
      continue;
    }
    if (spec.feature) {
      const dossier = getFeature(spec.feature, { networkId });
      if (dossier && dossier.state !== 'enabled') {
        caps[method] = { supported: false, reason: dossier.reason };
        continue;
      }
    }
    caps[method] = true;
  }
  return caps;
}

// Alignment transition tracking: fire capabilitiesChanged on a REAL change only (S7). The
// first derivation at boot establishes the baseline silently; later transitions fire once.
let lastAlignment = null;

function noteAlignmentTransition(networkId, aligned) {
  if (lastAlignment === null) {
    lastAlignment = aligned;
    return;
  }
  if (lastAlignment === aligned) return;
  lastAlignment = aligned;
  emitCapabilitiesChanged({
    networkId,
    genesisAligned: aligned,
    reason: aligned ? null : 'NETWORK_RESET',
  });
}

/**
 * The complete Capabilities wire payload for one network (or CUSTOM_NETWORK-shaped null for
 * anything without a registry binding — the caller maps that).
 */
export function deriveCapabilities(networkId = REGISTRY_NETWORK) {
  if (networkId !== REGISTRY_NETWORK) return null;
  const aligned = isGenesisAligned(networkId);
  noteAlignmentTransition(networkId, aligned);
  return {
    networkId: REGISTRY_NETWORK,
    registryVersion: SNAPSHOT_META.registryVersion,
    matrixVersion: SNAPSHOT_META.matrixVersion,
    genesis: {
      aligned,
      seedFingerprint: SEED_FINGERPRINT,
      currentFingerprint: runtimeFingerprint(networkId),
    },
    programFacts: getProgramFacts(networkId),
    methodCapabilities: deriveMethodCapabilities(networkId),
    featureCapabilities: deriveFeatureCapabilities(networkId),
    limits: { ...LIMITS },
  };
}

/** Test-only alignment baseline reset (service-worker restart simulation). */
export function _resetAlignmentBaselineForTests() {
  lastAlignment = null;
}
