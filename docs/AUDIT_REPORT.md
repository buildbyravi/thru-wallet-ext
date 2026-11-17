# Audit Report — Thru Wallet Extension

**Document Class:** Operational Verification (Current Audit Summary, Mainnet-Readiness Gates & Historical Audit Index)
**Baseline:** The tree is at contract **v33** with **154 methods** and **15 routes** (synchronized 2026-11-16).

---

## 1. Current Audit Conclusion

**Current repair pass: IMPLEMENTED and TESTED (`v33`, 2026-11-16). External audit: NOT PERFORMED (`EXTERNAL AUDIT REQUIRED`).** This records the scoped repairs below, not a claim that all possible security defects are resolved.

- All findings from the 2026-10-03 Mainnet-readiness audit (`MR-01…MR-07`), 2026-10-04 conformance audit (`F-01…F-08`), 2026-10-28 v30 domain audit (`D-1…D-6`), 2026-10-29 v31 record-write audit (`E-1…E-8`), 2026-10-30 review-lifecycle audit (`F-1…F-5`), and 2026-10-30 shared-platform audit are fixed in `src/` and guarded by automated regression tests with negative controls.
- Subsequent `2026-11-01..13` security passes closed the direct-handler review bypass by adding the **contract v32 background `consentToken` gate** (`src/background/services/review/consent.js` + `REVIEW_REQUIRED` in `api-router.js`, `test/test-review-consent.mjs`), wired `walletService.lock()` review/token discard onto the inactivity alarm and startup lock paths (`test/test-review-lifecycle.mjs`), added explicit `SEND_EXPIRY_SLOTS = 1000` transaction deadlines (`test/test-thru-client.mjs`), refused custom-RPC writes (`CUSTOM_RPC_SUPPORTED = false`), unified registrar/record header fees via `tx-units.networkFeeUnits` (`D-022`), and enforced one notification surface per submission event (`Rule 29`).
- **Architecture remains frozen (`AGENTS.md`):** priority is real-Chrome smoke execution, closing the Betanet custom-registrar `.bin` / fee-collection and `name.setRecord` live probes, and completing an independent external security audit before any Mainnet claim.

---

## 2. Mainnet-Readiness Gates (Five Strictly Separated Categories)

Verification classes are never merged: a green Node test never closes a browser gate, a Betanet probe never proves Mainnet behavior, and internal reviews never substitute for an external audit.

### Gate A — Deterministic Automated Verification: `PASS` (`IMPLEMENTED`, `TESTED`)
- `npm run build` — **PASS**, zero warnings; `dist/` regenerated cleanly from `src/`.
- `npm test` — **PASS** across **41 test suites** (`test/test-*.mjs`) and **9 guard scripts** (`scripts/check-*.mjs`):
  - Exact pins `@thru/sdk@0.4.4` & `@thru/programs@0.4.4` with 16/16 derivation golden vectors (`test/test-derivation.mjs`); read-only rate-limit compatibility tests cover the published 0.4.2 wire format (`test/test-faucet-limit.mjs`).
  - Layering across `128` runtime JS files (`0` boundary violations, `0` HTML-injection sinks), cycle ratchet (`1` legacy 5-service cycle), CSP <-> enabled-network parity, `30/30` ordered `AGENTS.md` rules, docs-truth parity, guard negative controls, `15/15` routes reachable with all used CSS classes defined, flat CSS, Dashboard 6-tile geometry, launchpad quarantine, and all `11` build-time `FLAGS === false`.
  - Contract **v33** (`154` methods) parity and verified-token import; signing consent and session cleanup; nine review kinds (`205` decoder/service checks and `67` card checks); `1,153` route-lifecycle checks; strict mint parsing, registrar rechecks, pending unknown-outcome retention, storage migrations, and passive-polling auto-lock regression coverage.

### Gate B — Real-Browser Verification (Chrome MV3): `PARTIAL — OPEN` (`UNVERIFIED`)
- **Recorded:** One partial real-Chrome toolbar-popup run (`2026-10-04`, `docs/MANUAL_SMOKE_CHECKLIST.md` §8: native Betanet self-send verified recipient, amount, Review fee, confirmation, and History entry) plus an isolated Chrome visual-harness check of `NameRoute`/`Sheet` at `400x600` and `320px` (`2026-10-27`, mocked bridge).
- **Still Open:** Full `docs/MANUAL_SMOKE_CHECKLIST.md` across popup and side panel (`<400px` narrow and `>=800px` wide), popup/panel mutual exclusion, real focus rings, QR scan, `TxReviewCard` §7 (`scripts/preview-tx-review.html`), `toast()` bar (`scripts/preview-toast.html`), clipboard permission prompt, MV3 worker eviction/restart, and browser verification of the `1.4.1` CWS package.

