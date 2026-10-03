// Pending transaction tracking.
//
// tx.send previously returned a signature and forgot about it. Nothing tracked confirmation, so
// the UI could not show pending state, could not badge the extension icon, and could not warn
// about a duplicate submission. BUILD_SPEC.md specifies the lifecycle:
//
//   draft -> review -> awaiting-auth -> signed -> submitted -> confirmed
//   failures: rejected | submission-failed | network-timeout | unknown
//
// This module owns everything from `submitted` onward. Records are persisted so they survive a
// service-worker restart, which MV3 does aggressively.
//
// IMPORTANT: a record is only ever marked `confirmed` on positive evidence from the chain. An
// RPC accepting a submission is not confirmation — presenting it as such is how wallets show
// users money that never moved.

import * as thruClient from '../../lib/thru-client.js';
import { getBalances } from './balance-service.js';
import { emit } from './event-service.js';
import { getActiveNetworkId } from './network-service.js';
import { scopedKey } from '../../shared/network-scope.js';
import { recordSubmittedTransaction, settleTransaction } from './history-service.js';

// Per-network. A transaction signature exists on exactly one chain, so a shared store would
// show devnet's pending transfers after switching to mainnet — and would badge the extension
// icon for transactions that can never confirm on the current network.
const PENDING_BASE_KEY = 'thru_pending_txs';
const PENDING_SCHEMA_VERSION = 1;
const MAX_RECORDS = 50;

// Serialize every read-modify-write per network. Distinct transfers and reconciliation can finish
// in either order; without this queue the last storage write silently erased the other signature.
const pendingUpdates = new Map();

// Give up watching after this long and mark the record 'unknown' rather than guessing.
const WATCH_TIMEOUT_MS = 5 * 60_000;

export const TX_STATUS = {
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
};

async function pendingKey(networkId = null) {
  return scopedKey(PENDING_BASE_KEY, networkId || await getActiveNetworkId());
}

async function readAll(networkId = null) {
  try {
    const key = await pendingKey(networkId);
    const res = await chrome.storage.local.get(key);
    const stored = res?.[key];
    // v0 was a bare array. Read it without rewriting; the next mutation performs the migration.
    if (Array.isArray(stored)) return stored;
    if (stored && typeof stored === 'object') {
      if (stored.version > PENDING_SCHEMA_VERSION) {
        throw new Error(`Pending transaction schema ${stored.version} is newer than this wallet.`);
      }
      return Array.isArray(stored.records) ? stored.records : [];
    }
    return [];
  } catch (error) {
    if (/newer than this wallet/.test(error?.message || '')) throw error;
    return [];
  }
}

async function writeAll(list, networkId = null) {
  const key = await pendingKey(networkId);
  await chrome.storage.local.set({
    [key]: { version: PENDING_SCHEMA_VERSION, records: list.slice(0, MAX_RECORDS) },
  });
}

function updateAll(networkId, edit) {
  const id = networkId;
  const queueKey = String(id || 'active');
  const prior = pendingUpdates.get(queueKey) || Promise.resolve();
  const update = prior.catch(() => {}).then(async () => {
    const resolvedId = id || await getActiveNetworkId();
    const list = await readAll(resolvedId);
    const { next, value } = await edit(list);
    if (next) await writeAll(next, resolvedId);
    return value;
  });
  pendingUpdates.set(queueKey, update);
  return update.finally(() => {
    if (pendingUpdates.get(queueKey) === update) pendingUpdates.delete(queueKey);
  });
}

async function updateBadge(list) {
  try {
    if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
    const active = list.filter((r) => r.status === TX_STATUS.SUBMITTED).length;
    await chrome.action.setBadgeText({ text: active > 0 ? String(active) : '' });
    if (active > 0 && chrome.action.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: '#ffad42' });
    }
  } catch {
    // ignore
  }
}

/**
 * Record a freshly submitted transaction.
 *
 * `mint` distinguishes a token transfer from a native one: the same addresses sending the
 * same amount of THRU and of a token within the dedupe window are two different transactions,
 * not a double-click. `displayAmount` is a preformatted display string (e.g. "5 ABC") for
 * kinds whose raw units are not THRU and must never pass through format().
 *
 * @param {{ signature: string, kind: string, from: string, to?: string, amountUnits?: string,
 *   mint?: string, displayAmount?: string, networkId?: string }} tx
 */
