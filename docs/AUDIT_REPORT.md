# Audit report — Thru Wallet Extension


## Production-rules conformance audit — 2026-10-04

**Scope:** branch `arena/01a10602-thru-wallet-ext` at `7883219`. Audited the current repository
against the permanent production-engineering rules (mainnet standard, single source of truth,
security-sensitive reuse, boundaries, network/transaction/storage safety, legacy cleanup,
documentation truth). Read every maintained governance document, inspected `src/`, `test/`,
`scripts/`, `build.mjs`, and `src/manifest.json`, and recorded the baseline before any edit.
This is a source-level audit; no live-chain transaction, real-Chrome lifecycle/layout test, or
external security audit was performed.

**Result at audit time:** no P0 fund-loss/security defect is confirmed. The prior (2026-10-03)
remediations MR-01…MR-07 are all present in source and covered by tests. The findings below are
documentation-truth defects (including two that misstate the signing security policy), one
fee-provenance mislabel in code, and two dead-code leftovers from completed migrations.
**External audit remains required** before any Mainnet-readiness claim; nothing here is one.

### Baseline recorded before any modification

```text
npm run build       PASS — background.bundle.js 1.0mb, popup.bundle.js 190.0kb, popup.css 68.9kb; no warnings
npm test            PASS — derivation 16/16; QR 15/15; layering 80 files / 0 violations / 0 DOM sinks;
                    CSP pass; routes 14/14; CSS nesting pass; launchpad quarantine 47/47;
                    contract 80/80; security-checks 20; DOM/refs 130/130; route lifecycle 1017/1017;
                    storage migrations, vault, thru-client, token-balances, balance-network,
                    history-cache, history-block-time, registration, api-router, auto-lock all pass
npm audit --omit=dev  PASS — 0 vulnerabilities
git diff --check     clean
Contract v16, 81 methods; 14 routes; @thru/sdk and @thru/programs exact-pinned 0.4.1;
derivation vectors record verification against 0.4.1 with unchanged golden addresses.
```

### 1. Passing rules (verified, no action)

| Rule area | Evidence |
| --- | --- |
| Mainnet engineering standard | AGENTS.md codifies it; no "testnet-only/temporary" escape hatches in shipped code; SECURITY.md keeps an honest betanet scope notice rather than overclaiming. |
| SDK version safety | `package.json` exact-pins `@thru/sdk`/`@thru/programs` at 0.4.1; `npm ci` is the CI install; derivation goldens pin `sdkVersion: '0.4.1'` and fail on drift. |
| Golden vectors | 16 derivation checks pass unchanged; transaction/token wire goldens pinned in `test-thru-client.mjs`; no expected value was changed to make anything pass. |
| Frontend/backend boundary | One seam (`bridge.send`); `check-layering.mjs` enforces import rules and the `chrome.runtime.sendMessage` allowlist (UI→background: `src/ui/app/bridge.js` only; background→UI: `event-service.js` only); 0 violations across 80 files. |
| Thru SDK boundary | Only `src/lib/networks.js`, `src/lib/thru-client.js`, `src/lib/vault.js` import `@thru/*`. No SDK leak into UI/application logic. |
| Network safety | Stable network ids (not display names); `network-scope.js` GLOBAL/SCOPED key sets asserted in tests; balances/pending/tokens/history network-scoped; keys/labels/contacts global; v7 custom-network quarantine background-enforced with self-healing. |
| Transaction safety | v16 retired the unbound send paths; checked sends bind reviewed account+network before and after preflight; signing-guard locks network mutation for the whole operation; duplicate protection (synchronous in-flight set + persisted pending + 30s window + mint-aware keying); track-at-submission; timeout ≠ failure; `confirmed` only on positive chain evidence. |
| Storage safety | Vault envelope v1 (KDF params pinned per record) + V1→V2 migration; preferences v1 (future versions fail closed); contacts v1; pending-tx v1 envelope + per-network serialized writes; labels versioned; balance/history are network-scoped rebuildable caches with chain-identity checks. |
| DOM/secret safety | 0 injection sinks across all of `src/` (vendored QR excluded); no `localStorage`/`sessionStorage` in `src/`; secrets never in URLs/`data-*`/console (route-lifecycle sweeps assert it); CSP `default-src 'none'` with `connect-src` exactly matching enabled networks. |
| Launchpad/DEX quarantine | Tree deleted, not flagged; 47-check quarantine test covers source, manifest, flags, routes, and a real `dist/` build. |
| No fake implementations | `estimateFee` returns `supported:false` where unmeasured; `simulate` unsupported; token reads distinguish proven-zero vs unknown; `feeCharged: false` distinguishes declared from charged. |
| One UI stack | Legacy tree deleted; 14 routes registered, mounted, reachable; `check-routes.mjs` both directions. |
| Observability | Diagnostics log method/error class/network id/addresses only; all 15 `console.*` sites in `src/` reviewed — none log secrets. |

