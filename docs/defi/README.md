# DeFi Backend Workstream — Architecture and Gate Status

**Document Class:** Operational Verification & Dark-Launched Backend Spec (`PARTIALLY IMPLEMENTED` in backend; **ALL `FLAGS.DEFI_* === false` — ZERO UI SHIPPED**)
**Baseline:** Contract **v33** (`43` DeFi methods in `DEFI_METHODS`, `src/shared/contract/defi-schema.js`)
**Related Authorities:** `AGENTS.md` (Rules 5, 16, 19, 25, 28) · `docs/DECISIONS.md` (D-005, D-012, D-021) · `docs/MODULE_BOUNDARIES.md` · `docs/roadmap/FUTURE_ROADMAP.md` (§3)

---

## 1. Current Gate Status (All Runtime Flags OFF)

Every `DEFI*` flag in `src/shared/flags.js` (`DEFI`, `DEFI_READ`, `DEFI_DEX`, `DEFI_LAUNCHPAD`, `DEFI_MARKET`, `DEFI_RISK`, `DEFI_INTENT`, `DEFI_FEED`, `DEFI_DESKTOP`) is **`false`** (`test/test-release-flags.mjs`). No DeFi UI exists in `src/ui/` or `dist/` (`test/test-launchpad-quarantine.mjs`).

| Gate | Scope | Status | Verification Evidence |
| --- | --- | --- | --- |
| **G0** | Protocol dossier, 19-role registry seed, capability seed | **CLOSED** (owner direction, 2026-10-05) | `docs/defi/DOSSIER_AND_CAPABILITIES.md`, `scripts/defi-evidence/` |
| **M0** | 43-method contract (`v17` READ+LOCAL, `v18` PREPARE+EXECUTE), schema, fixtures | **CLOSED** (owner sign-off, 2026-10-05) | `test/test-defi-m0.mjs` (schema <-> manifest <-> seed <-> router parity) |
| **G1** | Registry + stateless B3 genesis binding, signed feed records, coalescing market read cache | **CLOSED** (owner sign-off, 2026-10-06) | `test/test-defi-registry.mjs`, `test/test-defi-feed.mjs`, `test/test-defi-market.mjs` |
| **G2-S0** | Intent store & lifecycle proven on native send (`v20`, flag-off) | **IMPLEMENTED / TESTED** (flag off) | `test/test-defi-intent.mjs` |
| **G2** | Mint-only launch pipeline (`launchpad.*`) | **PLANNED / GATED** | Live P3 token-transfer passed (`2026-10-23-live-chain-run3.json`); `launchMint` seed promotion & Q11 authority policy pending |
| **G3** | AMM pool reads, constant-product quotes, `dex.prepareSwap` (`dex-service.js`) | **IMPLEMENTED / TESTED** (flag off; brief v26 UI enablement withdrawn same day by owner, 2026-10-26) | `test/test-dex-swap.mjs`; live Betanet AMM pool + swap verified in `2026-10-25-live-swap-probe.json` |
| **G4–G6** | Liquidity add/withdraw (exit-first R2), curve/migration, indexer scale | **PLANNED / BLOCKED** | No curve program on Betanet (`role=curve` null); no public indexer (`NO_INDEXER`) |

---

## 2. Implemented Backend Architecture (Flag-Off)

### 2.1 Capability Snapshot & Stateless Genesis Binding (`G1-A`)
- **Files:** `src/background/services/defi/capability-snapshot.js`, `src/background/services/registry-service.js`, `src/background/services/program-service.js`.
- `program.list` returns **19** `ProgramRecord` entries (`18` canonical bootstrap roles from `@thru/programs@0.5.2` + `curve: null`). `program.capabilities` derives per-feature `{ state, reason }` via `deriveFeatureState` precedence (`CUSTOM_NETWORK` -> `NETWORK_MISMATCH` -> `NETWORK_RESET` -> `KILL_SWITCH` -> `FEED_STALE`/`FEED_QUORUM_FAILED` -> dossier seed) in `src/background/services/defi/gating.js`.
- **B3 Genesis Binding:** Static `SEED_FINGERPRINT` (`chainFingerprint('betanet')`) binds cached records to the network's genesis identity; a genesis reset invalidates records, caches, and prepared intents with `NETWORK_RESET`.

