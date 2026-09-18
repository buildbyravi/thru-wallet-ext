# Audit report — Thru Wallet Extension

Date: 2026-09-18  
Repository: `buildbyravi/thru-wallet-ext`  
Branch: `arena/01a06be7-thru-wallet-ext`  
Scope: source-level security, wallet-risk, API contract, launchpad readiness, and build/test posture. No live-chain transaction testing was performed for this report.

---

## Executive summary

The core popup rebuild has strong structural guardrails: one UI/background seam, zero DOM injection sinks in `src/ui/**`, route/CSS reachability checks, pinned Thru SDK derivation tests, and JSON-serialization tests across the API port. `npm run build && npm test` is green after dependency installation.

Remediation update 2026-09-18: F-01 has been addressed after the audit. Transaction-signing methods now use `auth: 'signing'`, which requires password re-authentication by default and verifies it in the background router before any signing handler runs. A password-gated Settings opt-out exists for users who explicitly choose session-only signing. Contract v6 also hardens reset and auto-lock changes in the background.

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
2. **Add a jsdom route mount test** as already planned in `docs/STATUS_AND_ROADMAP.md` Step 2. The "assert launchpad is not shipped" half is already covered by `test-launchpad-quarantine.mjs`.
3. **Resolve the custom-network security/capability decision** before promoting arbitrary RPC endpoints.
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

---

## Overall conclusion

The repository is in a much better structural state than the legacy defect history suggests. F-01 signing re-authentication is now enforced in the background by default, with a password-gated user opt-out for session-only signing. Contract v6 also moves reset and auto-lock policy into backend-enforced checks. The disabled launchpad DOM surface is no longer a risk: it is deleted, unbuilt, and guarded by `test-launchpad-quarantine.mjs` plus a DOM-sink ratchet that now covers all of `src/`. Remaining risk is concentrated in missing route-mount/browser coverage and custom-network capability/CSP policy.
