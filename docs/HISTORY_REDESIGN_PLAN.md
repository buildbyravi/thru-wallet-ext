# History / Transaction tab redesign — study of Rabby + plan

Status: **P0 + P1 + P2 shipped**. P0: `services/history-service.js` + contract v9 `tx.getHistoryFeed` (cache-merged, offline-labelled, append-deduped). P1: `domain/tx-card.js` + day-grouped Activity (Today/Yesterday/date headers, verb + context, signed right-aligned deltas, rel-time head, network + short-signature meta with copy/explorer actions, failed badge). Honest omission: no per-tx fee line yet (no fee field on the history wire; P2's lazy detail fetch is where it belongs). Post-P1 honesty pass (wire reality: `decodeHistoryEntry` carries no timestamp): relative time falls back to “Slot N”, timestampless entries group under “Activity”, timestamps backfilled from own pending records in `history-service.js`, and own-account counterparties render by name via `account.list`. Boundary-day refinement **still parked** (from the pr-6-review patch, not landed): when a timestampless entry sits between neighbours in DIFFERENT days, weight the inherited day by slot ratio ((newerSlot - cur)/(newerSlot - older)) rather than always taking the newer neighbour's day. Display-space only — wire entry timestamps stay null; the card head keeps showing Block. Deliberately NOT bundled into P2: the correct version needs a bounded-neighbour scan with its own slot-validity edge cases (equal slots, missing slots, a cluster spanning three days), which is well past a 10-line change and outside the detail sheet's blast radius. It stays a standalone item.

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
grouped-day rendering, failed/pending card states, "unknown program" honesty row.

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
