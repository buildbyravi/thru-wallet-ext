# History / Transaction tab redesign — study of Rabby + plan

Status: **P0 + P1 + P2 shipped**. P0: `services/history-service.js` + contract v9
`tx.getHistoryFeed` (cache-merged, offline-labelled, append-deduped). P1:
`domain/tx-card.js` + a flat card stream (no day headers), verb + context, signed
right-aligned deltas, local-calendar `YYYY/MM/DD HH:mm` when a date is known, network +
short-signature meta with copy/explorer actions, and a failed badge. There is no per-card
fee line (no fee on the history wire; P2's lazy detail fetch is where it belongs).

The transaction wire carries a slot but no time: `history-service.js` resolves the
block's optional timestamp for the cached first page, prefers it over the wallet's
local submission time, and persists the source alongside the date. Paginated
`tx.listHistory` enriches only the displayed page; the old positional-array API stays
unchanged. Missing block/local times fall back to `Block <slot>`, not a fabricated
wall-clock time. Own-account counterparties render by name via `account.list`. The old
boundary-day heuristic is obsolete now that History has no day grouping.

**Contract v12 cache-first follow-up (2026-09-25):** v9's `tx.getHistoryFeed` read the cache but did not return until its RPC finished, and the route waited for pending reconciliation before drawing cards. The additive, storage-only `tx.getCachedHistory({ address })` now returns `{ address, networkId, entries, nextCursor, updatedAt }` from the per-network/address scope without binding a client or touching RPC. History paints those rows immediately with a **cached / checking network** label, independently loads labels/pending, then replaces rows and clears the label when the existing `tx.getHistoryFeed` reports a fresh page. Offline retains cached cards honestly; no-cache + offline says unavailable, not "No transactions". Network/account switches and route teardown invalidate all late cache/feed/pending/page responses; load-more waits until revalidation finishes. Concurrent feeds for different addresses on one network serialize their shared-scope cache writes, preserving both accounts. This is still explorer-free. See `test/test-history-cache.mjs` and the lifecycle race tests; real popup timing has not been measured.

P2 (this cycle): `domain/tx-detail-sheet.js` + contract v10 `tx.getDetail` + `thru-client.getTransactionDetail` (additive; the sacred client gained one new export and changed zero existing lines). Tapping a card — now a real keyboard-operable control (`role="button"`, tabindex, Enter/Space, Escape closes, focus restores) — opens a bottom-anchored `.modal-card`/`.modal-overlay` sheet reusing the password-prompt focus-trap + disposer discipline. It paints synchronously from the tapped entry (full signature + copy, status, signed amount, counterparty resolved against `account.list`, network, block) and then lazily fills two rows from one on-demand `tx.getDetail` call. **Explorer-free**, as required: the enrichment lane runs entirely on the existing RPC surface. Honest omissions, spiked before any UI was written (`docs/archive/TX_DETAIL_SPIKE.md`): Thru's `TransactionExecutionResult` carries **no charged-fee field**, so the sheet shows the header-DECLARED fee, labels it "Fee (declared)", and states inline that the amount actually debited is not reported by the network — `tx.getDetail` returns `feeCharged: false` so no future caller can mistake one for the other. Wall-clock time is not on the transaction either but IS on the containing block (`BlockHeader.block_time` → `Block.blockTimeNs`), so the sheet fetches it via `blocks.get({slot})` and labels it "Block time"; when the node omits it the row reads "Not available". Unknown → stated-absent, never guessed, with negative controls in `test-route-lifecycle.mjs` proving the fabricated-fee and local-clock cases would actually fail. Next: P2.5 explorer-enrichment spike (the only place a charged fee might exist).
Reference screenshots: Rabby's Transactions tab (cards with protocol glyph, method,
token deltas, gas line, chain badge, short tx id + copy, time).

> **Indexer correction (2026-09-20):** the first version of this doc claimed "Thru has no
> indexer". **Wrong.** Thru's explorer (`https://scan.thru.org`) is backed by an indexer,
> documented at `docs/api-ref/explorer-mcp/`: an MCP surface (`/api/mcp`, 8 tools —
> `list_account_transactions(address, pageSize, pageToken)`, `get_transaction`,
> `get_program_abi`, `get_block`, `get_account`, `list_recent_*`, `search`). Caveat: every
> MCP tool answers in `format=toon` — LLM-consumption text, a surface for *agents*, not a
> typed contract an extension background should consume per popup open. The typed explorer
> API exists underneath but is undocumented so far; **enrichment via explorer needs a
> spike** to validate shapes before the wallet depends on them (see P2.5).

## 1. How Rabby actually builds that screen (verified against RabbyHub/Rabby)

Rabby's transactions UI is *thin*. The intelligence lives in their backend API:

- `src/ui/views/History/components/HistoryItem.tsx` — the card. All display data comes
  from typed `TxDisplayItem` / `TxHistoryItem` returned by **`@/background/service/openapi`
  (DeBank OpenAPI)**: `cate_id` (method: send/receive/approve/collect/execute),
  `project` (protocol name), token deltas as full `TokenItem`s (symbol, decimals, logo),
  chain, time, tx id. The component only assembles: `TokenChange` (delta lines with
  logos), `TxId` (chain + short id + copy), `sinceTime` (relative time), skeletons.
- `src/background/service/transactionHistory.ts` (~42 KB) — local layer for what the
  indexer can't tell them: locally submitted txs grouped by `(chainId, nonce)`
  (`TransactionGroup`), persisted with `createPersistStore` (browser.storage.local),
  pending/submitted/completed lifecycle, speed-up/cancel, mempool items.
