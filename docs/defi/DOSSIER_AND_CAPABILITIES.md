# Betanet Protocol Dossier and Capability Matrix

**Document Class:** Operational Verification (Protocol Evidence & Seed Reference)
**Machine-Readable Seeds:** `scripts/defi-evidence/betanet.registry-seed.json` · `scripts/defi-evidence/betanet.capability-matrix.json` · `src/background/services/defi/capability-snapshot.js` (coherence enforced by `test/test-defi-m0.mjs`)

---

## 1. Preconditions (`P1–P5`) — Current Evidence State

| ID | Precondition | Current State | Evidence Artifact |
| --- | --- | --- | --- |
| **P1** | Exact SDK/program pins & reproducible offline surface | **VERIFIED** (`@thru/sdk@0.4.2`, `@thru/programs@0.4.2`) | `package.json`, `test/test-derivation.mjs`, `scripts/collect-offline-evidence.mjs` |
| **P2** | Network-scoped state & genesis-reset invalidation | **IMPLEMENTED / TESTED** | `src/shared/network-scope.js`, `src/background/services/registry-service.js` (`test/test-defi-registry.mjs`) |
| **P3** | End-to-end live Token Program verification (mint, sender-created recipient token account for never-registered wallet, transfer, fee) | **VERIFIED AGAINST LIVE NETWORK (2026-10-23)** *(seed promotion for `launchMint` still pending)* | `scripts/defi-evidence/2026-10-23-live-chain-run3.json` (`p3-token-transfer: PASS` — 13/13 rungs passed with pre-funded Betanet sender; recipient token account created for unregistered owner; 2 base units observed across init + transfer). *Note:* Earlier Oct 6–8 `vmError -765/-767` faucet failures were traced on 2026-10-09 to `@thru/sdk@0.4.1` zeroing default compute/state units, fixed in `src/lib/tx-units.js` (`autoUnits`), with faucet per-claim cap confirmed at `10,000` base units in `2026-10-24-faucet-cap.json`. |
| **P4** | Live AMM program deployment, pool layout, quote parity & swap execution | **VERIFIED AGAINST LIVE NETWORK (2026-10-25)** *(withdraw-LP live probe still open)* | `scripts/defi-evidence/2026-10-25-live-swap-probe.json` (mints `AMMA`/`AMMB`, pool `taBm41ie...`, add liquidity, exact-in swap `vmError: 0`, `56,105 CU`). `swap` and `pools` graduated to `enabled` in `betanet.capability-matrix.json` (still gated off at runtime by `FLAGS.DEFI === false`). |
| **P5** | One centralized review & signing boundary | **IMPLEMENTED / TESTED** for wallet core (`v29`–`v32`); DeFi `intent.submit` convergence required before flag enablement | `docs/guides/transaction-review.md`, `test/test-review-consent.mjs` |

---

## 2. Key Dossier Findings (`Q1–Q26` Summary)

| Area | Questions | Verified Fact / Current Disposition |
| --- | --- | --- |
| **Transactions & Atomicity** | `Q1–Q4` | Single top-level program call per transaction unless routed through `multicall` (`taMULTIrOL8...`, unverified live). Header requires explicit `computeUnits`, `memoryUnits`, `stateUnits`, `fee` (`src/lib/tx-units.js`) and `expiryAfter` (`SEND_EXPIRY_SLOTS = 1000`). |
| **Simulation & Charged Fees** | `Q5–Q6` | No dry-run simulation RPC exists (`NO_SIMULATION`). `TransactionExecutionResult` carries consumed units and `vmError`, never a debited fee (`feeDeclaredUnits` only). |
| **Block Time & Indexer** | `Q7–Q9` | `blocks.get({ slot })` supplies optional `blockTimeNs`. No official public REST/GraphQL indexer exists for candles/trades/holders (`NO_INDEXER`); `@thru/indexer` is a server-side Postgres package, and `scan.thru.org/api/mcp` is LLM-only (`format=toon`). |
| **Token Program** | `Q10–Q13` | `@thru/programs/token` uses 1-byte instruction tags (`1` init, `2` transfer, `3` mint_to) and deterministic token-account PDAs. `2026-10-23-live-chain-run3.json` proved sender-paid initialization for an unregistered recipient owner succeeds and leaves the recipient's native account unregistered. Authority-revocation semantics (`Q11`) remain open before enabling launch templates. |
| **AMM & Wrapped THRU** | `Q14–Q19` | `@thru/programs/amm` (`taAMMx8g...`) is deployed and live-verified on Betanet (`2026-10-25-live-swap-probe.json`) for token-token pools, reserves parsing, and exact-in swaps. Native `THRU` vs `wthru` (`taWTHRUBe...`) wrapping (`Q17`) and live `withdrawLiquidity` (`R2` exit-first gate for `addLiquidity`) remain open. |
| **Bootstrap Program Map & Curve** | `Q20–Q21` | `betanet.registry-seed.json` declares **19** roles: **18** canonical `@thru/programs/bootstrap-addresses` programs (all verified `deployedOnChain: true` on Betanet in `2026-10-23-live-chain-run3.json`) plus `curve: null` (no bonding-curve/launchpad program exists in official packages or bootstrap state -> `LAUNCH_MODEL_UNAVAILABLE`). |
| **Oracle & Fiat** | `Q22` | `@thru/programs/oracle` (`taORCLOk...`) is deployed, but live probe `q22` (`2026-10-06..23`) confirmed **no `thru-usd` feed** exists on Betanet (`usd` capability stays `unsupported` / `DEPENDENCY_UNVERIFIED`). |
| **MV3, SDK Pins & Licensing** | `Q23–Q26` | Chrome MV3 service worker uses `chrome.storage.local` (versioned schemas) + `chrome.storage.session` (unlocked keys) + `chrome.alarms`; `@thru/sdk` & `@thru/programs` pinned at `0.4.2` (verified Apache-2.0 with zero install scripts/telemetry in `2026-10-05-package-surface.json`; public `rpc.thru.org` commercial rate-limit ToS remains open). |

