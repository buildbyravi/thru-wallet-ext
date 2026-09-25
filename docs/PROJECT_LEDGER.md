# Project ledger — shipped baseline and open verification

Date: 2026-09-26
Purpose: concise source-backed record of the current implementation, contract identifiers, completed milestones, and checks that remain open. `src/`, tests, and scripts are authoritative; this ledger is a summary.

The documentation update is based on the shipped source at `main` commit `4aa55ba`. The documentation-only changes do not claim new runtime behavior.

---

## 1. Current identifiers

| Item | Shipped value |
| --- | --- |
| Repository | `buildbyravi/thru-wallet-ext` |
| Audited implementation baseline | `4aa55ba` (`main`) |
| Contract version | v12 |
| Contract methods | 81, counted from `Object.keys(METHODS)` in `src/shared/contract/manifest.js` |
| Route count | 14 popup/side-panel routes |
| Signing preference default | Session-only while unlocked (`requirePasswordForSigning: false`); password re-auth is an explicit, password-gated Settings opt-in |
| Built extension page | `popup.html`, shared by toolbar popup and side panel |
| Network availability | Alphanet and Localnet enabled; Testnet and Mainnet declared but disabled |
| Thru package versions | `@thru/sdk` and `@thru/programs` exact-pinned at `0.3.16` |
| Build output | Generated under `dist/`; do not edit by hand |

The contract remains an append-only API in ordinary feature work, with documented security-policy exceptions in v5–v7. Later additions v8–v12 did not remove existing methods. Treat the manifest and `test/test-contract.mjs` as the exact contract authority.

Run from the repository root:

```bash
git status --short --branch
node -e "import('./src/shared/contract/manifest.js').then(m => console.log(m.CONTRACT_VERSION, Object.keys(m.METHODS).length))"
npm test
npm run build
```

---

## 2. Present architecture snapshot

```txt
src/ui/app/routes/*
  ↓ bridge.send(method, params)
src/shared/contract/manifest.js
  ↓ allowlisted API request
src/background/api-router.js
  ↓ auth + service dispatch
src/background/services/*
  ↓
src/lib/vault.js       # encrypted vault, keyrings, account derivation
src/lib/thru-client.js # RPC, transaction/program adapters, history decoding
src/lib/networks.js    # enabled network and program configuration
```

The 14 routes are registered in `src/ui/app/boot.js`: `/welcome`, `/unlock`, `/dashboard`, `/accounts`, `/account`, `/add-account`, `/keyring`, `/export`, `/send`, `/receive`, `/faucet`, `/history`, `/settings`, and `/reset`.

The toolbar popup and side panel share `popup.html`. The side panel uses the `?thru_panel=1` context marker. A popup opening broadcasts a close message and uses Chrome's side-panel close API when available; the panel listener is installed before asynchronous boot work. Settings exposes an explicit **Side Panel Mode** opt-in that controls whether the toolbar action opens the panel. This behavior is covered by deterministic tests; actual Chrome interaction remains a manual check.

No launchpad, DEX, swap, or prediction UI is shipped. The old `src/launchpad/` tree and its entry points were removed; `test/test-launchpad-quarantine.mjs` keeps that surface out of source/build output. Backend token methods are separate and remain part of the wallet contract.

---

## 3. Shipped contract milestones

| Version | Shipped change |
| ---: | --- |
| v5 | Existing signing methods moved to `auth: 'signing'`; background policy honors the user's password re-auth preference. |
| v6 | Reset confirmation/password policy and password-gated auto-lock changes enforced by the background. |
| v7 | Custom network activation refused in the background; stale custom/disabled/unknown active IDs heal before RPC binding. Legacy records remain inert/listable/removable. |
| v8 | Token transfer and real registry-mint balances built on official `@thru/programs/token` bindings. |
| v9 | Cache-merged history feed with cursor pagination and an explicit offline/sync status. |
| v10 | Lazy per-signature transaction detail; declared fee and unavailable/optional fields are distinguished rather than guessed. |
| v11 | `tx.sendChecked` and `token.transferChecked` pin the reviewed source account and network at the backend boundary. |
| v12 | `tx.registerAccount` is unlocked-only and limited to an exact vault-owned address; `tx.getCachedHistory` adds a storage-only, per-network/address History read. |

