# Documentation index and audit

Date: 2026-09-18  
Purpose: single map for every maintained Markdown document in this repository. Use this file to avoid stale/duplicated context when multiple agents work on the wallet.

---

## 1. Read order

### For any coding change

1. `AGENTS.md` — hard rules, commands, traps, reporting format.
2. `docs/STATUS_AND_ROADMAP.md` — current state and next engineering tasks.
3. `docs/PROJECT_LEDGER.md` — past/present/future build ledger and source-of-truth identifiers.
4. `CONTEXT.md` — file-by-file map of the current tree.
5. The feature-specific doc below.

### For architecture and feature planning

1. `docs/MODULE_BOUNDARIES.md` — required feature/backend/adapter separation.
2. `docs/WALLET_FEATURES_PERFORMANCE_STUDY.md` — wallet feature set and no-lag scaling model.
3. `docs/THRU_NATIVE_DEFI_TAB_UX.md` — Thru-native launchpad/DEX/full-tab UX.
4. `docs/MIGRATION_MAP.md` — Rabby-class migration strategy and risk register.

### For security work

1. `docs/AUDIT_REPORT.md` — findings and remediation state.
2. `docs/DEFECT_LOG.md` — historical defects and lessons.
3. `docs/BUILD_SPEC.md` — product/security policy and QA matrix.
4. `SECURITY.md` — public security policy.

### For AI agents and MCP planning

1. `llms.txt` — short read-only agent context.
2. `docs/MCP_AGENT_INTEGRATION.md` — safe local MCP companion model.
3. `docs/MODULE_BOUNDARIES.md` — what agents may edit without crossing feature boundaries.

---

## 2. Current source-of-truth split

| Question | Source of truth |
| --- | --- |
| What branch/state am I in? | `docs/PROJECT_LEDGER.md`, then `git status` |
| What do I run? | `AGENTS.md`, `README.md` |
| What is implemented right now? | `docs/STATUS_AND_ROADMAP.md`, `CONTEXT.md` |
| What files own each layer? | `CONTEXT.md`, `docs/MODULE_BOUNDARIES.md` |
| What are the contract methods? | `src/shared/contract/manifest.js` |
| What is the contract version? | `src/shared/contract/manifest.js` (`CONTRACT_VERSION`) |
| What must never be guessed? | `AGENTS.md`, `docs/BUILD_SPEC.md` |
| What launchpad/DEX direction is correct? | `docs/THRU_NATIVE_DEFI_TAB_UX.md` |
| What popular-wallet UX patterns matter? | `docs/WALLET_FEATURES_PERFORMANCE_STUDY.md` |
| What bugs have happened before? | `docs/DEFECT_LOG.md` |
| What backend capability is missing? | `docs/BACKEND_GAPS.md` |
| What docs are historical only? | `docs/archive/**`, `docs/UI_REBUILD_PLAN.md`, `docs/UI_REBUILD_AGENT_PROMPT.md` unless explicitly cited by current docs |

---

## 3. Maintained root documents

| File | Status | Owns | Notes from audit |
| --- | --- | --- | --- |
| `README.md` | current overview | product summary, commands, current architecture | Keep concise; do not duplicate long roadmaps here. |
| `AGENTS.md` | current rules | coding rules, commands, secrets, testing, reporting | Should stay short enough to load in every agent context. |
| `CONTEXT.md` | current map | file-by-file current tree | Refresh after significant source moves or route/contract count changes. |
| `SECURITY.md` | public policy | threat model, responsible disclosure, high-level security architecture | Should remain user-facing; avoid internal planning noise. |
| `PRIVACY.md` | public policy | local/RPC data behavior | Should stay product-facing and non-speculative. |
| `SUPPORT.md` | public support | FAQ, known limitations, help channels | Keep aligned with `STATUS_AND_ROADMAP.md`. |
| `llms.txt` | current agent brief | read-only safe AI context | No secrets, no direct signing instructions. |

---

## 4. Maintained docs directory

