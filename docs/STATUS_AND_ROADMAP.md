# Status and roadmap

Single source of truth for **where the rebuild is** and **what happens next**.
Last updated: end of the frontend rebuild session (13 commits, `e77f3af`..`5d15758`).

Companion docs: `AGENTS.md` (rules) · `CONTEXT.md` (file map) · `docs/DEFECT_LOG.md` (every
defect + lesson) · `docs/BACKEND_GAPS.md` (capability tiers) · `docs/BUILD_SPEC.md` (product
spec) · `docs/UI_REBUILD_PLAN.md` (original phase plan)

---

## 1. Where we are

### Verified green

```
npm run build     clean, no warnings
npm test          layering (79 files, 4 rules) · contract (34, both directions)
                  dom+refs (89) · vault · thru-client · api-router (+13 serialization probes)
```

### Not verified

- **Nothing has been confirmed against a running chain.** Devnet is offline.
- **No route has been rendered in a browser by an automated test.** All UI confirmation so far
  came from the user manually testing, which found 9 defects my suite could not.

### Frontend migration state

Two stacks coexist. `FLAGS.NEXT_UI` in `src/shared/flags.js` selects which renders; it is
**`false` by default**, so the shipping experience is still the legacy UI. Force the new stack
for a session with `popup.html?next=1`.

| Route | State | Replaces |
| --- | --- | --- |
| `#/unlock` | ✅ new stack | `screens/unlock.js` + static markup |
| `#/dashboard` | ✅ new stack | `screens/dashboard.js` + `popup.js loadDashboard` |
| `#/accounts` | ✅ new stack | `components/account-switcher.js`, `renderAccountsList` |
| `#/account?ref=` | ✅ new stack | `screens/account-detail.js` (was **dead**) |
| `#/add-account` | ✅ new stack | `screens/add-key.js`, `screens/import.js` |
| `#/keyring?id=` | ✅ new stack | nothing — new capability |
| `#/export?ref=` | ✅ new stack | `screens/export-*.js` (was **unreachable**) |
| send | ⛔ legacy | — |
| receive | ⛔ legacy | — |
| faucet | ⛔ legacy | — |
| history | ⛔ legacy | — |
| settings | ⛔ legacy | — |
| welcome / onboarding | ⛔ legacy | — |

Unmigrated hashes fall through to `legacyFallback`, which delegates to
`handleAction('go-<screen>')` so the legacy screen is **hydrated**, not merely revealed. The two
DOM trees swap visibility; both are never shown at once.

### Backend state

Contract v4, **71 methods**, append-only, verified in both directions by `test-contract.mjs`.

Complete and tested: multi-seed keyrings (create/import/rename/remove/backup-state), HD preview
and batch add, per-account private key export, password re-verification, unlock backoff,
inactivity auto-lock, address book, preferences (order/pin/hide/whitelist), batched + cached
balances, push events, pending-transaction tracking, custom networks, token registry.

Deliberately unimplemented, returning `{ supported: false, reason }` rather than fabricated
values: `tx.estimateFee`, `tx.simulate`, `token.getBalances`. See `docs/BACKEND_GAPS.md` Tier C.

---

## 2. What to do next, in order

### Step 1 — jsdom route smoke test (before any more routes)

**Highest value item in this document.** It closes the three gaps that produced most of the
defects the user found manually.

Add `jsdom` as a dev dependency and `test-ui-routes.mjs` that, for every route in
`POPUP_ROUTES`:

1. mounts it with a mocked bridge in **locked**, **unlocked** and **no-vault** states and
   asserts no throw;
2. asserts every CSS class the route uses is defined somewhere in `src/popup/styles/**`
   (this alone would have caught ~80 undefined-class usages);
3. walks the rendered tree for `[data-*]` attributes and text content matching a seeded
   mnemonic or private key, asserting neither appears;
4. asserts every route is **reachable** — that some other route or the shell contains a control
   navigating to it, and that no control navigates to a path absent from the route table.

Item 4 is the one that matters most: shipping a gear button before its route existed, and
leaving four finished routes with no click path, were both connectivity failures.

Note: `npm install jsdom` timed out once in this environment and left a corrupt partial
`node_modules/jsdom` with only a `lib` directory. If it fails, remove that directory before
retrying.

### Step 2 — migrate `#/send`

The only flow that moves money, and it carries known hazards:

- The global Enter handler clicks the first enabled `.btn.primary` in the visible screen. On the
  send preview that is **Sign & Broadcast**. Use `kit/confirm-slider.js` (specified, not built)
  or an explicit opt-in, never a bare Enter.
