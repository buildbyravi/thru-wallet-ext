# CONTEXT.md — file map for thru-wallet-ext

Last source-backed update: 2026-09-26. Line counts are a snapshot, not an implementation contract; verify `src/` before editing.

Read `AGENTS.md` first for repository rules, then `docs/STATUS_AND_ROADMAP.md` for the shipped baseline and open checks. `docs/DEFECT_LOG.md` preserves historical failures with explicit status labels.

## Shipped baseline at a glance

- Contract v12: **81 methods** in `src/shared/contract/manifest.js`; 14 registered wallet routes.
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
| Change encryption, keyrings, or account derivation | `src/lib/vault.js` |
| Change RPC, transaction construction, or wire decoding | `src/lib/thru-client.js` |
| Change enabled networks/program configuration | `src/lib/networks.js`, then network service/CSP together |
| Decide whether data is network-scoped | `src/shared/network-scope.js` |
| Change amount parsing/formatting | `src/shared/format.js` |
| Change opaque account URL references | `src/shared/refs.js` |
| Change History cache/time behavior | `src/background/services/history-service.js`, `tx-service.js`, `src/ui/app/routes/history.js` |
| Change Send activation/review | `src/ui/app/routes/send.js`, registration service, contract/router |
| Change popup/side-panel context behavior | `src/shared/side-panel.js`, `src/ui/app/side-panel-exclusion.js`, `src/background/index.js` |
| Change permissions/CSP | `src/manifest.json`, `scripts/check-csp.mjs` |
| Check a live chain | `scripts/verify-*.mjs` (manual, never part of `npm test`) |
| Check actual Chrome rendering | `docs/MANUAL_SMOKE_CHECKLIST.md` |

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

The popup entry `src/popup/popup.js` is a boot stub. The removed legacy screens are only recoverable from Git history. Although `boot.js` accepts an optional fallback callback, the shipped popup does not supply one.

## 3. Build and automated verification

`package.json` defines the exact test sequence. Current suites include:

| Test / guard | Coverage |
| --- | --- |
| `test/test-derivation.mjs` | Pinned SDK derivation vectors (16 checks). |
| `test/test-qr.mjs` | QR generation/encoding (15 checks). |
| `scripts/check-layering.mjs` | Import boundaries and DOM-sink scan (70 files; zero sinks in the audited run). |
| `scripts/check-csp.mjs` | Enabled-network/CSP consistency. |
| `scripts/check-routes.mjs` | Route registration/reachability (14/14) and used CSS classes. |
| `scripts/check-css-nesting.mjs` | Flat-CSS guard. |
| `test/test-launchpad-quarantine.mjs` | Deleted launchpad/DEX/prediction surface remains out of source and `dist/` (47 checks). |
| `test/test-contract.mjs` | Manifest/router/UI agreement and security invariants (77 checks). |
| `test/test-ui-dom.mjs` | DOM safety and reference codec (130 checks). |
| `test/test-route-lifecycle.mjs` | All routes through Router/guards/bridge, teardown, secrets, focus, Send, History, panel behavior (904 checks). |
| `test/test-vault.mjs`, `test/test-thru-client.mjs` | Vault/SDK integration, instruction and decoder behavior. |
| `test/test-token-balances.mjs`, `test/test-balance-network.mjs` | Token denomination, proven-zero/unknown, network-scoped reads/caches. |
| `test/test-history-cache.mjs`, `test/test-history-block-time.mjs` | Cache-first History, timestamp provenance, network/slot isolation, races, paging. |
| `test/test-registration.mjs` | Owned-account registration policy and bounded retries with deterministic SDK fixtures. |
| `test/test-api-router.mjs` | Auth, context, serialization, background dispatch, and send/registration integration. |

These counts are the audited run's counts; use the final test output for any subsequent refresh. They are deterministic/local evidence only. Real-browser and live-chain checks are separate.

## 4. `src/lib/` — vault and Thru client

Change these only for verified bugs or intentional, tested behavior.

### `src/lib/vault.js` — 778 lines

Encrypted vault, keyring model, seed/private-key handling, HD account derivation, and password verification against the encrypted blob. Seed keyrings store generated/imported provenance and backup state. Decrypted vault/key material is held in the trusted session store, not ordinary local storage.

