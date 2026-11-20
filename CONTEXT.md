# CONTEXT.md — File Map for `thru-wallet-ext`

Last source-verified update: 2026-11-19 (Contract **v33**, `154` methods, `15` routes, `9` review kinds, `128` runtime JS files, `41` test suites + `9` guard scripts). Always verify `src/` directly before editing.

Read `AGENTS.md` first for repository rules, `docs/DOCS_INDEX.md` for the SSoT map, and `docs/STATUS_AND_ROADMAP.md` for shipped state and open verification gates.

For former documentation paths, use `docs/DOCS_INDEX.md` section 3.4 to find the current guide section. Dated audit citations are historical evidence, not current behavior or fresh verification.

---

## Shipped Baseline at a Glance

- Contract **v33**: **154 methods** in `src/shared/contract/manifest.js` (`88` wallet-core methods + `23` `name.*` domain/registrar methods + `43` DeFi M0 methods in `src/shared/contract/defi-schema.js` whose build-time flags in `src/shared/flags.js` are all `false`); **15** registered routes in `src/ui/app/boot.js`.
- **One transaction-review and background-consent pipeline (`v29`–`v32`).** Every value-moving screen (native send, token transfer, domain register/purchase/renew/claim, faucet claim — plus contract-level `domain-record`) prepares through `tx.prepareReview`, renders `src/ui/domain/tx-review/review-card.js`, and submits through `src/ui/domain/tx-review/confirm.js` -> `tx.confirmReview` -> the operation's existing handler. `tx.confirmReview` re-validates facts/context and mints a single-use 60s `consentToken` (`src/background/services/review/consent.js`) that `api-router.js` requires before any value-moving handler executes (`REVIEW_REQUIRED`). Undecodable transactions (`raw`) have `submit: null` and cannot be signed. Details: `docs/guides/transaction-review.md`.
- **Signing & Activation.** Signing requires an unlocked wallet (`requirePasswordForSigning: false` by default; password-per-sign is a password-gated Settings opt-in, `D-003`). `tx.registerAccount` (`auth: 'unlocked'`) self-signs (`NOOP_PROGRAM_ADDRESS`, fee `0n`, nonce `0n`, `stateUnits: 1`) only for an exact vault-owned address at creation, on `/dashboard`, or JIT on `/send` (never external addresses).
- **Domains (`/name`).** Two tabs (`Register` and `My Domains`), `.thru`-only registration/renewal preferring the deployed `thru-custom-registrar` (tiered layout-2 config on Betanet) with official paid-registry fallback, `.id` resolution-only lookup, tracked per-network domain inventory (`thru_registered_domains`), and header fees derived via `tx-units.networkFeeUnits`. Details: `docs/guides/domains-and-registrar.md`.
- **History (`/history`).** Flat transaction stream without date sections; cache-first `tx.getCachedHistory` scoped by network + address; provenance-tagged timestamps (`block` -> own `submitted` -> `Block <slot>`); lazy `tx.getDetail` sheet reporting `Fee (declared)` (`feeCharged: false`). Details: `docs/guides/history-and-activity.md`.
- **Popup & Side Panel.** Shared `popup.html` (`popup.html?thru_panel=1` in side panel) with synchronous close-listener registration and mutual exclusion. Side Panel Mode is an explicit Settings opt-in.
- **Quarantined / Unshipped Surfaces.** `src/launchpad/` is deleted and quarantined (`test/test-launchpad-quarantine.mjs`). `src/features/` does not exist yet. No extension `window.thru` dApp provider exists. Planned specs live in `docs/roadmap/FUTURE_ROADMAP.md`.

---

## 1. Quick Lookup ("Where Do I Look?")

