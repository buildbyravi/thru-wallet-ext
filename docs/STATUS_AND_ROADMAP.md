# Status and roadmap

Single source of truth for **where the rebuild is** and **what happens next**.
Last updated: contract v7 quarantines legacy custom networks at the background boundary.

Companion docs: `docs/DOCS_INDEX.md` (which doc to trust) · `docs/PROJECT_LEDGER.md` (past/present/future build tracking) · `CONTEXT.md` (file map) · `docs/MODULE_BOUNDARIES.md` (feature separation) · `docs/DEFECT_LOG.md` (every defect + lesson) · `docs/BACKEND_GAPS.md` (capability tiers) · `docs/BUILD_SPEC.md` (product spec)

---

## 1. Where we are

### The frontend rebuild is DONE

One stack. `FLAGS.NEXT_UI` is `true`, the legacy tree is deleted, and there is no fallback path
left. All 14 routes are real:

```
/welcome  /unlock  /dashboard  /accounts  /account  /add-account  /keyring
/export   /send    /receive    /faucet    /history  /settings     /reset
```

Structural properties now enforced by CI rather than by discipline:

| Property | Enforced by |
| --- | --- |
| No `innerHTML` anywhere in `src/` | `check-layering.mjs` — **0 sinks, ratchet closed, whole runtime** |
| No launchpad/DEX/prediction surface in `src/`, flags, routes or `dist/` | `test-launchpad-quarantine.mjs` |
| One file per direction across the seam | `check-layering.mjs` sendMessage allowlist |
| UI never imports vault/background | `check-layering.mjs` import rules |
| Every navigated route exists | `check-routes.mjs` |
| Every registered route is reachable | `check-routes.mjs` |
| Every CSS class used is defined | `check-routes.mjs` |
| Contract agrees in both directions | `test-contract.mjs` |
| Key derivation cannot change silently | `test-derivation.mjs` |
| Nothing unserializable crosses the port | `test-api-router.mjs` |
| Custom endpoints cannot become active, including by direct API call or stale storage | `test-api-router.mjs` + `test-route-lifecycle.mjs` |

### Verified green

```
npm run build     clean, no warnings, dist/ wiped and reproduced: popup.html + 2 bundles
npm test          derivation 16 · layering 58 files / 0 sinks · routes 14/14 · CSS 123/123
                  launchpad quarantine 45 · contract 56 · dom+refs 89 · route lifecycle 694
                  vault · thru-client · api-router
npm audit --omit=dev
                  found 0 vulnerabilities
```

### Recent security hardening

- F-01 signing auth is fixed in the background contract. `tx.send`, `tx.claimFaucet`,
  `tx.autoCreateAccount`, and `token.deploy` use `auth: 'signing'`.
- Signing re-authentication is required by default and is verified inside `api-router` before a
  signing handler runs.
- Users can explicitly opt into session-only signing from Settings, but that opt-out is itself
  password-gated via `settings.setSecurity`.
- Generic `settings.set` rejects signing/whitelist security keys.
- Contract v6 hardens `wallet.reset`: typed confirmation is always required, and password is required when the wallet is unlocked.
- Contract v6 hardens `system.setAutoLock`: auto-lock changes are password-gated, including `Never`.
- Contract v7 refuses `network.setActive` for custom endpoints in the background and heals stale
  custom/disabled selections to the default before `configureNetwork()` can bind them.
- F-04 is closed by deletion: the legacy launchpad/DEX/prediction page no longer exists, is not
  built, and cannot be re-enabled by URL, flag or control (`test-launchpad-quarantine.mjs`).

### Verified against a live chain

Confirmed on alphanet, not assumed:

- **Amount units.** The faucet field is raw base units — claiming 10000 credited exactly 10000.
  This was the highest-value unknown in the project.
- **Program addresses and instruction layouts** for faucet and transfer both execute.
- **Transfer fee is 1 base unit**, measured. Now per-network config, `null` where unmeasured.
- **History decoding** returns `sent` / `faucet` with amounts, and reports `success: false`.
- **Accounts register on creation**, so faucet works on a brand-new wallet with no dashboard
  visit (`scripts/verify-autoregister.mjs`, 5/5).
- **End-to-end through `api-router`** — the same seam `bridge.send()` uses — 19/19
  (`scripts/verify-live-e2e.mjs`).

### Not verified