export async function track(tx) {
  if (!tx?.signature) return null;
  // A network switch can finish while the SDK is signing. The signature still belongs to
  // the chain where the send began, not the network selected when this storage call runs.
  const networkId = tx.networkId || await getActiveNetworkId();
  const record = {
    signature: String(tx.signature),
    kind: tx.kind || 'transfer',
    from: tx.from || null,
    to: tx.to || null,
    amountUnits: tx.amountUnits != null ? String(tx.amountUnits) : null,
    mint: tx.mint || null,
    displayAmount: tx.displayAmount || null,
    networkId,
    status: TX_STATUS.SUBMITTED,
    submittedAt: Date.now(),
    settledAt: null,
    error: null,
  };
  await updateAll(networkId, (list) => ({
    next: [record, ...list.filter((r) => r.signature !== record.signature)],
    value: record,
  }));
  try {
    await recordSubmittedTransaction(record);
  } catch {
    // History cache is best-effort after storing the signature; never change the send result.
  }
  try {
    if (await getActiveNetworkId() === networkId) {
      const updated = await readAll(networkId);
      await updateBadge(updated);
      if (await getActiveNetworkId() === networkId) {
        emit('pendingTxChanged', { pending: updated.filter((r) => r.status === TX_STATUS.SUBMITTED) });
      }
    }
  } catch {
    // Badge/events are best-effort after storing the signature; never change the send result.
  }

  // Active self-service: betanet blocks land every ~6 seconds (verified on the explorer
  // 2026-09-29 — consecutive blocks 5-6s apart), so a transfer settles in about one block.
  // The passes cover the first two block times plus history-lag slack. The pass list
  // no-ops once settled and swallows errors. unref keeps Node-based tests from hanging.
  for (const ms of [2_000, 5_000, 8_000, 12_000]) {
    const timer = setTimeout(() => { reconcile().catch(() => {}); }, ms);
    timer.unref?.();
  }

  return record;
}

/**
 * All tracked records, newest first.
 */
export async function list() {
  return readAll();
}

/**
 * Only records still awaiting a result.
 */
export async function listPending() {
  const all = await readAll();
  return all.filter((r) => r.status === TX_STATUS.SUBMITTED);
}

// A signing RPC may run longer than the UI bridge's 30s timeout. isProbableDuplicate only
// sees SUBMITTED records, written AFTER the SDK returns, so a click/retry during an in-flight
// broadcast could send twice. Reserve the intent synchronously before network work starts.
// The release closure never persists or contains key material; settled submissions remain
// protected by the persisted pending record. A worker restart cannot keep an in-memory lock.
const inFlightTransfers = new Set();

export function beginTransfer({ networkId, from, to, amountUnits, mint = null }) {
  const key = JSON.stringify([networkId, from, to, String(amountUnits), mint]);
  if (inFlightTransfers.has(key)) {
    // Name the collision precisely: this guard only fires for the same network, same
    // amount, same recipient still in flight. The old "identical transfer / check Activity"
    // wording pointed people at unrelated rows (the in-flight send's own row does not
    // exist until the SDK returns) and read like a phantom-duplicate bug.
    const error = new Error(
      'That exact transfer — same amount and same recipient — is still being sent. '
        + 'Wait for it to finish before sending again.',
    );
    error.code = 'DUPLICATE_SUBMISSION';
    error.retryable = false;
    throw error;
  }
  inFlightTransfers.add(key);
  return () => inFlightTransfers.delete(key);
}

/**
 * Whether an identical transfer is currently pending on-chain or was submitted
 * within the last 30 seconds.
 *
 * Used to prevent accidental repeat sends, double-clicks, and duplicate submissions.
 * On Betanet with ~6-second blocks, any identical unconfirmed transfer (status: SUBMITTED)
 * is treated as an active in-flight duplicate regardless of age. Any identical transfer
 * submitted within the 30-second window is also flagged as a repeat transfer.
 *
 * @param {{ from: string, to: string, amountUnits: string, mint?: string }} candidate
 * @param {number} [windowMs=30000]
 */
export async function isProbableDuplicate(candidate, windowMs = 30_000) {
  const all = await readAll();
  const cutoff = Date.now() - windowMs;
  const mint = candidate.mint || null;
  return all.some((r) => (
    r.from === candidate.from
    && r.to === candidate.to
    && r.amountUnits === String(candidate.amountUnits)
    && (r.mint || null) === mint
    && (r.status === TX_STATUS.SUBMITTED || r.submittedAt >= cutoff)
  ));
}

/**
 * Detailed duplicate check for the UI to display repeated-transaction warnings
 * and prompt for a 2nd confirmation.
 *
 * @param {{ from: string, to: string, amountUnits: string, mint?: string }} candidate
 * @param {number} [windowMs=30000]
 * @returns {Promise<{ isDuplicate: boolean, isPending: boolean, elapsedMs: number | null, signature: string | null }>}
 */
