# Documentation Index — Single Source of Truth (SSoT)

**Last Synchronized:** 2026-11-19 | **Codebase Baseline:** Contract **v33** (`154` methods, `15` routes, `9` review kinds, `41` test suites + `9` guard scripts)

---

## 1. AI Agent Ground Rule (Precedence Order)

Documentation summarizes the codebase; **it never overrides it**. Whenever two sources appear to conflict, resolve them strictly in this order:

1. **Live Source & Automated Gates (`src/`, `test/`, `scripts/check-*.mjs`):** Absolute truth on shipped runtime behavior, contract methods (`src/shared/contract/manifest.js`), routes (`src/ui/app/boot.js`), and feature flags (`src/shared/flags.js`).
2. **Agent Hard Rules (`AGENTS.md` + `docs/agent/*.md`):** Non-negotiable engineering, security, and verification constraints (`Rules 1–30`), mechanically enforced by `scripts/check-agents.mjs`.
3. **Authority SSoT Documents (§3 below):** Current engineering state (`docs/STATUS_AND_ROADMAP.md`), source map (`CONTEXT.md`), architecture (`docs/ARCHITECTURE.md`), product/security spec (`docs/BUILD_SPEC.md`), decisions (`docs/DECISIONS.md`), capabilities (`docs/BACKEND_GAPS.md`), and topical guides (`docs/guides/*.md`).
4. **Operational Verification Records (§4 below):** Real-browser runbook (`docs/MANUAL_SMOKE_CHECKLIST.md`), audit status (`docs/AUDIT_REPORT.md`), defect taxonomy (`docs/DEFECT_LOG.md`), and dark-launched DeFi records (`docs/defi/*.md`).
5. **Future Roadmap (`docs/roadmap/FUTURE_ROADMAP.md`):** Unshipped `PLANNED` / `BLOCKED` designs only — **never treat any item in `docs/roadmap/` as implemented**.
6. **Historical Point-in-Time Audits (`docs/audits/*.md`):** Append-only dated snapshots of past commits — **never read a dated audit as current specification**.

---

## 2. Task-Based Read Order for AI Agents

