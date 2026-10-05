// Machine-readable schema for the DeFi contract surface (contract v17 READ + v18 EXEC).
//
// This is the S13 "sibling schema file": the manifest (manifest.js) stays the human contract
// and the router's allowlist; THIS file is the machine schema next to it — per-method params
// with types, result shapes, capability gates, group (S3: READ / LOCAL / PREPARE / EXECUTE),
// feature mapping (capability matrix keys), and the declared error codes a method may raise.
//
// Consumers:
//   - api-router.js validates params through validateDefiParams() BEFORE any DeFi service runs
//     (DEFI-03/B12: validate parameter types before touching a service).
//   - test/test-defi-m0.mjs enforces schema <-> manifest coherence, fixture shape coverage and
//     fixture <-> handler integrity.
//   - The frontend team consumes this file (plus the fixtures) as the machine-readable
//     contract of record for building screens before the features are enabled.
//
// Rules (mirror manifest.js): append-only; never change an existing method's params; methods
// appear here in the same commit they appear in the manifest. `since` lives in the manifest.

// ---- S3 method groups ----------------------------------------------------

export const DEFI_GROUPS = Object.freeze({
  /** Server-driven, returns current truth or an explicit unsupported state. Safe to poll. */
  READ: 'R',
  /** Local, non-secret, network-scoped storage. No network traffic. */
  LOCAL: 'L',
  /** Builds a transaction or review. No signing, no submission. */
  PREPARE: 'P',
  /** Signs and submits. Starts and resumes intent lifecycle. */
  EXECUTE: 'X',
});

// ---- S10 unsupported reasons (closed enum) --------------------------------
// These are the ONLY values an Unsupported.reason field may carry. Deliberate additions to
// this enum are a contract event. CUSTOM_NETWORK is the D14/v7 quarantine reason carried over
// from the registry seed; it is a permanent state, never a guess.

export const UNSUPPORTED_REASONS = Object.freeze([
  'FULL_NODE_ONLY',
  'FEE_RESERVE_REQUIRED',
  'PROGRAM_NOT_VERIFIED',
  'DESTINATION_POOL_PRE_EXISTING',
  'LAUNCH_MODEL_UNAVAILABLE',
  'GUARD_CANNED',
  'GUARD_TIMEOUT',
  'TOKEN_ACCOUNT_CONSTRAINT',
  'TOKEN_PROGRAM_MISMATCH',
  'CAPABILITY_OUTDATED',
  'FEED_STALE',
  'FEED_QUORUM_FAILED',
  'TOKEN_PATH_UNVERIFIED',
  'NO_INDEXER',
  'NO_SIMULATION',
  'UPGRADE_AUTHORITY_UNVERIFIED',
  'DEPENDENCY_UNVERIFIED',
  'NETWORK_MISMATCH',
  'NETWORK_RESET',
  'SLOT_TOO_OLD',
  'KILL_SWITCH',
  'FLAG_OFF',
  'CUSTOM_NETWORK',
]);

// ---- Param type tags ------------------------------------------------------
// 'string' | 'string?'        non-empty string, max 512 chars ('?' = optional)
// 'id' | 'id?'                non-empty string, max 128 chars (ids, addresses, cursors)
// 'baseUnits'                 decimal string of a non-negative integer (money stays a string)
// 'int' | 'int?'              Number.isInteger
// 'bool' | 'bool?'            boolean
// 'object' | 'object?'        plain (non-array) object
// 'strings' | 'strings?'      array of ids
// 'payload'                   image payload object { bytesBase64, mime } (bounded)

const MAX_STRING = 512;
const MAX_ID = 128;
export const MAX_IMAGE_B64_CHARS = 7_000_000; // ~5 MB binary after base64 — hard cap at the door