### 2–3. Partial / failing rules (findings)

**F-01 — P1 — README misstates the signing security policy.**
`README.md` "Security basics" says "Signing requires password re-authentication by default.
Session-only signing is an explicit user setting and is less secure." The shipped default is the
opposite (`requirePasswordForSigning: false`; password re-auth is the explicit password-gated
opt-in), as decided in `docs/DECISIONS.md` D-003 and stated correctly in the same README's
"Current state" section, STATUS_AND_ROADMAP, and BUILD_SPEC. A user reading Security basics
forms a false belief about what protects an unattended unlocked wallet. Files: `README.md`.

**F-02 — P1 — `llms.txt` (the agent brief) states wrong current facts.**
It claims contract version 8 (actual v16), that a stale active network id "self-heals to
Alphanet" (actual: Betanet), that password re-authentication is required by default (actual:
session-only default per D-003), the hosted-wallet URL `wallet.thru.org/embedded` (actual:
`app.tid.sh/embedded`, per DOCS_INDEX/BUILD_SPEC), and lists shipped work (token transfer,
contacts UI, account pin/hide/order) as future P0s. This file exists to stop agents acting on
wrong context. Files: `llms.txt`.

**F-03 — P2 — `docs/PROJECT_LEDGER.md` identifiers are stale and self-contradictory.**
§1 says contract v12 while §4 of the same file says v16 (actual v16); SDK "0.3.16" in §1/§4/§8
(actual 0.4.1); "Alphanet and Localnet enabled" in §1/§8 (actual: Betanet enabled, others
declared-disabled); stale baseline commit and test counts (77/904 vs current 80/1017); the §3
milestone table stops at v12, omiting v13 (faucet auth change), v14 (`token.readMint`), v15
(`tx.checkDuplicate`/`allowDuplicate`), v16 (legacy send retirement). The ledger is the
identifier authority; every wrong number here can propagate. Files: `docs/PROJECT_LEDGER.md`.

**F-04 — P2 — `SECURITY.md` permission audit omits a shipped permission.**
The manifest requests five permissions; SECURITY.md says "four" and its audit table omits
`notifications` (used by `history-service.js` for confirmed/failed transfer desktop
notifications). The public security policy must justify every requested permission. Files:
`SECURITY.md`.

**F-05 — P2 — fee provenance is mislabeled by a dead branch.**
`tx-service.estimateFee` computes `source: network.environment === 'devnet' ? 'measured' :
'assumed'`, but no declared network has `environment: 'devnet'` (values are
testnet/local/mainnet), so the 'measured' branch is dead and Betanet reports `assumed`. The
Betanet fee is recorded as MEASURED (managed-genesis chain 2026-09-26, the same program
deployment Betanet runs) in `networks.js`, and the route-lifecycle fixture already returns
`source: 'measured'`. Users therefore see "Network fee: … (assumed, not measured on this
network)" on Betanet — a false statement about a fee in a wallet. Also in the same function: a
stale first JSDoc block ("Blocked on… hardcoded 10_000… as a guess") contradicts the accurate
second block beneath it. Violates standing invariant #9 (network-specific values belong in the
network config). Files: `src/lib/networks.js`, `src/background/services/tx-service.js`,
`docs/BACKEND_GAPS.md` C2 wording.

