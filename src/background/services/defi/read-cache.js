// Coalescing read cache for DeFi reads (G1-C). In-memory ONLY — no chrome.storage, so the
// service-worker restart story is trivial (cold cache, no migration, no persistence bug).
//
// Three guarantees, all proven in test/test-defi-market.mjs:
//
//   1. COALESCE — one in-flight upstream read per key, always. Concurrent callers share the
//      same promise (stampede protection for poll loops; pollMinMs enforcement lives in the
//      caller's TTL choice, not here).
//   2. TTL — entries are served only inside their TTL; an expired entry triggers a fresh
//      upstream read. The cache never downgrades staleness into "close enough".
//   3. B3 genesis binding — every key carries the runtime chain fingerprint. A genesis reset
//      makes all old entries unreachable by construction; there is no invalidation sweep to
//      forget. (New reads are also gate-blocked at NETWORK_RESET upstream, defense in depth.)
//
// The cache NEVER fabricates: upstream failures propagate to the caller and are not cached,
// so a flaky RPC can never turn into a remembered "answer".

/**
 * @param {{ maxEntries?: number, now?: () => number }} [opts]
 */
export function createReadCache({ maxEntries = 256, now = Date.now } = {}) {
  const entries = new Map(); // key -> { value, expiresAt, insertedAt }
  const inFlight = new Map(); // key -> Promise
  const stats = { hits: 0, misses: 0, coalesced: 0, upstreamErrors: 0 };

  function evictIfFull() {
    if (entries.size < maxEntries) return;
    // Oldest inserted first (Map preserves insertion order).
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }

  /**
   * Serve `key` from cache or run `fetcher` exactly once, sharing the in-flight promise.
   * @param {string} key full cache key (callers embed networkId + fingerprint + params hash)
   * @param {number} ttlMs freshness window for the RESULT (0 disables storage of the result;
   *   the call still coalesces)
   * @param {() => Promise<any>} fetcher upstream read — thrown errors are NOT cached
   */
  async function getOrFetch(key, ttlMs, fetcher) {
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) {
      stats.hits += 1;
      return cached.value;
    }
    if (cached) entries.delete(key);
    const pending = inFlight.get(key);
    if (pending) {
      stats.coalesced += 1;
      return pending;
    }
    stats.misses += 1;
    const promise = (async () => fetcher())();
    inFlight.set(key, promise);
    try {
      const value = await promise;
      if (ttlMs > 0) {
        evictIfFull();
        entries.set(key, { value, expiresAt: now() + ttlMs, insertedAt: now() });
      }
      return value;
    } catch (err) {
      stats.upstreamErrors += 1;
      throw err;
    } finally {
      inFlight.delete(key);
    }
  }

  /** Explicit drop (single key or everything) — e.g. a verified feed reports an index flip. */
  function invalidate(key = null) {
    if (key === null) entries.clear();
    else entries.delete(key);
  }

  return {
    getOrFetch,
    invalidate,
    stats: () => ({ ...stats, size: entries.size, inFlight: inFlight.size }),
    size: () => entries.size,
  };
}

/** Stable cache key segment for params: canonical JSON (sorted keys) of a JSON-safe value. */
export function paramsKey(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(paramsKey).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${paramsKey(value[k])}`).join(',')}}`;
}