| Task | Authoritative File(s) |
| --- | --- |
| Change or inspect a UI screen | `src/ui/app/routes/*.js` (registered in `src/ui/app/boot.js`) |
| Build DOM nodes safely | `src/ui/kit/dom.js` (`h()`); HTML-string sinks are banned across `src/` |
| Add a UI/background API method | `src/shared/contract/manifest.js` + `src/background/api-router.js` + service |
| Add/modify a DeFi M0 method | `manifest.js` + `src/shared/contract/defi-schema.js` + handler + `test/fixtures/defi/` + `test/test-defi-m0.mjs` |
| Update DeFi capability/registry seeds | `scripts/defi-evidence/betanet.{registry-seed,capability-matrix}.json` + `src/background/services/defi/capability-snapshot.js` |
| Check build-time feature flags | `src/shared/flags.js` (`11` flags, all `false`; pinned by `test/test-release-flags.mjs`) |
| Vault encryption, keyrings, HD derivation | `src/lib/vault.js` *(sacred — Rule 2)* |
| Thru RPC, transfers, tokens, History decode | `src/lib/thru-client.js` *(sacred — Rule 2)* |
| Transaction compute/state units & header fee | `src/lib/tx-units.js` (`autoUnits`, `networkFeeUnits`) |
| Network & program configuration | `src/lib/networks.js` + `src/lib/bootstrap-pins.js` + `scripts/check-csp.mjs` |
| Global vs network-scoped storage keys | `src/shared/network-scope.js` (`11` `GLOBAL_KEYS`, `9` `SCOPED_KEYS`) |
| BigInt amount formatting & address shortening | `src/shared/format.js` (`formatThru`, `parseThruAmount`, `formatTokenAmount`, `shortenMiddle`, `shortAddress`) |
| Opaque account URL references | `src/shared/refs.js` |
| Notifications (`toast`) vs screen state (`Banner`) | `src/ui/kit/toast.js` (events, `Rule 26` & `Rule 29`) / `src/ui/kit/feedback.js` (persistent state) |
| Copy-to-clipboard button | `src/ui/kit/button.js` (`CopyButton`; `/receive` owns its inline `"Copied"` box) |
| Add/change a transaction review kind | `src/shared/tx-review/decoders/` + `decoders/index.js` + `src/background/services/review/kinds.js` |
| Review validation, TTL, error codes | `src/shared/tx-review/model.js` |
| Review card UI / confirm & consent flow | `src/ui/domain/tx-review/review-card.js` + `confirm.js` + `src/background/services/review/{consent,store}.js` |
| Custom `.thru` registrar contract & JS ABI | `contracts/thru-custom-registrar/` + `src/lib/custom-registrar.js` + `src/background/services/registrar-service.js` |
| Popup/side-panel context & mutual exclusion | `src/shared/side-panel.js` + `src/ui/app/side-panel-exclusion.js` + `src/background/index.js` |
| Extension permissions & CSP | `src/manifest.json` + `scripts/check-csp.mjs` |
| Browser visual harnesses & QA runbook | `scripts/preview-*.html` + `docs/MANUAL_SMOKE_CHECKLIST.md` |
| Chrome Web Store listing copy | `extension.md` |

---

## 2. Dependency Direction

```text
src/ui/app/routes/*
  -> src/ui/app/bridge.js (sole UI outbound sendMessage owner)
  -> src/shared/contract/manifest.js (v33, 154 methods, 8 push events, 65 error codes)
  -> src/background/api-router.js (auth, v32 consentToken gate, signing-guard, JSON check)
  -> src/background/services/* (+ services/review/*, services/defi/*, features/{dex,launchpad}/*)
  -> src/lib/* (sole @thru/sdk & @thru/programs leaf layer)
```

Enforced by `scripts/check-layering.mjs` (`128` runtime JS files scanned, `0` DOM-injection sinks) and `scripts/check-cycles.mjs` (`1` known ratcheted cycle across `history-service`, `name-service`, `pending-tx-service`, `token-service`, `tx-service`).

---

## 3. Build, Guards, and Test Suites (`package.json`)

`npm test` runs **9 guard scripts** (`scripts/check-*.mjs`) and **41 test suites** (`test/test-*.mjs`) — every guard and suite on disk:

