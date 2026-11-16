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
import { getActiveNetworkId, getActiveNetworkConfig, getNetworkGeneration } from './network-service.js';
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
let generation = 0;
let registrationRecovery = null;
const recoveryJobs = new Set();
export const PENDING_ALARM = 'thru-pending-reconcile';

// Composition supplies domain recovery without adding pending -> domain -> name cycles.
export function configureRegistrationRecovery(callbacks) { registrationRecovery = callbacks; }

export function registrationIdentity(domain, signer, networkId) {
  const ref = signer?.ref;
  if (!ref?.keyringId) return null; // Legacy test/imported records have no durable identity.
  return { name: domain.name, rootAddress: domain.rootAddress, domainAddress: domain.domainAddress,
    accountAddress: signer.address, networkId,
    accountRef: { keyringId: ref.keyringId, accountIndex: ref.accountIndex ?? ref.index ?? 0 } };
}

export async function ensurePendingAlarm() {
  if (!globalThis.chrome?.alarms?.get || !chrome.alarms.create) return;
  const alarm = await chrome.alarms.get(PENDING_ALARM);
  if (!alarm || alarm.periodInMinutes !== 1) await chrome.alarms.create(PENDING_ALARM, { periodInMinutes: 1 });
}

async function syncPendingAlarm(hasActivePending) {
  if (hasActivePending) {
    await ensurePendingAlarm().catch(() => {});
  } else {
    await globalThis.chrome?.alarms?.clear?.(PENDING_ALARM)?.catch?.(() => {});
  }
}

function contextCurrent(ctx, activeId) {
  return ctx.generation === generation && ctx.networkGeneration === getNetworkGeneration()
    && activeId === ctx.networkId
    && thruClient.getConfiguredNetwork().id === ctx.networkId && thruClient.getClient() === ctx.client;
}

async function publish(list, networkId, ctx = null) {
  const activeId = await getActiveNetworkId();
  if (activeId !== networkId || (ctx && !contextCurrent(ctx, activeId))) return;
  await updateBadge(list, networkId, ctx);
  const currentId = await getActiveNetworkId();
  if (currentId === networkId && (!ctx || contextCurrent(ctx, currentId))) emit('pendingTxChanged', { networkId, pending: list.filter(r => r.status === TX_STATUS.SUBMITTED) });
}

// Mark a delayed result unknown, but keep reconciling until chain evidence resolves it.
const WATCH_TIMEOUT_MS = 5 * 60_000;

export const TX_STATUS = {
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
};

function isUnresolved(record) {
  return record.status === TX_STATUS.SUBMITTED || record.status === TX_STATUS.UNKNOWN;
}

function needsTracking(record) {
  return isUnresolved(record)
    || (record.status === TX_STATUS.CONFIRMED && record.registrationIdentity && !record.registrationRemembered);
}

async function pendingKey(networkId = null) {
  return scopedKey(PENDING_BASE_KEY, networkId || await getActiveNetworkId());
}

async function readAll(networkId = null) {
  const key = await pendingKey(networkId);
  const res = await chrome.storage.local.get(key);
  const stored = res?.[key];
  // v0 was a bare array; an empty plain object {} has no records yet.
  if (Array.isArray(stored)) return stored;
  if (stored && typeof stored === 'object') {
    if (Object.keys(stored).length === 0) return [];
    if (!Number.isSafeInteger(stored.version) || stored.version !== PENDING_SCHEMA_VERSION) {
      throw new Error(`Pending transaction schema ${stored.version} is newer than this wallet.`);
    }
    if (!Array.isArray(stored.records)) throw new Error('Pending transaction records are malformed.');
    return stored.records;
  }
  if (stored != null) throw new Error('Pending transaction storage is malformed.');
  return [];
}

function updateAll(networkId, edit, ctx = null) {
  const id = networkId;
  const started = generation;
  const queueKey = String(id || 'active');
  const prior = pendingUpdates.get(queueKey) || Promise.resolve();
  const update = prior.catch(() => {}).then(async () => {
    const resolvedId = id || await getActiveNetworkId();
    if (started !== generation) return null;
    const list = await readAll(resolvedId);
    if (started !== generation) return null;
    const { next, value } = await edit(list);
    // Resolve all asynchronous facts before the final guard. The scoped key is synchronous:
    // another await here would reopen the roundtrip/reset race before storage.set.
    const activeId = ctx ? await getActiveNetworkId() : null;
    if (started !== generation) return null;
    if (ctx && !contextCurrent(ctx, activeId)) return null;
    if (next) {
      let settledKept = 0;
      const settledLimit = Math.max(0, MAX_RECORDS - next.filter(needsTracking).length);
      await chrome.storage.local.set({
        [scopedKey(PENDING_BASE_KEY, resolvedId)]: { version: PENDING_SCHEMA_VERSION,
          records: next.filter(r => needsTracking(r) || settledKept++ < settledLimit) },
      });
    }
    return value;
  });
  pendingUpdates.set(queueKey, update);
  return update.finally(() => {
    if (pendingUpdates.get(queueKey) === update) pendingUpdates.delete(queueKey);
  });
}

