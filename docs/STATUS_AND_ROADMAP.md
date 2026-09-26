# Status and roadmap

Single source of truth for the **shipped baseline**, what automated evidence proves, and the remaining work. Source baseline audited: `main` at `4aa55ba` (2026-09-26). `src/`, `test/`, and `scripts/` remain authoritative.

## Shipped baseline

- **Contract v12, 81 methods.** v12 adds unlocked-only `tx.registerAccount` for an exact vault-owned address and storage-only `tx.getCachedHistory` for cache-first History paint.
- **Account activation.** Account/keyring creation paths make bounded, best-effort self-registration attempts for newly added accounts on the selected network. There is no periodic signer. Send checks an unregistered recipient and calls `tx.registerAccount` just in time only when that destination is an owned account. The target account signs for itself; arbitrary contacts are never registered.
- **Send review.** The JIT activation must complete before Review enables. Review shows the matched recipient label above the full destination address; the label is display-only. Checked native/token methods bind the reviewed account and network at the background boundary.
- **Signing preference.** Signing requires an unlocked wallet. Password re-authentication is **off by default** (`requirePasswordForSigning: false`); a user can explicitly enable it through the password-gated Settings path. The v12 registration exception remains narrowly unlocked-only.
- **History.** One flat stream without day headers; storage-only cache-first paint scoped by network and address; fresh feed/pending reads do not gate the first paint. A known timestamp is sourced from the containing block and stored with `timestampSource: 'block'`; an actual local submission time is only a fallback for the wallet's own send. Otherwise show `Block <slot>` instead of inventing a date. No per-card fee line is shipped.
- **Popup/side panel.** The shared page has a context marker and mutual-exclusion behavior. Side Panel Mode is an explicit opt-in; deterministic tests cover the bridge/settings paths, while real Chrome behavior remains open.
- **Structural hardening.** Layering, CSP, route/CSS, contract, DOM, lifecycle, history, registration, network-cache, and quarantine checks run from `npm test`.

Companion docs: `docs/DOCS_INDEX.md` · `docs/PROJECT_LEDGER.md` · `CONTEXT.md` · `docs/MODULE_BOUNDARIES.md` · `docs/BACKEND_GAPS.md` · `docs/BUILD_SPEC.md` · `docs/MANUAL_SMOKE_CHECKLIST.md` · `docs/SEND_PATH_AUDIT.md`.

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
| No launchpad/DEX/prediction surface in `src/`, flags, routes or `dist/` | `test/test-launchpad-quarantine.mjs` |
| One file per direction across the seam | `check-layering.mjs` sendMessage allowlist |
| UI never imports vault/background | `check-layering.mjs` import rules |
| Every navigated route exists | `check-routes.mjs` |
| Every registered route is reachable | `check-routes.mjs` |
| Every CSS class used is defined | `check-routes.mjs` |
| Contract agrees in both directions | `test/test-contract.mjs` |
| Key derivation cannot change silently | `test/test-derivation.mjs` |
| Nothing unserializable crosses the port | `test/test-api-router.mjs` |
| Custom endpoints cannot become active, including by direct API call or stale storage | `test/test-api-router.mjs` + `test/test-route-lifecycle.mjs` |

### Verified green

Final verification on the documentation-only change (2026-09-26):

```text
npm test       PASS — derivation 16; QR 15; layering 70 files / 0 sinks; CSP pass;
               routes 14/14; CSS nesting pass; launchpad quarantine 47;
               contract 77; DOM/refs 130; route lifecycle 904;
               vault, Thru client, token/balance, History cache/block-time,
               registration, and API-router suites pass.
npm run build  PASS — generated dist/ from the current source.
```

These results are deterministic/local. They do not close the browser or live-chain checks below.

### Recent security hardening

- `tx.send`, `tx.sendChecked`, faucet signing, token transfer, and related signing methods use the background `auth: 'signing'` policy. The wallet must be unlocked; password re-auth is required only when the user enables it in Settings.
- `requirePasswordForSigning` defaults to `false` (session-only while unlocked). Changing this security preference goes through password-gated `settings.setSecurity`; generic `settings.set` rejects security-sensitive keys.
- Contract v12 adds the narrow `tx.registerAccount({ address })` exception: it is unlocked-only, checks exact vault ownership in the background, signs only for that address, and does not transfer value. Never extend this exception to Send, faucet, token transfer, export, or arbitrary recipients.
- Contract v6 enforces reset confirmation and an unlocked-wallet password check; auto-lock changes are password-gated.
- Contract v7 rejects custom network activation in the background and heals stale custom/disabled active IDs before RPC binding.
- Launchpad/DEX/prediction UI was deleted, not merely hidden. The source/build guard keeps it out; backend token methods remain distinct.
- Popup and side panel share one page. The side-panel close listener registers before asynchronous boot; popup open broadcasts to a ready panel and calls Chrome's close API where available. Settings' Side Panel Mode toggle is an explicit user choice and is restored after worker restart only when enabled.

