# Thru Wallet — Build Specification

Merged authority document. Supersedes `guide.md` and `thru-implementation_plan.md`, both archived
under `docs/archive/` for provenance.

**Read order for a new agent:** `AGENTS.md` → `CONTEXT.md` → this file → `docs/UI_REBUILD_PLAN.md`.

**Division of responsibility between documents:**

| Document | Owns |
| --- | --- |
| `AGENTS.md` | hard rules, commands, traps. Short. Always in context. |
| `CONTEXT.md` | file-by-file map. "Where do I look for X?" |
| this file | product spec, wallet model, feature requirements, security policy, QA matrix |
| `docs/UI_REBUILD_PLAN.md` | **authoritative** target directory layout and phase/commit plan |
| `docs/UI_REBUILD_AGENT_PROMPT.md` | the executable prompt derived from the two above |

Where this file and `UI_REBUILD_PLAN.md` disagree on **structure**, `UI_REBUILD_PLAN.md` wins — it
was written against the audited tree. Where they disagree on **product behaviour**, this file wins.

---

## Part 0 — Status ledger (read this before trusting any older claim)

The archived `task.md` marks Phases 1–4 "COMPLETED". A file-by-file audit found that most of that
work is **present in the repo but unreachable at runtime**. Corrected status:

| Claim in `task.md` | Reality |
| --- | --- |
| `src/lib/networks.js`, `src/shared/format.js`, `src/ui/bridge.js` | ✅ real, reachable, working |
| `src/background/services/*`, `api-router.js`, `background/index.js` | ✅ real and working |
| `test-api-router.mjs` | ✅ exists and runs |
| `src/ui/store.js` | ⚠️ partial — `subscribe()` and `get()` have zero callers, so `notify()` always iterates an empty set |
| `src/ui/components/drawer.js`, `account-switcher.js`, `network-switcher.js`, `token-row.js` | ✅ reachable |
| `src/ui/components/skeleton.js` | ❌ zero importers — dead file |
| "Rabby-Style Dashboard" | ⚠️ `screens/dashboard.js` mounts, but its listeners die permanently after any round-trip to another screen |
| Pre-sign review card | ⚠️ reachable only through `screens/send.js` |
| Settings / export secrets | ❌ **export is unreachable from the shipped UI by any click path** |

Additional facts that contradict the archived documents:

- The archived plan describes a target of `src/popup/core/`, `src/popup/components/`. What was
  actually built is `src/ui/` + `src/popup/screens/`. Neither matches. The authoritative target is
  `docs/UI_REBUILD_PLAN.md` §3.
- The archived plan cites `src/background.js` as the live service worker. It is dead;
  `src/manifest.json` and `build.mjs` both point at `src/background/index.js`.
- Line counts in the archived plan (`popup.js` 624, `popup.html` 286, `vault.js` 297) are stale.
  Actual: 1118, 428, 486.
- `guide.md` referenced `README(20260815-192822).md` and `thru-implementation_plan(1).md`. Neither
  filename exists in this repo.
- **Most of the modular refactor is untracked in git** (`src/ui/`, `src/popup/screens/`,
  `src/background/`, `src/desktop/`, `src/shared/`, `src/domain/`). Commit it before refactoring so
  there is a rollback point.

---

## Part I — Mission and non-negotiables

### Mission

Turn a working Thru L1 wallet MVP into a Rabby-class wallet **experience** for Thru, without
regressing any working wallet or blockchain functionality, and with an architecture that absorbs
tokens, NFTs, launchpad, DEX/AMM, prediction markets, portfolio analytics, address book, dApp
connectivity, multi-network, notifications, transaction simulation, hardware wallets, and passkeys
**without rewriting the vault, signing engine, or RPC layer**.

Use Rabby as a UX, information-architecture and feature-discovery reference. Do not copy its source,
assets, branding, or exact visual design. Rabby is MIT-licensed; reusing layout patterns and route
naming is fine, pasting code is not.

### The most important rule

```
Preserve → Abstract → Isolate → Test → Redesign → Extend
```

not

```
Rewrite everything → hope nothing breaks
```

Never sacrifice working wallet functionality to make the interface look better. Never claim "the UI
works" while the build or test suite is broken.

### Sacred layers

Treat as production-grade; modify only for a verified bug, never for cosmetics:

