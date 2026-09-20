# P2 spike-lite — what a lazy per-signature detail fetch can honestly provide

Date: 2026-09-20
Scope: read-only investigation carried out **before** any P2 UI was written, per
`docs/HISTORY_REDESIGN_PLAN.md` §4 (P2). Records what the existing RPC surface can and
cannot answer for one tapped transaction, so the detail sheet states facts rather than
inventing them.

Companion documents: `docs/BACKEND_GAPS.md` (capability tiers), `docs/DEFECT_LOG.md`.

---

## 1. Question

The history wire (`thru-client.decodeHistoryEntry` → `tx-service.listHistory` →
`history-service.getHistoryFeed`) carries:

```
signature, slot, success, programAddress, kind, amount, counterparty,
tokenSource, tokenDest, tokenMint, tokenSymbol, tokenDecimals
```

It carries **no wall-clock timestamp** and **no fee**. That omission is recorded at the top
of `HISTORY_REDESIGN_PLAN.md` and was the reason P1 shipped `Block <slot>` in the card head
instead of a relative time. P2 asks: for the ONE transaction the user tapped, can a lazy
fetch produce either of them without consuming the explorer?

## 2. Method

Read-only inspection of the pinned SDK (`@thru/sdk@0.3.16`) type surface and its compiled
runtime, plus the repo's own client:

- `node_modules/@thru/sdk/dist/client-BLTFR4JE.d.ts` — `Transaction`, `Block`,
  `BlockHeader`, `TransactionExecutionResultData`, and the bound client interfaces
  (`BoundTransactions`, `BoundBlocks`).
- `node_modules/@thru/sdk/dist/chunk-UN6NDFUB.js` — the implementations behind
  `transactions.get`, `blocks.get`, `Transaction.fromProto`, `Block.fromProto`.
- `node_modules/@thru/sdk/dist/streaming_service_pb-AoEXbEY2.d.ts` — the generated protobuf
  field lists, which are the actual wire contract.
- `src/lib/thru-client.js`, `src/background/services/tx-service.js`,
  `src/background/services/history-service.js`, `src/background/services/pending-tx-service.js`.

No network call was made from the sandbox: `rpc.alphanet.thru.org` and `scan.thru.org` are
both unreachable from here (TLS connect refused), so nothing below is claimed as
"verified on alphanet". Everything below is a claim about the **SDK/protobuf contract**,
which is checkable by reading the same files. Live confirmation belongs to the manual
smoke run (`docs/MANUAL_SMOKE_CHECKLIST.md`).

## 3. Findings

### 3.1 A per-signature fetch exists and is already on the client we use

`Thru.transactions.get(signature, options?)` →
`getTransaction(ctx, signature, options)` → `Transaction.fromProto(proto)`
(`chunk-UN6NDFUB.js:3530`). It defaults to `TRANSACTION_VIEW_FULL`. This is the same
`Transaction` class `decodeHistoryEntry` already consumes, so a detail fetch reuses the
existing decoder rather than adding a second one.

**Consequence:** signature, slot, success (`executionResult.vmError === 0`), program
address, kind, amount and counterparty are all available for a single signature exactly as
they are for a list entry. No new decode logic, no new trust.

### 3.2 Timestamp: NOT on the transaction; derivable from the containing block

`Transaction` (`client-BLTFR4JE.d.ts:163-221`) has `slot` and `blockOffset` and **no time
field**. `TransactionExecutionResultData` (`:135-161`) has no time field either. So the
P1-era statement — "the wire carries no timestamp" — is confirmed at the transaction level.

The block DOES carry one. `BlockHeader` has `block_time = 13`
(`streaming_service_pb-AoEXbEY2.d.ts:893`), and `Block.fromProto` lifts it to
`block.blockTimeNs` via `timestampToNanoseconds` (`chunk-UN6NDFUB.js:1926-1928`).
`Thru.blocks.get({ slot })` is bound and reachable.

**Consequence:** for one tapped transaction we can do `transactions.get(sig)` →
`blocks.get({ slot: tx.slot })` → `blockTimeNs`, and present the **block time**. That is
not an invented value: it is the timestamp of the block that contains the transaction,
which is what every block explorer shows as a transaction's time.

Caveats that must reach the user, not be papered over:
- `blockTimeNs` is `?: bigint` — optional. `Block.fromProto` only sets it when
  `proto.header.blockTime` is present; `Block.fromWire` can leave it `undefined`.
- `blocks.get` internally also calls `getRawBlock` to enrich, inside a `try`
  (`chunk-UN6NDFUB.js:2359-2374`). A node that answers `getBlock` but not `getRawBlock`
  still returns a block, possibly without the time.
