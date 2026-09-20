# Backend gaps for a Rabby-class UI

**STATUS: Tiers A and B are implemented.** Contract v7, 74 methods. This document is kept as the
rationale record and as the live list of what remains (Tier C, blocked on chain verification).
For current state and next steps see `docs/STATUS_AND_ROADMAP.md` and `docs/PROJECT_LEDGER.md`.

| Tier | Blast radius | Status |
| --- | --- | --- |
| A | new methods, new storage keys | ✅ done |
| B | additive vault field or stored structure | ✅ done, each with migration + tests |
| C | needs unverified Thru protocol behaviour | ⛔ blocked — interfaces exist, return `supported:false` |
| D | changes an existing method's shape | forbidden, enforced by `test-contract.mjs` |

What shipped, against the original list:

- A1 batch balances → `tx.getBalances` / `tx.getCachedBalances` / `tx.getTotalBalance`
- A2 non-blocking first paint → `system.bootstrap` no longer awaits network health
- A3 push events → `event-service.js`; `accountsChanged`, `lockStateChanged`, `networkChanged`,
  `balanceChanged`, `pendingTxChanged` all emitted and consumed
- A4 ordering/pinning/hiding → `account.setOrder` / `setPinned` / `setHidden`
- A5 whitelist → enforced inside `tx.send`, so a UI bug cannot bypass it
- A6 preferences → `settings.get` / `settings.set`, unknown keys rejected
- A7 history pagination → cursor form added without breaking the positional form
- A8 custom networks → storage compatibility only since contract v7. `network.upsertCustom` /
  `removeCustom` remain declared, but only removal has a UI caller. Legacy records are listed as
  non-selectable; `network.setActive` refuses them in the background and stale selections heal
  before RPC binding. Re-enablement remains blocked on the CSP/host-permission/capability/auth
  design in `docs/STATUS_AND_ROADMAP.md` Step 2b.
- A9 token registry → `token.import` / `setVisibility`, metadata normalized and scheme-allowlisted
- A10 pending transactions → `pending-tx-service.js`, badge text, duplicate-submit protection
- B1 derive-and-preview → `account.previewHd`, persists nothing
- B2 remove one HD account → `account.removeHd`, refuses a keyring's last account
- B3 backup state → `keyring.setBackedUp` + `backedUpAt`
- B4 batch derivation → `account.addHdBatch`, one AES re-encrypt instead of N

