# Project ledger — past, present, and future build tracking

Date: 2026-09-18  
Purpose: canonical ledger for build phases, state identifiers, accepted constraints, active gaps, and future work. This replaces duplicated chat/local-agent phase tables with a clean source of truth.

---

## 1. Current identifiers

| Item | Value |
| --- | --- |
| Repository | `buildbyravi/thru-wallet-ext` |
| Arena branch | `arena/01a0b665-thru-wallet-ext` |
| Base main commit for this Arena branch | `745f8abd851b07a9de6b4a639e4f6037258a3496` |
| Current contract version | `8` |
| Contract source | `src/shared/contract/manifest.js` |
| Current route count | 14 popup routes |
| Contract method count | 75 methods |
| Runtime surfaces today | popup route stack only — one extension page, `popup.html` |
| Dist directory | generated; do not edit |
| Chrome Web Store | Published: 1.1.0 (legacy build, predates this ledger's audit work); a pre-audit 1.2.0 submission was canceled from review 2026-09-19 without shipping |

Chrome Web Store mechanics, checked against Google's docs 2026-09-19 (kept here because chat
state evaporates and this bites at release time): the store reads the version from
`src/manifest.json` — never `package.json` — and `build.mjs` does not keep the two in sync, so
bumping is a deliberate one-line manifest edit at submission time (both sit at 1.2.0 today). A
new upload's version must exceed the previous **uploaded** version, published or not
(`developer.chrome.com/docs/webstore/update`), so plan the post-PR-#6 submission to be >1.2.0.
Hard gate before any store submission: one full human run of `docs/MANUAL_SMOKE_CHECKLIST.md`
against the real merged build — Node-side green has never proven popup rendering, side-panel
behaviour, or a completed live send.

Always verify with:

```bash
git status --short --branch
node -e "import('./src/shared/contract/manifest.js').then(m => console.log(m.CONTRACT_VERSION, Object.keys(m.METHODS).length))"
npm test && npm run build
```

---

## 2. Present architecture snapshot

```txt
src/ui/app/routes/*
  ↓ bridge.send(method, params)
src/background/api-router.js
  ↓ service dispatch + auth enforcement
src/background/services/*
  ↓ adapters
src/lib/vault.js        # sacred crypto/session/keyring layer
src/lib/thru-client.js  # sacred RPC/transaction/program layer
src/lib/networks.js     # network/program config
```

Current popup routes:

```txt
/welcome  /unlock  /dashboard  /accounts  /account  /add-account  /keyring
/export   /send    /receive    /faucet    /history  /settings     /reset
```

Quarantined surface (nothing ships):

```txt
src/launchpad/* is DELETED. No launchpad, DEX, swap or prediction page is built or reachable.
A future one is a new src/features/<id>/ module with its own backend namespace, not a revival.
```

Target feature architecture is defined in `docs/MODULE_BOUNDARIES.md`.

---

## 3. Canonical build timeline

This table deduplicates the repeated local-agent timeline. Commit IDs before the current Arena branch come from prior local-agent context and may not all be present in this shallow checkout; use them as historical identifiers, not as guaranteed reachable Git objects here.

