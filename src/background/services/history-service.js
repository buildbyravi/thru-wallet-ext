// History service — the wallet's local answer to Rabby's history cache (P0 of
// docs/HISTORY_REDESIGN_PLAN.md).
//
// Rabby opens its transactions tab instantly because indexed rows are cached locally and
// refreshed in the background; Thru's explorer indexer exists but its documented surface is
// agent-oriented (TOON format), so this baseline is deliberately explorer-free. Contract v12
// exposes the per-(network, address) cache as a storage-only read for first paint; the existing
// getHistoryFeed still merges a fresh RPC page and reports synced:false when offline. A slow
// network no longer holds the popup's first card paint hostage.
//
// The decode/explain work is NOT duplicated here: tx-service.listHistory already decodes
// wire-level kinds (transfer / faucet / token program, network-config-aware) and resolves
// known token symbols. This service only remembers, merges, and serializes. Presentation
// mapping (verbs, program labels) belongs to the P1 card work.

import * as txService from './tx-service.js';
import * as thruClient from '../../lib/thru-client.js';
import { getActiveNetworkConfig, getActiveNetworkId } from './network-service.js';
import { getNetworkConfig } from '../../lib/networks.js';
import { scopedKey } from '../../shared/network-scope.js';
import { getPreferences } from './preferences-service.js';

// Per-network, per-address — the same scoped-key isolation as thru_balance_cache and
// thru_pending_txs. History is not secret; it persists across locks exactly like balances.
// Registered in network-scope.js SCOPED_KEYS alongside those two.
const CACHE_BASE_KEY = 'thru_history_cache';

/**
 * The CHAIN identity a cache row belongs to — not the network identity. A testnet reset can
 * replace the chain under the SAME network id (and even the same chainId) — it already
 * happened on the previous testnet — so a
 * per-network cache happily kept serving rows from a chain that no longer exists. The
 * managed program set is the chain's identity from this wallet's perspective: it is
 * exactly what changes when genesis is replaced (see networks.js), it is available
 * offline, and it cannot drift from the transactions this wallet builds against it.
 *
 * Exported so tests can seed caches with the right (or a deliberately wrong) identity.
 */
export function chainFingerprint(network) {
  return [
    network?.id ?? '',
    network?.transferProgramId ?? '',
    network?.tokenProgramId ?? '',
    network?.faucetProgramId ?? '',
    network?.faucetStateAccount ?? '',
    network?.accountCreateProgramId ?? '',
  ].join('|');
}

function fingerprintFor(networkId) {
  try {
    return chainFingerprint(getNetworkConfig(networkId));
  } catch {
    // Custom/unknown network ids are not in the built-in table; the id is the best
    // identity available and custom networks are quarantined from selection anyway.
    return String(networkId ?? '');
  }
}
const CACHE_LIMIT = 200;
const PAGE_ON_OPEN = 15;

function validTimeMs(value) {
  const ms = Number(value);
  return Number.isSafeInteger(ms) && ms > 0 && Number.isFinite(new Date(ms).getTime())
    ? ms : null;
}

function cachedBlockTime(entry, slot) {
  return entry?.timestampSource === 'block' && String(entry.slot) === String(slot)
    ? validTimeMs(entry.timestamp) : null;
}

async function readScope(networkId) {
  // Capture the storage key ONCE. A network switch between two separate key reads could
  // otherwise mix an Betanet scope with a write keyed to another network.
  const key = scopedKey(CACHE_BASE_KEY, networkId);
  const res = await chrome.storage.local.get(key);
  const scope = res?.[key];
  const stored = scope && typeof scope === 'object' && !Array.isArray(scope) ? scope : {};
  // Chain-identity gate: rows written under a different genesis (or before this check
  // existed) are dropped on READ, never merged into a live feed again. The read stays
  // write-free; the discarded scope is overwritten the next time a fetch persists rows.
  if (stored._chain !== fingerprintFor(networkId)) {
    return { key, scope: { _chain: fingerprintFor(networkId) } };
  }
  return { key, scope: stored };
}

function cachedPage(scope, address) {
  const cached = Object.prototype.hasOwnProperty.call(scope, address) ? scope[address] : null;
  return cached && typeof cached === 'object' && Array.isArray(cached.entries)
    ? cached : { entries: [], nextCursor: 0, updatedAt: 0 };
}