Beyond the original list: `keyring.createSeed` (generates a phrase in the background and
registers it in one password-gated call, so fresh entropy never crosses the seam) and
`wallet.exportPrivateKey` (one account's key, distinct from exporting the whole phrase).

Both pre-existing defects noted at the bottom of the original analysis are fixed: the
`symbol`/`imageUrl` vs `ticker`/`imageUri` mismatch, and the missing `clipboardRead` permission.

---

## Ordered by **blast radius**, not by value

The instruction "if backend breaks we fix later" is safe for RPC plumbing and wrong for the
vault. A corrupted vault is unrecoverable key loss, so anything touching stored key material got
a migration and a test regardless of devnet status. That decision is why the schema changes
(`origin`, `backedUpAt`) did not require recreating test wallets.

---

## Tier A — pure additions

### A1. Batch balances
Rabby's switch-address screen shows a balance on every row. `tx.getAccountInfo(address)` is
single-address, so an N-account switcher costs N round-trips and N RPC calls.
→ `tx.getBalances({ addresses })`, concurrency-capped, partial failure per address.

### A2. Non-blocking first paint
`system.bootstrap` awaits `txService.checkNetworkHealth()` — a live RPC — before returning
anything. The popup cannot paint until the network answers. Rabby paints instantly from cache and
refreshes after.
→ Serve a cached snapshot immediately; refresh health and balances in the background and push the
result. `BUILD_SPEC.md` sets a 200 ms budget that today's bootstrap cannot meet on a slow RPC.

### A3. Push events are declared but never emitted
`bridge.onEvent` has zero callers and the background emits nothing. Every screen therefore polls
or goes stale — this is why the dashboard balance does not refresh after a faucet claim.
→ A real emitter, plus emissions on `accountsChanged`, `lockStateChanged`, `networkChanged`,
`balanceChanged`, `pendingTxChanged`.

### A4. Account ordering, pinning, hiding
Rabby lets you reorder, pin and hide addresses. No equivalent exists.
→ Local preference store; never touches the vault.

### A5. Send whitelist
Rabby gates sends to a whitelist when enabled.
→ `whitelist.*` + an `enforceWhitelist` setting checked in `tx.send`.

### A6. Generic preferences
No store for theme, fiat currency, locale, "hide small balances", or first-run flags. Each new
setting currently means a new bespoke storage key.
→ One namespaced `settings.get/set`.

### A7. History pagination
`tx.listHistory(address, pageSize)` has no cursor, so infinite scroll is impossible.
→ Cursor-based `tx.listHistory({ address, limit, cursor })` as a **new** parameter shape,
keeping the old positional behaviour working.

### A8. Custom networks / RPC override
`src/lib/networks.js` is a static map. A stored overlay was added, but activating an arbitrary RPC
without verified program ids is unsafe. Contract v7 therefore keeps legacy records only for
listing/removal and limits activation to enabled built-ins. A real CustomRPC feature needs the four
preconditions in `docs/STATUS_AND_ROADMAP.md` Step 2b; the overlay alone is not a feature.

### A9. Token visibility and manual import
`token.list` returns the local registry (tokens **this wallet deployed** plus manual imports) —
it is a registry of *known mints*, not an asset list. Owned balances are layered on top by
`token.getBalances`, which reads the account's real token accounts for exactly those mints
(contract v8; was the C1 stub).

### A10. Pending transaction lifecycle
`tx.send` returns a signature and forgets. Nothing tracks confirmation, so the UI cannot show
pending state, cannot badge the extension icon, and cannot warn about a duplicate submission.
`BUILD_SPEC.md` specifies `draft → review → awaiting-auth → signed → submitted → confirmed`.
→ Pending store + background poller + `tx.getPending` + badge text.

---

## Tier B — additive vault changes, each with a migration and a test

### B1. Derive-and-preview without persisting
Rabby's HDManager lists derived addresses with balances and lets you pick which to add.
`account.addHd` only appends the next index — there is no way to look ahead.
→ `keyring.previewAccounts({ keyringId, start, count })`: derives addresses in memory, persists
nothing.

### B2. Remove a single HD account
Rabby can delete one address. `vault.js` only ever pushes to `hdAccountIndices`; the sole removal
path is deleting the entire keyring.
→ `account.removeHd({ ref })`, refusing to remove the last account of the last keyring.

### B3. Seed-phrase backup state
Rabby nags until the phrase is confirmed backed up. `origin` (added in the previous commit)
distinguishes generated from imported, but nothing records whether the user actually wrote it down.
→ `backedUpAt` per seed keyring + `keyring.setBackedUp`.

### B4. Batch HD derivation
Adding 10 accounts costs 10 sequential `persistVaultUpdate` calls, each a full AES re-encrypt.
→ `account.addHdBatch({ keyringId, indices })`, one write.

---

## Tier C — blocked on unverified Thru behaviour

Build the interface and return `{ supported: false, reason }`. **Do not fabricate values.** A
wrong fee or a fake balance in a wallet loses money.

### C1. Owned token balances — RESOLVED (contract v8)
The official `@thru/programs/token` bindings (`deriveTokenAccountAddress` +
`parseTokenAccountData`) made `token.getBalances` real for every mint in the local registry:
`{ supported: true, balances: [...] }`, with proven-zero distinguished from unknown and
decimals read from the on-chain mint whenever a balance exists. Remaining sub-questions moved
to `docs/STATUS_AND_ROADMAP.md` Step 8 (recipient-owner existence, token-program fee), each
with a live probe in `scripts/verify-token-transfer.mjs`.

### C2. Fee estimation
The send review needs a real "Network fee" line. The NATIVE transfer fee is measured (1 base
unit on alphanet, per-network `baseFeeUnits`), and `tx.estimateFee` reports that with
provenance. The TOKEN-program fee is a separate, still-unmeasured quantity — the token send
UI declares it unmeasured rather than inheriting the native number.
→ remaining: measure the token fee live (`scripts/verify-token-transfer.mjs`), then record it
in per-network config.

### C2b. Per-transaction CHARGED fee — not on the RPC surface at all
Distinct from C2, which is about *estimating* a fee before sending. This is about reporting
what a transaction in history actually cost, and the answer from the spike
(`docs/TX_DETAIL_SPIKE.md` §3.3) is that the chain does not report it:
`TransactionExecutionResult` has no charged-fee field (compute/memory/state units, `vm_error`,
events, `fee_payer_expected_nonce` — nothing else). `Transaction.fee` exists but is the
sender's HEADER DECLARATION, an input to execution, not a receipt.

→ `tx.getDetail` returns `feeDeclaredUnits` (never `feeUnits`) plus `feeCharged: false`, and
  the P2 detail sheet labels the row "Fee (declared)" and states inline that the network
  reports no charged fee. It is **not** filled in from `network.baseFeeUnits`, even though
  that measured value (1 unit on alphanet) currently agrees with the SDK's default — that
  agreement is a coincidence of today's default, not a published invariant.
→ remaining: the P2.5 explorer spike. If a charged fee exists anywhere it is behind the typed
  (undocumented) API under `scan.thru.org`'s MCP tools. Until that is validated, the honest
  answer stays "not reported".

### C2c. Per-transaction wall-clock time — block-level only, and optional
Transactions carry no time field. The containing block does (`BlockHeader.block_time` →
`Block.blockTimeNs`), but it is optional on the wire and `@thru/sdk` only populates it when
the node sent it.
→ `tx.getDetail` fetches it via `blocks.get({slot})` and returns `blockTimeMs: null` when
  absent; the sheet renders "Not available". Never substituted with the local clock, and
  never inherited from a neighbouring entry (the list's day-grouping inference is
  display-only and does not write timestamps — see `docs/HISTORY_REDESIGN_PLAN.md`).
→ remaining: confirm on a live node whether alphanet populates `header.blockTime` at all.
  That is a `docs/MANUAL_SMOKE_CHECKLIST.md` item, not a code gap.

### C3. Transaction simulation
Rabby's signature feature — predicted balance changes before signing. Needs a simulate RPC.
→ `tx.simulate({ ... })` → `supported:false`.

### C4. dApp signing integration — hosted wallet only; extension path unverified
Thru's current official wallet documentation describes `@thru/wallet` as a browser SDK for the
hosted embedded wallet at `https://wallet.thru.org/embedded` (see the official
[wallet overview](https://thru.org/docs/wallet/overview/)), not as an interoperability contract for
an independently installed browser extension. The documented
path uses `@thru/wallet` / `@thru/wallet/react`, `connect()` for account approval and discovery,
`getSigningContext()` for managed-account versus fee-payer/signer context, and `signTransaction()`
for wallet approval and canonical raw transaction bytes. The dApp submits those bytes separately.
See the official [embedded integration](https://thru.org/docs/wallet/embedded-wallet-integration/)
and [approval/signing lifecycle](https://thru.org/docs/wallet/approval-and-signing/) pages.

This extension is not the hosted iframe and must not pretend to be a drop-in provider. Do not invent
an injected `window.thru` standard, copy the hosted iframe protocol, or treat the existence of
`connect()`/`signTransaction()` as an extension trigger. An extension connector remains blocked until
Thru documents a bring-your-own-signer or extension-compatible provider contract, including origin
discovery, permissions, approval transport, signing ownership, and submission semantics.

Every C item is also an entry in `BUILD_SPEC.md` Part X (open questions). The single
highest-value verification remains the faucet/transfer **unit scale**.

---

## Tier D — forbidden

Renaming or reshaping `tx.send`, `wallet.exportSecret`, `account.list`, or any existing method.
The contract is append-only; `test-contract.mjs` enforces it in both directions.

---

## Two pre-existing defects worth fixing alongside

1. **Token field-name mismatch.** `token-service.js` sends `symbol`/`imageUrl`;
   `thru-client.js` destructures `ticker`/`imageUri`. Every stored token record therefore has an
   empty ticker and no image. Fixing the names also activates a currently-dead `<img>` branch in
   `token-row.js`, so escaping must land in the same change.
2. **`clipboardRead` is missing from `manifest.json`** while `popup.js` and `screens/send.js` call
   `navigator.clipboard.readText()`. The Paste button always fails.
