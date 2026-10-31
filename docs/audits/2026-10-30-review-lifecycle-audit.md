# Review lifecycle audit — the pre-sign path after v31 (2026-10-30)

Scope: branch `arena/0439c226-thru-wallet-ext`, review pipeline as it stood at `2c0aeed` (v31
merge + audit record), audited here and fixed in `826045a` (lifecycle) and `5b39dc5` (card copy).
Class: **source audit + deterministic tests**. No browser binary exists in this environment and no
transaction was signed against a funded Betanet account; every statement below is a claim about
source and about a Node test that drives the real modules.

Two external documents were pasted for this pass: a PR audit and a release-fix directive. Both were
treated as checklists, not verdicts — every claim was re-checked at this head with `file:line`
evidence, and the claims that did not survive are listed in §5 rather than adopted.

## 1. Method

- `npm install && npm run build`, then `npm test` at the starting head (green, 2,430 checks) —
  which is exactly why the defects below matter: each one sat inside a path the suite already
  covered, and the coverage asserted the happy shape, not the lifecycle around it.
- Each finding was reproduced by reading the call chain (`src/ui/app/routes/*` → `confirm.js` →
  `api-router.js` → service → contract), then pinned with a test that fails on the old code.
- Fixes went in one commit, smallest first, with the guard beside the fix. The card copy rewrite
  (owner feedback, recorded in `docs/DEFECT_LOG.md` §11) followed as its own commit so a copy
  regression and a lifecycle regression cannot be confused in review.

## 2. Findings

| ID | Priority | Defect | Status |
| --- | --- | --- | --- |
| F-1 | P1 | The Domain route's registration queue prepared reviews and submitted them in a loop without ever rendering `TxReviewCard` | **Fixed** — queue, handler, CSS deleted |
| F-2 | P1 | `tx.claimFaucet` re-derived account and network at submit time instead of using the ones the review displayed | **Fixed** — explicit params, handler refuses a mismatch |
| F-3 | P2 | `submitReviewedReview` accepted an optional `AbortSignal`; Send and Faucet passed none | **Fixed** — signal required, both routes own a controller |
| F-4 | P2 | A review could be replayed after it produced a signature | **Already fixed, re-verified** at this head |
| F-5 | P2 | The Domain route created its sheet only after the async prepare resolved, so a double click opened two sheets and an edit mid-read could show a superseded review | **Fixed** — in-flight flag + generation counter |

### F-1 (P1) A queue submitted reviews nobody had seen — `READ` + `TEST` + FIXED

`src/ui/app/routes/name.js` held a `queuedRegistrations` array and a `Queue registration` button
whose handler called `tx.prepareReview` and then `submitReviewedReview` per entry, in a loop, never
rendering the card. The button was constructed with the `hidden` class and never un-hidden by any
code path — dead UI carrying a signing loop. Dead code with a signing loop is still a signing path:
one CSS change, one `classList.remove`, and the wallet would sign transactions the user was never
shown.

Fix (`826045a`): the button, the handler, the queue rendering, its state, its reset, and the
orphaned `.name-queue-*` rules in `src/popup/styles/screens.css` are gone. The single-name flow is
untouched. Guard: `test-tx-review.mjs` [17] fails if the route or the stylesheet grows the queue
back.

### F-2 (P1) The faucet claim was bound to nothing — `READ` + `TEST` + FIXED

`tx.claimFaucet` (`src/background/services/tx-service.js:160`) took only an amount and rebuilt its
context from the *current* active account and network at submit time. A network/account switch from
another window while the password dialog was open therefore claimed into an account the review never
named — the exact class of defect the send path had already closed by passing its displayed
accounts and checking them.

Fix: the review kind submits `{ amountUnits, fromAddress, networkId }`
(`src/background/services/review/kinds.js`), `api-router.js:202` forwards all three, the handler
refuses a mismatch with `REVIEW_ACCOUNT_CHANGED` / `REVIEW_NETWORK_CHANGED`
(`tx-service.js:175`, `:180`) before it builds anything, and `manifest.js` declares both params.
Guards: `test-tx-review.mjs` [17] asserts the submit params and the manifest, [18] asserts both
refusals through the real router.

### F-3 (P2) "Destroyed" was checked after the signature existed — `READ` + `TEST` + FIXED

`submitReviewedReview` (`src/ui/domain/tx-review/confirm.js`) took `signal = null` and only the
Domain route passed one. A Send or Faucet confirmation could therefore complete signing after its
route was torn down; checking `destroyed` after the `await` is too late, because the password dialog
has already produced a signature by then.