| If your task touches... | Read in this exact order | Mandatory Verification Gate(s) |
| --- | --- | --- |
| **Any task (start here)** | `AGENTS.md` -> `CONTEXT.md` -> `docs/STATUS_AND_ROADMAP.md` | `npm run build && npm test` |
| **Signing, transactions, or review UI** | `docs/agent/rules-detail.md` (Rules 10, 16, 17) -> `docs/guides/transaction-review.md` -> `docs/ARCHITECTURE.md` | `test/test-tx-review.mjs`, `test/test-tx-review-card.mjs`, `test/test-review-consent.mjs`, `test/test-signing-surface.mjs` |
| **`.thru` / `.id` domains or custom registrar** | `docs/guides/domains-and-registrar.md` -> `docs/GLOBAL_SMART_CONTRACT_POLICY.md` -> `contracts/thru-custom-registrar/README.md` | `test/test-name-*.mjs`, `test/test-custom-registrar.mjs`, `test/test-route-lifecycle.mjs` |
| **History, activity, or detail sheet** | `docs/guides/history-and-activity.md` -> `docs/BACKEND_GAPS.md` (C2b, C2c) | `test/test-history-cache.mjs`, `test/test-history-block-time.mjs`, `scripts/preview-tx-sheet.html` |
| **Thru SDK, RPC, units, or token wire formats** | `docs/guides/protocol-and-rpc.md` -> `docs/DECISIONS.md` (D-002, D-007, D-022) | `test/test-derivation.mjs`, `test/test-thru-client.mjs`, `test/test-tx-units.mjs`, `scripts/check-layering.mjs` |
| **UI routes, kit, sheets, toasts, or CSS** | `docs/agent/engineering-directive.md` (UX preflight and Modern Web Guidance) -> `docs/agent/rules-detail.md` (Rules 14, 15) + `AGENTS.md` (Rule 29) -> `docs/ARCHITECTURE.md` -> `docs/MANUAL_SMOKE_CHECKLIST.md` | `scripts/check-routes.mjs`, `scripts/check-css-nesting.mjs`, `test/test-toast.mjs`, `test/test-shared-platform.mjs`, `test/test-route-lifecycle.mjs` + real browser check |
| **Storage schemas, caching, or network scope** | `docs/agent/engineering-directive.md` (Architecture and compatibility invariants) -> `docs/ARCHITECTURE.md` (section 5, Persistent Storage and Network Scoping) -> `docs/DECISIONS.md` (D-004, D-011) | `test/test-storage-migrations.mjs`, `test/test-balance-network.mjs`, `test/test-api-router.mjs` |
| **DeFi backend (`FLAGS.DEFI_*` all off)** | `docs/MODULE_BOUNDARIES.md` -> `docs/defi/README.md` -> `docs/defi/DOSSIER_AND_CAPABILITIES.md` -> `docs/defi/M0_CONTRACT_INVENTORY.md` | `test/test-release-flags.mjs`, `test/test-launchpad-quarantine.mjs`, `test/test-defi-*.mjs`, `test/test-dex-swap.mjs` |
| **Unshipped features, strategy, or QA upgrades** | `docs/roadmap/FUTURE_ROADMAP.md` -> `docs/roadmap/ARCHITECTURE_AND_UX_CRITIQUE.md` -> `docs/roadmap/LIFECYCLE_SECURITY_AND_QA_PLAN.md` -> `docs/MODULE_BOUNDARIES.md` | Confirm scope with owner first (`AGENTS.md` §Stop and ask) |
| **Release or Mainnet readiness** | `docs/STATUS_AND_ROADMAP.md` -> `docs/AUDIT_REPORT.md` -> `docs/MANUAL_SMOKE_CHECKLIST.md` -> `extension.md` | `npm run build && npm test`, `npm audit --omit=dev`, evidence gates at exact SHA, owner approval |
| **Documentation edits** | This file (`docs/DOCS_INDEX.md`) | `node scripts/check-docs-truth.mjs && node scripts/check-agents.mjs` |

---

## 3. Authority Documents (Current Shipped Truth)

Each document owns **one** domain. Link to the owner instead of duplicating counts or rules.

### 3.1 Root Entrypoints & Public Policies
| File | Owns |
| --- | --- |
| `AGENTS.md` | Hard rules `1–30` with enforcing gates, commands, stop-and-ask triggers, and reporting template. |
| `CONTEXT.md` | Exact file-by-file repository map (`src/`, `test/`, `scripts/`), line counts, route table, and quick lookup index. |
| `README.md` | High-level project overview, architecture summary, commands, and documentation links. |
| `llms.txt` | Compact read-only repository context brief for external LLMs (synchronized with v33). |
| `SECURITY.md` | Public security policy, PBKDF2/AES-GCM encryption spec, permission audit, CSP, and vulnerability disclosure. |
| `PRIVACY.md` | Public zero-telemetry privacy policy and local vs RPC data boundary. |
| `SUPPORT.md` | Public user FAQ, current Betanet scope, and support channels. |
| `extension.md` | Chrome Web Store copy and permission justifications; publication is separate from repository edits. |

### 3.2 Core Authority Specifications (`docs/`)
| File | Owns |
| --- | --- |
| `docs/DOCS_INDEX.md` | SSoT hierarchy, agent routing table, document classes, and anti-sprawl rules. |
| `docs/agent/engineering-directive.md` | Full Mainnet-ready engineering directive, architecture freeze, and compatibility/signing invariants. |
| `docs/agent/rules-detail.md` | Full text of Hard Rules `10`, `14`, `15`, `16`, `17`, and `30`. |
| `docs/agent/traps.md` | Debugging traps that cost real engineering time in this repository. |
| `docs/agent/rule-matrix.md` | Provenance matrix mapping Hard Rules `1–30` to their mechanical gates. |
| `docs/STATUS_AND_ROADMAP.md` | Shipped baseline, live Betanet evidence matrix, release blockers, and ordered active verification work. |
| `docs/PROJECT_LEDGER.md` | Canonical repository identifiers and append-only contract milestone history (`v5–v33`). |
| `docs/ARCHITECTURE.md` | Dependency graph, authoritative module ownership, v32 signing/consent boundary, shared UI platform, and scoped storage. |
| `docs/BUILD_SPEC.md` | Shipped product behavior, wallet/keyring container model, route requirements, security matrix, and design system. |
| `docs/DECISIONS.md` | Durable architectural decisions (`D-001` through `D-033`) with trade-offs and consequences. |
| `docs/BACKEND_GAPS.md` | Implemented backend capabilities vs open live-chain/protocol gaps and contract compatibility policy. |
| `docs/MODULE_BOUNDARIES.md` | Enforced core layering and target isolation rules for future `src/features/<id>/` modules. |
| `docs/GLOBAL_SMART_CONTRACT_POLICY.md` | Smart contract inspection/reuse rules and the 6 Mainnet deployment gates. |