### Gate C — Betanet Live-Network Verification: `PARTIAL — OPEN`
- **Verified on Betanet (`VERIFIED AGAINST LIVE NETWORK`):**
  - Native EOA transfer & `1`-base-unit fee (`2026-09-26`), `/address/?network=betanet` explorer link (`2026-09-27`), ~6s block cadence (`2026-09-29`), popup native self-send (`2026-10-04`).
  - Faucet `10,000` base-unit per-claim ceiling (`2026-10-24-faucet-cap.json`) and explicit `autoUnits` resource budgets (`2026-10-09`).
  - Full 13-rung Token Program live verification (`2026-10-23-live-chain-run3.json`: mint deploy, sender-created token account for never-registered recipient wallet `created: true`, transfer, `2` base units across init + transfer) and all `18` bootstrap program addresses verified deployed on-chain.
  - Live AMM pool init, LP add, and exact-in swap (`2026-10-25-live-swap-probe.json`, `vmError: 0`; DeFi flags remain `false`).
  - Custom `.thru` registrar deployment read (`2026-10-26`), router `Register` (`2026-10-27`), and layout-2 tiered `UpdateConfig` (`2026-10-31`, `registrar-deploy-betanet-thru-1793443647724.json`, `feePolicy: "strict"`).
- **Still Open on Betanet (`UNVERIFIED` / `Release Blockers`):**
  1. Deploy checked-in `33,714`-byte `thru-custom-registrar.bin` (`0xD112` canonical-PDA check) and measure treasury balance delta across a live `Register` and `Renew` (`collectionProbe.measured` is `false`), plus live broadcast with `1`-base-unit `networkFeeUnits`.
  2. Probe `name.setRecord` (`v31` opcode 2) and `name.reverseLookup` against live Betanet (or gate `name.setRecord` off).
  3. Multi-account `v12` `tx.registerAccount` creation + `/send` JIT activation (`scripts/verify-live-e2e.mjs betanet`).
  4. Live `blocks.get` block-time availability/latency and confirmation of `https://scan.thru.org` `/tx/` deep-link routing.

### Gate D — Mainnet-Specific Verification: `NONE` (`BLOCKED`)
- `mainnet` in `src/lib/networks.js` is disabled (`enabled: false`, `baseFeeUnits: null`, absent from `manifest.json` `connect-src`). Before Mainnet enablement: measure Mainnet fees on-chain, thread `network.baseFeeUnits` into `tx-units.autoUnits` (`docs/BACKEND_GAPS.md` C2), satisfy all 6 contract deployment gates in `docs/GLOBAL_SMART_CONTRACT_POLICY.md` (including upgrade-authority-gated `Initialize` and `max_fee` bounds on custom programs), and re-run live verification on Mainnet.

### Gate E — Independent External Security Audit: `NOT PERFORMED` (`EXTERNAL AUDIT REQUIRED`)
- All audits indexed below are internal engineering audits. An independent third-party wallet & smart-contract security audit is required prior to any Mainnet-readiness claim.

---

## 3. Historical Audit Records (`docs/audits/` — Append-Only Snapshots)

> [!WARNING]
> **AI Agent Notice:** Files in `docs/audits/` are **immutable historical point-in-time records** of earlier commits (`v6`–`v31`). Several contain policies later superseded by owner decisions (e.g., `2026-09-18-baseline.md` predates `D-003` session-only signing default; `2026-10-28..30` predate the `v32` `consentToken` gate and `2026-11-12` `networkFeeUnits` policy). Never edit these files and **never treat them as current specification** — use `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `docs/guides/*` for current behavior. Temporary agent handoffs and documentation-overhaul reports are deliberately excluded from this directory.

| Date | Historical Record | Commit / Era Audited |
| --- | --- | --- |
| 2026-10-30 | [`docs/audits/2026-10-30-shared-platform-audit.md`](audits/2026-10-30-shared-platform-audit.md) | `0cb010b` (v31): blank Domain `toast()` root cause, unified `toast`/`Banner` vocabulary, single `shortenMiddle` truncation primitive. |
| 2026-10-30 | [`docs/audits/2026-10-30-review-lifecycle-audit.md`](audits/2026-10-30-review-lifecycle-audit.md) | `2c0aeed` -> `5b39dc5` (v31): deleted hidden Domain batch queue, bound faucet claim account/network, mandatory `AbortSignal` on `submitReviewedReview`, Domain prepare race fix, v1.5.0 card copy. |
| 2026-10-29 | [`docs/audits/2026-10-29-v31-audit.md`](audits/2026-10-29-v31-audit.md) | `4bd5ef9` (v31): `name.setRecord` confirm `TypeError`, promotion to `auth: 'signing'`, three-state domain facts, `ERROR_CODES` scan, `reverseLookup` network/TLD binding. |
| 2026-10-28 | [`docs/audits/2026-10-28-sync-audit.md`](audits/2026-10-28-sync-audit.md) | `a613fcb..3276245` (v30): tracked domain registry merge and custom-registrar renewal pricing fixes. |
| 2026-10-04 | [`docs/audits/2026-10-04-conformance.md`](audits/2026-10-04-conformance.md) | `7883219` (v16): production-rules conformance (`F-01…F-08` and remediations `U1–U5`). |
| 2026-10-03 | [`docs/audits/2026-10-03-mainnet-readiness.md`](audits/2026-10-03-mainnet-readiness.md) | `05fda07` (v15->v16): `MR-01…MR-07` (`signing-guard`, unbound-send retirement, serialized pending writes, versioned storage). |
| 2026-09-18 | [`docs/audits/2026-09-18-baseline.md`](audits/2026-09-18-baseline.md) | Initial v6/v7 baseline security review (`F-01` password-per-sign default later superseded by `D-003`). |
