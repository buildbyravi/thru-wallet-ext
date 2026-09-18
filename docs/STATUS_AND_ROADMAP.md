# Status and roadmap

Single source of truth for **where the rebuild is** and **what happens next**.
Last updated: contract v6 reset/auto-lock hardening.

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
| No `innerHTML` anywhere in the UI | `check-layering.mjs` — **0 sinks, ratchet closed** |
| One file per direction across the seam | `check-layering.mjs` sendMessage allowlist |
| UI never imports vault/background | `check-layering.mjs` import rules |
| Every navigated route exists | `check-routes.mjs` |
| Every registered route is reachable | `check-routes.mjs` |
| Every CSS class used is defined | `check-routes.mjs` |
| Contract agrees in both directions | `test-contract.mjs` |
| Key derivation cannot change silently | `test-derivation.mjs` |
| Nothing unserializable crosses the port | `test-api-router.mjs` |

### Verified green

```
npm run build     clean, no warnings, dist/ reproducible
npm test          derivation 16 · layering 60 files / 0 sinks · routes 14/14
                  contract 54 · dom+refs 89 · vault · thru-client · api-router
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

- **No route has been rendered by an automated test.** Every UI confirmation so far came from
  manual testing, which found 9 defects the suite could not. `check-routes.mjs` closed the
  reachability and CSS half; **mounting is still uncovered** (see Step 1).
- **Lock-on-refresh is unresolved.** Run `system.diagnostics` and read `sessionPresent`. `false`
  right after a refresh means the session store is not persisting — a platform difference, since
  the reported browser is Comet rather than Chrome — and not auto-lock firing. The two need
  opposite fixes.
- **Token transfer does not exist.** See Step 2.

---

## 2. What to do next, in order

### Step 1 — quarantine legacy launchpad

The F-01 signing issue and contract v6 reset/auto-lock hardening are fixed. Next security item before feature expansion:

1. Remove launchpad from the build while disabled or migrate it to the guarded DOM kit and expand
   the DOM-sink ratchet to cover it.
2. Remove the `?launchpad=1` override if launchpad remains unshipped.
3. Do not build DEX, swaps, launchpad, perps, or prediction features in this cleanup.

### Step 2 — jsdom route mount test

The remaining half of the original Step 1. `check-routes.mjs` proves a route is *reachable* and
its classes are *defined*; nothing proves it *mounts*. For each of the 14 routes, with a mocked
bridge, in locked / unlocked / no-vault states:

1. mount and assert no throw;
2. walk the rendered tree for a seeded mnemonic or private key and assert neither appears in text
   or in any attribute;
3. call `destroy()` and assert every listener was removed and no secret survives in the detached
   subtree.

Item 2 matters because the old stack wrote a mnemonic into `grid.dataset.raw` and never removed
it. Note that `npm install jsdom` timed out once here and left a corrupt partial
`node_modules/jsdom` with only a `lib` directory; remove it before retrying.

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

Non-PR cleanup: `package.json` currently allows `@thru/programs` upgrades with `^0.3.4`. Align it
with the repository rule that Thru SDK/program packages are exact-pinned, then run the golden
derivation and Thru-client tests before merging.

### Step 6 — spacing and the tab-width question

Width is **fixed at 408px** on `body`; height is auto above a 580px floor. Correct for a popup,
wrong when `popup.html` is opened in a tab for testing, where the 408px body leaves the viewport
blank to the right. One media query lets the working surface widen when it is not in a popup.
Do the section-spacing pass at the same time.

### Step 7 — launchpad

Flagged off (`FEATURE_LAUNCHPAD`). Its account/network switcher buttons currently point users at
the popup, and it still uses `popup/icons.js` markup strings rather than `ui/kit/icon.js`.
Migrate it onto the kit when it gets its own testing pass, then re-enable.

Note `token.deriveAddress` now needs a mint authority and a 64-hex-character seed; the launchpad's
deploy form predates both.

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
   and auto-lock requirements.
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