**F-06 — P3 — stale references to the deleted legacy bridge in rule text.**
AGENTS.md hard rule 3 still names `src/ui/bridge.js` (legacy) as a permitted sendMessage owner;
that file is deleted and `check-layering.mjs`'s actual allowlist is `src/ui/app/bridge.js` +
`event-service.js` (its own comment repeats the stale path). STATUS_AND_ROADMAP Step 5 states
"are exact-pinned at 0.3.16" as present tense for a historical 2026-09-18 pass. Files:
`AGENTS.md`, `scripts/check-layering.mjs` (comment only), `docs/STATUS_AND_ROADMAP.md`.

**F-07 — P4 — dead duplicate `isValidThruAddress` in `networks.js`.**
`src/lib/networks.js:210` duplicates `src/lib/thru-client.js:116` byte-for-byte. Every importer
(services and tests) uses the thru-client version; the networks.js export has zero references.
Category: dead code (the authoritative implementation stays). Files: `src/lib/networks.js`.

**F-08 — P4 — strangler-migration compatibility surface in `boot.js` has zero callers.**
`boot()` still accepts `legacyFallback`/`onMigratedRoute`, carries "routes migrated to the new
stack"/"unmigrated hashes" comments, logs "leaving the legacy UI in place" and "Migrated
routes:". The migration is complete (one stack, no legacy tree, no caller passes either option),
so the deletion condition defined for this temporary layer is met. Simplify while preserving
unknown-path→fallback and chrome-visibility behavior. Files: `src/ui/app/boot.js`,
`CONTEXT.md` §2 sentence describing the fallback callback.

### 4. Duplicate code found (classification per rule 6)

| Candidate | Class | Action |
| --- | --- | --- |
| `isValidThruAddress` (networks.js vs thru-client.js) | E — dead code | Delete networks.js copy (F-07). |
| `parseThruAmount` vs `parseTokenAmount`, `formatThru` vs `formatTokenAmount` | B — intentionally different scale, same discipline, one module | None. |
| Program-id constants imported in both `networks.js` and `thru-client.js` | C — config definition vs adapter fallback default (documented in v7 quarantine rationale) | None. |
| `token-drawer.js` short-symbol truncation vs `truncateAddress` | B — different input/length semantics | None. |
| Address validation split (UI loose shape check in `refs.js`, authoritative checksum in background) | C — deliberate layering (`refs.js` documents why) | None. |

### 5. Legacy code found

Dead: `isValidThruAddress` (networks.js). Transitional-with-zero-callers: `boot.js`
legacyFallback/onMigratedRoute surface (F-08). No other dead files, routes, CSS, build entries,
or duplicate UI implementations were found: `src/ui/` contains exactly the one route stack;
`scripts/` probe/verify scripts are documented manual live-chain tools, not shipped code;
`docs/handoff/`, `docs/reference/`, `docs/archive/` are frozen per DOCS_INDEX.

### 6. Security risks

None new at P0/P1 severity in code. The security-relevant findings are the two policy-truth
defects (F-01/F-02: a user or agent believing password-per-sign is active when it is not) and
the fee-provenance mislabel (F-05, conservative direction but a false user-facing claim). All
previously identified risks (MR-01…MR-07) remain remediated in source with deterministic tests;
live-network and real-Chrome verification items remain open exactly as listed in
STATUS_AND_ROADMAP §1 and PROJECT_LEDGER §5. External audit: still required, not started.

### 7. Documentation contradictions

F-01, F-02, F-03, F-04, F-06 above, plus: `DOCS_INDEX.md`'s AUDIT_REPORT row will be refreshed
with this report. Historical documents (AUDIT_REPORT 2026-09-18 section, SEND_PATH_AUDIT,
DEFECT_LOG) correctly label their own baselines and are not contradictions. SECURITY.md's
betanet scope notice is a factual limitation, retained deliberately.

### 8. SDK/protocol boundary risks

Contained: all `@thru/*` imports live in `src/lib/`. Pinned exactly (0.4.1) with vector
provenance recorded. No SDK churn risk identified this pass; upgrade protocol (changelog review,
goldens, migration tests) is documented and unchanged. Remaining protocol unknowns stay in
BACKEND_GAPS §2 / STATUS Step 8 — nothing new observed.