### 3.3 Cohesive Subsystem Guides (`docs/guides/`)
| File | Owns |
| --- | --- |
| `docs/guides/transaction-review.md` | v32 review pipeline (`tx.prepareReview`, all 9 decoder kinds, `TxReviewCard`, `tx.confirmReview` + `consentToken`). |
| `docs/guides/domains-and-registrar.md` | `.thru` custom & official registrars, `.id` lookup boundary, tracked domain inventory, `name.setRecord`, `reverseLookup`, and fees. |
| `docs/guides/history-and-activity.md` | Flat History stream, cache-first paint, block-time provenance (`block` / `submitted` / `Block <slot>`), and `tx.getDetail`. |
| `docs/guides/protocol-and-rpc.md` | `src/lib/` Thru SDK/program adapters, `tx-units.js` resource budgeting, account creation, Token Program wire tags, and RPC/Explorer boundaries. |

### 3.4 Former Active References: Semantic Routing

These destinations replace active read instructions, not the original dated evidence. The full deletion/disposition record remains in `docs/roadmap/FUTURE_ROADMAP.md` section 7.

| Former Active Reference | Current Owner and Sections | Obligation Retained |
| --- | --- | --- |
| `docs/TX_REVIEW_VERIFICATION.md` | `docs/guides/transaction-review.md` sections 1, 3, 4, 6 | One review/auth/consent path; account/network binding; single-use tokens; unknown transactions never sign; no simulation or predicted balances; browser/live checks remain open. |
| `docs/SEND_PATH_AUDIT.md` | `docs/guides/transaction-review.md` section 1 (Checked Send Eligibility), section 4; `docs/ARCHITECTURE.md` section 4; `docs/MANUAL_SMOKE_CHECKLIST.md` | Cache cannot authorize spending; checked context and network-mutation lock; timeout is unknown, not failed; real MV3 interleavings still need verification. |
| `docs/MAINNET_READINESS.md` | `docs/ARCHITECTURE.md` section 5; `docs/guides/protocol-and-rpc.md` section 2; `docs/STATUS_AND_ROADMAP.md` section 3; `docs/AUDIT_REPORT.md` Gates A-E; `docs/GLOBAL_SMART_CONTRACT_POLICY.md` section 5 | Lossless versioned storage and future-schema refusal; measured per-network fees/programs/CSP; browser, Betanet, Mainnet and external-audit gates stay separate. |
| `docs/HISTORY_REDESIGN_PLAN.md`, `docs/archive/TX_DETAIL_SPIKE.md`, `docs/archive/EXPLORER_SPIKE.md` | `docs/guides/history-and-activity.md` sections 1-5; `docs/guides/protocol-and-rpc.md` section 3 | Cache-first history, honest timestamps and decoding, declared-not-charged fees, bounded detail-sheet layout, unverified explorer routes. |
| `docs/defi/G0_DOSSIER.md`, `docs/defi/DECISIONS_G0.md`, `docs/defi/REGISTRY_AND_CAPABILITY_SEED.md` | `docs/defi/DOSSIER_AND_CAPABILITIES.md` sections 1-3; `docs/defi/README.md` section 3 | Dated protocol/seed evidence is not fresh deployment proof; capability promotion needs evidence and seed/runtime/fixture parity; review convergence precedes enablement. |
| `docs/defi/M0_INVENTORY.md` | `docs/defi/M0_CONTRACT_INVENTORY.md` sections 1-2 | Contract groups, auth/flag gates, handler ownership and schema parity; flag-off methods do not imply shipped UI. |
| `docs/defi/G1_REGISTRY.md` | `docs/defi/README.md` section 2.1; `docs/defi/DOSSIER_AND_CAPABILITIES.md` P2 | Seed/runtime fingerprint drift invalidates capabilities; a config-derived fingerprint is not a fresh live-chain genesis observation. |
| `docs/defi/G1_FEED.md` | `docs/defi/README.md` sections 2.2, 3 | Pinned, domain-separated signatures; feeds only narrow capabilities; replay monotonicity remains a pre-enablement guard. |
| `docs/defi/G1_MARKET.md` | `docs/defi/README.md` section 2.3 | Network/fingerprint-scoped coalescing and TTLs; chain-before-index reads; missing sources never fabricate market data. |
| `docs/REDESIGN_TRIAGE.md` and deleted frontend/feature research | `docs/roadmap/FUTURE_ROADMAP.md` sections 2-6; `docs/MODULE_BOUNDARIES.md`; `AGENTS.md` Rules 7, 8, 14, 25 | Remaining proposals are PLANNED, not shipped or approved; DOM/CSP, architecture freeze and real-browser checks remain mandatory. |