### 2.2 Signed Off-Chain Feed Verification (`G1-B`)
- **Files:** `src/background/services/defi/feed-record.js`, `src/lib/feed-crypto.js`, `src/background/services/feed-service.js`.
- Verifies `SignedFeedRecord` (`FEED_RECORD_VERSION = 1`) envelopes under domain-separated Ed25519 `SignatureDomain.MSG` (`0x01 || canonicalJson`, non-replayable as transactions) in strict order (`MALFORMED` -> `NETWORK_MISMATCH` -> `GENESIS_MISMATCH` -> `PUBLISHER_UNPINNED` -> `SIGNATURE_INVALID` -> `RECORD_STALE` -> `VALID`), with one-publisher-one-vote quorum (`INERT | NO_FEEDS | QUORUM_NOT_MET | LIVE`) against `FEED_POLICY`. Feeds are **narrowing-only** (`ops: { kill: string[] }`). Because no publisher key is pinned today, `feed.status` / `feed.lookup` return empty/`FEED_MISSING` states cleanly.

### 2.3 Coalescing Read Cache & Market Slices (`G1-C`)
- **Files:** `src/background/services/defi/read-cache.js`, `src/background/services/defi/market-reads.js`, `src/background/services/market-service.js`, `src/background/services/risk-service.js`.
- `createReadCache` (`maxEntries = 256` FIFO, errors never cached) deduplicates concurrent in-flight reads per `(networkId, fingerprint, method, canonicalParams)` and drops cross-network replies. All `21` DeFi `R` methods sit in `SYNC_READ_METHODS` so background polling never resets auto-lock. `market-reads.js` enforces chain-before-index slice ladders; `candles`, `trades`, and `holders` return `{ supported: false, reason: 'NO_INDEXER' }`.

### 2.4 Intent Store, Preferences & AMM Swap Service (`G2-S0` & `G3`)
- **Files:** `src/background/services/defi/intent-store.js`, `src/background/services/intent-service.js`, `src/background/services/dex-service.js`, `src/background/features/dex/`, `src/background/features/launchpad/`, `src/lib/amm.js`.
- `preferences-service.js` already schemas DeFi preference keys (`defiSlippageBps`, `defiLoadImages`, `defiShowUnverified`, `defiNotifications`, `defiTosAcceptedVersion`, `defiRiskAckVersion`, plus password-gated `defiAlwaysRequirePassword`).
- `dex-service.js` implements `dex.listPools`, `dex.getPool`, `dex.positions`, `dex.quote` (`quoteAmmSwapExactIn`, `15s` TTL), and `dex.prepareSwap` when `DEFI` + `DEFI_READ` / `DEFI_DEX` are enabled in tests. Liquidity addition remains gated behind live `withdrawLiquidity` verification ("exit before entry").

---

## 3. Mandatory Pre-Enablement Guards Before Flipping Any `DEFI_*` Flag

Before any `DEFI_*` flag may be proposed for enablement (`Rule 25`), the following backend items must be resolved and tested:

1. **Converge Signing onto Contract v29/v32 Review Consent (`Rule 16` & `Rule 28`):** Register DeFi review decoders in `src/shared/tx-review/` + `src/background/services/review/kinds.js` and require a `tx.confirmReview` one-time `consentToken` rather than leaving `intent.submit` as a separate `CONSENT_EXEMPT` execution lifecycle.
2. **Intent-Store & Outcome Hardening:** Ensure per-network single-flight write serialization on `defi_intents`, preserve `unknown` timeout outcomes (`result?.signature` string/object normalization) with chain lookup before `rePrepare`.
3. **AMM Slippage, Quotes & Output Token Account Guards:** Reject `minOut === 0n` (`ZERO_BOUND`, because `@thru/programs/amm` treats `0` as unlimited slippage), reconcile `MAX_SLIPPAGE_BPS = 1000` (`10%` enforced in `dex-service.js` for standard/popup flows) with `SNAPSHOT.LIMITS.slippageMaxBps = 2000` (`20%` Desktop-advanced-only seed proposal) into one authoritative constant without silently raising popup slippage, add `>= 12` edge-case quote vectors (`Q19`), and prepend `createInitializeAccountInstruction` when the buyer lacks an output token account.
4. **Flags & Feed Hardening (`A9`, `A10`, `uploadImage`):** Freeze `FLAGS` in `src/shared/flags.js` (separating `?debug=1` routing inspection from the flag map), add monotonic per-publisher sequence numbers (`seq`) on `SignedFeedRecord` updates (`feed-record.js`), and reject `image/svg+xml` in `defi-schema.js` before enabling `launchpad.uploadImage`.

---

## 4. Directory Map

| File | Responsibility |
| --- | --- |
| `docs/defi/README.md` | This architecture overview, gate status, and pre-enablement checklist. |
| `docs/defi/DOSSIER_AND_CAPABILITIES.md` | Betanet protocol dossier (`P1–P5`, `Q1–Q26`), 19-role registry seed, capability matrix, and live evidence reconciliation. |
| `docs/defi/M0_CONTRACT_INVENTORY.md` | Exact 43-method DeFi contract table (`READ`, `LOCAL`, `PREPARE`, `EXECUTE`), gates, handlers, and fixture rules. |
