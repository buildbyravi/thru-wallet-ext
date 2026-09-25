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
2. `docs/MIGRATION_MAP.md` — Rabby-class migration strategy and risk register.

### For UI or browser verification work

1. `docs/MANUAL_SMOKE_CHECKLIST.md` — what only Chrome can prove: popup + side panel, narrow + wide
   widths, all 14 routes, focus, secret hygiene.
2. `test-route-lifecycle.mjs` — the automated half: every route mounts, tears down and keeps
   secrets out of the DOM.
3. `docs/UI_REBUILD_PLAN.md` — historical rationale for the current stack.

### For security work

1. `docs/AUDIT_REPORT.md` — findings and remediation state.
2. `docs/DEFECT_LOG.md` — historical defects and lessons.
3. `docs/BUILD_SPEC.md` — product/security policy and QA matrix.
4. `SECURITY.md` — public security policy.

### For AI agents and MCP planning

1. `llms.txt` — short read-only agent context for this repository.
2. `https://thru.org/docs/llm.txt` — official Thru protocol-doc entry point for agents.
3. `docs/MCP_AGENT_INTEGRATION.md` — official Explorer MCP preference plus safe local wallet MCP model.
4. `docs/MODULE_BOUNDARIES.md` — what agents may edit without crossing feature boundaries.

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
| What launchpad/DEX direction is correct? | `docs/archive/THRU_NATIVE_DEFI_TAB_UX.md` — research/direction only; **no launchpad, DEX or prediction code ships** |
| What is quarantined and must not return? | `docs/STATUS_AND_ROADMAP.md` Step 1, `CONTEXT.md` §9, `test-launchpad-quarantine.mjs` |
| What popular-wallet UX patterns matter? | `docs/archive/WALLET_FEATURES_PERFORMANCE_STUDY.md` |
| What bugs have happened before? | `docs/DEFECT_LOG.md` |
| What needs a browser to verify? | `docs/MANUAL_SMOKE_CHECKLIST.md` |
| Is a route actually mounted by a test? | `test-route-lifecycle.mjs`, then `docs/STATUS_AND_ROADMAP.md` Step 2 |
| What backend capability is missing? | `docs/BACKEND_GAPS.md` |
| What can a per-transaction fetch honestly tell us (fee? timestamp?) | `docs/archive/TX_DETAIL_SPIKE.md` |
| Where is the Activity/history redesign up to? | `docs/HISTORY_REDESIGN_PLAN.md` |
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
| `docs/LAUNCHPAD_DEX_MIGRATION_UX.md` | research only | Launchpad-to-DEX migration, charts, market UX | Retained after the launchpad quarantine. Design study; no DEX, chart or market code ships. |
| `docs/MIGRATION_MAP.md` | current strategy/risk register | Rabby-class migration strategy | Some older research context remains; defer to `MODULE_BOUNDARIES.md` for feature separation. |
| `docs/AUDIT_REPORT.md` | historical audit + current link | security findings/remediation state | Historical counts/defaults are superseded by the 2026-09-24 Send-path audit linked at the top. |
| `docs/SEND_PATH_AUDIT.md` | current focused audit | Send performance, UI–bridge–worker integration, adjacent balance honesty, residual risks | Deterministic tests only; browser/live-network validation remains manual. |
| `docs/DEFECT_LOG.md` | current historical lessons | root causes and guardrails | Historical defects can mention deleted code, but current-state claims must point to `STATUS`. |
| `docs/BACKEND_GAPS.md` | current capability gaps | backend missing pieces and verified unsupported states | Keep capability-focused; do not duplicate roadmap details. |
| `docs/HISTORY_REDESIGN_PLAN.md` | current phase plan | Activity/history redesign (P0–P3) and its honest omissions | Status line at the top wins on which phases have shipped. |
| `docs/REDESIGN_TRIAGE.md` | current findings record | line-by-line triage of external Rabby-parity design suggestions (set 1 of 4) | Records which suggestions are stale/unsafe vs actionable; re-verify claims against the tree before acting on any future set. |
| `docs/handoff/P2_TX_DETAIL_HANDOFF.md` | current handoff | auditor entry point for the P2 detail sheet (PR #7) | Gate results, honesty claims + falsification, known gaps. Read before auditing the sheet. |
| `docs/handoff/P25_EXPLORER_SPIKE_PROMPT.md` | current prompt | self-contained prompt for the P2.5 explorer-enrichment spike | Durable home for a prompt that previously lived only in chat. Already carries the two 2026-09-20 amendments (layout-must-be-seen line; question 2 rewritten now that C2c is closed). |
| `docs/MANUAL_SMOKE_CHECKLIST.md` | current runbook | browser-only verification before merging UI changes | Not a test and not a spec. If an item becomes automatable, move it into `test-route-lifecycle.mjs` and delete the checkbox. |
| `docs/BUILD_SPEC.md` | current policy/spec | product requirements, security policy, QA matrix | Status ledger inside it is now summarized; exact current state lives in `STATUS`. |
| `docs/UI_REBUILD_PLAN.md` | historical plan/reference | original rebuild audit and phase plan | Marked historical; use only for rationale, not current file facts. |
| `docs/UI_REBUILD_AGENT_PROMPT.md` | historical prompt/reference | original autonomous rebuild prompt | Do not execute as current plan without checking `STATUS`. |

---

## 5. Archive/reference docs

| File | Status | Rule |
| --- | --- | --- |
| `docs/archive/LAUNCHPAD_UX_STUDY.md` | archived | Launchpad create/discover UX study. Retained after the launchpad quarantine; its "the wallet already has a disabled `src/launchpad/` surface" premise is stale — that tree is deleted. |
| `docs/archive/THRU_NATIVE_DEFI_TAB_UX.md` | archived | Thru-native launchpad/DEX/full-tab UX direction. Describes a surface that does not exist in code; never read as current state. |
| `docs/archive/WALLET_FEATURES_PERFORMANCE_STUDY.md` | archived | General wallet features and no-lag performance model. Product research; references only, not implementation authority. |
| `docs/archive/PASSKEY_SPIKE.md` | archived | Time-boxed passkey feasibility spike on the pinned `@thru/programs/passkey-manager` bindings. Protocol feasible; implementation stays gated on its three probes. |
| `docs/archive/TX_DETAIL_SPIKE.md` | archived | What the RPC surface can/cannot answer for ONE transaction (fee, timestamp). Records SDK/protobuf contract facts; nothing in it was confirmed against a live node. |
| `docs/archive/EXPLORER_SPIKE.md` | archived | P2.5 explorer/oracle/indexer spike: validated surfaces, wire evidence, blocked items, resume checklist. No fabricated shapes; contract stayed v10. |
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
8. The launchpad/DEX UX studies were **retained, not deleted**, when `src/launchpad/**` was quarantined: research is cheap to keep and expensive to recreate. They are labelled research-only here and carry a top banner saying no shipped code corresponds to them, so an agent cannot mistake a design study for current state.
9. On 2026-09-23 the dated spike/research docs (launchpad UX study, Thru-native DEX-tab UX, wallet-features/performance study, passkey spike, tx-detail spike, explorer spike) moved to `docs/archive/` once the work they informed was shipped or shelved. Nothing was deleted — only the location changed, and cross-references now point at `docs/archive/...`. `LAUNCHPAD_DEX_MIGRATION_UX.md` stays at the root as maintained research.

---

## 7. Rules for future doc edits

- If a doc says “current”, it must be updated when source files, route counts, contract version, or next priorities change.
- If a doc is historical, add a top warning instead of rewriting history.
- Do not paste raw chat transcripts containing credentials, even revoked ones.
- Do not duplicate the same roadmap in more than one file. Link to `STATUS_AND_ROADMAP.md`.
- Do not duplicate the same file tree in more than one file. Link to `CONTEXT.md` and `MODULE_BOUNDARIES.md`.
- For Thru protocol behavior, cite official Thru docs or say “unverified”.
- For UX research, clearly label external wallets/products as references only.