vault, key derivation, mnemonic generation/import, private-key import, account derivation,
encryption/decryption, session unlock, auto-lock, Thru RPC client, transaction construction,
signing, submission, faucet, balance retrieval, history decoding, explorer integration.

### Baseline discipline

Before and after every change:

```
npm run build
npm test
```

If a test fails: determine whether it is pre-existing, identify the exact regression, fix it, rerun
the whole suite. Never weaken or skip a test to make it pass.

### Do not over-engineer

No React, Vue, or Tailwind. No dependency added merely because Rabby uses it. The only sanctioned
new dependency is `jsdom` (dev-only, for route smoke tests). Vanilla ES modules + esbuild stays.

---

## Part II — Wallet model

Do **not** model the system as `one wallet = one address`. The vault already implements the correct
hierarchy (`src/lib/vault.js`); the UI must expose it.

```
Wallet Container (one password, one unlock session)
├── Seed keyring A  (type:'seed')
│   ├── HD account 0
│   ├── HD account 1
│   └── ...
├── Seed keyring B  (type:'seed')          <- multi-seed, already supported
├── Private key keyring (type:'privateKey', exactly one account)
├── Private key keyring
└── future: hardware keyring, watch-only, passkey
```

The UI must visually distinguish: wallet container, seed phrase, HD-derived account, imported
private key, and — later — watch-only and hardware accounts. Never conflate them.

### Vocabulary mapping (Rabby ⇄ Thru)

| Rabby term | Thru term | Code |
| --- | --- | --- |
| `HD Key Tree` | seed keyring | `keyring.type === 'seed'` |
| `Simple Key Pair` | private-key keyring | `keyring.type === 'privateKey'` |
| `byImport=true` | imported vs generated phrase | **not yet stored** — add `origin: 'generated' \| 'imported'` |
| address (in URL) | opaque account `ref` | `{ keyringId, accountIndex }`, encoded |

### Known model gap

`seedKeyring()` in `src/lib/vault.js` does not record provenance, so the account-detail screen
cannot show "back up your phrase" only where meaningful. Add `origin` with a storage migration.

---

## Part III — Architecture

### Layering (mandatory)

```
UI  →  Application services  →  Domain interfaces  →  Adapters  →  RPC / crypto / storage
```

Never `UI → vault.js → RPC`.

The concrete seam in this repo is already correct in shape:

```
UI  →  bridge.send(method, params)  →  api-router.js  →  services/*  →  vault.js | thru-client.js
```

Keep exactly that seam. Harden it per the four rules below.

### The four rules that make the backend unbreakable

**R1 — One seam, and it is data.** The frontend reaches the backend only via
`bridge.send(method, params)`. `method` must exist in `src/shared/contract/manifest.js`.
`bridge.send` throws locally if it does not; `api-router.js` rejects anything not in the manifest.
Only `src/ui/app/bridge.js` may call `chrome.runtime.sendMessage`.

**R2 — The contract is append-only.** Adding a method is always safe. Changing or removing one
requires a new name (`tx.send` → `tx.sendV2`), keeping the old until no route references it. A
method's shape is never edited in place.

**R3 — Layering is enforced by a script, not by discipline.** `scripts/check-layering.mjs` fails the
build when:
- `src/background/**` imports `src/ui/**`, `src/popup/**`, or `src/desktop/**`
- `src/ui/kit/**` imports `bridge`, `chrome.*`, or `src/features/**`
- `src/ui/**` imports `src/background/**` or `src/lib/vault.js`
- `chrome.runtime.sendMessage` appears outside `src/ui/app/bridge.js`

**R4 — The contract is tested in both directions.** `test-contract.mjs` asserts manifest ⊇ handlers
**and** handlers ⊇ manifest. This is the mechanism that catches shape drift — e.g. the live bug
where `token-service.js` sends `symbol`/`imageUrl` while `thru-client.js` destructures
`ticker`/`imageUri`, leaving every stored token with an empty ticker.

### Target directory layout

**Authoritative version: `docs/UI_REBUILD_PLAN.md` §3.** Summary:

