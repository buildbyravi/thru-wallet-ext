// Prepared-review store (network-scoped, TTL-bounded, single-writer per network).
//
// Why the background keeps the prepared review at all:
//   - the review the user read must be the one that gets confirmed. The stored record IS that
//     review, and `tx.confirmReview` re-checks it (TTL, binding hash, account, network, and the
//     kind's own cheap chain facts) before returning the exact submit instructions;
//   - a review prepared on one network can never be confirmed on another (the key is scoped),
//     which is the same rule balances, pending transactions and intents already follow.
//
// Lifetime: 120s, evaluated on READ (no sweep timer that could mutate state unseen). Records
// are pruned oldest-first past the cap. A record holds only public facts — never a key, never
// a password, never a signature.

import { scopedKey } from '../../../shared/network-scope.js';
import { TX_REVIEW_TTL_MS } from '../../../shared/tx-review/model.js';

export const REVIEW_BASE_KEY = 'tx_reviews';
export const REVIEW_SCHEMA_VERSION = 1;
const MAX_RECORDS = 40;

function keyFor(networkId) {
  return scopedKey(REVIEW_BASE_KEY, networkId);
}

function decodeStored(stored) {
  if (stored == null) return [];
  if (Array.isArray(stored)) return stored; // never written, but read defensively
  if (typeof stored !== 'object') return [];
  if (Number(stored.version) > REVIEW_SCHEMA_VERSION) {
    // Fail closed: a newer wallet's records are not reinterpreted by older code.
    throw new Error(`Prepared-review schema ${stored.version} is newer than this wallet.`);
  }
  return Array.isArray(stored.records) ? stored.records : [];
}

async function readAll(networkId) {
  const key = keyFor(networkId);
  const res = await chrome.storage.local.get(key);
  return decodeStored(res?.[key]);
}

async function writeAll(networkId, records) {
  const key = keyFor(networkId);
  await chrome.storage.local.set({
    [key]: { version: REVIEW_SCHEMA_VERSION, records },
  });
}

/**
 * Store one prepared review, pruning expired records in the same write.
 * @param {string} networkId
 * @param {object} record
 */
export async function put(networkId, record) {
  const now = Date.now();
  const all = (await readAll(networkId)).filter((entry) => (
    entry?.reviewId !== record.reviewId
    && Number(entry?.expiresAt) > now
  ));
  all.push(record);
  const trimmed = all.slice(Math.max(0, all.length - MAX_RECORDS));
  await writeAll(networkId, trimmed);
  return record;
}

/**
 * Read one record. Returns null when absent; an expired record is returned with
 * `expired: true` so the caller can answer REVIEW_EXPIRED (a reason, not a silent miss).
 * @param {string} networkId
 * @param {string} reviewId
 */
export async function get(networkId, reviewId) {
  const all = await readAll(networkId);
  const record = all.find((entry) => entry?.reviewId === reviewId);
  if (!record) return null;
  return { ...record, expired: Number(record.expiresAt) <= Date.now() };
}

/** Drop a record after a successful submission or an explicit cancel. */
export async function remove(networkId, reviewId) {
  const all = await readAll(networkId);
  const next = all.filter((entry) => entry?.reviewId !== reviewId);
  if (next.length !== all.length) await writeAll(networkId, next);
}

/** Test seam: clear one network's records without touching anything else. */
export async function clear(networkId) {
  await writeAll(networkId, []);
}

export { TX_REVIEW_TTL_MS };
