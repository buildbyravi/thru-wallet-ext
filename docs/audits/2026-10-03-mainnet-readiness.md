# Mainnet-readiness audit — 2026-10-03

**Scope:** branch `arena/01a10231-thru-wallet-ext` at `05fda07`, compared with `main` at
`cee006e`. Reviewed architecture and layering, API authorization, native/token signing, network
isolation, pending transaction persistence, vault/preferences storage, dependency vectors,
documentation truthfulness, and the deterministic build/test gates. This was a source-level audit;
no live-chain transaction, real-Chrome lifecycle/layout test, or external security audit was
performed.

**Result at audit time:** **SECURITY REVIEW REQUIRED** before Mainnet. No critical defect was
confirmed. Two high, three medium, and two low findings were identified; source remediations are
recorded below. The existing deterministic controls are
substantial: exact dependency pins, stable derivation vectors, centralized API auth, an encrypted
versioned vault, trusted-context session storage, strict CSP, zero runtime DOM injection sinks,
network-scoped chain state, checked UI send calls, and broad contract/lifecycle regression coverage.
Those controls did not close the findings below at audit time.

### Remediation update — 2026-10-03

All seven source findings were addressed on this branch:

- **MR-01:** a centralized signing-operation guard now prevents `network.setActive` from mutating the
  singleton Thru adapter from before account/network resolution through submission completion.
  Native send and owned-account registration interleaving tests prove the lock and its release.
- **MR-02:** contract v16 removes the retired `tx.send` and `token.transfer` handlers and manifest
  entries after confirming shipped UI callers use only checked methods. Contract guards prevent the
  weaker signing paths from returning.
- **MR-03:** pending records use a per-network serialized mutation queue and a versioned envelope.
  A concurrent-track regression proves two distinct submissions cannot overwrite one another.
- **MR-04:** durable vault, preferences, contacts, account labels, pending transactions, and deployed
  token records now have explicit schema handling. Legacy records migrate on mutation and future
  versions fail closed. Balance/history data remain explicitly disposable, network-scoped caches;
  History additionally carries a chain fingerprint and both are safely rebuilt from RPC.
- **MR-05:** the user selected session-only signing as the explicit default. `AGENTS.md` now matches
  implementation: changing signing protection is password-gated, while every value-moving call uses
  centralized signing auth, reviewed context, and the network mutation lock.
- **MR-06:** current status now records contract v16, the current audit baseline/test evidence, and
  separates Alphanet from Betanet observation provenance.
- **MR-07:** derivation provenance records verification against pinned SDK 0.4.1 without changing any
  golden address.

**Residual verification:** source remediation is **IMPLEMENTED and TESTED**, not verified against a
live network or real Chrome lifecycle. Those checks and an external audit remain required before a
Mainnet readiness claim.


### Findings

#### MR-01 — HIGH — active-network mutation is not atomic with signing

**Status:** CONFIRMED; previously identified in `docs/SEND_PATH_AUDIT.md`, still open.

`tx.sendChecked` and `token.transferChecked` verify the reviewed account/network before and after
preflight (`src/background/services/tx-service.js:120-165`,
`src/background/services/token-service.js:274-312`), then enter `thru-client` signing/submission.
The client uses mutable module-level network binding. Another extension page can switch the active
network after the last context check while an asynchronous SDK sequence is still running. Token
transfer has the larger window because recipient token-account initialization can add a separate
transaction. Tracking pins a late signature to the starting network, but that is accounting after
the fact; it does not prove every RPC, build, sign, and submission step used one immutable network
context.

**Impact:** stale-network signing/submission, wrong-chain RPC use, or an indeterminate result during a
network switch. This violates the requirement that the reviewed network remain bound through
signing and submission.

**Required remediation:** make transaction clients/network configuration immutable per operation, or
serialize network changes against active signing operations. Add deterministic interleaving tests at
every asynchronous boundary and verify the final design with safe live-chain transactions.

#### MR-02 — HIGH — legacy callable send methods retain the weaker authorization contract

**Status:** CONFIRMED.

The UI correctly calls only `tx.sendChecked` / `token.transferChecked`, but the append-only API still
exposes `tx.send` and `token.transfer` as signing methods (`src/shared/contract/manifest.js:344-350,
528-537`). Their service calls pass `expected = null`; `assertSendContext()` explicitly returns
without checking reviewed source/network when that value is absent
(`src/background/services/send-context.js:7-9`). Tests deliberately preserve and exercise these
legacy methods. The background sender check restricts calls to extension-owned contexts, which
reduces external exposure, but any compromised or regressed extension page can invoke the weaker
path through the same bridge contract.

**Impact:** the repository has two callable signing contracts, and the weaker one does not bind the
reviewed account and network. The weakest path becomes the security boundary.

**Required remediation:** define a compatibility-safe retirement plan with an explicit deadline.
Immediately reject legacy mutation calls from the shipped contract/router once zero production
callers are confirmed, or require the same reviewed context on all signing entry points without
silently reshaping the old API. Add a guard that fails if UI code calls a legacy signing method and a
contract test that prevents new unbound signing methods.

#### MR-03 — MEDIUM — pending transaction persistence can lose concurrent updates