- It is the BLOCK's time, not a per-transaction execution time. Labelling it "Block time"
  is accurate; labelling it "Sent at" would not be.

So: present when the node gives it, **"Not available"** when it does not. Never
interpolated, never inherited from a neighbour, never `Date.now()`.

### 3.3 Fee: a DECLARED header value exists; a CHARGED fee does not

`Transaction.fee` is real and populated: `Transaction.fromProto` sets
`fee: header.fee ?? 0n` (`chunk-UN6NDFUB.js:1192`). But that field is the fee the **sender
declared in the transaction header**, i.e. an input to execution. Two facts pin this down:

1. The SDK supplies it on the way OUT. `createTransactionHeader` uses
   `header.fee ?? DEFAULT_FEE` with `DEFAULT_FEE = 1n` (`chunk-UN6NDFUB.js:205, 3795`), and
   `src/lib/thru-client.js` deliberately does not override `header.fee` for transfers
   (see the comment above `sendTransfer`) — so the value read back is the one the builder
   put there.
2. There is no charged-fee field on the way BACK. The full field list of
   `TransactionExecutionResult` is compute/memory/state units, `user_error_code`,
   `vm_error`, `execution_result`, `pages_used`, events, r/w accounts,
   `error_program_acc_idx`, `fee_payer_expected_nonce`
   (`streaming_service_pb-AoEXbEY2.d.ts:1327-1393`). No `fee_charged`, no `fee_paid`, no
   receipt of any kind.

Fees do exist at the block level (`StreamSlotMetricsResult.claimedFees` /
`absentBlockProducerFees`, `client-BLTFR4JE.d.ts:1012-1017`), but those are block
aggregates credited to a producer, not attributable to one transaction.

**Consequence:** "the fee you paid for this transaction" is **not derivable** from the RPC
surface. What IS derivable is "the fee declared in this transaction's header". Those are
different claims, and this wallet's honesty rule makes conflating them a defect, not a
rounding of the truth. The sheet therefore renders the fee row with its provenance stated
in the row itself ("declared in the transaction header — Thru's execution result carries no
charged-fee field"), and renders **"Not available"** when even the header value is absent.

Cross-check against what we already shipped: `network.baseFeeUnits` is `1n` for alphanet,
measured empirically by `scripts/measure-fee.mjs` as `spent - amount`. That measurement and
the header default agree at 1 base unit today. That agreement is a coincidence of the
current default, not a published invariant, so it is not used to upgrade the claim.

### 3.4 Counterparty, status, kind, amount

All already resolved by `decodeHistoryEntry` + `tx-service.resolveTokenHistory`. The sheet
reuses both unchanged, and resolves a counterparty that is another account in THIS wallet
by name against `account.list`, exactly as `tx-card.js` already does. No new resolution
path, so no new way to be wrong.

### 3.5 Explorer (scan.thru.org)

Out of scope for P2 by instruction, and unnecessary for everything above except a charged
fee. The explorer's documented surface is the MCP/TOON one (`docs/MCP_AGENT_INTEGRATION.md`
§2) which is an agent surface, not a typed contract for a background worker. If a charged
fee exists anywhere, the typed API underneath the MCP tools is where to look — that is
**P2.5**, and P2 ships explorer-free.

## 4. Decisions taken into the P2 implementation

| Field | Source | Behaviour when unavailable |
| --- | --- | --- |
| signature | history entry (already held) | n/a — the sheet only opens for an entry that has one |
| status | `executionResult.vmError === 0` | "Unknown" (null = no result yet) |
| kind + signed amount | existing decoder | amount row omitted when the kind carries none |
| counterparty | existing decoder, named via `account.list` | row omitted when not applicable (e.g. faucet) |
| block | `tx.slot` | "Not available" |
| time | `blocks.get({slot}).blockTimeNs` | **"Not available"** |
| fee | `tx.fee` (header-declared, provenance stated inline) | **"Not available"** |
| program | `tx.program` | "Not available" |

Two RPC round trips per tapped transaction, on demand only, never on the list path.
A failure of either degrades to "Not available" and never blocks the sheet: the sheet
paints synchronously from the entry the user tapped, then fills the lazy rows.

## 5. What this spike did NOT establish

- Nothing was confirmed against a live node from this environment. Whether alphanet
  actually populates `header.blockTime` is a manual-smoke question.
- Whether the declared header fee ever differs from what is debited. Answering that needs
  a live before/after balance measurement (`scripts/measure-fee.mjs` is the tool) across
  more than the single sample already taken.
- Whether the explorer exposes a charged fee. That is P2.5.