async function updateBadge(list, networkId = null, ctx = null) {
  try {
    if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
    const activeId = networkId ? await getActiveNetworkId() : null;
    if (networkId && (activeId !== networkId || (ctx && !contextCurrent(ctx, activeId)))) return;
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
  const started = generation;
  if (!tx?.signature) return null;
  // A network switch can finish while the SDK is signing. The signature still belongs to
  // the chain where the send began, not the network selected when this storage call runs.
  const networkId = tx.networkId || await getActiveNetworkId();
  if (started !== generation) return null;
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
    // The transaction's own deadline, as built: without these two numbers an "unknown" send
    // cannot be classified as "may still land" or "expired", and the only honest message left
    // is the useless one. Null when a path did not report them (an older record, or a build
    // that predates this field) — never invented.
    startSlot: tx.startSlot != null && tx.startSlot !== '' ? String(tx.startSlot) : null,
    expiryAfter: tx.expiryAfter != null && tx.expiryAfter !== '' && Number.isSafeInteger(Number(tx.expiryAfter)) && Number(tx.expiryAfter) >= 0 ? Number(tx.expiryAfter) : null,
    registrationIdentity: tx.registrationIdentity ? structuredClone(tx.registrationIdentity) : null,
    registrationRemembered: false,
    error: null,
  };
  const saved = await updateAll(networkId, (list) => ({
    next: [record, ...list.filter((r) => r.signature !== record.signature)],
    value: record,
  }));
  if (!saved || started !== generation) return null;
  try {
    await recordSubmittedTransaction(record);
  } catch {
    // History cache is best-effort after storing the signature; never change the send result.
  }
  await publish(await readAll(networkId), networkId).catch(() => {});
  await ensurePendingAlarm().catch(() => {});
  // Reconcile promptly around Betanet's ~6s block cadence while the durable 1m alarm carries
  // tracking across MV3 service-worker suspension. unref() keeps Node tests from hanging.
  void reconcile().catch(() => {});
  for (const delayMs of [2_000, 10_000]) {
    const timer = setTimeout(() => {
      if (started === generation) void reconcile().catch(() => {});
    }, delayMs);
    timer?.unref?.();
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
    && (isUnresolved(r) || r.submittedAt >= cutoff)
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
    && (isUnresolved(r) || r.submittedAt >= cutoff)
  ));
  if (!match) {
    return { isDuplicate: false, isPending: false, elapsedMs: null, signature: null };
  }
  const isPending = isUnresolved(match);
  const elapsedMs = match.submittedAt ? Math.max(0, Date.now() - match.submittedAt) : null;
  return {
    isDuplicate: true,
    isPending,
    elapsedMs,
    signature: match.signature,
  };
}

async function settle(signature, status, error, networkId, ctx = null) {
  if (ctx && !contextCurrent(ctx, await getActiveNetworkId())) return null;
  const result = await updateAll(networkId, (list) => {
    let changed = false;
    const next = list.map((r) => {
      if (r.signature !== signature || !isUnresolved(r) || r.status === status) return r;
      changed = true;
      return { ...r, status, settledAt: Date.now(), error };
    });
    return { next: changed ? next : null, value: changed ? next : null };
  }, ctx);
  if (!result) return null;
  const next = result;
  await publish(next, networkId, ctx);
  const settledRecord = next.find((r) => r.signature === signature) || null;
  try {
    await settleTransaction(signature, status, error, networkId,
      ctx ? activeId => contextCurrent(ctx, activeId) : null);
  } catch {
    // History cache update is best-effort
  }
  if (status === TX_STATUS.CONFIRMED && settledRecord) {
    const addrs = [settledRecord.from, settledRecord.to].filter((a) => typeof a === 'string' && a);
    if (addrs.length) {
      const activeId = await getActiveNetworkId();
      if (activeId === networkId && (!ctx || contextCurrent(ctx, activeId))) getBalances(addrs).catch(() => {});
    }
  }
  if (status === TX_STATUS.CONFIRMED && settledRecord) await rememberRegistration(settledRecord);
  return settledRecord;
}

async function rememberRegistration(record) {
  if (!record.registrationIdentity || record.registrationRemembered || !registrationRecovery?.remember) return;
  const started = generation;
  const job = (async () => {
    const result = await registrationRecovery.remember(record.registrationIdentity);
    if (started !== generation || !result?.complete) return;
    await updateAll(record.networkId, list => ({
      next: list.map(r => r.signature === record.signature ? { ...r, registrationRemembered: true } : r), value: true,
    }));
  })();
  recoveryJobs.add(job);
  try { await job; } catch { /* Retry metadata next reconciliation; never fail the transaction. */ }
  finally { recoveryJobs.delete(job); }
}

