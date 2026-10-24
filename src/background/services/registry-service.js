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

import { SNAPSHOT_META, PROGRAMS, FEATURES, LIMITS, SEED_FINGERPRINT, FEED_POLICY } from './defi/capability-snapshot.js';
import { chainFingerprint } from './history-service.js';
import { getNetworkConfig } from '../../lib/networks.js';
import { emitCapabilitiesChanged, emitFeedChanged } from './event-service.js';
import { listMethodNames } from '../../shared/contract/manifest.js';
import { isDefiMethod, getDefiSpec } from '../../shared/contract/defi-schema.js';
import { isDefiFeatureEnabled } from '../../shared/flags.js';
import { aggregateFeedState, defaultAggregate, AGGREGATE_STATES } from './defi/feed-record.js';

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

// ---------------------------------------------------------------------------
// Feed narrowing (G1-B). Verification is async; READS are sync — so records verify at intake
// (refreshFeedVerdicts) and sync readers consume the last-verified aggregate. The shipped
// default is the honestly-empty policy (no publishers, quorum 0): narrowing can never fire in
// this build and the cache is the INERT aggregate without a single crypto call. Feeds narrow,
// never widen: an overlay applies only to an 'enabled' dossier row.
// ---------------------------------------------------------------------------
let feedRecordsOverride = null;   // test seam only — transport arrives in a later slice
let feedPolicyOverride = null;    // test seam only
let cachedFeedAggregate = defaultAggregate(FEED_POLICY);
let lastFeedSignature = null;

const effectiveFeedPolicy = () => feedPolicyOverride ?? FEED_POLICY;
const effectiveFeedRecords = () => feedRecordsOverride ?? [];

function feedTransitionSignature(aggregate) {
  return JSON.stringify([aggregate.state, aggregate.killFeatures, aggregate.liveFeedIds]);
}

/** Re-verifies the presented records against the CURRENT runtime fingerprint and policy. */
export async function refreshFeedVerdicts(networkId = REGISTRY_NETWORK) {
  const policy = effectiveFeedPolicy();
  const aggregate = await aggregateFeedState(effectiveFeedRecords(), policy, {
    networkId,
    fingerprint: runtimeFingerprint(networkId) ?? '',
    pinnedPublishers: policy.publishers,
    now: Date.now(),
    clockSkewMs: policy.clockSkewMs,
    knownFeatures: FEATURES.map((f) => f.key),
  });
  cachedFeedAggregate = aggregate;
  const sig = feedTransitionSignature(aggregate);
  if (lastFeedSignature === null) {
    lastFeedSignature = sig; // boot establishes the baseline silently (S7)
    return aggregate;
  }
  if (lastFeedSignature !== sig) {
    lastFeedSignature = sig;
    emitFeedChanged({
      networkId,
      state: aggregate.state,
      killFeatures: [...aggregate.killFeatures],
      liveFeedIds: [...aggregate.liveFeedIds],
    });
  }
  return aggregate;
}

/** The last-verified feed aggregate (sync). INERT under the shipped policy. */
export function getFeedState() {
  return cachedFeedAggregate;
}

/** KILL_SWITCH / FEED_MISSING for an ENABLED feature, or null. Genesis runs before this. */
function feedNarrowingReason(featureKey) {
  const aggregate = cachedFeedAggregate;
  if (aggregate.killFeatures.includes(featureKey)) return 'KILL_SWITCH';
  const policy = effectiveFeedPolicy();
  const required = policy.requireFeed?.[featureKey] ?? null;
  if (required !== null && !aggregate.liveFeedIds.includes(required)) return 'FEED_MISSING';
  return null;
}

/**
 * Test seam (documented like _setFingerprintForTests): injects records/policy and RE-VERIFIES
 * so sync readers see the fresh aggregate. Production never calls this — record transport and
 * an evidence-pinned feed config land in a later slice.
 */
export async function _setFeedStateForTests(value) {
  feedRecordsOverride = value?.records ?? null;
  feedPolicyOverride = value?.policy ?? null;
  await refreshFeedVerdicts();
}

/** Test-only feed baseline reset (service-worker restart simulation). */
export function _resetFeedBaselineForTests() {
  feedRecordsOverride = null;
  feedPolicyOverride = null;
  cachedFeedAggregate = defaultAggregate(FEED_POLICY);
  lastFeedSignature = null;
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
 * Post-binding, post-narrowing view of one feature row.
 * Priority: genesis binding → feed narrowing → dossier.
 * 1. On a genesis mismatch, EVERY seed-derived row — including wallet-core 'enabled' rows —
 *    downgrades to unsupported/NETWORK_RESET (R12 fail-closed, B3). A kill record signed for
 *    the old genesis dies with it: records verify against the runtime fingerprint, so the
 *    narrowing below can only ever fire under the current binding.
 * 2. On an aligned, ENABLED row, a last-verified feed aggregate can narrow to KILL_SWITCH
 *    (quorum'd kill vote) or FEED_MISSING (a required live feed is absent). Narrowing never
 *    touches an already-unsupported row — feeds narrow, never widen.
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
  if (row.state === 'enabled') {
    const narrow = feedNarrowingReason(key);
    if (narrow) {
      return {
        ...row,
        state: 'unsupported',
        reason: narrow,
        evidenceRef: [...row.evidenceRef, `feed narrowing: ${narrow}`],
      };
    }
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
  const caps = {};
  for (const row of FEATURES) {
    // getFeature carries genesis binding AND feed narrowing, so the wire view, the gate, and
    // the risk facts can never disagree about one feature's state.
    const view = getFeature(row.key, { networkId });
    caps[row.key] = view.state === 'enabled' ? true : { supported: false, reason: view.reason };
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
