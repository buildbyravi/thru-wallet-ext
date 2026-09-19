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
import { emit } from './event-service.js';
import { getActiveNetworkId } from './network-service.js';
import { scopedKey } from '../../shared/network-scope.js';

// Per-network. A transaction signature exists on exactly one chain, so a shared store would
// show devnet's pending transfers after switching to mainnet — and would badge the extension
// icon for transactions that can never confirm on the current network.
const PENDING_BASE_KEY = 'thru_pending_txs';
const MAX_RECORDS = 50;

// Give up watching after this long and mark the record 'unknown' rather than guessing.
const WATCH_TIMEOUT_MS = 5 * 60_000;

export const TX_STATUS = {
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
};

async function pendingKey() {
  return scopedKey(PENDING_BASE_KEY, await getActiveNetworkId());
}

async function readAll() {
  try {
    const key = await pendingKey();
    const res = await chrome.storage.local.get(key);
    const list = res?.[key];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeAll(list) {
  try {
    await chrome.storage.local.set({ [await pendingKey()]: list.slice(0, MAX_RECORDS) });
  } catch {
    // ignore
  }
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
  const list = await readAll();
  const record = {
    signature: String(tx.signature),
    kind: tx.kind || 'transfer',
    from: tx.from || null,
    to: tx.to || null,
    amountUnits: tx.amountUnits != null ? String(tx.amountUnits) : null,
    mint: tx.mint || null,
    displayAmount: tx.displayAmount || null,
    networkId: tx.networkId || null,
    status: TX_STATUS.SUBMITTED,
    submittedAt: Date.now(),
    settledAt: null,
    error: null,
  };
  await writeAll([record, ...list.filter((r) => r.signature !== record.signature)]);
  const updated = await readAll();
  await updateBadge(updated);
  emit('pendingTxChanged', { pending: updated.filter((r) => r.status === TX_STATUS.SUBMITTED) });

  // The only reconcile triggers were bootstrap and unlock, so a send whose sendAndTrack
  // ALREADY returned confirmed stayed "pending" for the entire popup session — the
  // stuck-pending defect the manual smoke run hit. Active self-service: one pass shortly
  // after submit (covers the common already-confirmed case), one later pass (covers history
  // lag). Both no-op once the record settled and swallow every error — a timer must never
  // surface an offline failure. unref keeps Node-based tests from being held open.
  for (const ms of [2_000, 10_000]) {
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

/**
 * Whether an identical transfer was submitted within the last few seconds.
 * Used to block a double-click from broadcasting twice.
 *
 * `mint` is part of identity: a native send and a token send with the same from/to/amount
 * are NOT duplicates of each other. Legacy records carry no mint (null) and only ever match
 * native (mintless) candidates.
 *
 * @param {{ from: string, to: string, amountUnits: string, mint?: string }} candidate
 * @param {number} [windowMs=15000]
 */
export async function isProbableDuplicate(candidate, windowMs = 15_000) {
  const all = await readAll();
  const cutoff = Date.now() - windowMs;
  const mint = candidate.mint || null;
  return all.some((r) => (
    r.submittedAt >= cutoff
    && r.status === TX_STATUS.SUBMITTED
    && r.from === candidate.from
    && r.to === candidate.to
    && r.amountUnits === String(candidate.amountUnits)
    && (r.mint || null) === mint
  ));
}

async function settle(signature, status, error = null) {
  const list = await readAll();
  let changed = false;
  const next = list.map((r) => {
    if (r.signature !== signature || r.status !== TX_STATUS.SUBMITTED) return r;
    changed = true;
    return { ...r, status, settledAt: Date.now(), error };
  });
  if (!changed) return null;
  await writeAll(next);
  await updateBadge(next);
  emit('pendingTxChanged', { pending: next.filter((r) => r.status === TX_STATUS.SUBMITTED) });
  return next.find((r) => r.signature === signature) || null;
}

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
}

/** Remove settled records, keeping anything still in flight. */
export async function clearSettled() {
  const list = await readAll();
  const next = list.filter((r) => r.status === TX_STATUS.SUBMITTED);
  await writeAll(next);
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
