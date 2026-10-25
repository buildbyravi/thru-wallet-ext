// Signed feed records (G1-B): the type, the canonical signed bytes, and the verification
// state machine behind the FEEDS appendix. A signed feed SUPPLEMENTS chain reads and never
// replaces them (R16), and it can only ever NARROW a build, never widen one: a verified
// record can take capability away (kill switch / required-feed gating), it can never upgrade
// an unsupported dossier row.
//
// Trust chain: record bytes are signed with the same domain-separated Ed25519 the chain uses,
// through the src/lib/feed-crypto adapter (SignatureDomain.MSG — off-chain message domain, so
// a feed record can never be replayed as a transaction). A publisher key enters the pinned
// set ONLY through the evidence chain (probe output → evidence seed → capability snapshot),
// exactly like program addresses; nothing in the UI or transport can pin a publisher.
//
// v1 record ops: { kill: string[] } — publisher votes that listed features are disabled.
// When >= quorum distinct pinned publishers vote kill on a feature, the feature narrows to
// unsupported/KILL_SWITCH. Records bind to networkId AND chain fingerprint (B3): a record
// signed for a previous genesis verifies honest-but-useless once the chain resets.

import { verifyFeedSignature } from '../../../lib/feed-crypto.js';

export const FEED_RECORD_VERSION = 1;

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
const HEX_SIGNATURE = /^[0-9a-f]{128}$/;

/**
 * Canonical byte encoding of everything under signature: JSON with recursively sorted keys,
 * no whitespace. Determinism is the whole contract — two implementations that disagree on
 * byte order disagree on truth.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function encodeRecordBody(record) {
  const { signature, ...body } = record ?? {};
  return new TextEncoder().encode(canonicalJson(body));
}

/**
 * Structural validation of a signed record BEFORE any crypto. Returns
 * { ok: true, record } or { ok: false, detail } — the caller maps non-ok to MALFORMED.
 * @param {unknown} value
 * @param {{ knownFeatures?: string[] }} [opts] kill votes on unknown features = bad record.
 */