Fix: `signal` is required — a missing one throws `INVALID_REQUEST` (a programming error, not a user
outcome), and an already-aborted signal returns `{ status: 'cancelled' }` without touching the
background. Both routes own a lifecycle `AbortController` aborted in `destroy()`. Guard: a source
scan in `test-tx-review.mjs` [17] finds every `submitReviewedReview({` call site and fails if one
lacks `signal:`; a live `chrome.runtime.sendMessage` stub plus a positive control prove the scan can
pass and that a real signal still proceeds.

### F-4 The replay window — re-verified, no change needed

The directive repeated the concern that a confirmed review stays usable inside its 120 s TTL. At
this head the submit path discards the review once it produces a signature, and
`test-route-lifecycle.mjs` pins it with "a review that produced a signature is discarded, so it
cannot be replayed". No edit was made; the claim was stale against the current tree.

### F-5 (P2) The Domain sheet raced its own preparation — `READ` + `TEST` + FIXED

`name.js` created the review sheet inside the promise that resolved from `tx.prepareReview`. Two
consequences: a double click during a slow read opened two sheets over the same button, and editing
the draft while a prepare was in flight could open a review for the *previous* name. Neither is a
signing bypass, but both show the user a review for something they are no longer asking for.

Fix: one `preparingReview` flag and one `prepareSeq` generation. Every edit bumps the generation, and
a response whose generation no longer matches discards its review instead of showing it. Guard:
`test-route-lifecycle.mjs` drives the slow-read case and asserts one sheet and the current name.

## 3. The copy rewrite (`5b39dc5`)

Owner feedback: the Send preview had drifted from the `main` shape, the Domain register preview was
too long, and the screen must say *what the transaction is* — what is sent, what is received, and
the value. The rewrite is recorded in `docs/DEFECT_LOG.md` §11 and
`docs/TX_REVIEW_VERIFICATION.md` §13; the constraints were re-checked against it here:

- one card, one money table plus at most one non-money facts table, one `Details` disclosure;
- unknown stays explicit: exactly one blocking warning, Details open by default;
- no fabricated fee or balance: zero fee reads `none`, an unmeasured fee keeps "not confirmed (paid
  in THRU)", a custom registrar that collects nothing shows no price and says so in Details;
- acknowledgements still gate Confirm; timeout still is not failure;
- `protocol.trustNote` and `content.counterparty` are optional additions — the validator rejects a
  malformed one, and no existing review needed to change to keep working.

Guards: `test/test-tx-review-card.mjs` renders every kind through the registry and asserts the
visible text, the block budget (≤ 10 blocks, ≤ 2 warnings), the forbidden-vocabulary scan
(`provenance`, `decoded`, `base units`, `best-effort`, `binding`, …), and that the simulation caveat
appears only inside Details.

## 4. Gates

- `npm run build` — PASS.
- `npm test` — PASS, exit 0: **2,470 checks**, 35 suites + 5 gates. Review suite 173/173, card
  render suite 46/46, route lifecycle 1,104/1,104, contract 168/168.
- `scripts/check-layering.mjs` — 127 files, 0 violations, 0 DOM sinks.
- `scripts/check-routes.mjs` — every navigated route exists, every registered route is reachable,
  every CSS class the new stack uses is defined (including the three `.tx-review-context` /
  `.tx-review-counterparty*` classes the rewrite introduced).
- Still **UNVERIFIED**: any real-browser pixel/layout pass, and every live-chain behaviour. The
  faucet binding, in particular, is proven against fixtures and router refusals, not against a
  Betanet switch.

## 5. Claims checked and not adopted

The two pasted documents do not use a shared numbering, and their F-numbers collide with the F-1…F-7
already used in `docs/TX_REVIEW_VERIFICATION.md` §7a (orphaned CSS, docs refresh, `amountText`,
error-code registry, replay, numeric slips, decimals). The F-numbers in this record are the
review-lifecycle audit's own; the older ones are quoted with the §7a prefix when they matter.

| Item | Result |
| --- | --- |
| "The batch registration queue is the owner's in-flight feature" (`2026-10-29-v31-audit.md` R-3) | **Deleted here, and surfaced as an owner decision.** R-3 said the queue was unreachable; the read for this audit found the stronger fact — its only control was created with the `hidden` class and never un-hidden, and the panel behind it submitted prepared reviews with no card. A dead control over a signing loop is a bypass, not a feature; if the batch flow is still wanted it needs its own reviewed design, not a rescue inside an audit. |
| "Bump the release to 1.5.0" (release-fix directive) | **Deferred to the owner.** `package.json` still reads 1.4.1; a version bump is a release decision, and the counts quoted here describe the tree as it stands. |
| "Add a docs-consistency script" (release-fix directive) | **Deferred, not implemented.** The counts this pass changed were refreshed by hand in `docs/AUDIT_REPORT.md`, `docs/STATUS_AND_ROADMAP.md` and here. |
| Stale references to `2e2178f` and to an 8-decimal THRU | **Stale.** This tree is at `2c0aeed`→`826045a`→`5b39dc5`, and THRU is 9 decimals (the earlier section §7a F-7 correction still holds). Nothing in this pass re-derived either. |
| "A green suite is evidence that the flagged paths work" | **Rejected.** Every defect in §2 was green before its fix. The guards added here assert the lifecycle around the happy path: which account the submit binds to, whether a signal exists, how many sheets can open, whether a control was ever shown. |