### 9. Network risks

No state-leak path found: network identity is id-based; scoped/global key sets are test-asserted;
the signing guard blocks network mutation during signing; stale active ids self-heal; CSP and
enabled networks are two-way checked. The fee-provenance defect (F-05) is the only
network-config finding, and it is a labeling defect, not a binding/scoping one.

### 10. Test gaps

No regression test asserts fee `source` provenance (the lifecycle fixture hardcodes 'measured'
and nothing compares it to the service). No test covers `estimateFee`'s per-network source at
all — one will be added with F-05. All other gaps are the previously documented, still-open
browser/live-chain boundaries (MANUAL_SMOKE_CHECKLIST; live v12 activation, token transfer
owner/fee, block-time latency, charged-fee source, explorer route, MV3 suspension). This audit
did not and cannot close those.

### 11. Prioritized remediation plan (ordered work units)

1. **U1 (P1, docs/security truth):** fix README Security basics + rewrite llms.txt current-state
   to match shipped truth (v16, Betanet, D-003 signing default, hosted URL, P0 list).
2. **U2 (P2, identifiers + public policy):** refresh PROJECT_LEDGER identifiers/milestones and
   test evidence; add `notifications` to SECURITY.md's permission audit (five permissions).
3. **U3 (P2, code):** move fee provenance into the network config (`feeSource`), make
   `estimateFee` read it, remove the dead `devnet` branch and the stale duplicate JSDoc, align
   BACKEND_GAPS C2 wording, add a per-network source regression test.
4. **U4 (P3, rule text):** correct AGENTS.md rule 3 and the check-layering comment to the real
   allowlist; mark STATUS Step 5's 0.3.16 statement as historical; refresh DOCS_INDEX
   AUDIT_REPORT row and date.
5. **U5 (P4, legacy cleanup):** delete the dead `isValidThruAddress` from networks.js (after
   full reference sweep); remove boot.js's dead migration surface; update the CONTEXT.md
   sentence that describes it.

Each unit: `npm run build && npm test` before and after, one logical commit, no mixing.
Rules that are already satisfied are deliberately left untouched.

---

## Mainnet-readiness audit — 2026-10-03

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

> **Current Send-path audit (2026-09-24):** [SEND_PATH_AUDIT.md](SEND_PATH_AUDIT.md)
> covers the frontend, bridge, worker, contract, services, SDK, fixes, tests, and residual
> risks on this branch. The earlier report below is a historical snapshot; its branch,
> counts, and signing-preference default do not describe the current build.

Date: 2026-09-18  
Repository: `buildbyravi/thru-wallet-ext`  
Branch: `arena/01a06be7-thru-wallet-ext`  
Scope: source-level security, wallet-risk, API contract, launchpad readiness, and build/test posture. No live-chain transaction testing was performed for this report.

## Remediation update — 2026-09-18

The follow-up audit pass applied the mechanical fixes from the current review:

- UI/shared address URL handling is now a loose shape filter; authoritative checksum validation remains in the background. The two UI imports of the SDK-bearing network config are gone, and `check-layering.mjs` forbids that dependency from returning.
- `@thru/sdk` and `@thru/programs` are exact-pinned at `0.3.16`; derivation uses `@thru/sdk/crypto`, the deprecated standalone crypto package is removed, and the golden addresses remain unchanged.
- CI uses `npm ci`. `scripts/check-csp.mjs` enforces a two-way match between enabled networks and `connect-src`, keeping disabled/testnet/mainnet origins unreachable until deliberate enablement.
- `AGENTS.md` and `CONTEXT.md` have valid headings and no raw control bytes; the one-off document normalizer and nonexistent legacy zip references are gone.
- Background account-registration side effects no longer make the regular Node API suite call a live RPC. Live registration remains exercised only by the explicit `scripts/verify-live-e2e.mjs` path.
- The worker explicitly requests `TRUSTED_CONTEXTS` for `chrome.storage.session` at startup.

`W-6` remains a product tradeoff: `clipboardRead` is used by the shipped Paste button and was not removed. Public vulnerability reporting still requires repository settings/contact ownership work outside the source tree.

