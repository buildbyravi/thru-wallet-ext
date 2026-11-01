# AGENTS.md

Rules for any agent working in `thru-wallet-ext`. Read this file, then `CONTEXT.md`.

This file is an INDEX plus the hard rules. Detail lives in on-demand files so the rules stay short
enough to be read every time:

| File | Holds |
| --- | --- |
| `docs/agent/engineering-directive.md` | the full engineering directive, architecture/compatibility invariants, transaction & signing invariants, delivery and security-review rules |
| `docs/agent/rules-detail.md` | the full text of hard rules 10, 14, 15, 16, 17 |
| `docs/agent/traps.md` | the traps that cost real debugging time here |
| `docs/agent/rule-matrix.md` | where every former section of this file went |

**A rule without a check is a wish.** Each rule below names the gate that enforces it, or says
`review` when nothing mechanical exists — that gap is deliberate information, not an omission.

## What this is

Chrome MV3 self-custody wallet for the **Thru L1**. Alphanet was the earlier single-node network;
Betanet is the current/final-testnet stage; Mainnet is the target. Vanilla ES modules bundled with
esbuild. No framework. Real `@thru/sdk` (incl. its `@thru/sdk/crypto` subpath) + `@thru/programs`.

Production software: engineer every key, transaction and persisted state as though it already
belongs to a Mainnet user — Betanet is a deployment stage, not permission for temporary security,
architecture or storage. Full text: `docs/agent/engineering-directive.md`.

**Architecture freeze (2026-10-04):** the wallet core has converged — exact SDK pins with golden
vectors, one UI/backend seam, network-scoped state, checked signing with the network-mutation lock,
versioned storage, secret hygiene, strict CSP, launchpad quarantine, one UI stack, route/lifecycle
coverage. Do not accept an architectural refactor without a measurable security, correctness,
performance or maintainability benefit that names the failure it prevents, the duplication it
removes, or the boundary it improves — and the test that proves it. The priority is verification
(real browser, live chain, races, external audit), not restructuring.

## Status vocabulary

Use precisely: **IMPLEMENTED, TESTED, VERIFIED AGAINST LIVE NETWORK, UNVERIFIED, PARTIALLY
IMPLEMENTED, BLOCKED, PLANNED, DEPRECATED, SECURITY REVIEW REQUIRED, EXTERNAL AUDIT REQUIRED.**
Never claim verification that did not occur; never describe a plan as shipped. A green Node suite
is never browser evidence and never live-chain evidence. Do not use “community build”,
“prototype”, “testnet only”, “temporary implementation” or “not for real funds” as an excuse unless
factually necessary.

## Read before you touch

| If you touch | Read first |
| --- | --- |
| anything | `docs/STATUS_AND_ROADMAP.md` (current state), `CONTEXT.md` (file map) |
| architecture, a new module, a new store/router/bridge | `docs/ARCHITECTURE.md`, `docs/MODULE_BOUNDARIES.md`, `docs/agent/engineering-directive.md` |
| signing, transactions, review | `docs/agent/rules-detail.md` (rules 10, 16), `docs/TX_REVIEW_VERIFICATION.md`, `docs/audits/2026-10-30-review-lifecycle-audit.md` |
| storage, migration, persisted state | `docs/agent/engineering-directive.md`, `test/test-storage-migrations.mjs` |
| layout, sheets, overlays, CSS | rule 14 (`docs/agent/rules-detail.md`), `docs/MANUAL_SMOKE_CHECKLIST.md`, `docs/DEFECT_LOG.md` §11 |
| contracts, on-chain programs | `docs/GLOBAL_SMART_CONTRACT_POLICY.md`, `contracts/*/README.md` |
| docs | `docs/DOCS_INDEX.md` — it owns the read order, the three document classes, and the anti-sprawl rules |

Conflict resolution: `STATUS_AND_ROADMAP.md` wins on **current engineering state**;
`PROJECT_LEDGER.md` on **phase/build tracking**; `MODULE_BOUNDARIES.md` on **future feature
separation**; `BUILD_SPEC.md` on **product/security behaviour**; `CONTEXT.md` on **file facts**;
`DOCS_INDEX.md` on **which doc to trust**.

## Commands

```
npm install
npm run build      # node build.mjs -> dist/
npm test           # guards (layering incl. cycles, CSP, routes, CSS, contract, docs truth, dom)
                   # then the feature suites; see package.json for the exact chain
node scripts/git-push.mjs   # push using GITHUB_TOKEN from .env
```

Suites live in `test/` (`test/test-*.mjs`); `npm test` runs them by path. Load `dist/` unpacked via
`chrome://extensions` → Developer mode → Load unpacked.

Run `npm run build && npm test` **before and after** every change; never report success while either
is red and never weaken or skip a test to make it pass.

**Git push invariant:** push with `node scripts/git-push.mjs`; a plain `git push` can hang in a
non-interactive shell waiting for a GUI credential manager.

## Hard rules

1. **Never edit `dist/`.** Generated and gitignored; edit `src/`. — *check:* `dist/` is in
   `.gitignore` and rebuilt by `npm run build`.
2. **`src/lib/vault.js` and `src/lib/thru-client.js` are sacred.** Change only for a verified bug
   or a tested additive primitive. — *check:* `test/test-vault.mjs`, `test/test-thru-client.mjs`.
