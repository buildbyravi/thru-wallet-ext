# Audit report — Thru Wallet Extension

Date: 2026-09-18  
Repository: `buildbyravi/thru-wallet-ext`  
Branch: `arena/01a06be7-thru-wallet-ext`  
Scope: source-level security, wallet-risk, API contract, launchpad readiness, and build/test posture. No live-chain transaction testing was performed for this report.

---

## Executive summary

The core popup rebuild has strong structural guardrails: one UI/background seam, zero DOM injection sinks in `src/ui/**`, route/CSS reachability checks, pinned Thru SDK derivation tests, and JSON-serialization tests across the API port. `npm run build && npm test` is green after dependency installation.

Remediation update 2026-09-18: F-01 has been addressed after the audit. Transaction-signing methods now use `auth: 'signing'`, which requires password re-authentication by default and verifies it in the background router before any signing handler runs. A password-gated Settings opt-out exists for users who explicitly choose session-only signing. Destructive reset and some broader security-setting operations still need follow-up hardening.

The disabled launchpad is also still built into `dist/launchpad.html` and contains legacy `innerHTML` rendering paths with token/user-controlled values; it is outside the current zero-sink ratchet.

### Risk snapshot

| Severity | Count | Theme |
| --- | ---: | --- |
| Critical | 0 | F-01 signing re-authentication is remediated in this branch. |
| High | 3 | Reset/destructive operations and some security settings can bypass intended password gates; launchpad injection surface remains reachable. |
| Medium | 2 | Launchpad deployment remains disabled/untested and still uses invalid mint seed generation; token deploy field drift is partially patched. |
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
  - Contract: 42/42
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

**Evidence**

- `wallet.reset` has no parameters and `auth: 'none'` in `src/shared/contract/manifest.js` lines 103-107.
- The Reset route performs a UI-level password prompt only when it believes the wallet is unlocked, then calls `bridge.send('wallet.reset')` at `src/ui/app/routes/reset.js` lines 52-93.
- The route comment explicitly acknowledges the API-level gap: lines 89-92 verify the password before destruction because `wallet.reset` itself takes no password.

**Why this matters**

The password gate exists only in UI code. A direct API call can erase the local vault whether locked or unlocked. Locked reset without a password is a product requirement for forgotten-password recovery, but the background API should still enforce an explicit confirmation token and should require a password when a live unlocked session exists.

**Impact**

- Local key material can be wiped by any caller that reaches `wallet.reset`.
- On an unlocked shared machine, the intended password re-authentication can be bypassed.

**Recommendation**

Move reset policy into the background handler. Suggested shape: `wallet.reset({ confirmation, password })`, where `confirmation === 'RESET'` is always required; if `vault.isUnlocked()` is true, verify `password` before deletion. Add tests for locked reset, unlocked reset with correct password, and unlocked reset without/wrong password.

---

### F-03 — High — Security settings are mutable with only an unlocked session

**Evidence**

- `system.setAutoLock` is `auth: 'unlocked'` in `src/shared/contract/manifest.js` lines 34-38.
- `system.setAutoLock` is still `auth: 'unlocked'` in `src/shared/contract/manifest.js`.
- `settings.set` is still `auth: 'unlocked'`, but after the F-01 remediation it rejects security-sensitive preference keys.
- `settings.setSecurity` is now `auth: 'password'` and is the path for `requirePasswordForSigning`, `enforceWhitelist`, and `whitelist`.
- Auto-lock still needs the same treatment in a follow-up pass.

**Why this matters**

Project policy requires password re-authentication before security-setting changes. The signing and whitelist preference path is now password-gated, but an unlocked session can still change auto-lock (`minutes: 0`) without the master password.

**Impact**

- A compromised or unattended unlocked session can still weaken auto-lock behaviour.
- Whitelist enforcement and signing re-authentication can no longer be changed through unlocked-only `settings.set`.

**Recommendation**

Finish the split by moving auto-lock changes behind a password-gated method. `settings.setSecurity` now covers signing re-authentication and whitelist preferences.

---

### F-04 — High — Disabled launchpad remains built and contains unguarded `innerHTML` with token-controlled data

**Evidence**

- `build.mjs` copies and bundles launchpad assets into `dist/launchpad.html` even while `FEATURE_LAUNCHPAD` is false.
- `src/launchpad/launchpad.js` uses legacy sinks outside the current `src/ui/**` ratchet:
  - `insertAdjacentHTML` for icons at line 46.
  - `lp-account-mark.innerHTML` at line 119.
  - `container.innerHTML` at lines 230 and 240.
  - `card.innerHTML` with token fields at lines 252-277.
  - `dexTradeBtn.innerHTML` at line 451.