- Merge validation from both copies: the module has a zero-amount guard the monolith lacks; the
  monolith has an inline error surface the module lost. `checkRecipientAddress` is
  character-identical in both, so one can simply be deleted.
- Amounts are BigInt-only via `shared/format.js`. `tx.send` already validates address, amount,
  self-transfer, whitelist and duplicate submission in the background, so the UI cannot weaken
  those.
- Surface `tx.estimateFee`'s `supported: false` honestly instead of printing a guessed fee.
- Show pending state from `tx.getPending` after submit.

### Step 3 — migrate receive, faucet, history, settings

Mechanical by comparison. Settings should expose the preferences and custom-network methods that
already exist with no UI, and fix the auto-lock label to say what it now truthfully does.

### Step 4 — migrate welcome / onboarding

Route the new-wallet flow into `#/export?mode=backup` so a generated phrase is confirmed before
use, matching the path `add-account` already takes.

### Step 5 — flip the flag, then delete

Set `NEXT_UI: true`. Then, and only then, delete `src/popup/screens/**`,
`src/ui/components/**`, `src/ui/router.js`, `src/ui/store.js`, `src/ui/events.js`, the static
`#screen-*` markup in `popup.html`, the `handleAction` switch, `NEXT_UI_REDIRECTS`,
`LEGACY_LOADERS`, and the flag itself.

Expected result: the DOM-sink ratchet in `check-layering.mjs` reaches **0** and the baseline map
becomes empty.

### Step 6 — chain verification (needs devnet)

Blocking on a live network, in priority order:

1. **The amount-unit question.** The faucet field takes raw base units; Send takes human-scale
   THRU. Both are reasoned, neither is confirmed. If reversed, the fix is contained to
   `parseThruAmount()` and the faucet input. **Highest-value verification available.**
2. Faucet and transfer program addresses and instruction layouts — reverse-engineered, not
   sourced from Thru docs.
3. Explorer `/tx/` and `/address/` route patterns.
4. Whether transfers carry a non-zero fee, which unblocks `tx.estimateFee` (Tier C2).
5. Token Program account reads, which unblock `token.getBalances` (Tier C1) and turn the asset
   list into a real one rather than a launchpad registry.

### Step 7 — feature modules

Only after Step 5. `src/features/<id>/` + one registry line + its own backend namespace, per
`docs/BUILD_SPEC.md` §3. Launchpad, DEX, perps, prediction markets. `enabled: false` must remove
a feature completely.

---

## 3. Debugging notes that will save time

**Reload the extension, not just the popup.** Chrome caches the service worker. Reopening the
popup runs new UI against old backend code — this made a fixed serialization error appear to
persist and cost a full round trip to diagnose. Use the **Reload** button on the extension card
in `chrome://extensions`.

**`Could not serialize message.` is now self-diagnosing.** `api-router.js` checks every payload
before returning and names the method and field path, e.g. *"network.getActive returned data
that cannot cross the message port: data.faucetMaxPerClaim is a BigInt (10000n)"*. If you ever
see Chrome's bare version again, the failure is in the **request** direction, not the response.

**The build only warns on CSS syntax errors.** It does not fail. Check the build output for
`▲ [WARNING]`.

**`npm test` runs guardrails first** (`check-layering`, `test-contract`, `test-ui-dom`) so
structural breakage fails fast before the slower integration suites.

**Flag overrides are dev-only and one-way.** `?next=1` and `?debug=1` can turn a flag on, never
off, and are never persisted.

---

## 4. Standing invariants

Do not regress these; each was earned by a defect in `docs/DEFECT_LOG.md`.

1. New DOM is built with `kit/dom.js` `h()`. The sink ratchet may only shrink.
2. The contract is append-only and tested in both directions.
3. Sensitive operations are `auth: 'password'`, re-verified against the encrypted blob — never
   against session state.
4. Secrets never enter URLs, router params, history, `data-*`, storage, `window` or `console`.
5. Money is BigInt internally and a **string** on the wire. Never both in one object.
6. `destroy()` removes the same handler references it added. Use `disposer()`.
7. No inline `style="…"` or `on*="…"`. CSSOM and DOM properties are fine; attributes are refused
   by the CSP.
8. Unverified chain behaviour returns `{ supported: false, reason }`. Never a fabricated number.
9. Delete the legacy copy in the same commit as its replacement.
10. Do not ship a control before its destination exists.
