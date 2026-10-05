# G1-C — Market read layer (delivery record)

**Delivered 2026-10-06**, branch `arena/01a10804-thru-wallet-ext` (PR #19). Gate: G1
(read-only + registry/feeds/market layer), third slice. G1-A and G1-B are delivered and were
each verified green by the owner's forensic audits (`1997838` / `c246b67`). After this slice,
the G1 registry/feeds/market triad is structurally complete; what remains for **gate
closure** is the live evidence session and the owner's G1 sign-off.

## What G1-C builds

- **`src/background/services/defi/read-cache.js`** — the coalescing read cache for DeFi reads.
- **`src/background/services/defi/market-reads.js`** — per-slice assembly for the `market.*`
  wire shapes (chain-before-index ladders + honest fallbacks).
- **`market-service.js`** — the past-gate path now runs the real slice layer for
  `assetGet`/`snapshot` (search/candles/trades/holders stay loud-NOT_READY until their readers
  exist); the gate ladder still resolves first, so **the wire is byte-identical to M0**.

## The three cache guarantees

1. **Coalesce** — one in-flight upstream read per key, always: concurrent callers share the
   same promise (stampede protection for poll loops; `pollMinMs` stays enforced by caller TTL
   policy).
2. **TTL honesty** — entries are served only inside their TTL; expiry triggers a fresh
   upstream read. Errors propagate and are never cached (a flaky RPC can never turn into a
   remembered "answer"). `ttlMs: 0` coalesces in-flight but stores nothing.
3. **B3 binding by key** — every key embeds `{method}|{networkId}|{fingerprint}|{params}`.
   A genesis reset makes all old entries unreachable *by construction*; no invalidation sweep
   exists to be forgotten. Layered under the gate's `NETWORK_RESET` refusal — defense in depth.

In-memory only (zero storage writes); bounded (`maxEntries`, oldest evicted); `invalidate()`
exists for the future verified-feed index-flip signal.

## The slice ladder (chain-before-index, honest fallbacks)

Every market answer is assembled from independent slices — so when evidence flips one
capability (indexer feed lands, USD oracle verifies), only that slice changes:

```
chain read (evidence-pinned fetcher) -> index read (feed-supplement) -> honest S10 reason
```

- A missing source is an honest no-answer, never a zero, never a fabricated number.
- Chain runs first; an index supplement can never outrank on-chain truth (R16), and the
  call order is proven by assertion in the gate test.
- Unsupported dossier rows short-circuit the reads entirely (no upstream traffic for a slice
  whose capability is unverified) — `facts` still carries the recorded evidence statements.
- The slice env (dossier views, feed facts, cache, TTLs) is built by `market-service` from
  the registry; `market-reads.js` imports no service — `services/defi` stays the leaf.

## Verification (recorded at delivery)

- **`test/test-defi-market.mjs` (25/25)**: coalescing (5 concurrent → 1 upstream), TTL expiry
  + never-serve-stale, error propagation (uncached), fingerprint-in-key isolation, bounded
  eviction, invalidation, canonical params keys; slice ladders (today's honest states, index
  supplement, chain-first call order, both-fail fallback, snapshot short-circuit, cache
  coalescing across assembles, genesis isolation); router wire byte-identical to M0 on the
  flag-on dossier rung; zero storage writes.
- M0 98/98, registry 27/27, feed 35/35 unchanged — additive by construction.
- Layering 96→98 files, 0 violations; build clean; collector `--check` PASS.

## Boundary (what G1-C is NOT)

- No chain fetchers and no index fetchers are pinned yet — the `chainReads`/`indexReads`
  slots stay inert until an evidence-pinned reader exists (oracle probe output for price;
  indexer answer for Q9). Readers land with evidence, inside G2 work.
- `market.assetSearch`/`candles`/`trades`/`holders` keep the loud `NOT_READY` past-gate
  branch until their slice assemblers have a reader to call; the G0 rule stands: an
  unimplemented proceed branch is loud, never silent.
- The watchlist stays FEATURE_DISABLED (storage-only CRUD ships with the market feature flag,
  not with this gate).
