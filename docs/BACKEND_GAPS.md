# Backend Capability Inventory and Open Gaps

**Document Class:** Authority (Implemented Backend Capabilities vs Unsupported / Unverified Boundaries)
**Baseline:** Contract **v34** (`155` methods in `src/shared/contract/manifest.js`: `88` wallet-core + `23` `name.*` + `43` dark-launched DeFi M0 methods in `src/shared/contract/defi-schema.js`)

| Tier | Scope | Status |
| --- | --- | --- |
| **A & B** | Core wallet, vault, keyring, token, history, domain, review, and consent services | `IMPLEMENTED`, `TESTED` (§1) |
| **C** | Protocol limits, live-chain measurements, browser/MV3 scheduling, external specs | Explicitly `UNSUPPORTED`, `BLOCKED`, or `UNVERIFIED` (§2) |
| **D** | Unreviewed in-place API shape mutations | Forbidden (`Rule 4`, §3) |

---

## 1. Implemented Backend Capabilities (`IMPLEMENTED`, `TESTED`)

| Capability | Backing Methods & Services |
| --- | --- |
| **Multi-keyring vault & KDF v1** | `wallet.*`, `keyring.*`, `account.*` (`src/lib/vault.js`): PBKDF2-600k + AES-256-GCM per-vault envelope, multi-seed + imported keys, HD preview/batch-add/remove, backup provenance, unlock backoff (`auth-service.js`). |
| **Non-blocking cache-first reads** | `system.bootstrap`, `tx.getCachedBalances`, `token.getCachedBalances`, `tx.getCachedHistory`, `name.getCachedDomains`: storage-only snapshots scoped by network (`src/shared/network-scope.js`), keeping proven-zero (`0`) distinct from unknown/error (`null`). |
| **v29–v32 review & consent gate** | `tx.prepareReview`, `tx.confirmReview`, `tx.discardReview` (`review-service.js`, `review/kinds.js`, `review/store.js`, `review/consent.js`): `9` review kinds, `120s` prepared review TTL, and `60s` single-use in-memory `consentToken` enforced in `api-router.js` (`REVIEW_REQUIRED`). |
| **Checked sends, deadlines & lock** | `tx.sendChecked`, `token.transferChecked`, `tx.checkDuplicate`: source account/network verification (`send-context.js`), `signing-guard.js` network-switch lock across build/sign/submit, `SEND_EXPIRY_SLOTS = 1000` on-chain expiry (`thru-client.js`), and serialized v1 `pending-tx-service.js` tracking. |
| **v12 owned-account activation** | `tx.registerAccount` (`registration-service.js`): `auth: 'unlocked'` self-signed `NOOP_PROGRAM_ADDRESS` creation (`fee: 0n`, `nonce: 0n`, `stateUnits: 1`) restricted to exact vault-owned addresses with bounded creation retries. |
| **Token Program integration** | `token.readMint`, `token.discover`, `token.getBalances`, `token.transferChecked` (`@thru/programs/token`): chain-verified mint decimals/tickers, bounded-concurrency balance reads, sender-paid recipient token-account PDA init. |
| **Domains & custom registrar** | `name.*` (`23` methods across `name-service.js`, `registrar-service.js`, `primary-name-service.js`): `.thru` custom layout-2 tiered registrar + official paid registrar, `.id` lookup, tracked domain inventory (`thru_registered_domains`), `APPEND_RECORD` (`name.setRecord`), wallet-local `name.reverseLookup`, and `tx-units.networkFeeUnits` header fees. |
| **v7 custom-RPC quarantine** | `network-service.js`: `network.setActive` accepts enabled built-ins only (`CUSTOM_NETWORK_DISABLED`), `network.upsertCustom` refuses writes (`CUSTOM_RPC_SUPPORTED = false`), and stale stored IDs self-heal to `betanet` on startup. |
| **Dark-launched DeFi M0–G3** | `43` methods across `program.*`, `feed.*`, `market.*`, `risk.*`, `launchpad.*`, `dex.*`, `intent.*`, `desktop.open` — all gated behind `FLAGS.DEFI_* === false` (`docs/defi/M0_CONTRACT_INVENTORY.md`). |

---

## 2. Unsupported, Blocked, or Open Live-Chain Boundaries

### C1. Token Program Live Semantics vs Unwired Token Fee Quote
- **Resolved on Betanet (`2026-10-23`):** `scripts/defi-evidence/2026-10-23-live-chain-run3.json` (`p3-token-transfer: PASS`, 13/13 rungs) proved on live Betanet that `createInitializeAccountInstruction` + `transferChecked` succeeds when the recipient wallet has **never registered on-chain** (`created: true`), while the recipient's native wallet remains unregistered, and observed `2` base units across init + transfer (`1` base unit per token tx).
- **Still Open in Config:** `src/lib/networks.js` has not yet promoted a dedicated `tokenFeeUnits` field, so `token-transfer` reviews continue to display the network fee honestly as `"not confirmed (paid in THRU)"` rather than borrowing the native transfer quote.