---

## Executive summary

The core popup rebuild has strong structural guardrails: one UI/background seam, zero DOM injection sinks in `src/ui/**`, route/CSS reachability checks, pinned Thru SDK derivation tests, and JSON-serialization tests across the API port. `npm run build && npm test` is green after dependency installation.

Remediation update 2026-09-18: F-01 has been addressed after the audit. Transaction-signing methods now use `auth: 'signing'`, which requires password re-authentication by default and verifies it in the background router before any signing handler runs. A password-gated Settings opt-out exists for users who explicitly choose session-only signing. Contract v6 also hardens reset and auto-lock changes in the background.

Remediation update (contract v7 custom-network quarantine): removing the Add form was not sufficient because a legacy saved row and direct `network.setActive` request could still bind an endpoint with unverified program ids. The background now accepts enabled built-ins only, self-heals stale custom/disabled selections before RPC binding, and exposes legacy records only for inert listing/removal. API-router and lifecycle tests cover the bypass and startup path.

Remediation update (launchpad quarantine): F-04 is closed by deletion. `src/launchpad/**` is removed, no launchpad page is bundled or copied into `dist/`, the `?launchpad=1` override and both launchpad feature flags are gone, the dashboard banner that opened the page is gone, and the DOM-sink ratchet in `scripts/check-layering.mjs` now covers all of `src/` rather than only `src/ui/**` and `src/features/**`. `test-launchpad-quarantine.mjs` (45 checks, in `npm test`) rebuilds `dist/` and asserts by filename and by content that no launchpad, DEX-quote or prediction code ships. Research documents are retained; backend `token.*` contract methods are unchanged.

### Risk snapshot

| Severity | Count | Theme |
| --- | ---: | --- |
| Critical | 0 | F-01 signing re-authentication is remediated in this branch. |
| High | 3 | Remediated: reset/auto-lock password gates are background-enforced in contract v6 (F-02, F-03), and the launchpad injection surface is deleted rather than reachable (F-04). |
| Medium | 2 | Moot in shipped code: the launchpad deploy path that owned both findings is deleted (F-05, F-06). The backend `ticker`/`symbol` normalization note still applies to any future deploy UI. |
| Low | 1 | Residual logging/noise. |

---

## Validation performed

### Commands run

```bash
npm install
npm run build && npm test
npm audit --json
```

### Results

- `npm install`: PASS. Warning: `@thru/crypto@0.2.21` is deprecated upstream.
- `npm run build`: PASS, no build warnings observed.
- `npm test`: PASS.
  - Derivation: 16/16
  - Layering: 60 files, 0 violations, 0 DOM sinks in guarded UI paths
  - Routes: 14/14 registered/reachable; 128 used CSS classes all defined
  - Contract: 54/54 (current contract version is v6; see `src/shared/contract/manifest.js`)
  - DOM/refs: 89/89
  - Vault, thru-client, api-router integration suites passed
- Historical `npm audit --json`: INCONCLUSIVE. The npm registry audit endpoint returned `503 Service Unavailable` during the original audit.
- Remediation recheck 2026-09-18: `npm audit --omit=dev` PASS, `found 0 vulnerabilities`.

---

## Positive findings

1. **Core popup DOM safety is materially improved.** `src/ui/**` uses `h()`/text nodes and the layering check enforces zero `innerHTML`, `insertAdjacentHTML`, `outerHTML`, and `document.write` sinks in the guarded new UI stack.
2. **The API seam is explicit and tested.** UI calls go through `bridge.send()`, methods are declared in `src/shared/contract/manifest.js`, and `test-contract.mjs` checks router/manifest/caller consistency.
3. **Key derivation is pinned.** Dependency ranges and deterministic vectors make accidental derivation changes visible.
4. **Secret export is password-gated at the backend.** `wallet.exportSecret`, `wallet.exportPrivateKey`, keyring add/remove/rename, and account imported-key add are declared `auth: 'password'`.
5. **BigInt serialization is tested.** API responses are normalized before crossing Chrome messaging.
6. **Network scoping has explicit tests.** Pending transactions and balances are separated per network while keys/labels remain global.

