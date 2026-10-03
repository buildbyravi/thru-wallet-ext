# Audit report — Thru Wallet Extension


## Mainnet-readiness audit — 2026-10-03

**Scope:** branch `arena/01a10231-thru-wallet-ext` at `05fda07`, compared with `main` at
`cee006e`. Reviewed architecture and layering, API authorization, native/token signing, network
isolation, pending transaction persistence, vault/preferences storage, dependency vectors,
documentation truthfulness, and the deterministic build/test gates. This was a source-level audit;
no live-chain transaction, real-Chrome lifecycle/layout test, or external security audit was
performed.

**Result:** **SECURITY REVIEW REQUIRED** before Mainnet. No critical defect was confirmed in this
pass. Two high, three medium, and two low findings remain. The existing deterministic controls are
substantial: exact dependency pins, stable derivation vectors, centralized API auth, an encrypted
versioned vault, trusted-context session storage, strict CSP, zero runtime DOM injection sinks,
network-scoped chain state, checked UI send calls, and broad contract/lifecycle regression coverage.
Those controls do not close the findings below.

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

Do not represent this build as Mainnet-ready until MR-01 and MR-02 are closed, MR-03 has durable
concurrency tests, MR-04 has an approved migration plan, and MR-05 has an explicit security-policy
decision. Real-Chrome checks and the open live-chain checks in `docs/STATUS_AND_ROADMAP.md` remain
mandatory. An external audit remains **EXTERNAL AUDIT REQUIRED**; this source review is not a
substitute.

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
