// Runtime capability + registry snapshot (M0, 2026-10-05).
//
// This is the SHIPPED twin of the script-verified seeds:
//   scripts/defi-evidence/betanet.capability-matrix.json
//   scripts/defi-evidence/betanet.registry-seed.json
// (authored in docs/defi/REGISTRY_AND_CAPABILITY_SEED.md, gate G0).
//
// Why a snapshot in code: the real DeFi registry service is build-order step 3 (POST-G0) and
// its chain/feed evidence does not exist yet. Until it lands, the discovery READ methods
// (program.capabilities / program.list / program.networks / feed.status / feed.lookup) answer
// from this snapshot, which contains only evidence-backed values or explicit nulls. It is a
// narrow compatibility seam with a named exit condition, not a second source of truth:
//
//   EXIT: replaced by the registry service reading live evidence. test/test-defi-m0.mjs pins
//   this module to the scripts/*.json seeds by deep equality, so the two can never drift
//   silently; when the registry lands, this file is deleted and the pin test retires with it.
//
// Never hand-edit values here without updating the seed JSON + evidence log in the same change
// (evidence protocol: scripts/defi-evidence/README.md).

export const SNAPSHOT_META = Object.freeze({
  networkId: 'betanet',
  registryVersion: 0,
  matrixVersion: 0,
  updatedAt: '2026-10-05',
  source: 'scripts/defi-evidence (G0 seeds) — pinned by test/test-defi-m0.mjs',
});

/**
 * Chain identity these records were seeded against (B3, G1-A). Computed at seed time with
 * history-service.chainFingerprint(getNetworkConfig('betanet')) and PINNED here as data —
 * it must NOT silently track networks.js edits. When a managed genesis swap (or any edit to
 * the managed program set) changes the runtime fingerprint, the registry reports every
 * seed-derived capability as NETWORK_RESET until the evidence process re-seeds this file with
 * fresh facts. test/test-defi-registry.mjs pins this against the live derivation, so a drift
 * fails the build instead of silently re-trusting stale records.
 */
export const SEED_FINGERPRINT = 'betanet|taEOAD2uLK1SLzPgtabFLUAx22yDlBs9DE9nZFTOESIGRr|taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE|taFCTxR0y2eabGGaEdtTwC9pHz7ZY4CYD7FOiBFUJeAW16|taTigKYAf5mNxUNUVXeXq1HQodKc07DBzF4Pl7tCi1iXxt|taNOOPV4A7S3WTsirr149To2GoGZ9q8zllQaBrbekHfkJT';

/**
 * Program records. Addresses come from the pinned official packages exactly as
 * src/lib/networks.js sources them; verification state is layered on top (OG-G0). `null`
 * address means "no program found" — an honest absence, not a placeholder.
 */
export const PROGRAMS = Object.freeze([
  Object.freeze({
    role: 'token',
    address: 'taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE',
    trust: 'unverified',
    verification: 'goldenTested',
    changeStatus: 'unknown',
    managementState: 'bootstrap-managed (package-declared; live upgrade authority unverified)',
    updatedAt: '2026-10-05',
    evidenceRef: ['2026-10-05-package-surface', 'repo: wire goldens vs @thru/programs/token 0.4.1'],
  }),
  Object.freeze({
    role: 'amm',
    address: 'taAMMx8gG44RcOyRqNYZ55pDaAJoGS0R8kPYxBN96sO8kD',
    trust: 'unverified',
    verification: 'unknown',
    changeStatus: 'unknown',
    managementState: 'bootstrap-managed (package-declared; live deployment, upgrade authority and pool-creation control unverified)',
    updatedAt: '2026-10-05',
    evidenceRef: ['2026-10-05-package-surface'],
  }),
  Object.freeze({
    role: 'curve',
    address: null,
    trust: 'unverified',
    verification: 'unknown',
    changeStatus: 'unknown',
    managementState: 'none found',
    updatedAt: '2026-10-05',
    evidenceRef: ['2026-10-05-package-surface'],
  }),
  Object.freeze({
    role: 'multicall',
    address: 'taMULTIrOL8WpIFr16C1ECsO60qAsuwmwJephZHDOTvSeP',
    trust: 'unverified',
    verification: 'unknown',
    changeStatus: 'unknown',
    managementState: 'bootstrap-managed (package-declared)',
    updatedAt: '2026-10-05',
    evidenceRef: ['2026-10-05-package-surface', '2026-10-05-official-docs'],
  }),
  Object.freeze({
    role: 'oracle',
    address: 'taORCLOkTSYq5enR2XOGoSDmzMc0P5NlqjP8nKpfd3vgps',
    trust: 'unverified',
    verification: 'unknown',
    changeStatus: 'unknown',
    managementState: 'bootstrap-managed (package-declared)',
    updatedAt: '2026-10-05',
    evidenceRef: ['2026-10-05-package-surface'],
  }),
]);