| File | Status | Owns | Merge/split decision |
| --- | --- | --- | --- |
| `docs/STATUS_AND_ROADMAP.md` | current | exact current state, verified/not verified, next tasks | Kept separate because it changes frequently. |
| `docs/PROJECT_LEDGER.md` | current | past/present/future build ledger and identifiers | New canonical timeline; replaces duplicated local-agent phase tables. |
| `docs/MODULE_BOUNDARIES.md` | current | frontend/backend/feature/adapter separation target | New canonical boundary doc for launchpad/DEX/prediction isolation. |
| `docs/MCP_AGENT_INTEGRATION.md` | current | local MCP companion safety model | New planning doc; no MCP code shipped yet. |
| `docs/WALLET_FEATURES_PERFORMANCE_STUDY.md` | current | general wallet features and no-lag performance model | Product research; references only, not implementation authority. |
| `docs/THRU_NATIVE_DEFI_TAB_UX.md` | current product direction | Thru-native launchpad/DEX/full-tab UX correction | Keep separate from implementation ledger. |
| `docs/MIGRATION_MAP.md` | current strategy/risk register | Rabby-class migration strategy | Some older research context remains; defer to `MODULE_BOUNDARIES.md` for feature separation. |
| `docs/AUDIT_REPORT.md` | current audit record | security findings/remediation state | Keep separate from `DEFECT_LOG`: audit findings vs historical defect lessons. |
| `docs/DEFECT_LOG.md` | current historical lessons | root causes and guardrails | Historical defects can mention deleted code, but current-state claims must point to `STATUS`. |
| `docs/BACKEND_GAPS.md` | current capability gaps | backend missing pieces and verified unsupported states | Keep capability-focused; do not duplicate roadmap details. |
| `docs/BUILD_SPEC.md` | current policy/spec | product requirements, security policy, QA matrix | Status ledger inside it is now summarized; exact current state lives in `STATUS`. |
| `docs/UI_REBUILD_PLAN.md` | historical plan/reference | original rebuild audit and phase plan | Marked historical; use only for rationale, not current file facts. |
| `docs/UI_REBUILD_AGENT_PROMPT.md` | historical prompt/reference | original autonomous rebuild prompt | Do not execute as current plan without checking `STATUS`. |

---

## 5. Archive/reference docs

| File | Status | Rule |
| --- | --- | --- |
| `docs/archive/guide.md` | archived | Do not follow for current structure; kept for provenance. |
| `docs/archive/task.md` | archived | Contains completed/obsolete phase claims; do not use as current status. |
| `docs/archive/thru-implementation_plan.md` | archived | Historical redesign plan; not authoritative. |
| `docs/reference/modular-ux-architecture-research.md` | reference | Research notes only; use `MODULE_BOUNDARIES.md` for current target architecture. |

---

## 6. Duplicate-context decisions made by this audit

1. Long duplicated local-agent phase tables were **not** pasted verbatim into docs. They contained many repeated rows and stale counts. A deduplicated canonical ledger was added in `docs/PROJECT_LEDGER.md`.
2. Feature/performance study content was split into `docs/WALLET_FEATURES_PERFORMANCE_STUDY.md`, not mixed into `STATUS_AND_ROADMAP.md`.
3. Launchpad/DEX/prediction separation was split into `docs/MODULE_BOUNDARIES.md`, not buried inside launchpad UX research.
4. MCP/AI-agent safety was split into `docs/MCP_AGENT_INTEGRATION.md`, not implemented inside the extension service worker.
5. `STATUS_AND_ROADMAP.md` remains the only frequently changing current-state roadmap.
6. `CONTEXT.md` remains the current file map; historical line counts in archived docs are intentionally non-authoritative.
7. Public docs (`README.md`, `SECURITY.md`, `PRIVACY.md`, `SUPPORT.md`) should not carry detailed internal research dumps.

---

## 7. Rules for future doc edits

- If a doc says “current”, it must be updated when source files, route counts, contract version, or next priorities change.
- If a doc is historical, add a top warning instead of rewriting history.
- Do not paste raw chat transcripts containing credentials, even revoked ones.
- Do not duplicate the same roadmap in more than one file. Link to `STATUS_AND_ROADMAP.md`.
- Do not duplicate the same file tree in more than one file. Link to `CONTEXT.md` and `MODULE_BOUNDARIES.md`.
- For Thru protocol behavior, cite official Thru docs or say “unverified”.
- For UX research, clearly label external wallets/products as references only.
