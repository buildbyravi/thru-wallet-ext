# Thru Wallet — Build Specification

Merged authority document. Supersedes `guide.md` and `thru-implementation_plan.md`, both archived
under `docs/archive/` for provenance.

**Read order for a new agent:** `AGENTS.md` → `docs/DOCS_INDEX.md` →
`docs/PROJECT_LEDGER.md` → `docs/STATUS_AND_ROADMAP.md` → `CONTEXT.md` → this file.

**Division of responsibility between documents:**

| Document | Owns |
| --- | --- |
| `AGENTS.md` | hard rules, commands, traps. Short. Always in context. |
| `docs/DOCS_INDEX.md` | which document to trust and archive/reference status. |
| `docs/PROJECT_LEDGER.md` | past/present/future build tracking and identifiers. |
| `docs/STATUS_AND_ROADMAP.md` | active state and ordered next work. |
| `CONTEXT.md` | file-by-file map. "Where do I look for X?" |
| `docs/MODULE_BOUNDARIES.md` | target feature/module/adapter separation. |
| this file | product spec, wallet model, feature requirements, security policy, QA matrix. |
| `docs/UI_REBUILD_PLAN.md` | historical rebuild plan and rationale; not current file facts. |
| `docs/UI_REBUILD_AGENT_PROMPT.md` | historical prompt derived from older plan; do not execute as current state. |

Where this file and newer docs disagree on **current structure**, `CONTEXT.md` and
`MODULE_BOUNDARIES.md` win. Where they disagree on **product/security behaviour**, this file wins.

---

## Part 0 — Current status summary

This file owns product/security behaviour. It no longer owns the detailed current-state ledger.
For exact current state, route/method counts, and next tasks, read:

- `docs/DOCS_INDEX.md` — which document to trust;
- `docs/PROJECT_LEDGER.md` — past/present/future build tracking and identifiers;
- `docs/STATUS_AND_ROADMAP.md` — active roadmap;
- `CONTEXT.md` — current file map;
- `docs/MODULE_BOUNDARIES.md` — future feature separation and SDK-adapter boundaries.

Current shipped facts, cross-checked against `src/` on 2026-09-26:

| Area | Shipped state |
| --- | --- |
| UI stack | One popup/side-panel route stack; 14 registered routes. |
| Contract | v12, 81 methods; `src/shared/contract/manifest.js` is authoritative. |
| Signing | Signing requires an unlocked wallet. Password re-auth defaults off and is a password-gated Settings opt-in. |
| Registration | v12 `tx.registerAccount` is unlocked-only and restricted to exact vault-owned accounts; it is used for bounded creation-time activation and Send JIT, never arbitrary contacts or periodic signing. |
| Send | Review pins the source account/network through checked methods; an unregistered owned recipient must finish JIT activation before Review. |
| History | Flat stream without day headers; cache-first reads are network/address-scoped; block times carry provenance and unavailable times are not invented. No per-card fee line. |
| Side panel | Shared page with popup/panel mutual exclusion; Side Panel Mode is an explicit opt-in. Browser behavior remains a manual check. |
| Guarded DOM | Zero guarded injection sinks across shipped `src/` (vendored QR code excluded). |
| Unshipped surfaces | Launchpad/DEX/prediction UI, extension dApp provider, and simulation are not claimed shipped. |
Older archived docs describe pre-rebuild structures such as `src/desktop`, dual routers, and
unreachable export flows. Those are historical facts, not current state.

---

## Part I — Mission and non-negotiables

### Mission

Maintain the shipped self-custody Thru wallet: vault and keyring management, account activation,
network-scoped balances and token support, reviewed native/token Send, Receive, faucet, History, and
Settings. Preserve working wallet and chain behavior while making small, tested changes. Any optional
surface absent from `src/` remains unshipped and requires its own verified implementation.

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

### Shipped core layers