---

## 4. Operational Verification, Roadmap, and Historical Audits

| Path | Class | Owns |
| --- | --- | --- |
| `docs/PR-26-PRE-MERGE-TEMP.md` | Temporary PR Worklist | PR #26 plain-language changes and pending verification; remove at the agreed final merge-readiness handoff after recording durable outcomes and removing the references to the worklist from the owning docs. |
| `docs/MANUAL_SMOKE_CHECKLIST.md` | Operational Runbook | Real-Chrome popup & side-panel QA checklist (`400px`, `<400px`, `>=800px`), v32 review card smoke, live-chain steps, and DevTools helpers. |
| `docs/AUDIT_REPORT.md` | Operational Summary | Current audit conclusion, 5 separated Mainnet-readiness gate categories, and index of all 7 dated audits. |
| `docs/DEFECT_LOG.md` | Postmortem Taxonomy | Categorized root causes, fixes, and mechanical guardrails for historical and recent wallet defects. |
| `docs/defi/README.md` | Dark-Launched Spec | DeFi backend architecture, gate status (`G0–G3`), and mandatory pre-enablement guards (all `FLAGS.DEFI_* === false`). |
| `docs/defi/DOSSIER_AND_CAPABILITIES.md` | Evidence Dossier | Betanet protocol preconditions (`P1–P5`), `Q1–Q26` findings, and 19-role capability seed reference. |
| `docs/defi/M0_CONTRACT_INVENTORY.md` | Contract Reference | Inventory of the 43 `DEFI_METHODS` (`defi-schema.js`), flag gates, and handlers. |
| `docs/roadmap/FUTURE_ROADMAP.md` | **Roadmap (`PLANNED`)** | Phased 7-stage product roadmap (External Signing, Watch-Only, dApp Connection v1, Passkey Bridge, Swap/DeFi, `.thru` Profiles, MCP) and legacy disposition matrix. |
| `docs/roadmap/ARCHITECTURE_AND_UX_CRITIQUE.md` | **Strategic Critique (`PLANNED`)** | Senior architect greenfield improvements (`SignerBackend`, TypeScript, MV3 durable state, sandboxed WASM ABI), non-coder UX abstractions, and 7 critical blind spots. |
| `docs/roadmap/LIFECYCLE_SECURITY_AND_QA_PLAN.md` | **Lifecycle & QA Plan (`PLANNED`)** | Six-stage CI/CD pipeline, SDK/contract audit gates, nightly chain canary, emergency kill-switch SOP, and 4-tier QA protocol (including Playwright Chromium MV3 E2E). |
| `docs/audits/*.md` *(7 files)* | **Frozen History** | Append-only dated audit snapshots (`2026-09-18` through `2026-10-30`). Never edit; never treat as current spec. Temporary agent handoffs and documentation-overhaul reports are not retained here. |
| `contracts/VENDORED.md`, `contracts/thru-custom-registrar/README.md`, `scripts/defi-evidence/README.md`, `store-assets/README.md`, `test/fixtures/defi/README.md` | Colocated READMEs | Directory-local build, evidence, store-asset, and fixture instructions. |