### Historical live-chain observations — native Alphanet scope only

These are prior observations, not certification of the newer v12 registration path or token transfer:

- Faucet amount units were observed as raw base units (a claim of 10000 credited 10000 base units).
- The native THRU transfer path/program and a 1-base-unit Alphanet fee were previously exercised. This does **not** measure the token-program fee.
- Basic native History decoding and an earlier account-creation registration path were exercised. The earlier `scripts/verify-autoregister.mjs` result is not a substitute for a fresh multi-account v12 activation pass.
- An earlier live API-router run completed; it does not certify current browser layout, worker suspension, or the new v12 flows.

### Open: real browser and live-chain checks

Passing `npm test` or `npm run build` does not close any of these:

| Boundary | Still open |
| --- | --- |
| Real Chrome | Popup/side-panel layout and focus at narrow/wide sizes; QR canvas; actual popup/panel mutual exclusion; Settings' toolbar mode; clipboard prompt; MV3 worker eviction/restart and timeouts. Run `docs/MANUAL_SMOKE_CHECKLIST.md`. |
| Live v12 activation | Create several HD accounts on the selected chain and exercise Send JIT for an owned absent recipient. Verify target signer, per-network existence, offline-vs-absent handling, and behavior if MV3 suspends during bounded retries. |
| Live token transfer | Whether a never-registered recipient owner can receive a sender-initialized token account and the actual token-program fee remain unmeasured. Use `scripts/verify-token-transfer.mjs` only with a safe throwaway wallet and network access. |
| History RPC/explorer | Current block-time availability and first-load latency per enabled network; whether an authoritative charged-fee value exists outside the current RPC detail response; and confirmation of the explorer transaction route. |
| Send/pending concurrency | A network switch after the final preflight check but during the mutable SDK signing sequence, and concurrent pending-record read/modify/write races remain open (`docs/SEND_PATH_AUDIT.md`). |
| Session behavior | The reported lock-on-refresh/session-storage behavior still needs checking in the actual target browser. A Node harness cannot distinguish a browser persistence difference from an auto-lock timer issue. |

## 2. What to do next, in order

Steps 1, 2, 2b and 4 are complete and kept here as the security/reliability record. Remaining
steps are independent follow-ups; custom-network re-enablement stays blocked on all four
preconditions.

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
6. `test/test-launchpad-quarantine.mjs` added to `npm test` (47 checks): tree deleted, no source or
   manifest reference, flags inert, no route/control, zero sinks, and a real build whose `dist/`
   is scanned by filename and by content. Verified to fail when the surface is restored.
7. NOT touched: vault, signing, RPC/instruction construction, and token semantics. The backend
   `token.*` contract methods stay — the contract is append-only, and `token.deploy` remains
   available to a future feature module. No DEX, swap, launchpad, perp or prediction feature was
   built in this cleanup.

### Step 2 — route lifecycle test  ← DONE (`test/test-route-lifecycle.mjs`)

This was the largest remaining test gap: `check-routes.mjs` proves a route is *reachable* and its
classes are *defined*; nothing proved it *mounts*. All three requirements are now asserted, for all
14 routes, in no-vault / locked / unlocked states (904 checks in the current audited run):

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
already a hand-rolled shim (`test/test-ui-dom.mjs`), and the shim only needs the DOM surface this
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

### Step 4 — token transfer — SHIPPED in code (v8); live-chain verification OPEN

Built entirely on the official `@thru/programs/token` bindings (`createTransferInstruction`,
`createInitializeAccountInstruction`, `createInitializeMintInstruction`,
`deriveTokenAccountAddress`, `parseTokenAccountData`, `parseMintAccountData`) — the hand-rolled
`encodeInitializeMintInstructionData` is deleted (docs/DEFECT_LOG.md: it could not have matched
the real program, and the deploy path that called it was in fact always throwing on a missing
mint authority).

What shipped:

1. **`token.transfer`** (contract v8, `auth: 'signing'`): sends raw units of the MINT — never
   THRU — from the active account's token account. Same guard discipline as `tx.send`: format,
   amount, self-send, whitelist, mint-aware duplicate window (a native send and a token send
   of the same amount are NOT duplicates). The recipient's token account is initialized by the
   sender in a preceding transaction when missing — program-derived addresses need no recipient
   key, unlike native `RECIPIENT_NOT_ACTIVATED` sends.
2. **`token.getBalances` is real** (BACKEND_GAPS C1 closed): owned balances for every registry
   mint, read through the official parser. Honesty rules kept from the stub era: a missing
   token account is a *proven* zero (explicit `tokenAccountExists: false`, never the number 0);
   a failed read is `error: true` + `amountUnits: null` (unknown, never zero); decimals come
   from the on-chain mint when a balance exists.
3. **UI**: asset selector rows are selectable whenever a balance is known and positive
   (unknown/zero say why, unselectable); the whole send form re-denominates per asset
   (mint-scaled amount parsing via `parseTokenAmount`, MAX, spendable, fee honesty — token
   program fees are declared *unmeasured*, not guessed); review discloses the recipient token
   account creation and its extra THRU fee; the dashboard shows real token balances; history
   decodes token entries (`token-sent`/`token-received`/`token-mint`/`token-account-init`)
   with direction and symbol resolved against the viewer's own token accounts, and
   unresolvable entries lose their raw amount rather than wear the wrong mint.
4. **Tests**: golden 13-byte transfer / 15-byte mint_to wire formats pinned against the
   official binding (the token ABI uses a ONE-byte tag, not the native 4-byte one — measured,
   not assumed); decoder round-trips on real Transaction instances; golden mint/token-account
   derivation vectors; amount parse/format round-trips at any decimal scale; router guards
   fire before any network access; lifecycle mounts exercise a scripted token selection flow.

Open chain questions that need `scripts/verify-token-transfer.mjs` on a network-reachable
machine (moved to Step 8): whether initialize-account tolerates a never-registered recipient
owner, and the actual token-program fee.

### Step 4c — passkey feasibility spike ← DONE (`docs/archive/PASSKEY_SPIKE.md`)

Time-boxed research spike, per the agreed order (spike first, implementation only with concrete
answers). Verdict: **protocol-feasible, implementation-gated.** The pinned
`@thru/programs/passkey-manager` bindings already carry the hard parts — challenge
construction binding nonce + ordered accounts + wallet index + authority index + full target
instruction bytes, a late-bound **index-0 fee payer** (the outer-fee-payer question is answered:
someone else pays — a passkey account is a PDA with no private key and cannot be its own
payer), authority records with expiry for real recovery (ADD/REMOVE_AUTHORITY), and low-S
signature normalization. The earlier brief's "extension has no usable RP ID" claim does not
hold: Chrome 122+ extensions can call WebAuthn against RP IDs covered by host permissions.

Three probes gate any implementation, all answerable by throwaway-key verification scripts
rather than research: (1) which on-chain program **revision** is live (bindings ship legacy and
AuthorityRecord encoders side by side), (2) whether a distinct-account fee payer validates on
alphanet, (3) one live VALIDATE proving extension-origin `clientDataJSON` is accepted. Held
constraints: no keyring branch inside `checkAuth` (the challenge is only constructible after
instruction building, at the tx/passkey service), full `PasskeyMetadata` storage (credentialId,
X/Y, rpId, authIdx — never seed-derived), recovery-authority flow precedes any
seed-replacement messaging, and ceremonies run in an extension tab/side panel rather than the
auto-closing popup. Passkey implementation remains **not started** until the user green-lights
the probe.

### Step 5 — dependency pin cleanup — DONE

Completed in the 2026-09-18 audit pass: `@thru/programs` and `@thru/sdk` are exact-pinned at
`0.3.16`, and derivation imports from the SDK's public `@thru/sdk/crypto` subpath rather than
the deprecated standalone crypto package. Golden vectors remain unchanged; `npm ci` is the CI
install gate.

### Step 6 — spacing and the tab-width question

The toolbar popup is **400px wide** (the shipped `--popup-width` token); it is not a 408px layout. The side panel is user-resizable and the body caps at the available width. The wide-panel presentation and real resize behavior remain a browser check, not a CSS assumption. Keep this item open only for visual review; do not change the popup width without testing both contexts.

### Step 7 — a future launchpad (nothing ships today)

