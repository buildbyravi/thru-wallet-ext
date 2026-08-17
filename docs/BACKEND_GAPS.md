# Backend gaps for a Rabby-class UI

**STATUS: Tiers A and B are implemented.** Contract v4, 71 methods. This document is kept as the
rationale record and as the live list of what remains (Tier C, blocked on chain verification).
For current state and next steps see `docs/STATUS_AND_ROADMAP.md`.

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
- A8 custom networks → `network.upsertCustom` / `removeCustom`
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
`src/lib/networks.js` is a static map. Rabby has CustomRPC and CustomTestnet.
→ `network.add/update/remove` over a stored overlay, with the built-ins immutable.

### A9. Token visibility and manual import
`token.list` returns only tokens **this wallet deployed** — not tokens the account owns. It is a
launchpad registry mislabelled as an asset list.
→ `token.import`, `token.setVisibility`, `token.remove` for the local registry now; owned
balances are C1.

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

### C1. Owned token balances
Requires Token Program account-read semantics we have not verified against a live network.
Rabby's asset list depends on this. → `token.getBalances({ address })` → `supported:false`.

### C2. Fee estimation
The send review needs a real "Network fee" line. Today the MAX button reserves a hardcoded
`10_000n`. Whether transfers are even non-zero-fee is unconfirmed.
→ `tx.estimateFee({ toAddress, amountUnits })` → `supported:false` until verified.

### C3. Transaction simulation
Rabby's signature feature — predicted balance changes before signing. Needs a simulate RPC.
→ `tx.simulate({ ... })` → `supported:false`.

### C4. Message signing
Needed for any future dApp connector. Thru's documented model is a hosted embedded wallet with
passkeys, and no injected-provider standard is confirmed.
→ Defer entirely; do not invent `window.thru`.

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