## 6. What this record does not change

The open owner decisions in `docs/DEFECT_LOG.md` §13 (text records for release, the test-registrar
wording, the release version) and the open verification gaps (browser pass, live Betanet name and
faucet paths) are unchanged. No DeFi flag was touched; every DeFi path is still off and still
answers `supported:false`.

## 7. Follow-up commit `5f004ad` (same day) — reviewer list closed, fewer words on the card

`976f2f3` deleted the helpers and CSS the copy rewrite orphaned (`hasDecoder`/`getDecoder`,
`movementBox`, `.balance-change-box*`, `.change-amount`, `.tx-review-eyebrow`) and added the `[15]`
guard that fails if a helper comes back. `5f004ad` then closed the rest of the PR #21 reviewer
list after re-checking every item at HEAD, and folded in the owner's 2026-10-28 copy direction.

### 7a. Reviewer items, re-checked one by one

The 33 CodeRabbit inline comments on this PR were re-verified against the tree at `5f004ad`. The
numbers below are their order in the pull request; "fixed" means the code or document at that path
now says the opposite of what the reviewer found, not that a reply was posted.

| # | At | Finding | State |
| --- | --- | --- | --- |
| 1 | `scripts/preview-tx-review.html:115` | `onChange` touched `confirmBtn`/`status` before their declarations, so the harness page threw | fixed — bindings declared before the card is constructed |
| 2 | `scripts/serve-dist.mjs:54` | `--root .` served the whole checkout on `0.0.0.0` | fixed — loopback default, `--host` is the explicit opt-in |
| 3 | `review-service.js:254` | `acknowledgements` was the one nested param the router does not type-check; a non-iterable reached `new Set(...)` and surfaced as `METHOD_ERROR` | fixed — `INVALID_INPUT` unless it is an array of strings |
| 4 | `review-service.js:298` | a blocked review was blocked only by the disabled button | fixed — `record.state !== 'ready'` → `NOT_EXECUTABLE` in `confirmReview` |
| 5 | `review/kinds.js:359` | paid-registry labels were validated with the custom registrar's lowercase/3-character rules | fixed — `requireRegistryLabel` uses `registrar.purchaseNameProblem`, keeps the typed case |
| 6 | `review/store.js:85` | read-modify-write was not serialized per network | **open** |
| 7 | `decoders/token-transfer.js:28` | a mint ticker of `THRU` produced a review indistinguishable from a native send | fixed — `symbol-impersonation` warning, mint address stays visible |
| 8 | `decoders/token-transfer.js:36` | an unreadable mint was reported as a missing mint | fixed — only `=== false` blocks; `null` warns without blocking |
| 9 | `routes/name.js:774` | re-entry while `tx.prepareReview` was pending | fixed (F-5) |
| 10 | `routes/send.js:872` | a superseded prepare could paint over the form the user had gone back to | fixed — `reviewSeq` + held review discarded on leaving the step |
| 11 | `routes/send.js:905` | `Banner` compared a new tone against the tone it was *constructed* with, so a warning's classes stuck and a later error rendered as a warning | fixed in `kit/feedback.js` — tracks the tone currently shown |
| 12 | `confirm.js:114` | `requirePassword` folds every submit error into the password dialog, so `SERVICE_TIMEOUT`/`uncertain` never reach `classifyReviewError` | **open** |
| 13 | `CONTEXT.md:10` | stale contract counts | fixed (v31 / 153) |
| 14 | `MANUAL_SMOKE_CHECKLIST.md:347` | run-record references pointed at §7 | fixed — no `§7` reference remains |
| 15 | `TX_REVIEW_VERIFICATION.md:218` | §3 still claimed Faucet signs directly | fixed — "no UI route calls a signing method directly any more", with the v12 activation precision note |
| 16 | `routes/faucet.js:335` | no in-flight guard between sheet close and settle | fixed — `submitting` + `destroyed` |
| 17 | `contracts/thru-custom-registrar/src/processor.rs:330` | registrar fee is debited best-effort | **open** — contract decision, not a wallet claim |
| 18 | `BACKEND_GAPS.md:85` | stale "custom lease renewal unavailable" | fixed |
| 19 | `GLOBAL_SMART_CONTRACT_POLICY.md:92` | the no-bypass rule did not name the owned-account activation exception | fixed — stated exception for the v12 `tx.registerAccount` path |
| 20 | `STATUS_AND_ROADMAP.md:19` | unresolved merge markers | fixed — none remain |
| 21 | `scripts/defi-evidence/…json:14` | a skipped Initialize recorded `vmError: 0` | fixed — `vmError: null`, `initializeState: "skipped"`, and the deploy script emits it |
| 22 | `name-service.js:67` | `alice.id` refused | fixed — suffix peeled before the label rule |
| 23 | `decoders/domain.js:325` | a custom-registrar renewal fell through to the registry rows ("2000 TOKEN" for THRU) | fixed — `provider === 'custom'` branch |
| 24 | `routes/name.js:400` | `queueBtn` was created hidden and never shown | fixed — control deleted |
| 25 | `routes/name.js:1058` | the queue submitted prepared reviews with no card | fixed — queue deleted |
| 26 | `STATUS_AND_ROADMAP.md:82` | roadmap described the queue as live source | fixed — records the deletion and the owner decision |
| 27 | `primary-name-service.js:296` | `reverseLookup` could check network A's record against network B's chain | fixed — `NETWORK_MISMATCH` |
| 28 | `review/kinds.js:720` | the displayed domain was not bound to the root used for submission | fixed — `tld` from the root, else `null` |
| 29 | `decoders/domain-record.js:99` | `accountRole`'s arguments were swapped | fixed — `accountRole('Domain account (written)', facts.domainAddress)` |
| 30 | `routes/send.js:538` | reverse lookup sat on the path that gates Review | fixed — fire-and-forget, still generation-guarded |
| 31 | `routes/send.js:544` | a stale lookup could overwrite a newer recipient's status | fixed — `stale()` checked before every write |
| 32 | `BUILD_SPEC.md:204` | the v31 in-place `name.setRecord` change had no documented exception | fixed — "Contract v17–v29 additions and the v31 exception" section |
| 33 | `review/kinds.js:796` | an absent domain was reported as `NAME_TAKEN` | fixed — `NAME_NOT_FOUND` added and listed in `STALE_REVIEW_CODES` |

