# Audit — the v30 domain merge, synced and audited 2026-10-28

**Scope.** The branch `arena/0439c226-thru-wallet-ext` advanced from `a613fcb` (the head this
auditor last verified) to `3276245` — 224 commits, but only **35 files** of real change once the
merge topology is collapsed:

```text
git diff --stat a613fcb 3276245     35 files changed, 2099 insertions(+), 346 deletions(-)
```

The substantive changes are: the tracked-domain registry (contract v30, five new `name.*` read
methods), `.thru` name resolution in Send, custom-registrar lease renewal (`via:'custom'`), a
rebuild of `/name`'s UI (tabs + registration queue), a contract change to
`contracts/thru-custom-registrar/src/processor.rs`, and documentation.

**Method.** Each claim below was checked against `src/` at `3276245`, not against commit messages.
The pipeline was exercised directly: decoders were driven with the exact fact shapes
`services/review/kinds.js` produces (a temporary probe script calling `decodeReview`), and the
full suite was run before and after any change.

**Baseline recorded before any modification** (fresh `npm install`, this sandbox):

```text
npm run build   PASS — no warnings
npm test        PASS — 2,317 checks (tx-review 143/143, route-lifecycle 1,104/1,104,
                contract 161, derivation 16/16 on the 0.4.2 pin)
contract        v30, 152 methods, 44 error codes, 15 routes, 262 used CSS classes (all defined)
```

So the tree arrived green. Every finding below is something the suite did not test, not something
it caught and shipped anyway.

---

## Findings

| # | Severity | Finding | State |
| --- | --- | --- | --- |
| D-1 | P1 | A custom-registrar **renewal** rendered in the wrong currency, and the branch meant to cover it lived in another decoder and crashed | **FIXED** (decoders + tests `[3]`) |
| D-2 | P1 | A send the user typed as `alice.thru` lost the name: the route passed it, the background dropped it | **FIXED** (`kinds.js` + tests `[2b]`) |
| D-3 | P1 | The custom registrar's fee is **best-effort on chain**, but the review stated it as a charge the program enforces | **Reported + wording corrected**; contract decision open |
| D-4 | P2 | The batch registration queue added in `55703d0` is unreachable, and its submit loop renders no review | **Reported** (owner decision) |
| D-5 | P2 | Documentation contradicts the code: "custom renewal is not wired" (it is), "multi-entry controls deleted" (they are in source), stale counts | **FIXED** |
| D-6 | P2 | **Merge-conflict markers committed** in `docs/STATUS_AND_ROADMAP.md` | **FIXED** |

### D-1 — the custom renewal rendered `2000 TOKEN`

`kinds.js` routes a custom renewal to the `domain-renew` kind (`domainCustomRenewFacts`). The
`domain-renew` decoder had no custom branch, so the facts fell through `paidRegistryBlock` →
`paymentMovement`, which reads `facts.payment`. Custom facts have no `payment` block, so the
fallback `symbol: 'TOKEN', decimals: 0` printed **`Total price = 2000 TOKEN`** for 2,000 base
units of THRU (`0.000002 THRU`). The same decoder also emitted `payment-balance-unknown`, a
warning about a token the transaction never touches.

The branch that was *supposed* to handle this case was inside `decodeDomainPurchase` — a kind
whose facts are always `provider:'registry'`, so the branch was unreachable — and it threw
`ReferenceError: warnings is not defined` on its first line. Driving it directly:

```text
## custom renewal (kind=domain-renew)
  outgoing: 2000 TOKEN (dec 0)
  rows: ... Price per year=1000 TOKEN | Total price=2000 TOKEN
## custom facts via purchase decoder (kind=domain-purchase)
  THREW: ReferenceError - warnings is not defined
```

**Fix.** One currency decision for the whole registrar family (`priceUnit`/`priceRow`/`totalRow`
in `decoders/domain.js`), a real `provider === 'custom'` branch in `decodeDomainRenew` (native
THRU, custom registrar identity, the best-effort quote warning, `New expiry` not computed), and
deletion of the dead crashing branch. The card is now:

```text
Renew domain lease · Betanet · Decoded
Custom `.thru` registrar · Signing with Main account · Verified program
You pay 0.000002 THRU
Domain vault.thru | Current expiry Nov 18, 2026 | Duration 2 years
Price per year 0.000001 THRU | Total charge 0.000002 THRU | New expiry Set by the chain
⚠ The final charge is decided by the program (info)
```

**Tested** (`test-tx-review.mjs` `[3]`): THRU units and 9 decimals, no `TOKEN` anywhere in the
table, the custom registrar named as the protocol, the best-effort warning present, an
unaffordable renewal blocking, and — the general guard — **no domain decoder throws or names a
currency it is not charging for an unexpected provider**. Negative control: disabling the new
branch fails the suite.

### D-2 — a domain recipient's name never reached the review

`send.js` resolves `alice.thru` through `tx.validateAddress` and passes
`recipientLabel: recipientState.resolvedName` into `tx.prepareReview` (both send kinds). Both
`nativeSendFacts` and `tokenTransferFacts` set `recipientLabel: await labelFor(toAddress)` — the
address book — and ignored the param. The card therefore showed a bare `ta9zY…` address for a
send the user had expressed as a name. The decoder was already able to render it (`row('To',
address, { above: recipientLabel })`), so this was purely a dropped wire field.

**Fix.** `resolvedRecipientLabel(params)` in `kinds.js`: string-only, trimmed, length-capped,
display-only; used by both kinds with the address-book label as fallback. It is never a
resolution source — the address is what the handler signs for, and the background resolved the
name in the first place.

**Tested** (`[2b]`): the decoder renders the name above the exact reviewed address for both
kinds, both kinds read the param, and the value stays bounded. Negative control: restoring the
dropped field fails the suite.

### D-3 — the registrar charges best-effort, and the card said otherwise

`contracts/thru-custom-registrar/src/processor.rs` performs the fee as

```rust
// In ThruVM, a smart contract cannot directly debit an EOA's native balance without EOA ownership.
if total_fee > 0 {
    let _ = mgr.account_transfer(0, ix.treasury_idx, total_fee);
}
```

The result is discarded (`register` got this in `2f98b5a`, `renew` in this merge). `2f98b5a` also
added `describeTcrError`'s `0xd20a` → *"fee transfer failed (account not writable)"* mapping — the
live failure that motivated the change. So on the deployed program the declared fee may simply
not be collected, while the wallet's review said *"Charged by the registrar program itself, in
THRU base units"* and blocked a low balance with *"so the program would reject it"* (it will not).

**Corrected in the card** (what can be proven from this repository): the movement note and the
`quote-not-final` warning now say the deployed program applies the charge best-effort, so the
amount actually debited is decided on-chain; the insufficiency warning says the **wallet** will
refuse to sign, which is what `registrar-service.js` actually does (`INSUFFICIENT_FUNDS`).

**Open, and not the wallet's call:** whether the program should fail the charge, create a
writable treasury, or drop the price entirely. Until one of those happens, a price shown in the
card is a declared price, not a guaranteed debit — and the handler's balance refusal is
conservative but arguably wrong (it can block a renewal the program would happily perform for
free). Recorded in `docs/DEFECT_LOG.md` §13.3.

> **Resolution (2026-10-30).** The owner decided: the fee must be enforceable and fail closed, and
> it is tiered by label length. `contracts/thru-custom-registrar` now stores three per-year prices
> and a `fee_policy`; `strict` reverts on a refused charge (`0xD206` / `0xD207`) and `best-effort`
> keeps the behaviour audited above. Because the only live evidence is that refusal (`0xD20A`),
> strict is opt-in and gated in the deploy script behind a measured treasury delta, and the wallet
> derives `feeEnforced` from the on-chain policy instead of assuming a charge. The finding above —
> *a shown price is a declared price until collection is proven* — still stands for any config in
> the best-effort state. See `docs/DEFECT_LOG.md` §18.