**Status:** CONFIRMED; already documented, unresolved.

`pending.track()` and `settle()` perform independent storage read-modify-write sequences
(`src/background/services/pending-tx-service.js:87-107,235-245`). Two submissions or a submission
racing reconciliation/clear can read the same snapshot and overwrite one another. The in-memory
intent set prevents only identical concurrent sends and does not serialize distinct transfers or
survive worker restart.

**Impact:** a submitted signature can disappear from pending state/history signaling, weakening
duplicate protection and leaving the user without durable lifecycle visibility even though funds
may have moved.

**Required remediation:** serialize mutations per network through one authoritative storage update
queue and test track/settle/clear interleavings, including worker-restart fixtures.

#### MR-04 — MEDIUM — persistent schemas are not consistently versioned or migrated

**Status:** CONFIRMED.

The encrypted vault has explicit envelope/data versions and a V1→V2 migration. Preferences declare
`version: 1`, but `getPreferences()` accepts any stored object and forcibly reports the current
version without rejecting or migrating a future version
(`src/background/services/preferences-service.js:54-74`). Pending transactions, contacts, network
selection/custom rows, balance/history caches, deployed-token records, labels, lockout state, and
side-panel mode are stored as unversioned values or arrays. Network scoping is well enforced, but
scope is not schema versioning.

**Impact:** upgrades/downgrades can silently reinterpret old or future data. For pending and token
state this can affect transaction visibility and asset presentation; for preferences it can silently
change security behavior.

**Required remediation:** inventory every durable key, classify cache versus product state, add
versioned envelopes and explicit migration/rejection rules, and add old→new regression fixtures.
Future-version records must fail safely instead of being relabeled as the current version.

#### MR-05 — MEDIUM — signing re-authentication policy contradicts the permanent rule

**Status:** CONFIRMED documentation/security-policy conflict; product decision required.

`AGENTS.md:175-178` says password re-authentication is required by default and signing has an opt-out.
The implementation defaults `requirePasswordForSigning` to `false`
(`src/background/services/preferences-service.js:26-30`), and the router therefore signs while merely
unlocked unless the user opts in. `docs/STATUS_AND_ROADMAP.md:10,64-65` accurately describes the
implementation but conflicts with the permanent rule.

**Impact:** reviewers and future agents cannot identify the intended authorization invariant. An
unattended unlocked wallet can sign without a fresh credential under the shipped default.

**Required remediation:** stop for an explicit product/security decision. If re-authentication is the
policy, migrate existing preferences deliberately and test upgrade behavior; do not silently flip the
default. If session-only signing is accepted, amend the permanent rule and record the decision and
trade-offs in the maintained architecture/decision documentation.

#### MR-06 — LOW — maintained status documentation is stale and internally inconsistent

**Status:** CONFIRMED.

`docs/STATUS_AND_ROADMAP.md` identifies an old source baseline (`4aa55ba`), advertises contract v12 / 81
methods, and reports old test counts, while source is contract v15 and current tests report different
counts. It also labels a section “Historical live-chain observations — native Alphanet scope only”
while one bullet calls the transfer fee a Betanet observation. These are provenance distinctions that
matter for protocol claims.

**Impact:** agents can make decisions from stale capability/version claims or overstate which network
was actually verified.

**Required remediation:** refresh the current-state header and verification evidence from source,
separate Alphanet observations from Betanet verification, and retain old results only as explicitly
historical provenance.

#### MR-07 — LOW — dependency-vector provenance was not advanced with the pinned SDK

**Status:** CONFIRMED metadata gap; deterministic addresses still pass.

`package.json` exactly pins `@thru/sdk` and `@thru/programs` at 0.4.1, but
`test/test-derivation.mjs:36-40` records 0.4.0 as the last verified vector version. The test emits a
warning and passes because all addresses remain unchanged. Exact pinning and the vector assertions
protect derivation behavior, but the repository does not record completion of the directive's full
0.4.1 upgrade review (release/API inspection, encoding/network/migration tests, bundle comparison,
and rationale) in the maintained audit trail.

**Impact:** derivation is currently protected, but dependency-upgrade provenance is incomplete and a
warning becomes normal background noise.

**Required remediation:** verify and record the 0.4.1 upgrade checklist, then update vector provenance
without changing golden addresses. Keep a mismatch visible/failing once the recorded version is
brought current.

### Mainnet gate

MR-01 through MR-07 now have source remediations and deterministic coverage. Do not represent this
build as Mainnet-ready until the real-Chrome checks and open live-chain checks in
`docs/STATUS_AND_ROADMAP.md` are completed. An external audit remains **EXTERNAL AUDIT REQUIRED**;
this source review and remediation are not a substitute.


### Verification performed for this audit

- `npm ci` — PASS, 0 reported vulnerabilities.
- `npm run build` — PASS.
- `npm test` — PASS, including derivation, layering/CSP/routes, launchpad quarantine, contract,
  security/DOM/lifecycle, vault, Thru client, token/balance/network, history, registration,
  API-router, and auto-lock suites.
- `git diff --check` — PASS before this report update.

Automated success is local evidence only. No real browser or live network claim is made.

---