### v12 registration and History behavior

- Account/keyring creation paths make a best-effort registration attempt for each newly added account on the selected network. Retries are bounded (one initial attempt plus at most three exponential retries); lock, account removal, network change, or a permanent refusal stops the retry. Offline failure does not block local account creation.
- Dashboard may call the existing active-account creation path after a successful live absence check. Send uses `tx.registerAccount` only after an absence check for a recipient the unlocked vault owns. It never registers an arbitrary contact or external address.
- Registration signs with the target account's own key; its transaction declares fee `0n` and nonce `0n`. It is still a signed broadcast and is not evidence that network/privacy effects are zero. There is no periodic signer.
- Send JIT activation remains pending until the background confirms registration. Review then displays the matched recipient label and the full address. The label is presentation only; the address remains the authorization fact.
- History paints a storage-only cache scoped by network and address before its RPC feed/pending reconciliation completes. Known block times carry `timestampSource: 'block'`; only an actual local submission time for the wallet's own transaction may be used as a fallback. Otherwise the card shows `Block <slot>` rather than a fabricated date. The UI is a flat stream without day headers and has no per-card fee line.

---

## 4. Current verified state

| Area | Current state and evidence |
| --- | --- |
| `npm test` | PASS on the 2026-09-26 documentation-only change: derivation 16, QR 15, layering 70 files/0 sinks, CSP, routes 14/14, CSS nesting, quarantine 47, contract 77, DOM/refs 130, route lifecycle 904, plus vault, Thru client, token/balance, History, registration, and API-router suites. |
| `npm run build` | PASS on the final documentation-only change; `build.mjs` regenerated `dist/` from current source. |
| Contract | v12, 81 methods. v12 registration/history APIs are additive; security changes are documented above. |
| Signing | Signing methods use `auth: 'signing'`. The wallet must be unlocked; password re-authentication is required only when the user enables it in Settings. That opt-in is itself password-gated. |
| Registration | Exact ownership is checked in the background, the target account is the signer, Send JIT does not touch external recipients, and retry behavior is covered by deterministic registration/API tests. |
| History | Flat card stream, storage-only cache-first paint, per-network/address cache, network-scoped block-time lookup, and provenance/fallback behavior are covered by deterministic tests. |
| Popup/side panel | Mutual-exclusion and side-panel mode paths have deterministic route/service tests. No real-Chrome certification is claimed. |
| DOM safety | `scripts/check-layering.mjs` checks the shipped `src/` tree (vendored QR code excluded); current sink count is zero. |
| Dependency pin | `@thru/sdk` and `@thru/programs` are exact-pinned at `0.3.16`; this is complete, not open work. |

---

## 5. Open verification and unresolved work

Passing Node tests/builds do not close these items.

