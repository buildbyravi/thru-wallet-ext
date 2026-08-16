# AGENTS.md

Rules for any agent working in `thru-wallet-ext`. Read this first, then `CONTEXT.md`.

## What this is

Chrome MV3 self-custody wallet for the **Thru L1** blockchain (devnet/alphanet). Vanilla ES modules
bundled with esbuild. No framework. Real `@thru/sdk` + `@thru/crypto`.

## Documents

| Read when | File |
| --- | --- |
| always — rules, commands, traps | `AGENTS.md` (this file) |
| "where is X?" | `CONTEXT.md` — file-by-file map with `file:line` refs |
| product intent, security policy, QA matrix | `docs/BUILD_SPEC.md` |
| target directory layout, phase/commit plan | `docs/UI_REBUILD_PLAN.md` |
| doing the UI rebuild | `docs/UI_REBUILD_AGENT_PROMPT.md` |
| historical only, do not follow | `docs/archive/` |

Conflict resolution: `UI_REBUILD_PLAN.md` wins on **structure**; `BUILD_SPEC.md` wins on
**behaviour**; `CONTEXT.md` wins on **current facts**.

## Commands

```
npm install
npm run build      # node build.mjs -> dist/
npm test           # test-vault.mjs && test-thru-client.mjs && test-api-router.mjs
```

Load `dist/` unpacked via `chrome://extensions` → Developer mode → Load unpacked.

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
   `api-router.js` — `test-contract.mjs` checks both directions. Never rename or reshape an
   existing method; add a new name and retire the old one after zero references remain.
5. **No new dependencies.** No React/Vue/Tailwind. No build-system change.
6. **Money is BigInt only.** Use `src/shared/format.js`. Never `parseFloat(x) * 1e9`.
7. **New code builds DOM with `src/ui/kit/dom.js` `h()`.** No `innerHTML` anywhere under
   `src/ui/**` or `src/features/**` — the layering check enforces a ratchet that may only
   shrink. Legacy templates that still interpolate must use `src/shared/escape.js`.
8. **No inline `style="…"` or `on*="…"` attributes.** The CSP is `default-src 'none'` with no
   `unsafe-inline`, so both are refused by the browser. CSSOM (`el.style.x = y`) and DOM
   properties (`el.onerror = fn`) are fine.
9. **Secrets never touch** URLs, `location.hash`, router params or history, `data-*` attributes,
   `localStorage`, `sessionStorage`, `window`, or `console.*`. Clear them on lock, on navigate
   away, and in `destroy()`. Use `src/shared/refs.js` to name an account in a URL.
10. **Password re-authentication is required** before export, signing, security-setting changes,
    keyring add/rename/remove, and reset. Use `requirePassword()` from
    `src/ui/domain/password-prompt.js`.
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

- **`src/popup/screens/` is mostly not what runs.** The live UI is `src/popup/popup.js` +
  `src/popup/popup.html`. Twelve of twenty screen modules never mount. Verify reachability first.
- **`src/ui/router.js:133` does `container.innerHTML = ''`** on `#screen-<id>`, destroying
  `popup.html`'s static markup for welcome / unlock / dashboard at startup. Editing that markup may
  have no visible effect.
- **`src/background.js` is dead.** The service worker is `src/background/index.js`.
- **`removeEventListener` with a fresh arrow function removes nothing.** Six sites do this.
- **Inline `on*` attributes injected via `innerHTML` are silently blocked by CSP** — six
  `onsubmit="return false;"` and one `onerror=` currently do nothing.
- **Multi-seed already exists in `src/lib/vault.js:322-382` and is unexposed.** `api-router.js` has
  no `keyring.*` namespace. Check `CONTEXT.md` §4 before building anything account-related.
- **Secret export is unreachable by any click path.** Not a missing feature — a broken one.
- **Most of `src/` is untracked in git.** Commit before refactoring so rollback exists.

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
