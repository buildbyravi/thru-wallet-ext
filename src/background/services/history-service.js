// History service — the wallet's local answer to Rabby's history cache (P0 of
// docs/HISTORY_REDESIGN_PLAN.md).
//
// Rabby opens its transactions tab instantly because indexed rows are cached locally and
// refreshed in the background; Thru's explorer indexer exists but its documented surface is
// agent-oriented (TOON format), so this baseline is deliberately explorer-free: the first
// page of the history view is served from a per-(network, address) cache and merged with a
// fresh page fetched in the same breath. Offline or slow RPC means the popup still paints
// the last known history immediately, marked by `synced: false` rather than misrepresented
// as current.
//
// The decode/explain work is NOT duplicated here: tx-service.listHistory already decodes
// wire-level kinds (transfer / faucet / token program, network-config-aware) and resolves
// known token symbols. This service only remembers, merges, and serializes. Presentation
// mapping (verbs, program labels) belongs to the P1 card work.

import * as txService from './tx-service.js';
import { getActiveNetworkId } from './network-service.js';
import { scopedKey } from '../../shared/network-scope.js';

// Per-network, per-address — the same scoped-key isolation as thru_balance_cache and
// thru_pending_txs. History is not secret; it persists across locks exactly like balances.
// Registered in network-scope.js SCOPED_KEYS alongside those two.
const CACHE_BASE_KEY = 'thru_history_cache';
const CACHE_LIMIT = 200;
const PAGE_ON_OPEN = 15;

async function cacheKey() {
  return scopedKey(CACHE_BASE_KEY, await getActiveNetworkId());
}

async function readScope() {
  const res = await chrome.storage.local.get(await cacheKey());
  const scope = res?.[await cacheKey()];
  return scope && typeof scope === 'object' ? scope : {};
}

/**
 * First page of the history feed for an address: cache immediately, fresh when the network
 * answers, merged newest-first and deduped by signature.
 * @param {string} address
 * @returns {Promise<{ entries: object[], nextCursor: number|null, synced: boolean }>}
 */
export async function getHistoryFeed(address) {
  const scope = await readScope();
  const cached = scope[address] && typeof scope[address] === 'object'
    ? scope[address]
    : { entries: [], nextCursor: 0, updatedAt: 0 };

  try {
    const page = await txService.listHistory(address, { limit: PAGE_ON_OPEN, cursor: 0 });
    const fresh = Array.isArray(page) ? page : (page?.entries || []);
    const nextCursor = Array.isArray(page) ? fresh.length : (page?.nextCursor ?? fresh.length);

    // Fresh rows define the top of the list; cache rows not present in the fresh page keep
    // older history available without another round-trip. Signatures dedupe; cap is a bound,
    // not a suggestion — storage writes must stay bounded forever.
    const seen = new Set(fresh.map((e) => e?.signature).filter(Boolean));
    const cachedMap = new Map((cached.entries || [])
      .map((e) => [e?.signature, e])
      .filter(([sig]) => Boolean(sig)));

    // The history wire carries NO wall-clock timestamp (slots only — production reality).
    // Backfill what we honestly know: our own submittedAt/settledAt for transactions this
    // wallet sent (pending-tx-service records them), or a previously cached timestamp.
    const netId = await getActiveNetworkId();
    const pendingKey = scopedKey('thru_pending_txs', netId);
    const pendingRes = await chrome.storage.local.get(pendingKey).catch(() => ({}));
    const pendingList = Array.isArray(pendingRes?.[pendingKey]) ? pendingRes[pendingKey] : [];
    const pendingTimestamps = new Map(
      pendingList
        .filter((p) => p?.signature && (p.submittedAt || p.settledAt))
        .map((p) => [p.signature, p.submittedAt || p.settledAt]),
    );
    for (const e of fresh) {
      if (!e.timestamp) {
        e.timestamp = pendingTimestamps.get(e.signature) || cachedMap.get(e.signature)?.timestamp || null;
      }
    }

    const merged = [
      ...fresh,
      ...(cached.entries || []).filter((e) => e?.signature && !seen.has(e.signature)),
    ].slice(0, CACHE_LIMIT);

    scope[address] = { entries: merged, nextCursor, updatedAt: Date.now() };
    await chrome.storage.local.set({ [await cacheKey()]: scope });
    return { entries: merged, nextCursor, synced: true };
  } catch {
    // Offline / unreachable RPC: the cached page, honestly labelled as not synced.
    return { entries: cached.entries || [], nextCursor: cached.nextCursor ?? 0, synced: false };
  }
}

/**
 * Drop an address's cached feed (e.g. account removal). Storage stays bounded by design.
 */
export async function clearHistoryCache(address) {
  const scope = await readScope();
  if (!(address in scope)) return;
  delete scope[address];
  await chrome.storage.local.set({ [await cacheKey()]: scope });
}