| Order | Identifier | Status | Canonical meaning |
| ---: | --- | --- | --- |
| 0 | pre-`e77f3af` | historical | MVP existed with working backend/security/Thru basics but legacy UI debt. |
| 1 | `e77f3af` | historical | Baseline modular refactor captured under version control. |
| 2 | `6d841d1` | historical | Contract v3 and multi-seed keyring API exposed. |
| 3 | `4a73e4b` | historical | Backend capability layer: events, balances, pending tx, prefs, custom networks. |
| 4 | `c0ba23a` | historical | Legacy popup UI tree deleted; single route stack established; guarded DOM sink ratchet closed for `src/ui/**`. |
| 5 | `8eaba51` | historical | Live alphanet verification resolved amount units, fee, history, account registration/program questions. |
| 6 | `4a106e3` / `51ee88e` | historical | Settings and reset routes added; network switcher/auto-lock UI exposed. |
| 7 | `d53fde9` / `8bb8631` / `0a3c544` | historical | Send route migration, back navigation, MAX behavior, per-network fee handling, sender/account/token pickers. |
| 8 | `fce71cf` | historical | Static route reachability and CSS checker added. |
| 9 | `1849402` | historical | Official `@thru/programs` token bindings introduced; mint derivation corrected. |
| 10 | `e225035` | historical | UI/account picker improvements. |
| 11 | `8964ce4` | historical | Accounts register on-chain at creation so faucet can work immediately when network is available. |
| 12 | `e1eec74` | main base | Current Arena branch base: focus fix and single-stack state from `main`. |
| 13 | `00a5a54` | PR docs | Audit report added. |
| 14 | `a2d8f85` | PR docs | Rabby-class migration map added. |
| 15 | `1b1e882` | PR docs | Launchpad UX study added. |
| 16 | `e1813f3` | PR docs | Launchpad → DEX migration/charting UX study added. |
| 17 | `9848e32` | PR docs | Thru-native DeFi/full-tab correction added. |
| 18 | `00eb3a7` | PR code | Signing re-authentication required by default; password-gated session-only opt-out. |
| 19 | `3330e03` | PR code | Contract version bumped to v5 and signing-auth compatibility break documented/tested. |
| 20 | `1728db0` | PR docs | Wallet feature/performance study added. |
| 21 | current docs audit | this phase | Docs index, project ledger, module boundaries, MCP/LLM docs, and stale duplicate cleanup. |
| 22 | `c275fdd` | PR code (merged) | Contract v6: `wallet.reset` confirmation/password policy and password-gated `system.setAutoLock` enforced in the background. |
| 23 | `745f8ab` / PR #3 | merged | Legacy launchpad quarantined; route lifecycle coverage, focus trap, custom-network form withdrawal, and explicit side-panel action landed. |
| 24 | this PR | PR security hotfix | Contract v7 rejects custom activation in the background, self-heals unsafe stored active ids before RPC binding, and leaves legacy records inert/removable. |
| 25 | PR #5 | merged | Audit remediation: harden dependencies, CSP, and popup bundle (post-quarantine hygiene). |
| 26 | contract v8 work | this phase | Token transfer built on official `@thru/programs/token` bindings: `token.transfer` (signing-auth) + real `token.getBalances` (closes BACKEND_GAPS C1); asset selector/send/dashboard/history token paths; golden wire-byte and decoder tests; recipient token-account init sent as a preceding sender-signed transaction; `scripts/verify-token-transfer.mjs` live probe (alphanet run pending — sandbox RPC unreachable). |
| 27 | passkey spike | this phase | Time-boxed feasibility spike on the pinned `@thru/programs/passkey-manager` bindings (`docs/PASSKEY_SPIKE.md`): protocol feasible (challenge binds nonce+accounts+indices+instruction bytes; fee payer is a late-bound separate account; authority records give recovery), implementation gated on three probes — live program revision, distinct-account fee-payer validation, extension-origin `clientDataJSON` acceptance. No keyring branch, no `checkAuth` fork; not started pending user green-light. |

---

## 4. Current verified state

| Area | Current state |
| --- | --- |
| `npm test` | Passing; includes derivation, layering, routes, launchpad quarantine, contract, DOM, vault, Thru client (incl. token wire goldens), API router. |
| `npm run build` | Passing; wipes `dist/`, then generates the background and popup bundles plus `popup.css`, and copies `popup.html`, `manifest.json` and icons. |
| Contract | v8, 75 methods; custom-network activation is an intentional security break; v8 adds `token.transfer` and a real `token.getBalances`. |
| Signing auth | `tx.send`, `tx.claimFaucet`, `tx.autoCreateAccount`, `token.deploy`, `token.transfer` use `auth: 'signing'`. |
| Signing re-auth | Required by default; can be disabled only through password-gated `settings.setSecurity`. |
| Reset/auto-lock hardening | Contract v6: reset requires explicit confirmation and password when unlocked; auto-lock changes are password-gated. |
| Custom-network quarantine | Contract v7: enabled built-ins only; direct custom activation fails permanently and stale unsafe ids heal before RPC binding. |
| Production dependency audit | `npm audit --omit=dev` reported `found 0 vulnerabilities` in this session. |
| DOM sink ratchet | All of `src/` guarded at 0 sinks (`src/popup/vendor/` excluded). `src/launchpad/**`, the only directory outside the ratchet, is deleted. |
| Live chain facts | Alphanet faucet units, transfer fee, program addresses, history decoding, and account registration were verified historically. |

---

## 5. Known unresolved work