- Token fields interpolated into markup include `token.ticker`, `token.name`, `token.mintAddress`, `token.initialSupply`, and URLs.

**Why this matters**

The launchpad is feature-flagged off in navigation, but it is still an extension page that gets built. If a user opens it directly, or if a future UI path enables it before migration, token metadata and locally imported token records can reach string-built HTML. This bypasses the core popup's strongest XSS guardrail.

**Impact**

- Markup injection/UI-redress risk in an extension page.
- Potential abuse of delegated `data-action` handlers by injected elements.
- Launchpad can regress security without tripping `scripts/check-layering.mjs`, because that check does not cover `src/launchpad/**`.

**Recommendation**

Either remove launchpad from the build while disabled, or migrate it to `src/ui/kit/dom.js` before shipping. Expand the DOM-sink ratchet to cover `src/launchpad/**` or relocate launchpad under the guarded UI stack. Validate token mint addresses before storing/rendering them.

---

### F-05 — Medium — Launchpad and token deployment API disagree on `ticker` vs `symbol`

**Evidence**

- The contract declares `token.deploy` parameters as `['mintSeed', 'name', 'symbol', 'decimals', 'description', 'imageUrl']`.
- `src/background/services/token-service.js` forwards `params.symbol` to both `symbol` and `ticker` at lines 32-36.
- Remediation update: `src/launchpad/launchpad.js` now submits both `symbol` and legacy `ticker` when it calls `token.deploy`, but the disabled launchpad still needs a full migration/test pass before it is treated as supported.

**Why this matters**

Launchpad deployment can submit undefined token symbols/tickers through the background service. This is consistent with the file comment noting previous stored records had empty ticker/image fields, but the current code still does not read `params.ticker`.

**Impact**

- Token deployment from launchpad is likely broken or stores incomplete metadata.
- Deployed token list rendering may crash or show blank names if fields are missing.

**Recommendation**

Normalize at the background boundary: `const symbol = sanitizeSymbol(params.symbol ?? params.ticker)`. Update the contract/callers to one canonical parameter. Add an API-router test for `token.deploy` parameter normalization or reject missing symbols before chain submission.

---

### F-06 — Medium — Launchpad mint seed generation is incompatible with the current token contract

**Evidence**

- `src/launchpad/launchpad.js` initializes `previewSeed` with base36 random substrings at line 17.
- The contract says token mint seeds must be 64 hex characters at `src/shared/contract/manifest.js` lines 385-389.
- `token.generateSeed` exists as a background method but launchpad does not use it.

**Why this matters**

A non-hex, non-64-character seed will fail derivation/deployment paths that require a 32-byte hex seed.

**Impact**

- Launchpad deploy is likely non-functional even before the `ticker`/`symbol` mismatch is fixed.

**Recommendation**

Use `bridge.send('token.generateSeed')` or an equivalent audited helper for all launchpad seed generation. Add tests that the launchpad submit path supplies a valid 64-hex seed.

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

1. **Move reset policy into the background**, with explicit confirmation always and password required when unlocked.
2. **Password-gate remaining security-setting mutations**, especially auto-lock. Signing re-authentication and whitelist preferences now use `settings.setSecurity`.
3. **Exclude or migrate launchpad before enabling it.** If it remains built, include `src/launchpad/**` in the DOM sink ratchet.
4. **Add a jsdom route mount test** as already planned in `docs/STATUS_AND_ROADMAP.md`, and include launchpad or assert it is not shipped.
5. **Keep dependency audit in release checks**; production dependency audit currently reports zero vulnerabilities.

---

## Suggested tests to add

- Contract test: every method that can sign or broadcast a transaction must use `auth: 'signing'` and carry a password parameter.
- Contract test: every destructive method (`wallet.reset`, key/account removal) must have a backend-enforced password/confirmation policy.
- Contract test: security preferences cannot be changed through generic unlocked-only `settings.set`.
- API-router test: direct `wallet.reset` while unlocked without password is rejected.
- API-router test: direct `tx.send` without password is rejected while `requirePasswordForSigning` is enabled.
- DOM-sink scan extended to `src/launchpad/**`.
- Launchpad smoke test: deployment form produces `symbol`, not only `ticker`, and a 64-hex seed.

---

## Overall conclusion

The repository is in a much better structural state than the legacy defect history suggests. F-01 signing re-authentication is now enforced in the background by default, with a password-gated user opt-out for session-only signing. Remaining risk is concentrated in reset policy, auto-lock/security-setting hardening, disabled launchpad DOM sinks, and missing route-mount coverage.
