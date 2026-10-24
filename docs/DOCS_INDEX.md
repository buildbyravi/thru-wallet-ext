# Documentation index

Date: 2026-10-05
Purpose: map the maintained documentation and point readers to the implementation and verification sources of truth. Documentation summarizes the code; it does not override it.

---

## 1. Read order

### For any coding change

1. `AGENTS.md` — repository rules, commands, security boundaries, and reporting format.
2. `docs/STATUS_AND_ROADMAP.md` — shipped baseline, verified results, and explicitly open checks.
3. `docs/PROJECT_LEDGER.md` — contract/version identifiers and milestone summary.
4. `CONTEXT.md` — current source tree and file map.
5. The relevant maintained feature document below.

### For architecture or UI work

1. `docs/ARCHITECTURE.md` — implemented dependency, signing, storage, and verification boundaries.
2. `docs/DECISIONS.md` — durable decisions, rejected alternatives, trade-offs, and consequences.
3. `docs/MODULE_BOUNDARIES.md` — current core boundaries and clearly labelled, unshipped feature-module target.
2. `docs/MANUAL_SMOKE_CHECKLIST.md` — real-Chrome checks for popup and side panel; this is a runbook, not automated evidence.
3. `test/test-route-lifecycle.mjs` and `scripts/check-routes.mjs` — deterministic route, lifecycle, reachability, and CSS-class guards.

### For security work

1. `docs/STATUS_AND_ROADMAP.md` — current security behavior and residual risks.
2. `docs/DEFECT_LOG.md` — historical defects, their resolution state, and remaining browser/live-chain checks.
3. `docs/BUILD_SPEC.md` — shipped product/security behavior and verification policy.
4. `SECURITY.md` — public security policy.

### For Thru protocol or wallet integration work

Start from the pinned dependencies and current `src/` implementation, then cross-check the relevant official Thru docs linked in §6. Do not treat a Rabby implementation detail or an agent-oriented Explorer MCP response as Thru protocol authority.

---

## 2. Implementation and evidence sources

| Question | Source of truth |
| --- | --- |
| What is actually shipped? | `src/`, especially `src/shared/contract/manifest.js`, the background services, and `src/ui/` |
| What contract version and method count are shipped? | `src/shared/contract/manifest.js` (`CONTRACT_VERSION`, `METHODS`) |
| What UI routes exist and are reachable? | `src/ui/app/boot.js`, `scripts/check-routes.mjs`, and `test/test-route-lifecycle.mjs` |
| What is the current branch/worktree state? | `git status --short --branch` and `git log`; documentation is only a summary |
| What dependencies are in use? | `package.json` and `package-lock.json` |
| What runs in CI/local tests? | `package.json` scripts, `test/`, and `scripts/check-*.mjs` |
| What does only a browser prove? | `docs/MANUAL_SMOKE_CHECKLIST.md` — all such checks remain separate from Node tests |
| What is verified only against a live chain? | The dated evidence in `docs/STATUS_AND_ROADMAP.md`; distinguish historical native-Alphanet observations from the still-open v12/token-transfer checks |
| What is missing or intentionally unsupported? | `docs/BACKEND_GAPS.md`, checked against `src/shared/contract/manifest.js` and its handlers |
| What are the History UI patterns? | `docs/HISTORY_REDESIGN_PLAN.md` and its Rabby reference links; Rabby is a UX/code-pattern reference, not Thru protocol authority |
| What is historical or frozen? | The labels in this file and the freeze notice in §5; do not infer shipped behavior from research or handoff material |

---

## 3. Maintained root documents