### `src/lib/thru-client.js` — 1,178 lines

RPC binding, native/token transactions, history decoding/detail, and official Thru program/SDK adapters. Token derivation and token instructions use the pinned `@thru/programs/token` package. The current deployed UI has no launchpad/deploy surface. The current RPC detail path distinguishes a header-declared fee from a charged fee, which the response does not provide.

### `src/lib/networks.js` — 195 lines

Network/program configuration. Alphanet and Localnet are enabled; Testnet and Mainnet are declared but disabled. Custom RPC records cannot be activated under the v7 quarantine. Fee values are network-specific; do not transfer a native fee observation to token sends.

## 5. `src/background/` — worker and services

| File | Lines | Purpose |
| --- | ---: | --- |
| `index.js` | 112 | Message listener, trusted session storage, auto-lock heartbeat, side-panel preference restore |
| `api-router.js` | 337 | Contract allowlist, auth enforcement, dispatch, error/JSON normalization |
| `services/wallet-service.js` | 207 | Wallet lifecycle, unlock backoff, export, creation registration |
| `services/keyring-service.js` | 101 | Multi-seed operations and creation-bound registration |
| `services/account-service.js` | 181 | Account/HD operations, preferences, registration for new accounts |
| `services/tx-service.js` | 519 | Faucet, native/token sends, History/detail, validation, fee estimate |
| `services/token-service.js` | 386 | Token registry, deploy handler, derivation, visibility, balances, transfers |
| `services/balance-service.js` | 218 | Batched/cached balances, network-scoped |
| `services/pending-tx-service.js` | 285 | Submission/reconciliation state and badge, network-scoped |
| `services/registration-service.js` | 135 | Exact owned-account self-registration; bounded creation retry, no periodic signing |
| `services/history-service.js` | 194 | Storage-only per-network/address read, RPC feed merge, block-time provenance, serialized writes |
| `services/preferences-service.js` | 224 | Account order/pin/hide, whitelist, security/display preferences |
| `services/network-service.js` | 266 | Built-in network activation, custom-record quarantine, SDK client binding |
| `services/contacts-service.js` | 82 | Address book |
| `services/auth-service.js` | 99 | Persisted unlock throttle/backoff |
| `services/system-service.js` | 189 | Inactivity auto-lock, activity, diagnostics |
| `services/event-service.js` | 47 | Background push events |

Registration is not a background sweep: creation/addition makes a bounded best-effort attempt for the newly added account; Send has a targeted JIT path for an owned recipient; Dashboard may use the existing active-account creation path after a successful absence check. Every registration is a real signed broadcast, even though the transaction declares zero fee.

## 6. `src/shared/` — both sides

No DOM or `chrome.*` access. Contract v12 has **81 methods**. Security-policy exceptions are documented: v5 signing auth, v6 reset/auto-lock hardening, and v7 custom-network quarantine. v8–v11 add token, History/detail, and checked-send capabilities; v12 adds `tx.registerAccount` and `tx.getCachedHistory`.

| File | Lines | Purpose |
| --- | ---: | --- |
| `contract/manifest.js` | 638 | UI/background contract allowlist and method metadata |
| `format.js` | 82 | BigInt-safe amount formatting/parsing |
| `refs.js` | 104 | Opaque account references and equality |
| `network-scope.js` | 89 | Network-scoped vs global storage keys |
| `flags.js` | 65 | Current runtime flags; no launchpad flag |
| `autolock.js` | 36 | Shared auto-lock constants/helpers |
| `side-panel.js` | 17 | Side-panel context marker/action |

Network-specific balances, pending transactions, token state, and History are kept separate by network where applicable. Vault keys, account labels, and contacts are global wallet/device state.

## 7. `src/ui/` — route UI

### Kit and domain components

`src/ui/kit/`: `dom.js` (285), `icon.js` (194), `button.js` (171), `field.js` (193), `feedback.js` (124), `focus-trap.js` (189), `help-tooltip.js` (68).

`src/ui/domain/`: account-avatar (60), account-row (151), account-picker (147), asset-selector (148), balance-hero (56), current-connection (118), panel-item (56), password-prompt (139), seed-phrase-grid (160), token-row (133), tx-card (238), tx-detail-sheet (308).

### Router and route files