function checkParam(tag, value) {
  const optional = tag.endsWith('?');
  const base = optional ? tag.slice(0, -1) : tag;
  if (value === undefined || value === null) {
    return optional ? null : 'is required';
  }
  switch (base) {
    case 'string':
      return (typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING)
        ? null : `must be a non-empty string of at most ${MAX_STRING} chars`;
    case 'id':
      return (typeof value === 'string' && value.length > 0 && value.length <= MAX_ID)
        ? null : `must be a non-empty string of at most ${MAX_ID} chars`;
    case 'baseUnits':
      return (typeof value === 'string' && /^[0-9]+$/.test(value))
        ? null : 'must be a non-negative integer as a decimal string (base units, never a float)';
    case 'int':
      return Number.isInteger(value) ? null : 'must be an integer';
    case 'bool':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'object':
      return (value && typeof value === 'object' && !Array.isArray(value)) ? null : 'must be an object';
    case 'strings': {
      if (!Array.isArray(value) || value.length === 0) return 'must be a non-empty array';
      if (value.length > 100) return 'must contain at most 100 entries';
      return value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID)
        ? null : 'must be an array of non-empty id strings';
    }
    case 'payload': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 'must be an object';
      if (typeof value.mime !== 'string' || !/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(value.mime)) {
        return 'mime must be an image/* type (png, jpeg, webp, gif, svg)';
      }
      if (typeof value.bytesBase64 !== 'string' || value.bytesBase64.length === 0) {
        return 'bytesBase64 must be a non-empty base64 string';
      }
      if (value.bytesBase64.length > MAX_IMAGE_B64_CHARS) return 'image exceeds the 5 MB cap';
      return null;
    }
    default:
      return `unknown param tag '${tag}'`;
  }
}

// ---- Per-method schema ----------------------------------------------------
//
// Common fields:
//   group    R | L | P | X
//   gate     'always'  — callable in every build (discovery reads the frontend needs to render
//                        unsupported states; S13) or a DEFI_* flag name checked via the
//                        build-time flags (master switch included).
//   env      'result' — gate-off/unsupported arrives INSIDE data as { supported:false, reason }
//            'error'  — it arrives as the error envelope { ok:false, error:{ code } }
//   feature  capability-matrix feature key used for dossier reasons once the flag is on
//            (null = no dossier fallback; gate-off is the only M0 outcome).
//   params   typed map; names MUST equal the manifest's params list (test-enforced).
//   resultKeys  top-level keys every SUCCESS variant carries (fixtures are validated on this).
//   errors   error codes this method may raise BY DESIGN (fixtures cover each one at M0).