| Priority | Open item | Boundary / owner |
| ---: | --- | --- |
| P1 | Real popup + side-panel smoke: layout at narrow/wide widths, focus rings, QR canvas, opening/closing each context, mutual exclusion, and Settings mode behavior | `docs/MANUAL_SMOKE_CHECKLIST.md` |
| P1 | MV3 suspension/restart or bridge timeout during account registration and Send; verify retry/unknown-outcome behavior in real Chrome | `docs/MANUAL_SMOKE_CHECKLIST.md`; `docs/SEND_PATH_AUDIT.md` |
| P1 | Live v12 activation: create multiple HD accounts, then activate an absent owned Send recipient; verify exact target signer, selected-network behavior, and offline/absence distinction | `docs/STATUS_AND_ROADMAP.md`; `scripts/verify-autoregister.mjs` is historical pre-v12 evidence, not a substitute |
| P1 | Live token transfer: whether a never-registered recipient owner can receive an initialized token account and what fee the token program actually charges | `scripts/verify-token-transfer.mjs`; `docs/BACKEND_GAPS.md` |
| P1 | Signing network-switch race after the last preflight check and concurrent pending-record read/modify/write race | `docs/SEND_PATH_AUDIT.md` |
| P1 | Live availability/latency of optional block-time headers on the current feeds and each enabled network | `docs/HISTORY_REDESIGN_PLAN.md`; `docs/MANUAL_SMOKE_CHECKLIST.md` |
| P1 | Whether an authoritative charged-fee value exists outside the current RPC detail response; the current response does not report a charged-fee field | `docs/BACKEND_GAPS.md`; official Explorer MCP docs are linked from `docs/DOCS_INDEX.md` |
| P1 | Confirm the live explorer transaction route before relying on it as a supported destination | `docs/STATUS_AND_ROADMAP.md`; `docs/MANUAL_SMOKE_CHECKLIST.md` |
| P2 | Custom RPC activation remains intentionally disabled until endpoint permissions, CSP, verified per-network program capabilities, and user authorization are designed together | `docs/STATUS_AND_ROADMAP.md` |
| P2 | Optional feature modules (launchpad/DEX/prediction, dApp provider, local MCP) are not shipped; any future work needs its own protocol verification and guardrails | `docs/MODULE_BOUNDARIES.md` and the relevant maintained planning doc |

---

## 6. Non-negotiable constraints

1. Treat `src/` and its tests as the implementation authority; do not describe a planned feature as shipped.
2. Thru is a native L1, not EVM. External wallets may inform UX only.
3. Do not invent token/DEX/launchpad/chart behavior, fee values, explorer route guarantees, or an extension `window.thru` provider contract.
4. Background owns authentication, account ownership checks, and signing. Do not move vault material into the UI.
5. Signing password re-auth is opt-in and defaults to session-only while unlocked. Secret export, password-gated keyring operations, and security-setting changes use their declared password policy; reset always requires confirmation and also requires a password when the wallet is unlocked. Other account operations follow their contract auth.
6. The v12 unlocked-only registration exception applies only to an exact owned account; never extend it to value-moving sends or external recipients.
7. History caches, balances, pending transactions, and token state remain network-scoped where chain-specific; keys, labels, and contacts remain wallet/global state.
8. Real-browser and live-chain evidence must be recorded separately from automated test results.
9. Keep small, reviewable changes; run the repository checks on the final tree.

---

## 7. Milestone reporting template

For a future major milestone, record only the concise summary here; Git commits and PRs are the detailed change log.

```txt
PHASE:
FILES ADDED / MODIFIED / DELETED:
BACKEND CONTRACT DELTA:
UI CHANGES:
SECURITY IMPACT:
TESTS:
BUILD:
BROWSER / LIVE-CHAIN EVIDENCE:
KNOWN LIMITATIONS:
NEXT:
```

---

## 8. Source identifiers to keep updated

When these change, update this ledger, `CONTEXT.md`, `docs/STATUS_AND_ROADMAP.md`, and `llms.txt`:

| Identifier | Current value |
| --- | --- |
| contract version | 12 |
| method count | 81 |
| route count | 14 |
| guarded DOM sink count | 0 across shipped `src/` (vendored QR excluded) |
| enabled networks | Alphanet, Localnet |
| disabled declared networks | Testnet, Mainnet |
| built extension pages | one shared `popup.html` for popup + side panel |
| launchpad/DEX/prediction UI | not shipped; launchpad tree is quarantined by source/build tests |
| signing re-auth default | off; unlocked session only, with password-gated opt-in |
| `@thru/sdk` / `@thru/programs` | exact-pinned `0.3.16` |
