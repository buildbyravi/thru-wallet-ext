# Traps that will waste your time

Referenced from `AGENTS.md`. Every entry here cost real debugging time in this repository. Read it
before you conclude a fix "did not work".

# Traps that will waste your time

**Reload the extension, not just the popup.** Chrome caches the service worker, so reopening the
popup runs new UI against old backend code. Use the **Reload** button on the extension card.
This made an already-fixed serialization bug appear to persist.

**Money is BigInt internally and a STRING on the wire.** Chrome messaging serializes with JSON
and `JSON.stringify` throws on BigInt, which Chrome reports only as `Could not serialize
message.` `api-router.js` now names the offending method and field itself. If you see Chrome's
bare version, the failure is in the **request** direction.

**The build only WARNS on CSS syntax errors**, it does not fail. Check for `---- [WARNING]`.

- **There is ONE UI stack.** The legacy `show()`/`#screen-*` tree is deleted. Screens are routes
  in `src/ui/app/routes/`, registered in `src/ui/app/boot.js`.
- **`src/background.js` is deleted.** The service worker is `src/background/index.js`.
- **`src/launchpad/**` is deleted, not flagged.** The legacy Launchpad/DEX/Predictions page, its
  `?launchpad=1` override, its dashboard banner and its `innerHTML`/fake-quote code are gone, and
  `test-launchpad-quarantine.mjs` fails the build if any of it returns. Do not "temporarily"
  re-enable it: a launchpad comes back as a new `src/features/launchpad/**` module per
  `docs/MODULE_BOUNDARIES.md`, with that test updated deliberately in the same PR.
- **`removeEventListener` with a fresh arrow function removes nothing.** This killed dashboard
  buttons permanently after one navigation in the old stack. Always use `disposer()`.
- **Do not ship a control before its destination route exists.** `scripts/check-routes.mjs`
  fails the build on it, in both directions.
- **A test can assert a bug.** `generateMintSeed` had a test demanding a 32-character seed when
  the SDK requires 64 hex, which would have blocked the correct fix. Check what a test is
  protecting before trusting it.
- **Amount units differ by screen on purpose.** Faucet takes BASE UNITS; Send takes whole THRU.
  Verified on alphanet (2026-09-26, same managed programs betanet runs): claiming 10000 credits credited exactly 10000 base units.
- **A transfer recipient must already exist on-chain.** Accounts this wallet creates are
  registered automatically; an external never-used address cannot receive.
- **Never hand-roll a program instruction or address derivation.** `@thru/programs` ships them.
  A hand-rolled mint derivation called a non-existent SDK method and threw for months.
- **`chrome.storage.session` holds the unlocked session.** It survives a page reload but not an
  extension reload. Run `system.diagnostics` before blaming auto-lock.
- **Hand-maintained file lists rot.** `test-contract.mjs` walks directories for exactly this
  reason -- its old static list stopped covering new files and let a phantom method through.
- **`TxReviewCard` fires `onChange({ canConfirm })` from its constructor.** Declare the gated
  confirm button BEFORE constructing the card and let the card drive it. Listening for DOM
  `change` events, or re-validating the facts yourself, recreates the duplicated-review bug the
  card exists to delete. Also never recover an amount from `review.summary` label text.
- **`test-route-lifecycle.mjs` mounts every route, but not in a browser.** It drives the real
  Router, guards, bridge and kit against a hand-rolled DOM shim with only
  `chrome.runtime.sendMessage` mocked, in all three vault states, and asserts teardown, focus
  trapping and secret hygiene. It cannot see layout, real focus rings, canvas output or the side
  panel. Those are `docs/MANUAL_SMOKE_CHECKLIST.md`, and it is a required runbook, not a nicety.
  jsdom is deliberately not a dependency (Hard rule: no new deps).
- **A green suite says nothing about layout.** Following from the point above: the shim has no
  layout engine, so `overflow`, `max-height`, flex shrinking and scrollability are all invisible
  to it. Where an invariant CAN be expressed against the stylesheet text, assert it there --
  `test-route-lifecycle.mjs` now checks that any flex-column scroll container pins its children
  against `flex-shrink`, because that specific bug reached a user. Everything else needs eyes on
  a browser (Hard rule 14).
