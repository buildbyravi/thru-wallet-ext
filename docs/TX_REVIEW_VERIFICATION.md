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
- Local gates: `npm run build`, `npm test` (2,152 checks), `scripts/check-layering.mjs`,
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
| 1 | One pipeline, no parallel lifecycle | `review-service.js:124,241,307`; kinds table `review/kinds.js:613–730`; Send `routes/send.js:787–915`; Domain `routes/name.js:556–700` | **Met for Send + Domain.** Faucet still calls a signing method directly (`routes/faucet.js:254`) — declared in the PR body, tracked in §5. |
| 2 | Append-only contract, v29 | `shared/contract/manifest.js` (`CONTRACT_VERSION = 29`, 3 methods, `since: 29`); `test/test-contract.mjs` 161/161 | Met. No existing method signature changed. |
| 3 | The pipeline never signs | `prepareReview` reads facts + decodes; `confirmReview` returns the recorded `{method, params}`; submission runs through each operation's existing handler | Met. Verified by test section 8 ("confirming does not sign"). |
| 4 | Unknown can never be signed | `registry.js` throws `REVIEW_KIND_UNSUPPORTED`; `raw` kind has `submit: null`; `review-service` forces `state:'blocked'` whenever `submitPolicy` is null; `assertReview` rejects a null policy on a `ready` review | Met, and covered by tests 11. |
| 5 | No fabricated fee or post-tx balance | `model.js` rejects a non-null `assets.balanceAfter`; `fee.supported:false` must carry a reason; token transfers declare their fee unmeasured instead of borrowing the native number (`review/kinds.js:235–240`) | Met. Honest, but see §5 item 2 (the number is obtainable — it just has not been measured). |
| 6 | Exact money | base-unit **strings** on the wire (`requireUnits`), BigInt formatting in `shared/format.js`, `displayAmount` uses `formatThru` for 9-decimal THRU | Met. THRU is 9 decimals here (`shared/tokens.js:6`, `format.js:5`), so 1,000 base units = 0.000001 THRU — the 8-decimal example in the directive does not apply to this repo. |
| 7 | D-003 unchanged | `submitPolicyFor` derives from `getMethodSpec(method).auth` + `prefs.requirePasswordForSigning`; the password path reuses `domain/password-prompt.js` | Met. Nothing in v29 changes the default or the opt-in. |
| 8 | Timeout ≠ failure | `confirm.js:104–150` tags `phase:'confirm'`/`'submit'` and `classifyReviewError` only reports `uncertain` after a submit-phase error | Met; the route-level wording is asserted in `test-route-lifecycle.mjs`. |
| 9 | Revalidation before signing | `confirmReview` re-checks TTL, binding hash, active account/network, then the kind's recheck (fee/token/price/expiry/faucet) | Met; tests cover account switch, network switch, expiry, and each recheck family. |
| 10 | No duplicated review UI | one component (`ui/domain/tx-review/review-card.js:96`), one confirm helper (`confirm.js:59`); both routes deleted their own rows, duplicate card and password flow | Met. `check-routes.mjs` reports every class defined; `check-layering.mjs` 0 violations, DOM sinks 0. |
| 11 | Build + suite green | `npm run build` PASS; `npm test` exit 0, 2,152 checks (incl. `test-tx-review.mjs` 66 and `test-route-lifecycle.mjs` 1,041) | Met, re-run after the fixes in §4. |

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
validated with `assertReview` before it is rendered). Seven shapes are shown at popup (408×600),
side-panel (380) and full-page (720) widths: native send ready/blocked, token transfer with an
unverified mint and a duplicate acknowledgement, domain register, domain renew, faucet claim, and
an unknown instruction (display-only).

- Verified: every module URL the page imports returns 200 from
  `node scripts/serve-dist.mjs --root . --port 8000`; all seven fixtures decode and pass
  `assertReview`; the blocked and unknown cards render with confirmation disabled; the component
  works outside the extension bundle (no `chrome.*` dependency).
- **Not verified, and not claimed:** actual pixel layout, scrolling, wrapping, focus rings and
  dark/light contrast. No browser binary is available in this environment. Those remain a human
  check through the harness and `docs/MANUAL_SMOKE_CHECKLIST.md`.
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
   UI route calls a signing method directly any more.
2. **Token-transfer fee is unmeasured, not unknown.** The review says so rather than borrowing the
   native number. The improvement is measurement (`scripts/measure-fee.mjs` pattern), not UI.
3. ~~**`tx.confirmReview` is not single-use.**~~ **Closed 2026-10-28:** a successful submit now
   discards the review, so a replay inside the TTL fails with `REVIEW_NOT_FOUND` (classified stale).
   A definite failure keeps the review, because retrying the same reviewed facts is safe.
4. **A failed simulation would not block.** `stateFromWarnings` only reads warnings; with
   `tx.simulate` permanently `{supported:false}` there is no way to produce or test a `failed`
   simulation path, so it is documented rather than guessed at.
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