---

## Findings

### F-01 — Remediated — Signing endpoints require password re-authentication by default

**Status after fix**

`src/shared/contract/manifest.js` now declares transaction-signing endpoints as `auth: 'signing'` and includes an optional `password` parameter:

- `tx.claimFaucet`
- `tx.send`
- `tx.autoCreateAccount`
- `token.deploy`

`src/background/api-router.js` handles `auth: 'signing'` centrally. The router requires an unlocked wallet and, unless the user explicitly disabled `requirePasswordForSigning`, requires and verifies the master password before dispatching to the signing handler.

The default preference is `requirePasswordForSigning: true`. The only way to change it is through `settings.setSecurity`, which is itself `auth: 'password'`. The generic unlocked-only `settings.set` rejects security-sensitive keys, including `requirePasswordForSigning`, `enforceWhitelist`, and `whitelist`.

The Send and Faucet popup routes now call `requirePassword()` and pass the password directly into the single signing API call. The legacy disabled launchpad page was also updated so its built but hidden faucet/deploy actions do not call signing endpoints without a password.

**Residual risk**

Users can opt into session-only signing from Settings after password re-authentication. That is an intentional product setting requested in this pass and should remain clearly labelled as less secure.

---

### F-02 — High — `wallet.reset` can bypass the unlocked-state password prompt

**Status: remediated in contract v6.**

`wallet.reset` now takes `{ confirmation, password }` and the background service enforces the
policy instead of trusting UI state:

- `confirmation === "RESET"` is always required;
- when the wallet is unlocked, the master password is required and verified before deletion;
- when the wallet is locked, typed confirmation remains sufficient for the intentional
  forgotten-password erase-this-device path;
- direct API calls, missing confirmation, missing password, wrong password, locked state, and
  worker/session restart behavior are covered in `test-api-router.mjs`.

---

### F-03 — High — Security settings are mutable with only an unlocked session

**Status: remediated for auto-lock in contract v6; signing/whitelist were remediated in v5.**

`system.setAutoLock` is now `auth: 'password'`, declares `password`, and records `authSince: 6`.
The Settings UI prompts for the password before any auto-lock change, with a danger confirmation
for `Never`. The API-router test covers missing password, wrong password, the `Never` setting,
and locked-state refusal.

`settings.setSecurity` remains the password-gated path for `requirePasswordForSigning`,
`enforceWhitelist`, and `whitelist`, while generic `settings.set` rejects those keys.

---

### F-04 — High — Disabled launchpad remains built and contains unguarded `innerHTML` with token-controlled data

**Status: remediated by deletion (launchpad quarantine).**

The recommendation was "remove launchpad from the build while disabled, or migrate it". Removal was
chosen: a flagged-off page that still ships is not a security boundary, and migrating 2,052 lines of
legacy markup-string rendering onto the guarded kit would have meant rebuilding a feature that has no
verified chain semantics behind it (see F-05, F-06).

Deleted:

- `src/launchpad/launchpad.js` (552), `launchpad.html` (443), `launchpad.css` (1,057) — including
  every sink listed in the original evidence (`insertAdjacentHTML` icons, `lp-account-mark.innerHTML`,
  `container.innerHTML`, `card.innerHTML` with `token.ticker`/`name`/`mintAddress`/`initialSupply`,
  `dexTradeBtn.innerHTML`), the `parseFloat()` + hard-coded `23.5294` swap quote, the `setTimeout`
  "Execute Swap On-Chain" button, and the simulated prediction orders.
- `src/popup/icons.js` and `src/popup/toast.js`, whose only importer was `launchpad.js`. `icons.js`
  was the last markup-string factory in the tree.
- The launchpad entry points and copy step in `build.mjs`, which now wipes `dist/` first so an
  existing checkout cannot keep a stale `dist/launchpad.html`.
- `FEATURE_LAUNCHPAD`, `FEATURE_TOKEN_DEPLOY` and the `popup.html?launchpad=1` override in
  `src/shared/flags.js`.
- The dashboard `.launchpad-banner` control (the only `chrome.tabs.create` in the tree) and its CSS,
  plus `#toast-container` and the `.toast*` rules.

