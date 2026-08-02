# Thru Wallet (unofficial) — alphanet MVP

An experimental, self-custody browser extension for Thru's alphanet, built on the real
`@thru/sdk` and `@thru/crypto` packages (not a mockup). Not affiliated with Unto Labs.
Not audited. **Alphanet only — do not use with anything you consider real value.**

## Design

Instrument-grade dark UI: flat graphite surfaces, tabular mono numerals, byte-mark identicons, and one phosphor-amber accent. See [DESIGN.md](DESIGN.md) for the token system and rules for adding features.

## Why this exists

Thru's own wallet architecture is built around an embedded, iframe-hosted wallet
(`@thru/wallet`, `wallet.thru.org`) with passkey login — not an injected-provider,
MetaMask-style extension. There's no standard yet for third-party extensions to plug
into dApps built with Thru's own SDKs, so this intentionally does **not** try to inject
a `window.thru`-style provider or connect to dApps. It's scoped down to what's genuinely
useful today: personal key management and basic account operations against alphanet.

## Layout

The dashboard is a hub, not a scroll of everything at once (Rabby was the reference
point): an account pill up top opens a dedicated account switcher, a balance hero in the
middle, and a 4-button action grid (Send, Receive, Faucet, History) that each open their
own focused screen. Export lives inside the Accounts screen instead of the main grid —
it's a rare, sensitive action, not a daily one, so it doesn't belong next to Send and
Receive. Popup is 408×580 to give the account switcher, mnemonic entry, and private-key
entry room to breathe instead of cramming into a 380px sliver.

## What works

- **Create wallet**: real 12-word BIP-39 mnemonic via `@thru/crypto`'s
  `MnemonicGenerator`, derived via `ThruHDWallet` (BIP-44 coin type 9999, SLIP-0010
  Ed25519).
- **Import**: from a 12-word phrase, *or* a raw 32-byte private key (hex) — address and
  public key are derived automatically via `@thru/sdk`'s `keys.fromPrivateKey()`.
- **Multiple accounts, one wallet, with a real switcher**: "+ Account" derives the next
  BIP-44 index from the seed; "+ Private key" imports another independent key into the
  same wallet. Byte-mark identicons (4×4 deterministic grid) distinguish accounts at a
  glance — square containers for seed-derived, round for imported keys.
- **Export**: re-checks your password even if already unlocked, then reveals the
  recovery phrase (seed-derived — note this exports the *whole seed*) or the specific
  private key (imported accounts). Reachable from the Accounts screen.
- **Password-encrypted local storage**: PBKDF2 (600,000 iterations, SHA-256) +
  AES-256-GCM. Encrypted vault in `chrome.storage.local`; decrypted vault data lives only
  in `chrome.storage.session` (memory-only, wiped on browser close). Auto-locks after 15
  minutes.
- **Balance** as a human-scale THRU amount (1 THRU = 1e9 base units), raw units kept
  visible underneath.
- **Create the on-chain account** via `thru.accounts.create({ publicKey })`.
- **Claim from the faucet, on-chain, from inside the extension** — see "What's verified
  vs. trusted" below.
- **Send native transfers, on-chain, from inside the extension** — same section.
- **Transaction history**, decoded where possible (see below) rather than just a list of
  signatures.
- **Explorer links** (`scan.thru.org`) on transactions and addresses throughout.
- **CLI command helper** on the faucet screen, for anyone who'd rather run it themselves.

## What's verified vs. what's trusted

Both the faucet and transfer features are built from **reverse-engineered** program
addresses and instruction layouts — real transactions were submitted via the CLI and
diffed to work out the wire format, not sourced from Thru's own docs, and not
independently re-confirmed against alphanet from whatever environment did that
reverse-engineering (no network access to `rpc.alphanet.thru.org` from here either).
**Treat the specific addresses/byte layouts as well-sourced, not independently
verified** — if either fails outright with a low-level/format error, doubt those
constants first, not the surrounding code.

That said, a few things push confidence up from "trust the transcript" to something
more solid:

- **Both program addresses decode to the same reserved-program pattern.** Using
  `Pubkey.from(address).toBytes()` on the faucet program (`taAAAA…Pr6`) and the transfer
  program (`taAAAA…ICA`) shows both are 32 zero bytes with a single marker byte in the
  last position (`0xfa` and `0x80`) — the exact same convention `@thru/sdk`'s own
  `accounts.create()` uses internally for its reserved program (`0x03` in that position).
  That's independent structural evidence these are real reserved system programs, found
  by decoding the addresses directly, not by trusting the reverse-engineering transcript.
- **Account-index handling is independently verified, not reverse-engineered.**
  `@thru/sdk`'s own `InstructionContext` JSDoc confirms the final account order is
  exactly `[feePayer, program, ...readWriteAccounts, ...readOnlyAccounts]`, so both
  `claimFaucet` and `sendTransfer` use `buildInstructionData` + `getAccountIndex` to get
  indices from the SDK's own logic, rather than a hand-rolled sort. The first draft of
  this code (reverse-engineered, not mine) tried to replicate that sort manually and
  also had the `accounts`/`header` nesting wrong (top-level `readwriteAccounts`/`fee`
  siblings instead of nested objects) — both fixed here against the actual shipped
  type definitions.
- **Both need the account to exist on-chain first.** `buildAndSign` auto-fills the
  nonce by reading the fee payer's current on-chain state, which only exists once
  `accounts.create()` has run. The faucet transaction is zero-fee (so no *balance*
  needed, just an existing *account*); a transfer is not assumed to be zero-fee, so the
  sender needs a balance covering amount + fee. Both give a specific error rather than a
  confusing low-level one if you try before the account exists.

### A genuine open question: what unit do faucet/transfer amounts use?

The faucet screen's amount field is in **raw base units** (matches the reverse-engineered
CLI examples directly — `10`, `50`, `1000`). The Send screen's amount field is in
**human-scale THRU** (matches how the balance is displayed, converted internally via
`parseThruAmount()` using exact BigInt arithmetic, not `parseFloat() * 1e9`, which can
misround). Both choices are reasoned, not certain:

- Transfer amounts and account balances almost universally share the same unit scale on
  any given chain (it would be unusual and error-prone to design it otherwise), which is
  why Send assumes THRU-scale.
- The faucet's documented "10,000 per withdrawal" cap makes much more sense as raw units
  (a tiny amount, but plausibly "enough gas for 10,000 transactions at a ~1-unit default
  fee") than as 10,000 whole THRU, which is why Faucet was left as raw units rather than
  changed to match Send.

If this is tested against real alphanet and turns out backwards, the fix is contained to
`parseThruAmount()` and the faucet screen's input handling — nothing else assumes a scale.

## Transaction history

`src/lib/thru-client.js`'s `decodeHistoryEntry()` reconstructs the same
`[feePayer, program, ...readWriteAccounts, ...readOnlyAccounts]` ordering used when a
transaction was built, so it can resolve the account indices baked into a known
transfer/faucet instruction back into real addresses — not just show a bare signature.
Anything calling a program other than the two known ones shows as a generic entry
instead of guessing. Tested in `test-thru-client.mjs` against real `Transaction`
instances built via the SDK's own constructor (including a case that caught a bug in the
*test* itself — the raw constructor doesn't necessarily preserve insertion order for
accounts, which is exactly why the production code never hardcodes indices either).

## Explorer integration

