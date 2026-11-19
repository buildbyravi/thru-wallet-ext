# Hard rules — full text

Referenced from `AGENTS.md`. Rules 1–9, 11, 12, 13 and 18–29 are complete in one or two lines there
and are NOT duplicated here (a duplication is a place for the two copies to disagree). This file
carries the LONG text of rules 10, 14, 15, 16, 17 and 30 — the signing exception, the layout rule,
the no-blocking-paint rule, the review pipeline and the independent verification rule.

The rule NUMBERS are stable: `src/` comments cite rule 15 (paint first), `test-toast.mjs` cites
rule 14 (layout needs eyes), `test-launchpad-quarantine.mjs` cites rule 6 (BigInt), and
`test-route-lifecycle.mjs` cites rule 5 (no new dependencies). Never renumber.

## Rule 10

10. **Password re-authentication is always required** before export, security-setting changes,
    keyring add/rename/remove, and unlocked reset. Transaction signing requires an unlocked session
    by default; the user may opt into per-sign password re-authentication, and changing that setting
    in either direction is password-gated. This session-only default is an explicit product decision,
    not permission for alternate signing paths: every value-moving method still uses centralized
    `auth: 'signing'`, reviewed account/network binding, and the one signing service. Use
    `requirePassword()` from `src/ui/domain/password-prompt.js` when the preference requires it.
    Value-moving screens reach that service only through the v29 review pipeline (Hard rule 16).
    **Narrow contract-v12 exception:**
    `tx.registerAccount` is unlocked-only for a vault-owned address at account creation or when
    selected as an unregistered own Send recipient. It still signs/broadcasts; never add a
    periodic all-accounts signing loop or allow arbitrary recipient registration.
    **Self-signing invariant:** resolve the *target's* keypair from the unlocked vault. Both
    its public key and the public key derived from its private key must match the target address;
    that same pair must be the fee payer in `createOnChainAccount`. Account 1 must never sign
    Account 4's registration. The ONLY activation transaction is the native account-creation
    program (the network's configured `accountCreateProgramId` — the NOOP program on 0.4.0+
    chains — with fee `0n`, nonce `0n`, stateUnits `1`);
    never claim the faucet or send a dummy/zero-value transfer to activate an account.

## Rule 14