The legacy surface is **deleted**, not flagged: `src/launchpad/**`, its `?launchpad=1` override,
its dashboard banner, and `popup/icons.js` + `popup/toast.js` (whose only importer it was). See
Step 1 for the record and `test/test-launchpad-quarantine.mjs` for the enforcement.

A launchpad returns only as a new `src/features/launchpad/**` module with `launchpad.*` backend
namespaces, guarded DOM, real quotes from a verified AMM/indexer, and its own tests — the shape
in `docs/MODULE_BOUNDARIES.md`, informed by the retained research in `docs/archive/LAUNCHPAD_UX_STUDY.md`,
`docs/LAUNCHPAD_DEX_MIGRATION_UX.md` and `docs/archive/THRU_NATIVE_DEFI_TAB_UX.md`.

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
4. **Whether a token account can initialize for a never-registered owner.** Token transfers
   deliberately probe this: the recipient's token account is program-derived and sender-created,
   but whether the Token Program accepts an owner with no on-chain account is unverified. If it
   does, "receive tokens before touching the chain" works out of the box; if it reverts, the UI
   must pre-refuse the same way native sends do. `scripts/verify-token-transfer.mjs` answers it.
5. **The token-program fee.** Only the NATIVE transfer fee (1 base unit) was ever measured, and
   the send screen says so rather than quoting it for token sends. The verification script
   measures the token fee as part of its run; once known, it belongs in per-network config with
   `environment`-appropriate `source:` provenance, the same shape as `baseFeeUnits`.

### Step 9 — feature modules

`src/features/<id>/` + one registry line + its own backend namespace, per `BUILD_SPEC.md` §3.
`@thru/programs` also ships **`clob`** and **`oracle`** alongside `amm`, which are directly
relevant to perps and prediction markets.

The wallet core is **not** a feature. Accounts, send, receive, history and settings are the
product and stay in `routes/`. Only genuinely optional surfaces go in `features/`.

### Step 10 — dApp integration boundary: hosted wallet, not extension provider

The current official [Thru docs](https://thru.org/docs/) and
[embedded integration guide](https://thru.org/docs/wallet/embedded-wallet-integration/) describe
`@thru/wallet` / `@thru/wallet/react` connecting a web app to the hosted iframe at
`https://app.tid.sh/embedded` (`https://wallet.tid.sh` is the standalone host and sends
`X-Frame-Options: DENY`). The documented `connect()`, `getSigningContext()`, and
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
`diagnose-faucet`, `probe-transfer-*`, `verify-token-transfer`.

**Cross-check protocol behavior with official Thru references.** Start at the
[API/SDK overview](https://thru.org/docs/api-ref/overview/) and the pinned
[`@thru/sdk` docs](https://thru.org/docs/sdks/web-packages/sdk/); the package versions in
`package-lock.json` remain the implementation authority for this checkout.

---

## 4. Standing invariants

Each was earned by a defect in `docs/DEFECT_LOG.md`.

1. New DOM is built with `kit/dom.js` `h()`. The sink ratchet is at **0** and must stay there.
2. The contract is append-only and tested in both directions, except documented security breaks:
   contract v5 moved existing signing methods to `auth: 'signing'`; v6 hardened reset/auto-lock; v7 quarantined custom activation; v8 added token transfer/balances; v9 history feed; v10 detail; v11 checked sends; v12 owned-account registration and storage-only History cache.
3. Sensitive operations use the declared `auth: 'password'` or `auth: 'signing'` policy and are re-verified against the encrypted blob whenever password auth is required. Signing re-auth is opt-in (default false); the only unlocked-only signing exception is v12 `tx.registerAccount` for an exact vault-owned address.
4. Plaintext secrets never enter URLs, router params, history, `data-*`, `window` or `console`. Encrypted vault data and the trusted unlocked-session store are explicit storage boundaries; ordinary persistent storage must not receive decrypted key material.
5. Money is BigInt internally and a **string** on the wire. Never both in one object.
6. `destroy()` removes the same handler references it added. Use `disposer()`.
7. No inline `style="…"` or `on*="…"`. CSSOM and DOM properties are fine; attributes are refused
   by the CSP.
8. Unverified chain behaviour returns `{ supported: false, reason }`. Never a fabricated number.
9. Anything network-specific belongs in the network config, not a module constant.
10. Do not ship a control before its destination exists — `check-routes.mjs` now enforces this.
11. A test that asserts current behaviour may be asserting a bug. `generateMintSeed` had one.