```
src/shared/       contract manifest, format, ref codec. No chrome.*, no DOM.
src/background/   service worker, api-router, migrations/, services/, features/
src/ui/kit/       domain-free primitives (+ dom.js, the only node factory)
src/ui/domain/    wallet-aware components
src/ui/app/       one router, route tables, boot gate, guards, store, bridge
src/features/<id>/  self-contained feature modules
src/popup/        shell HTML + boot stub + styles
src/desktop/      shell HTML + boot stub + styles
```

The archived documents proposed two other structures (`popup/core/**`, and a
`core/domain/application/infrastructure` layering). Both are superseded. The principle they were
reaching for is retained and is what matters: **domain and infrastructure must never depend on UI.**

### Component lifecycle

Every component is a factory returning `{ el, update(props), destroy() }`. Every screen has
`mount()` → `update()` → `cleanup()`.

`destroy()`/`cleanup()` must remove the **same function references** it added. Six current call
sites pass fresh arrow functions to `removeEventListener`, which removes nothing — see `CONTEXT.md`.

Navigating away from a sensitive screen must clear sensitive fields. Back navigation must work.
No duplicate listeners, no remount duplication, no stale state.

### One store, one event bus, one router

State shape:

```
{ session, selectedKeyring, selectedAccount, accounts, balances, assets,
  activity, network, pendingTransaction, ui, settings }
```

Use selectors and subscriptions. Do not create dozens of unrelated global mutable variables — the
current `popup.js` has `pendingMnemonic`, `pendingExportSecret`, `pendingExportRef`, `importMode`,
`activeAccount`, `selectedSendToken` at module scope, which is how secrets survive lock.

Event names (`src/ui/events.js` already defines these; most currently have zero subscribers):

```
wallet:created|imported|locked|unlocked|reset
account:created|switched|renamed|removed|imported
balance:updated
transaction:created|submitted|confirmed|failed
network:online|offline|switched
security:timeout
```

An event bus with no subscribers is worse than none — it looks like decoupling while nothing
propagates. Either wire the subscribers or delete the constants.

### Feature registry — how new things stop breaking old things

```js
// src/features/index.js
export const FEATURES = [launchpad, dex, perps, prediction];
// each: { id, routes, navEntries, enabled }
```

Rules:
- A feature may import `ui/kit`, `ui/domain`, `shared/**`. Nothing else.
- A feature adds backend methods only under its own namespace (`launchpad.*`, `dex.*`).
- A feature never edits a core file. If it must, that need is a missing kit primitive — add the
  primitive instead.
- `enabled: false` must remove it from nav and routes with no other edit.
- A feature must not touch vault encryption internals, raw secret storage, private-key memory, or
  browser storage internals. It requests signing through the transaction service.

### Future-proofing checklist

Before committing any new feature, answer:

1. Does this belong to wallet core or a feature module?
2. Does it need a new domain abstraction or a new Thru adapter?
3. Can it be disabled without breaking the wallet?
4. Can it be tested independently?
5. Can it be removed without touching the vault?
6. Can the backend stay unchanged if the UI is redesigned?

If any answer is unsatisfying, redesign before committing.

---

## Part IV — Feature specification

### Onboarding

**Welcome:** create new wallet · import recovery phrase · import private key. Future placeholders:
connect hardware wallet, passkey wallet.

**Create wallet:** generate mnemonic → backup warning → reveal only on explicit request →
confirmation challenge → confirm backup → create password → save encrypted vault → unlock session →
show account → offer naming.

### Import

**Seed phrase:** validate → derive first address → allow naming → optionally derive additional
addresses → show derived addresses before final confirmation → let the user select which to add.

**Private key:** validate format → derive address → show resulting address before import → allow
label → save encrypted → never display the key again except through authenticated export.

Design the data model so bulk private-key import can be added later without changing account
storage. (`vault.js` keyrings already satisfy this.)

### Dashboard — a hub, not a scroll

```
current account (identity + address)
        total balance
        [ Send ] [ Receive ]
        [ more actions ]
        assets / activity
        recent transactions
        network status
```

The user must immediately understand: which account is active, its balance, what it owns, what
happened recently, what to do next. Do not put every feature on the first screen.

### Account switcher — a dedicated experience, not a dropdown

Keyring grouping · account grouping · search · truncated addresses · copy · balance preview ·
active indicator · label · type badge · import account · derive HD account · switch keyring ·
open account detail.

