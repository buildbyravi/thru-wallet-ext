# AGENTS.md

Rules for any agent working in `thru-wallet-ext`. Read this first, then `CONTEXT.md`.

## What this is

Chrome MV3 self-custody wallet for the **Thru L1** blockchain (devnet/alphanet). Vanilla ES modules
bundled with esbuild. No framework. Real `@thru/sdk` (including its `@thru/sdk/crypto` subpath) + `@thru/programs`.

## Documents

| Read when | File |
| --- | --- |
| always — rules, commands, traps | `AGENTS.md` (this file) |
| docs map / avoid stale context | `docs/DOCS_INDEX.md` |
| past, present, future build tracking | `docs/PROJECT_LEDGER.md` |
| "what's done, what's next?" | `docs/STATUS_AND_ROADMAP.md` — **start here for active work** |
| "where is X?" | `CONTEXT.md` — file-by-file map with `file:line` refs |
| feature separation / SDK-adapter boundaries | `docs/MODULE_BOUNDARIES.md` |
| AI-agent/MCP safety | `llms.txt`, then `docs/MCP_AGENT_INTEGRATION.md` |
| "has this broken before?" | `docs/DEFECT_LOG.md` — every defect, root cause and lesson |
| product intent, security policy, QA matrix | `docs/BUILD_SPEC.md` |
| backend capability tiers | `docs/BACKEND_GAPS.md` |
| historical rebuild plan only | `docs/UI_REBUILD_PLAN.md`, `docs/UI_REBUILD_AGENT_PROMPT.md` |
| archived, do not follow for current state | `docs/archive/` |

Conflict resolution: `STATUS_AND_ROADMAP.md` wins on **current engineering state**;
`PROJECT_LEDGER.md` wins on **phase/build tracking**; `MODULE_BOUNDARIES.md` wins on
**future feature separation**; `BUILD_SPEC.md` wins on **product/security behaviour**;
`CONTEXT.md` wins on **file facts**; `DOCS_INDEX.md` wins on **which doc to trust**.

## Commands

```
npm install
npm run build      # node build.mjs -> dist/
npm test           # guards (derivation, layering, CSP, routes, launchpad quarantine, contract, dom, route lifecycle) then vault, thru-client, api-router
```

Load `dist/` unpacked via `chrome://extensions` -- Developer mode -- Load unpacked.

Run `npm run build && npm test` **before and after** every change. Never report success while either
is red. Never weaken or skip a test to make it pass.

## Hard rules

1. **Never edit `dist/`.** It is generated and gitignored. Edit `src/`.
2. **`src/lib/vault.js` and `src/lib/thru-client.js` are sacred.** Crypto, keyrings, RPC shapes,
   instruction layouts. Change only for a verified bug or a tested additive primitive, and only
   with `test-vault.mjs` / `test-thru-client.mjs` passing.
3. **One seam between UI and backend:** `bridge.send(method, params)`. Only `src/ui/bridge.js`
   (legacy) and `src/ui/app/bridge.js` (new) may call `chrome.runtime.sendMessage`; only
   `src/background/services/event-service.js` may push events back. UI never imports
   `src/background/**` or `src/lib/vault.js`.
4. **Backend API is append-only.** Add the method to `src/shared/contract/manifest.js` *and*
   `api-router.js` -- `test-contract.mjs` checks both directions. Never rename or reshape an
   existing method; add a new name and retire the old one after zero references remain.
5. **No new dependencies except first-party Thru packages.** Use `@thru/sdk` (including its
   `@thru/sdk/crypto` subpath) and verified `@thru/programs/*` surfaces instead of hand-written
   protocol code. No React/Vue/Tailwind, no build-system change. Every Thru SDK/program version
   must be pinned exactly.
6. **Money is BigInt only.** Use `src/shared/format.js`. Never `parseFloat(x) * 1e9`.
7. **All DOM is built with `src/ui/kit/dom.js` `h()`.** `innerHTML`, `insertAdjacentHTML` and
   `outerHTML` anywhere in `src/**` (outside `src/popup/vendor/`) fail the build outright. The
   injection ratchet is at 0 and must stay there -- it now covers the whole shipped runtime, not
   just `src/ui/**`, because the one directory left outside it was where the sinks survived.
8. **No inline `style=""` or `on*=""` attributes.** The CSP is `default-src 'none'` with no
   `unsafe-inline`, so both are refused by the browser. CSSOM (`el.style.x = y`) and DOM
   properties (`el.onerror = fn`) are fine.
9. **Secrets never touch** URLs, `location.hash`, router params or history, `data-*` attributes,
   `localStorage`, `sessionStorage`, `window`, or `console.*`. Clear them on lock, on navigate
   away, and in `destroy()`. Use `src/shared/refs.js` to name an account in a URL.
10. **Password re-authentication is required by default** before export, signing,
    security-setting changes, keyring add/rename/remove, and reset. Signing has a user-visible
    session-only opt-out, but changing that opt-out is itself password-gated. Use
    `requirePassword()` from `src/ui/domain/password-prompt.js`.
11. **Every component returns `{ el, update, destroy }`** and `destroy()` removes the *same*
    handler references it added. Use `disposer()`; a fresh arrow passed to
    `removeEventListener` removes nothing.
12. **Delete the old copy in the same commit** as the replacement. This codebase is in its
    current state because that rule was not followed.
13. **Small commits.** Never mix a security fix + a UI redesign + a new feature.

## Stop and ask instead of guessing

Thru program semantics, transaction wire formats, fee units, token standards, signing behaviour,
explorer URL patterns, dApp provider standards. A product decision. A test that would need
weakening. Introducing a second router, a second store, or a second way of building DOM.

**Do not fabricate protocol behaviour.** For a wallet, a wrong guess loses funds.

## Traps that will waste your time

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
  Verified on alphanet: claiming 10000 credits exactly 10000 base units.
- **A transfer recipient must already exist on-chain.** Accounts this wallet creates are
  registered automatically; an external never-used address cannot receive.
- **Never hand-roll a program instruction or address derivation.** `@thru/programs` ships them.
  A hand-rolled mint derivation called a non-existent SDK method and threw for months.
- **`chrome.storage.session` holds the unlocked session.** It survives a page reload but not an
  extension reload. Run `system.diagnostics` before blaming auto-lock.
- **Hand-maintained file lists rot.** `test-contract.mjs` walks directories for exactly this
  reason -- its old static list stopped covering new files and let a phantom method through.
- **`test-route-lifecycle.mjs` mounts every route, but not in a browser.** It drives the real
  Router, guards, bridge and kit against a hand-rolled DOM shim with only
  `chrome.runtime.sendMessage` mocked, in all three vault states, and asserts teardown, focus
  trapping and secret hygiene. It cannot see layout, real focus rings, canvas output or the side
  panel. Those are `docs/MANUAL_SMOKE_CHECKLIST.md`, and it is a required runbook, not a nicety.
  jsdom is deliberately not a dependency (Hard rule: no new deps).

## Reporting

After each unit of work:

```
WHAT CHANGED:        files added / modified / deleted
BACKEND DELTA:       new API methods, or "none"
LEGACY DELETED:      files / lines / CSS, or "none"
TESTS:               <command> -> PASS/FAIL (+counts)
BUILD:               PASS/FAIL
MANUALLY VERIFIED:   what you actually clicked
KNOWN GAPS:
NEXT:
```

Do not claim something is tested unless you ran the test. Do not claim something is verified against
Thru unless it was actually verified against Thru.
