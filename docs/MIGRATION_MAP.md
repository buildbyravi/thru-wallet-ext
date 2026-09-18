# Rabby-class migration map

Date: 2026-09-18  
Branch: `arena/01a06be7-thru-wallet-ext`  
Status: planning / architecture map only. No destructive source changes in this step.

This document records the required baseline inspection before continuing the Thru Wallet migration.
It translates the supplied Rabby-class product brief into this repository's current reality and a
safe incremental path forward.

---

## 0. Inputs read

The prompt references historical filenames that are not present in this checkout. The matching
current files are:

| Requested source | File read in this checkout | Notes |
| --- | --- | --- |
| `README(20260815-192822).md` | `README.md` | Current project README and functional-status record. |
| `thru-implementation_plan(1).md` | `docs/archive/thru-implementation_plan.md` | Archived implementation plan; useful for context, not authoritative. |
| Project rules/context | `AGENTS.md`, `CONTEXT.md` | Agent rules, file map, current traps. |
| Current state | `docs/STATUS_AND_ROADMAP.md` | Authoritative current roadmap. |
| Product/security spec | `docs/BUILD_SPEC.md` | Behavioural and security intent. |
| Prior defects | `docs/DEFECT_LOG.md`, `docs/AUDIT_REPORT.md` | Regression lessons and open security findings. |
| Backend capability gaps | `docs/BACKEND_GAPS.md` | What is verified vs blocked on Thru semantics. |
| UI migration history | `docs/UI_REBUILD_PLAN.md` | Historical target architecture and completed rebuild phases. |

Rabby reference inspection was performed through a temporary sparse clone of
`https://github.com/RabbyHub/Rabby` under `/tmp/rabby`. No Rabby source, assets, branding, or code
were copied into this repository.

---

## 1. Baseline build and test results

### Initial attempt