- **Browser rendering remains manual.** The lifecycle shim mounts every route, but cannot prove real
  popup/side-panel layout, focus rings, canvas output, extension reloads, or service-worker eviction.
  Run `docs/MANUAL_SMOKE_CHECKLIST.md` before merging UI changes.
- **Lock-on-refresh is unresolved.** Run `system.diagnostics` and read `sessionPresent`. `false`
  right after a refresh means the session store is not persisting — a platform difference, since
  the reported browser is Comet rather than Chrome — and not auto-lock firing. The two need
  opposite fixes.
- **Token transfer does not exist.** See Step 2.

---

## 2. What to do next, in order

Steps 1, 2, and 2b are complete and kept here as the security/reliability record. Remaining steps
are independent follow-ups; custom-network re-enablement stays blocked on all four preconditions.

### Step 1 — quarantine legacy launchpad — DONE

What was removed, and what deliberately was not:

1. `src/launchpad/launchpad.js` (552), `launchpad.html` (443), `launchpad.css` (1,057) deleted.
   With them go the `innerHTML`/`insertAdjacentHTML` rendering of token names, tickers, mint
   addresses and explorer URLs, the `parseFloat()` + hard-coded `23.5294` swap quote, the
   `setTimeout` "Execute Swap On-Chain" button, and the simulated prediction orders.
2. `build.mjs` no longer bundles or copies a launchpad page, and now wipes `dist/` first so a
   stale `dist/launchpad.html` cannot survive in an existing checkout. `dist/` ships exactly one
   page (`popup.html`) and two bundles.
3. The `?launchpad=1` override, `FEATURE_LAUNCHPAD` and `FEATURE_TOKEN_DEPLOY` are gone from
   `src/shared/flags.js`; the dashboard `.launchpad-banner` control (the tree's only
   `chrome.tabs.create`) and its 62 lines of CSS are gone with it, plus `#toast-container`/
   `.toast*` (50 lines) that only the launchpad toast helper filled.
4. `src/popup/icons.js` and `src/popup/toast.js` deleted — `launchpad.js` was their only importer.
5. The DOM-sink ratchet in `check-layering.mjs` widened from `src/ui/**` + `src/features/**` to
   all of `src/` (vendor excluded), because the directory left outside the ratchet is exactly
   where the sinks survived. 0 sinks, and now nothing can hide.
6. `test-launchpad-quarantine.mjs` added to `npm test` (45 checks): tree deleted, no source or
   manifest reference, flags inert, no route/control, zero sinks, and a real build whose `dist/`
   is scanned by filename and by content. Verified to fail when the surface is restored.
7. NOT touched: vault, signing, RPC/instruction construction, and token semantics. The backend
   `token.*` contract methods stay — the contract is append-only, and `token.deploy` remains
   available to a future feature module. No DEX, swap, launchpad, perp or prediction feature was
   built in this cleanup.

### Step 2 — route lifecycle test  ← DONE (`test-route-lifecycle.mjs`)

This was the largest remaining test gap: `check-routes.mjs` proves a route is *reachable* and its
classes are *defined*; nothing proved it *mounts*. All three requirements are now asserted, for all
14 routes, in no-vault / locked / unlocked states (694 checks, ~1–2s):

1. mount through the real Router, guards, bridge and kit, and assert no throw plus the landing path
   the guard actually specifies;
2. walk the rendered tree for a seeded mnemonic, private key or password and assert none appears in
   text, in any attribute, in any dataset value, in any input value, or in the URL/history — and
   none survives in the subtree a destroyed route hands back;
3. assert teardown removes every listener: no handler survives on any element that is no longer in
   the document, and `router.stop()` returns document/window listeners to their baseline.

Item 2 matters because the old stack wrote a mnemonic into `grid.dataset.raw` and never removed it.
The test found one live instance of item 3 failing: `reset.js` built its `PageHeader` inline and
discarded the instance, so the back button's click listener outlived the screen. Fixed and now
guarded.

**jsdom was deliberately not added.** The hard rule is no new dependencies, the house style is
already a hand-rolled shim (`test-ui-dom.mjs`), and the shim only needs the DOM surface this
codebase actually touches. Only `chrome.runtime.sendMessage` is mocked; every response shape was
read from the service that really produces it.

What a shim still cannot prove is browser behaviour: layout at real widths, real focus rings, canvas
output, the side panel, service-worker eviction, the clipboard permission prompt. That is
`docs/MANUAL_SMOKE_CHECKLIST.md`, and it is a required runbook before merging UI changes.

