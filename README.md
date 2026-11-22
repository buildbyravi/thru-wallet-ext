# Thru Wallet — Betanet

Chrome MV3 self-custody wallet extension for the **Thru native Layer 1**. Built with vanilla ES modules, `esbuild`, and exact-pinned official Thru packages (`@thru/sdk@0.5.2` including `@thru/sdk/crypto`, plus `@thru/programs@0.5.2`). Thru is **not EVM**; external wallets (Rabby, Phantom, Keplr) serve as UX references only.

**Betanet is Thru's final testnet before Mainnet** (`betanet`: RPC `https://rpc.betanet.thru.org`, explorer `https://scan.thru.org` with `?network=betanet`, ~6-second blocks).

> [!IMPORTANT]
> **Betanet deployment. Mainnet engineering standard.** Internal security remediations through
> Contract **v33** are implemented and tested locally; real-browser smoke checks, remaining live
> Betanet probes, and an independent external security audit remain required before Mainnet. See
> [`docs/STATUS_AND_ROADMAP.md`](docs/STATUS_AND_ROADMAP.md) and [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md).

---

## Current Shipped State (Contract v33)

- **One UI Stack (`15` Routes):** `welcome`, `unlock`, `dashboard`, `accounts`, `account`, `add-account`, `keyring`, `export`, `send`, `receive`, `faucet`, `name` (Domains), `history`, `settings`, `reset`. Toolbar popup (`400x600`) and resizable side panel (`popup.html?thru_panel=1`) share one page with mutual exclusion; Side Panel Mode is an explicit Settings opt-in.
- **Contract v33 (`154` Methods):** `src/shared/contract/manifest.js` declares `88` wallet-core methods, `23` `name.*` domain/registrar methods, and `43` dark-launched DeFi M0 methods (`src/shared/contract/defi-schema.js`, all `FLAGS.DEFI_* === false` in `src/shared/flags.js`).
- **One Transaction Review & Background Consent Pipeline (`v29`–`v32`):** Every value-moving screen (`/send` native & token, `/name` register/purchase/renew/claim, `/faucet` claim — plus contract-level `domain-record`, `9` review kinds total) prepares via `tx.prepareReview`, renders `src/ui/domain/tx-review/review-card.js`, and confirms via `tx.confirmReview`. `tx.confirmReview` mints a single-use 60s `consentToken` enforced in `src/background/api-router.js` (`REVIEW_REQUIRED`) before any value-moving handler executes. Undecodable transactions (`raw`) cannot be signed; post-tx balances are never fabricated (`tx.simulate` returns `supported: false`). Details: [`docs/guides/transaction-review.md`](docs/guides/transaction-review.md).
- **Session-Only Signing Default (`D-003`):** Unlocked sessions authorize `auth: 'signing'` operations by default (`requirePasswordForSigning: false`); per-signature password re-auth is a password-gated Settings opt-in. Vault secret exports, keyring mutations, security preferences, and unlocked resets always require the master password.
- **Domains (`.thru` & `.id`):** `/name` provides `Register` and `My Domains` tabs with `.thru` registration and renewal (`thru-custom-registrar` tiered layout-2 pricing on Betanet, official paid registry fallback), `.id` resolution-only lookup, per-network tracked domain inventory, and `tx-units.networkFeeUnits` header fees. Details: [`docs/guides/domains-and-registrar.md`](docs/guides/domains-and-registrar.md).
- **Quarantined Surfaces:** Legacy `src/launchpad/**` is deleted and guarded (`test/test-launchpad-quarantine.mjs`). Custom RPC activation and writes are refused in the background (`v7`). No `window.thru` dApp provider is injected.

---

## Documentation — Single Source of Truth

Start at [`docs/DOCS_INDEX.md`](docs/DOCS_INDEX.md) for the complete SSoT hierarchy and AI-agent read order:

| Document | Responsibility |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Hard rules `1–30` with mechanical gates, commands, and reporting format (detail in `docs/agent/`). |
| [`CONTEXT.md`](CONTEXT.md) | File-by-file map of `src/`, `test/`, and `scripts/` with lookup index. |
| [`docs/DOCS_INDEX.md`](docs/DOCS_INDEX.md) | Master documentation router, precedence hierarchy, and anti-sprawl rules. |
| [`docs/STATUS_AND_ROADMAP.md`](docs/STATUS_AND_ROADMAP.md) | Shipped baseline, live Betanet evidence matrix, release blockers, and next work. |
| [`docs/PROJECT_LEDGER.md`](docs/PROJECT_LEDGER.md) | Canonical identifiers and contract changelog (`v5–v33`). |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Enforced dependency graph, v32 signing/consent boundary, shared UI platform, and storage. |
| [`docs/BUILD_SPEC.md`](docs/BUILD_SPEC.md) | Shipped product, wallet container, route, security, and design specification. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Durable architectural decisions (`D-001` through `D-033`). |
| [`docs/BACKEND_GAPS.md`](docs/BACKEND_GAPS.md) | Implemented capabilities vs unsupported/unverified chain boundaries. |
| [`docs/MODULE_BOUNDARIES.md`](docs/MODULE_BOUNDARIES.md) | Core layering and future `src/features/<id>/` module isolation rules. |
| [`docs/GLOBAL_SMART_CONTRACT_POLICY.md`](docs/GLOBAL_SMART_CONTRACT_POLICY.md) | On-chain program engineering rules and 6 Mainnet deployment gates. |
| [`docs/guides/`](docs/guides/) | Cohesive subsystem guides: [`transaction-review.md`](docs/guides/transaction-review.md), [`domains-and-registrar.md`](docs/guides/domains-and-registrar.md), [`history-and-activity.md`](docs/guides/history-and-activity.md), [`protocol-and-rpc.md`](docs/guides/protocol-and-rpc.md). |
| [`docs/defi/README.md`](docs/defi/README.md) | Dark-launched DeFi M0–G3 backend architecture, dossier, and contract inventory (`FLAGS.DEFI === false`). |
| [`docs/roadmap/`](docs/roadmap/) | Phased [`FUTURE_ROADMAP.md`](docs/roadmap/FUTURE_ROADMAP.md), [`ARCHITECTURE_AND_UX_CRITIQUE.md`](docs/roadmap/ARCHITECTURE_AND_UX_CRITIQUE.md), and [`LIFECYCLE_SECURITY_AND_QA_PLAN.md`](docs/roadmap/LIFECYCLE_SECURITY_AND_QA_PLAN.md) (`PLANNED`). |
| [`docs/AUDIT_REPORT.md`](docs/AUDIT_REPORT.md) | Mainnet-readiness gates and index of historical audits (`docs/audits/`). |
| [`docs/DEFECT_LOG.md`](docs/DEFECT_LOG.md) | Categorized engineering postmortem and defect guardrails. |
| [`docs/MANUAL_SMOKE_CHECKLIST.md`](docs/MANUAL_SMOKE_CHECKLIST.md) | Real-Chrome popup/side-panel and live-chain verification runbook. |
| [`llms.txt`](llms.txt) | Compact read-only repository context brief for external LLMs. |

---

## Architecture

```txt
src/ui/app/routes/*
  -> src/ui/app/bridge.js
  -> src/shared/contract/manifest.js (v33, 154 methods)
  -> src/background/api-router.js (auth + v32 consentToken gate + signing-guard)
  -> src/background/services/*
  -> src/lib/{vault,thru-client,networks,tx-units,...}.js
```

---

## Commands

```bash
npm install
npm run build        # bundles dist/ via esbuild
npm test             # runs all 9 structural guard scripts + 41 test suites
npm audit --omit=dev
```

Load `dist/` unpacked in Chrome via `chrome://extensions` -> **Developer mode** -> **Load unpacked**.

Live-network verification scripts (`scripts/verify-*.mjs`, `scripts/probe-*.mjs`, `npm run test:live`) are excluded from `npm test` and run manually against throwaway wallets on an RPC-reachable host.

---

## License

MIT. See [`LICENSE`](LICENSE).