Treat the existing vault, key derivation, encryption/session handling, auto-lock, Thru RPC/transaction
client, signing/submission, faucet, balances, token operations, and History decoding as sensitive
production code. Change them only for a verified bug or an intentional, tested additive behavior.
The explorer link is not a certified explorer integration; its route remains an open check.

### Baseline discipline

Before and after every change:

```
npm run build
npm test
```

If a test fails: determine whether it is pre-existing, identify the exact regression, fix it, rerun
the whole suite. Never weaken or skip a test to make it pass.

### Do not over-engineer

No React, Vue, or Tailwind. No dependency is added merely because Rabby uses it. The shipped
`test/test-route-lifecycle.mjs` mounts routes against a hand-rolled DOM shim; the current package
uses vanilla ES modules, esbuild, `@thru/sdk`, and `@thru/programs`.

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

The UI distinguishes the shipped wallet container, seed keyrings/HD accounts, and imported private-key
keyrings. Watch-only and hardware accounts are not shipped; do not present them as supported.

### Vocabulary mapping (Rabby ⇄ Thru)

| Rabby term | Thru term | Code |
| --- | --- | --- |
| `HD Key Tree` | seed keyring | `keyring.type === 'seed'` |
| `Simple Key Pair` | private-key keyring | `keyring.type === 'privateKey'` |
| `byImport=true` | imported vs generated phrase | keyring `origin: 'generated' / 'imported'` is stored in the vault |
| address (in URL) | opaque account `ref` | `{ keyringId, accountIndex }`, encoded |

### Resolved provenance field

Seed keyrings record whether a phrase was generated or imported, and the vault also records backup state. Do not add a duplicate provenance field or migration without first checking `src/lib/vault.js` and its tests.

## Part III — Architecture

### Layering (mandatory)

```
UI  →  bridge + shared contract  →  background API router/services  →  vault / Thru client
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

**Contract v5 exception:** the signing re-authentication fix intentionally changed existing
signing methods in place from `auth: 'unlocked'` to `auth: 'signing'`. This is a documented
compatibility break so older callers cannot bypass the new background signing gate by continuing
to call legacy method names.

**Contract v6 exception:** destructive/security-setting hardening intentionally changed existing
method requirements in place: `wallet.reset` now needs explicit confirmation and needs a password
when unlocked; `system.setAutoLock` now requires password re-authentication. This prevents older
callers from weakening auto-lock or resetting an unlocked wallet through stale UI assumptions.

**Contract v7 exception:** `network.setActive` retains its method and parameter shape but no longer
accepts saved custom ids. It returns permanent `CUSTOM_NETWORK_DISABLED`; stored custom, disabled,
or unknown active ids heal to the default before RPC binding.

**Contract v8–v12 additions:** token transfer/balances, History feed/detail, checked Send context,
owned-account registration, and storage-only cached History were added without removing methods.
The v12 registration method is an intentionally narrow unlocked-only exception; it is not a value-
moving send and cannot sign for an address outside the vault.

**R3 — Layering is enforced by a script, not by discipline.** `scripts/check-layering.mjs` scans
static imports against the shipped background/UI/kit/shared boundaries and fails on a prohibited
edge. It also enforces the `chrome.runtime.sendMessage` allowlist: UI-to-background messages go
through `src/ui/app/bridge.js`, and background-to-UI events go through
`src/background/services/event-service.js`. The same guard keeps the shipped DOM-sink count at
zero. Do not claim it checks arbitrary `chrome.*` usage or general dataflow.

**R4 — The contract is tested in both directions.** `test/test-contract.mjs` asserts manifest ⊇ handlers
**and** handlers ⊇ manifest and guards the declared security invariants. Historical token-field
mismatches are resolved; do not present them as current defects.

### Target directory layout

**Authoritative version for future separation: `docs/MODULE_BOUNDARIES.md`.** Summary:

```
src/shared/         contract manifest, format, ref codec. No chrome.*, no DOM.
src/background/     service worker, api-router, services, future background/features.
src/ui/kit/         domain-free primitives (+ dom.js, the only node factory).
src/ui/domain/      wallet-aware reusable components.
src/ui/app/         one popup router, route tables, boot gate, guards, bridge.
src/features/<id>/  future self-contained feature UI/model modules.
src/lib/thru/       future thin official Thru SDK/program adapters.
src/popup/          popup shell HTML + boot stub + styles.
                    (src/launchpad/ is deleted -- see the Launchpad row above and CONTEXT.md Sec 9.)
