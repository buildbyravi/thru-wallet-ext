# Transaction review pipeline (contract v29) — verification record

Date: 2026-10-28
Scope: PR #21 — "One shared transaction review pipeline (contract v29)", branch
`arena/0439c226-thru-wallet-ext`, head `723d03b`.
Class: **operational verification** (what was checked, how, and what remains unchecked). It does
not claim a Rabby-audited design, a live-chain run, or a browser-layout sign-off.

This record answers three questions the owner asked in one pass:

1. how Rabby actually builds approval/send/swap/dapp flows, and where it is over-built or
   duplicated;
2. whether the shipped v29 review pipeline matches what it claims;
3. which Domain-lifecycle capabilities exist today and which are genuinely missing.

---

## 1. Method

- Workspace was behind its own branch (working tree sat on the pre-PR commit `1b9d096` with the
  v29 changes present only as uncommitted files). Restored with
  `git reset --hard origin/arena/0439c226-thru-wallet-ext`; the tree is now byte-identical to the
  pushed PR head (`git diff HEAD origin/…` is empty). `node_modules`/`dist` are not snapshotted,
  so `npm install` + `npm run build` were re-run before any verification.
- Rabby was read from the real repository at `develop` (GitHub contents API, individual files —
  not screenshots, not marketing pages). Files named in §2 are the ones actually read.
- Local gates: `npm run build`, `npm test` (2,326 checks after the §4, §10 and §11 fixes), `scripts/check-layering.mjs`,
  `scripts/check-routes.mjs`, `scripts/check-csp.mjs` via the build, plus the new browser harness
  in §5.
- No browser binary exists in this sandbox, so **no automated screenshot or layout assertion is
  claimed**. §5 states exactly what was and was not proven.

---

## 2. Rabby: how the real thing is built

### 2.1 One approval surface, two callers

- A dapp request reaches `src/background/controller/provider/rpcFlow.ts`, which calls
  `notificationService.requestApproval({ approvalComponent, params, account, origin })`
  (`rpcFlow.ts:346`, and again in `requestApprovalLoop` at `rpcFlow.ts:553–576`).
- The wallet's **own** Send screen does not sign either: it calls
  `wallet.sendRequest({ method: 'eth_sendTransaction', params })`
  (`src/ui/views/SendToken/index.tsx:1222`), i.e. the wallet's UI is just another RPC client of
  its own provider. One funnel, one review.
- `src/ui/views/Approval/index.tsx` dispatches on `approval.data.approvalComponent`, and it
  **fails closed**: an unknown component is rejected *by the exact approval id just read*
  (`wallet.rejectApprovalFor({ approval: { id, component } })`) rather than rendering nothing and
  leaving a dangling approval. The queue is re-read on `EVENTS.RELOAD_APPROVAL`.
- The review is keyed by approval id; a race can never resolve a different request than the one
  rendered.

### 2.2 How the review screen is composed (`SignTx.tsx`, 3,187 lines)

- Card 1 — origin/protocol identity, chain, security level, and `BalanceChangeWrapper`
  (balance change is rendered only when a pre-exec result actually exists).
- Card 2 — `Actions/index.tsx`: action header (`getActionTypeText`), a question-mark
  "not decoded" affordance (`NoActionAlert`) when the action is a bare `contractCall`, and a
  `Col`/`Row` table (`Actions/components/Table.tsx`: label left / value right, `desc-list` for
  sub-values, `wrap` for long text).
- Card 3+ — per-action detail (`Actions/Send.tsx`, `Swap.tsx`, `ContractCall.tsx`, …).
- Raw data is behind `TxComponents/ViewRawModal`; risk is a separate rules engine
  (`@rabby-wallet/rabby-security-engine`, config with per-rule `enable`/`customThreshold`, merged
  in `background/service/securityEngine.ts`) whose results render as tags plus a rule drawer.
- The footer (`FooterBar`) is gated on `securityLevel` / `isSubmitting`, so confirm lives outside
  the content the user scrolls.

### 2.3 Decoding is split, and depends on a server

- Client-side parsing lives in the `@rabby-wallet/rabby-action` package (`parseAction` →
  `ParsedTransactionActionData`).
- Simulation/explain lives server-side (`openapi` `ExplainTxResponse`, `abi_str`, pre-exec balance
  change). Rabby's review is therefore only as good as a remote indexer it operates.
- **Thru has no such service.** Our decoders are deterministic and local, and every unknown is
  explicit — a deliberate divergence, not a gap to close by copying Rabby.

### 2.4 Post-submit

- `background/service/transactions.ts` is a 20-row-per-address cache;
  `transactionBroadcastWatcher.ts` polls relayed requests and removes an entry on
  `is_finished` / `push_status === 'failed'` / `tx_id`, then updates history and emits
  `RELOAD_TX`. Thru's `pending-tx-service` has the same shape but is stricter: a 5-minute
  watch that ends in `unknown`, never `failed`.

### 2.5 What is over-engineered or duplicated in Rabby (patterns NOT copied)