export async function getDuplicateInfo(candidate, windowMs = 30_000) {
  const all = await readAll();
  const cutoff = Date.now() - windowMs;
  const mint = candidate.mint || null;
  const match = all.find((r) => (
    r.from === candidate.from
    && r.to === candidate.to
    && r.amountUnits === String(candidate.amountUnits)
    && (r.mint || null) === mint
    && (r.status === TX_STATUS.SUBMITTED || r.submittedAt >= cutoff)
  ));
  if (!match) {
    return { isDuplicate: false, isPending: false, elapsedMs: null, signature: null };
  }
  const isPending = match.status === TX_STATUS.SUBMITTED;
  const elapsedMs = match.submittedAt ? Math.max(0, Date.now() - match.submittedAt) : null;
  return {
    isDuplicate: true,
    isPending,
    elapsedMs,
    signature: match.signature,
  };
}

async function settle(signature, status, error = null) {
  const networkId = await getActiveNetworkId();
  const result = await updateAll(networkId, (list) => {
    let changed = false;
    const next = list.map((r) => {
      if (r.signature !== signature || r.status !== TX_STATUS.SUBMITTED) return r;
      changed = true;
      return { ...r, status, settledAt: Date.now(), error };
    });
    return { next: changed ? next : null, value: changed ? next : null };
  });
  if (!result) return null;
  const next = result;
  await updateBadge(next);
  emit('pendingTxChanged', { pending: next.filter((r) => r.status === TX_STATUS.SUBMITTED) });
  const settledRecord = next.find((r) => r.signature === signature) || null;
  try {
    await settleTransaction(signature, status, error, settledRecord?.networkId || null);
  } catch {
    // History cache update is best-effort
  }
  if (status === TX_STATUS.CONFIRMED && settledRecord) {
    const addrs = [settledRecord.from, settledRecord.to].filter((a) => typeof a === 'string' && a);
    if (addrs.length) {
      getBalances(addrs).catch(() => {});
    }
  }
  return settledRecord;
}

let reconciling = false;

/**
 * Check every submitted record against the chain and settle whatever has resolved.
 *
 * Confirmation is inferred from the sender's on-chain history, which is the only signal this
 * client is known to read correctly (decodeHistoryEntry is covered by test-thru-client.mjs).
 * Anything still unresolved past WATCH_TIMEOUT_MS becomes 'unknown', never 'confirmed'.
 *
 * @returns {Promise<{ checked: number, settled: number }>}
 */
export async function reconcile() {
  if (reconciling) return { checked: 0, settled: 0 };
  reconciling = true;
  try {
    const pending = await listPending();
    if (!pending.length) return { checked: 0, settled: 0 };

    let settledCount = 0;
    const byAddress = new Map();
    for (const record of pending) {
      if (!record.from) continue;
      if (!byAddress.has(record.from)) byAddress.set(record.from, []);
      byAddress.get(record.from).push(record);
    }

    for (const [address, records] of byAddress) {
      let history = [];
      try {
        history = await thruClient.listAccountHistory(address, 25);
      } catch {
        continue; // network down: leave records pending, do not guess
      }
      const seen = new Map(
        history
          .filter((entry) => entry?.signature)
          .map((entry) => [String(entry.signature), entry]),
      );

      for (const record of records) {
        const match = seen.get(record.signature);
        if (match) {
          const status = match.success === false ? TX_STATUS.FAILED : TX_STATUS.CONFIRMED;
          await settle(record.signature, status, match.success === false ? 'Transaction failed on-chain.' : null);
          settledCount += 1;
        } else if (Date.now() - record.submittedAt > WATCH_TIMEOUT_MS) {
          await settle(
            record.signature,
            TX_STATUS.UNKNOWN,
            'Could not confirm this transaction. Check the explorer.',
          );
          settledCount += 1;
        }
      }
    }

    return { checked: pending.length, settled: settledCount };
  } finally {
    reconciling = false;
  }
}

/** Remove settled records, keeping anything still in flight. */
export async function clearSettled() {
  const networkId = await getActiveNetworkId();
  const next = await updateAll(networkId, (list) => {
    const kept = list.filter((r) => r.status === TX_STATUS.SUBMITTED);
    return { next: kept, value: kept };
  });
  await updateBadge(next);
  return { remaining: next.length };
}

/**
 * Wipe records for EVERY network. Called on wallet reset.
 *
 * Scans for scoped keys rather than removing one, because a reset must not leave the previous
 * wallet's pending transactions waiting on a network the user has not selected yet.
 */
export async function clearAll() {
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all || {})
      .filter((k) => k === PENDING_BASE_KEY || k.startsWith(`${PENDING_BASE_KEY}::`));
    if (keys.length) await chrome.storage.local.remove(keys);
  } catch {
    // ignore
  }
  await updateBadge([]);
}
