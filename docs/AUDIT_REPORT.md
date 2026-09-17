# Audit report — Thru Wallet Extension

Date: 2026-09-18  
Repository: `buildbyravi/thru-wallet-ext`  
Branch: `arena/01a06be7-thru-wallet-ext`  
Scope: source-level security, wallet-risk, API contract, launchpad readiness, and build/test posture. No live-chain transaction testing was performed for this report.

---

## Executive summary

The core popup rebuild has strong structural guardrails: one UI/background seam, zero DOM injection sinks in `src/ui/**`, route/CSS reachability checks, pinned Thru SDK derivation tests, and JSON-serialization tests across the API port. `npm run build && npm test` is green after dependency installation.

However, the audit found several wallet-critical authorization gaps in the background contract. The most important issue is that transaction-signing methods are only `auth: 'unlocked'`, even though project policy requires password re-authentication before signing. An unlocked extension session is therefore enough to submit transfers, faucet claims, account-registration transactions, and token deployments. Destructive and security-setting operations have similar UI-only password gates or no password gate at the API layer.

The disabled launchpad is also still built into `dist/launchpad.html` and contains legacy `innerHTML` rendering paths with token/user-controlled values; it is outside the current zero-sink ratchet.

### Risk snapshot

| Severity | Count | Theme |
| --- | ---: | --- |
| Critical | 1 | Signing can be performed from an unlocked session without password re-authentication. |
| High | 3 | Reset/destructive operations and security settings can bypass intended password gates; launchpad injection surface remains reachable. |
| Medium | 3 | Launchpad/token deployment contract drift; launchpad uses invalid mint seed generation; dependency audit unavailable. |
| Low | 2 | Documentation/contract drift and residual logging/noise. |

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
  - Contract: 34/34
  - DOM/refs: 89/89
  - Vault, thru-client, api-router integration suites passed
- `npm audit --json`: INCONCLUSIVE. The npm registry audit endpoint returned `503 Service Unavailable`, so dependency CVE posture could not be verified in this run.

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

### F-01 — Critical — Signing endpoints do not require password re-authentication

**Evidence**

`src/shared/contract/manifest.js` declares transaction-signing endpoints as unlocked-only:

- `tx.claimFaucet`: `auth: 'unlocked'` at lines 287-291.
- `tx.send`: `auth: 'unlocked'` at lines 293-297.
- `tx.autoCreateAccount`: `auth: 'unlocked'` at lines 311-315.
- `token.deploy`: `auth: 'unlocked'` at lines 373-377.

The Send route calls the signing endpoint directly after a click:

- `src/ui/app/routes/send.js` lines 543-550: `bridge.send('tx.send', { toAddress, amountUnits })`.

The Faucet route also calls its signing endpoint directly:

- `src/ui/app/routes/faucet.js` lines 127-129: `bridge.send('tx.claimFaucet', ...)`.

**Why this matters**

Project policy in `AGENTS.md` requires password re-authentication before signing. In the current contract, any extension page/script with access to the bridge while the wallet is unlocked can sign and broadcast native transfers or other transactions without knowing the master password.

**Impact**

- Funds can be moved while an unlocked session is unattended or if an extension page is compromised.
- UI confirmation does not provide a backend security boundary; it can be bypassed by calling the background method directly.

**Recommendation**

Add append-only password-gated signing methods, for example `tx.sendV2`, `tx.claimFaucetV2`, `tx.autoCreateAccountV2`, and `token.deployV2`, each taking `password` and verifying it in the background before signing. Migrate UI callers, then retire old methods once unused. Add contract tests asserting every method that signs is `auth: 'password'`.

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
- `settings.set` is `auth: 'unlocked'` in `src/shared/contract/manifest.js` lines 432-436.
- Preferences include security-sensitive fields such as `enforceWhitelist` and `whitelist` in `src/background/services/preferences-service.js`.
- `setPreferences()` accepts any known preference key and writes it after unlocked-only auth.

**Why this matters**

Project policy requires password re-authentication before security-setting changes. With the current contract, an unlocked session can disable auto-lock (`minutes: 0`), disable/enforce/modify recipient whitelist settings, or write other safety preferences without the master password.

**Impact**

- A compromised or unattended unlocked session can weaken future wallet safety controls.
- Whitelist enforcement in `tx.send` can be changed before a transfer.

**Recommendation**

Split preferences into benign display settings and security settings. Make auto-lock and whitelist mutations password-gated, either via dedicated methods or a `settings.setSecurity` method. Add contract tests that enumerate security-sensitive fields and require `auth: 'password'`.

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
- `src/launchpad/launchpad.js` submits `ticker` rather than `symbol` at lines 490-498.

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

### F-07 — Medium — Dependency vulnerability audit could not complete

**Evidence**

`npm audit --json` returned `503 Service Unavailable` from `https://registry.npmjs.org/-/npm/v1/security/audits/quick`.

**Impact**

Known-vulnerability status of direct/transitive npm dependencies is unknown for this report.

**Recommendation**

Re-run `npm audit --production` and `npm audit` once the registry endpoint is available. Because this is a wallet extension, also review advisories manually for `@thru/*`, `esbuild`, and any transitive crypto/serialization packages.

---

### F-08 — Low — Contract documentation drift around token seed length

**Evidence**

- `token.generateSeed` in the contract says it returns a “32-character alphanumeric mint seed”.
- Nearby `token.deriveAddress` documentation requires a 64-character hex seed.
- Tests and comments elsewhere indicate 64 hex characters is now the correct shape.

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

1. **Add password-gated signing methods** and migrate `send`, `faucet`, `autoCreateAccount`, and `token.deploy` callers.
2. **Move reset policy into the background**, with explicit confirmation always and password required when unlocked.
3. **Password-gate security-setting mutations**, especially auto-lock and whitelist preferences.
4. **Exclude or migrate launchpad before enabling it.** If it remains built, include `src/launchpad/**` in the DOM sink ratchet.
5. **Add a jsdom route mount test** as already planned in `docs/STATUS_AND_ROADMAP.md`, and include launchpad or assert it is not shipped.
6. **Re-run dependency audit** when npm audit service is available.

---

## Suggested tests to add

- Contract test: every method that can sign or broadcast a transaction must be `auth: 'password'`.
- Contract test: every destructive method (`wallet.reset`, key/account removal) must have a backend-enforced password/confirmation policy.
- Contract test: security preferences cannot be changed through generic unlocked-only `settings.set`.
- API-router test: direct `wallet.reset` while unlocked without password is rejected.
- API-router test: direct `tx.send` without password is rejected once v2 methods exist.
- DOM-sink scan extended to `src/launchpad/**`.
- Launchpad smoke test: deployment form produces `symbol`, not only `ticker`, and a 64-hex seed.

---

## Overall conclusion

The repository is in a much better structural state than the legacy defect history suggests, and the main test suite is green. The remaining risk is not broad code quality; it is concentrated in a few high-value wallet boundaries where UI-level confirmation is being treated as if it were backend authorization. Moving password re-authentication and destructive-operation policy into the background API contract should be the next security-hardening milestone before adding new wallet features.