| Priority | Work | Why it matters | Owner doc |
| ---: | --- | --- | --- |
| P0 | Custom-network re-enablement design | Contract v7 safely quarantines legacy records. Bringing activation back still requires HTTPS policy, narrow host permission, verified capability records, and re-auth together. | `docs/STATUS_AND_ROADMAP.md` Step 2b |
| P1 | Browser smoke run | `test-route-lifecycle.mjs` mounts every route; layout, real focus, canvas and the side panel still need a human with Chrome. | `docs/MANUAL_SMOKE_CHECKLIST.md` |
| P1 | Side-panel width beyond 408px | `body { max-width: 100% }` fixes a panel narrower than the popup width; a wider panel still shows a 408px column. Needs a browser to decide. | `docs/MANUAL_SMOKE_CHECKLIST.md` §2 |
| P1 | Token transfer live verification | Feature is code-complete and unit-tested (contract v8); the one open item is running `scripts/verify-token-transfer.mjs` where alphanet is reachable, then recording the two open chain answers (unregistered recipient owner; token-program fee). | `docs/STATUS_AND_ROADMAP.md` Step 4 |
| P2 | Store re-submission | Store has a live legacy 1.1.0 while the canceled 1.2.0 never shipped. Sequence: merge PR #6 → human smoke-checklist run → bump `src/manifest.json` above 1.2.0 → submit. No urgency at current user count. | §1 Chrome Web Store note; `docs/MANUAL_SMOKE_CHECKLIST.md` |
| P1 | Feature module split | Launchpad/DEX/prediction must be separated before serious DeFi work. | `docs/MODULE_BOUNDARIES.md` |
| P1 | Exact-pin `@thru/programs` | Completed in the 2026-09-18 audit pass: `@thru/programs` and `@thru/sdk` are exact-pinned at `0.3.16`; derivation uses `@thru/sdk/crypto` and golden vectors are unchanged. | `package.json`, `test-derivation.mjs` |
| P2 | Full-tab shell | Required for launchpad/DEX/charts without slowing popup. | `docs/archive/WALLET_FEATURES_PERFORMANCE_STUDY.md` |
| P2 | Thru-native AMM/indexer integration | Needed for real swap/chart/market flows. | `docs/archive/THRU_NATIVE_DEFI_TAB_UX.md` |
| P2 | Local MCP companion | Useful for AI agents, but must never sign/export secrets. | `docs/MCP_AGENT_INTEGRATION.md` |
| P2 | dApp connector boundary | Current official wallet docs describe the hosted `wallet.thru.org/embedded` iframe via `@thru/wallet`; this extension has no verified extension/BYO-signer provider contract. Do not add `window.thru` or infer extension compatibility from `connect()`/`signTransaction()`. | `docs/STATUS_AND_ROADMAP.md` Step 10; `docs/BACKEND_GAPS.md` C4 |

---

## 6. Current non-negotiable constraints

1. Preserve working backend/security/Thru behavior unless a verified bug requires modification.
2. Thru is a native L1, not EVM. EVM/Solana/Cosmos products are UX references only.
3. Do not invent fake token/DEX/launchpad/chart/perps behavior.
4. Do not invent a `window.thru` provider standard. Thru's current docs describe a hosted embedded wallet, not this extension; future integration must follow an official extension/BYO-signer contract if one is published, rather than treating `connect()`/`getSigningContext()`/`signTransaction()` as proof of compatibility.
5. UI never imports vault internals or background services.
6. Background owns auth/signing.
7. Secrets never enter URLs, `data-*`, localStorage/sessionStorage, console logs, or analytics.
8. Use official Thru SDK/program packages where they provide capability.
9. No giant rewrite; use small, verifiable commits.
10. Run `npm test && npm run build` before and after completed coding phases.

---

## 7. Milestone reporting template

Record **major milestones only** here. Git commits and PRs are the detailed change log; do not turn
this ledger into another giant duplicate history. For a major completed milestone, summarize using
this format:

```txt
PHASE:
FILES ADDED:
FILES MODIFIED:
BACKEND CHANGES:
UI CHANGES:
SECURITY IMPACT:
TESTS:
BUILD:
KNOWN LIMITATIONS:
NEXT PHASE:
```

### Milestone — route lifecycle coverage, custom-network withdrawal, side-panel action

```txt
PHASE:                Frontend reliability: prove every route mounts and cleans up, withdraw an
                      unsafe capability, make the declared side panel reachable.
FILES ADDED:          test-route-lifecycle.mjs (680 checks), src/ui/kit/focus-trap.js (189),
                      docs/MANUAL_SMOKE_CHECKLIST.md.
FILES MODIFIED:       src/ui/app/routes/settings.js (custom-network form out, Window section in),
                      src/ui/domain/password-prompt.js (uses the shared trap),
                      src/ui/app/routes/reset.js (PageHeader leak), src/popup/styles/base.css
                      (body max-width), package.json, CONTEXT.md, AGENTS.md, and the docs set.
BACKEND CHANGES:      none. network.upsertCustom stays in the contract (append-only) with no UI
                      caller; vault, signing and RPC/instruction construction untouched.
UI CHANGES:           Settings no longer offers "Add custom network" but still lists and removes
                      saved ones; Settings > Window > "Open side panel" is an explicit user action
                      that never calls setPanelBehavior; password dialogs trap Tab and restore
                      focus.
SECURITY IMPACT:      aria-modal="true" is now backed by a real trap; the custom-RPC path that
                      could target the wrong program addresses is unreachable from the UI; a
                      listener leak on a detached screen is fixed and guarded.
TESTS:                npm test -> PASS (derivation 16, layering 58 files / 0 sinks, routes 14/14,
                      quarantine 45, contract 54, dom+refs 89, route lifecycle 680, vault,
                      thru-client, api-router).
BUILD:                npm run build -> PASS; npm audit --omit=dev -> 0 vulnerabilities.
KNOWN LIMITATIONS:    the lifecycle test is a shim, not a browser: layout, real focus, canvas and
                      side-panel behaviour are the manual checklist. A side panel wider than 408px
                      still shows a fixed-width column.
NEXT PHASE:           run the manual smoke checklist in Chrome; contacts/account-order UI and the
                      token portfolio stay gated on their own preconditions.
```