| File | Status | Owns | Notes |
| --- | --- | --- | --- |
| `README.md` | current overview | product summary, commands, architecture | Keep concise; link to maintained technical docs rather than duplicating roadmaps. |
| `AGENTS.md` | current rules | coding rules, commands, secrets, testing, reporting | Keep short enough to load in every agent context. |
| `CONTEXT.md` | current source map | file-by-file map of the shipped tree | Counts are a dated snapshot; refresh them with the source or remove them. |
| `SECURITY.md` | public policy | threat model, disclosure, high-level security architecture | User-facing; avoid internal planning noise. |
| `PRIVACY.md` | public policy | local/RPC data behavior | Keep product-facing and non-speculative. |
| `SUPPORT.md` | public support | FAQ, known limitations, help channels | Keep aligned with the shipped baseline and open checks. |
| `extension.md` | current store record | Chrome Web Store listing copy, permission justifications, listing changelog | Source of truth for the dashboard listing; edit here first, then mirror to the store. |
| `llms.txt` | current agent brief | read-only repository context | No secrets or direct signing instructions. |

---

## 4. Maintained documents under `docs/` — three classes

Every maintained document is exactly one of: **Authority** (current truth — a claim in it is a
claim about the shipped system), **Operational verification** (runbooks and records — they state
what was and was not verified, and never close another class's item), or **Historical/reference**
(frozen, §5 — explains *why* the system was designed this way; never how it currently works).
An agent reading a historical/reference document must conclude "verify against `src/` and the
authority documents", never "this is how the code works".

### Authority — current truth

| File | Owns |
| --- | --- |
| `docs/DOCS_INDEX.md` | this map, the class split, and which document to trust |
| `docs/STATUS_AND_ROADMAP.md` | shipped state, verification status, and open work — start here |
| `docs/PROJECT_LEDGER.md` | contract identifiers, milestones, known unresolved work |
| `docs/BUILD_SPEC.md` | product/security behavior, security policy, and test expectations |
| `docs/ARCHITECTURE.md` | implemented dependency, signing, storage, and verification boundaries |
| `docs/DECISIONS.md` | durable decisions D-001…D-011 with context, options, trade-offs, and consequences |
| `docs/BACKEND_GAPS.md` | implemented backend capabilities and genuinely open/unsupported behavior |
| `docs/MODULE_BOUNDARIES.md` | wallet-core layering; authority on future feature separation (its feature modules are proposals, not shipped code) |

### Operational verification — runbooks and records

| File | Owns |
| --- | --- |
| `docs/MANUAL_SMOKE_CHECKLIST.md` | real-browser and live-chain runbook; not a test result |
| `docs/AUDIT_REPORT.md` | current audit conclusion, open mainnet-readiness gates, and the index of dated audit records |
| `docs/audits/` | append-only dated audit records (2026-09-18, 2026-10-03, 2026-10-04); a new audit appends a file and refreshes `docs/AUDIT_REPORT.md`; records are never edited |
| `docs/SEND_PATH_AUDIT.md` | Send path, registration, tests, residual risks — kept while Send race/live items are open |
| `docs/HISTORY_REDESIGN_PLAN.md` | shipped flat History behavior and its open live checks |
| `docs/DEFECT_LOG.md` | defect causes, fixes, guardrails, and residual verification gaps |
| `docs/REDESIGN_TRIAGE.md` | triage of external UX suggestions — kept while the review is unresolved (3 of 4 suggestion sets pending) |
| `docs/defi/` | DeFi backend workstream records (D-012): G0 dossier, answered decisions, registry/capability seeds, M0 code inventory — current gate state, never evidence of shipped behavior. Machine-readable artefacts: `scripts/defi-evidence/` (evidence) and `test/fixtures/defi/` + `src/shared/contract/defi-schema.js` (M0 contract for the frontend) |

---

## 5. Frozen directories — excluded from this audit

`docs/archive/`, `docs/handoff/`, and `docs/reference/` are frozen/static. They must not be
treated as the current implementation specification. Follow current maintained documents and
verify claims against `src/` instead. Frozen material explains **why** the system was designed
this way — never how it currently works.

Frozen contents (2026-10-04 reclassification — completed/historical documents moved out of the
maintained set; no content was rewritten, only archived):

- `docs/archive/` — `guide.md`, `task.md`, `thru-implementation_plan.md` (original build specs);
  the research/spike records (`WALLET_FEATURES_PERFORMANCE_STUDY`, `LAUNCHPAD_UX_STUDY`,
  `THRU_NATIVE_DEFI_TAB_UX`, `PASSKEY_SPIKE`, `EXPLORER_SPIKE`, `TX_DETAIL_SPIKE`);
  `MIGRATION_MAP.md` (UI migration complete — strategy history); `MCP_AGENT_INTEGRATION.md`
  (no companion-agent work scheduled in the wallet-first sequence); `LAUNCHPAD_DEX_MIGRATION_UX.md`
  (research study); `UI_REBUILD_PLAN.md` and `UI_REBUILD_AGENT_PROMPT.md` (completed rebuild).
- `docs/handoff/` — `P2_TX_DETAIL_HANDOFF.md`, `P25_EXPLORER_SPIKE_PROMPT.md` (session hand-offs).
- `docs/reference/` — `modular-ux-architecture-research.md`, `DEVTOOLS_EXTRACT.md` (tool notebook).

---

## 6. Cross-check references

### Official Thru sources

Use these for protocol, SDK, program, and hosted-wallet checks. Match guidance to the repository's exact dependency versions in `package.json`/`package-lock.json`.

- [Thru documentation](https://thru.org/docs/)
- [API and SDK overview](https://thru.org/docs/api-ref/overview/)
- [`@thru/sdk` documentation](https://thru.org/docs/sdks/web-packages/sdk/)
- [`@thru/programs` documentation](https://thru.org/docs/sdks/web-packages/programs/)
- [gRPC API overview](https://thru.org/docs/api-ref/grpc/overview/)
- [Explorer MCP overview](https://thru.org/docs/api-ref/explorer-mcp/overview/) — agent-facing reference; do not assume its response format is a stable extension API
- [Embedded Wallet Integration](https://thru.org/docs/wallet/embedded-wallet-integration/) — current embedded URL is `https://app.tid.sh/embedded`; `https://wallet.tid.sh` is standalone and sends `X-Frame-Options: DENY`; the hosted flow is not an extension-provider contract
- [Thru public GitHub mirror](https://github.com/Unto-Labs/thru) — source cross-check only; the pinned package and live implementation remain the local authorities for shipped behavior

### Rabby History references — UX/code patterns only

- [Rabby Wallet repository](https://github.com/RabbyHub/Rabby)
- [History view directory](https://github.com/RabbyHub/Rabby/tree/develop/src/ui/views/History)
- [`HistoryItem.tsx`](https://github.com/RabbyHub/Rabby/blob/develop/src/ui/views/History/components/HistoryItem.tsx)
- [`transactionHistory.ts`](https://github.com/RabbyHub/Rabby/blob/develop/src/background/service/transactionHistory.ts)

These links inform presentation and wallet-history patterns; they are not authority for Thru RPC, transaction, fee, or account-registration semantics.

---

## 7. Rules for future documentation edits

- If a document says “current”, compare it against `src/`, tests, and the current build before changing it.
- State whether evidence is deterministic/automated, real-browser, or live-chain. Never let a Node test close a browser or live-chain item.
- Label every unshipped idea as a proposal/open item. Do not describe it as a capability.
- If a document is historical, label it as historical rather than silently rewriting the past.
- Do not duplicate the same roadmap or source tree; link to `STATUS_AND_ROADMAP.md` and `CONTEXT.md`.
- Do not edit `docs/archive/`, `docs/handoff/`, or `docs/reference/` as part of maintained-doc updates, and never edit a dated record under `docs/audits/`.
- **Do not create a new top-level markdown document** unless no existing authoritative document can reasonably own the information. Update the owning document instead.
- **When work is completed**, update the authoritative document and freeze/archive the temporary plan under `docs/archive/` — do not write a new status document. (No `PLAN_V2`, `FINAL`, or `STATUS_UPDATE` files.)
- A new audit appends a dated record under `docs/audits/` and refreshes `docs/AUDIT_REPORT.md`; the audit index stays compact.
- For Thru behavior, cite official Thru docs or say “unverified”. For UX research, clearly label external wallets as references only.
