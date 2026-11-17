# Project Ledger — Identifiers and Contract History

Date: 2026-10-04; refreshed 2026-11-16 (contract v33, additive verified token import).
Purpose: canonical record of shipped repository identifiers and the append-only contract version history (`v5–v33`). `src/`, `test/`, and `scripts/` are authoritative; current verification status and next tasks live in `docs/STATUS_AND_ROADMAP.md`.

---

## 1. Canonical Shipped Identifiers

| Identifier | Shipped Value | Authority / Enforcing Gate |
| --- | --- | --- |
| Repository | `buildbyravi/thru-wallet-ext` | `package.json` |
| Contract version | **v33** | `CONTRACT_VERSION` in `src/shared/contract/manifest.js` (`scripts/check-docs-truth.mjs`) |
| Contract methods | **154** (`88` wallet-core + `23` `name.*` + `43` flag-off `DEFI_METHODS`) | `Object.keys(METHODS)` in `manifest.js` (`test/test-contract.mjs`, `test/test-defi-m0.mjs`) |
| Push events / Error codes | **8** `EVENTS` / **65** `ERROR_CODES` | `src/shared/contract/manifest.js` |
| Registered UI routes | **15** popup/side-panel routes | `src/ui/app/boot.js` (`scripts/check-routes.mjs`, `test/test-route-lifecycle.mjs`) |
| Transaction review kinds | **9** (`8` executable + `1` display-only `raw`) | `src/shared/tx-review/registry.js` <-> `src/background/services/review/kinds.js` (`test/test-tx-review.mjs`) |
| Runtime JS files / DOM sinks | **128** shipped JS files / **0** HTML-injection sinks | `scripts/check-layering.mjs` (vendored QR excluded) |
| Automated test suite | **41** `test/test-*.mjs` suites + **9** `scripts/check-*.mjs` guards | `package.json` `scripts.test` |
| Signing auth default | Session-only while unlocked (`requirePasswordForSigning: false`); password-per-sign is a password-gated opt-in | `docs/DECISIONS.md` D-003 (`test/test-api-router.mjs`) |
| Enabled networks | `betanet` enabled (`localnet`, `testnet`, `mainnet` declared disabled) | `src/lib/networks.js` + `scripts/check-csp.mjs` |
| Thru SDK / Program pins | `@thru/sdk` `0.4.4`, `@thru/programs` `0.4.4` (exact pins) | `package.json` (`test/test-derivation.mjs`); native-faucet no-policy behavior is tested in `test/test-native-faucet.mjs` |
| Extension / Store version | `1.4.1` (`src/manifest.json`; live on CWS since 2026-10-04; pre-v29 build) | `extension.md` |
| Build output | `dist/` (`popup.html`, `popup.css`, `popup.bundle.js`, `background.bundle.js`) | `build.mjs` (never edit `dist/` by hand) |
| Feature flags (`FLAGS`) | **11** flags in `src/shared/flags.js` — **all `false`** | `test/test-release-flags.mjs`, `test/test-launchpad-quarantine.mjs` |

Quick verification commands:

```bash
node -e "import('./src/shared/contract/manifest.js').then(m => console.log(m.CONTRACT_VERSION, Object.keys(m.METHODS).length))"
npm run build && npm test
```

---

## 2. Shipped Contract Milestones (`v5`–`v33`)

Ordinary contract evolution is strictly append-only (`Rule 4`), with documented security-hardening exceptions in `v5–v7`, `v13`, `v16`, and `v31`.