/**
 * Feature capability matrix (13 rows). `state: 'enabled'` exists only for wallet-core features
 * with shipped code + observed live behavior; every DeFi-facing feature is unsupported with an
 * S10 reason. This is the dossier the gate resolver falls back to once a flag is on.
 */
export const FEATURES = Object.freeze([
  Object.freeze({ key: 'balances', state: 'enabled', reason: null,
    evidenceRef: ['repo: contract v8-v16 balance services', 'docs/AUDIT_REPORT.md gate C 2026-10-04'] }),
  Object.freeze({ key: 'tokenTransfer', state: 'enabled', reason: null,
    evidenceRef: ['repo: contract v8 token.transferChecked shipped'] }),
  Object.freeze({ key: 'swap', state: 'unsupported', reason: 'PROGRAM_NOT_VERIFIED',
    evidenceRef: ['registry role=amm'] }),
  Object.freeze({ key: 'pools', state: 'unsupported', reason: 'PROGRAM_NOT_VERIFIED',
    evidenceRef: ['registry role=amm'] }),
  Object.freeze({ key: 'launchMint', state: 'unsupported', reason: 'TOKEN_PATH_UNVERIFIED',
    evidenceRef: ['docs/BACKEND_GAPS.md C1/C2', 'registry role=token'] }),
  Object.freeze({ key: 'launchDirectPool', state: 'unsupported', reason: 'DEPENDENCY_UNVERIFIED',
    evidenceRef: ['matrix: launchMint', 'matrix: pools'] }),
  Object.freeze({ key: 'launchCurve', state: 'unsupported', reason: 'LAUNCH_MODEL_UNAVAILABLE',
    evidenceRef: ['registry role=curve'] }),
  Object.freeze({ key: 'migrate', state: 'unsupported', reason: 'LAUNCH_MODEL_UNAVAILABLE',
    evidenceRef: ['registry role=curve'] }),
  Object.freeze({ key: 'claim', state: 'unsupported', reason: 'LAUNCH_MODEL_UNAVAILABLE',
    evidenceRef: ['registry role=curve'] }),
  Object.freeze({ key: 'charts', state: 'unsupported', reason: 'NO_INDEXER',
    evidenceRef: ['docs/defi/DECISIONS_G0.md D2'] }),
  Object.freeze({ key: 'discovery', state: 'unsupported', reason: 'NO_INDEXER',
    evidenceRef: ['docs/defi/DECISIONS_G0.md D2'] }),
  Object.freeze({ key: 'simulation', state: 'unsupported', reason: 'NO_SIMULATION',
    evidenceRef: ['docs/BACKEND_GAPS.md C3', '2026-10-05-official-docs'] }),
  Object.freeze({ key: 'usd', state: 'unsupported', reason: 'DEPENDENCY_UNVERIFIED',
    evidenceRef: ['registry role=oracle'] }),
]);

/** product limits — PROJECT INPUTS section 5 starting values (defaults, owner-confirmed). */
export const LIMITS = Object.freeze({
  quoteTtlMs: 15000,
  preparedTtlMs: 120000,
  slippageDefaultBps: 50,
  slippageWarnBps: 300,
  slippageMaxBps: 2000,
  priceImpactWarnBps: 500,
  priceImpactBlockBps: 1500,
  usdLiquidityFloorThru: null, // not set until a USD source is verified (D8)
  maxCandles: 1000,
  pollMinMs: 5000,
});

/**
 * Feed trust policy (G1-B). Honestly EMPTY everywhere: no publisher key is pinned, quorum is
 * zero (no feed can be live), and no feature requires a feed. The PINNING RULE is the whole
 * point: a publisher key enters `publishers` ONLY via the evidence chain — a live probe on a
 * network-reachable machine (oracle/feed evidence), mirrored into this snapshot with its
 * evidenceRef, pinned by the fixture tests. Transport, storage, and UI can never pin a key.
 * A signed feed can only NARROW this matrix (kill vote / required-feed check), never widen it.
 */
export const FEED_POLICY = Object.freeze({
  policyVersion: 1,
  publishers: Object.freeze([]), // hex-encoded 32-byte Ed25519 keys, evidence-pinned only
  quorum: 0,                     // distinct valid publishers required for LIVE
  requireFeed: Object.freeze({}), // featureKey -> feedId that must be LIVE for the feature
  clockSkewMs: 300000,           // issued-at future tolerance
});

/**
 * Aggregated program facts for the Capabilities wire shape: evidence-backed address or null,
 * keyed by role. Derived from PROGRAMS so the two cannot disagree.
 */
export function programFacts() {
  const facts = {};
  for (const program of PROGRAMS) facts[program.role] = program.address;
  return facts;
}

/** Look up one feature row. @returns {{ key, state, reason, evidenceRef } | null} */
export function getFeature(key) {
  return FEATURES.find((f) => f.key === key) ?? null;
}