### Milestone — contract v7 custom-network quarantine

```txt
PHASE:                Security hotfix after the UI-only withdrawal proved bypassable.
FILES MODIFIED:       network-service, api-router error normalization, Settings network rows,
                      contract manifest, API/contract/lifecycle tests, and maintained docs.
BACKEND CHANGES:      network.setActive accepts enabled built-ins only; a saved custom id returns
                      non-retryable CUSTOM_NETWORK_DISABLED. Active-network reads rewrite unsafe
                      stored ids to Alphanet before configureNetwork() runs.
UI CHANGES:           legacy custom rows are inert and aria-disabled, explain why, and retain
                      Remove as their only action.
SECURITY IMPACT:      a stale UI, direct message request, or fresh worker cannot bind a custom
                      endpoint whose transfer/token programs were never verified.
TESTS:                API-router tests cover direct rejection, storage/client non-mutation,
                      getActive/bootstrap healing, disabled ids and removal; lifecycle tests cover
                      inert UI, the real bridge refusal and removal; contract v7/code are guarded.
KNOWN LIMITATIONS:    custom endpoint activation is intentionally unavailable. Re-enablement needs
                      all four prerequisites in STATUS_AND_ROADMAP Step 2b. No browser verification
                      is claimed; use MANUAL_SMOKE_CHECKLIST §6.
NEXT PHASE:           merge this security hotfix before the independent CSS-only wide-panel PR.
```

### Milestone — legacy launchpad quarantine

```txt
PHASE:                Remove the last legacy surface from the shipped extension.
FILES ADDED:          test-launchpad-quarantine.mjs (45 checks).
FILES DELETED:        src/launchpad/launchpad.js (552), src/launchpad/launchpad.html (443),
                      src/launchpad/launchpad.css (1,057), src/popup/icons.js (79),
                      src/popup/toast.js (60).
FILES MODIFIED:       build.mjs, package.json, src/manifest.json, src/shared/flags.js,
                      src/ui/app/routes/dashboard.js, src/popup/popup.html,
                      src/popup/styles/screens.css (-62), src/popup/styles/components.css (-50),
                      src/ui/kit/icon.js + src/ui/domain/account-avatar.js (comments),
                      scripts/check-layering.mjs, and the docs set.
BACKEND CHANGES:      none. No contract method added, renamed, removed or re-authed; vault,
                      signing and RPC/instruction construction untouched.
UI CHANGES:           the flag-gated dashboard launchpad banner is gone (dead while
                      FEATURE_LAUNCHPAD was false); dist/ ships one page instead of two.
SECURITY IMPACT:      closes AUDIT_REPORT F-04. No extension page interpolates token-controlled
                      values into innerHTML any more, the ?launchpad=1 override cannot turn a
                      legacy surface on, and the DOM-sink ratchet now covers all of src/.
TESTS:                npm test -> PASS (derivation 16, layering 57 files / 0 sinks, routes 14/14,
                      quarantine 45, contract 54, dom+refs 89, vault, thru-client, api-router).
BUILD:                npm run build -> PASS, no warnings; npm audit --omit=dev -> 0 vulnerabilities.
KNOWN LIMITATIONS:    no route is mounted by a test yet (Step 2). Research docs describe a
                      launchpad/DEX that does not exist in code and must not be read as state.
NEXT PHASE:           run `scripts/verify-token-transfer.mjs` where alphanet is reachable;
                      passkey implementation stays gated on the probes in
                      `docs/PASSKEY_SPIKE.md` (user green-light required).
```

---

## 8. Source identifiers to keep updated

When these change, update this ledger, `CONTEXT.md`, `docs/STATUS_AND_ROADMAP.md`, and `llms.txt`:

| Identifier | Current value |
| --- | --- |
| contract version | 8 |
| method count | 75 |
| route count | 14 |
| guarded DOM sink count (all of `src/`) | 0 |
| enabled networks | alphanet, localnet |
| disabled declared networks | testnet, mainnet |
| built extension pages | popup only (`popup.html`) |
| launchpad state | quarantined: deleted from `src/` and `dist/`; research docs retained |
| next P0 work | custom-network re-enablement prerequisites (quarantine itself is enforced in v7) |
