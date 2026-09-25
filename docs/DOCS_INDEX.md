# Documentation index

Date: 2026-09-26
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

1. `docs/MODULE_BOUNDARIES.md` — current core boundaries and clearly labelled, unshipped feature-module target.
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
| `llms.txt` | current agent brief | read-only repository context | No secrets or direct signing instructions. |

---

## 4. Maintained documents under `docs/`

| File | Status | Owns |
| --- | --- | --- |
| `docs/DOCS_INDEX.md` | current | this map and source-of-truth split |
| `docs/STATUS_AND_ROADMAP.md` | current | shipped state, verification, and open work |
| `docs/PROJECT_LEDGER.md` | current | contract identifiers, milestones, known unresolved work |
| `docs/BUILD_SPEC.md` | current policy/spec | shipped wallet behavior, security policy, and test expectations |
| `docs/BACKEND_GAPS.md` | current capability inventory | implemented backend capabilities and genuinely open/unsupported behavior |
| `docs/MANUAL_SMOKE_CHECKLIST.md` | current runbook | real-browser and live-chain checks; not a test result |
| `docs/DEFECT_LOG.md` | historical lessons + current status | defect causes, fixes, guardrails, and residual verification gaps |
| `docs/MODULE_BOUNDARIES.md` | current core boundaries + unshipped target | wallet-core layering; future feature modules are proposals, not shipped code |
| `docs/HISTORY_REDESIGN_PLAN.md` | current implementation record | shipped flat History stream/cache/detail behavior and open validation |
| `docs/SEND_PATH_AUDIT.md` | current focused audit | Send path, registration, tests, and residual risks |
| `docs/MCP_AGENT_INTEGRATION.md` | planning/reference | safe local MCP model; no extension MCP feature is claimed shipped |
| `docs/MIGRATION_MAP.md` | strategy/reference | Rabby-class migration ideas; verify every claim against `src/` before treating it as implemented |
| `docs/LAUNCHPAD_DEX_MIGRATION_UX.md` | research only | design study; no launchpad, DEX, or prediction UI ships |
| `docs/REDESIGN_TRIAGE.md` | findings record | triage of external UX suggestions; re-check claims before implementation |
| `docs/AUDIT_REPORT.md` | historical audit with a newer audit link | older findings and remediation history; its counts/defaults are not current-state authority |
| `docs/UI_REBUILD_PLAN.md` | historical plan/reference | original rebuild rationale; not current structure or task status |
| `docs/UI_REBUILD_AGENT_PROMPT.md` | historical prompt/reference | original prompt; do not execute as the current plan |

---

## 5. Frozen directories — excluded from this audit

`docs/archive/`, `docs/handoff/`, and `docs/reference/` are frozen/static. They were not inspected or edited for this documentation update and must not be treated as the current implementation specification. Follow current maintained documents and verify claims against `src/` instead.

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
- Do not edit `docs/archive/`, `docs/handoff/`, or `docs/reference/` as part of maintained-doc updates.
- For Thru behavior, cite official Thru docs or say “unverified”. For UX research, clearly label external wallets as references only.
