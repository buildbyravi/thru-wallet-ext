--# Thru Wallet -- Alphanet

A high-performance, self-custody browser extension for Thru, built on the real
`@thru/sdk` and `@thru/crypto` packages with native Token Program launchpad support.

> [!WARNING]
> **Not production-ready and not security-reviewed.** Alphanet/devnet funds only.
>
> The frontend rebuild is complete: one stack, 14 routes, no legacy fallback. Core flows are
> verified against a live alphanet -- the amount-unit question, program addresses, the transfer
> fee, history decoding, and an end-to-end send. See
> [`docs/STATUS_AND_ROADMAP.md`](docs/STATUS_AND_ROADMAP.md) for exact state and what remains.
>
> **Still unverified:** no automated test mounts a route, token transfer does not exist, and the
> explorer URL patterns are convention rather than confirmed.

## Documentation

| File | Purpose |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | rules, commands, traps -- read first if you're contributing |
| [`docs/STATUS_AND_ROADMAP.md`](docs/STATUS_AND_ROADMAP.md) | **where the rebuild is and what's next** |
| [`CONTEXT.md`](CONTEXT.md) | file-by-file map with `file:line` references |
| [`docs/DEFECT_LOG.md`](docs/DEFECT_LOG.md) | every defect found, its root cause and the lesson |
| [`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md) | product spec, wallet model, security policy, QA matrix |
| [`docs/BACKEND_GAPS.md`](docs/BACKEND_GAPS.md) | backend capability tiers; what's blocked on chain verification |
| [`docs/UI_REBUILD_PLAN.md`](docs/UI_REBUILD_PLAN.md) | original audit, target architecture, phase plan |
| `docs/archive/` | superseded plans, kept for provenance -- do not follow |

## Design

Precision dark UI derived from the official `thru.org` design system: Steel, Teal, Brick Red (`#d33c43`), and Gold/Yellow (`#ffad42`) palette, Inter Tight and JetBrains Mono typography, tabular numerals, and byte-mark identicons.

## Why this exists

Thru's own wallet architecture is built around an embedded, iframe-hosted wallet
(`@thru/wallet`, `wallet.thru.org`) with passkey login -- not an injected-provider,
MetaMask-style extension. There's no standard yet for third-party extensions to plug
into dApps built with Thru's own SDKs, so this intentionally does **not** try to inject
a `window.thru`-style provider or connect to dApps. It's scoped down to what's genuinely
useful today: personal key management and basic account operations against alphanet.

## Layout

Two surfaces:

- **Popup / side panel** (`popup.html`, 408--580) -- the wallet proper. The dashboard is a hub, not a
  scroll of everything at once (Rabby was the reference point): an account pill up top opens a
  dedicated account switcher, a balance hero in the middle, and a 4-button action grid (Send,
  Receive, Faucet, History) that each open their own focused screen. Export belongs with account
  management rather than next to Send and Receive -- it's a rare, sensitive action, not a daily one.
  408px rather than a 380px sliver so the account switcher, mnemonic entry, and private-key entry
  have room to breathe.
- **Desktop tab** (`desktop.html`) -- a full-width launchpad surface for token deployment and the
  future DEX, opened via the topbar button. It is a separate hash-routed page with its own layout; it
  shares the account and network switchers with the popup but currently duplicates most other
  helpers.

## What works

- **Create wallet**: real 12-word BIP-39 mnemonic via `@thru/crypto`'s
  `MnemonicGenerator`, derived via `ThruHDWallet` (BIP-44 coin type 9999, SLIP-0010
  Ed25519).
- **Import**: from a 12-word phrase, *or* a raw 32-byte private key (hex) -- address and
  public key are derived automatically via `@thru/sdk`'s `keys.fromPrivateKey()`.
- **Multiple accounts, one wallet, with a real switcher**: "+ Account" derives the next
  BIP-44 index from the seed; "+ Private key" imports another independent key into the
  same wallet. Byte-mark identicons (4--4 deterministic grid) distinguish accounts at a
  glance -- square containers for seed-derived, round for imported keys.
- **Multiple seed phrases in one vault** -- `src/lib/vault.js` implements a full keyring model
  (`addSeedKeyring`, `addPrivateKeyKeyring`, `renameKeyring`, `removeKeyring`). See the caveat in
  [Frontend status](#frontend-status): this is implemented and tested but **not yet exposed through
  the background API**, so the UI cannot reach it.
- **Export**: re-checks your password even if already unlocked, then reveals the
  recovery phrase (seed-derived -- note this exports the *whole seed*) or the specific
  private key (imported accounts). **Currently unreachable from the UI** -- see
  [Frontend status](#frontend-status).
- **Password-encrypted local storage**: PBKDF2 (600,000 iterations, SHA-256) +
  AES-256-GCM. Encrypted vault in `chrome.storage.local`; decrypted vault data lives only
  in `chrome.storage.session` (memory-only, wiped on browser close). Auto-locks on a
  configurable timer (default 15 minutes) -- note this is a fixed-period alarm, **not**
  inactivity-based, despite the settings label.
- **Balance** as a human-scale THRU amount (1 THRU = 1e9 base units), raw units kept
  visible underneath.
- **Create the on-chain account** via `thru.accounts.create({ publicKey })`.
- **Claim from the faucet, on-chain, from inside the extension** -- see "What's verified
  vs. trusted" below.
- **Send native transfers, on-chain, from inside the extension** -- same section.
- **Transaction history**, decoded where possible (see below) rather than just a list of
  signatures.
- **Explorer links** (`scan.thru.org`) on transactions and addresses throughout.
- **CLI command helper** on the faucet screen, for anyone who'd rather run it themselves.

## What's verified vs. what's trusted

Both the faucet and transfer features are built from **reverse-engineered** program
addresses and instruction layouts -- real transactions were submitted via the CLI and
diffed to work out the wire format, not sourced from Thru's own docs, and not
independently re-confirmed against alphanet from whatever environment did that
reverse-engineering (no network access to `rpc.alphanet.thru.org` from here either).
**Treat the specific addresses/byte layouts as well-sourced, not independently
verified** -- if either fails outright with a low-level/format error, doubt those
constants first, not the surrounding code.

That said, a few things push confidence up from "trust the transcript" to something
more solid:

- **Both program addresses decode to the same reserved-program pattern.** Using
  `Pubkey.from(address).toBytes()` on the faucet program (`taAAAAPr6`) and the transfer
  program (`taAAAAICA`) shows both are 32 zero bytes with a single marker byte in the
  last position (`0xfa` and `0x80`) -- the exact same convention `@thru/sdk`'s own
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
  siblings instead of nested objects) -- both fixed here against the actual shipped
  type definitions.
- **Both need the account to exist on-chain first.** `buildAndSign` auto-fills the
  nonce by reading the fee payer's current on-chain state, which only exists once
  `accounts.create()` has run. The faucet transaction is zero-fee (so no *balance*
  needed, just an existing *account*); a transfer is not assumed to be zero-fee, so the
  sender needs a balance covering amount + fee. Both give a specific error rather than a
  confusing low-level one if you try before the account exists.

### A genuine open question: what unit do faucet/transfer amounts use?

The faucet screen's amount field is in **raw base units** (matches the reverse-engineered
CLI examples directly -- `10`, `50`, `1000`). The Send screen's amount field is in
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
`parseThruAmount()` and the faucet screen's input handling -- nothing else assumes a scale.

## Transaction history

`src/lib/thru-client.js`'s `decodeHistoryEntry()` reconstructs the same
`[feePayer, program, ...readWriteAccounts, ...readOnlyAccounts]` ordering used when a
transaction was built, so it can resolve the account indices baked into a known
transfer/faucet instruction back into real addresses -- not just show a bare signature.
Anything calling a program other than the two known ones shows as a generic entry
instead of guessing. Tested in `test-thru-client.mjs` against real `Transaction`
instances built via the SDK's own constructor (including a case that caught a bug in the
*test* itself -- the raw constructor doesn't necessarily preserve insertion order for
accounts, which is exactly why the production code never hardcodes indices either).

