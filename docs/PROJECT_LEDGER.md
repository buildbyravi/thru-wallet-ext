# Project ledger — past, present, and future build tracking

Date: 2026-09-18  
Purpose: canonical ledger for build phases, state identifiers, accepted constraints, active gaps, and future work. This replaces duplicated chat/local-agent phase tables with a clean source of truth.

---

## 1. Current identifiers

| Item | Value |
| --- | --- |
| Repository | `buildbyravi/thru-wallet-ext` |
| Arena branch | `arena/01a0b4e5-thru-wallet-ext` |
| Base main commit for this Arena branch | `c275fdd14197bd81d43d6f5ced747ff550cb99fb` |
| Current contract version | `6` |
| Contract source | `src/shared/contract/manifest.js` |
| Current route count | 14 popup routes |
| Contract method count | 74 methods |
| Runtime surfaces today | popup route stack only — one extension page, `popup.html` |
| Dist directory | generated; do not edit |

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
| 23 | this PR | PR code | Legacy launchpad quarantined: `src/launchpad/**` deleted, no launchpad page built, `?launchpad=1` override removed, DOM-sink ratchet widened to all of `src/`, `test-launchpad-quarantine.mjs` added. |

---

## 4. Current verified state

| Area | Current state |
| --- | --- |
| `npm test` | Passing; includes derivation, layering, routes, launchpad quarantine, contract, DOM, vault, Thru client, API router. |
| `npm run build` | Passing; wipes `dist/`, then generates the background and popup bundles plus `popup.css`, and copies `popup.html`, `manifest.json` and icons. |
| Contract | v6, 74 methods. |
| Signing auth | `tx.send`, `tx.claimFaucet`, `tx.autoCreateAccount`, `token.deploy` use `auth: 'signing'`. |
| Signing re-auth | Required by default; can be disabled only through password-gated `settings.setSecurity`. |
| Reset/auto-lock hardening | Contract v6: reset requires explicit confirmation and password when unlocked; auto-lock changes are password-gated. |
| Production dependency audit | `npm audit --omit=dev` reported `found 0 vulnerabilities` in this session. |
| DOM sink ratchet | All of `src/` guarded at 0 sinks (`src/popup/vendor/` excluded). `src/launchpad/**`, the only directory outside the ratchet, is deleted. |
| Live chain facts | Alphanet faucet units, transfer fee, program addresses, history decoding, and account registration were verified historically. |

---

## 5. Known unresolved work

| Priority | Work | Why it matters | Owner doc |
| ---: | --- | --- | --- |
| P0 | Custom-network security/capability decision | Arbitrary RPCs need CSP/permission/capability handling before promotion. | `docs/STATUS_AND_ROADMAP.md` |
| P1 | Route mount/browser smoke tests | Current tests prove routes exist but do not mount them in a browser-like DOM. | `docs/STATUS_AND_ROADMAP.md` |
| P1 | Token transfer | Required for honest asset support. Must use official `@thru/programs/token`. | `docs/BACKEND_GAPS.md` |
| P1 | Feature module split | Launchpad/DEX/prediction must be separated before serious DeFi work. | `docs/MODULE_BOUNDARIES.md` |
| P1 | Exact-pin `@thru/programs` | Non-PR cleanup: `package.json` currently allows `^0.3.4`; align with the repo rule that Thru SDK/program package versions are exact-pinned. | `package.json` |
| P2 | Full-tab shell | Required for launchpad/DEX/charts without slowing popup. | `docs/WALLET_FEATURES_PERFORMANCE_STUDY.md` |
| P2 | Thru-native AMM/indexer integration | Needed for real swap/chart/market flows. | `docs/THRU_NATIVE_DEFI_TAB_UX.md` |
| P2 | Local MCP companion | Useful for AI agents, but must never sign/export secrets. | `docs/MCP_AGENT_INTEGRATION.md` |

---

## 6. Current non-negotiable constraints

1. Preserve working backend/security/Thru behavior unless a verified bug requires modification.
2. Thru is a native L1, not EVM. EVM/Solana/Cosmos products are UX references only.
3. Do not invent fake token/DEX/launchpad/chart/perps behavior.
4. Do not invent a `window.thru` provider standard; future dApp integration must follow Thru's documented `connect()`, `getSigningContext()`, and `signTransaction()` flow after compatibility validation.
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
NEXT PHASE:           jsdom route mount tests, then the custom-network decision.
```

---

## 8. Source identifiers to keep updated

When these change, update this ledger, `CONTEXT.md`, `docs/STATUS_AND_ROADMAP.md`, and `llms.txt`:

| Identifier | Current value |
| --- | --- |
| contract version | 6 |
| method count | 74 |
| route count | 14 |
| guarded DOM sink count (all of `src/`) | 0 |
| enabled networks | alphanet, localnet |
| disabled declared networks | testnet, mainnet |
| built extension pages | popup only (`popup.html`) |
| launchpad state | quarantined: deleted from `src/` and `dist/`; research docs retained |
| next P0 work | custom-network security/capability decision |