Three remain open (#6, #12, #17) and each is a decision, not a typing error: storage locking, the
password dialog's error boundary, and whether the registrar contract should refuse rather than
best-effort a fee debit.

`#22` is the interesting one: `lookupName` used to validate the typed string before deciding which
namespace it belonged to, so a two-character root (`id`) was measured against a rule that only
applies to labels *under* a root. The fix peels a known suffix first, validates the label, and — for
a caller that supplies both a suffix and a `rootAddress` — refuses (`INVALID_PARAMS`) when the two
name different namespaces. `#28` follows from the same mistake on the review side: a label inherited
from the caller is not proof of the namespace, so `domainRecordFacts` now derives it from the root
account that will actually be written to and leaves it `null` when it cannot, with the decoder
printing the bare name and a `tld-unverified` warning.

### 7b. Copy pass

Every `warn(...)` call in the decoders supplies a title and a detail — 49/49, checked by a scanner
during this pass rather than by eye; the earlier note that "the decoders are all title and no body"
was a grep artefact (the decoders pass the detail positionally, so a search for `detail:` finds
nothing). What did change:

- handler-internal phrasing is gone from user copy ("the handler re-reads it before signing" → "the
  wallet checks the balance again before signing");
- a transfer or claim whose counterparty IS the signing account reads `To your account` instead of
  echoing the account's own name back as if it were somebody else;
- the fee is stated once: the `fee-unmeasured` warning duplicated what the money table already says
  ("not confirmed (paid in THRU)"), so the warning was removed and the test now asserts the row,
  not the echo;
- `Details` gained a `From` row — the address the signature will come from.

### 7c. Still open, and why

| Item | State |
| --- | --- |
| #12 (`requirePassword` internals), #17, #19, #32 | open; each needs a decision about the auth prompt's internals, not a copy change |
| #13/#14 | `MANUAL_SMOKE_CHECKLIST` still cross-references §7 where §8 is meant |
| #24 | moot after `826045a` (the queue it described is deleted) |
| R3 (single-use status scoping), R4 (ledger v31/153 sync) | outside this PR's diff, still open |
| Owner decisions (a)–(e) | unchanged: text records vs `name.setRecord`, plain-card scope, test-registrar wording, release version + docs-consistency script, notifications root cause |

### 7d. Gates after `5f004ad`

`npm run build` exit 0. `npm test` exit 0 — **2,481** `ok -` checks (35 suites + 5 gates);
`test-tx-review.mjs` 175, `test-tx-review-card.mjs` 46, `test-name-records.mjs` 57,
`test-route-lifecycle.mjs` 1,113, `test-contract.mjs` 168. Still UNVERIFIED: browser/pixel layout and
every live-chain behaviour.
