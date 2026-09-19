# History / Transaction tab redesign — study of Rabby + plan

Status: **P0/P1 green-lit** (2026-09-20). P0 (background history-service) in progress.
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
- `storage.local` key `thru_history_cache`: `{ [networkId]: { [address]: { entries, cursor, updatedAt } } }`, cap 200/address, using the same `network-scope.js` scoped-key isolation the balance and pending caches use (history is not secret; it persists across locks like balances).
- Incremental sync: keep the cursor; prepend newer entries; merge pending.
- An **explain layer**: map `(programId, instruction)` → `{ method, protocol }` with a
  recognized-program registry (transfer program → "THRU transfer"; token program →
  Sent/Received/Minted/Initialized account; anything else → "Contract interaction" +
  shortened program id). Never guess names for unknown programs.

**P1 — Card UI.** `domain/tx-card.js` kit component + `history.js` grouping by day;
pending cards reuse the same shell. Keep "load more" cursor paging.

**P2 — Detail sheet.** Modal with the decode breakdown + signature copy + explorer.
Enrichment lane: lazily fetch the full trace for the one tapped transaction
(explorer `get_transaction`) — one call on demand, not a list-time dependency.

**P2.5 — Explorer enrichment spike** (before any list-time enrichment ships):
- Validate the typed (non-TOON) explorer API the MCP tools sit on; record shapes +
  availability for alphanet offline scenarios; `?rpc=`-style network override support.
- `get_program_abi(program)` → grow the recognized-program registry without
  hand-writing decoders; cache ABIs per program id (bounded, network-scoped).

**P3 — Filters.** Account/network scope toggle (the Rabby screenshot's top-right
switch) — only when multi-network data is real, not before.

**Tests** land with each phase: storage-shape + cursor merge (router-level fixtures),
grouped-day rendering, failed/pending card states, "unknown program" honesty row.

## 5. Explicit non-goals (this cycle)

- No TOON/MCP consumption from the popup (that surface is for agents); explorer use
  is strictly the typed API, validated in the P2.5 spike, enrichment-only.
- No hand-written general instruction decoder for arbitrary programs in the baseline —
  recognized-program registry + explorer ABI reflection instead.
- No price/USD lines (no price feed on alphanet; Rabby's `$` values come from DeBank).
- No speed-up/cancel flows (Rabby's tx-group machinery exists for EVM nonce games;
  Thru's model doesn't need it).