---

## 3. Pinned Capability Limits (`SNAPSHOT.LIMITS` <-> `betanet.capability-matrix.json`)

| Limit Key | Pinned Seed Value | Notes |
| --- | ---: | --- |
| `quoteTtlMs` | `15000` (`15 s`) | Maximum quote validity before refresh required |
| `preparedTtlMs` | `120000` (`120 s`) | Prepared intent/review lifetime |
| `slippageDefaultBps` | `50` (`0.50%`) | Default for verified assets (`300` bps suggested for unverified) |
| `slippageWarnBps` | `300` (`3.00%`) | High-slippage warning threshold |
| `slippageMaxBps` | `2000` (`20.00%`) | Seed Desktop-advanced-only cap (`dex-service.js` currently enforces `1000` bps) |
| `priceImpactWarnBps` | `500` (`5.00%`) | Price-impact warning threshold |
| `priceImpactBlockBps` | `1500` (`15.00%`) | Hard price-impact block threshold |
| `usdLiquidityFloorThru` | `null` | Unset until a `thru-usd` oracle source is verified |
| `maxCandles` | `1000` | Maximum OHLCV candle array length |
| `pollMinMs` | `5000` (`5 s`) | Minimum background read-polling interval |

---

## 4. Pinned Capability Matrix (`betanet.capability-matrix.json`)

> **Important:** `test/test-defi-m0.mjs` asserts byte-exact parity between `scripts/defi-evidence/betanet.capability-matrix.json`, `betanet.registry-seed.json`, and `src/background/services/defi/capability-snapshot.js`. Edit all three together with a test run whenever promoting a capability row.

| Capability Key | Seed `state` (When Flag On) | Seed `reason` | Runtime Status Today (`FLAGS.DEFI === false`) |
| --- | --- | --- | --- |
| `balances` | `enabled` | `null` | Enabled in wallet core (`tx.getBalances`, `token.getBalances`) |
| `tokenTransfer` | `enabled` | `null` | Enabled in wallet core (`token.transferChecked` via v32 review) |
| `swap` | `enabled` | `null` | **Disabled at runtime** (`FEATURE_DISABLED` — `FLAGS.DEFI_DEX === false`) |
| `pools` | `enabled` | `null` | **Disabled at runtime** (`FEATURE_DISABLED` — `FLAGS.DEFI_READ === false`) |
| `launchMint` | `unsupported` | `TOKEN_PATH_UNVERIFIED` | Disabled (`Q11` authority policy + seed promotion pending) |
| `launchDirectPool` | `unsupported` | `DEPENDENCY_UNVERIFIED` | Disabled (gated behind `launchMint` + `wthru` / LP exit verification) |
| `launchCurve` | `unsupported` | `LAUNCH_MODEL_UNAVAILABLE` | Disabled (`role=curve` absent on Thru) |
| `migrate` | `unsupported` | `LAUNCH_MODEL_UNAVAILABLE` | Disabled (`role=curve` absent) |
| `claim` | `unsupported` | `LAUNCH_MODEL_UNAVAILABLE` | Disabled (`role=curve` absent) |
| `charts` | `unsupported` | `NO_INDEXER` | Disabled (no verified OHLCV indexer) |
| `discovery` | `unsupported` | `NO_INDEXER` | Disabled (no verified discovery indexer) |
| `simulation` | `unsupported` | `NO_SIMULATION` | Unsupported across wallet (`tx.simulate` -> `supported: false`) |
| `usd` | `unsupported` | `DEPENDENCY_UNVERIFIED` | Unsupported (no verified `thru-usd` oracle feed on Betanet) |