---

## 5. Official External Cross-Check References

Match external documentation strictly to the exact package versions pinned in `package.json` (`@thru/sdk@0.5.2`, `@thru/programs@0.5.2`). The old `@thru/programs/ratelimit` subpath was removed in 0.4.x and is not restored in 0.5.x; the native THRU faucet has no per-account rate-limit policy.

- **Thru Protocol & SDKs:** [Thru Docs](https://thru.org/docs/) · [LLM Protocol Index](https://thru.org/docs/llm.txt) · [API/SDK Overview](https://thru.org/docs/api-ref/overview/) · [`@thru/sdk`](https://thru.org/docs/sdks/web-packages/sdk/) · [`@thru/programs`](https://thru.org/docs/sdks/web-packages/programs/) · [gRPC Overview](https://thru.org/docs/api-ref/grpc/overview/) · [Unto-Labs/thru GitHub](https://github.com/Unto-Labs/thru).
- **Hosted Wallet Boundary (Not Extension Provider):** [Embedded Wallet Integration](https://thru.org/docs/wallet/embedded-wallet-integration/) (`https://app.tid.sh/embedded`; standalone `https://wallet.tid.sh` sends `X-Frame-Options: DENY`).
- **UX Pattern Reference Only (Never Protocol Authority):** [Rabby Wallet](https://github.com/RabbyHub/Rabby) (MIT with brand/logo reserved — UX/legibility patterns only, never EVM/ABI/gas semantics).

---

## 6. Anti-Sprawl & Synchronization Rules

1. **No Stray Root or Plan Files:** Never create root `.md` or `.txt` files for plans, prompts, or session handoffs. Unshipped ideas belong exclusively in `docs/roadmap/FUTURE_ROADMAP.md`.
2. **Describe Final State, Not Draft Iterations:** Authority docs and `docs/guides/*.md` describe what `src/` **actually ships today**, never theoretical designs or superseded PR iterations.
3. **Same-Commit Synchronization (`Rule 23`):** For every change, review the owning docs and update affected behavior, status, decisions, verification, and store copy in the same commit. This includes user-visible changes, fixes and test evidence, not just `CONTRACT_VERSION`, `METHODS`, routes, flags, or test files. Record the tested revision and distinguish branch-only work from released versions; update the existing authority rather than duplicating a session log. If no docs change, explain why in the handoff. Pass `node scripts/check-docs-truth.mjs` and `node scripts/check-agents.mjs`; manual semantic review remains necessary.
4. **Separate Verification Classes:** Never let a deterministic Node test (`TESTED`) close a real-browser check (`docs/MANUAL_SMOKE_CHECKLIST.md`) or a live-network requirement (`VERIFIED AGAINST LIVE NETWORK`).
5. **Preserve Frozen Citations:** Do not repair a deleted-path citation inside `docs/audits/` by redirecting it to a current guide. Read the original at its recorded revision in Git; section 3.4 routes current work only.
6. **Report Guard Scope Exactly:** `check-agents.mjs` checks inline paths/link targets in `AGENTS.md` and the four named agent docs. `check-docs-truth.mjs` checks its declared claims, test paths, relative Markdown link files and conflict markers in its maintained set; it does not validate guide anchors, every inline path, runtime evidence references, or historical citations. Green documentation guards are not full-suite, browser, live-network or independent-audit evidence.
7. **External learning and website sync:** Keep public tutorials separate from wallet governance.
   If authorized, synchronize a single canonical source into the website at a pinned revision.
   SDK examples must be runnable and tested against the documented pins; distinguish live network
   verification from unsupported capabilities. Do not mix website deployment into an extension release PR.