| Guard / Suite Group | Files | What It Enforces |
| --- | --- | --- |
| **Structural Guards (`9`)** | `scripts/check-{layering,agents,cycles,docs-truth,check-controls,csp,routes,css-nesting,panel-tiles}.mjs` | Import direction, 0 DOM sinks, 30 ordered `AGENTS.md` rules + path existence, cycle ratchet, doc-count parity, guard negative controls, CSP <-> enabled networks, 15/15 route reachability + CSS class definitions, flat CSS, Dashboard 6-tile geometry. |
| **Crypto, Contract & Quarantine** | `test-{derivation,qr,launchpad-quarantine,contract,signing-surface,release-flags,security-checks}.mjs` | `@thru/sdk@0.5.2` golden derivation vectors, QR canvas encoding, deleted launchpad absence in `src/` & `dist/`, manifest <-> router <-> UI agreement, signing parameter enumeration, all `FLAGS === false`, password validation. |
| **Review, Consent & UI Lifecycle** | `test-{tx-review,tx-review-card,review-lifecycle,review-consent,ui-dom,toast,shared-platform,route-lifecycle}.mjs` | All 9 review decoders/kinds, row/block budgets, forbidden-vocabulary scan, lock/switch discard, v32 `REVIEW_REQUIRED` router token gate, safe `h()` DOM, `toast()`/`Banner()` rules, 1,133-check mount/teardown/secret sweep across all 15 routes. |
| **Vault, Client, Tokens & History** | `test-{storage-migrations,vault,thru-client,tx-units,native-faucet,token-balances,balance-network,history-cache,history-block-time,registration,api-router,autolock}.mjs` | Schema v0->v1 migrations & fail-closed future versions, V2 multi-keyring vault, EOA/token/detail wire goldens, `autoUnits`/`networkFeeUnits`, native-faucet no-policy behavior, network-scoped caches, block-time provenance, v12 self-registration, router auth/serialization, inactivity auto-lock. |
| **Domains & Dark-Launched DeFi** | `test-{name-service,name-registrar,name-custom-registrar,custom-registrar,name-primary,name-records,name-reverse,name-ui,defi-m0,defi-registry,defi-feed,defi-market,defi-intent,dex-swap}.mjs` | Name Service & official/custom registrar byte goldens, tiered pricing, SDK sorted-account sentinel, tracked domain registry, opcode-2 record append, reverse lookup, DeFi M0 schema/seed parity, B3 genesis binding, signed feeds, market cache, intents, AMM swap quotes. |

Visual harnesses (served via `node scripts/serve-dist.mjs --root . --port 8000`): `scripts/preview-tx-review.html` (`9` fixtures in `scripts/preview-tx-review.fixtures.js`, including 1 synthetic failed-simulation fixture), `scripts/preview-toast.html` (`preview-toast-frame.html`), and `scripts/preview-tx-sheet.html`.

---

## 4. `src/lib/` — Infrastructure & Protocol Leaf (`11` files)

| File | Lines | Purpose |
| --- | ---: | --- |
| `vault.js` | 805 | Encrypted vault (PBKDF2 600k + AES-256-GCM, v1 KDF envelope), multi-seed & imported keyrings, HD derivation |
| `thru-client.js` | 1,435 | Thru RPC binding, EOA/NOOP/faucet/token instructions (`SEND_EXPIRY_SLOTS = 1000`), History decoding, `getTransactionDetail` |
| `networks.js` | 234 | Network/program config (`betanet` enabled; `localnet`, `testnet`, `mainnet` disabled) |
| `bootstrap-pins.js` | 11 | Canonical program address re-exports from `@thru/programs` & `@thru/sdk` |
| `tx-units.js` | 140 | Resource-unit floors/scaling (`autoUnits`, `payloadFloor`) and header fee policy (`networkFeeUnits`) |
| `custom-registrar.js` | 537 | `thru-custom-registrar` ABI v2 builders, layout-1/2 config & lease parsers, tiered `pricePerYearFor` |
| `name-service.js` | 328 | Official Name Service PDA derivations (`rootRegistrarAddress`), `initRoot`/`register`/`APPEND_RECORD` codecs |
| `registrar.js` | 237 | Official `.thru` paid registrar config/lease parsers and `purchase`/`renewLease`/`claimExpired` builders |
| `amm.js` | 186 | `@thru/programs/amm` pool derivation, state parser, and `quoteAmmSwapExactIn` |
| `feed-crypto.js` | 22 | Ed25519 `SignatureDomain.MSG` signature verifier for signed feed records |

---

## 5. `src/background/` — MV3 Service Worker & Services (`45` files)

