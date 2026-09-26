# History / Transaction view — shipped behavior and open checks

**Status (2026-09-26):** the flat, cache-first History behavior described below is shipped in `src/`. Browser and live-chain checks remain open. Rabby links are UX/code-pattern references only; automated fixtures are not live-chain evidence.

---

## 1. Shipped History behavior

### Flat stream and cards

The History route renders one flat, newest-first card stream with **no Today/Yesterday or other day-group headers**. Cards show the transaction verb/context, signed amount, a time label when one is available, network/signature metadata, and copy/explorer actions. Token entries use decoded direction and the viewer's own token accounts where available. A token-account initialization is not presented as a THRU transfer. The current card has **no per-card fee line**.

When a timestamp is known, the card uses the user's local calendar and displays `YYYY/MM/DD HH:mm`. It does not calculate day headers or infer a timestamp from a neighboring transaction.

### Cache-first load and network scope

Contract v9 added `tx.getHistoryFeed`, which merges a fresh RPC page with cached rows and reports whether the feed synced. That call itself waits for its RPC result, so contract v12 added the storage-only `tx.getCachedHistory({ address })` read. On route entry:

1. The route reads cached rows for the active **network and address**, paints them immediately, and labels them cached/checking.
2. Pending reconciliation and account-label lookup run independently; they do not gate the first card paint.
3. The fresh feed replaces/merges rows and clears or updates the offline label. With no cache and an unavailable network, the route says the activity is unavailable rather than claiming there are no transactions.
4. Account/network changes, route teardown, and stale asynchronous replies are guarded so old results are not displayed in the new context.
5. Load-more uses cursor paging and deduplicates overlapping signatures.

History cache storage is network-scoped and address-keyed. Concurrent refreshes for different addresses serialize only their shared-scope writes; block-header RPCs run outside that write section. Cache entries are not secret and remain available across wallet locks.

### Block-time provenance and fallback

The transaction record supplies a slot, not its own timestamp. The shipped implementation resolves the containing block's optional time through the SDK, captures the network/RPC context, and scopes successful lookup reuse by network, RPC endpoint, and slot. A verified block time is stored with `timestampSource: 'block'`.

If a block time is unavailable, the wallet may display an actual local submission time for its own submitted transaction; the cached record identifies it with `timestampSource: 'submitted'`. It does not substitute the current clock or borrow another entry's time. If neither a block time nor a valid local submission time exists, the card displays `Block <slot>` (or no time when no slot exists).

"Load more" enriches the displayed page rather than reusing a timestamp from another network or slot. The detail sheet separately labels its optional chain value **Block time** and renders "Not available" when the node/detail read supplies none.

### Detail sheet and fee honesty

Contract v10 added the lazy `tx.getDetail` request used when a card is opened. The sheet shows details for the selected transaction, including signature, status, amount/counterparty, slot/network, program, optional block time, and the header-declared fee when available. The fee row says **Fee (declared)**; it is not a receipt of the amount debited. The current RPC detail response has no charged-fee field, so the UI does not present a claimed charged fee. The list card itself has no fee line.

The sheet is keyboard-operable, traps focus, restores focus when closed, and is owned by the route rather than an individual card that can be repainted.

---

## 2. Rabby cross-check — presentation patterns, not Thru protocol authority

Rabby is useful as a reference for a compact History list and a separate local pending/submission lifecycle. Its History implementation consumes its own backend/indexer shapes; those are not Thru RPC semantics and must not be copied into this extension as protocol facts.

- [Rabby Wallet repository](https://github.com/RabbyHub/Rabby)
- [History view directory](https://github.com/RabbyHub/Rabby/tree/develop/src/ui/views/History)
- [`HistoryItem.tsx`](https://github.com/RabbyHub/Rabby/blob/develop/src/ui/views/History/components/HistoryItem.tsx) — current History card example
- [`transactionHistory.ts`](https://github.com/RabbyHub/Rabby/blob/develop/src/background/service/transactionHistory.ts) — current local transaction-history service example

The shipped Thru UI borrows the flat-card presentation pattern, not Rabby's token/fee/indexer data contract.

---

## 3. Source and deterministic test coverage

Implementation locations:

- `src/ui/app/routes/history.js` — cache-first render, status banner, paging, context invalidation, filters, and detail-sheet lifecycle.
- `src/ui/domain/tx-card.js` — flat transaction card and local-calendar time formatting.
- `src/ui/domain/tx-detail-sheet.js` — lazy detail display and declared-fee/time labels.
- `src/background/services/history-service.js` — storage-only cache read, RPC-merged feed, network/address scope, block-time provenance, and serialized cache writes.
- `src/background/services/tx-service.js` and `src/lib/thru-client.js` — history decoding, paging, and detail/block-time RPC adapters.
- `src/shared/network-scope.js` — network-scoped storage keys.
- `src/shared/contract/manifest.js` — v9, v10, and v12 method declarations.

Deterministic tests include `test/test-history-cache.mjs`, `test/test-history-block-time.mjs`, `test/test-route-lifecycle.mjs`, `test/test-api-router.mjs`, and the History decode cases in `test/test-thru-client.mjs`. They cover cache-first behavior, network/slot collisions, concurrency and stale responses, missing-time fallback, page enrichment, fee-label honesty, and DOM/lifecycle behavior with mocks. They do not prove live RPC availability, popup timing, real layout, or Chrome worker scheduling.

---

## 4. Open live-chain and browser checks

Keep these open until run against the actual environment; passing automated tests is not a substitute.

| Check | Why it remains open | Runbook/source |
| --- | --- | --- |
| Live block-time availability and first-load latency on each enabled network | `blockTimeNs` is optional; deterministic fixtures cannot establish what the current node returns or the latency of the first uncached lookup. | `docs/MANUAL_SMOKE_CHECKLIST.md` |
| Live charged-fee source, if any | The current RPC response lacks a charged-fee field. Any explorer enrichment must first establish a typed, supported response and its provenance. | Official [Explorer MCP overview](https://thru.org/docs/api-ref/explorer-mcp/overview/) is not itself a typed wallet API; see `docs/BACKEND_GAPS.md`. |
| Explorer transaction route | A link pattern such as `/tx/<signature>` must be confirmed for the deployed explorer; do not infer protocol support from a URL convention. | `docs/STATUS_AND_ROADMAP.md` |
| Current real-Chrome History layout, card focus, sheet scrolling, copy, and popup/side-panel behavior | DOM shims have no layout engine and cannot certify browser rendering or interaction. | `docs/MANUAL_SMOKE_CHECKLIST.md` |
| v12 activation and token-transfer live behavior | These affect account activation and token receipts, not just History rendering; see the current Send/backend open items. | `docs/SEND_PATH_AUDIT.md`, `docs/BACKEND_GAPS.md` |

Official Thru references for protocol cross-checks: [Thru docs](https://thru.org/docs/), [gRPC API overview](https://thru.org/docs/api-ref/grpc/overview/), and [Explorer MCP overview](https://thru.org/docs/api-ref/explorer-mcp/overview/). Match them against the repository's pinned SDK version and `src/` implementation.

---

## 5. Explicit non-claims

- No day-grouping headers are shipped; old day-boundary and day-count discussions are historical, not current UI behavior.
- No per-card fee is shipped. The detail sheet shows only a clearly labelled declared fee; no charged amount is inferred.
- The popup does not consume Explorer MCP/TOON output, and the explorer is not on the History first-paint path.
- No arbitrary-program decoder, fiat-price line, or indexed third-party protocol label is claimed shipped by this History work.
- A deterministic block-time test does not certify that a live node supplies timestamps or that the lookup meets a latency target.
