# Rabby-parity redesign proposal — triage

Status: **assessment only, nothing implemented.** Reviewer-supplied plan (tasks A–K + items
#01–#14) checked line by line against the repo at `c3992ae`. This is suggestion set 1 of 4;
three more are pending, so this file records verdicts, not a commitment.

The design critique is largely **correct and worth acting on**. The *instructions* contain
several claims that are stale or that will not compile. Both facts matter.

---

## 1. Factual errors — following these literally breaks the build or a house rule

| # | Claim in the proposal | Reality in this repo | Consequence |
|---|---|---|---|
| 1 | "contract version bumped to **8**" | `CONTRACT_VERSION = 10` (`src/shared/contract/manifest.js:52`). v8 was PR #6 (token transfer), v9 and v10 shipped since; v10 is `tx.getDetail`. | Bumping *to* 8 is a **downgrade** and violates the append-only rule. Correct target is **11**. |
| 2 | `import { trapFocus } from './focus-trap.js'` | No such export. The real API is `focusTrap(container, { onEscape, initial, restoreFocus })` returning `{ destroy, focusables, focusFirst }` (`src/ui/kit/focus-trap.js:96`). | Sample `sheet.js` throws on import. |
| 3 | "Add `src/ui/kit/sheet.js` (bottom sheet, focus-trapped, Escape closes)" | Already exists as `src/ui/domain/tx-detail-sheet.js` — bottom-anchored, focus-trapped, Escape closes, body-parented, 802 lifecycle assertions over it. | Don't write a second one. **Extract** the proven component into `kit/sheet.js` and re-point the detail sheet at it. |
| 4 | "Remove `.eyebrow` from all routes **except export.js**" | `export.js` does **not** use `.eyebrow`. Actual users: `account-detail`, `dashboard`, `faucet`, `keyring`, `send`, `settings`, `seed-phrase-grid` (20 occurrences). | The carve-out protects a file that needs no protection. |
| 5 | Item D: "Delete … lock button" | `test-route-lifecycle.mjs:2455` asserts *"the topbar exposes a lock control"*, then locks via it and asserts the vault locked + redirect + no secrets in torn-down screens. | Deleting the button **fails the suite**. The test must be rewritten to drive lock from Settings in the same commit — and counts must still go up. |
| 6 | #10: "add nanostores" / "migrate to Preact + TS" | `AGENTS.md:58` — *"No new dependencies except first-party Thru packages."* | Hard-rule violation. Both paths are out unless you reverse the rule. |
| 7 | Send amount card sample includes `fiatHint // ≈ $1.46` | No price feed exists. `docs/HISTORY_REDESIGN_PLAN.md:116` lists no-price as an explicit non-goal; CSP `connect-src` is pinned to `rpc.alphanet.thru.org`. | A `$` figure would be **fabricated** — the honesty rule's merge-blocker case. Any fiat needs a feed, a CSP change and a Web Store permissions re-review. |
| 8 | `preflight` sample calls `contactsService.has`, `accountService.owns`, `balanceService.getUnits`, `thruClient.accountExists` | None of those exist. Closest is `getAccountInfo` (`thru-client.js:178`). | Sample is illustrative pseudocode, not drop-in. The *rules* it encodes are sound. |
| 9 | "popup 400×600" | Currently 408×580, and the same document is registered as a resizable **side panel** (`manifest.json` `side_panel.default_path`). | Fine to change, but width is not a free variable — `base.css` documents the 408/`max-width:100%` interaction for the panel. |

**Also flagged:** `chrome.notifications` (item I) adds a *permission*. That triggers a Chrome
Web Store re-review and a user-facing permission prompt on update. It is a release-process
decision, not just code.

---

## 2. Where the critique is right, and should be acted on

Verified against the actual stylesheets — these are not opinions:

- **Radii are 2/3/4px** (`tokens.css:133-135`) and there are **57 `border: 1px solid` rules**
  across the stylesheets. Cards, tiles, rows and the balance box all carry one. Stacking
  bordered boxes inside bordered boxes is the single biggest "unfinished" signal, and the
  fix (contrast + shadow instead of outline) is mechanical.
- **No brand colour.** `--ink: #151b1e` drives primary buttons; `--accent: #d33c43` is the
  warning red. So the "tap this" colour is black and the "careful" colour is the only
  saturated thing on screen — exactly backwards. The attached palette comparison is a fair
  diagnosis.
- **Mono uppercase eyebrows** on every section read as a terminal, not a wallet.
- **Balance is not the hero** — 34px inside a bordered box beside a base-units hint.
- **Three stacked chrome bands** before content (topbar + account pill + footer).
- **Archaeology headers** (#09) — accurate. Though note they have *earned their keep*: those
  headers are why `docs/DEFECT_LOG.md` exists at all. Moving them is right; deleting the
  reasoning is not.

---

## 3. Scope reality

Tasks A–K span: 3,620 lines of CSS, 4,414 lines of routes, the shell, 3 domain components
migrated to a new primitive, 4 new backend services, a contract bump, a permission addition,
a popup resize and a docs pass.

That is **not one PR**. It is not one session. Attempting it as a single change would produce
a diff no auditor can verify line by line, against a house rule that says diffs must be
explainable line by line.

Proposed split — each independently shippable, each keeping gates green:

| PR | Scope | Risk | Notes |
|---|---|---|---|
| **R1** | Tokens + de-bordering (A, B, part of #01/#02) | Low, wide blast radius | Pure CSS. No JS, no contract. Visual diff is the whole point — needs the preview harness. |
| **R2** | Typography + eyebrow removal + balance hero (C, #03) | Low | Touches 7 files; `check-routes.mjs` enforces every class is defined. |
| **R3** | `kit/sheet.js` **extracted** from `tx-detail-sheet.js`, + Skeleton, + screen animation (E) | Medium | Must not regress the route-lifecycle suite (802+, of which the P2 sheet assertions are a subset) nor the stylesheet flex-shrink invariant — that one asserts on built `popup.css` text, so it must still pass and still be falsifiable. |
| **R4** | Shell restructure (D) + avatar (F) | Medium | **Rewrites the lock-control test.** Lock must remain reachable or it is a security regression. |
| **R5** | Send redesign (G) + dashboard (H) | High | Must preserve BigInt parsing, recipient-exists gate, dead-Enter on confirm. |
| **R6** | Backend: `pageState.*` + `tx.preflight` → **contract v11** (I) | High | Append-only. `pageState` in `chrome.storage.session` only — never `local`. |
| **R7** | Watcher/broadcaster split + notifications (I cont.) | High | Permission change → Web Store re-review. Pairs naturally with the version bump. |
| **R8** | Comment cleanup (J) + popup size (K) | Low | Do **last**: it rewrites headers R1–R7 will have already churned. |

R1 and R2 deliver most of the perceived quality jump. R6/R7 are a separate track from the
visual work and should not be bundled with it.

---

## 4. Constraint I cannot satisfy from this environment

The acceptance criterion is *"side-by-side screenshots of Dashboard, Send, Confirm, Accounts,
History in light + dark next to Rabby's equivalents."*

There is no browser in this sandbox — Chrome cannot be installed (CDN blocked, same network
restriction as the Thru RPC endpoints). I can render real built CSS into
`scripts/preview-tx-sheet.html`-style harnesses and serve them for you to look at, and I can
extend that harness to cover every screen. **I cannot produce the screenshots myself.**

This is the same gap that let the sheet-overflow defect ship. Any visual PR here needs a
human looking at a harness before it is called done — that is now written into
`docs/MANUAL_SMOKE_CHECKLIST.md`.

---

## 5. Recommendation

1. Fix the errors in §1 before any of this is handed to an implementer — especially the
   contract version (11, not 8), the `focusTrap` signature, and the lock-control test.
2. Drop the fiat hint and the new-dependency paths outright; they violate standing rules.
3. Wait for the remaining three suggestion sets before sequencing. A token/shape overhaul
   should be designed **once**. If a later set proposes a different palette or a different
   component primitive, doing R1 now means doing it twice.
4. Merge PR #7 first regardless — it is reviewed, green, and every one of these PRs would
   conflict with it.