| Version | Shipped Delta |
| ---: | --- |
| **v5** | *Security break:* Existing value-moving signing methods moved in place to centralized `auth: 'signing'`. |
| **v6** | *Security break:* `wallet.reset` requires confirmation (plus password when unlocked); `system.setAutoLock` requires `auth: 'password'`. |
| **v7** | *Security break:* Custom network activation refused in background (`CUSTOM_NETWORK_DISABLED`); stale custom/disabled stored network IDs heal to `betanet` before RPC binding. |
| **v8** | Token transfer and live registry-mint balances built on official `@thru/programs/token` bindings. |
| **v9** | Cache-merged History feed (`tx.getHistoryFeed`) with cursor pagination and explicit offline/sync status. |
| **v10** | Lazy per-signature transaction detail (`tx.getDetail`) distinguishing `feeDeclaredUnits` (`feeCharged: false`) and optional block time. |
| **v11** | Checked send methods (`tx.sendChecked`, `token.transferChecked`) binding reviewed source account and network at the background boundary. |
| **v12** | Narrow `tx.registerAccount` (`auth: 'unlocked'`) self-signing exception for exact vault-owned addresses; storage-only `tx.getCachedHistory`. |
| **v13** | `tx.claimFaucet` moved from `signing` to `unlocked` (incoming testnet credit) and vestigial password param removed. |
| **v14** | `token.readMint` chain lookup verifying symbol and decimals directly from the on-chain mint account. |
| **v15** | `tx.checkDuplicate` (30s / in-flight repeat transfer detection) + `allowDuplicate` acknowledgement flag. |
| **v16** | *Security retirement:* Removed unbound legacy `tx.send` and `token.transfer` after confirming zero shipped callers (`D-010`). |
| **v17** | DeFi M0 `READ` (`21`) + `LOCAL` (`8`) contract surface (`29` methods across `program.*`, `feed.*`, `market.*`, `risk.*`, `launchpad.*`, `dex.*`, `intent.list/get`, `desktop.open`), all gated off behind `FLAGS.DEFI_* === false`. |
| **v18** | DeFi M0 `PREPARE` (`13`) + `EXECUTE` (`1`: `intent.submit`) surface (`14` methods) + `intentChanged`/`capabilitiesChanged`/`feedChanged` events and `UNSUPPORTED_REASONS` schema (`defi-schema.js`). |
| **v19** | Name-service slice (`5` methods): `name.lookup`, `name.checkAvailability`, `name.initRoot`, `name.register`, `name.setRecord`. |
| **v20** | Backed `v18` `intent.*` methods with a network-scoped `defi_intents` store proven on native send (still behind `FLAGS.DEFI_INTENT === false`). |
| **v21** | Wallet-local, network-scoped primary alias (`name.getPrimary`, `name.linkPrimary`, `name.unlinkPrimary`) verified against `name.lookup`. |
| **v22** | Official `.thru` paid registrar slice (`6` methods): `getRegistry`, `checkLease`, `getPaymentBalance`, `purchase`, `renewLease`, `claimExpired`. |
| **v23** | Ungated `name.register` (`auth: 'signing'`, first-party self-signed subdomain write) + `name.getCanonicalRoot` read (`initRoot` stays gated). |
| **v24** | `tx.getFaucetLimit` was added for a policy read, but the owner clarified the native THRU faucet has no per-account rate limit (THRUSD only). The API remains for contract compatibility and returns not applicable without a chain read. |
| **v25** | Integrated `thru-custom-registrar` (`name.getCustomRegistrar`, `name.checkCustomLease`, `via: 'custom'` + `years` on `name.register`). |
| **v26** | `token.discover` chain-verified incoming mint discovery. (Same drop briefly enabled DEX swap UI; withdrawn by owner 2026-10-26 so all `DEFI_*` flags remain `false`.) |
| **v27** | `token.getCachedBalances` (`auth: 'none'`) storage-only token balance snapshot for non-blocking Dashboard first paint. |
| **v28** | Bound reviewed `expectedNetworkId`, `expectedAccountAddress`, `expectedPriceUnits`, and `expectedExpiresAt` parameters on `name.*` writes. |
| **v29** | Shared transaction-review pipeline (`tx.prepareReview`, `tx.confirmReview`, `tx.discardReview`, all `auth: 'unlocked'`, `TX_REVIEW_VERSION = 1`, `tx_reviews` store, `TxReviewCard`, `confirm.js`). |
| **v30** | Per-network tracked domain inventory (`name.getCachedDomains`, `listDomains`, `trackDomain`, `setPrimaryDomain`, `untrackDomain`) and custom-registrar renewal (`name.renewLease` with `via: 'custom'`). |
| **v31** | *Security upgrade + append:* `name.setRecord` promoted in place to live `auth: 'signing'` write (`APPEND_RECORD` opcode 2, reviewed as kind `domain-record`, `153` methods total with new `name.reverseLookup`). |
| **v32** | **Background review consent gate (`2026-11-02`):** `tx.confirmReview` mints a single-use 60s in-memory `consentToken` (`src/background/services/review/consent.js`) bound to `{ method, sha256(canonicalParams), accountAddress, networkId }`. `api-router.js` requires and burns `consentToken` before any non-exempt `TRANSACTION_METHODS` handler runs (`REVIEW_REQUIRED`). Subsequent `2026-11-02..13` hardening on v32 added `SEND_EXPIRY_SLOTS` (`1,000` slots), `CUSTOM_RPC_SUPPORTED = false` write refusal, unified `tx-units.networkFeeUnits` on registrar/record writes, and one-surface-per-event submission feedback (`Rule 29`). |
| **v33** | **Additive verified token import (`2026-11-16`, D-026):** `token.importVerified` accepts only `mintAddress` and optional fallback `symbol` with `auth: 'unlocked'`. Dashboard routes to the existing strict mint verifier, which persists chain decimals under the captured network and rejects context changes. Legacy `token.import` remains compatible; total methods: `154`. |

---

## 3. Milestone Reporting Template

Record future contract bumps as a single row in §2 above and use the standard agent report block in `AGENTS.md` §Reporting for PR/session summaries. When `CONTRACT_VERSION`, method count, or route count changes, update `CONTEXT.md`, `docs/STATUS_AND_ROADMAP.md`, `docs/PROJECT_LEDGER.md`, `docs/AUDIT_REPORT.md`, `README.md`, and `llms.txt` in the same commit (`scripts/check-docs-truth.mjs`).