## Explorer integration

`scan.thru.org` is confirmed real -- fetched its homepage directly ("Thru Explorer -
Block Explorer for Thru Network", tracking thru-alphanet). At the time it was checked it
showed "Network: alphanet ---- offline" with empty tables, which may just mean the page
hadn't hydrated with live data yet, or may mean the network really was down at that
moment -- worth knowing either way, and worth checking directly since it's a live-updating
dashboard. Its exact `/tx/{signature}` and `/address/{address}` route pattern is **not**
independently confirmed (the homepage had no live example links to check against) -- this
follows the near-universal convention across block explorers generally (Etherscan,
Solscan, Solana Explorer, Basescan all use exactly this), but if it's wrong, worst case
is a dead link. Nothing signs or submits anything through these.

## Loading it in Chrome

1. `chrome://extensions` --  enable **Developer mode** (top right) --  **Load unpacked**.
2. Select the `dist/` folder (after building -- see below).
3. Pin the extension and open it -- first run offers to create or import a wallet.

## Rebuilding from source

```
npm install
npm run build
```

Bundles five entry points via esbuild -- `src/background/index.js` (service worker),
`src/popup/popup.js`, `src/popup/popup.css`, `src/desktop/desktop.js`,
`src/desktop/desktop.css` -- and copies `popup.html`, `desktop.html`, `manifest.json` and
`icons/` straight from `src/`. Edit files under `src/`, never `dist/` directly.

> [!NOTE]
> `dist/` is gitignored and intended to be fully reproducible, but currently is not:
> `dist/sidepanel.html` exists with no source file and is not emitted by `build.mjs`. Resolve that
> before treating `rm -rf dist && npm run build` as exact.

## Testing

```
npm test
```

Three suites, all against real code rather than mocks of the logic under test:

- `test-vault.mjs` -- mocks `chrome.storage` and runs the real vault module against real
  `@thru/crypto`/`@thru/sdk` code: create --  add HD account --  import a private key
  alongside it --  switch between all three --  export (wrong password fails, right one
  matches) --  full lock/unlock cycle --  a private-key-only vault can't derive new accounts.
- `test-thru-client.mjs` -- faucet and transfer instruction byte layouts, `formatThru`/
  `parseThruAmount` round-tripping (including the specific floating-point rounding trap
  a naive `parseFloat() * 1e9` would hit), `isValidThruAddress` correctly rejecting a
  tampered checksum (not just checking length/prefix), and `decodeHistoryEntry` resolving
  realistic transfer transactions from both the sender's and recipient's point of view.
- `test-api-router.mjs` -- background API integration across the wallet, account, tx, token
  and network namespaces.

`test-auto-sponsor.mjs` also exists but is **not** wired into `npm test`.

Worth re-running after touching anything in `src/lib/` or `src/background/`.

## Frontend status

**One stack.** The legacy `show()`-based tree was deleted once all 14 routes existed on the
rebuilt stack, so there is no fallback path and no flag to choose between them:

```
/welcome  /unlock  /dashboard  /accounts  /account  /add-account  /keyring
/export   /send    /receive    /faucet    /history  /settings     /reset
```

Four properties are now enforced by CI rather than by discipline:

- **No `innerHTML` anywhere in the UI.** All DOM is built through `src/ui/kit/dom.js` `h()`,
  which rejects `on*` attributes and script-bearing URLs. The injection ratchet is at **0**.
- **Every navigated route exists and every registered route is reachable** --
  `scripts/check-routes.mjs`. Shipping a button before its destination fails the build.
- **Every CSS class the UI uses is defined.** ~80 usages of undefined classes previously shipped.
- **Key derivation cannot change silently** -- `test-derivation.mjs` runs first, with pinned SDK
  versions and golden vectors.

Three things the rebuild fixed that were outright broken rather than merely ugly:

- **Secret export had no click path at all.** You could not retrieve your own recovery phrase.
  It works now, and a seed-derived account can export just *that* account's private key rather
  than the whole phrase.
- **Multi-seed was fully implemented in the vault and completely unexposed** -- no `keyring.*`
  namespace existed in the API router. Multiple phrases and imported keys are now visible,
  grouped by source, and manageable.
- **The MAX button always threw.** It computed `Math.floor(bigintValue * 10000)`, which raises
  `TypeError: Cannot mix BigInt and other types`.

What is **not** verified: no automated test mounts a route, so rendering is still uncovered.
Full detail in [`docs/STATUS_AND_ROADMAP.md`](docs/STATUS_AND_ROADMAP.md); every defect found and
its root cause in [`docs/DEFECT_LOG.md`](docs/DEFECT_LOG.md).

## Bugs that got caught along the way

- **Address not showing right after create/import**, only after closing and reopening.
  `unlock()` was the only path that marked the session "unlocked" -- create/import saved
  the vault but never did. Fixed by having creation/import mark the session unlocked the
  same way a real unlock does.
- **A previously-imported key reappearing after reset + reimport.** Not a storage leak --
  it was stale form state: the import screen never cleared its own fields on the way in
  or out. Fixed with a `clearSensitiveFields()` helper called on every relevant screen
  transition and unconditionally on reset.
- **A test itself assumed account ordering** that the real `Transaction` constructor
  doesn't guarantee, causing a false failure while writing `decodeHistoryEntry` tests.
  Fixed by determining order empirically from a real instance instead of hardcoding it --
  which is also exactly why the production `sendTransfer`/`claimFaucet` code never
  hardcodes it either, using the SDK's own `getAccountIndex` instead.

## Ideas for next, roughly in priority order

Items 3--5 from an earlier version of this list (MAX button, recent addresses, network health
indicator) are now implemented, though some only inside screen modules that don't currently mount --
see [Frontend status](#frontend-status).

1. **Verify the units question above against real alphanet**, and the faucet/transfer
   addresses generally -- the single highest-value thing anyone with real CLI/network
   access could do next.
2. **Confirm the explorer's actual `/tx/` and `/address/` routes** and fix
   `explorerTxUrl`/`explorerAddressUrl` in `thru-client.js` if they're not what's guessed.
3. **Expose the keyring API** -- `src/lib/vault.js:322-382` already implements multi-seed;
   `src/background/api-router.js` just needs a `keyring.*` namespace. Cheapest high-value work
   available. See `docs/UI_REBUILD_PLAN.md` Sec 4 Phase 1.
4. **Fix the frontend routing split** so screens stop shadowing each other, and restore secret
   export. `docs/UI_REBUILD_PLAN.md` Sec 4 Phases 3--13.
5. **Fee estimation** -- the MAX button currently reserves a hardcoded gas allowance because there's
   no verified way to estimate a fee in advance yet.
6. **dApp connector**, if Thru's own embedded-wallet-first ecosystem model ever changes
   or a compatibility layer becomes worth building -- deliberately out of scope for now,
   see "Why this exists" above.

## Before this touches real funds

Not security-reviewed by anyone beyond chat conversation plus the automated checks
above. Before it holds anything of value: get an actual review, independently
re-confirm the faucet/transfer program addresses and instruction layouts directly
against alphanet rather than this MVP's (well-sourced but unverified-by-me) assumptions, and
close the frontend defects in [Frontend status](#frontend-status) -- several of them are
secret-handling issues, not cosmetic ones.