// Several extension views can refresh DIFFERENT addresses on the same chain concurrently.
// A plain read-modify-write of the shared network scope loses one writer's account. Queue
// only the storage write critical section; RPCs and cache-first reads remain independent.
const scopeUpdates = new Map();
function updateScope(networkId, edit) {
  const key = scopedKey(CACHE_BASE_KEY, networkId);
  const prior = scopeUpdates.get(key) || Promise.resolve();
  const update = prior.catch(() => {}).then(async () => {
    const { scope } = await readScope(networkId);
    const { changed, value } = await edit(scope);
    if (changed) await chrome.storage.local.set({ [key]: scope });
    return value;
  });
  scopeUpdates.set(key, update);
  return update.finally(() => {
    if (scopeUpdates.get(key) === update) scopeUpdates.delete(key);
  });
}

/**
 * Return ONLY persisted history for this (active network, address). No RPC, client binding,
 * pending reconciliation or vault access: the UI can paint it before a fresh feed is fetched.
 * Cache rows have already crossed the string-only API seam and contain no key material.
 */
export async function getCachedHistory(address) {
  const networkId = await getActiveNetworkId();
  const { scope } = await readScope(networkId);
  const cached = cachedPage(scope, address);
  return {
    address,
    networkId,
    entries: cached.entries,
    nextCursor: cached.nextCursor ?? 0,
    updatedAt: cached.updatedAt ?? 0,
  };
}

/**
 * First page of the history feed for an address: cached fallback, fresh when the network
 * answers, merged newest-first and deduped by signature. For a true cache-first UI, call
 * getCachedHistory separately; this method still waits for RPC before it returns.
 * @param {string} address
 * @returns {Promise<{ entries: object[], nextCursor: number|null, synced: boolean }>}
 */