`bridge.js` (158), `router.js` (175), `guards.js` (138), `boot.js` (260), `shell.js` (147), `side-panel-exclusion.js` (62).

| Route | File | Lines |
| --- | --- | ---: |
| `/welcome` | `routes/welcome.js` | 295 |
| `/unlock` | `routes/unlock.js` | 191 |
| `/dashboard` | `routes/dashboard.js` | 501 |
| `/accounts` | `routes/accounts.js` | 195 |
| `/account?ref=` | `routes/account-detail.js` | 302 |
| `/add-account` | `routes/add-account.js` | 392 |
| `/keyring?id=` | `routes/keyring.js` | 190 |
| `/export?ref=` | `routes/export.js` | 279 |
| `/send` | `routes/send.js` | 1,203 |
| `/receive` | `routes/receive.js` | 177 |
| `/faucet` | `routes/faucet.js` | 252 |
| `/history` | `routes/history.js` | 392 |
| `/settings` | `routes/settings.js` | 458 |
| `/reset` | `routes/reset.js` | 169 |

Route lifecycle tests use a DOM shim; they do not establish actual rendered geometry, real Chrome focus behavior, or MV3 scheduling.

## 8. `src/popup/` — shared popup/side-panel shell

| File | Lines | Notes |
| --- | ---: | --- |
| `popup.js` | 49 | Boot stub into `src/ui/app/boot.js` |
| `popup.html` | 30 | Single `#app` shell |
| `qr.js` | 130 | Canvas QR renderer |
| `theme.js` | 48 | Theme selection/storage |

The manifest panel path uses `popup.html?thru_panel=1`. On popup boot, the close listener is registered before async theme/bootstrap work; the popup broadcasts for compatibility and uses Chrome's direct close API when available. The Dashboard button explicitly opens the panel; Settings' Side Panel Mode is a separate opt-in for toolbar behavior and is restored by the worker only when enabled. Actual browser interaction is still open in `docs/MANUAL_SMOKE_CHECKLIST.md`.

`src/popup/styles/` totals **4,197 lines**: `tokens.css` 219, `base.css` 137, `utilities.css` 195, `components.css` 1,810, `kit.css` 426, `screens.css` 1,410. Import order is in `src/popup/popup.css`.

## 9. Launchpad quarantine — not a shipped feature

`src/launchpad/` is deleted. Its former page, flags, dashboard entry point, icons/toast helpers, and build entry are gone. `test/test-launchpad-quarantine.mjs` keeps the surface out of source/build output. Backend `token.*` methods do not imply a launchpad/deploy UI exists.

## 10. Manifest and remaining verification boundaries

`src/manifest.json` is MV3. Popup and side panel share the page; permissions include storage, alarms, sidePanel, and clipboardRead. CSP is explicit and `scripts/check-csp.mjs` checks enabled RPC origins.

Open work not settled by automated tests/builds: real popup/side-panel layout, focus, QR and mutual exclusion; MV3 restart/timeout during registration or Send; live v12 registration; live token-transfer owner/fee behavior; current block-time availability/latency; charged-fee source and explorer-route confirmation; signing network-switch race; concurrent pending-record write race. See `docs/STATUS_AND_ROADMAP.md`, `docs/SEND_PATH_AUDIT.md`, and `docs/MANUAL_SMOKE_CHECKLIST.md`.

## 11. Traps

1. **Reload the extension, not just the popup.** UI and service-worker bundles both change.
2. **Money is BigInt internally and a string on the wire.** The message port is JSON.
3. **The build warns on CSS syntax errors.** Read the full output for warnings.
4. **Do not ship a control before its destination route exists.** `scripts/check-routes.mjs` enforces route reachability.
5. **A test can assert a bug.** Verify expectations against the source/protocol rather than preserving an old fixture by habit.
6. **Faucet and Send units differ.** Historical Alphanet evidence says faucet input is raw base units; Send is human-scale THRU. Do not generalize that observation to token fees.
7. **Account existence is network-specific.** Creation attempts registration for new owned accounts; Send may JIT-activate an absent owned recipient. An external recipient must activate itself, and an offline lookup is not proof of absence.
8. **Never hand-roll a program instruction** where the pinned official Thru bindings provide it.
9. **`chrome.storage.session` holds unlocked session material.** Browser persistence/eviction behavior is a manual verification boundary.