### Step 2b — custom-network decision  ← DONE (contract v7 quarantine)

The original UI withdrawal was incomplete: a saved legacy row still called `network.setActive`, and
the background accepted it. Because custom records carry no verified transfer/token program ids,
`thru-client` would silently use Alphanet defaults against the custom endpoint.

Contract v7 closes that path at the security boundary:

- `network.setActive` accepts enabled built-ins only. A saved custom id returns permanent
  `CUSTOM_NETWORK_DISABLED`; direct bridge/message calls cannot bypass Settings.
- every active-network read rewrites a custom, disabled, or unknown stored id to the default before
  `configureNetwork()` runs, including the `system.bootstrap` path of a fresh MV3 worker;
- `network.list` marks legacy custom records `selectable: false` with a reason; Settings renders an
  inert, `aria-disabled` row whose only action is Remove;
- `network.upsertCustom`/`removeCustom` remain declared for compatibility and record cleanup.

Re-enabling still needs all four of: an HTTPS-only policy with an explicit localhost exception,
narrow user-granted host permission, a verified per-network capability record instead of silent
defaults, and password re-auth plus a warning before the wallet talks to a user-supplied endpoint.
API-router and lifecycle tests cover direct rejection, startup healing, inert UI, and removal.

### Step 3 — feature-module quarantine before DeFi expansion

Before adding real launchpad, DEX, prediction, chart, or portfolio behavior, follow
`docs/MODULE_BOUNDARIES.md`:

1. keep launchpad, DEX, and prediction in separate namespaces;
2. keep feature UI separate from feature backend;
3. introduce thin `src/lib/thru/*-adapter.js` wrappers around official Thru SDK/program surfaces;
4. use transaction intents for any mutating feature so the shared signing gate remains central;
5. treat `docs/MCP_AGENT_INTEGRATION.md` as intent/read-only planning, not permission for agents
   to sign or export secrets.

### Step 4 — token transfer

`@thru/programs/token` is installed and provides everything needed:
`createTransferInstruction`, `createInitializeAccountInstruction`, `deriveTokenAccountAddress`,
`parseTokenAccountData`.

Thru keeps a wallet account separate from its per-mint token accounts, so a transfer needs both
sides to have an initialized token account — the same "recipient must be activated" shape already
handled for native sends.

This turns two things honest at once: the asset selector's `not sendable` state becomes genuinely
sendable, and `token.getBalances` (BACKEND_GAPS C1) stops returning `supported: false`.

Also replace the hand-rolled `encodeInitializeMintInstructionData` with
`createInitializeMintInstruction` while in there.

### Step 5 — dependency pin cleanup

Completed in the 2026-09-18 audit pass: `@thru/programs` and `@thru/sdk` are exact-pinned at
`0.3.16`, and derivation imports from the SDK's public `@thru/sdk/crypto` subpath rather than
the deprecated standalone crypto package. Golden vectors remain unchanged; `npm ci` is the CI
install gate.

### Step 6 — spacing and the tab-width question

Width is **fixed at 408px** on `body`; height is auto above a 580px floor. Correct for a popup,
wrong when `popup.html` is opened in a tab for testing, where the 408px body leaves the viewport
blank to the right. One media query lets the working surface widen when it is not in a popup.
Do the section-spacing pass at the same time.

### Step 7 — a future launchpad (nothing ships today)

The legacy surface is **deleted**, not flagged: `src/launchpad/**`, its `?launchpad=1` override,
its dashboard banner, and `popup/icons.js` + `popup/toast.js` (whose only importer it was). See
Step 1 for the record and `test-launchpad-quarantine.mjs` for the enforcement.

A launchpad returns only as a new `src/features/launchpad/**` module with `launchpad.*` backend
namespaces, guarded DOM, real quotes from a verified AMM/indexer, and its own tests — the shape
in `docs/MODULE_BOUNDARIES.md`, informed by the retained research in `docs/LAUNCHPAD_UX_STUDY.md`,
`docs/LAUNCHPAD_DEX_MIGRATION_UX.md` and `docs/THRU_NATIVE_DEFI_TAB_UX.md`.

Note `token.deriveAddress` needs a mint authority and a 64-hex-character seed; the deleted
deploy form predated both, and its `mintSeed` was `Math.random().toString(36)` — one of the
reasons deletion was chosen over migration.