### C2. Pre-Send Fee Policy & Mainnet `autoUnits` Wiring
- Betanet native transfer fee (`baseFeeUnits: 1n`, `feeReserveUnits: 1000n`, `feeSource: 'measured'`) is configured per network in `src/lib/networks.js`; Mainnet has `baseFeeUnits: null` (`tx.estimateFee` returns `{ supported: false }`).
- **Pre-Mainnet Code Note:** Registrar and `name.setRecord` writes pass `network.baseFeeUnits` into `tx-units.networkFeeUnits`, whereas `tx-units.autoUnits` (`src/lib/tx-units.js:119`, used by native sends and token ops) currently passes `baseFeeUnits: 1n`. Before enabling Mainnet, measure Mainnet fees on-chain **and** thread `network.baseFeeUnits` into `autoUnits`.

### C2b. Charged Fee in Transaction History (`UNSUPPORTED` on Current RPC)
- `TransactionExecutionResult` exposes consumed compute/memory/state units and `vmError`, **not** a debited per-transaction fee (`Transaction.fee` echoes `header.fee`, and `StreamSlotMetricsResult.claimedFees` is a block aggregate). `tx.getDetail` therefore returns `feeDeclaredUnits` + `feeCharged: false`, rendered as **`Fee (declared)`** (`docs/guides/history-and-activity.md`). `https://scan.thru.org/api/mcp` is an LLM-only `format=toon` endpoint and cannot be used as a typed wallet API.

### C2c. Block-Time Availability & Explorer `/tx/` Deep Link
- `blocks.get({ slot })` provides optional `BlockHeader.block_time` cached per `(networkId, rpcUrl, slot)` (`timestampSource: 'block'`), falling back to own-send `submitted` time or `Block <slot>`. The explorer detail route resolved a current public Betanet transaction read-only (see the [History guide](guides/history-and-activity.md)). Live RPC block-time availability/latency and a new wallet transaction matched across submission, History and Explorer remain open.

### C3. Transaction Simulation (`UNSUPPORTED`)
- Thru exposes no verified dry-run simulation RPC. `tx.simulate` returns `{ supported: false, changes: null, reason }`, `assets.balanceAfter` is enforced `null` in `src/shared/tx-review/model.js`, and no post-transaction balance is ever predicted (`Rule 16`).

### C4. Domain Discovery, Record Semantics & Custom Registrar Deployment Gap
- **Full Domain Enumeration (`BLOCKED`):** Betanet `ListAccounts` filtered by the Name Service program owner fails with `RESOURCE_EXHAUSTED` (`2026-10-27`); `/name` uses the wallet-local tracked registry (`thru_registered_domains`), and `name.reverseLookup` resolves only within that tracked set.
- **Append-Only Records (`v31`):** `name.setRecord` encodes `APPEND_RECORD` (opcode 2), which appends without overwriting prior keys (`DELETE_RECORD` is unprobed), has no UI caller yet, and is `UNVERIFIED` on live Betanet.
- **Custom Registrar `.bin` & Fee Collection (`Release Blocker #1`):** Checked-in `thru-custom-registrar.bin` (`29,416` B, `sha256 4c5095e1…7bd515`, compiled with `link.x.in` and `0xD112` canonical-PDA enforcement) was deployed to Betanet on `2026-11-18` (`registrar-deploy-betanet-thru-1795038501279.json`, `feePolicy: "best-effort"`, `collectionProbe.measured: false`); probing `0xD112` rejection, measuring a treasury balance delta across live `Register` and `Renew`, and note that custom-lease expired-claim does not exist in the contract ABI (`docs/guides/domains-and-registrar.md`).

### C5. Extension dApp Provider (`UNSUPPORTED` / `BLOCKED`)
- Official `@thru/wallet` connects web apps to the hosted iframe `https://app.tid.sh/embedded` (`https://wallet.tid.sh` sends `X-Frame-Options: DENY`). Neither defines a browser-extension provider standard. No `window.thru`, `content_scripts`, or `externally_connectable` surface is shipped.

---

## 3. Contract Compatibility Policy (`Rule 4`)

New features append methods to `src/shared/contract/manifest.js` and `src/background/api-router.js` (`test/test-contract.mjs` checks two-way parity). Existing parameter/return shapes are never mutated in place except documented security-hardening upgrades (`v5` signing auth, `v6` reset/auto-lock password gates, `v7` custom-RPC quarantine, `v13` faucet auth, `v16` unbound-send retirement, `v31` `name.setRecord` promotion to `auth: 'signing'`, and `v32` router `consentToken` enforcement).