export const DEFI_METHODS = Object.freeze({

  // ---- v17: READ surface ---------------------------------------------------

  'program.capabilities': {
    group: 'R', gate: 'always', env: 'result', feature: null,
    params: { networkId: 'id?' },
    resultKeys: ['networkId', 'registryVersion', 'matrixVersion', 'programFacts', 'methodCapabilities', 'featureCapabilities', 'limits'],
    errors: [],
  },
  'program.list': {
    group: 'R', gate: 'always', env: 'result', feature: null,
    params: { networkId: 'id?' },
    resultKeys: ['networkId', 'programs'],
    errors: [],
  },
  'feed.status': {
    group: 'R', gate: 'always', env: 'result', feature: null,
    params: { networkId: 'id?' },
    resultKeys: ['feeds'],
    errors: [],
  },
  'feed.lookup': {
    group: 'R', gate: 'always', env: 'result', feature: null,
    params: { ids: 'strings' },
    resultKeys: ['feeds'],
    errors: ['INVALID_INPUT'],
  },

  'market.assetGet': {
    group: 'R', gate: 'DEFI_MARKET', env: 'result', feature: 'discovery',
    params: { assetId: 'id' },
    resultKeys: ['header', 'facts', 'price', 'charts', 'trades', 'holders', 'risk', 'launch'],
    errors: ['INVALID_INPUT', 'RPC_UNAVAILABLE'],
  },
  'market.assetSearch': {
    group: 'R', gate: 'DEFI_MARKET', env: 'result', feature: 'discovery',
    params: { query: 'string', limit: 'int?' },
    resultKeys: ['hits'],
    errors: ['INVALID_INPUT', 'RATE_LIMITED'],
  },
  'market.snapshot': {
    group: 'R', gate: 'DEFI_MARKET', env: 'result', feature: 'discovery',
    params: { assetIds: 'strings' },
    resultKeys: ['snapshots'],
    errors: ['INVALID_INPUT'],
  },
  'market.candles': {
    group: 'R', gate: 'DEFI_MARKET', env: 'result', feature: 'charts',
    params: { assetId: 'id', poolId: 'id?', interval: 'string', range: 'object?' },
    resultKeys: ['interval', 'range', 'candles'],
    errors: ['INVALID_INPUT', 'RPC_UNAVAILABLE', 'UPSTREAM_UNAVAILABLE'],
  },
  'market.trades': {
    group: 'R', gate: 'DEFI_MARKET', env: 'result', feature: 'discovery',
    params: { assetId: 'id', poolId: 'id?', cursor: 'id?', limit: 'int?' },
    resultKeys: ['trades', 'nextCursor'],
    errors: ['INVALID_INPUT', 'RPC_UNAVAILABLE'],
  },
  'market.holders': {
    group: 'R', gate: 'DEFI_MARKET', env: 'result', feature: 'discovery',
    params: { assetId: 'id', cursor: 'id?', limit: 'int?' },
    resultKeys: ['rows', 'nextCursor'],
    errors: ['INVALID_INPUT', 'RPC_UNAVAILABLE'],
  },

  'risk.assetAssess': {
    group: 'R', gate: 'DEFI_RISK', env: 'error', feature: null,
    params: { assetId: 'id' },
    resultKeys: ['facts', 'warnings', 'maxSeverity', 'listStatus', 'freshness'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },

  'launchpad.list': {
    group: 'R', gate: 'DEFI_READ', env: 'result', feature: 'discovery',
    params: { networkId: 'id?', sort: 'string?', cursor: 'id?', limit: 'int?' },
    resultKeys: ['items', 'nextCursor', 'updatedAt', 'source'],
    errors: ['INVALID_INPUT', 'RPC_UNAVAILABLE'],
  },
  'launchpad.get': {
    group: 'R', gate: 'DEFI_READ', env: 'result', feature: 'discovery',
    params: { launchId: 'id' },
    resultKeys: ['header', 'assets', 'curve', 'pool', 'trades', 'distribution', 'links', 'yourActions', 'feedState'],
    errors: ['INVALID_INPUT', 'RPC_UNAVAILABLE'],
  },
  'launchpad.templates': {
    group: 'R', gate: 'DEFI_READ', env: 'result', feature: 'launchMint',
    params: {},
    resultKeys: ['templates'],
    errors: [],
  },
  'launchpad.listMine': {
    group: 'R', gate: 'DEFI_READ', env: 'error', feature: 'launchMint',
    params: { address: 'id' },
    resultKeys: ['launches'],
    errors: ['FEATURE_DISABLED', 'UNSUPPORTED', 'INVALID_INPUT'],
  },
  'launchpad.validateDraft': {
    // feature is null on purpose: this method's JOB is to report the launch-blocking strands
    // (it works offline from rules + the dossier), so the dossier rung must not gate it off.
    group: 'R', gate: 'DEFI_READ', env: 'error', feature: null,
    params: { networkId: 'id', draft: 'object' },
    resultKeys: ['identity', 'curve', 'strands', 'errors', 'warnings'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },

  'dex.listPools': {
    group: 'R', gate: 'DEFI_READ', env: 'result', feature: 'pools',
    params: { networkId: 'id?', assetId: 'id?', cursor: 'id?', limit: 'int?' },
    resultKeys: ['items', 'nextCursor', 'updatedAt', 'source'],
    errors: ['INVALID_INPUT', 'RPC_UNAVAILABLE'],
  },
  'dex.getPool': {
    group: 'R', gate: 'DEFI_READ', env: 'result', feature: 'pools',
    params: { poolId: 'id' },
    resultKeys: ['header', 'assets', 'reserves', 'fee', 'volume', 'apxe', 'positions', 'charts', 'risk', 'oracle', 'feedState'],
    errors: ['INVALID_INPUT', 'RPC_UNAVAILABLE'],
  },
  'dex.positions': {
    group: 'R', gate: 'DEFI_READ', env: 'error', feature: 'pools',
    params: { address: 'id', networkId: 'id?' },
    resultKeys: ['positions'],
    errors: ['FEATURE_DISABLED', 'UNSUPPORTED', 'INVALID_INPUT', 'ACCOUNT_MISSING'],
  },

  'intent.list': {
    group: 'R', gate: 'DEFI_INTENT', env: 'error', feature: null,
    params: { status: 'string?' },
    resultKeys: ['intents'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },
  'intent.get': {
    group: 'R', gate: 'DEFI_INTENT', env: 'error', feature: null,
    params: { intentId: 'id' },
    resultKeys: ['intentId', 'kind', 'status', 'plan', 'fee', 'preparedAt', 'expiresAt', 'unsignedTxs', 'context'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },

  // ---- v17: LOCAL surface --------------------------------------------------

  'launchpad.draftList': {
    group: 'L', gate: 'DEFI_LAUNCHPAD', env: 'error', feature: null,
    params: {},
    resultKeys: ['drafts'],
    errors: ['FEATURE_DISABLED'],
  },
  'launchpad.draftGet': {
    group: 'L', gate: 'DEFI_LAUNCHPAD', env: 'error', feature: null,
    params: { draftId: 'id' },
    resultKeys: ['draft'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },
  'launchpad.draftSave': {
    group: 'L', gate: 'DEFI_LAUNCHPAD', env: 'error', feature: null,
    params: { draftId: 'id?', draft: 'object' },
    resultKeys: ['draftId'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },
  'launchpad.draftDelete': {
    group: 'L', gate: 'DEFI_LAUNCHPAD', env: 'error', feature: null,
    params: { draftId: 'id' },
    resultKeys: ['deleted'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },
  'market.watchlistGet': {
    group: 'L', gate: 'DEFI_MARKET', env: 'error', feature: null,
    params: {},
    resultKeys: ['items'],
    errors: ['FEATURE_DISABLED'],
  },
  'market.watchlistAdd': {
    group: 'L', gate: 'DEFI_MARKET', env: 'error', feature: null,
    params: { assetId: 'id' },
    resultKeys: ['items'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT', 'ALREADY_EXISTS'],
  },
  'market.watchlistRemove': {
    group: 'L', gate: 'DEFI_MARKET', env: 'error', feature: null,
    params: { assetId: 'id' },
    resultKeys: ['items'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },
  'desktop.open': {
    group: 'L', gate: 'DEFI_DESKTOP', env: 'result', feature: null,
    params: { page: 'string', args: 'object?' },
    resultKeys: ['enabled'],
    errors: ['INVALID_INPUT'],
  },

  // ---- v18: PREPARE surface ------------------------------------------------

  'intent.prepareSend': {
    group: 'P', gate: 'DEFI_INTENT', env: 'error', feature: null,
    params: { address: 'id', toAddress: 'id', amountUnits: 'baseUnits', clientRequestId: 'id' },
    resultKeys: ['reviewAscii', 'facts', 'model', 'policy', 'simulation', 'assetChanges', 'feePlan', 'bindingHash', 'clientRequestId', 'acknowledgements'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT', 'ACCOUNT_MISSING', 'INSUFFICIENT_BALANCE', 'ALREADY_EXISTS'],
  },
  'dex.quote': {
    group: 'P', gate: 'DEFI_DEX', env: 'result', feature: 'swap',
    params: { address: 'id?', poolId: 'id', inputAssetId: 'id', outputAssetId: 'id', inputAmountUnits: 'baseUnits', slippageBps: 'int?' },
    resultKeys: ['poolId', 'input', 'output', 'rate', 'priceImpactBps', 'feeTotal', 'quoteId', 'expiresAt'],
    errors: ['INVALID_INPUT'],
  },
  'dex.prepareSwap': {
    group: 'P', gate: 'DEFI_DEX', env: 'error', feature: 'swap',
    params: { quoteId: 'id', clientRequestId: 'id' },
    resultKeys: ['intentId', 'kind', 'status', 'plan', 'fee', 'preparedAt', 'expiresAt', 'unsignedTxs', 'context'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT', 'QUOTE_EXPIRED', 'ALREADY_EXISTS'],
  },
  'dex.quoteLiquidity': {
    group: 'P', gate: 'DEFI_DEX', env: 'result', feature: 'pools',
    params: { address: 'id?', poolId: 'id', mode: 'string', amounts: 'object', slippageBps: 'int?' },
    resultKeys: ['poolId', 'mode', 'sharesEst', 'minShares', 'details', 'quoteId', 'expiresAt'],
    errors: ['INVALID_INPUT', 'INSUFFICIENT_FEE_RESERVE'],
  },
  'dex.prepareLiquidity': {
    group: 'P', gate: 'DEFI_DEX', env: 'error', feature: 'pools',
    params: { quoteId: 'id', clientRequestId: 'id' },
    resultKeys: ['intentId', 'kind', 'status', 'plan', 'fee', 'preparedAt', 'expiresAt', 'unsignedTxs', 'context'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT', 'QUOTE_EXPIRED', 'ALREADY_EXISTS'],
  },
  'launchpad.uploadImage': {
    group: 'P', gate: 'DEFI_LAUNCHPAD', env: 'error', feature: 'launchMint',
    params: { address: 'id', networkId: 'id', payload: 'payload' },
    resultKeys: ['status', 'url', 'sha256'],
    errors: ['FEATURE_DISABLED', 'UNSUPPORTED', 'INVALID_INPUT', 'UPLOAD_REJECTED', 'RATE_LIMITED'],
  },
  'launchpad.prepareCreate': {
    group: 'P', gate: 'DEFI_LAUNCHPAD', env: 'error', feature: 'launchMint',
    params: { address: 'id', networkId: 'id', draft: 'object', clientRequestId: 'id' },
    resultKeys: ['intentId', 'kind', 'status', 'plan', 'fee', 'preparedAt', 'expiresAt', 'unsignedTxs', 'context'],
    errors: ['FEATURE_DISABLED', 'UNSUPPORTED', 'INVALID_INPUT', 'ALREADY_EXISTS', 'INSUFFICIENT_BALANCE', 'UPLOAD_REJECTED'],
  },
  'launchpad.prepareMigrate': {
    group: 'P', gate: 'DEFI_LAUNCHPAD', env: 'error', feature: 'migrate',
    params: { address: 'id', launchId: 'id', clientRequestId: 'id' },
    resultKeys: ['intentId', 'kind', 'status', 'plan', 'fee', 'preparedAt', 'expiresAt', 'unsignedTxs', 'context'],
    // DESTINATION_POOL_PRE_EXISTING arrives inside the Review/preflight data (it is an
    // unsupportedReason, not an envelope error code), so it is not declared here.
    errors: ['FEATURE_DISABLED', 'UNSUPPORTED', 'INVALID_INPUT', 'ALREADY_EXISTS'],
  },
  'launchpad.prepareClaim': {
    group: 'P', gate: 'DEFI_LAUNCHPAD', env: 'error', feature: 'claim',
    params: { address: 'id', launchId: 'id', clientRequestId: 'id' },
    resultKeys: ['intentId', 'kind', 'status', 'plan', 'fee', 'preparedAt', 'expiresAt', 'unsignedTxs', 'context'],
    errors: ['FEATURE_DISABLED', 'UNSUPPORTED', 'INVALID_INPUT', 'ALREADY_EXISTS', 'NOTHING_TO_CLAIM'],
  },
  'intent.rePrepare': {
    group: 'P', gate: 'DEFI_INTENT', env: 'error', feature: null,
    params: { intentId: 'id' },
    resultKeys: ['reviewAscii', 'facts', 'model', 'policy', 'simulation', 'assetChanges', 'feePlan', 'bindingHash', 'clientRequestId', 'acknowledgements'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT', 'INTENT_EXPIRED', 'NOT_READY'],
  },
  'intent.resume': {
    group: 'P', gate: 'DEFI_INTENT', env: 'error', feature: null,
    params: { intentId: 'id' },
    resultKeys: ['intentId', 'status'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT', 'CONTEXT_CHANGED', 'NOT_READY', 'INTENT_LOCKED'],
  },
  'intent.discard': {
    group: 'P', gate: 'DEFI_INTENT', env: 'error', feature: null,
    params: { intentId: 'id' },
    resultKeys: ['intentId', 'status'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT'],
  },
  'intent.stopWaiting': {
    group: 'P', gate: 'DEFI_INTENT', env: 'error', feature: null,
    params: { intentId: 'id' },
    resultKeys: ['intentId', 'status'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT', 'NOT_READY'],
  },

  // ---- v18: EXECUTE surface ------------------------------------------------

  'intent.submit': {
    group: 'X', gate: 'DEFI_INTENT', env: 'error', feature: null,
    // `password` is part of the auth:'signing' contract shape (re-verified server-side when the
    // user has opted into signing re-authentication), never stored or forwarded.
    params: { intentId: 'id', bindingHash: 'id', acknowledgements: 'strings?', password: 'string?' },
    resultKeys: ['submitId', 'state', 'waitingReason', 'signature'],
    errors: ['FEATURE_DISABLED', 'INVALID_INPUT', 'BINDING_MISMATCH', 'INTENT_EXPIRED', 'INTENT_LOCKED', 'NONCE_CONFLICT', 'USER_REJECTED', 'INSUFFICIENT_FEE_RESERVE'],
  },
});

// Case-insensitive accessor: S6 spells the method `intent.reprepare`; the router and manifest
// own the canonical casing. This alias keeps the schema lookup tolerant without weakening the
// manifest's exact-name allowlist.
const SPEC_BY_LOWER = Object.freeze(
  Object.fromEntries(Object.entries(DEFI_METHODS).map(([name, spec]) => [name.toLowerCase(), { name, spec }])),
);

/** @param {string} method */
export function isDefiMethod(method) {
  return typeof method === 'string' && Object.prototype.hasOwnProperty.call(SPEC_BY_LOWER, method.toLowerCase());
}

/** @param {string} method @returns {{ name: string, spec: object } | null} canonical name + spec */
export function getDefiSpec(method) {
  if (typeof method !== 'string') return null;
  return SPEC_BY_LOWER[method.toLowerCase()] ?? null;
}

/**
 * Validate DeFi method params against this schema. Runs in the router BEFORE auth/gating so a
 * malformed request can never reach a service (DEFI-03/B12).
 * @returns {string[]} human-readable issues; empty array means valid.
 */
export function validateDefiParams(method, params) {
  const entry = getDefiSpec(method);
  if (!entry) return [];
  const issues = [];
  for (const [name, tag] of Object.entries(entry.spec.params)) {
    const problem = checkParam(tag, params?.[name]);
    if (problem) issues.push(`${entry.name} param '${name}' ${problem}.`);
  }
  return issues;
}