- `@/db/schema/history` (`TxHistoryItemRow`) — a local SQLite cache of indexed rows so
  the list is instant on open and pages without refetching.

**What carries their weight for us (post-correction):** Rabby does not *decode* history
in the wallet — DeBank's indexer hands them parsed display items. Thru DOES have an
indexer behind the explorer (see the correction above), but its documented surface is
agent-oriented TOON text, so the shaping constraint for the *baseline* is unchanged:
P0/P1 must not require the explorer. The baseline derives from `listAccountHistory` +
our own caches; the explorer then *enriches* (full-trace detail sheets, ABI-reflected
protocol names for third-party programs) without ever being on the critical path to
"here are your sends". Unknown programs still render honestly as generic interactions.

## 2. What we already have

- `thru-client.listAccountHistory` — raw entries (signature, slot, program, amounts,
  counterparty, success) via the router, cursor-paged ("load more" works).
- Token-aware rows already decode enough to print "Sent X SYM / Received / Minted"
  and to suppress token-account init as a THRU transfer.
- `pending-tx-service` — active transactions with live settle + badge emit.
- Balance-cache precedent for per-network storage.local caching.

## 3. Target UI (mirroring the Rabby card, adapted to what we can know)

One chronological stream without day headers; each transaction is a **card**:

```
2026/09/25 14:32                            Alphanet · ts4f…9de2 ⧉
[glyph] Send                                   -0.5 THRU
        to Account 2
```

When the block time is unavailable and there is no actual local submission time,
show `Block <slot>` instead of an invented date. No charged-fee field exists on the
history wire, so do not show a per-card fee.

- Method line = verb + counterparty/protocol label; right-aligned signed amount
  lines with token glyph, negative neutral / positive green.
- Fee line per card (our equivalent of Rabby's gas line; Thru has fees, not gas).
- Failed tx styling; pending section pins above the list (already exists).
- Click a card → detail sheet: full signature copy, slot, instruction breakdown,
  program id, explorer link.

## 4. Plan (phased, test-gated)

**P0 — `history-service` (background).** The local equivalent of Rabby's
openapi+db combination:
- `storage.local` key `thru_history_cache::<networkId>`: `{ [address]: { entries, nextCursor, updatedAt } }`, cap 200/address, using the same `network-scope.js` scoped-key isolation the balance and pending caches use (history is not secret; it persists across locks like balances).
- Incremental sync: keep the cursor; prepend newer entries; merge pending.
- An **explain layer**: map `(programId, instruction)` → `{ method, protocol }` with a
  recognized-program registry (transfer program → "THRU transfer"; token program →
  Sent/Received/Minted/Initialized account; anything else → "Contract interaction" +
  shortened program id). Never guess names for unknown programs.

**P1 — Card UI.** `domain/tx-card.js` kit component + `history.js` flat card stream;
pending cards remain above the stream. Keep "load more" cursor paging.

**P2 — Detail sheet.** ✅ SHIPPED. Modal with the decode breakdown + signature copy + explorer
link. Enrichment lane: lazily fetch detail for the one tapped transaction — one call on
demand, not a list-time dependency.

Landed differently from the sketch above in one respect worth recording: the lazy fetch uses
the **node's own** `transactions.get` + `blocks.get` (via contract v10 `tx.getDetail`), not
the explorer's `get_transaction`. The spike (`docs/archive/TX_DETAIL_SPIKE.md`) established that
everything the sheet shows except a *charged* fee is obtainable from the RPC we already
depend on, so P2 ships explorer-free and the explorer stays a P2.5 question. The one thing
the RPC genuinely cannot answer — what a transaction actually cost — is rendered as a
labelled header declaration plus an explicit statement that the network reports no charged
fee, rather than being quietly filled with the declaration.

**P2.5 — Explorer enrichment spike** (before any list-time enrichment ships):
- Validate the typed (non-TOON) explorer API the MCP tools sit on; record shapes +
  availability for alphanet offline scenarios; `?rpc=`-style network override support.
- `get_program_abi(program)` → grow the recognized-program registry without
  hand-writing decoders; cache ABIs per program id (bounded, network-scoped).

**P3 — Filters.** Account/network scope toggle (the Rabby screenshot's top-right
switch) — only when multi-network data is real, not before.

**Tests** land with each phase: storage-shape + cursor merge (router-level fixtures),
flat-stream rendering, network-scoped block times and missing-time fallback,
failed/pending card states, "unknown program" honesty row.

## 5. Explicit non-goals (this cycle)

- No TOON/MCP consumption from the popup (that surface is for agents); explorer use
  is strictly the typed API, validated in the P2.5 spike, enrichment-only.
- No hand-written general instruction decoder for arbitrary programs in the baseline —
  recognized-program registry + explorer ABI reflection instead.
- No price/USD lines (no price feed on alphanet; Rabby's `$` values come from DeBank).
  *Fact updated 2026-09-20:* a live Oracle program DOES post price updates on alphanet, and
  reading it is a CSP-clean RPC call via the already-shipped `@thru/programs/oracle` bindings
  (`docs/archive/EXPLORER_SPIKE.md` §5). Shipping fiat lines is therefore a product decision now, not
  an impossibility — this cycle's non-goal stands until revisited deliberately.
- No speed-up/cancel flows (Rabby's tx-group machinery exists for EVM nonce games;
  Thru's model doesn't need it).