```
Accounts
[ search ]

Seed wallet 1
  ● Main        ta8…x9m    12.43 THRU
  ● Trading     ta1…abc     4.22 THRU
Seed wallet 2
  ● Cold        ta3…kk2     0.00 THRU
Imported
  ● Launchpad   ta7…xyz     0.81 THRU

+ Add account   + Import private key   + Add seed phrase
```

### Account detail

Identicon · label · full address · copy · QR · account type · derivation index · keyring
association · provenance (generated/imported) · balance · assets · activity · explorer link ·
export · rename · remove keyring · future hardware info.

Every sensitive action requires password re-authentication.

### Send — a reviewed flow, never a one-click form

```
draft → review → awaiting-auth → signed → submitted → confirmed
failure: rejected | simulation-failed | submission-failed | network-timeout | unknown
```

Step 1 collect: recipient (paste · recent · in-wallet picker · live validation · self-transfer
warning), asset, amount (MAX and % chips honouring the gas reserve).
Step 2 preview: amount, recipient, network fee, total.
Step 3 authenticate. Step 4 sign. Step 5 submit. Step 6 success with signature + explorer link.

Before signing: validate recipient, validate amount, ensure sufficient balance, estimate fee where
possible, check account existence, re-check unlock state, prevent duplicate submission, show the
exact effect. Never silently change recipient or amount. Never submit because the user clicked once.

**Amount arithmetic is BigInt-only**, via `src/shared/format.js`. Never `parseFloat(x) * 1e9` — it
misrounds. `src/desktop/desktop.js` currently violates this in its swap estimate.

**No irreversible action may be triggerable by a stray Enter key.** The current global Enter handler
clicks the first enabled `.btn.primary` in the visible screen, which on the send preview is
"Sign & Broadcast". Use an explicit opt-in per screen, or a slide-to-confirm control.

### Receive

QR code · full address · copy · shortened address · account identity · network identifier ·
explorer link. Make it extremely clear which network the address is for.

### History

Filters: All · Sent · Received · Faucet · Failed · Pending (where applicable).
Each row: type · amount · counterparty · timestamp · status · signature · explorer link.

Decode only known programs. For anything else, `Unknown transaction` is correct and inventing a
meaning is not.

### Assets — abstraction before implementation

```ts
interface Asset {
  id: string
  type: 'native' | 'token' | 'nft'
  networkId: string
  address?: string
  symbol: string
  name: string
  decimals: number
  logo?: string
  balance: bigint
}
```

Native THRU uses this model too, so token support later needs no dashboard rewrite. Planned:
discovery, balances, transfer, import, metadata, visibility controls, spam hiding, search, detail.

**Never render fake balances or unverified metadata.** Create the interfaces now; implement only
verified Thru functionality.

Token metadata is attacker-controlled — an arbitrary on-chain token can carry any name, ticker, or
image URL. Render it through `textContent` only, and allowlist image schemes to `https:` and
`data:image/`.

### Network

```ts
NetworkConfig { id, name, rpcUrl, explorerUrl, nativeAsset, environment }
```

Plus `NetworkService`, `RpcClient`, `NetworkHealthService`. Never hard-code network info in a UI
component. This is what lets alphanet/testnet/mainnet/local/custom coexist later.

Health display: `● Connected 120ms` / `● Slow` / `● Offline`. Use exponential backoff. Do not hammer
the RPC. Cache last-known balance where safe. **Never imply a transaction succeeded merely because
the RPC accepted it.**

### Error handling

Typed errors, mapped to human messages:

```
WalletLockedError · InvalidAddressError · InsufficientBalanceError · NetworkUnavailableError
TransactionRejectedError · TransactionFailedError · AccountNotFoundError
UnsupportedProgramError · InvalidSecretError
```

Never surface a raw RPC error. `rpc error: code -320xx` becomes "The Thru network is temporarily
unavailable. Check your connection and try again." Offer a "Details" affordance for developers.

### Future modules (interfaces now, implementation later)

`features/launchpad/` · `features/dex/` · `features/prediction/` · `features/nft/` ·
`features/portfolio/` · `features/dapp/`

Thru exposes AMM bindings under `@thru/programs/amm` (pool derivation, instruction builders, swap
quoting) and a Token Program. Do not implement DEX or launchpad behaviour until those program
interfaces are verified against the target network.