| File | Lines | Purpose |
| --- | ---: | --- |
| `index.js` | 140 | Message listener, `chrome.storage.session` bridge, auto-lock alarm, side-panel preference restore, startup lock review discard |
| `api-router.js` | 622 | Contract allowlist, auth matrix, v32 `consentToken` gate (`CONSENT_EXEMPT`), `signing-guard`, JSON response check |
| `services/wallet-service.js` | 285 | Vault create/import/unlock/lock/export/reset, review/token discard on lock, creation registration |
| `services/keyring-service.js` | 101 | Multi-seed/private-key keyring CRUD and backup state |
| `services/account-service.js` | 192 | Active account, HD preview/batch add/remove, labels, order/pin/hide |
| `services/tx-service.js` | 748 | Account info, legacy not-applicable faucet-policy response/claim, checked native send, History feed/detail, fee estimate, duplicate check |
| `services/token-service.js` | 626 | Token registry, mint read, incoming discovery, cached/live balances, checked token transfer |
| `services/balance-service.js` | 218 | Network-scoped batched/cached native balances |
| `services/pending-tx-service.js` | 392 | Serialized per-network pending-tx tracking, `{ startSlot, expiryAfter }`, badge & reconciliation |
| `services/registration-service.js` | 135 | Exact vault-owned self-registration (`NOOP_PROGRAM_ADDRESS`) with bounded creation retries |
| `services/history-service.js` | 415 | Network+address-scoped History cache, RPC feed merge, `(networkId, rpcUrl, slot)` block-time enrichment |
| `services/preferences-service.js` | 288 | Versioned preferences, account display prefs, password-gated security settings |
| `services/network-service.js` | 292 | Built-in network activation, v7 custom-RPC quarantine & `CUSTOM_RPC_SUPPORTED = false` write refusal |
| `services/contacts-service.js` | 93 | Versioned address book |
| `services/auth-service.js` | 99 | Persisted unlock failure throttle/backoff |
| `services/system-service.js` | 192 | Bootstrap, inactivity auto-lock clock, diagnostics |
| `services/event-service.js` | 67 | Inbound UI push-event broadcaster (`8` declared event names) |
| `services/icon-service.js` | 28 | Plain toolbar icon sync |
| `services/signing-guard.js` | 39 | Freezes active-network mutation across signing/submission |
| `services/send-context.js` | 25 | Checked-send source account & network assertion |
| `services/review-service.js` | 387 | `tx.prepareReview`, `tx.confirmReview` (mints `consentToken`), `tx.discardReview` |
| `services/review/consent.js` | 135 | v32 in-memory single-use 32-byte `consentToken` store (`60s` TTL, cap `40`) |
| `services/review/kinds.js` | 1,111 | Fact builders, recheck handlers, and submit-method map for all `9` review kinds |
| `services/review/store.js` | 132 | Serialized per-network `tx_reviews` store (`120s` TTL, cap `40`) |
| `services/registrar-service.js` | 819 | Official `.thru` & custom registrar reads/writes, tiered pricing, `networkFeeUnits` |
| `services/name-service.js` | 584 | Name lookups, availability, canonical root, `name.register`, `name.setRecord`, `name.reverseLookup` |
| `services/primary-name-service.js` | 379 | Network-scoped primary alias (`thru_primary_names`) & tracked domain registry (`thru_registered_domains`) |
| `services/{dex,intent,registry,market,risk,feed,program,desktop}-service.js` | 1,720 | Dark-launched DeFi M0–G3 services (`dex` 728, `intent` 345, `registry` 328, `market` 141, `risk` 98, `feed` 30, `program` 30, `desktop` 20) |
| `services/defi/{capability-snapshot,feed-record,gating,intent-store,market-reads,read-cache}.js` | 959 | DeFi snapshot (`346`), signed feeds (`194`), flag/capability gate (`90`), intent store (`87`), market slices (`152`), coalescing cache (`90`) |
| `features/dex/{dex-handlers,dex-service}.js` & `features/launchpad/{launchpad-handlers,launchpad-service}.js` | 231 | Feature-isolated DeFi backend handler seams (`FLAGS.DEFI === false`) |

---

## 6. `src/shared/` — Isomorphic Contract & Models (`20` files)

Contract **v33** has **154 methods** (`72` `none`, `60` `unlocked`, `12` `password`, `10` `signing`), `8` push events, and `65` error codes. No DOM or `chrome.*` APIs allowed.