3. **One seam between UI and backend:** `bridge.send(method, params)`. Only `src/ui/app/bridge.js`
   may call `chrome.runtime.sendMessage`; only `src/background/services/event-service.js` pushes
   events back. UI never imports `src/background/**` or `src/lib/vault.js`. — *check:*
   `scripts/check-layering.mjs` (`single-seam`, `ui-must-not-import-background-or-vault`).
4. **Backend API is append-only.** Add the method to `src/shared/contract/manifest.js` *and*
   `api-router.js`; never rename or reshape one; retire the old name after zero references. —
   *check:* `test/test-contract.mjs` (both directions).
5. **No new dependencies except first-party Thru packages**, pinned exactly; no build-system
   change. — *check:* `test/test-derivation.mjs` (exact pins), `scripts/check-layering.mjs`
   (`@thru/*` confined to `src/lib`). Adding a *new* dependency has no gate — ask first.
6. **Money is BigInt only.** Use `src/shared/format.js`. Never `parseFloat(x) * 1e9`. —
   *check:* `test/test-launchpad-quarantine.mjs` (float-parse scan), `test/test-tx-units.mjs`.
7. **All DOM is built with `src/ui/kit/dom.js` `h()`.** `innerHTML` / `insertAdjacentHTML` /
   `outerHTML` anywhere in `src/**` (outside `src/popup/vendor/`) fail the build; the ratchet is at
   0 and must stay there. — *check:* `scripts/check-layering.mjs` (DOM-sink ratchet).
8. **No inline `style=""` or `on*=""`.** The CSP is `default-src 'none'` with no `unsafe-inline`.
   CSSOM (`el.style.x = y`) and DOM properties (`el.onerror = fn`) are fine. — *check:*
   `scripts/check-csp.mjs` + the layering scan.
9. **Secrets never touch** URLs, `location.hash`, router params, history, `data-*`,
   `localStorage`, `sessionStorage`, `window` or `console.*`. Clear them on lock, on navigate away
   and in `destroy()`. Use `src/shared/refs.js` to name an account in a URL. — *check:*
   `test/test-route-lifecycle.mjs` (`findSecrets` scanner).
10. **Password re-authentication is always required** before export, security-setting changes,
    keyring add/rename/remove and unlocked reset. Signing is unlocked-by-default with an opt-in
    per-sign password, and every value-moving method is still `auth: 'signing'` with reviewed
    account/network binding through the ONE signing service. — *check:* `test/test-api-router.mjs`
    (auth matrix); v12 exception + self-signing invariant in `docs/agent/rules-detail.md`.
11. **Every component returns `{ el, update, destroy }`** and `destroy()` removes the *same*
    handler references it added. Use `disposer()`. — *check:* `test/test-ui-dom.mjs`,
    `test/test-route-lifecycle.mjs` (teardown).
12. **Delete the old copy in the same commit** as the replacement. This codebase is in its current
    state because that rule was not followed. — *check:* review.
13. **Small commits.** Never mix a security fix + a UI redesign + a new feature. — *check:* review.
14. **Layout must be SEEN, not reasoned about.** Modals/sheets/drawers/overlays are validated in a
    real browser or a harness loading the real `dist/popup.css` before the PR opens. `npm test` has
    **no layout engine**, so a green suite is not layout evidence. — *check:* none possible in
    Node; `docs/MANUAL_SMOKE_CHECKLIST.md`, `scripts/preview-*.html`, full text in
    `docs/agent/rules-detail.md`.
15. **The frontend never waits on a chain/RPC/backend read before its first paint.** Paint from
    local state or an explicit checking/unknown placeholder, then hydrate and replace; add the
    cached counterpart with every new read and label stale data. — *check:*
    `test/test-route-lifecycle.mjs` (routes paint with every bridge reply stalled).
16. **A value-moving screen goes through the ONE review pipeline; it never signs.**
    `tx.prepareReview` → `review-card.js` → `tx.confirmReview` → `confirm.js`. No feature-owned
    signing screen, fee formatter, warning copy or password flow; a route never calls a signing
    method. A review is single-use, bound to account/network, re-validated at confirm. An
    undecodable transaction is explicit unknown with raw details and `submit: null` — never a
    guessed name, never a submit policy, never signed. Simulation is unavailable, so never render a
    post-transaction balance. — *check:* `test/test-tx-review.mjs` [14] (signing-literal scan,
    registry parity), `test/test-tx-review-card.mjs`; full text in `docs/agent/rules-detail.md`.
17. **No repetitive explanatory/disclaimer essays on review screens or anywhere in the UI.** State
    facts cleanly and objectively (`Fee: 0.00000001 THRU`, `Program: Thru transfer program`) — no
    justification paragraphs, no preaching, no jargon, no file paths, no decision ids. — *check:*
    `test/test-tx-review-card.mjs` (forbidden-term scan); full text in `docs/agent/rules-detail.md`.

## Stop and ask instead of guessing

Thru program semantics, transaction wire formats, fee units, token standards, signing behaviour,
explorer URL patterns, dApp provider standards. A product decision. A test that would need
weakening. Introducing a second router, a second store, or a second way of building DOM.

**Do not fabricate protocol behaviour.** For a wallet, a wrong guess loses funds.

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