| Observation | Evidence |
| --- | --- |
| Two signing paths for the same swap | `Swap/Component/Main.tsx:263,351` (`wallet.dexSwap` / `buildDexSwap`, approval-based) **and** `Main.tsx:878` `openDirect` via `useMiniSigner` (mini-sign popup). Plus `useMiniApprovalDirectSign`. |
| At least three overlapping gas UIs | `TxComponents/GasSelectorHeader.tsx`, `TxComponents/GasSelector/*` (8 files incl. `SignMainnetGasSelectorHeader`), `FooterBar/GasLessComponents`, `GasAccount`. |
| Per-action bespoke layouts | 45 files in `Approval/components/Actions/` plus a parallel `TypedDataActions/` tree; reuse exists only at the `Table`/`Card` level. |
| Very large surface for one extension | 74 top-level views, 40 background services, 84 top-level shared component directories (`src/ui/component/`); the swap feature alone is 32 files + 12 hooks. |
| One component holding unrelated concerns | `SignTx.tsx` (3,187 lines) mixes gas selection, EIP-7702, Gnosis Safe nonces, Cobo, Ledger/imKey, gasless and swap-gas in one state machine. |
| Known drift admitted in-source | `Approval/index.tsx` documents that `'Unlock'` (and other non-dispatch components) could reach the approval surface via races — hence the fail-closed guard. |

### 2.6 Patterns that were worth copying, and are in v29

Single funnel for every caller; fail-closed unknown; review keyed by identity and re-checked;
summary card + details table + raw disclosure; balance change only when proven; risk shown as
structured warnings rather than prose; a footer whose confirm is gated on readiness. Rabby's EVM
gas semantics, ABI decoding, remote-explain dependency, mini-sign shortcut and per-action screens
are explicitly **not** copied.

---

## 3. Verification of PR #21 against its own claims

| # | Claim | Evidence | Verdict |
| --- | --- | --- | --- |
| 1 | One pipeline, no parallel lifecycle | `review-service.js`; `review/kinds.js`; Send `routes/send.js`; Domain `routes/name.js`; Faucet `routes/faucet.js` | **Met for every shipped value-moving route** (faucet migrated 2026-10-28). Two caveats are stated, not hidden: the pre-existing `intent-service`/`defi/*` lifecycle still exists behind the off `DEFI_INTENT` gate (§12 F-01), and the reviewed signing methods stay directly callable at the API boundary (§12 F-02). |
| 2 | Append-only contract, v29 | `shared/contract/manifest.js` (`CONTRACT_VERSION = 29`, 3 methods, `since: 29`); `test/test-contract.mjs` 161/161 | Met. No existing method signature changed. |
| 3 | The pipeline never signs | `prepareReview` reads facts + decodes; `confirmReview` returns the recorded `{method, params}`; submission runs through each operation's existing handler | Met. Verified by test section 8 ("confirming does not sign"). |
| 4 | Unknown can never be signed | `registry.js` throws `REVIEW_KIND_UNSUPPORTED`; `raw` kind has `submit: null`; `review-service` forces `state:'blocked'` whenever `submitPolicy` is null; `assertReview` rejects a null policy on a `ready` review | Met, and covered by tests 11. |
| 5 | No fabricated fee or post-tx balance | `model.js` rejects a non-null `assets.balanceAfter`; `fee.supported:false` must carry a reason; token transfers declare their fee unmeasured instead of borrowing the native number (`review/kinds.js:235–240`) | Met. Honest, but see §5 item 2 (the number is obtainable — it just has not been measured). |
| 6 | Exact money | base-unit **strings** on the wire (`requireUnits`), BigInt formatting in `shared/format.js`, `displayAmount` uses `formatThru` for 9-decimal THRU | Met. THRU is 9 decimals here (`shared/tokens.js:6`, `format.js:5`), so 1,000 base units = 0.000001 THRU — the 8-decimal example in the directive does not apply to this repo. |
| 7 | D-003 unchanged | `submitPolicyFor` derives from `getMethodSpec(method).auth` + `prefs.requirePasswordForSigning`; the password path reuses `domain/password-prompt.js` | Met. Nothing in v29 changes the default or the opt-in. |
| 8 | Timeout ≠ failure | `confirm.js:104–150` tags `phase:'confirm'`/`'submit'` and `classifyReviewError` only reports `uncertain` after a submit-phase error | Met; the route-level wording is asserted in `test-route-lifecycle.mjs`. |
| 9 | Revalidation before signing | `confirmReview` re-checks TTL, binding hash, active account/network, then the kind's recheck (fee/token/price/expiry/faucet) | Met; tests cover account switch, network switch, expiry, and each recheck family. |
| 10 | No duplicated review UI | one component (`ui/domain/tx-review/review-card.js:96`), one confirm helper (`confirm.js:59`); both routes deleted their own rows, duplicate card and password flow | Met. `check-routes.mjs` reports every class defined; `check-layering.mjs` 0 violations, DOM sinks 0. |
| 11 | Build + suite green | `npm run build` PASS; `npm test` exit 0, **2,326 checks** (incl. `test-tx-review.mjs` 152 and `test-route-lifecycle.mjs` 1,104) | Met; re-run after every fix in §4, §10 and §11, and again on the merged head. |

---

## 4. Defects found during verification (fixed on this branch)

1. **Domain review sheet bypassed the card's contract.** It kept its confirm button enabled by
   listening for a DOM `change` event on the card element, and it created the button *after* the
   card (which fires `onChange` from its constructor). Now: `let confirm = null` is declared before
   the card and the documented `onChange` callback drives the button
   (`routes/name.js:596–640`), matching Send.
2. **Acknowledgement checkbox ids collided across instances.** The id was
   `tx-review-ack-<ackId>`, so two mounted cards produced duplicate DOM ids and a label could
   point at the wrong input. Ids are now namespaced per card instance
   (`ui/domain/tx-review/review-card.js`, `instanceSeq`). Found by mounting seven cards at once in
   the preview harness; one card per screen hid it.