export function parseFeedRecord(value, { knownFeatures } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, detail: 'record is not an object' };
  }
  const r = value;
  if (r.recordVersion !== FEED_RECORD_VERSION) return { ok: false, detail: 'recordVersion' };
  if (typeof r.feedId !== 'string' || r.feedId.length === 0 || r.feedId.length > 64) return { ok: false, detail: 'feedId' };
  if (typeof r.networkId !== 'string' || r.networkId.length === 0) return { ok: false, detail: 'networkId' };
  if (typeof r.fingerprint !== 'string' || r.fingerprint.length === 0) return { ok: false, detail: 'fingerprint' };
  if (typeof r.publisher !== 'string' || !HEX_PUBKEY.test(r.publisher)) return { ok: false, detail: 'publisher' };
  if (!Number.isSafeInteger(r.issuedAt) || !Number.isSafeInteger(r.expiresAt)) return { ok: false, detail: 'timestamps' };
  if (!(r.issuedAt < r.expiresAt)) return { ok: false, detail: 'window' };
  if (!r.ops || typeof r.ops !== 'object' || Array.isArray(r.ops)) return { ok: false, detail: 'ops' };
  const kill = r.ops.kill ?? [];
  if (!Array.isArray(kill) || kill.some((k) => typeof k !== 'string')) return { ok: false, detail: 'ops.kill' };
  if (new Set(kill).size !== kill.length) return { ok: false, detail: 'ops.kill duplicates' };
  if (knownFeatures && kill.some((k) => !knownFeatures.includes(k))) return { ok: false, detail: 'ops.kill unknown feature' };
  if (typeof r.signature !== 'string' || !HEX_SIGNATURE.test(r.signature)) return { ok: false, detail: 'signature' };
  return { ok: true, record: { ...r, recordVersion: r.recordVersion, ops: { kill } } };
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Verification states (internal vocabulary — the wire reasons they map to are the S10 set:
// GENESIS_MISMATCH -> NETWORK_RESET, RECORD_STALE -> INDEX_STALE, an absent required feed ->
// FEED_MISSING, a quorum'd kill op -> KILL_SWITCH).
export const VERIFY_STATES = Object.freeze({
  MALFORMED: 'MALFORMED',
  NETWORK_MISMATCH: 'NETWORK_MISMATCH',
  GENESIS_MISMATCH: 'GENESIS_MISMATCH',
  PUBLISHER_UNPINNED: 'PUBLISHER_UNPINNED',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  RECORD_STALE: 'RECORD_STALE',
  VALID: 'VALID',
});

/**
 * Verify ONE record against the environment. Check order is the trust order: shape, then the
 * chain it claims to be about, then who claims it, then the cryptography, then time.
 *
 * @param {unknown} candidate
 * @param {{ networkId: string, fingerprint: string, pinnedPublishers: Iterable<string>,
 *           now: number, clockSkewMs?: number, knownFeatures?: string[] }} env
 * @returns {Promise<{ state: string, record?: object, detail?: string }>}
 */
export async function verifyFeedRecord(candidate, env) {
  const parsed = parseFeedRecord(candidate, { knownFeatures: env.knownFeatures });
  if (!parsed.ok) return { state: VERIFY_STATES.MALFORMED, detail: parsed.detail };
  const record = parsed.record;
  if (record.networkId !== env.networkId) return { state: VERIFY_STATES.NETWORK_MISMATCH, record };
  if (record.fingerprint !== env.fingerprint) return { state: VERIFY_STATES.GENESIS_MISMATCH, record };
  if (![...env.pinnedPublishers].includes(record.publisher)) {
    return { state: VERIFY_STATES.PUBLISHER_UNPINNED, record };
  }
  const ok = await verifyFeedSignature(
    hexToBytes(record.signature),
    encodeRecordBody(record),
    hexToBytes(record.publisher),
  );
  if (!ok) return { state: VERIFY_STATES.SIGNATURE_INVALID, record };
  const skew = env.clockSkewMs ?? 0;
  if (env.now > record.expiresAt || record.issuedAt > env.now + skew) {
    return { state: VERIFY_STATES.RECORD_STALE, record };
  }
  return { state: VERIFY_STATES.VALID, record };
}

export const AGGREGATE_STATES = Object.freeze({
  INERT: 'INERT',                 // feed infra not configured (quorum 0): the everyday truth today
  NO_FEEDS: 'NO_FEEDS',           // configured, no records presented
  QUORUM_NOT_MET: 'QUORUM_NOT_MET',// presented but not enough distinct valid publishers
  LIVE: 'LIVE',                   // >= quorum distinct pinned publishers have a VALID record
});

function emptyAggregate() {
  return {
    state: 'INERT',
    validPublishers: 0,
    killFeatures: Object.freeze([]),
    liveFeedIds: Object.freeze([]),
    verdicts: Object.freeze([]),
  };
}

/**
 * Aggregate a set of presented records into one feed state. One publisher = one vote
 * (a publisher spamming records buys nothing). Kill coverage and liveness both require
 * `quorum` DISTINCT pinned publishers with a VALID record.
 *
 * @param {unknown[]} records
 * @param {{ quorum: number }} policy
 * @param {Parameters<typeof verifyFeedRecord>[1]} env
 */
export async function aggregateFeedState(records, policy, env) {
  if (!policy || policy.quorum <= 0) return emptyAggregate();
  const presented = Array.isArray(records) ? records : [];
  if (presented.length === 0) {
    const base = emptyAggregate();
    return { ...base, state: AGGREGATE_STATES.NO_FEEDS };
  }
  const verdicts = [];
  const validByPublisher = new Map(); // publisher -> [valid records]
  for (const candidate of presented) {
    const verdict = await verifyFeedRecord(candidate, env);
    verdicts.push({ feedId: verdict.record?.feedId ?? null, publisher: verdict.record?.publisher ?? null, state: verdict.state });
    if (verdict.state !== VERIFY_STATES.VALID) continue;
    const list = validByPublisher.get(verdict.record.publisher) ?? [];
    list.push(verdict.record);
    validByPublisher.set(verdict.record.publisher, list);
  }
  const validPublishers = validByPublisher.size;
  const hasQuorum = validPublishers >= policy.quorum;
  const feedVotes = new Map(); // feedId -> Set(publisher)
  const killVotes = new Map(); // feature -> Set(publisher)
  for (const [publisher, valid] of validByPublisher) {
    for (const record of valid) {
      if (!feedVotes.has(record.feedId)) feedVotes.set(record.feedId, new Set());
      feedVotes.get(record.feedId).add(publisher);
      for (const feature of record.ops.kill) {
        if (!killVotes.has(feature)) killVotes.set(feature, new Set());
        killVotes.get(feature).add(publisher);
      }
    }
  }
  const liveFeedIds = [...feedVotes].filter(([, voters]) => voters.size >= policy.quorum).map(([id]) => id).sort();
  const killFeatures = [...killVotes].filter(([, voters]) => voters.size >= policy.quorum).map(([f]) => f).sort();
  return {
    state: hasQuorum ? AGGREGATE_STATES.LIVE : AGGREGATE_STATES.QUORUM_NOT_MET,
    validPublishers,
    killFeatures: Object.freeze(killFeatures),
    liveFeedIds: Object.freeze(liveFeedIds),
    verdicts: Object.freeze(verdicts),
  };
}

/** The aggregate for "no records under the shipped policy", computed without any await so
 * sync readers have a correct value before the first refresh. Pinned by test == aggregate([], ...). */
export function defaultAggregate(policy) {
  if (!policy || policy.quorum <= 0) return emptyAggregate();
  return { ...emptyAggregate(), state: AGGREGATE_STATES.NO_FEEDS };
}