`scan.thru.org` is confirmed real — fetched its homepage directly ("Thru Explorer -
Block Explorer for Thru Network", tracking thru-alphanet). At the time it was checked it
showed "Network: alphanet ● offline" with empty tables, which may just mean the page
hadn't hydrated with live data yet, or may mean the network really was down at that
moment — worth knowing either way, and worth checking directly since it's a live-updating
dashboard. Its exact `/tx/{signature}` and `/address/{address}` route pattern is **not**
independently confirmed (the homepage had no live example links to check against) — this
follows the near-universal convention across block explorers generally (Etherscan,
Solscan, Solana Explorer, Basescan all use exactly this), but if it's wrong, worst case
is a dead link. Nothing signs or submits anything through these.

## Loading it in Chrome

1. `chrome://extensions` → enable **Developer mode** (top right) → **Load unpacked**.
2. Select the `dist/` folder (after building — see below).
3. Pin the extension and open it — first run offers to create or import a wallet.

## Rebuilding from source

```
npm install
npm run build
```

Bundles `src/background.js` and `src/popup/popup.js` via esbuild, and copies everything
else `dist/` needs (`popup.html`, `popup.css`, `manifest.json`, `icons/`) straight from
`src/`. `dist/` is gitignored entirely and fully reproducible — `rm -rf dist && npm run
build` always regenerates it exactly, verified as part of putting this repo together
after a version that only rebuilt the JS once left stale HTML/CSS sitting in `dist/`.
Edit files under `src/`, never `dist/` directly.

## Testing

```
npm run test
```

Two suites (61 assertions total), both against real code, not mocks of the logic being
tested:

- `test-vault.mjs` — mocks `chrome.storage` and runs the real vault module against real
  `@thru/crypto`/`@thru/sdk` code: create → add HD account → import a private key
  alongside it → switch between all three → export (wrong password fails, right one
  matches) → full lock/unlock cycle → a private-key-only vault can't derive new accounts.
- `test-thru-client.mjs` — faucet and transfer instruction byte layouts, `formatThru`/
  `parseThruAmount` round-tripping (including the specific floating-point rounding trap
  a naive `parseFloat() * 1e9` would hit), `isValidThruAddress` correctly rejecting a
  tampered checksum (not just checking length/prefix), and `decodeHistoryEntry` resolving
  realistic transfer transactions from both the sender's and recipient's point of view.

Worth re-running after touching anything in `src/lib/`.

## Bugs that got caught along the way

- **Address not showing right after create/import**, only after closing and reopening.
  `unlock()` was the only path that marked the session "unlocked" — create/import saved
  the vault but never did. Fixed by having creation/import mark the session unlocked the
  same way a real unlock does.
- **A previously-imported key reappearing after reset + reimport.** Not a storage leak —
  it was stale form state: the import screen never cleared its own fields on the way in
  or out. Fixed with a `clearSensitiveFields()` helper called on every relevant screen
  transition and unconditionally on reset.
- **A test itself assumed account ordering** that the real `Transaction` constructor
  doesn't guarantee, causing a false failure while writing `decodeHistoryEntry` tests.
  Fixed by determining order empirically from a real instance instead of hardcoding it —
  which is also exactly why the production `sendTransfer`/`claimFaucet` code never
  hardcodes it either, using the SDK's own `getAccountIndex` instead.

## Ideas for next, roughly in priority order

Not implemented here, but worth considering:

1. **Verify the units question above against real alphanet**, and the faucet/transfer
   addresses generally — the single highest-value thing anyone with real CLI/network
   access could do next.
2. **Confirm the explorer's actual `/tx/` and `/address/` routes** and fix
   `explorerTxUrl`/`explorerAddressUrl` in `thru-client.js` if they're not what's guessed.
3. **"Max" button on Send** — fill the full balance minus a fee estimate. Held off
   because there's no verified way to estimate the fee in advance yet.
4. **Recently-used addresses on Send** — simple local autocomplete, no new network calls.
5. **Network status indicator** — a lightweight reachability check against
   `rpc.alphanet.thru.org` on load, surfaced given the explorer showed "offline" when
   checked.
6. **dApp connector**, if Thru's own embedded-wallet-first ecosystem model ever changes
   or a compatibility layer becomes worth building — deliberately out of scope for now,
   see "Why this exists" above.

## Before this touches real funds

Not security-reviewed by anyone beyond chat conversation plus the automated checks
above. Before it holds anything of value: get an actual review, and independently
re-confirm the faucet/transfer program addresses and instruction layouts directly
against alphanet rather than this MVP's (well-sourced but unverified-by-me) assumptions.