3. **The dev server could not serve the harness.** `scripts/serve-dist.mjs` was dist-only. It now
   takes `--root` / `--port`, refuses paths outside the chosen root, and sends `no-store`.

---

## 5. Browser verification: what was and was not proven

`scripts/preview-tx-review.html` renders the **real** `TxReviewCard` with the **real**
`dist/popup.css` and **real** decoder output (fixtures are chain facts only; each envelope is
validated with `assertReview` before it is rendered). Eight shapes are shown at popup width
(408×600), and the card is also rendered at side-panel (380) and full-page (720) widths: native
send ready/blocked, token transfer with an
unverified mint and a duplicate acknowledgement, domain register, domain renew, faucet claim, an
unknown instruction (display-only), and one **synthetic** simulation-rejected send (no Thru node can
return that today — the fixture exists so the card's four simulation words cannot drift apart).

- Verified: every module URL the page imports returns 200 from
  `node scripts/serve-dist.mjs --root . --port 8000`; all eight fixtures decode and pass
  `assertReview`; the component works outside the extension bundle (no `chrome.*` dependency).
- **Corrected 2026-10-28.** This section previously also claimed that "the blocked and unknown
  cards render with confirmation disabled" in the harness. They did not: the harness's inline
  script assigned to bindings it declared *after* constructing the card, and the card fires
  `onChange` from its constructor — the same defect class as §9.1 of `DEFECT_LOG.md`. The page
  threw before appending anything, so it drew nothing. Fixed in `d45a085`; the disabled-confirm
  behaviour itself was and remains proven by the DOM-shim suite (`test-route-lifecycle.mjs`,
  `test-tx-review.mjs`), never by the harness.
- **Not verified, and not claimed:** actual pixel layout, scrolling, wrapping, focus rings and
  dark/light contrast. No browser binary ships in this environment. Attempted 2026-10-28: a
  headless Chromium was fetched from the npm registry (`@sparticuz/chromium` + `puppeteer-core`,
  outside the repo) and unpacked, but it cannot start here — `libnspr4.so`/`libnss3` are absent
  and there is no package index to install them — so not even a harness screenshot is automated.
  Those remain a human check through the harness and `docs/MANUAL_SMOKE_CHECKLIST.md`.
- Also not claimed: any live-chain behaviour. Every review in the suite and the harness is built
  from fixtures or the stubbed client boundary.

---

## 6. Domain capability facts established for the follow-on task

Verified from source, not from documentation prose:

- **Renew vs Extend.** There is no distinct "Extend". The in-repo registrar exposes exactly four
  instructions — tag 0 Initialize, 1 Register, 2 Renew, 3 UpdateConfig
  (`contracts/thru-custom-registrar/src/instruction.rs:20–34`). Renew is a *rolling extension*:
  `base = max(expires_at, chain_now)`, then `base + years × 31,536,000 s`
  (`processor.rs:270–330`, `state.rs:18`). Durations are 1–10 years
  (`instruction.rs:305–311`, mirrored in `lib/custom-registrar.js:106–112`).
- **Custom leases cannot be renewed by the wallet.** `name.renewLease` is official-registry only
  (`registrar-service.js:276–300` needs `getRegistry()`); `buildTcrRenewInstructionData` exists
  (`lib/custom-registrar.js:311`) but no bridge method calls it, and the UI shows only "make
  primary" for `custom-mine` (`routes/name.js:361–364`). Today's renewal is therefore honest but
  limited to paid-registry names. Adding custom renewal is a backend gap (handler + kind +
  decoder), not a form change.
- **"Make primary" is wallet-local.** `thru_primary_names` is network-scoped, written only after
  an on-chain owner match (`manifest.js` `name.linkPrimary` returns "stored only after on-chain
  owner == active account"), and it never signs. It is correctly *not* treated as an on-chain
  resolver write — and the review pipeline is not used for it.
- **The Domain screen currently has three tabs, not two.** Register / My Domains / Renew
  (`routes/name.js:749`). "My Domains" is only the primary-name card: there is no domain list, no
  import, no per-name verify, no unlink/remove, no dedup, and no storage for saved names.
  Batch registration does not exist. These are greenfield for the Domain task, not defects in v29.
- **Native decimals** are 9 (`shared/tokens.js`, `shared/format.js`), exercised by an assertion
  that 2,000 base units render as `0.000002 THRU`.
- **No dapp surface exists.** `src/manifest.json` declares no `content_scripts`, no
  `externally_connectable` and no `web_accessible_resources`, so a "connected dapp transaction"
  cannot occur in this build. Rabby's primary caller has no analogue here; the single funnel today
  is the wallet's own UI, and the bridge is extension-internal (`check-layering.mjs` enforces that
  only `ui/app/bridge.js` and `event-service.js` call `chrome.runtime.sendMessage`).

---

## 7. Remaining gaps and risks

1. ~~**Faucet claim bypasses the review.**~~ **Closed 2026-10-28:** the faucet route prepares a
   `faucet-claim` review, renders the shared card, and submits through the same confirm helper. No
   UI route calls a signing method directly any more. (Precision, 2026-10-28: the v12 JIT
   `tx.registerAccount` activation in `send.js` is a direct unlocked-only signing call and was never
   value-moving; it is outside this claim.)
2. **Token-transfer fee is unmeasured, not unknown.** The review says so rather than borrowing the
   native number. The improvement is measurement (`scripts/measure-fee.mjs` pattern), not UI.
3. **`tx.confirmReview` is not single-use in the background.** *Partially closed 2026-10-28:* a
   successful submit discards the review from the UI helper, so a replay inside the TTL fails with
   `REVIEW_NOT_FOUND` (classified stale), and a definite failure keeps the review because retrying
   the same reviewed facts is safe. But `confirmReview` itself is deliberately idempotent — a
   cancelled password dialog must not force a re-review — so an API caller that never submits can
   confirm the same review repeatedly. Each confirmation only returns submit instructions, and the
   signing handler's own guards still apply. A one-shot authorization capability is **open**
   (§12 F-05); the claim is "the shipped UI cannot replay it", not "the backend is single-use".
4. ~~**A failed simulation would not block.**~~ **Closed 2026-10-28:** `simulationWarning()` turns a
   `status:'failed'` dry run into a blocking warning; the service computes state from it and persists
   it, `confirmReview` refuses any record that is not `ready`, and the card words "failed" apart from
   "not available". Still unexercised against a real dry-run RPC (none exists on Thru), so the seam
   is covered by pure/model tests and a source assertion, not by a live failure.
5. **No independent review of the custom registrar contract exists in this repo**, and its renew
   path is not wired. Anything that makes a contract call it must first clear the policy in the
   directive (§11–12): provenance, tests, and a testnet deployment check.

---

## 7a. Follow-up commit after the independent audit (2026-10-28)

An independent audit of this PR raised F-1…F-7. Status of each:

| ID | Finding | Status |
| --- | --- | --- |
| F-1 | Orphaned CSS after the migration (`screens.css`) | **Fixed** — the whole `.security-repeat-*` block and `.name-confirm-hero`/`-title` are deleted, and the equally stale `scripts/preview-duplicate-tx.html` (which previewed markup no longer built) is gone |
| F-2 | Standing docs not refreshed for v29 | **Fixed** — `STATUS_AND_ROADMAP.md` and `PROJECT_LEDGER.md` now carry the v29 identifiers and the pipeline's honest states; `DEFECT_LOG.md` §9 records the three review defects |
| F-3 | `amountText` in the card duplicated `displayAmount` | **Fixed** — `shared/format.js` owns `formatAssetAmount`; both the decoders and the card delegate to it, so there is exactly one 9-decimal-THRU rule |
| F-4 | Split error-code registry | **Fixed** — `model.js` owns `REVIEW_ERROR_CODES`, `REVIEW_RECHECK_CODES` and the derived `STALE_REVIEW_CODES`; `confirm.js` imports rather than re-lists; a test scans the background for thrown codes and fails on any that is registered in neither the model nor the contract |
| F-5 | `confirmReview` replayable inside its TTL | **Fixed** — a successful submit discards the review (see §7 item 3) |
| F-6 | Numeric slips in this document | **Corrected** — `SignTx.tsx` is 3,187 lines, `openDirect` is at `Main.tsx:878`, and the component count is 84 top-level directories |
| F-7 | Directive assumed 8 decimals | **Confirmed** — this repo is 9 decimals, as recorded in §6 |

The audit also proposed the faucet migration as P1; that is done, with route-level coverage in
`test-route-lifecycle.mjs` (prepare → card → confirm gating → `tx.confirmReview` →
`tx.claimFaucet` → consumed review, plus paused-faucet refusal and unknown-outcome copy).

## 8. Result

The v29 pipeline does what the PR says for Send and Domain, refuses to guess, refuses to sign what
it cannot decode, and keeps the signing/auth boundary intact. The two defects found were in the
integration seams (a DOM-event indirection and a shared DOM id), not in the pipeline contract, and
both are fixed with the suite green. Everything else listed in §7 is open work, stated as such.

A later pass (§9 completion report, §10 independent re-check) added a third fix outside the
pipeline: Dashboard’s activation call was signing-gated and is now the v12 owned-address path, with
a source-scan guard so it cannot return. Those changes did not alter the pipeline contract; they
closed the last route that could reach a signing-gated method without it.

---

## 9. Completion report (owner directive §10, re-stated against the code)

This is the required end-of-work report, item by item. Every "shipped" claim below has a source
path; every "not shipped" line says why. No browser or live-chain claim is made unless a check was
actually run.

| Required item | What was delivered | Evidence / limit |
| --- | --- | --- |
| Rabby files and patterns studied | `docs/transaction.md`; `src/ui/views/Approval/index.tsx`; `components/{Actions,SecurityEngine,FooterBar}`; `SignTx.tsx` (3,187 lines); `SendToken`; `Swap/Component/Main.tsx`; `background/controller/provider/rpcFlow.ts`; `background/service/notification.ts`; `transactionHistory.ts`; `transactionBroadcastWatcher.ts`; `securityEngine.ts`. Patterns kept: one approval funnel, fail-closed unknown, identity-keyed settlement, summary+table+raw disclosure, blocking warnings. Patterns rejected: EVM gas/ABI defaults, server-assisted explain/simulation, hardware and multisig branches, the god-controller. | §2 and §2.5–2.6. Rabby is MIT **with the brand/logo reserved** (LICENSE verified via the GitHub API); no Rabby code or asset is copied. |
| Existing transaction paths found | Send (native + token, with JIT activation), Domain (register via custom registrar or free first-party write; purchase/renew/claim on the paid registry), Faucet claim, and the background methods behind them (`tx-service`, `token-service`, `registrar-service`, `name-service`, `registration-service`). Pre-v29, Send and Domain each owned review markup and a confirm gate; Faucet owned neither. | §3 claim table; `routes/{send,name,faucet}.js` history. |
| Shared architecture and contract changes | Contract **v29** adds `tx.prepareReview` / `tx.confirmReview` / `tx.discardReview` (all `auth:'unlocked'`, none signs). Shared wire model + strict validator + one error-code registry (`src/shared/tx-review/model.js`), decoder registry with no fallback (`registry.js`, `decoders/*`), background prepare/revalidate/store (`services/review-service.js`, `services/review/{kinds,store}.js`), one card (`ui/domain/tx-review/review-card.js`), one confirm helper (`confirm.js`). Reviews live under the network-scoped `tx_reviews` key, TTL 120 s, cap 40. | `test/test-contract.mjs` (161 checks) keeps manifest ↔ router ↔ callers in agreement. |
| Operations actually integrated | `native-send` → `tx.sendChecked`; `token-transfer` → `token.transferChecked`; `domain-register` → `name.register` (`via:'custom'`); `domain-purchase` → `name.purchase`; `domain-renew` → `name.renewLease`; `domain-claim` → `name.claimExpired`; `faucet-claim` → `tx.claimFaucet`; `raw` → **no** submit. Activation (Dashboard for the active account, Send for an owned recipient) goes through the v12 `tx.registerAccount`, not the review pipeline — it is an unlocked-only, zero-fee, self-signed activation, not a value-moving transfer. | `services/review/kinds.js`; route-level coverage in `test/test-route-lifecycle.mjs`. |
| Decoders implemented vs unsupported | Implemented: native send, token transfer, domain register, domain purchase, domain renew, domain claim, faucet claim, raw/unknown (display-only). Unsupported **by design**: swap, AMM/LP add/remove, pool creation, token launch/migration/claim — the contract declares them behind `DEFI_*` flags that are all off, no handler can execute, and no kind exists, so `tx.prepareReview` answers `supported:false` with the known-kinds list. Arbitrary programs decode as `kind:'unknown'` with raw bytes and cannot be signed. | `registry.listDecoderKinds()` = `listKinds()`; `test/test-tx-review.mjs` [0] and [2]. |
| Simulation availability and limits | Unavailable and said so: `tx.simulate` returns `{supported:false, changes:null, reason}` and every review carries `simulation.status:'unavailable'` with a null post-transaction balance (`assets.balanceAfter` is validator-enforced null). Deterministic facts (exact base-unit amount, fee provenance or its explicit reason, target program/instruction, warnings) are shown; nothing is interpolated. | `services/tx-service.js §simulate`; `model.js assertReview`; [1]/[3]. |
| Tests and build results | `npm test`: **2,326 checks**, exit 0 — `test-tx-review.mjs` 152, `test-route-lifecycle.mjs` 1,104, `test-contract.mjs` 161, plus the rest of the suite. `npm run build`: PASS, layering 126 files / 0 DOM sinks, routes 15/15, 262 used CSS classes (all defined). | Local/deterministic only; no browser binary exists in this sandbox. |
| Browser verification evidence | **None claimed.** `scripts/preview-tx-review.html` renders the real component against the real `dist/popup.css` for eight fixtures; its modules were HTTP-checked (200) but the page itself drew nothing until `d45a085` (§5 correction), and the DOM shim has no layout engine, so this is a harness, not a layout proof. The human runbook is `docs/MANUAL_SMOKE_CHECKLIST.md` §7. | §5; §7 item 1. |
| New guard added for "no direct signing from the UI" | `test/test-tx-review.mjs` [14] scans every `src/ui/**/*.js` for `bridge.send('<method>')` literals (comments stripped), fails if any names an `auth:'signing'` method or an unknown method, and asserts the sanctioned literals (review trio + `tx.registerAccount`) are present so the scan cannot pass vacuously. This is what found the Dashboard defect fixed in §10. | [14]; `test/test-route-lifecycle.mjs` "dashboard activation" checks. |
| Remaining security/protocol blockers | (1) token-transfer network fee unmeasured and recipient-owner acceptance unproven; (2) charged network fee is not returned by the RPC detail path; (3) no simulation/dry-run RPC; (4) custom-lease renew has no bridge method; (5) real-browser layout/focus and MV3 suspension untested; (6) no external security audit; (7) no dapp provider surface exists, by design. | §7, `docs/BACKEND_GAPS.md`, `docs/STATUS_AND_ROADMAP.md` §2. |

## 10. Second independent review (2026-10-28): claims checked against the code

A second AI reviewed the branch statically and produced a handoff with 15 requirement verdicts, a
five-item P0/P1 list, and five code claims. Each was re-checked against source at `1ef4be5` (then
this commit). The review's **most valuable finding was right and is fixed**; several other claims
were wrong about this tree. Both kinds are recorded here so the next reader does not have to redo it.

| External claim | Verdict | What the code actually does |
| --- | --- | --- |
| "PR backend contract is RIGHT (v29)… reuse it, do not build a parallel lifecycle" | **Agree, with a correction** | `manifest.js` v29; `review-service.js`; `services/review/*`. No *shipped* route uses a second lifecycle, but the pre-existing `intent-service.js` + `defi/intent-store.js` + `dex-service.js` lifecycle still exists behind the `DEFI_INTENT` gate (off). §12 F-01 corrects this row: "no parallel lifecycle exists" was too strong. |
| "PR frontend is HALF-DONE… per-route sheets (tx-card, tx-detail-sheet, send.js inline review) still exist" | **Wrong** | `tx-card.js` and `tx-detail-sheet.js` are **Activity/History** components (`docs/HISTORY_REDESIGN_PLAN.md` P1/P2), not review sheets. `routes/send.js`, `routes/name.js` and `routes/faucet.js` each call `tx.prepareReview` → `TxReviewCard` → `submitReviewedReview`; those three are the only files under `src/ui/` that call the review pipeline, and there is no `/send`-owned review markup left. |
| "U-3 PARTIAL: shared component + risk banners missing" | **Wrong** | `ui/domain/tx-review/review-card.js` renders the review, a Warnings section, acknowledgements, and a disabled confirm when blocked. (At the time of this review that was eleven stacked sections; the 2026-10-28 owner review folded them into one table plus one disclosure — §11.) |
| "U-8 PARTIAL: review-pipeline tests missing" | **Wrong** | `test/test-tx-review.mjs` (89 checks at the time of this review, 126 after §11: registry parity, every decoder, malformed/unknown input, formatting, binding/TTL/account/network, acknowledgements, discard, code registry, UI signing-literal scan, decoder row budget) + the Send/Domain/Faucet review flows inside `test/test-route-lifecycle.mjs`. |
| "U-9 PARTIAL: A+B done, C–D in progress" | **Stale** | Stage C (shared UI + Send migration), D (DOM-level verification) and E (Domain + Faucet migration) are committed; the only unclosed stage is F's browser pass, which is open for environmental reasons. |
| "U-10 FAIL: §10 completion report missing" | **Fair** | The substance existed across §3/§7/§8 but was not written as the required report nor linked from `STATUS_AND_ROADMAP.md`. Fixed: §9 above, linked from `docs/STATUS_AND_ROADMAP.md`. |
| "P0: forbid submit without bindingHash" | **Already enforced** | `confirmReview` rejects a missing/blank `bindingHash` (`INVALID_INPUT`) and a mismatch (`BINDING_MISMATCH`); a display-only review has `submit:null` → `NOT_EXECUTABLE`. Covered by [4]. |
| "P0: no direct signing call from the UI" (implied by the architecture claim) | **Right, and now fixed** | `routes/dashboard.js` fired `tx.autoCreateAccount` (`auth:'signing'`) after an absence read. That bypassed review **and** could never succeed for a user with per-sign password re-auth, because a background refresh cannot answer a password prompt. Dashboard now calls the v12 `tx.registerAccount({address})` path; `tx.autoCreateAccount` has zero UI callers; [14] enforces it and the new "dashboard activation" route test pins the address and the absence of a password field. |
| "5.6 snippet: `kind:'thru.send'`, `parseThru`" | **Wrong names** | Kinds are `native-send`, `token-transfer`, `domain-…`, `faucet-claim`, `raw`; `thru.send` answers `supported:false`. The formatter is `parseThruAmount`/`formatThru` (THRU = 9 decimals); there is no `parseThru` export. |
| "5.7 normalizeTxResult reads `.signature` off a string" | **Already fixed** | `tx-service.js normalizeTxResult` handles `typeof result === 'string'` first. The dormant analogue is `intent-service.js` (`result?.signature ?? null`) inside the **flag-off** `DEFI_INTENT` path; it cannot run in this build and is listed as a follow-up, not a shipped defect. |
| "Rabby is Apache-2.0 / MIT mix" | **Wrong** | The repository's only `LICENSE` is MIT, with an added reservation of the Rabby brand name and logo. Our no-copy rule is unchanged. |
| "Domain: tabs = Register + My Domains; no top-level Renew; extend verdict open; primary decision missing" | **Stale/wrong** | `routes/name.js` has three tabs — Register / My Domains / **Renew**; the extend-vs-renew verdict with `instruction.rs`/`processor.rs` references is §6 above; "make primary" is wallet-local and documented, including that it never signs. |
| "Domain batch UI, dedup record layer, import list missing" | **True, out of v29 scope** | §6 already lists them as greenfield for the Domain task; the v29 directive was one review pipeline for shipped operations, not new domain features. |
| "Browser-signed renewal and real-Chrome review remain open" | **Agree** | §5 and §7; `MANUAL_SMOKE_CHECKLIST.md` §7. |
| "Simulation honesty PASS / security constraints PASS" | **Agree** | §9 rows; `tx.simulate`; D-003 untouched. |

## 11. Simplification pass (2026-10-28): the owner's review

The owner reviewed the shipped card against the previous `main` Send screen and against their own
Rabby before-sign screenshots, and said three things: the Send review had changed too much compared
with `main`, the Domain register preview was long enough to confuse ("so long users get confused"),
and the Rabby before-sign format — decoded facts, value in and out, one card — was the target. That
is a UX defect in this delivery, not a new feature; it is recorded in `docs/DEFECT_LOG.md` §11.

### 11.1 What the card renders now

One card, six blocks for a decoded operation (a seventh only for an undecoded one, which adds
its one-sentence explanation), in this order:

1. **Header** — operation name, network badge (+ testnet), decoded/not-decoded badge.
2. **Program identity** — one line: program name, the signing account, verified/unverified badge.
   This is the Thru analogue of Rabby's site line; the program address moved into the disclosure.
3. **Value in / value out** — one signed, exact box per movement (`−0.000001 THRU` / `+0.00001 THRU`),
   followed by the existing one-line "no post-transaction balance" note.
4. **One fact table** (`detail-table`, the same component the old Send screen used) — the decoder's
   rows, then `Network fee` (`… (estimated)` or `Not quoted`), then `Total` when the wallet can
   actually add the numbers (one outgoing asset; asset-denominated fee). Nothing is invented when it
   cannot: a token send reads `1 SMK + fee (not quoted)`.
5. **Warnings**, unchanged in substance.
6. **One `Advanced details ›` disclosure**, closed by default — program name/address/provenance,
   instructions, account roles, fee provenance, reserve, fee note, "charged is reported in Activity",
   simulation status + reason, and the raw-bytes toggle. For a `decode:'unknown'` review the panel is
   OPEN, because the raw facts are then the only information there is.

Acknowledgements stay outside the disclosure (they gate the confirm button), and the route still owns
the footer button via `onChange({canConfirm})`.

Removed as separate blocks (moved, not deleted): the summary sentence for decoded operations, the
two-column protocol box, the "What you are doing" heading, the "Balance change" heading and its
balance-after row, the four-row fee section, the standalone simulation notice, and the "Execution
details" section. The summary sentence is still rendered for `decode:'unknown'`.

### 11.2 Decoder rows trimmed

| Decoder | Before | After | Why |
| --- | --- | --- | --- |
| `native-send` | From, To, Amount, **Network** | From, To, Amount | the network is the header badge |
| `token-transfer` | From, To, Amount, **Token**, Mint, [Recipient token account], **Network** | From, To, Amount, Mint, [Recipient token account] | network = header badge; the title + value box already name the token |
| `faucet-claim` | To, Amount, **Network**, [Remaining this window] | same minus Network | as above |
| `raw` | Program, Instruction data, [Note], **Network** | same minus Network | as above |
| `domain-register` | Domain, Duration, **Registrar**, **Root**, **Price per year**, Total charge, **Network** | Domain, Duration, [Price per year **only when years > 1**], Total charge | registrar = protocol line; root address = technical, in `execution.accounts`; per-year price repeats Total charge for one year |
| `domain-{purchase,renew,claim}` | operation rows + **Network** | operation rows | as above; renew applies the same one-year rule to its per-year price |

No fact was deleted from the envelope: programs, instructions, accounts, fee provenance/reserve/note
and the simulation reason all still exist and are asserted in §11.3 (`[15]`).

### 11.3 Guards added

- `test-tx-review.mjs` **[15]** (37 checks): the card has exactly one `detailTable` call and exactly
  two disclosure buttons (advanced + raw); the old section markers/classes are gone; the fee quote is
  labelled `(estimated)`; an unknown review opens its details. Then a per-decoder **row budget** —
  native-send 3, token-transfer 5, domain-register 4, purchase 5, renew 6, claim 5, faucet 4, raw 3 —
  and "no decoder repeats the network". Finally, "nothing was dropped": every decoded review still
  carries its verified program, ≥1 instruction and a fee note, and still refuses to predict a
  balance; raw still exposes the bytes and stays unsignable.
- `test-route-lifecycle.mjs`: four DOM assertions in the Faucet review flow (signed exact amount
  `+0.00001 THRU`, one table / no sections, disclosure closed, opening it reveals program + fee note
  + simulation status without re-preparing) and two in the token-send flow (one table with
  From/To/Amount/fee/Total, `−1 SMK`, `Not quoted`, closed disclosure). Those flows drive the real
  routes, real bridges and real component.

### 11.4 Result

`npm run build` PASS. `npm test` exit 0 — **2,326 checks**: `test-tx-review.mjs` 152/152,
`test-route-lifecycle.mjs` 1,104/1,104, contract 161/161, plus the rest of the suite. The CSS for the
removed sections (`.tx-review-protocol*`, `.tx-review-section*`, `.tx-review-fee-note`) was deleted so
the stylesheet has no dead review classes; `check-css-nesting.mjs` and the route/CSS gate still pass.

**UNVERIFIED:** the visual result at 400 px and in a real browser. There is no browser binary in this
sandbox, so §11.1 describes the DOM the tests assert, not a rendered screenshot. The harness
(`scripts/preview-tx-review.html`, eight fixtures) and `docs/MANUAL_SMOKE_CHECKLIST.md` §7 are how
that check gets recorded.

## 12. External audit of `2e2178f`, re-checked at `983724b` (2026-10-28)

A third review audited the PR at `2e2178f` (29 files, +4,901/−289; `test-tx-review.mjs` 66 checks at
that commit) and raised F-01…F-13 plus a requirement matrix. The branch has moved a long way since:
`514ac33` (faucet migration, error-code registry, one formatter), `d8d807c` (Dashboard activation,
the UI signing-literal scan), `1ef4be5` (documentation), and `9aacb5d`…`983724b` (the card
simplification). Every finding was re-read against the current source; where the finding was still
true, it was fixed in this pass with a regression test.

Status key: **Fixed now** = changed in this pass, with a test below. **Fixed earlier** = closed by
`514ac33`/`d8d807c`. **Partial** = the shipped path is closed but the general capability is not.
**Open** = true today and deliberately out of this PR's scope, stated as such.

| ID | Finding at `2e2178f` | Status at this HEAD | Evidence / guard |
| --- | --- | --- | --- |
| F-01 | A second lifecycle (`intent-service`/`intent-store`/`dex-service`) competes with the new review pipeline | **Open, reclassified** | The lifecycle exists and is dormant: every DeFi method is gated (build-time `DEFI_INTENT`, off) and `intent.submit` refuses `FEATURE_DISABLED`. No shipped route calls it; the review pipeline is the only live prepare/confirm path. Converging or deleting it is a follow-on decision, not something this PR can do without migrating a disabled feature. §10's "no parallel lifecycle exists" sentence is corrected above. |
| F-02 | Review is not mandatory at the signing boundary | **Partial** | Faucet migrated (`514ac33`). Dashboard/Send activation moved to the unlocked v12 `tx.registerAccount`; `tx.autoCreateAccount` has no UI caller (`test-tx-review.mjs` [14] + the Dashboard route test). **New:** a review that is not `ready` is now refused by `tx.confirmReview` itself (`NOT_EXECUTABLE`), so the disabled button is no longer the only gate. Still open: `token.deploy` and the reviewed handlers remain directly callable, and there is no one-shot authorization capability. |
| F-03 | An unreadable mint rendered as proven absence | **Fixed now** | `token-transfer.js` branches on `mintExists === false` (blocking) vs `== null` (`mint-unverified`, warning). Test: `[2] an unreadable mint is "could not verify", never "does not exist"`. |
| F-04 | A failed simulation did not affect confirmability | **Fixed now** | `simulationWarning()` (blocking on `status:'failed'`), the service folds it in **before** computing and persisting `state`, `confirmReview` refuses non-`ready` records, and the card words "Failed" apart from "Not available". Tests: `[16]` (blocking fact, state flip, unavailable/pending add nothing, service ordering, card wording) and `[11]` (blocked review refused even when the UI is bypassed). Not exercised against a real dry-run RPC — none exists on Thru. |
| F-05 | Reviews are replayable inside their TTL | **Partial, stated precisely** | A successful submit discards the review, so the shipped UI cannot replay it; `confirmReview` itself stays idempotent so a cancelled password dialog does not force a re-review. An API caller that never submits can confirm repeatedly; each confirmation only returns instructions and the signing handler's own guards apply. §7 item 3 now says exactly this instead of "closed". |
| F-06 | Prepared-review storage can lose concurrent writes | **Fixed now** | `review/store.js` serializes every read-modify-write per network (`reviewUpdates`, the same pattern as `pending-tx-service`). Tests `[16]`: concurrent put/put, put/remove, and the 40-record cap under 45 concurrent writes. Negative control: reverting to the old read-modify-write makes put/put lose a record and the suite fail. |
| F-07 | Faucet decoder invented an activation step and ignored a policy mismatch | **Fixed now** | `accountExists` keeps its tri-state (`true/false/null`); `null` produces `account-state-unverified` (warning, no activation claim). `targetMatchesFaucet === false` now produces a blocking `faucet-target-mismatch`, matching the recheck that already refused it. Tests: `[4]` (both cases). |
| F-08 | The Domain lifecycle directive is not implemented (3 tabs, no domain record/merge model, no custom renewal) | **Open, out of scope** | `routes/name.js` still has Register / My Domains / Renew, and My Domains is a primary-name view. Documented as a separate workstream (§6, `docs/STATUS_AND_ROADMAP.md`); this PR only upgrades review for existing domain writes. |
| F-09 | The verification report missed the parallel lifecycle and the decoder/store defects | **Addressed** | This section is the missing review; §10's wrong row and §7 items 3–4 are corrected above; `docs/DEFECT_LOG.md` §12 records the defects and their lessons. |
| F-10 | `treasurer`/`treasury` mismatch rendered the registry treasury as `unknown` | **Fixed now** | `review/kinds.js` emits `treasury: cfg.treasurer`. Test: `[3] the registry treasurer address reaches the execution accounts`. |
| F-11 | `verified: true` could be rendered without an address | **Fixed now** | Native/token decoders derive `verified` from the pinned id and raise a blocking `program-unidentified` when it is missing; `model.js` refuses `verified:true` without an address (protocol and execution program). Tests: `[1]` (no pinned program), `[5]` (both validator rules), plus the new state↔warning invariants. |
| F-12 | Dead code and over-broad comments | **Fixed now (code), scoped (comments)** | `programIdentity()` and Send's write-only `preparedReview` are deleted. Kinds remain declared once in the pure decoder registry and once in the background spec, with `[0]`'s two-way consistency test; the card's comments now describe the one review *surface*, not a global monopoly. |
| F-13 | Maintained docs still claimed SDK `0.4.1` | **Fixed earlier + now** | `1ef4be5` refreshed the docs to `0.4.2`; this pass also advances the derivation vector pin to `0.4.2` so `npm test` stops printing a version-drift warning, and records the reason in the vector comment. |

Two audit-side corrections for the record: the audit's counts (29 files / 66 review checks / 4,901
additions) describe `2e2178f`, not the PR head; and its §5 table lists the faucet as bypassing review,
which `514ac33` had already changed before this pass.

### 12.1 New invariants added with these fixes

- `assertReview` refuses `state:'blocked'` without a blocking warning and `state:'ready'` with one.
- `assertReview` refuses `protocol.verified`/`execution.program.verified` without an address.
- `tx.confirmReview` refuses any stored record whose state is not `ready`.
- The store's writes are serialized per network; `readAll` is only ever called inside that queue for
  mutations.

### 12.2 Gates

`npm run build` PASS. `npm test` exit 0 — **2,326 checks** (`test-tx-review.mjs` 152/152,
`test-route-lifecycle.mjs` 1,104/1,104, `test-contract.mjs` 161/161, derivation 16/16 with the 0.4.2
pin and no warning). Still **UNVERIFIED** by this pass: a real failed simulation, real Chrome layout,
and any live-chain behaviour.