### Step 8 — remaining chain questions

1. **Explorer route patterns** `/tx/` and `/account/` — convention, unconfirmed. Worst case a
   dead link.
2. **Whether the transfer fee scales** with amount or transaction size. One observation only,
   which is why the reserve sits 1000x above it.
3. **Whether an external unregistered recipient can ever receive.** The sender cannot register an
   account it holds no key for, so `tx.send` reports `RECIPIENT_NOT_ACTIVATED`. Worth confirming
   with the Thru team whether that is intended protocol behaviour.

### Step 9 — feature modules

`src/features/<id>/` + one registry line + its own backend namespace, per `BUILD_SPEC.md` §3.
`@thru/programs` also ships **`clob`** and **`oracle`** alongside `amm`, which are directly
relevant to perps and prediction markets.

The wallet core is **not** a feature. Accounts, send, receive, history and settings are the
product and stay in `routes/`. Only genuinely optional surfaces go in `features/`.

### Step 10 — dApp integration boundary: hosted wallet, not extension provider

The current official [Thru wallet overview](https://thru.org/docs/wallet/overview/) and
[embedded integration guide](https://thru.org/docs/wallet/embedded-wallet-integration/) describe
`@thru/wallet` / `@thru/wallet/react` connecting a web app to the hosted iframe at
`https://wallet.thru.org/embedded`. The documented `connect()`, `getSigningContext()`, and
`signTransaction()` methods are part of that hosted-wallet lifecycle: the wallet approves and signs,
and the dApp submits the returned raw bytes separately. They do not, by themselves, establish an
extension-compatible provider contract or a bring-your-own-signer path.

This extension therefore has no dApp connector today. Do not inject `window.thru`, copy the hosted
iframe protocol, or add provider permissions based only on the existence of those SDK methods. A
future connector is blocked until Thru publishes and we validate an extension/BYO-signer contract
covering origin discovery, permissions, approval transport, signing ownership, and submission
semantics. Internal interfaces may be prepared; no provider implementation should ship ahead of
that verification.

---

## 3. Debugging notes that will save time

**Reload the extension, not just the popup.** Chrome caches the service worker, so reopening the
popup runs new UI against old backend code. This made an already-fixed serialization error appear
to persist and cost a full diagnostic round trip.

**`Could not serialize message.` is self-diagnosing now.** `api-router.js` checks every payload
before returning and names the method and field path. If Chrome's bare version ever appears
again, the failure is in the **request** direction.

**The build only warns on CSS syntax errors.** Check for `▲ [WARNING]`.

**`npm test` runs guards first** — derivation, layering, routes, contract, dom — so structural
breakage fails fast before the slower integration suites.

**Live verification scripts are under `scripts/` and are NOT part of `npm test`.** They report
against a real node rather than asserting, and use throwaway in-memory keys that never touch a
real vault: `verify-live-e2e`, `verify-autoregister`, `verify-chain`, `measure-fee`,
`diagnose-faucet`, `probe-transfer-*`.

**Install the docs skill.** `npx skills add https://thru.org/docs`. Reading one docs page fixed
three token bugs that had absorbed significant probing effort.

---

## 4. Standing invariants

Each was earned by a defect in `docs/DEFECT_LOG.md`.

1. New DOM is built with `kit/dom.js` `h()`. The sink ratchet is at **0** and must stay there.
2. The contract is append-only and tested in both directions, except documented security breaks:
   contract v5 moved existing signing methods to `auth: 'signing'`; contract v6 hardened reset
   and auto-lock requirements; contract v7 refuses custom-network activation and heals stale ids.
3. Sensitive operations are `auth: 'password'` or `auth: 'signing'`, re-verified against the
   encrypted blob when password auth is required — never against session state.
4. Secrets never enter URLs, router params, history, `data-*`, storage, `window` or `console`.
5. Money is BigInt internally and a **string** on the wire. Never both in one object.
6. `destroy()` removes the same handler references it added. Use `disposer()`.
7. No inline `style="…"` or `on*="…"`. CSSOM and DOM properties are fine; attributes are refused
   by the CSP.
8. Unverified chain behaviour returns `{ supported: false, reason }`. Never a fabricated number.
9. Anything network-specific belongs in the network config, not a module constant.
10. Do not ship a control before its destination exists — `check-routes.mjs` now enforces this.
11. A test that asserts current behaviour may be asserting a bug. `generateMintSeed` had one.