**dApp connector:** do not invent a fake `window.thru` standard. Thru's documented architecture is
centred on a hosted embedded wallet with passkey login. Define the abstraction now
(`WalletProvider { connect, disconnect, getAccounts, signTransaction }`), implement
`ThruEmbeddedProvider` / `ThruExtensionProvider` only once a real compatibility standard exists.

---

## Part V — Security policy

### Never

Log a mnemonic, private key, or decrypted vault. Store raw secrets in ordinary storage. Put secrets
in URL parameters, `location.hash`, router history or params, `data-*` attributes, `localStorage`,
`sessionStorage`, `window`, or analytics. Send secrets to a remote service. Expose private keys to
frontend components unnecessarily. Use a third-party crypto library where the Thru crypto layer
suffices.

### Require authentication before

Export seed · export private key · signing · changing security settings · resetting the wallet ·
renaming a keyring · removing a keyring.

### Secret lifetime

Keep decrypted key material in the smallest possible scope and clear it the moment it is no longer
needed. Secrets move between screens via a **one-shot in-memory handoff that nulls itself on read**
— never via router params, never via the DOM.

After lock, `document.body.outerHTML` must contain no mnemonic word and no 64-hex private key.

### Storage separation

```
chrome.storage.local    encrypted vault · settings · labels · address book · preferences
chrome.storage.session  decrypted vault · derived key · signing material · temporary secrets
```

Never persist decrypted wallet material for convenience. Any change to a stored shape requires a
numbered, idempotent, tested migration under `src/background/migrations/`.

### Input hardening

Seed-phrase and private-key inputs need
`autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off"`. With Chrome Enhanced
Spell Check enabled, a spellchecked textarea transmits its contents to Google — a documented seed
exfiltration path. **The currently rendered textareas in `src/popup/popup.html` lack these.**

Account labels are user-controlled and must be length- and charset-limited **in the background**
(`vault.js`), not by an HTML `maxlength`.

### DOM safety is structural, not a policy

There is no HTML-escaping helper anywhere in the repo, and ~20 `innerHTML` sinks interpolate
attacker-influenceable values. Escaping 20 call sites by hand is a policy that decays. Instead:

- one node factory `src/ui/kit/dom.js` `h()`; text via `textContent`; `on*` attributes and
  `javascript:` URLs rejected
- CI greps for `innerHTML =`, `insertAdjacentHTML`, `outerHTML =` under `src/ui`, `src/features`,
  `src/popup`, `src/desktop` and fails on any match

### CSP

Target:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src <rpc origins>; frame-src 'none'; form-action 'none';
base-uri 'none'; object-src 'none'
```

The current policy omits `default-src`, leaving `frame-src`/`img-src`/`connect-src`/`form-action`/
`base-uri` unrestricted — an injected `<iframe src="https://evil">` would render inside trusted
extension chrome. Self-host fonts; the two HTML files currently fetch Google Fonts on every open,
which is both a usage oracle for a wallet and a CSS-injection vector.

### Authentication hardening

Unlock needs a persisted attempt counter with exponential backoff, enforced in the **background**,
not the UI. Auto-lock must be genuinely inactivity-based (stamp `lastActivityAt` on each API
request; a 1-minute alarm compares against it) — the current implementation is a fixed-period alarm
while the settings screen calls it "Lock after inactivity".

---

## Part VI — Design system

Keep `src/popup/styles/tokens.css`. It encodes the thru.org palette (Steel, Teal, Brick `#d33c43`,
Gold `#ffad42`, Inter Tight + JetBrains Mono) and is the one part of the frontend that needs no
rework. Adopt Rabby's *structure*, not its colors.

Aesthetic: dark industrial · precise spacing · compact but readable · strong type hierarchy ·
tabular financial numerals · monospace addresses · deterministic identity visuals (byte-mark) ·
subtle motion · clear security warnings · high information density · excellent empty/error/loading
states.

Avoid: visual clutter · excessive gradients · generic Web3 neon · a giant card around every element.
It should feel like professional financial software, not a crypto landing page.

### Component inventory

`kit/` (domain-free): dom · button · field · input · password-input · textarea · sheet · modal ·
toast · list · row · tabs · pill-switch · badge · spinner · empty · skeleton · copyable · tooltip ·
search-input · page-header · navbar · card · amount-input · confirm-slider