| File | Lines | Purpose |
| --- | ---: | --- |
| `contract/manifest.js` | 1,339 | `CONTRACT_VERSION = 33`, `METHODS` (`154`), `EVENTS` (`8`), `ERROR_CODES` (`65`) |
| `contract/defi-schema.js` | 459 | Machine schema for the `43` `DEFI_METHODS` and `24` `UNSUPPORTED_REASONS` |
| `format.js` | 130 | BigInt-exact `THRU` (`9` decimals) & token amount formatting/parsing; `shortenMiddle` / `shortAddress` |
| `refs.js` | 104 | Opaque `{ keyringId, accountIndex }` codec for URLs |
| `network-scope.js` | 104 | `GLOBAL_KEYS` (`11`) and `SCOPED_KEYS` (`9`) registry + `scopedKey()` |
| `flags.js` | 72 | Build-time `FLAGS` (`11` keys, all `false`; only `DEBUG_ROUTING` accepts `?debug=1`) |
| `security-checks.js` | 184 | Shared password/security validation |
| `autolock.js` / `side-panel.js` / `tokens.js` | 66 | Auto-lock constants (`36`), `?thru_panel=1` marker (`17`), `NATIVE_TOKEN` 9-decimal constant (`13`) |
| `tx-review/model.js` | 369 | `TX_REVIEW_VERSION = 1` wire validator, `120s` TTL, and single review error-code registry |
| `tx-review/registry.js` | 67 | Strict decoder registry (`9` kinds, no fallback) |
| `tx-review/decoders/{common,native-send,token-transfer,domain,domain-record,faucet-claim,raw,index}.js` | 1,381 | Pure facts -> `TxReviewCard` content decoders for all `9` review kinds |

---

## 7. `src/ui/` (`49` files) and `src/popup/` (`13` files)

- **`src/ui/kit/` (`9` files):** `dom.js` (285), `toast.js` (293), `icon.js` (241), `field.js` (194), `focus-trap.js` (189), `button.js` (171), `feedback.js` (147), `sheet.js` (119), `help-tooltip.js` (68).
- **`src/ui/domain/` (`18` files):** `token-drawer.js` (484), `tx-review/review-card.js` (448), `tx-detail-sheet.js` (311), `tx-card.js` (244), `tx-review/confirm.js` (206), `security-sheet.js` (186), `password-prompt.js` (160), `seed-phrase-grid.js` (160), `account-picker.js` (155), `account-row.js` (151), `asset-selector.js` (136), `token-row.js` (123), `current-connection.js` (118), `balance-hero.js` (111), `account-avatar.js` (61), `panel-item.js` (57), `token-avatar.js` (49), `fresh-phrase.js` (33).
- **`src/ui/app/` (`6` core + `16` route files):** `boot.js` (264), `router.js` (175), `shell.js` (171), `bridge.js` (158), `guards.js` (138), `side-panel-exclusion.js` (62).

| Route | File (`src/ui/app/routes/`) | Lines | Guard |
| --- | --- | ---: | --- |
| `/welcome` | `welcome.js` | 337 | `requireNoWallet` |
| `/unlock` | `unlock.js` | 192 | `requireVault` |
| `/dashboard` | `dashboard.js` | 584 | `requireUnlocked` |
| `/accounts` | `accounts.js` | 226 | `requireUnlocked` |
| `/account?ref=` | `account-detail.js` | 323 | `requireUnlocked` |
| `/add-account` | `add-account.js` | 438 | `requireUnlocked` |
| `/keyring?id=` | `keyring.js` | 203 | `requireUnlocked` |
| `/export?ref=` | `export.js` | 361 | `requireUnlocked` |
| `/send` | `send.js` | 1,292 | `requireUnlocked` |
| `/receive` | `receive.js` | 179 | `requireUnlocked` |
| `/faucet` | `faucet.js` | 477 | `requireUnlocked` |
| `/name` | `name.js` (+ `name-providers.js`) | 1,329 (+12) | `requireUnlocked` |
| `/history` | `history.js` | 455 | `requireUnlocked` |
| `/settings` | `settings.js` | 533 | `requireUnlocked` |
| `/reset` | `reset.js` | 174 | `requireVault` |

- **`src/popup/`:** `popup.html` (30), `popup.js` (49), `qr.js` (130), `theme.js` (45), `popup.css` (9), `vendor/qrcode-generator.js` (2,290), and `styles/*.css` (**5,075 lines** across `tokens.css` 221, `base.css` 137, `utilities.css` 195, `components.css` 1,915, `kit.css` 426, `screens.css` 1,742, `overlays.css` 439).