```

The archived documents proposed other structures (`popup/core/**`, `src/desktop/**`, and a
`core/domain/application/infrastructure` layering). Those are superseded. The retained principle:
**domain and infrastructure must never depend on UI.**

### Component lifecycle

Route components own their DOM and listeners and expose teardown through the current route/component
contracts. Use the shared disposer pattern and remove the same handler references that were added.
`test/test-route-lifecycle.mjs` mounts all registered routes through the real Router/guards/bridge
with a DOM shim and asserts detached-node listener cleanup. The shim does not render pixels; layout,
focus appearance, QR output, and Chrome scheduling remain manual browser checks.

Navigating away from a sensitive screen must clear sensitive fields. Do not rely on a comment where
a route teardown can enforce the same property.

### Current routing and events

The shipped UI has one `Router` in `src/ui/app/router.js`, one allowlisted bridge in
`src/ui/app/bridge.js`, and route-local state. There is no shipped central UI store or
`src/ui/events.js` bus. Background push events are emitted by `src/background/services/event-service.js`
and consumed through the bridge. Keep event names and handler coverage aligned with
`src/shared/contract/manifest.js` and the tests; do not copy the deleted legacy popup's store/event
model into the current stack.

### Feature registry — unshipped target, not current runtime

No `src/features/index.js` or feature registry is shipped. The following is a design sketch only,
not a description of the current runtime:

```js
// proposed future shape; not shipped
export const FEATURES = [launchpad, dex, perps, prediction];
// each: { id, routes, navEntries, enabled }
```

Rules for any separately approved future feature:
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

### Dashboard

The shipped `/dashboard` route is the wallet home: it presents the active account, available
balance/token information, navigation to wallet actions, and network state. Use
`src/ui/app/routes/dashboard.js` as the exact source for current content; do not copy sample values
or describe a planned dashboard layout as runtime behavior.

### Account switcher

The shipped Accounts route lists vault-owned accounts and their keyring association and supports the
implemented account operations. Account ordering, pinning, hiding, and switching are preferences,
not separate key material. Verify exact controls against `src/ui/app/routes/accounts.js`,
`account-detail.js`, and the background contract.

### Account detail

The shipped `/account?ref=` route shows an account avatar, label/full address with copy, editable
name, source/keyring name, seed derivation index when applicable, generated/imported provenance,
active status, an account-switch action when inactive, and an explorer link only when the selected
network has one. It offers the appropriate private-key/recovery-phrase export and backup actions,
plus account/keyring removal with the route's confirmation/password prompts. It does not currently
show a QR, balance, asset list, or activity ledger; use the shipped Receive, Dashboard, and History
routes for those surfaces. Verify exact controls against `src/ui/app/routes/account-detail.js`.

Signing requires an unlocked wallet. Password re-authentication is **off by default**; the user may enable it in Settings through password-gated `settings.setSecurity`. Secret export, password-gated keyring operations, and security-setting changes require their declared password policy. `wallet.reset` always requires explicit confirmation and additionally requires the password when the wallet is unlocked; other account operations follow their declared contract auth.

**Contract v12 owned-account activation:** `tx.registerAccount({ address })` is `auth: 'unlocked'` and is restricted in the background to the exact address in the unlocked vault. Creation/addition paths make a bounded best-effort attempt for the account just created; Send invokes it JIT only after a successful absence check for a selected/typed owned recipient. The target account self-signs with its own key and pays the declared account-creation fee of `0n` (nonce `0n`, `stateUnits` `1` — the activation requirement; `chainId` is taken from the node at build time). A zero declared fee does not mean a broadcast has no network/privacy effects. There is no periodic signer, and the sender never registers an external contact. Checked value-moving methods (`tx.sendChecked` / `token.transferChecked`) remain under `auth: 'signing'`.

### Send — a reviewed flow, never a one-click form

Shipped path, at a high level: **draft → recipient/amount validation → review → Sign & send →
submission result**. The result may be a signature/receipt, a definite failure, or an **unknown**
outcome after a bridge timeout; the UI does not claim on-chain confirmation merely because the
network accepted the transaction. Transaction simulation is unsupported and is not a Send step.

The form collects recipient (paste, recent/contact or in-wallet picker), asset, and amount, with
live recipient validation and self-transfer warning. Review shows source, friendly recipient label
when known, the **full** destination address, asset/amount, network, and fee/total according to what
is actually supported: an unknown native fee remains `unknown`, token transfer fees are explicitly
unmeasured, and a first-time token account creation discloses its additional THRU fee.

The explicit Sign & send action uses the background `auth: 'signing'` policy. An unlocked session
is sufficient by default; a password prompt appears only when the user enabled password re-auth in
Settings. The background rechecks the reviewed source account and network before value-moving
signing. See `src/ui/app/routes/send.js` and `src/background/services/tx-service.js` for exact behavior.

Before signing: validate recipient and amount, require fresh spendable balance/fee evidence,
handle account existence, re-check unlock state, prevent duplicate submission, and show the exact
reviewed effect. For an absent recipient, only a vault-owned account can use Send JIT activation;
Review remains gated until that succeeds. An offline/error response is not proof of absence. Never
silently change recipient or amount.

**Amount arithmetic is BigInt-only**, via `src/shared/format.js`. Never `parseFloat(x) * 1e9` — it
misrounds. Future DEX/swap modules must keep quote math out of UI rendering and behind tested
adapters.

Review and signing are explicit user actions. The Send route pins the reviewed source/network through
`tx.sendChecked` or `token.transferChecked` and invalidates stale review context. Do not infer that
mocked route tests establish a live broadcast or a real-Chrome focus guarantee.

### Receive

QR code · full address · copy · shortened address · account identity · network identifier ·
explorer link. Make it extremely clear which network the address is for.

### History

History is shipped as one flat card stream, with no day headers. The v12 storage-only cache is
scoped by network and address and paints before the RPC feed/pending reads finish. A containing
block time is displayed in local-calendar form only when returned by the SDK and is recorded as
`timestampSource: 'block'`. An actual local submission time may be used for the wallet's own send
when a block time is missing; otherwise the card shows `Block <slot>`. It does not borrow a date
from another entry or slot. The list has no per-card fee line; the detail sheet labels the
header-declared fee and does not claim a charged fee.

Live block-time availability/latency, live explorer routing, and any charged-fee source remain
open checks; deterministic tests do not close them. See `docs/HISTORY_REDESIGN_PLAN.md` and
`docs/MANUAL_SMOKE_CHECKLIST.md`.

### Assets

The shipped token registry, owned token balances, dashboard rows, and native/token Send paths are
implemented. Token reads distinguish proven zero from unknown/error, and token denomination comes
from verified on-chain mint decimals. `token.transferChecked` uses the reviewed account/network
context. NFTs, fiat valuation, discovery/indexing, arbitrary-program decoding, DEX/launchpad, and
prediction behavior are **not** claimed shipped. Never render a fake balance or treat editable
metadata as a protocol fact.

### Network

Network data and program configuration are owned by `src/lib/networks.js` and the background
network service. Alphanet and Localnet are enabled; Testnet and Mainnet are declared but disabled.
Contract v7 makes stored custom RPC records inert/listable/removable and rejects their activation
before the client can bind an unverified endpoint. Do not describe arbitrary custom-network support
as shipped.

### Error handling

The shipped API router normalizes failures to a code/message/retryable response and the UI maps
those failures into route-level messages. Do not claim one exhaustive typed-error taxonomy unless
it exists in the current contract/service code. Keep raw sensitive details out of user-facing copy
and do not convert an unknown result into a success or a fabricated value.

### Future modules — not shipped

The following are unshipped ideas, not interfaces currently present in `src/`:
`features/launchpad/` · `features/dex/` · `features/prediction/` · `features/nft/` ·
`features/portfolio/` · `features/dapp/`.

Thru exposes AMM bindings under `@thru/programs/amm` (pool derivation, instruction builders, swap
quoting) and a Token Program. Do not implement DEX or launchpad behaviour until those program
interfaces are verified against the target network.

**dApp connector (not shipped):** do not invent a fake `window.thru` standard. Thru's current
[Embedded Wallet Integration](https://thru.org/docs/wallet/embedded-wallet-integration/) describes
the hosted iframe at `https://app.tid.sh/embedded`; the standalone `https://wallet.tid.sh` host sends
`X-Frame-Options: DENY`. Neither defines a provider contract for an independently installed extension. That hosted flow uses `connect()` for approval/discovery,
`getSigningContext()` for managed-account versus fee-payer/signer context, and
`signTransaction()` for wallet-approved canonical raw bytes, which the dApp submits separately.
Cross-check against the official [Thru docs](https://thru.org/docs/), [API/SDK overview](https://thru.org/docs/api-ref/overview/), [`@thru/sdk`](https://thru.org/docs/sdks/web-packages/sdk/), [`@thru/programs`](https://thru.org/docs/sdks/web-packages/programs/), [gRPC API](https://thru.org/docs/api-ref/grpc/overview/), and [Explorer MCP](https://thru.org/docs/api-ref/explorer-mcp/overview/) docs. Match them to the repository's pinned versions; Explorer MCP is not automatically a stable wallet API.

Define only internal abstractions if useful. Do not implement an extension/dApp provider, inject
`window.thru`, or copy the hosted iframe protocol until Thru publishes a bring-your-own-signer or
extension-compatible contract with origin discovery, permissions, approval transport, signing
ownership, and submission semantics.

---

## Part V — Security policy

### Never

Log a mnemonic, private key, or decrypted vault. Store raw secrets in ordinary storage. Put secrets
in URL parameters, `location.hash`, router history or params, `data-*` attributes, `localStorage`,
`sessionStorage`, `window`, or analytics. Send secrets to a remote service. Expose private keys to
frontend components unnecessarily. Use a third-party crypto library where the Thru crypto layer
suffices.

### Require authentication before

Secret export, key/keyring changes, wallet reset, auto-lock/security-setting changes, and signing all
require the relevant background policy. Signing requires an unlocked vault; password re-auth is
optional and defaults off, while the security preference that enables it is password-gated. The
owned-account activation exception is documented above: it remains unlocked-only and requires an
exact ownership check before the target account self-signs.

### Secret lifetime

Keep decrypted key material in the smallest possible scope and clear it the moment it is no longer
needed. The shipped secret flows keep values out of router params, URLs, history, attributes, and
general-purpose browser storage; verify actual route-local state and cleanup before changing one.
If a future flow must cross routes, require an explicit one-shot handoff rather than encoding secrets
in navigation state.

After lock, `document.body.outerHTML` must contain no mnemonic word and no 64-hex private key.

### Storage separation

```
chrome.storage.local    encrypted vault · settings · labels · address book · preferences · scoped non-secret caches
chrome.storage.session  decrypted vault · derived key · signing material · temporary secrets
```

Never persist decrypted wallet material for convenience. Any future stored-shape change must follow
the vault's actual schema/version handling and include an idempotent test; do not assume an
unshipped `src/background/migrations/` directory exists.

### Input hardening

Seed/recovery-phrase and private-key inputs are created by route components and the shared
`src/ui/kit/field.js`, not static textareas in `popup.html`. Secret fields disable spellcheck,
autocorrect, autocapitalization, and autocomplete as appropriate. Verify actual field props in the
current route/component when changing these flows; do not repeat the obsolete claim that the shell
HTML contains the inputs.

Account labels are validated in the background vault boundary, not only by an HTML `maxlength`.

### DOM safety is structural, not a policy

The shipped DOM factory `src/ui/kit/dom.js` creates nodes and text safely. The layering guard scans
the shipped `src/` tree (vendored QR code excluded) for prohibited HTML injection sinks; the current
count is zero. The launchpad quarantine test also verifies the removed surface does not return to
the built output. Historical sink counts refer to deleted legacy code, not the current runtime.

### CSP

Target:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src <rpc origins>; frame-src 'none'; form-action 'none';
base-uri 'none'; object-src 'none'
```

The shipped policy includes `default-src 'none'` and explicit `script-src`, `style-src`, `img-src`,
`font-src`, `connect-src`, `frame-src`, `form-action`, `base-uri`, and `object-src` directives.
`connect-src` is checked by `scripts/check-csp.mjs`: every enabled network must be allowed and
no disabled or undeclared RPC origin may be authorized. Keep fonts self-hosted and do not add
remote page resources.

### Authentication hardening

Unlock throttling and inactivity-based auto-lock are enforced by background services. The alarm is
a periodic heartbeat that checks elapsed inactivity; it is not itself the configured timeout.
Changing auto-lock and security-sensitive settings follows the background password-auth policy.
Do not describe the current implementation as a fixed-period lock that ignores activity.

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

Shipped domain-free primitives under `src/ui/kit/` include the safe DOM factory, buttons, fields,
feedback, focus trapping, help tooltips, and icons. Shipped wallet-aware pieces under
`src/ui/domain/` include account rows/pickers, asset and token rows, balance/connection panels,
password prompts, the seed-phrase grid, transaction cards, and the transaction detail sheet. Use
the directory itself as the current inventory; names from the deleted UI stack are historical.

Consolidated helpers should remain shared where they actually are (`setError` in the field kit,
seed phrase grid, and account-ref helpers). Do not repeat the old duplicate-count audit as current.

### Layout rules

The shipped route/class checks compare current UI classes with CSS selectors and catch used-but-
undefined classes. Do not carry forward the old `.mt-*` / `.w-100` defect as a live state. The
separate CSS-nesting guard enforces the repository's flat-CSS rule.

### Icons

One icon system, original or properly licensed. Never Rabby's assets. Every icon: predictable size,
consistent stroke, accessibility label when interactive.

### Popup sizing

The shipped toolbar popup is 400px wide and 600px high. The side panel is user-resizable and
caps to its available width. Visual behavior at narrow/wide sizes remains a real-browser check;
there is no claim that the side panel has been certified at every size.

### Accessibility

The shipped dialogs use focus trapping and restore focus; transaction cards/detail sheets have
keyboard behavior covered by route tests. Real focus rings, zoom, contrast, reduced motion, and
actual keyboard behavior in Chrome remain on the manual checklist, not certified by the DOM shim.

### Performance budget

No end-to-end render-time or screen-transition budget is certified here. The shipped History cache
and Send form allow early UI paint before secondary RPCs; real popup timing and worker behavior
remain manual checks. Do not turn a target latency into a measured result.

---

## Part VII — Migration status

The one-stack frontend rebuild is complete: the current route stack is shipped and tested. The old
multi-stack phases are historical and must not be restarted from this document. There is no
shipped launchpad/DEX/prediction feature registry. Any new optional module is a separate proposal
and must follow `docs/MODULE_BOUNDARIES.md` without being described as implemented before it exists
in `src/`.

### Git strategy

Small commits. `refactor: introduce wallet service boundary` · `feat: add account switcher` ·
`test: add account regression suite`. Never mix a security refactor + a UI redesign + a new feature
in one commit.

---

## Part VIII — Verification

### Automated

Run `npm test` and `npm run build` on the final tree. The current test command is defined in
`package.json`; it runs the guards and integration suites under `test/` and `scripts/`, including:

- derivation vectors and QR checks;
- layering/DOM-sink, CSP, route/CSS, and CSS-nesting guards;
- launchpad quarantine, contract agreement, DOM/ref safety, and route lifecycle;
- vault, Thru client/program goldens, token balances, network-scoped balances, History cache and
  block-time, account registration, and API-router integration.

`test/test-route-lifecycle.mjs` mounts all 14 routes through the real Router, guards, bridge, and
kit using the repository's DOM shim. It asserts route behavior, secret hygiene, teardown, focus
trapping, Send races/activation, and History behavior. The shim does not contain a layout engine and
cannot certify real Chrome rendering or MV3 scheduling.

Live-chain scripts live under `scripts/` and are not part of `npm test`. A deterministic fake-SDK
registration test is not evidence of a completed live v12 activation. Likewise, mocked token-send
flows are not evidence of a live token transfer or fee measurement. See
`docs/MANUAL_SMOKE_CHECKLIST.md` for the separate browser/live-chain runbook.

### Security test matrix

| Scenario | Expected |
| --- | --- |
| wrong password / repeated wrong passwords | unlock rejected; background throttle applies |
| locked wallet during signing | request rejected by the background |
| signing password preference enabled, missing/wrong password | request rejected before handler dispatch |
| signing password preference at default | unlocked session is sufficient for signing; never describe this as password re-auth by default |
| unowned address passed to `tx.registerAccount` | rejected by background ownership check |
| stale Send account/network review | checked method rejects changed context |
| invalid recipient / insufficient funds | cannot proceed to a successful review/signing path |
| RPC failure or timeout | no false success; timeout outcome is unknown where broadcast may have occurred |
| duplicate in-flight send | duplicate request blocked by the transaction guard |
| navigation/lock during secret display | sensitive fields are cleared and no secret remains in the tested DOM |
| hostile token name | rendered as text; no element created |
| `bridge.send('constructor')` | rejected as an unknown method |

### Manual QA checklist

The canonical checklist is `docs/MANUAL_SMOKE_CHECKLIST.md`. It separates real-browser work (popup
and side panel, widths, focus, QR, navigation, worker eviction) from live-chain checks (v12
activation, token transfer owner/fee behavior, optional block times, and explorer routes). Record
which checks were actually run; do not mark them complete from `npm test` alone.

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

The blockchain layer is authoritative. Current runtime dependencies are the pinned `@thru/sdk`
(including its public `@thru/sdk/crypto` subpath) and `@thru/programs`. Prefer their verified
builders/parsers over hand-written protocol code. Do not imply `@thru/wallet` or passkey runtime
integration is included in this extension; hosted-wallet/provider and passkey work are not shipped.

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

## Part X — Open verification items

These are the remaining questions evidenced by the current implementation and test boundaries; old
questions about the native faucet amount/program layout are historical and must not be listed as
current gaps.

1. **Real-browser behavior:** popup/side-panel layout at narrow and wide sizes, real focus and QR
   rendering, mutual exclusion, and Settings' toolbar mode.
2. **MV3 lifecycle:** worker suspension/restart or bridge timeout during registration and Send,
   including the unknown outcome after a signing timeout.
3. **Live v12 activation:** account creation and Send JIT on each enabled network, with exact target
   signer and offline-versus-absent behavior.
4. **Live token transfer:** recipient-owner acceptance when the owner has never registered and the
   actual token-program fee.
5. **History live data:** optional block-time availability/latency on enabled networks, a confirmed
   explorer transaction route, and whether any authoritative charged-fee source exists outside the
   current RPC detail response.
6. **Send/pending races:** selected-network changes after the final preflight during SDK signing,
   and simultaneous pending-record storage writes.
7. **Hosted wallet boundary:** no extension dApp provider is shipped. Do not infer that the hosted
   `https://app.tid.sh/embedded` flow is an extension/BYO-signer contract.

See `docs/STATUS_AND_ROADMAP.md`, `docs/BACKEND_GAPS.md`, `docs/SEND_PATH_AUDIT.md`, and
`docs/MANUAL_SMOKE_CHECKLIST.md` for the owner and evidence type of each item.