`domain/` (wallet-aware): account-avatar · account-row · keyring-group · address-viewer ·
account-selector-sheet · token-row · token-selector · recipient-field · tx-review-card ·
network-selector · seed-phrase-grid · password-prompt

No interaction may be implemented twice. `setError` currently exists in eight copies; the mnemonic
grid in three; `refsEqual` in three.

### Layout rules

Delete every `.mt-*` / `.w-100` usage. Those classes are used at ~80 sites and defined nowhere,
which is why the modular screens render with fields flush together. Layout belongs to `kit/card`,
`kit/list`, and a `stack` primitive that sets `display:flex; flex-direction:column; gap:<token>`.
No component reaches outside its own root node. CI diffs class names used in JS/HTML against CSS
selectors and fails on both used-but-undefined and defined-but-unused.

### Icons

One icon system, original or properly licensed. Never Rabby's assets. Every icon: predictable size,
consistent stroke, accessibility label when interactive.

### Popup sizing

Optimize for ~408×580 without hard-coding layouts so tightly that future screens cannot grow. Long
flows use scrollable panels or the full-page desktop view rather than cramming.

### Accessibility

Keyboard navigation · visible focus · Enter to submit (except irreversible actions) · Escape to
close overlays · appropriate labels · sufficient contrast · `prefers-reduced-motion` · accessible
error messages.

### Performance budget

Popup render < 200 ms with cached state · screen transition < 200 ms · no blocking RPC during
initial paint · no unnecessary polling · skeletons instead of frozen UI · render cached state first,
refresh asynchronously.

---

## Part VII — Phasing

**Authoritative version: `docs/UI_REBUILD_PLAN.md` §4.** Summary, in strict order, each phase
ending with a green build and test run:

| Phase | Content |
| --- | --- |
| 0 | Guardrails only, zero behaviour change: contract manifest, own-property handler lookup, layering check, `test-contract.mjs`, jsdom smoke harness, CI, delete 3 zero-importer files |
| 1 | Backend-only additive: expose `keyring.*`, repoint `account.addImported` to the password-checked path, add `origin` + migration, unlock backoff, inactivity auto-lock |
| 2 | Surgical security fixes on the current UI (seed in `dataset`, secrets surviving lock, textarea attributes, CSP, self-hosted fonts, null guards) |
| 3 | New stack + one route (`#/unlock`) behind a flag, both stacks coexisting |
| 4–13 | One route per commit, deleting the legacy copy in the same commit |
| Final | Delete the monolith, dead CSS, and the flag |
| Features | `features/launchpad`, `dex`, `perps`, `prediction` — only after Final |

Route migration order (highest-risk first): welcome/onboarding → accounts → account detail →
add-account → **export (currently unreachable)** → send → dashboard → history/receive/faucet →
settings → desktop profile.

### Migration principle

Incremental strangler-fig, never a giant rewrite:

```
existing MVP → protect with tests → extract contracts → introduce services →
one router → one store → wire events → extract screens → extract components →
redesign screen by screen
```

After each step: test, build, manual verification, commit. Never leave the project broken across a
multi-week refactor.

### Git strategy

Small commits. `refactor: introduce wallet service boundary` · `feat: add account switcher` ·
`test: add account regression suite`. Never mix a security refactor + a UI redesign + a new feature
in one commit.

---

## Part VIII — Verification

### Automated

`npm test` must run and pass:

1. `test-vault.mjs` — real vault against real `@thru/crypto`/`@thru/sdk`
2. `test-thru-client.mjs` — instruction layouts, BigInt amount round-trip, address checksum, history decode
3. `test-api-router.mjs` — background API integration
4. `test-contract.mjs` — manifest ⇄ handlers, both directions
5. `scripts/check-layering.mjs` — the four import rules
6. `scripts/check-css.mjs` — no class used-but-undefined or defined-but-unused
7. `test-ui-smoke.mjs` — every registered route mounts under jsdom with a mocked bridge in
   locked / unlocked / no-vault states
8. grep gates — no `innerHTML =` in UI dirs; no `chrome.runtime.sendMessage` outside the bridge

Note: `test-auto-sponsor.mjs` exists but is absent from `package.json`'s test script. Either wire it
in or delete it.

