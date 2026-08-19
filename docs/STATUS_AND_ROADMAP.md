# Status and roadmap

Single source of truth for **where the rebuild is** and **what happens next**.
Last updated: legacy UI deleted, migration complete (`e77f3af`..`c0ba23a`).

Companion docs: `AGENTS.md` (rules) · `CONTEXT.md` (file map) · `docs/DEFECT_LOG.md` (every
defect + lesson) · `docs/BACKEND_GAPS.md` (capability tiers) · `docs/BUILD_SPEC.md` (product
spec) · `docs/UI_REBUILD_PLAN.md` (original phase plan, §1 historical)

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
                  contract 34 · dom+refs 89 · vault · thru-client · api-router
```

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

### Step 1 — jsdom route mount test

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

### Step 2 — token transfer

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

### Step 3 — spacing and the tab-width question

Width is **fixed at 408px** on `body`; height is auto above a 580px floor. Correct for a popup,
wrong when `popup.html` is opened in a tab for testing, where the 408px body leaves the viewport
blank to the right. One media query lets the working surface widen when it is not in a popup.
Do the section-spacing pass at the same time.

### Step 4 — launchpad

Flagged off (`FEATURE_LAUNCHPAD`). Its account/network switcher buttons currently point users at
the popup, and it still uses `popup/icons.js` markup strings rather than `ui/kit/icon.js`.
Migrate it onto the kit when it gets its own testing pass, then re-enable.

Note `token.deriveAddress` now needs a mint authority and a 64-hex-character seed; the launchpad's
deploy form predates both.

### Step 5 — remaining chain questions

1. **Explorer route patterns** `/tx/` and `/account/` — convention, unconfirmed. Worst case a
   dead link.
2. **Whether the transfer fee scales** with amount or transaction size. One observation only,
   which is why the reserve sits 1000x above it.
3. **Whether an external unregistered recipient can ever receive.** The sender cannot register an
   account it holds no key for, so `tx.send` reports `RECIPIENT_NOT_ACTIVATED`. Worth confirming
   with the Thru team whether that is intended protocol behaviour.

### Step 6 — feature modules

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
2. The contract is append-only and tested in both directions.
3. Sensitive operations are `auth: 'password'`, re-verified against the encrypted blob — never
   against session state.
4. Secrets never enter URLs, router params, history, `data-*`, storage, `window` or `console`.
5. Money is BigInt internally and a **string** on the wire. Never both in one object.
6. `destroy()` removes the same handler references it added. Use `disposer()`.
7. No inline `style="…"` or `on*="…"`. CSSOM and DOM properties are fine; attributes are refused
   by the CSP.
8. Unverified chain behaviour returns `{ supported: false, reason }`. Never a fabricated number.
9. Anything network-specific belongs in the network config, not a module constant.
10. Do not ship a control before its destination exists — `check-routes.mjs` now enforces this.
11. A test that asserts current behaviour may be asserting a bug. `generateMintSeed` had one.
