# History / Transaction tab redesign — study of Rabby + plan

Status: **plan, awaiting green light** (post-merge work; no code yet).
Reference screenshots: Rabby's Transactions tab (cards with protocol glyph, method,
token deltas, gas line, chain badge, short tx id + copy, time).

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

**The honest gap:** Rabby does not *decode* history in the wallet — DeBank's indexer
hands them parsed display items. Thru has no indexer today. Anything we show must be
derived locally from `listAccountHistory` + our own caches. That is the shaping
constraint for everything below; it also means our "protocol" fidelity is limited to
programs we recognize, and unknown programs render honestly as generic interactions.

## 2. What we already have

- `thru-client.listAccountHistory` — raw entries (signature, slot, program, amounts,
  counterparty, success) via the router, cursor-paged ("load more" works).
- Token-aware rows already decode enough to print "Sent X SYM / Received / Minted"
  and to suppress token-account init as a THRU transfer.
- `pending-tx-service` — active transactions with live settle + badge emit.
- Balance-cache precedent for per-network storage.local caching.

## 3. Target UI (mirroring the Rabby card, adapted to what we can know)

Date sections (`Today`, `Yesterday`, `Sep 18`), each tx as a **card**:

```
6h 21m ago                                  Alphanet · ta4f…9de2 ⧉
[glyph] Sent                                   -0.5 THRU
        TUFT application                      Fee: < 0.0001 THRU
```

- Method line = verb + counterparty/protocol label; right-aligned signed amount
  lines with token glyph, negative neutral / positive green.
- Fee line per card (our equivalent of Rabby's gas line; Thru has fees, not gas).
- Failed tx styling; pending section pins above the list (already exists).
- Click a card → detail sheet: full signature copy, slot, instruction breakdown,
  program id, explorer link.

## 4. Plan (phased, test-gated)

**P0 — `history-service` (background).** The local equivalent of Rabby's
openapi+db combination:
- `storage.local` key `thru_history_cache`: `{ [networkId]: { [address]: { entries, cursor, updatedAt } } }`, cap 200/address, mirrors balance-cache wipe-on-lock policy.
- Incremental sync: keep the cursor; prepend newer entries; merge pending.
- An **explain layer**: map `(programId, instruction)` → `{ method, protocol }` with a
  recognized-program registry (transfer program → "THRU transfer"; token program →
  Sent/Received/Minted/Initialized account; anything else → "Contract interaction" +
  shortened program id). Never guess names for unknown programs.

**P1 — Card UI.** `domain/tx-card.js` kit component + `history.js` grouping by day;
pending cards reuse the same shell. Keep "load more" cursor paging.

**P2 — Detail sheet.** Modal with the decode breakdown + signature copy + explorer.

**P3 — Filters.** Account/network scope toggle (the Rabby screenshot's top-right
switch) — only when multi-network data is real, not before.

**Tests** land with each phase: storage-shape + cursor merge (router-level fixtures),
grouped-day rendering, failed/pending card states, "unknown program" honesty row.

## 5. Explicit non-goals (this cycle)

- No local SPL-style general instruction decoder for arbitrary programs.
- No price/USD lines (no price feed on alphanet; Rabby's `$` values come from DeBank).
- No speed-up/cancel flows (Rabby's tx-group machinery exists for EVM nonce games;
  Thru's model doesn't need it).
