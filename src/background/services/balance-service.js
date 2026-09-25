// Balance service — batched reads plus a short-lived cache.
//
// Two problems this solves:
//
//   1. tx.getAccountInfo is single-address. Rabby's account switcher shows a balance on every
//      row, so an N-account list cost N sequential round-trips through the message port and N
//      RPC calls.
//   2. system.bootstrap awaited a live checkNetworkHealth() before returning anything, so the
//      popup could not paint until the network answered. Cached values let the UI render
//      immediately and correct itself when the refresh lands.
//
// Cached balances are advisory. They are always labelled with `fetchedAt` and `stale` so the UI
// can show them greyed rather than presenting a stale number as current. A wallet must never
// imply a balance is fresh when it is not.

import * as thruClient from '../../lib/thru-client.js';
import { emitBalanceChanged } from './event-service.js';
import { getActiveNetworkConfig, getActiveNetworkId } from './network-service.js';
import { scopedKey } from '../../shared/network-scope.js';

// Per-network. A balance on devnet says nothing about mainnet, so each network keeps its own
// cache rather than one shared cache that has to be wiped on every switch. Switching back and
// forth therefore preserves each side's last-known values, and staleness is decided by age
// instead of by whether someone remembered to clear.
const CACHE_BASE_KEY = 'thru_balance_cache';
const FRESH_MS = 30_000;
const MAX_CONCURRENCY = 4;
const MAX_ADDRESSES = 50;

async function cacheKey(networkId = null) {
  return scopedKey(CACHE_BASE_KEY, networkId || await getActiveNetworkId());
}

async function readCache(networkId = null) {
  try {
    const key = await cacheKey(networkId);
    const res = await chrome.storage.local.get(key);
    const cache = res?.[key];
    return cache && typeof cache === 'object' ? cache : {};
  } catch {
    return {};
  }
}

async function writeCache(cache, networkId = null) {
  try {
    await chrome.storage.local.set({ [await cacheKey(networkId)]: cache });
  } catch {
    // ignore
  }
}

/** Run tasks with a small concurrency cap so a 20-account wallet does not open 20 sockets. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Cached balances for a set of addresses, with no network access at all.
 * Safe to call on the popup's critical render path.
 *
 * @param {string[]} addresses
 * @returns {Promise<Record<string, { balance: string, exists: boolean, fetchedAt: number, stale: boolean }>>}
 */
export async function getCachedBalances(addresses = []) {
  const cache = await readCache();
  const now = Date.now();
  const out = {};
  for (const address of addresses) {
    const entry = cache[address];
    const fetchedAt = Number(entry?.fetchedAt) || 0;
    // Older versions persisted an offline fallback of "0" with fetchedAt: 0. It was never
    // observed on-chain and cannot truthfully be described as a last-known balance.
    if (entry && fetchedAt > 0) {
      out[address] = {
        balance: String(entry.balance ?? '0'),
        exists: Boolean(entry.exists),
        fetchedAt,
        stale: now - fetchedAt > FRESH_MS,
      };
    }
  }
  return out;
}

/**
 * Fetch balances for several addresses concurrently and update the cache.
 *
 * A per-address failure is reported in that address's entry rather than rejecting the whole
 * batch, so one unreachable account cannot blank out an entire switcher.
 *
 * @param {string[]} addresses
 * @param {{ emit?: boolean }} [options]
 */
export async function getBalances(addresses = [], { emit = true } = {}) {
  const unique = [...new Set(addresses.filter((a) => typeof a === 'string' && a))].slice(0, MAX_ADDRESSES);
  if (!unique.length) return {};

  // A direct tx.getBalances request after a worker restart must bind the SDK to the same
  // chain as its scoped cache. The UI is not required to call network.getActive first.
  const network = await getActiveNetworkConfig();
  const cache = await readCache(network.id);
  const now = Date.now();

  const settled = await mapLimit(unique, MAX_CONCURRENCY, async (address) => {
    try {
      const info = await thruClient.getAccountInfo(address);
      return {
        address,
        entry: {
          balance: info.balance.toString(),
          exists: Boolean(info.exists),
          fetchedAt: now,
          stale: false,
          error: null,
        },
      };
    } catch (error) {
      const previous = cache[address];
      return {
        address,
        entry: {
          balance: String(previous?.balance ?? '0'),
          exists: Boolean(previous?.exists),
          fetchedAt: Number(previous?.fetchedAt) || 0,
          stale: true,
          error: error instanceof Error ? error.message : 'Balance unavailable.',
        },
      };
    }
  });

  const out = {};
  for (const { address, entry } of settled) {
    out[address] = entry;
    // An offline read with no earlier snapshot returns a stale/unknown entry to this call,
    // but must not persist its display-only "0" as a last-known balance. The Send picker
    // may use cached values for a labelled preview; no successful read means no preview.
    if (!entry.stale) {
      cache[address] = { balance: entry.balance, exists: entry.exists, fetchedAt: entry.fetchedAt };
    }
  }
  if (await getActiveNetworkId() !== network.id) {
    const error = new Error('The network changed while balances were loading. Retry on the active network.');
    error.code = 'NETWORK_CHANGED';
    error.retryable = true;
    throw error; // never write a mixed-chain read into a fresh cache
  }
  await writeCache(cache, network.id);

  if (emit && await getActiveNetworkId() === network.id) emitBalanceChanged(out);
  return out;
}

/**
 * Sum of the given addresses' cached-or-fetched balances, as a base-unit string.
 * BigInt throughout — never floats.
 *
 * @param {string[]} addresses
 */
export async function getTotalBalance(addresses = []) {
  const balances = await getBalances(addresses, { emit: false });
  let total = 0n;
  for (const entry of Object.values(balances)) {
    try {
      total += BigInt(entry.balance || '0');
    } catch {
      // skip an unparseable entry rather than corrupting the total
    }
  }
  return { total: total.toString(), addressCount: addresses.length };
}

/** Drop a single address from the cache (e.g. after removing an account). */
export async function invalidate(address) {
  const cache = await readCache();
  delete cache[address];
  await writeCache(cache);
}

/**
 * Wipe the CURRENT network's cache.
 *
 * No longer called on network switch — each network has its own scoped cache, so a switch
 * needs no clearing at all. Kept for wallet reset, where every network's cached balances must
 * go with the keys.
 */
export async function clearCache() {
  try {
    await chrome.storage.local.remove(await cacheKey());
  } catch {
    // ignore
  }
}

/**
 * Wipe EVERY network's balance cache. Used on wallet reset: a fresh wallet must not inherit
 * the previous one's balances on any network.
 */
export async function clearAllCaches() {
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all || {}).filter((k) => k.startsWith(`${CACHE_BASE_KEY}::`) || k === CACHE_BASE_KEY);
    if (keys.length) await chrome.storage.local.remove(keys);
  } catch {
    // ignore
  }
}