Enforcement added:

- `scripts/check-layering.mjs` DOM-sink scan widened from `src/ui/**` + `src/features/**` to all of
  `src/` (`src/popup/vendor/` excluded). 0 sinks, and no directory is outside the ratchet any more.
- `test-launchpad-quarantine.mjs` in `npm test`: the tree stays deleted, no shipped source or the
  manifest references the surface, the flags cannot be re-enabled by query parameter, no route or
  control points at it, `dist/` ships exactly one page and two bundles, and no `dist/` text file
  contains a launchpad reference, the fabricated rate, the simulated-trade copy, or an injection sink.
  Verified to fail (13, 8 and 6 checks respectively) when the tree, the override, or the dashboard
  control is restored.

Retained: `docs/LAUNCHPAD_UX_STUDY.md`, `docs/LAUNCHPAD_DEX_MIGRATION_UX.md`,
`docs/THRU_NATIVE_DEFI_TAB_UX.md` and `docs/MODULE_BOUNDARIES.md` as research/direction only.

**Residual risk**

None in shipped code. A future launchpad is a new `src/features/launchpad/**` module with guarded DOM,
real quotes from a verified AMM/indexer, and its own tests; that PR must update
`test-launchpad-quarantine.mjs` deliberately rather than weaken it. Token mint addresses returned by
`token.list` are still rendered by `src/ui/domain/token-row.js`, which builds nodes and validates URLs
through `h()`, so the "validate before rendering" half of the recommendation is already covered there.

---

### F-05 — Medium — Launchpad and token deployment API disagree on `ticker` vs `symbol`

**Status: shipped surface deleted; backend note stands.**

The only caller that could hit the `ticker`/`symbol` disagreement was `src/launchpad/launchpad.js`,
which is deleted. Nothing in the shipped runtime calls `token.deploy` now, so no user can reach the
mismatch.

The backend boundary is unchanged on purpose — the contract is append-only and `token.deploy` stays
declared for a future `launchpad.*` module. `token-service.js` still forwards `params.symbol` to both
`symbol` and `ticker`. Before any deploy UI ships again: normalize at the background boundary
(`sanitizeSymbol(params.symbol ?? params.ticker)`), reject a missing symbol before chain submission,
and add the API-router test for it.

---

### F-06 — Medium — Launchpad mint seed generation is incompatible with the current token contract

**Status: shipped surface deleted.**

`previewSeed` — `Math.random().toString(36)` concatenated twice, neither 64 hex characters nor
available from an audited helper — existed only in `src/launchpad/launchpad.js`, which is deleted. No
shipped code generates a mint seed now.

`token.generateSeed` remains in the contract. Any future deploy UI must call it (or an equivalent
audited helper) and must be covered by a test asserting a valid 64-hex seed reaches `token.deploy`,
which is the test this finding asked for and which could not be written against the deleted form.

---

### F-07 — Remediated for production deps — Dependency vulnerability audit rechecked

**Evidence**

The original `npm audit --json` returned `503 Service Unavailable` from `https://registry.npmjs.org/-/npm/v1/security/audits/quick`.

**Recheck**

`npm audit --omit=dev` completed on 2026-09-18 and reported `found 0 vulnerabilities`.

**Residual note**

Because this is a wallet extension, continue reviewing advisories manually for `@thru/*`, `esbuild`, and any transitive crypto/serialization packages when dependencies change.

---

### F-08 — Low — Contract documentation drift around token seed length

**Evidence**

- Remediation update: `token.generateSeed` in the contract now says it returns a “64-character lowercase hex mint seed (32 bytes)”.
- Nearby `token.deriveAddress` documentation already requires a 64-character hex seed.
- Tests and comments elsewhere indicate 64 hex characters is the correct shape.

**Impact**

A future UI or script may follow stale contract prose and generate an invalid seed.

**Recommendation**

Update the `token.generateSeed` contract text to “64-character lowercase hex seed (32 bytes)” and add an assertion in `test-contract.mjs` or token tests.

---

### F-09 — Low — Console logging should remain on a wallet privacy budget

