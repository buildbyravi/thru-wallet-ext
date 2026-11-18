# On-Chain & Protocol Evidence Artifacts

Machine-readable evidence records supporting `docs/defi/DOSSIER_AND_CAPABILITIES.md`, `docs/guides/domains-and-registrar.md`, and `docs/STATUS_AND_ROADMAP.md`. **No file in this directory may ever contain a seed phrase, private key, password, or credential.**

---

## 1. Pinned Capability & Registry Seeds (Test-Enforced)

`test/test-defi-m0.mjs` enforces parity between these two seed files and `src/background/services/defi/capability-snapshot.js`. Never edit one without updating all three and running `npm test`:

- `betanet.registry-seed.json` — 19 `ProgramRecord` entries (`18` canonical `@thru/programs/bootstrap-addresses` roles + `curve: null`).
- `betanet.capability-matrix.json` — 13 capability keys (`balances`, `tokenTransfer`, `swap`, `pools` enabled in seed; remaining DeFi/launchpad/chart/simulation/USD keys `unsupported` with explicit `UNSUPPORTED_REASONS`).

---

## 2. Artifact Categories in This Directory

1. **Offline & Spec Snapshots (`collect-offline-evidence.mjs` / Dated Docs):**
   - `2026-10-05-environment-egress.json` — records sandbox TLS egress boundary to `*.thru.org`.
   - Package snapshots record the installed manifests, not a license audit or a chain read. [2026-10-05](2026-10-05-package-surface.json) covers `@thru/sdk` and `@thru/programs` at `0.4.1`; [2026-11-18](2026-11-18-package-surface.json) covers both at `0.4.4` (`node scripts/collect-offline-evidence.mjs --check`).
   - `2026-10-05-official-docs.json`, `2026-10-08-official-docs.json`, `2026-10-09-registrar-nameservice-official.json` — dated retrievals of official Thru transaction, runtime, resource, registrar, and name-service specifications.
   - `2026-10-09-claim-variants.json` — SDK `0.4.0` vs `0.4.1` unit-budget root-cause record (`src/lib/tx-units.js`).
2. **Live Betanet Battery & DeFi Probes (`npm run test:live` / `scripts/probe-*.mjs`):**
   - `2026-10-06-live-chain.json`, `2026-10-07-live-chain.json`, `2026-10-08-live-chain.json`, `2026-10-23-live-chain.json`, `2026-10-23-live-chain-run2.json`, **`2026-10-23-live-chain-run3.json`** (full 13-rung `p3-token-transfer: PASS` with pre-funded Betanet sender + 18-program deployment verification).
   - `2026-10-24-faucet-cap.json` — proves Betanet faucet cap is `10,000` base units per claim (`10,001+` reverts `vmError -765`).
   - **`2026-10-25-live-swap-probe.json`** — live Betanet AMM mint deploy (`AMMA`, `AMMB`), pool initialization, liquidity add, and exact-in swap (`vmError: 0`, `consumedComputeUnits: 56105`).
3. **Custom Registrar & Name-Service Live Artifacts (`scripts/registrar/` & `scripts/probe-live-name.mjs`):**
   - `registrar-deploy-betanet-thru-*.json` (4 runs; latest `registrar-deploy-betanet-thru-1793443647724.json` on 2026-10-31 updated on-chain config to layout 2, `100,000 / 10,000 / 1,000` tiers, `feePolicy: "strict"`, `collectionProbe.measured: false`).
   - `registrar-probe-betanet-*.json` (3 runs verifying on-chain `.thru` registration and 1-year `DomainLease` creation).
   - `live-audit-thru-and-id-*.json` & `2026-10-24-name-service-live*.json` (Betanet `.thru` vs `.id` root/authority probes).

---

## 3. Recording Rules

- Standard G0 dossier entries use `{ id, kind, network, dateUtc, tool, refs, finding, confidence }`. Script-generated probe/deploy outputs (`registrar-*.json`, `2026-10-25-live-swap-probe.json`) record deterministic public addresses, transaction signatures, `vmError`, and measurement flags (`collectionAttested`, `collectionNote`, `collectionProbe`).
- Committed evidence JSON files are **immutable historical measurements** — never hand-edit a past run's output; run a new probe to record updated chain state.