Protect with tests before any major refactor: mnemonic generation · seed derivation · private-key
import · account switching · export authorization · encryption · decrypt/re-encrypt cycle ·
lock/unlock · reset · balance formatting · exact THRU conversion · address validation · transaction
construction · transaction decoding.

Use real SDK behaviour. Avoid tests that only test mocks of the implementation.

### Security test matrix

| Scenario | Expected |
| --- | --- |
| wrong password | unlock rejected, attempt counted |
| repeated wrong passwords | backoff enforced in background |
| session expired mid-send | re-authentication required |
| invalid recipient | cannot continue |
| insufficient funds | cannot continue |
| RPC failure | no false success |
| duplicate send click | exactly one transaction request |
| navigation during secret entry | sensitive fields cleared |
| lock while reveal screen open | no secret anywhere in the DOM |
| token named `"><iframe src=//evil>` | rendered as text, no element created |
| `bridge.send('constructor')` | rejected as unknown method |

### Manual QA checklist

**Onboarding:** create · backup · unlock · reload · lock · unlock again
**Import:** seed · private key · invalid seed · invalid key
**Accounts:** derive account · add second seed phrase · import key · switch · rename · export ·
mixed HD + imported · remove keyring
**Transactions:** send · invalid address · insufficient funds · RPC offline · duplicate click ·
success · explorer link
**Receive:** QR · copy · full address
**History:** reload · decode · filter · unknown transaction
**Settings:** auto-lock · network status · reset · version/about

### Design review per UI phase

Visual hierarchy — is the important information first? Density — efficient, not cramped?
Consistency — same components everywhere? Security — are dangerous operations visually separated?
Motion — does it aid orientation or distract? Failure states — does the app look deliberate when the
network is offline?

---

## Part IX — Agent behaviour

### Decide without asking when

Requirements are explicit · existing functionality is preserved · the change is low-risk · the
architecture supports future extension.

### Stop and document instead of guessing when

Thru program semantics, transaction formats, fee units, token standards, signing behaviour,
explorer URL patterns, or dApp provider standards are uncertain. A product decision is needed. A
test would have to be weakened. You are about to introduce a second router, a second store, or a
second way of building DOM.

**Do not fabricate protocol behaviour.**

### Thru-specific rule

The blockchain layer is authoritative. Prefer `@thru/sdk`, `@thru/crypto`, `@thru/programs`,
`@thru/wallet`, `@thru/passkey` over hand-written protocol code wherever the official SDK provides
the capability. Use only verified APIs.

### Report format after each phase

```
PHASE / ITEM:
FILES ADDED / MODIFIED / DELETED:
BACKEND CONTRACT DELTA:
LEGACY CODE DELETED:
UI CHANGES:
SECURITY IMPACT:
TESTS:                 <command> -> PASS/FAIL (+counts)
BUILD:
MANUAL VERIFICATION:   what was actually checked
KNOWN LIMITATIONS:
NEXT:
```

Do not claim something is tested unless the test was run. Do not claim something is verified against
Thru unless it was actually verified against Thru.

---

## Part X — Open questions (unresolved, carried forward)

1. **Amount units for faucet vs transfer.** The faucet field is raw base units (matching
   reverse-engineered CLI examples); Send is human-scale THRU. Both are reasoned, neither is
   confirmed against a live network. If this is backwards, the fix is contained to
   `parseThruAmount()` and the faucet input handling. **Highest-value verification available.**
2. **Faucet and transfer program addresses and instruction layouts** are reverse-engineered, not
   sourced from Thru docs. Structural evidence supports them (both decode to the reserved-program
   pattern the SDK itself uses), but they are not independently confirmed against alphanet.
3. **Explorer route patterns** `/tx/{sig}` and `/address/{addr}` follow universal convention but are
   unconfirmed. Worst case is a dead link.
4. **Brand name** — keep "Thru Wallet" or adopt a distinct name? Affects manifest, onboarding,
   wordmark, store listing.
5. **RPC endpoint override in settings** — ship for local dev nodes, or defer as too advanced?
6. **Auto-refresh interval** — 30 s assumed; alphanet RPC tolerance unknown.
7. **Watch-only and hardware accounts** — in scope for the wallet model now, or deferred?
8. **Devnet vs alphanet default network.**