**Evidence**

Production source logs include account addresses and route/error messages, for example:

- `src/background/services/account-service.js` logs deferred account registration with address.
- `src/background/services/wallet-service.js` logs registration failures.
- `src/ui/app/boot.js`, `src/ui/app/router.js`, and `src/ui/app/bridge.js` log boot/route/event errors.

**Impact**

Addresses are not secret, but wallet console output can become a privacy and support-data leak, especially if logs are copied into bug reports.

**Recommendation**

Keep logs minimal, avoid addresses where possible, and consider a build-time debug flag for verbose diagnostics.

---

## Highest-priority remediation plan

1. ~~**Exclude or migrate launchpad before enabling it.**~~ Done by deletion, and the DOM-sink ratchet now covers all of `src/` rather than needing a launchpad entry.
2. ~~**Add a jsdom route mount test** as already planned in `docs/STATUS_AND_ROADMAP.md` Step 2.~~ Done as `test-route-lifecycle.mjs` (694 checks, no jsdom): all 14 routes mount through the real Router/guards/bridge in no-vault, locked and unlocked states; no secret appears in text, attributes, dataset values, input values or URLs; teardown leaves no listener on a detached node. It found and fixed one live leak (`reset.js` discarded its `PageHeader` instance). The "assert launchpad is not shipped" half remains `test-launchpad-quarantine.mjs`.
3. ~~**Resolve the custom-network security/capability decision** before promoting arbitrary RPC endpoints.~~ Resolved by contract v7 quarantine: the Add form remains absent, saved records remain listable/removable but are inert, direct background activation returns `CUSTOM_NETWORK_DISABLED`, and stale active ids heal to the default before RPC binding. The storage methods stay declared for compatibility. Re-enablement preconditions are in `docs/STATUS_AND_ROADMAP.md` Step 2b.
4. **Keep dependency audit in release checks**; production dependency audit currently reports zero vulnerabilities.

---

## Suggested tests to add

- Contract test: every method that can sign or broadcast a transaction must use `auth: 'signing'` and carry a password parameter.
- Contract test: every destructive method (`wallet.reset`, key/account removal) must have a backend-enforced password/confirmation policy.
- Contract test: security preferences cannot be changed through generic unlocked-only `settings.set`.
- API-router test: direct `wallet.reset` while unlocked without password is rejected.
- API-router test: direct `tx.send` without password is rejected while `requirePasswordForSigning` is enabled.
- ~~DOM-sink scan extended to `src/launchpad/**`.~~ Done differently: the scan now covers all of `src/`, and the directory is deleted.
- ~~Launchpad smoke test: deployment form produces `symbol`, not only `ticker`, and a 64-hex seed.~~ Moot — the form is deleted. Write it against `token.deploy` at the API-router boundary when a deploy UI returns.
- Added instead: `test-launchpad-quarantine.mjs` — tree deleted, no source/manifest/route/flag reference, zero sinks in all of `src/`, and a real `dist/` build scanned by filename and content.
- Added: `test-route-lifecycle.mjs` — route mount/no-throw, guard landing paths, secret hygiene across text/attributes/dataset/input values/URLs, listener teardown on detached nodes, modal focus trapping, and the Settings guarantees (no `network.upsertCustom` caller, no `setPanelBehavior`, an explicit `sidePanel.open`). Each security assertion ships with a negative control that breaks it on purpose.
- Browser-only residue: layout at narrow/wide widths, real focus rings, canvas QR output, side-panel behaviour. `docs/MANUAL_SMOKE_CHECKLIST.md`.

---

## Overall conclusion

The repository is in a much better structural state than the legacy defect history suggests. F-01 signing re-authentication is enforced in the background by default, contract v6 moves reset and auto-lock policy into backend checks, and contract v7 makes the custom-network quarantine a background invariant rather than a UI convention. The disabled launchpad DOM surface is deleted, unbuilt, and guarded by `test-launchpad-quarantine.mjs` plus a whole-`src/` DOM-sink ratchet. Every route now mounts under lifecycle tests; remaining UI residue is browser-only verification, while custom-network re-enablement remains blocked on capability/CSP/permission design.