export async function getHistoryFeed(address) {
  const network = await getActiveNetworkConfig(); // a cold worker must bind before its RPC
  const { scope } = await readScope(network.id);
  const cached = cachedPage(scope, address);

  try {
    const page = await txService.listHistory(address, {
      limit: PAGE_ON_OPEN, cursor: 0, skipBlockTimes: true,
    });
    if ((await getActiveNetworkId()) !== network.id) {
      const error = new Error('The network changed while fetching history. Retry on the new network.');
      error.code = 'NETWORK_CHANGED';
      throw error;
    }
    const fresh = Array.isArray(page) ? page : (page?.entries || []);
    const nextCursor = Array.isArray(page) ? fresh.length : (page?.nextCursor ?? fresh.length);

    // The history wire has slots, not wall-clock times. Resolve block headers OUTSIDE the
    // shared storage-write queue; a slow header for address A must not block address B's
    // refresh/removal. A snapshot of cached block times avoids repeat RPCs across workers;
    // the queued edit below re-reads the latest scope before merging concurrent writes.
    const initialMap = new Map(cached.entries
      .map((e) => [e?.signature, e]).filter(([signature]) => Boolean(signature)));
    const missingSlots = [...new Set(fresh
      .filter((e) => e?.slot != null && !e.timestamp
        && !cachedBlockTime(initialMap.get(e.signature), e.slot))
      .map((e) => String(e.slot)))];
    const blockTimes = new Map();
    await Promise.all(missingSlots.map(async (slot) => {
      const timeMs = await thruClient.getBlockTimeMs(slot, network.id).catch(() => null);
      if (timeMs !== null) blockTimes.set(slot, timeMs);
    })); // at most PAGE_ON_OPEN unique headers; duplicate slots share one request

    // Chain-reality evidence from the live fetch: a cached row stamped above what this
    // chain has produced cannot belong to it. A genesis swap can reuse the same managed
    // program addresses (the previous testnet's resets did), so the offline _chain fingerprint alone cannot see a genesis
    // swap — the previous incarnation's rows (far higher slots) must not resurface beside
    // fresh ones. Resolved outside the write queue, like the block headers above.
    let headSlot = null;
    try {
      const height = await thruClient.getBlockHeight();
      const finalized = height?.finalized;
      headSlot = finalized == null ? null : Number(finalized);
      if (!Number.isFinite(headSlot)) headSlot = null;
    } catch {
      headSlot = null;
    }
    if (headSlot == null && fresh.length) {
      // Fallback when the height query is unavailable: the newest page's own slots bound
      // what this chain has produced. A cached row newer than the newest page cannot
      // exist — it would BE in that page.
      headSlot = fresh.reduce((m, e) => (Number(e?.slot) > m ? Number(e.slot) : m), 0) || null;
    }
    const onThisChain = (e) => headSlot == null || e?.slot == null || Number(e.slot) <= headSlot;

    // Local submittedAt/settledAt is a real event time, but not the chain's block time.
    // Keep it only as a fallback for our own sends when a block time is unavailable.
    const pendingKey = scopedKey('thru_pending_txs', network.id);
    const pendingRes = await chrome.storage.local.get(pendingKey).catch(() => ({}));
    const pendingStored = pendingRes?.[pendingKey];
    const pendingList = Array.isArray(pendingStored)
      ? pendingStored // schema v0
      : (Array.isArray(pendingStored?.records) ? pendingStored.records : []);
    const pendingTimestamps = new Map(pendingList
      .map((p) => [p?.signature, validTimeMs(p?.submittedAt) || validTimeMs(p?.settledAt)])
      .filter(([signature, ms]) => Boolean(signature) && ms !== null));

    const merged = await updateScope(network.id, async (latestScope) => {
      if ((await getActiveNetworkId()) !== network.id) {
        const error = new Error('The network changed while fetching history. Retry on the new network.');
        error.code = 'NETWORK_CHANGED';
        throw error;
      }
      // Re-read inside the serialized write section: an overlapping feed for a DIFFERENT
      // account may have updated this scope while the RPC was running. Preserve both rows.
      const latest = cachedPage(latestScope, address);
      const seen = new Set(fresh.map((e) => e?.signature).filter(Boolean));
      const cachedMap = new Map(latest.entries
        .map((e) => [e?.signature, e])
        .filter(([signature]) => Boolean(signature)));
      for (const e of fresh) {
        const previous = cachedMap.get(e.signature);
        const blockTime = e.slot != null
          ? blockTimes.get(String(e.slot)) || cachedBlockTime(previous, e.slot) : null;
        if (blockTime) {
          e.timestamp = blockTime;
          e.timestampSource = 'block';
        } else if (!e.timestamp) {
          // A previously verified block time from a DIFFERENT slot is not this block's time.
          const previousTime = previous?.timestampSource === 'block'
            && String(previous.slot) !== String(e.slot) ? null : validTimeMs(previous?.timestamp);
          const submittedTime = pendingTimestamps.get(e.signature);
          e.timestamp = submittedTime || previousTime || null;
          if (e.timestamp) e.timestampSource = submittedTime ? 'submitted' : previous?.timestampSource || null;
        }
      }
      const pendingCached = latest.entries.filter((e) => e?.status === 'submitted' && e?.signature && !seen.has(e.signature));
      const olderCached = latest.entries.filter((e) => e?.status !== 'submitted' && e?.signature && !seen.has(e.signature) && onThisChain(e));
      const entries = [
        ...pendingCached,
        ...fresh,
        ...olderCached,
      ].slice(0, CACHE_LIMIT);
      latestScope[address] = { entries, nextCursor, updatedAt: Date.now() };
      return { changed: true, value: entries };
    });
    return { entries: merged, nextCursor, synced: true };
  } catch (error) {
    if (error?.code === 'NETWORK_CHANGED') throw error;
    // Offline / unreachable RPC: the cached page, honestly labelled as not synced.
    return { entries: cached.entries, nextCursor: cached.nextCursor ?? 0, synced: false };
  }
}

/**
 * Persist a freshly submitted transaction into the local history cache immediately.
 * This matches the Rabby pattern: outgoing transactions appear in the local activity stream
 * instantaneously without waiting for on-chain block mining / indexing.
 *
 * @param {{ signature: string, kind: string, from: string, to?: string, amountUnits?: string,
 *   mint?: string, displayAmount?: string, tokenSymbol?: string, tokenDecimals?: number, networkId?: string }} tx
 */