14. **Layout must be SEEN, not reasoned about.** Any change touching modal, sheet, drawer or
    overlay layout must be visually validated in a real browser -- or in a visual harness that
    loads the real built `dist/popup.css`, e.g. `scripts/preview-tx-sheet.html` or
    `scripts/preview-tx-review.html` -- before the PR
    is opened. `npm test` runs on a hand-rolled DOM shim with **no layout engine**: it cannot
    compute a height, resolve `max-height`, run the flexbox algorithm or read `scrollHeight`, so
    it is structurally incapable of detecting flex shrinking, `overflow` clipping or a scroll
    container that does not scroll. "The CSS reads correctly" is not evidence about layout, and
    a green suite is not evidence about layout. This rule exists because a detail sheet shipped
    that silently amputated its last two rows and drew no scrollbar -- it passed every automated
    gate and two independent code audits, and was found by a user on a real popup
    (`docs/DEFECT_LOG.md`).

    Before implementing or modifying UI layouts, routes, components, or visual styles, agents
    with access to the Figma connector must also check the canonical extension design file
    ([thru-Extension](https://www.figma.com/design/qKl8tsbCmSdtY6uZ0G8tnb/thru-Extension),
    `file_key: qKl8tsbCmSdtY6uZ0G8tnb`) via `get_file` / `get_file_nodes` / `get_images` /
    `get_comments` alongside `docs/BUILD_SPEC.md` (§5) and `src/popup/styles/tokens.css`. Under
    `docs/DOCS_INDEX.md` §1, shipped `src/` remains authoritative if Figma and source diverge.

## Rule 15

15. **The frontend never waits on a chain/RPC/backend read before its first paint.** The UI and
    the service-worker backend are deliberately separate: a slow or dead network must never stall
    the popup. Every route paints immediately from local state — chrome.storage caches (native
    balances, token balances, history, swap pool snapshot, name-provider facts) or an explicit
    "checking/unknown" placeholder — and live reads hydrate asynchronously and REPLACE the
    placeholder; they never gate it. A route that shows only a spinner until an RPC resolves is
    a defect of the same class as a crash. When you add a read, also add the cached counterpart
    (`*.getCached*`), and label stale data instead of pretending it is fresh (2026-10-26 owner
    directive).

    Startup and navigation obey the same rule: paint safe local UI before bootstrap hydration,
    never an intermediate "Checking wallet" page after unlock. Do not erase typed input when
    same-context reads finish. UI session caching must never bypass background authorization;
    lock/reset invalidate private UI and departing routes clear secrets synchronously.

## Rule 16

16. **A value-moving screen goes through the ONE review pipeline; it never signs.** The sequence is
    `tx.prepareReview` → `src/ui/domain/tx-review/review-card.js` → `tx.confirmReview` (which
    re-validates and returns the submit instructions for the operation's existing signing method)
    → `confirm.js`, the only confirm→auth→submit step. Do not add a feature-owned signing screen, fee formatter, warning copy or password
    flow, and do not call a signing method from a route. `test/test-tx-review.mjs` [14] enforces
    this: it scans every `src/ui/**/*.js` for `bridge.send('<method>')` literals and fails if any
    names an `auth:'signing'` method (or a method absent from the manifest). The only non-review
    call the UI makes itself is the v12 `tx.registerAccount` activation, which is `auth:'unlocked'`
    by design. Dashboard used to fail this rule with `tx.autoCreateAccount`; do not reintroduce it. To support a new operation, add a decoder
    (`src/shared/tx-review/decoders/`), register it, and add a kind spec in
    `src/background/services/review/kinds.js` naming the EXISTING submit method. An undecodable
    transaction decodes as explicit unknown with raw details and `submit: null` — never guess a
    friendly name for it, never give it a submit policy, and never let it be signed. Simulation
    is unavailable (`tx.simulate` → `supported:false`), so never render a post-transaction
    balance or a simulated-success state. A review is single-use: a successful confirm discards
    it, so a replay is `REVIEW_NOT_FOUND` (stale), not a second broadcast.

## Rule 17

17. **No repetitive explanatory/disclaimer essays on review screens or in the UI.** State facts
    cleanly, concisely, and objectively (e.g. `Simulation: Not available`, `Program: Thru transfer program`,
    `Fee: 0.00000001 THRU`) without patronizing explanations, preaching, or disclaimer essays. Do not insert
    paragraphs justifying why dry-run is unverified, why post-transaction balance is not shown, that signing
    is irreversible/fixed, or that actual fees appear in Activity after confirmation. Present verifiable data,
    not essays.

## Rule 30

30. **Never trust green test reports as sole proof (Independent Verification).**
    An implementation agent's test files, passing test output, audit notes, and completion reports
    are **claims to verify, not independent evidence**. The same agent may have introduced the
    defect and encoded the same incorrect assumption in its tests.

    The audit/review agent MUST:
    1. **Independently derive expected behavior** from authoritative requirements, protocol
       specifications, pinned SDK source/API, contract source, and deployed behavior where
       applicable. Do not derive expected behavior solely from the implementation or its tests.
    2. **Read and critically review the tests themselves.** Check that assertions validate the
       actual requirement, cover failure paths and edge cases, and cannot pass because of mocks,
       permissive fixtures, hard-coded expected values, skipped tests, weakened assertions, or
       shared implementation assumptions.
    3. **Independently verify critical behavior** using a separate method where feasible: direct
       source inspection, targeted adversarial tests, independent test fixtures/oracles, integration
       tests, real browser execution, or live-chain evidence.
    4. **Reproduce reported commands and results on the exact candidate commit SHA.** Never
       transfer a passing result from another branch, commit, worktree, build artifact, or PR head.
    5. **Treat missing, inaccessible, mocked, stale, or unverified evidence as UNVERIFIED**, not
       PASS. Clearly separate IMPLEMENTED, TESTED, INDEPENDENTLY VERIFIED, and UNVERIFIED.
    6. **Do not approve a release solely because the implementation agent reports that tests pass.**
       Record independently verified evidence, remaining gaps, and the exact commit SHA. Keep the
       release blocked when a critical behavior lacks sufficient independent verification.