export async function resolveExecution(signature, success, networkId) {
  if (success !== true && success !== false) return null;
  return settle(signature, success ? TX_STATUS.CONFIRMED : TX_STATUS.FAILED,
    success ? null : 'Transaction failed on-chain.', networkId);
}

const reconciliations = new Map();
export async function reconcile() {
  const started = generation;
  const network = await getActiveNetworkConfig();
  const ctx = { generation: started, networkId: network.id, client: thruClient.getClient(), networkGeneration: getNetworkGeneration() };
  if (!contextCurrent(ctx, await getActiveNetworkId())) return { checked: 0, settled: 0 };
  if (reconciliations.has(network.id)) return reconciliations.get(network.id);
  const job = (async () => {
    const all = await readAll(network.id);
    if (!contextCurrent(ctx, await getActiveNetworkId())) return { checked: 0, settled: 0 };
    // Sync toolbar badge quietly without emitting pendingTxChanged when nothing settled;
    // emitting every minute causes open views to re-query RPC and reset the auto-lock timer.
    await updateBadge(all, network.id, ctx);
    for (const record of all.filter(r => r.status === TX_STATUS.CONFIRMED)) {
      if (!contextCurrent(ctx, await getActiveNetworkId())) return { checked: 0, settled: 0 };
      await rememberRegistration(record);
    }
    const unresolved = all.filter(isUnresolved);
    await syncPendingAlarm((await readAll(network.id)).some(needsTracking));
    let settledCount = 0;
    const byAddress = new Map();
    for (const record of unresolved) {
      if (!record.from) continue;
      if (!byAddress.has(record.from)) byAddress.set(record.from, []);
      byAddress.get(record.from).push(record);
    }
    for (const [address, records] of byAddress) {
      if (!contextCurrent(ctx, await getActiveNetworkId())) break;
      let history = null;
      try { history = await thruClient.listAccountHistory(address, 25); }
      catch { history = null; }
      if (!contextCurrent(ctx, await getActiveNetworkId())) break;
      const seen = history
        ? new Map(history.filter(e => e?.signature).map(e => [String(e.signature), e]))
        : new Map();
      for (const record of records) {
        const match = seen.get(record.signature);
        let status = match?.success === true ? TX_STATUS.CONFIRMED : match?.success === false ? TX_STATUS.FAILED : null;
        if (!status && record.status === TX_STATUS.SUBMITTED && Date.now() - record.submittedAt > WATCH_TIMEOUT_MS) {
          status = TX_STATUS.UNKNOWN;
        }
        const errorText = status === TX_STATUS.FAILED
          ? 'Transaction failed on-chain.'
          : status === TX_STATUS.UNKNOWN
            ? 'Could not confirm this transaction. Check the explorer.'
            : null;
        if (status && await settle(record.signature, status, errorText, network.id, ctx)) settledCount++;
      }
    }
    if (settledCount > 0 && contextCurrent(ctx, await getActiveNetworkId())) {
      const latest = await readAll(network.id);
      await syncPendingAlarm(latest.some(needsTracking));
    }
    return { checked: unresolved.length, settled: settledCount };
  })();
  reconciliations.set(network.id, job);
  try { return await job; }
  finally { if (reconciliations.get(network.id) === job) reconciliations.delete(network.id); }
}

/** Remove settled records, keeping anything still in flight. */
export async function clearSettled() {
  const networkId = await getActiveNetworkId();
  const next = await updateAll(networkId, (list) => {
    const kept = list.filter(needsTracking);
    return { next: kept, value: kept };
  });
  if (!next) return { remaining: 0 };
  await publish(next, networkId);
  await syncPendingAlarm(next.some(needsTracking));
  return { remaining: next.length };
}

/**
 * Wipe records for EVERY network. Called on wallet reset.
 *
 * Scans for scoped keys rather than removing one, because a reset must not leave the previous
 * wallet's pending transactions waiting on a network the user has not selected yet.
 */
export async function clearAll() {
  generation++;
  inFlightTransfers.clear();
  await Promise.allSettled([...pendingUpdates.values(), ...reconciliations.values(), ...recoveryJobs]);
  await registrationRecovery?.clear?.();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all || {}).filter(k => k === PENDING_BASE_KEY || k.startsWith(`${PENDING_BASE_KEY}::`));
  if (keys.length) await chrome.storage.local.remove(keys);
  await chrome.alarms?.clear?.(PENDING_ALARM);
  await updateBadge([]);
}
