# PR #26 — temporary pre-merge verification queue

[PR #26](https://github.com/buildbyravi/thru-wallet-ext/pull/26) · `arena/1b860a7c-thru-wallet-ext`

Use this queue to collect checks while we build. **During development:** rebuild and verify each change in the preview; keep running the automated gates and commit fixes separately. **When the owner calls the PR ready:** run the deferred checks together against one exact candidate SHA. Keep unchecked items visible; a blocked check is not a pass. This is a PR worklist, not a new runbook. After review, retain results in the PR and in the existing smoke log where appropriate, then remove this temporary file before merge. If removal changes HEAD, verify it is docs-only and rerun final CI; retest any runtime changes on the new SHA. No automatic merge or release.

## Final audit handoff — 2026-11-20

**Status: hold for native and live verification, not approved to merge.** Audited runtime commit
`49cdc2dd3cd5ee9b86549424c58e9e820ecc62f0` against the PR base `38434abe`. The subsequent handoff
commit was docs-only. The scoped UI follow-up below supersedes Assets/History interaction results.
Use the actual PR HEAD as the candidate and rebuild/retest if runtime or tests have changed.

| Evidence | Result at the audited runtime commit |
| --- | --- |
| Build and tests | `npm run build` and `npm test` passed: **1,231/1,231** route checks, **15/15** QR checks, plus History, token service, contract, security and docs guards. |
| Dependency and package scope | `npm audit --omit=dev`: **0 advisories reported**. No net changes to manifest/permissions, package manifests or lockfile, contract schema or API router, or the Receive route. The built manifest matched `src/manifest.json`; no preview or fixture pages were packaged. The approved generic close glyph's MIT notice is in `dist/icons/`. |
| Dashboard and Assets fixtures | Chromium 153 at toolbar and narrow sizes: network picker, focus/keyboard, details, hide/restore, import from a filtered Hidden list, and a delayed pre-import reply. The tracked 10/100/200-token harness measured **0 row insertions or removals** on balance-only refresh, with row identity, focus, and scroll preserved. These are not RPC performance measurements. |
| History and Settings fixtures | Flat History, terminal and positive cursors, and the exact network-qualified explorer tab (navigation intercepted in the harness); Settings sheets and focus return at 400×600 and 320×600 in both themes; Side Panel save/restore failures with a Chrome API stub; close/reopen during Theme save on both success and failure. Receive rendered with its original styled/plain toggle; no physical scan. |
| Installed Chrome and Betanet | **Not run on this candidate.** Browser fixtures did not exercise installed MV3, Chrome toolbar behavior, or a real wallet write. Previous read-only explorer evidence and PR #25 evidence do not close these gates. |

**Review threads:** [Theme picker synchronization](https://github.com/buildbyravi/thru-wallet-ext/pull/26#discussion_r4645813318) and [preview token counts](https://github.com/buildbyravi/thru-wallet-ext/pull/26#discussion_r4643990437) are addressed in code and docs respectively. Confirm thread status and review the final head again. A skipped bot check is not independent approval.

**Revert decision:** No additional revert is recommended from the evidence above. Keep Receive as
reverted by `04421bb`; do not restore the abandoned redesign or remove the approved close glyph's
notice. If native/live testing finds a regression, block merge and isolate the smallest affected
change to fix or revert. Prioritize History submit → pending → indexed/detail consistency, Settings
panel behavior after worker restart, and Assets cache/refresh integrity. Do not revert verified
cache fixes merely to remove a visual change, or ship preview fixtures to make a test pass.

## Assets and History UI follow-up

Runtime commit `870d061708c601d17f12722413dd8ad233dd3c3b` implements the focused Vercel Web Design
Guidelines / Uizze audit findings using the existing wallet components and layout. `npm run build`
and `npm test` passed (1,231/1,231 route checks). Chromium 153 fixture checks passed:

- Assets at 10/100/200 tokens: the toolbar stays reachable while the list scrolls; Back and Escape
  restore the originating row and scroll position; hiding that row returns focus to Search. A long
  no-results query does not overflow, and the status copy does not echo it. Balance-only refreshes
  still insert/remove zero rows and preserve focus and scroll. Import/refresh overlap still passes.
- History at 320×445 light and 400×600 dark: all four filters fit normally, with wrap available at
  tighter sizes. Keyboard activation of the explorer, Copy, and details is independent; Enter/Space
  open details and Escape restores focus. The explorer URL matched Betanet with navigation intercepted.

These are browser fixtures, not installed Chrome, assistive-technology, or live chain evidence.

## Dashboard network sheet follow-up

Runtime commit `b7d20fadeac1e10dbdf17bea1d41aab91d8b4b59` replaces the dashboard's
standalone-route navigation with the shared bottom-sheet scaffold hosting the existing focused
Settings network view. Settings still owns the same network rows and background calls; quarantined
custom networks remain inert. No new network capability, endpoint, permission, or SDK was added.
Pending feedback guards repeat requests and dismissal until the reply; failures remain visible and
retryable. Direct balance-predicate tests cover verified zero without decimals, unsupported positive
decimals, RPC error, and the absent-account null-units convention.

`npm run build` and `npm test` passed (1,236/1,236 route checks; QR 15/15). Tracked Chromium 153
`test/browser/network-chooser.mjs` passed 320×445 light and 400×600 dark, reduced motion: modal,
quarantine, delayed success/failure, duplicate suppression, dismissal/focus, and no external requests.
Settings picker, theme-reopen, side-panel failures, and 10/100/200 Assets fixtures also passed.
A selectable second network in that browser test is **synthetic**; it does not enable Testnet in the
product or demonstrate an actual network switch. Native extension, live network, independent review,
and owner approval remain open below.

## Address contrast follow-up

Runtime commit `b3ff4db1ccb2f377ea1c6b851847c6adb8770a89` fixes shared truncated
wallet and token addresses inheriting black text from buttons in dark mode. Dashboard's branded
header retains its existing light-on-ink color. `npm run build` and `npm test` passed (1,236/1,236
route checks, 15/15 QR). Chromium 153 fixture `test/browser/address-contrast.mjs` verifies at least
4.5:1 computed foreground/background contrast for token and account rows, normal and hover in both
themes, and full-address accessibility labels. Before the fix, dark token-row contrast was 1.30:1.
Tracked Assets 10/100/200 and network chooser browser fixtures also passed. These are mocked checks,
not installed-extension or assistive-technology evidence.

## Settings wallet branding follow-up

Runtime commit `635cfa8377c86fb3f57a76a0ff71772e4c9bcb72` uses the existing packaged wallet
icon in the Settings footer rather than the native THRU token icon, with no circular crop and no
manifest/icon-asset change. `npm run build` and `npm test` passed (1,237/1,237 route checks;
15/15 QR). Chromium fixtures verified the decoded footer icon at 320×600 dark and 400×600 light,
plus Settings picker behavior in both themes. Installed extension verification remains open.

## Automated browser coverage audit

At `66fd2863534544aa00f43f97a0d19e2e605b09e7`, `npm run build`, `npm test`
(1,237/1,237 route checks and 15/15 QR), and `npm audit --omit=dev` passed; Chromium 153 with
Playwright Core 1.65.1 passed the three then-checked-in browser scripts. Broader temporary preview
fixtures passed Dashboard, Assets import/overlap, Settings, Theme, Side Panel stubs, History,
Receive rollback, and logos. Two older temporary scripts initially failed because they targeted the
old dialog scroll container and History card container; after adapting them to the current inner
scroll container and native details button, they passed. These failures were stale fixture selectors,
not deleted assertions. No real keys, extension worker, production RPC or on-chain actions were used.

The committed browser suite now also covers History controls and Settings theme reopen/error /
password-dialog handoff without the hosted fixture. Run `npm run test:browser` after building; setup
and scope are documented in `test/browser/README.md`. These additions are test-only and do not
replace installed-Chrome or live Betanet checks. Side Panel browser checks remain temporary fixtures;
tracked Node/DOM tests cover its save/restore logic but do not emulate the real Chrome API lifecycle.

## While building — preview and deterministic tests

- [ ] For each UI change, run `npm run build` and `npm test`, refresh the hosted fixture from the current bundles, and record the SHA, scenario, and result. The **hosted Assets fixture** serves `/scripts/preview-tx-review.html?tokens=200`; use `?tokens=10` or `?tokens=100` there to change sample size. The **checked-in** `scripts/preview-tx-review.html` is a distinct transaction-review harness with fixed cases, not a local copy of that hosted page. For repeatable local 10/100/200 sizes, run [the browser regression](../test/browser/token-cache.mjs) after building (set `PLAYWRIGHT_MODULE` and `CHROME_BIN` as shown in its header). Fixtures use no real keys, vault access, signing, or production RPC.
- [x] Dashboard preview at popup size (~400×600) and narrow (~320px), light/dark and keyboard: balance card and icon strip (THRU, up to three token icons, then `+N`), no token names on the card, no clipped Assets opener, guarded network chooser, correct dismissal and focus return. Token names remain in Assets.
- [x] Assets fixture coverage with 10/100/200 synthetic tokens: search, detail and back, Hidden tokens, restore, Add custom token and close controls; verify empty/error states and reachable actions. Simulate a refresh: changed balances update in place without losing row identity, focus or scroll. `test/browser/token-cache.mjs` covers cached first paint, partial refresh, verified zero and uncached failure with the isolated bridge.
- [x] Reproduce a late registry snapshot undoing Hide during refresh. Fence both cached and live paints after a completed hide/restore, and cover the race in the route suite.
- [x] Reproduce and fix post-import refresh joining the old registry. Deterministic tests cover same-snapshot coalescing, late replies, cache protection, and importing from Hidden tokens without keeping an old search filter. Native import/refresh remains part of the batch below.
- [x] Preserve History's terminal cursor on cache hits, offline fallback, and local submissions. Regression tests cover legacy cached zero, missing cache, and a last page without a Load more action.
- [x] Theme picker: deferred saves cannot leave a reopened picker stale; a rejected save keeps the previous selection and reports the error in the open picker.
- [x] Side Panel Mode stubs: cover Chrome rejection, failed save with restore, lost reply after successful save, and failed restore with an explicit warning. The native toolbar and worker-restart checks below remain open.


## One batch at merge readiness — unpacked Chrome

Follow the canonical [Manual Smoke Checklist](MANUAL_SMOKE_CHECKLIST.md), including its reload steps and 15-route matrix. Use a disposable Chrome profile, never a personal browser profile or wallet. Build the exact candidate; reload the extension in `chrome://extensions`, then close and reopen both contexts.

- [ ] Open the actual toolbar popup and Chrome side panel, including both panel entry points. Toggle Side Panel Mode on and off, verify toolbar/panel mutual exclusion (including a short window), persistence after worker restart, correct routes, and lock propagation. In Settings, verify separate pickers, theme persistence and focus return, password-gated signing/auto-lock, and disabled Language/Currency. A web page using `?thru_panel=1` does not count.
- [ ] Run the route matrix in both contexts, including redirects and offline behavior. Check narrow and wide panel, short popup, live resize, zoom, light/dark, keyboard, focus trap and return, usable scrolling, and no clipping or console/CSP errors.
- [ ] Repeat Dashboard and Assets interactions through the real extension: icon strip, dashboard network sheet and Settings network picker, focus/escape, first paint, token names/details, hide/restore, import and refresh where supported. Check any approved real network switch for pending, failure, and result; never enable a quarantined network for testing. Check wallet and token address readability in light and dark themes. Confirm opening/closing with keyboard returns focus to the opener, and Back/Escape from a token restores the list position and row focus without covering the focused row. Keep large-list numbers in preview coverage unless a safe native fixture is available.
- [ ] Check Receive copy and scan the QR on a second device against the same disposable address. Check History details and honest time/fee labels, and verify the hash link, Copy, and details as separate keyboard controls; verify that the transaction list stays flat, including when dates cross midnight or are unavailable. Recheck any additional UI landed during development.
- [ ] Exercise shared review and toast across native send, token send, domains and faucet: correct context, fees and full counterparties, blocking and single-use behavior, no fake simulation, honest unknown outcome and one toast. Check worker idle/wake and restart, auto-lock, secret cleanup on lock/navigation, and custom-RPC quarantine as described in the runbook.

## Same batch — live Betanet and final sign-off

- [ ] On an RPC-reachable host, with owner-approved disposable Betanet accounts and test funds only: verify token import with a known mint, rejection of invalid/duplicate mints, balance and cache behavior after real reads, reviewed native/token send and recipient activation, faucet, and History/explorer reconciliation. Compare the identical network and signature from submission, pending settlement, History card/detail and the live explorer; compare decoded amounts/program and block time where available. Record exact scope and outcome, public test transaction IDs where useful, and failures; never record secrets.
- [ ] Review the existing [release blockers and verification sequence](STATUS_AND_ROADMAP.md#3-release-blockers--ordered-next-work) and [audit gates](AUDIT_REPORT.md). Treat the changed workflows above as this PR's verification scope. Track inherited release gates separately: registrar fee/hash evidence and records, broader multi-account verification, external security audit, and Mainnet authorization. Do not mark inherited checks done without evidence or enable Mainnet, custom RPC, or quarantined features.
- [ ] On the final candidate run `npm run build && npm test` and `npm run test:browser` with the documented external Playwright/Chromium setup, and applicable release checks, including `npm audit --omit=dev` where required. Confirm CI and independent review at the final SHA, resolve remaining findings, and confirm no preview fixtures, permissions changes or release changes were unintentionally included.
- [ ] Record candidate SHA, OS/Chrome version, date, tester, contexts/sizes, and each result as pass/fail/blocked/not applicable, with links or a brief reason. Keep preview, native Chrome, live Betanet and audit evidence separate. Stop for owner review and explicit merge approval.
