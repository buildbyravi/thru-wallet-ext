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
import { getActiveNetworkConfig, getActiveNetworkId } from './network-service.js';
import { scopedKey } from '../../shared/network-scope.js';

// Per-network, per-address — the same scoped-key isolation as thru_balance_cache and
// thru_pending_txs. History is not secret; it persists across locks exactly like balances.
// Registered in network-scope.js SCOPED_KEYS alongside those two.
const CACHE_BASE_KEY = 'thru_history_cache';
const CACHE_LIMIT = 200;
const PAGE_ON_OPEN = 15;

async function readScope(networkId) {
  // Capture the storage key ONCE. A network switch between two separate key reads could
  // otherwise mix an Alphanet scope with a Localnet write.
  const key = scopedKey(CACHE_BASE_KEY, networkId);
  const res = await chrome.storage.local.get(key);
  const scope = res?.[key];
  return { key, scope: scope && typeof scope === 'object' && !Array.isArray(scope) ? scope : {} };
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
    const page = await txService.listHistory(address, { limit: PAGE_ON_OPEN, cursor: 0 });
    if ((await getActiveNetworkId()) !== network.id) {
      const error = new Error('The network changed while fetching history. Retry on the new network.');
      error.code = 'NETWORK_CHANGED';
      throw error;
    }
    const fresh = Array.isArray(page) ? page : (page?.entries || []);
    const nextCursor = Array.isArray(page) ? fresh.length : (page?.nextCursor ?? fresh.length);

    // The history wire carries NO wall-clock timestamp (slots only — production reality).
    // Backfill what we honestly know: our own submittedAt/settledAt for transactions this
    // wallet sent (pending-tx-service records them), or a previously cached timestamp.
    const pendingKey = scopedKey('thru_pending_txs', network.id);
    const pendingRes = await chrome.storage.local.get(pendingKey).catch(() => ({}));
    const pendingList = Array.isArray(pendingRes?.[pendingKey]) ? pendingRes[pendingKey] : [];
    const pendingTimestamps = new Map(
      pendingList
        .filter((p) => p?.signature && (p.submittedAt || p.settledAt))
        .map((p) => [p.signature, p.submittedAt || p.settledAt]),
    );
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
        if (!e.timestamp) {
          e.timestamp = pendingTimestamps.get(e.signature) || cachedMap.get(e.signature)?.timestamp || null;
        }
      }
      const entries = [
        ...fresh,
        ...latest.entries.filter((e) => e?.signature && !seen.has(e.signature)),
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