### D-4 — the batch registration queue is dead code with a signing loop in it

`55703d0` ("multi-name registration queue") adds `queuedRegistrations`, `renderQueue()`, and a
`Register N names` loop that calls `tx.prepareReview` + `submitReviewedReview` **without ever
rendering the review card**. `queueBtn` — the only control that could start this — is created with
`class 'hidden'`, added to `mutationControls`, and only ever `classList.add('hidden')` again:

```text
$ grep -n "queueBtn.classList" src/ui/app/routes/name.js
434:      queueBtn.classList.add('hidden');
```

So the flow is unreachable today, which is why nothing failed. It is also exactly the shape the
architecture forbids if it is ever revealed: a feature-owned signing loop that shows a password
prompt instead of a decoded review.

**Recommended (owner decision):** either delete the queue, or give it a per-item review card and
one confirm gate. `docs/BACKEND_GAPS.md` and `STATUS_AND_ROADMAP.md` no longer claim it is deleted.

### D-5 — documentation versus code

- `docs/BACKEND_GAPS.md` said custom "lease renewal/claim is not wired in the wallet". Renewal
  **is** wired (`kinds.js` `domainCustomRenewFacts` + `renewCustom` + `via:'custom'`); claim is not.
- The same file and `STATUS_AND_ROADMAP.md` said "multi-entry controls and batch totals are
  deleted" — they are in source (D-4).
- Current-state figures were one merge stale: contract v29/147 methods (now v30/152), `npm test`
  2,253 (now 2,326), review suite 143 (now 152), route lifecycle 1,065 (now 1,104), 257 CSS
  classes (now 262).

### D-6 — committed merge-conflict markers

`docs/STATUS_AND_ROADMAP.md` contained `<<<<<<< HEAD` / `=======` / `>>>>>>>` around the review
and domain sections (lines 17–62 at `3276245`). Both sides were kept, deduplicated into one review
section plus one domain section. Nothing in `npm test` reads Markdown, so this shipped silently;
it is the kind of thing only a read-the-diff audit finds.

---

## What the merge gets right (checked, not taken on trust)

- **Tracked-domain storage is sound.** `{version:1, revision, records}` with a v0 migration that
  projects primary aliases on read and persists only on the next mutation; unsupported versions
  fail closed; mutations serialized per network; a refresh that lost the revision race does not
  write and reports `stale`. `clearAllDomains()` bumps a generation so late writes are rejected.
- **Ownership is re-proven, not trusted.** `lookupTrackedName` verifies the account owner is the
  name-service program and that parent/name/length match the requested label before a record can
  be `owned`; `trackDomain`/`setPrimaryDomain` refuse unless the fresh read says `owned`.
- **`getAccountOwnerAddress` is the right fix** for the `[object Object]` metadata bug: SDK
  `Pubkey` normalization at the adapter boundary, `null` on malformed input, so an ownership check
  cannot pass by accident.
- **Registration persistence cannot corrupt a confirmation.** `registerAndRemember` runs after the
  handler confirms and returns `trackingFailed: true` on a storage error instead of turning a
  confirmed on-chain registration into a retryable failure.
- **No new signing path.** The five new methods are `auth:'unlocked'` metadata/reads; the
  review-literal scan (`test-tx-review.mjs` `[14]`) still passes.

## Not verified by this audit

- Anything requiring a browser: the merge claims real-Chrome screenshots of the name route from
  the other agent's environment; **no browser binary runs in this sandbox** (Chromium unpacks but
  cannot start — `libnspr4`/`libnss3` absent), so none of it was re-observed here.
- Live-chain behaviour of the new renewal path, the tracked-domain reads, and whether the
  registrar treasury is actually writable today. All evidence for D-3 is repository source plus
  the error mapping, not a fresh probe.
- The Rust contract itself beyond the fee line: no rebuild was attempted, and `contracts/` has no
  test suite in this repository.
