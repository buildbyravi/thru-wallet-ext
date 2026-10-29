# CONTEXT.md — file map for thru-wallet-ext

Last source-backed update: 2026-10-29 (contract v31, name-service record write + reverse lookup on top of v30's tracked domains). Line counts are a snapshot, not an implementation contract; verify `src/` before editing.

Read `AGENTS.md` first for repository rules, then `docs/STATUS_AND_ROADMAP.md` for the shipped baseline and open checks. `docs/DEFECT_LOG.md` preserves historical failures with explicit status labels.

## Shipped baseline at a glance

- Contract **v31**: **153 methods** in `src/shared/contract/manifest.js` (81 wallet-core + 43 DeFi M0 surface whose flags are all off + the v19–v31 additive slices, v29 being the review pipeline, v30 the tracked-domain registry and v31 the name-service record write + reverse lookup; machine schema in `src/shared/contract/defi-schema.js` for the DeFi half); **15** registered wallet routes.
- **One transaction-review pipeline.** Every value-moving screen (native send, token transfer, domain register/purchase/renew/claim, faucet claim) prepares through `tx.prepareReview`, renders `src/ui/domain/tx-review/review-card.js`, and submits through `confirm.js` → `tx.confirmReview` → the operation's existing signing method. `confirmReview` never signs: it re-validates and returns the submit instructions, and it refuses any review whose persisted state is not `ready` (a blocking warning, or a simulation that ran and failed). No UI route signs a value-moving transaction directly (the v12 JIT `tx.registerAccount` activation call in `send.js` is the only direct signing call); an undecodable transaction renders as explicit unknown and cannot be signed.
- Signing requires an unlocked wallet. Password re-authentication defaults off and is an explicit, password-gated Settings opt-in.
- `tx.registerAccount` self-signs only for an exact vault-owned address. Account/keyring creation paths make bounded, best-effort registration attempts for new addresses. Send JIT-activates only a selected/typed owned recipient after an on-chain absence check; it never registers an external contact. Review waits for activation and shows the matched label above the full address.
- History is a flat stream without day headers. It paints storage-only cached entries scoped by network and address before fresh feed/pending reads. Block-time provenance is retained; an actual local submission time is only an own-send fallback; otherwise display `Block <slot>`. No per-card fee line is shipped.
- Popup and side panel share `popup.html`; a context marker and mutual-exclusion path are implemented. Side Panel Mode is an explicit opt-in. Real Chrome behavior remains a manual check.
- Launchpad/DEX/prediction UI and an extension dApp provider are not shipped. The launchpad tree is quarantined by tests.

## 1. Where to look

| I need to | Go to |
| --- | --- |
| Change a screen | `src/ui/app/routes/` |
| Create DOM safely | `src/ui/kit/dom.js` (`h()`); never HTML strings |
| Add/change a UI/background API method | `src/shared/contract/manifest.js`, then `src/background/api-router.js` and its service |
| Add/change a DeFi contract method | `src/shared/contract/manifest.js` + `src/shared/contract/defi-schema.js`, handler (service or `src/background/features/<feature>/`), fixtures in `test/fixtures/defi/`, then `test/test-defi-m0.mjs` |
| Change DeFi capability facts | `scripts/defi-evidence/` seeds (evidence protocol) → mirror into `src/background/services/defi/capability-snapshot.js`; `test/test-defi-m0.mjs` pins the two |
| Change registry records/derivation or genesis binding | `src/background/services/registry-service.js` (+ `SEED_FINGERPRINT` in the snapshot; `test/test-defi-registry.mjs` proves B3) |
| Change feed records, publishers, or kill-switch policy | `src/background/services/defi/feed-record.js` + `FEED_POLICY` in the capability snapshot (evidence-pinned only; `test/test-defi-feed.mjs` proves narrowing) |
| Change market read caching or slice assembly | `src/background/services/defi/read-cache.js` + `market-reads.js` (chain-before-index; `test/test-defi-market.mjs` proves cache + ladders) |
| Change a DeFi feature flag | `src/shared/flags.js` (build-time only, no URL/storage override; reviewed ship decision) |
| Change encryption, keyrings, or account derivation | `src/lib/vault.js` |
| Change RPC, transaction construction, or wire decoding | `src/lib/thru-client.js` |
| Change enabled networks/program configuration | `src/lib/networks.js`, then network service/CSP together |
| Decide whether data is network-scoped | `src/shared/network-scope.js` |
| Change amount parsing/formatting | `src/shared/format.js` |
| Change opaque account URL references | `src/shared/refs.js` |
| Change History cache/time behavior | `src/background/services/history-service.js`, `tx-service.js`, `src/ui/app/routes/history.js` |
| Change Send activation/form | `src/ui/app/routes/send.js`, registration service, contract/router |
| Change what a transaction review looks like | `src/shared/tx-review/decoders/<kind>.js` (content) and `src/ui/domain/tx-review/review-card.js` (layout) |
| Add a new value-moving operation | decoder in `src/shared/tx-review/decoders/` + registration in `decoders/index.js`, kind spec in `src/background/services/review/kinds.js`, then a route that calls `tx.prepareReview` |
| Change review validation, TTL or error codes | `src/shared/tx-review/model.js` |
| Change the confirm/submit or password step | `src/ui/domain/tx-review/confirm.js` + `src/background/services/review-service.js` |
| Change popup/side-panel context behavior | `src/shared/side-panel.js`, `src/ui/app/side-panel-exclusion.js`, `src/background/index.js` |
| Change permissions/CSP | `src/manifest.json`, `scripts/check-csp.mjs` |
| Check a live chain | `scripts/verify-*.mjs` (manual, never part of `npm test`) |
| Check actual Chrome rendering | `docs/MANUAL_SMOKE_CHECKLIST.md` |
| Update the Chrome Web Store listing | `extension.md` (listing copy + justifications; edit there, then mirror to the dashboard) |

## 2. Architecture and boundaries

```text
src/ui/app/routes
  → src/ui/app/bridge.js
  → src/shared/contract/manifest.js
  → src/background/api-router.js
  → src/background/services
  → src/lib/vault.js / src/lib/thru-client.js / src/lib/networks.js
```

`src/ui/app/bridge.js` is the outbound message seam; `src/background/services/event-service.js` is the inbound push-event source. `scripts/check-layering.mjs` enforces import boundaries and zero prohibited DOM-injection sinks across shipped `src/` (vendored QR code excluded). `scripts/check-routes.mjs` guards route reachability and CSS classes; `scripts/check-css-nesting.mjs` enforces flat CSS.

The popup entry `src/popup/popup.js` is a boot stub. The removed legacy screens are only recoverable from Git history; `boot()` takes only a mount root — the migration-era fallback callback is deleted, and an unknown hash redirects to the router's fallback.

## 3. Build and automated verification

`package.json` defines the exact test sequence. Current suites include:

| Test / guard | Coverage |
| --- | --- |
| `test/test-derivation.mjs` | Pinned SDK derivation vectors (16 checks). |
| `test/test-qr.mjs` | QR generation/encoding (15 checks). |
| `scripts/check-layering.mjs` | Import boundaries and DOM-sink scan (126 files; zero sinks). |
| `scripts/check-csp.mjs` | Enabled-network/CSP consistency. |
| `scripts/check-routes.mjs` | Route registration/reachability (15/15) and used CSS classes (257, all defined). |
| `scripts/check-css-nesting.mjs` | Flat-CSS guard. |
| `scripts/check-panel-tiles.mjs` | Dashboard action/services tile size and grid consistency. |
| `test/test-launchpad-quarantine.mjs` | Deleted launchpad/DEX/prediction surface remains out of source and `dist/` (66 checks). |
| `test/test-contract.mjs` | Manifest/router/UI agreement and security invariants, v31 / 153 methods (168 checks). |
| `test/test-ui-dom.mjs` | DOM safety and reference codec. |
| `test/test-route-lifecycle.mjs` | All 15 routes through Router/guards/bridge, teardown, secrets, focus, Send/Domain/Faucet review flows, Dashboard activation, History, panel behavior (1,104 checks). |
| `test/test-tx-review.mjs` | The review pipeline: registry↔kind parity, every decoder, malformed and unknown input, amount/fee formatting, binding/TTL/account/network refusals, acknowledgements, blocking, discard, the central error-code registry, and the UI signing-literal scan and the one-screen/compactness guards (143 checks). |
| `test/test-vault.mjs`, `test/test-thru-client.mjs` | Vault/SDK integration, instruction and decoder behavior. |
| `test/test-token-balances.mjs`, `test/test-balance-network.mjs` | Token denomination, proven-zero/unknown, network-scoped reads/caches. |
| `test/test-history-cache.mjs`, `test/test-history-block-time.mjs` | Cache-first History, timestamp provenance, network/slot isolation, races, paging. |
| `test/test-registration.mjs` | Owned-account registration policy and bounded retries with deterministic SDK fixtures. |
| `test/test-api-router.mjs` | Auth, context, serialization, background dispatch, and send/registration integration. |

The suite is **2,405 checks across 34 test suites plus 5 build gates** (2026-10-29). Use the final test output for any subsequent refresh. They are deterministic/local evidence only. Real-browser and live-chain checks are separate.

Visual harness: `scripts/preview-tx-review.html` renders the real `TxReviewCard` with the real built
`dist/popup.css` for eight fixtures (`scripts/preview-tx-review.fixtures.js`), served by
`node scripts/serve-dist.mjs --root . --port 8000`. It is a layout aid, not a test: there is no
browser binary in CI, so no layout assertion is automated. One fixture is SYNTHETIC (a simulation
rejection — Thru has no dry-run RPC, so no node returns one today); it exists to keep the card's
four simulation words honest. The human runbook is
`docs/MANUAL_SMOKE_CHECKLIST.md` §7.

## 4. `src/lib/` — vault and Thru client

Change these only for verified bugs or intentional, tested behavior.

### `src/lib/vault.js` — 795 lines

Encrypted vault, keyring model, seed/private-key handling, HD account derivation, and password verification against the encrypted blob. Seed keyrings store generated/imported provenance and backup state. Decrypted vault/key material is held in the trusted session store, not ordinary local storage.

### `src/lib/thru-client.js` — 1,404 lines

RPC binding, native/token transactions, history decoding/detail, and official Thru program/SDK adapters. Token derivation and token instructions use the pinned `@thru/programs/token` package. The current deployed UI has no launchpad/deploy surface. The current RPC detail path distinguishes a header-declared fee from a charged fee, which the response does not provide.

### `src/lib/networks.js` — 234 lines

Network/program configuration. Betanet is enabled; Localnet, Testnet and Mainnet are declared but disabled (tests re-enable Localnet in-process). Custom RPC records cannot be activated under the v7 quarantine. Fee values are network-specific; do not transfer a native fee observation to token sends.

## 5. `src/background/` — worker and services

| File | Lines | Purpose |
| --- | ---: | --- |
| `index.js` | 129 | Message listener, trusted session storage, auto-lock heartbeat, side-panel preference restore |
| `api-router.js` | 500 | Contract allowlist, auth enforcement, dispatch, error/JSON normalization |
| `services/wallet-service.js` | 207 | Wallet lifecycle, unlock backoff, export, creation registration |
| `services/keyring-service.js` | 101 | Multi-seed operations and creation-bound registration |
| `services/account-service.js` | 192 | Account/HD operations, preferences, registration for new accounts |
| `services/tx-service.js` | 686 | Faucet, native/token sends, History/detail, validation, fee estimate |
| `services/token-service.js` | 555 | Token registry, deploy handler, derivation, visibility, balances, transfers |
| `services/balance-service.js` | 218 | Batched/cached balances, network-scoped |
| `services/pending-tx-service.js` | 386 | Submission/reconciliation state and badge, network-scoped |
| `services/registration-service.js` | 135 | Exact owned-account self-registration; bounded creation retry, no periodic signing |
| `services/history-service.js` | 415 | Storage-only per-network/address read, RPC feed merge, block-time provenance, serialized writes |
| `services/preferences-service.js` | 288 | Account order/pin/hide, whitelist, security/display preferences |
| `services/network-service.js` | 270 | Built-in network activation, custom-record quarantine, SDK client binding |
| `services/contacts-service.js` | 93 | Address book |
| `services/auth-service.js` | 99 | Persisted unlock throttle/backoff |
| `services/system-service.js` | 192 | Inactivity auto-lock, activity, diagnostics |
| `services/event-service.js` | 67 | Background push events |
| `services/review-service.js` | 344 | v29 review pipeline: `prepareReview` / `confirmReview` / `discardReview`; binding hash, TTL, rechecks. Never signs |
| `services/review/kinds.js` | 727 | The ONLY kind → facts + recheck + existing-submit-method table (8 kinds) |
| `services/review/store.js` | 113 | Network-scoped prepared-review records (`tx_reviews`), schema v1, TTL on read, cap 40 |
| `services/registrar-service.js` | 625 | Official `.thru` registry reads/writes and the custom-registrar provider |
| `services/name-service.js` | 368 | Name-service lookups, availability, canonical root |
| `services/primary-name-service.js` | 142 | Wallet-local, network-scoped primary name (links only after an owner match) |
| `services/signing-guard.js` | 39 | Blocks network rebinding from operation entry through submission |
| `services/send-context.js` | 25 | Checked-send account/network binding |
| `services/dex-service.js` | 728 | DeFi M0 DEX surface (quotes/pools/prepared intents); refuses unless `DEFI_*` flags are on |
| `services/intent-service.js` | 345 | M0 intent store/pipeline (native-send bound); still behind `DEFI_INTENT` |
| `services/registry-service.js` | 328 | Program/token/market registry reads (capability-gated) |
| `services/market-service.js` | 141 | Market reads, capability-gated |
| `services/risk-service.js` | 98 | Asset risk reads derived from registry facts |
| `services/feed-service.js` | 30 | Signed-feed reads; no verified publisher, so answers empty/null |
| `services/program-service.js` | 30 | Program discovery reads (capability snapshot) |
| `services/desktop-service.js` | 20 | `desktop.open`; no Desktop page exists, answers `{enabled:false}` |
| `services/icon-service.js` | 28 | Keeps the plain toolbar icon in sync with lock state |

Registration is not a background sweep: creation/addition makes a bounded best-effort attempt for the newly added account; Send has a targeted JIT path for an owned recipient; Dashboard activates the active account through the same `tx.registerAccount` path after a successful absence check (never the signing-gated `tx.autoCreateAccount`). Every registration is a real signed broadcast, even though the transaction declares zero fee.

## 6. `src/shared/` — both sides

No DOM or `chrome.*` access. Contract **v31** has **153 methods**. Security-policy exceptions are documented: v5 signing auth, v6 reset/auto-lock hardening, and v7 custom-network quarantine. v8–v15 add token, History/detail, checked-send, registration, cached-History, mint-read, and duplicate-check capabilities; v16 retires the unbound legacy send methods after zero shipped callers were confirmed; v17/v18 append the 43-method DeFi M0 surface (READ+LOCAL, PREPARE+EXECUTE), every feature behind build-time flags that are all false; v19 adds the gated name-service slice (`name.lookup` / `checkAvailability` / `initRoot` / `register` / `setRecord`); v20 backs the intent methods with a real native-send pipeline (still flag-off); v21 adds the wallet-local primary name; v22 the official `.thru` registrar (read + purchase/renew/claim); v23 makes `name.register` a real first-party self-signed write; v24 adds the faucet rate-limit read; v25 adds the custom registrar provider; v26 token auto-discovery; v27 the storage-only cached token balances; v28 reviewed price/expiry facts on the name writes; **v29 the shared review pipeline** (`tx.prepareReview` / `tx.confirmReview` / `tx.discardReview`, all `auth:'unlocked'`, none of which signs); v30 the tracked-domain registry and `via:'custom'` renewal; **v31 the live name-service record write** (`name.setRecord`, `auth:'signing'`, reviewed as kind `domain-record`) plus `name.reverseLookup`. Every version is a pure append.

| File | Lines | Purpose |
| --- | ---: | --- |
| `contract/manifest.js` | 1,308 | UI/background contract allowlist and method metadata |
| `contract/defi-schema.js` | 456 | Machine-readable sibling schema for the 43-method DeFi M0 surface, kept coherent by `test/test-defi-m0.mjs` |
| `format.js` | 98 | BigInt-safe amount formatting/parsing, including the one `formatAssetAmount` scale rule |
| `refs.js` | 104 | Opaque account references and equality |
| `network-scope.js` | 103 | Network-scoped vs global storage keys (includes `tx_reviews`) |
| `flags.js` | 72 | Build-time flags; every `DEFI_*` and `NAME_SERVICE` flag is false |
| `autolock.js` | 36 | Shared auto-lock constants/helpers |
| `side-panel.js` | 17 | Side-panel context marker/action |
| `security-checks.js` | 184 | Shared password/security validation used by Settings and the router |
| `tokens.js` | 13 | `NATIVE_TOKEN`: THRU, 9 decimals (the scale `format.js` and every decoder use) |
| `tx-review/model.js` | 349 | The review wire contract, strict validator, TTL, and the ONE error-code registry |
| `tx-review/registry.js` | 75 | Decoder registry; no fallback, duplicate registration throws |
| `tx-review/decoders/*` | 1,151 | `common`, `native-send`, `token-transfer`, `domain`, `faucet-claim`, `raw`, `index` — pure facts → content |

Network-specific balances, pending transactions, token state, and History are kept separate by network where applicable. Vault keys, account labels, and contacts are global wallet/device state.

## 7. `src/ui/` — route UI

### Kit and domain components

`src/ui/kit/`: `dom.js` (285), `icon.js` (241), `button.js` (171), `field.js` (193), `feedback.js` (124), `focus-trap.js` (189), `help-tooltip.js` (68), `sheet.js` (117), `toast.js` (145).

`src/ui/domain/`: account-avatar (60), account-row (151), account-picker (155), asset-selector (136), balance-hero (111), current-connection (118), fresh-phrase (33), panel-item (57), password-prompt (153), seed-phrase-grid (160), token-avatar (49), token-row (123), token-drawer (483), tx-card (243), tx-detail-sheet (311), security-sheet (186), and `tx-review/`: `review-card.js` (380 — the one review surface) + `confirm.js` (148 — the one confirm→auth→submit path).

### Router and route files

`bridge.js` (158), `router.js` (175), `guards.js` (138), `boot.js` (252), `shell.js` (171), `side-panel-exclusion.js` (62).

| Route | File | Lines |
| --- | --- | ---: |
| `/welcome` | `routes/welcome.js` | 337 |
| `/unlock` | `routes/unlock.js` | 192 |
| `/dashboard` | `routes/dashboard.js` | 578 |
| `/accounts` | `routes/accounts.js` | 226 |
| `/account?ref=` | `routes/account-detail.js` | 323 |
| `/add-account` | `routes/add-account.js` | 438 |
| `/keyring?id=` | `routes/keyring.js` | 203 |
| `/export?ref=` | `routes/export.js` | 361 |
| `/send` | `routes/send.js` | 1,206 |
| `/receive` | `routes/receive.js` | 179 |
| `/faucet` | `routes/faucet.js` | 462 |
| `/name` | `routes/name.js` (+ `name-providers.js`) | 883 (+12) |
| `/history` | `routes/history.js` | 455 |
| `/settings` | `routes/settings.js` | 533 |
| `/reset` | `routes/reset.js` | 174 |

Route lifecycle tests use a DOM shim; they do not establish actual rendered geometry, real Chrome focus behavior, or MV3 scheduling.

## 8. `src/popup/` — shared popup/side-panel shell

| File | Lines | Notes |
| --- | ---: | --- |
| `popup.js` | 49 | Boot stub into `src/ui/app/boot.js` |
| `popup.html` | 30 | Single `#app` shell |
| `qr.js` | 130 | Canvas QR renderer |
| `theme.js` | 48 | Theme selection/storage |

The manifest panel path uses `popup.html?thru_panel=1`. On popup boot, the close listener is registered before async theme/bootstrap work; the popup broadcasts for compatibility and uses Chrome's direct close API when available. The Dashboard button explicitly opens the panel; Settings' Side Panel Mode is a separate opt-in for toolbar behavior and is restored by the worker only when enabled. Actual browser interaction is still open in `docs/MANUAL_SMOKE_CHECKLIST.md`.

`src/popup/styles/` totals **4,877 lines**: `tokens.css` 221, `base.css` 137, `utilities.css` 195, `components.css` 1,889, `kit.css` 426, `screens.css` 1,574, `overlays.css` 435. Import order is in `src/popup/popup.css`.

## 9. Launchpad quarantine — not a shipped feature

`src/launchpad/` is deleted. Its former page, flags, dashboard entry point, icons/toast helpers, and build entry are gone. `test/test-launchpad-quarantine.mjs` keeps the surface out of source/build output. Backend `token.*` methods do not imply a launchpad/deploy UI exists.

## 10. Manifest and remaining verification boundaries

`src/manifest.json` is MV3. Popup and side panel share the page; permissions are storage, alarms, sidePanel, clipboardRead, notifications. There is no content script, `externally_connectable` entry or web-accessible resource, so the build exposes no dapp provider. CSP is explicit and `scripts/check-csp.mjs` checks enabled RPC origins.

Open work not settled by automated tests/builds: real popup/side-panel layout, focus, QR and mutual exclusion (including the v29 review card: 408px/380px/720px in the harness, and the real 400px popup); MV3 restart/timeout during registration, Send or a review; live v12 account registration; live token-transfer owner/fee behavior; current block-time availability/latency; charged-fee source and explorer-route confirmation; signing network-switch race; concurrent pending-record write race; live `.thru` register/renew/claim behaviour; transaction simulation (Thru has no verified dry-run RPC, so the review always declares it unavailable). See `docs/STATUS_AND_ROADMAP.md`, `docs/SEND_PATH_AUDIT.md`, `docs/TX_REVIEW_VERIFICATION.md`, and `docs/MANUAL_SMOKE_CHECKLIST.md`.

## 11. Traps

1. **Reload the extension, not just the popup.** UI and service-worker bundles both change.
2. **Money is BigInt internally and a string on the wire.** The message port is JSON.
3. **The build warns on CSS syntax errors.** Read the full output for warnings.
4. **Do not ship a control before its destination route exists.** `scripts/check-routes.mjs` enforces route reachability.
5. **A test can assert a bug.** Verify expectations against the source/protocol rather than preserving an old fixture by habit.
6. **Faucet and Send units differ.** Historical Alphanet evidence (the pre-betanet testnet) says faucet input is raw base units; Send is human-scale THRU. Do not generalize that observation to token fees.
7. **Account existence is network-specific.** Creation attempts registration for new owned accounts; Dashboard and Send activate through the same v12 `tx.registerAccount` path (never `tx.autoCreateAccount`, which is signing-gated). An external recipient must activate itself, and an offline lookup is not proof of absence.
8. **Never hand-roll a program instruction** where the pinned official Thru bindings provide it.
9. **`chrome.storage.session` holds unlocked session material.** Browser persistence/eviction behavior is a manual verification boundary.
10. **A feature must not re-derive review confirmability.** `TxReviewCard` fires `onChange({ canConfirm })` from its constructor; a caller that instead listens for DOM `change` events or recreates the validation duplicates the component and gets it wrong. Declare the confirm control first, let the card drive it.
11. **A review is single-use.** A successful submit discards it, so a replay answers `REVIEW_NOT_FOUND` (classified stale). A definite failure keeps it on purpose.
12. **An undecodable transaction has no submit policy.** Do not "helpfully" wire a signing method behind the `raw` decoder; that reverses the one guarantee the pipeline makes.