`npm test && npm run build` initially failed because `node_modules` was absent in the sandbox:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@thru/crypto'
```

This was an environment/dependency-installation issue, not a source failure.

### Dependency install

```bash
npm install
```

Result: PASS. `npm audit` during install reported `found 0 vulnerabilities` for 28 packages.
NPM also warned that `@thru/crypto@0.2.21` is deprecated upstream.

### Baseline test/build

```bash
npm test && npm run build
```

Result: PASS.

Observed test summary:

- Derivation: 16/16 passed.
- Layering: 60 files checked, 0 violations, DOM sink ratchet closed for guarded UI paths.
- Routes: 14 registered routes, all reachable, 128 used classes all defined.
- Contract: 54/54 passed in the latest docs-audit verification; contract version is v6.
- DOM/refs: 89/89 passed.
- Vault integration: passed.
- Thru client encoding/history/network config: passed.
- API router integration: passed.

Build result:

- `dist/background.bundle.js`: 615.1kb
- `dist/popup.bundle.js`: 420.9kb
- `dist/popup.css`: 48.2kb
- `dist/launchpad.bundle.js`: 28.5kb
- `dist/launchpad.css`: 44.4kb

Non-fatal stderr during tests:

- Fire-and-forget on-chain registration warnings due unavailable fetch/RPC in the sandbox.
- No test failed because of those warnings.

---

## 2. Currently working feature inventory

From README, tests, and source inspection, the working wallet core includes:

### Wallet lifecycle

- Create a seed-based wallet with a 12-word BIP-39 mnemonic.
- Import a 12-word mnemonic.
- Import a raw 32-byte private key.
- Password-encrypted vault storage using PBKDF2 + AES-GCM.
- Session unlock stored in `chrome.storage.session`.
- Lock/unlock flows.
- Reset flow.
- Unlock throttling / lockout state.
- Inactivity-based auto-lock alarm.

### Account model

- Multiple seed keyrings in one vault.
- Multiple HD accounts per seed keyring.
- Imported private-key keyrings.
- Active account switching.
- Account labels.
- Account hiding, pinning, ordering preferences.
- Account detail route.
- Account removal for HD accounts where safe.
- Keyring removal with last-keyring guard.
- Keyring provenance (`generated`, `imported`, `unknown`) and backup acknowledgement.
- Opaque account refs for URLs.

### Native THRU operations

- Native account creation/registration.
- Balance retrieval and cached balance reads.
- Faucet claim on networks with faucet config.
- Native THRU transfer.
- Recipient validation and recipient activation detection.
- Basic fee estimate from measured per-network config where available.
- Pending transaction tracking and reconciliation.
- Transaction history listing with known transfer/faucet decoding.
- Unknown program handling without false labelling.
- Explorer URL helpers.

### UI routes

The current popup has one route stack with 14 routes:

```text
/account
/accounts
/add-account
/dashboard
/export
/faucet
/history
/keyring
/receive
/reset
/send
/settings
/unlock
/welcome
```

### Supporting systems

- Stable background API contract in `src/shared/contract/manifest.js`.
- Central router in `src/background/api-router.js`.
- Background service modules for accounts, auth, balances, contacts, keyrings, network,
  pending transactions, preferences, system, tokens, transactions, and wallet lifecycle.
- Event service for UI push events.
- Vanilla ES module UI kit with guarded DOM factory.
- Design tokens and component CSS split under `src/popup/styles/`.

---

## 3. Security-sensitive files

These files should be treated as sensitive and changed only with targeted tests:

| Area | Files | Why sensitive |
| --- | --- | --- |
| Vault / key material | `src/lib/vault.js` | Mnemonics, private keys, encryption, migration, session material, export. |
| Thru RPC / signing / instruction construction | `src/lib/thru-client.js` | Program addresses, instruction encoding, signing, submission, decoding. |
| API auth boundary | `src/background/api-router.js`, `src/shared/contract/manifest.js` | Declares and enforces what UI callers may do. |
| Wallet auth / throttling | `src/background/services/auth-service.js`, `src/background/services/wallet-service.js` | Unlock attempts, lockout, reset, export, lock/unlock eventing. |
| Transaction operations | `src/background/services/tx-service.js`, `src/background/services/pending-tx-service.js` | Sends, faucet, duplicates, pending state, balance refresh after submit. |
| Keyring/account mutation | `src/background/services/keyring-service.js`, `src/background/services/account-service.js` | Creates/removes/renames account sources and account refs. |
| Network/RPC config | `src/lib/networks.js`, `src/background/services/network-service.js` | RPC URLs, explorer URLs, program ids, custom network switching. |
| Preferences/security controls | `src/background/services/preferences-service.js`, `src/background/services/system-service.js`, `src/shared/autolock.js` | Auto-lock, whitelist, hidden/pinned/order state. |
| UI secret entry/export | `src/ui/app/routes/welcome.js`, `src/ui/app/routes/add-account.js`, `src/ui/app/routes/export.js`, `src/ui/domain/password-prompt.js`, `src/ui/domain/seed-phrase-grid.js` | Secret capture/reveal and password prompts. |
| DOM safety | `src/ui/kit/dom.js`, `scripts/check-layering.mjs`, `scripts/check-routes.mjs` | Injection prevention and route/CSS graph checks. |
| Extension policy/build | `src/manifest.json`, `build.mjs` | CSP, permissions, bundled entry points. |

---

## 4. Files that communicate with Thru or external endpoints

| File | External activity |
| --- | --- |
| `src/lib/thru-client.js` | Creates SDK client, calls Thru RPC, account info, account creation, faucet, transfer, history, token mint helpers. |
| `src/lib/networks.js` | Defines RPC and explorer endpoints plus program addresses. |
| `src/background/services/network-service.js` | Resolves active/custom network and rebinds `thru-client`. |
| `src/background/services/tx-service.js` | Calls `thru-client` for account info, faucet, send, history, health, auto-create, fee/sim stubs. |
| `src/background/services/balance-service.js` | Batch balance reads and cache management. |
| `src/background/services/token-service.js` | Token deployment/address derivation/local token registry through `thru-client`. |
| `src/background/services/account-service.js`, `wallet-service.js`, `keyring-service.js` | Fire-and-forget on-chain account registration after account/keyring creation. |
| `src/ui/app/routes/*` | Never call RPC directly; only call background methods through `src/ui/app/bridge.js`. |
| `src/launchpad/launchpad.js` | Calls background bridge; still a separate legacy-style page and not yet guarded like popup UI. |

The extension CSP permits only the Thru RPC URLs and local development RPC hosts for `connect-src`.

---

## 5. Build process and tests

### Build

`npm run build` runs `node build.mjs`, which:

- Cleans and recreates `dist/`.
- Bundles background, popup, and launchpad JS with esbuild.
- Bundles CSS.
- Copies static extension files and icons.

`dist/` is generated and must not be edited.

### Tests / guards

`npm test` runs:

1. `test-derivation.mjs` — pinned dependency ranges and deterministic derivation vectors.
2. `scripts/check-layering.mjs` — UI/background layering and DOM sink ratchet.
3. `scripts/check-routes.mjs` — route reachability and CSS class existence.
4. `test-contract.mjs` — manifest/router/UI API contract consistency and auth invariants.
5. `test-ui-dom.mjs` — DOM factory, URL filtering, refs, disposer semantics.
6. `test-vault.mjs` — vault creation/import/export/keyring/account integration.
7. `test-thru-client.mjs` — instruction encoding, amount parsing, address validation, history decoding, network config.
8. `test-api-router.mjs` — background API integration and JSON-safe responses.

Live-chain probes exist under `scripts/verify-*.mjs`, `scripts/measure-fee.mjs`, and
`scripts/probe-*.mjs`; they are intentionally not part of `npm test`.

---

## 6. Current architecture map

```text
src/
  shared/
    contract/manifest.js       # API contract imported by UI and background
    format.js, refs.js         # shared primitives
  lib/
    vault.js                   # encrypted vault + keyring implementation
    thru-client.js             # SDK/RPC/program adapter
    networks.js                # network config and explorer helpers
  background/
    index.js                   # MV3 service worker entry
    api-router.js              # method dispatch + auth enforcement
    services/*.js              # application services over vault/thru/storage
  ui/
    kit/*.js                   # DOM-safe primitives and form/buttons/feedback
    domain/*.js                # wallet-aware reusable UI components
    app/*.js                   # boot/router/guards/bridge/shell
    app/routes/*.js            # popup routes
  popup/
    popup.html, popup.js       # shell entry and CSS imports
    styles/*.css               # tokens/base/components/screens/utilities
  launchpad/
    launchpad.html/js/css      # disabled future surface, still bundled
```

### Existing dependency direction

```text
UI routes/components
  -> ui/app/bridge.js
    -> chrome.runtime.sendMessage
      -> background/api-router.js
        -> background/services/*
          -> lib/vault.js / lib/thru-client.js / lib/networks.js
```

This direction is correct. The migration should strengthen it, not replace it with a new parallel
stack.

### Architectural strengths already achieved

- One new popup route stack; legacy popup screen tree is deleted.
- One sanctioned UI/background bridge.
- Contract manifest is the background API allowlist.
- UI cannot import background or vault internals without failing layering checks.
- DOM factory prevents inline event handlers, unsafe URLs, and markup injection in guarded UI.
- Network config is centralized and current RPC client rebinding is tested.
- Existing keyring model already matches the required wallet/seed/account/private-key hierarchy.

### Architectural weaknesses to address before feature expansion

1. **Auth policy drift:** F-01 signing auth is now guarded by `auth: 'signing'`, which requires
   password re-authentication by default and allows an explicit password-gated Settings opt-out.
   Reset and auto-lock were hardened in contract v6; broader security preferences should continue
   to use password-gated APIs. See `docs/AUDIT_REPORT.md`.
2. **Route rendering is not tested:** route graph and classes are tested; actual route mounting in a
   browser-like DOM is still uncovered.
3. **Launchpad bypasses UI guardrails:** it remains a separate bundled page with `innerHTML` sinks.
4. **No formal domain/application/infrastructure ports:** the service modules are practical seams,
   but the abstractions are not named or documented as stable interfaces yet.
5. **Store/event model is partial:** background push events exist, but there is no single frontend
   state store coordinating session/account/balances/assets/activity/settings.
6. **Error taxonomy is incomplete:** user-facing errors are often normalized by message, not typed
   domain errors.

---

## 7. Rabby reference findings to adapt, not copy

The Rabby repository is much larger and React/EVM-specific. The useful transferable patterns are
architectural and UX patterns, not code:

| Rabby pattern observed | Thru adaptation |
| --- | --- |
| Rich `src/ui/views/*` route taxonomy for onboarding, send, receive, address management, approvals, desktop profile, settings. | Keep Thru's vanilla route modules but maintain a route table with guards, labels, and layouts. Do not adopt React solely to imitate Rabby. |
| Dedicated address/account management views and account selectors. | Continue making `/accounts` a full screen, grouped by keyring, with search, active marker, balances, copy, and details. |
| Shared component library: account selector, address viewer, copy, modals, page headers, token selectors, transaction history, QR scanner, authentication modal. | Expand `src/ui/kit` and `src/ui/domain` with Thru-native components only where repeated behaviour exists. |
| Explicit private route guards. | Keep/extend `src/ui/app/guards.js`; make guard decisions declarative in route metadata. |
| Desktop route tree separate from popup route tree but sharing components. | Replace standalone launchpad patterns with a future desktop/full-page wallet route tree that shares kit/domain components. |
| Background service modules for keyring, preferences, permissions, transactions, notifications, transaction watchers, security engine. | Add narrowly-scoped Thru service modules only after the wallet core is protected; do not add fake dApp/provider behaviour. |
| Migration directory for long-lived installs. | Introduce tested migrations only when the vault/preferences schema next changes; do not rewrite existing vault storage unnecessarily. |
| Transaction preparation/security pipeline before signing. | Introduce a Thru-native transaction draft/review/auth/sign/submit lifecycle around existing `thru-client` primitives. |

---

## 8. Target architecture for this repository

Do not perform a directory-wide rewrite. Evolve the existing layout by adding interfaces and
contracts around the code that already works.

### Near-term target

```text
src/
  shared/
    contract/                 # API manifest, events, typed error codes
    domain/                   # pure JS domain types/factories where useful
    format.js
    refs.js
  background/
    api-router.js             # one external API gate
    services/                 # application services remain here initially
    ports/                    # small interface docs/adapters as code stabilizes
    migrations/               # add only for schema changes
  lib/
    vault.js                  # current vault adapter, sacred
    thru-client.js            # current Thru adapter, sacred
    networks.js
  ui/
    app/
      route-registry.js       # route metadata: path, guard, layout, sensitivity
      store.js                # single subscribed frontend state, introduced incrementally
      events.js               # UI-side event names/selectors over bridge events
    kit/                      # primitive components
    domain/                   # account/asset/tx/network components
    app/routes/               # route implementations
  features/
    launchpad/                # future migrated launchpad, feature-flagged
    dex/                      # future only
    prediction/               # future only
```

### Boundary rules

- UI may call only `bridge.send(method, params)` and subscribe to bridge events.
- UI must not import `src/background/**` or `src/lib/vault.js`.
- Background services may import `vault.js`, `thru-client.js`, storage, and shared pure modules.
- Feature modules may depend on shared/domain/application-style services, but never on vault
  internals or raw `chrome.storage` keys.
- New blockchain semantics require verified Thru SDK/program APIs or explicit documentation of
  uncertainty.

---

## 9. Migration strategy: Preserve → Abstract → Isolate → Test → Redesign → Extend

### Phase A — Security boundary hardening before new UX work

Purpose: make the backend contract match wallet policy.

1. Keep tests enumerating every signing/destructive/security-setting method.
2. Signing methods now use `auth: 'signing'` and require password re-authentication by default:
   - native send
   - faucet claim
   - account auto-create
   - token deploy before it is re-enabled
3. Move reset confirmation/password policy into the background.
4. Finish splitting security preferences from display preferences by password-gating auto-lock;
   signing re-authentication and whitelist preferences are already under `settings.setSecurity`.
5. Update UI callers to use new methods and remove UI-only assumptions.

Risk: signing UX changes can frustrate users if password prompts are too frequent. Mitigation:
re-authenticate only at the final signing/security-change step and keep password prompts reusable.

### Phase B — Regression test foundation

Purpose: safely support UI refactors.

1. Add jsdom route mount smoke tests for all 14 routes.
2. Assert no mnemonic/private key appears in route text, attributes, URLs, or detached nodes after
   `destroy()`.
3. Assert listener cleanup using disposer instrumentation.
4. Extend DOM sink scan to `src/launchpad/**` or stop bundling launchpad while disabled.
5. Add direct API-router tests for reset/signing/security preference bypasses.

Risk: jsdom dependency/install instability was previously noted. Mitigation: clean partial installs,
pin dependency exactly if added, and keep tests small.

### Phase C — Formal route registry and frontend state

Purpose: reduce global mutable route state without rewriting the UI.

1. Introduce route metadata: path, title, guard, sensitive, layout, nav reachability.
2. Introduce a small store for session/account/accounts/balances/network/pending/preferences.
3. Wire existing bridge events into store updates.
4. Convert routes incrementally from independent load calls to store selectors.
5. Keep bootstrap non-blocking on RPC.

Risk: store bugs can stale every screen. Mitigation: start read-only, use event-driven invalidation,
and retain route-local reload fallbacks until coverage is green.

### Phase D — Domain interfaces and asset abstraction

Purpose: prepare tokens/NFTs without pretending unverified support exists.

1. Add pure domain models for `AccountRef`, `Asset`, `ActivityEntry`, `TransactionDraft`,
   `NetworkConfig`.
2. Add native THRU asset adapter around existing balance calls.
3. Keep token balances returning explicit unsupported until Thru token account reads are verified.
4. Refactor dashboard asset list to consume an asset list containing native THRU only.

Risk: over-abstraction. Mitigation: interfaces should wrap current behaviour and be deleted if they
have no caller.

### Phase E — Component consolidation and UX polish

Purpose: Rabby-class density and clarity with original Thru styling.

1. Fill component gaps only where there is duplication:
   - copyable address
   - search input
   - filter tabs
   - transaction preview card
   - security notice
   - empty/error/skeleton states
   - network status pill
2. Polish current screens in priority order:
   - onboarding/import
   - accounts/account detail
   - dashboard
   - send review/auth lifecycle
   - receive
   - history filters
   - settings
3. Keep the 408×580 popup target but add tab/full-page responsive behaviour.

Risk: visual work can accidentally break flows. Mitigation: one route/component per commit with
build/test before and after.

### Phase F — Launchpad isolation or removal from shipped build

Purpose: prevent a disabled future product from weakening wallet core.

Options:

1. Short-term: stop copying/bundling `src/launchpad/**` while `FEATURE_LAUNCHPAD` is false.
2. Long-term: migrate launchpad under `src/features/launchpad/`, use UI kit DOM builders, use
   verified token seed/symbol contracts, and request signing through password-gated wallet APIs.

Risk: breaking existing token deploy experiments. Mitigation: feature remains disabled until token
program behaviour is verified and tested.

### Phase G — Phase 2+ features only after wallet stability

Do not begin DEX, prediction, dApp connector, NFTs, or hardware/passkey flows until:

- Signing/security auth gaps are closed.
- Route mount tests are green.
- Launchpad is isolated or not shipped.
- Asset abstraction has native THRU covered without fake token balances.
- Thru semantics for the target feature are verified or explicitly stubbed as unsupported.

---

## 10. Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| UI-only password gates for signing/destructive/security operations | Critical/High | Backend-enforced `auth: 'password'` or equivalent direct verification tests. |
| Launchpad is disabled in navigation but still built | High | Exclude from build or migrate into guarded feature module. |
| No automated route mount coverage | High | Add jsdom smoke/security cleanup test before UI redesign. |
| Protocol semantics guessed for token/DEX/dApp features | High | Stop and document uncertainty; use official Thru packages only after verification. |
| Store introduction creates stale global state | Medium | Introduce read-only store first; bridge events + explicit invalidation. |
| Over-engineering through broad folder moves | Medium | Add thin interfaces around existing modules; avoid churn to `vault.js`/`thru-client.js`. |
| Dependency audit/transitive packages drift | Medium | Keep exact pins for SDK/crypto, run `npm audit`, review Thru package changelogs before bumps. |
| Explorer URL pattern unconfirmed | Low | Hide links when unavailable and keep route patterns configurable per network. |

---

## 11. Concrete next change set

The next code change should be small and security-first:

1. Finish remaining audit hardening that is not covered by the F-01 signing fix:
   - unlocked reset without password is rejected
   - auto-lock and broader security preference changes require password auth
   - disabled launchpad is removed from the build or migrated to the guarded DOM kit
2. Keep signing APIs on `auth: 'signing'`: password is required by default, and the Settings
   opt-out is itself password-gated.
3. Run full `npm test && npm run build` after each small security change.

Only after that should the jsdom route mount test and state/store refactor begin.

---

## Phase report

```text
PHASE: Step 0–4 planning baseline and migration map
FILES ADDED: docs/MIGRATION_MAP.md
FILES MODIFIED: none
BACKEND CHANGES: none
UI CHANGES: none
SECURITY IMPACT: no runtime change; documents critical auth-boundary work to do first
TESTS: npm test -> PASS after npm install
BUILD: npm run build -> PASS after npm install
KNOWN LIMITATIONS: no live Thru verification in this phase; Rabby used only as architecture/UX reference; route rendering still not covered by automated tests
NEXT PHASE: Phase A — backend-enforced password gates for signing, reset, and security settings
```