export async function recordSubmittedTransaction(tx) {
  if (!tx?.signature || !tx?.from) return;
  const networkId = tx.networkId || await getActiveNetworkId();
  const entry = {
    signature: String(tx.signature),
    slot: null,
    timestamp: Date.now(),
    timestampSource: 'submitted',
    status: 'submitted',
    kind: tx.kind === 'token' ? 'token-sent' : (tx.kind === 'faucet' ? 'faucet' : 'sent'),
    from: tx.from,
    to: tx.to || null,
    counterparty: tx.to || null,
    amount: tx.amountUnits != null ? String(tx.amountUnits) : null,
    displayAmount: tx.displayAmount || null,
    tokenSymbol: tx.tokenSymbol || null,
    tokenDecimals: tx.tokenDecimals != null ? Number(tx.tokenDecimals) : null,
    tokenMint: tx.mint || null,
    success: true,
  };

  await updateScope(networkId, (scope) => {
    // 1. Update sender's history cache
    const page = cachedPage(scope, tx.from);
    const existing = page.entries.filter((e) => e?.signature !== entry.signature);
    scope[tx.from] = {
      entries: [entry, ...existing].slice(0, CACHE_LIMIT),
      nextCursor: page.nextCursor ?? 0,
      updatedAt: Date.now(),
    };

    // 2. If the recipient is also an account in this wallet's cache, record the incoming side
    if (tx.to && tx.to !== tx.from && Object.prototype.hasOwnProperty.call(scope, tx.to)) {
      const recipientPage = cachedPage(scope, tx.to);
      const recipientEntry = {
        ...entry,
        kind: tx.kind === 'token' ? 'token-received' : 'received',
        counterparty: tx.from,
      };
      const existingRecipient = recipientPage.entries.filter((e) => e?.signature !== entry.signature);
      scope[tx.to] = {
        entries: [recipientEntry, ...existingRecipient].slice(0, CACHE_LIMIT),
        nextCursor: recipientPage.nextCursor ?? 0,
        updatedAt: Date.now(),
      };
    }

    return { changed: true, value: true };
  });
}

/**
 * Update a settled transaction in the local history cache when confirmation or failure is detected.
 *
 * @param {string} signature
 * @param {string} status 'confirmed' | 'failed' | 'unknown'
 * @param {string|null} [error=null]
 * @param {string|null} [networkId=null]
 */
export async function settleTransaction(signature, status, error = null, networkId = null) {
  if (!signature) return;
  const netId = networkId || await getActiveNetworkId();
  await updateScope(netId, (scope) => {
    let changed = false;
    for (const [address, page] of Object.entries(scope)) {
      if (address.startsWith('_') || !page?.entries || !Array.isArray(page.entries)) continue;
      let accountChanged = false;
      const nextEntries = page.entries.map((e) => {
        if (e?.signature !== signature) return e;
        accountChanged = true;
        changed = true;
        return {
          ...e,
          status,
          success: status === 'confirmed',
          error: error || (status === 'failed' ? (e.error || 'Transaction failed on-chain.') : null),
          settledAt: Date.now(),
        };
      });
      if (accountChanged) {
        scope[address] = {
          ...page,
          entries: nextEntries,
          updatedAt: Date.now(),
        };
      }
    }
    return { changed, value: changed };
  });

  // Desktop notification if enabled
  try {
    if (chrome?.notifications?.create && (status === 'confirmed' || status === 'failed')) {
      const prefs = await getPreferences().catch(() => null);
      if (prefs?.desktopNotifications !== false) {
        const title = status === 'confirmed' ? 'Transaction Confirmed' : 'Transaction Failed';
        const msg = status === 'confirmed'
          ? `Transfer confirmed on Thru (${netId}).`
          : `Transfer failed on Thru: ${error || 'Unknown error'}`;
        chrome.notifications.create(`thru-tx-${signature}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title,
          message: msg,
          priority: 1,
        });
      }
    }
  } catch {
    // Non-blocking notification
  }
}

/**
 * Drop an address's cached feed (e.g. account removal). Storage stays bounded by design.
 */
export async function clearHistoryCache(address) {
  const networkId = await getActiveNetworkId();
  await updateScope(networkId, (scope) => {
    if (!Object.prototype.hasOwnProperty.call(scope, address)) return { changed: false };
    delete scope[address];
    return { changed: true };
  });
}
