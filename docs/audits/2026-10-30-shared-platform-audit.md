# Shared-platform audit — the Domain notification and the duplication behind it (2026-10-30)

Scope: the owner's shared-platform directive of 2026-10-30. The reported symptom was an oversized,
nearly empty black notification bar on the Domain screen. The directive is explicit that the bar is
not a CSS bug to be hidden: it is the entry point to an audit of which capabilities already have one
authoritative implementation, which are duplicated, and which are missing.

Class: **source audit + deterministic probe + deterministic tests**. No browser binary exists in this
environment (`libnspr4`/`libnss3` absent), so no pixel or real-extension evidence is claimed anywhere
below; layout consequences are derived from the stylesheet and are labelled as such. No live-chain
call was made.

Branch/head: `arena/0439c226-thru-wallet-ext` at `0cb010b`. Baselines recorded before any edit:

| Gate | Result |
| --- | --- |
| `npm install` | ok |
| `npm run build` | exit 0 |
| `npm test` | exit 0 — **2,481** `ok -` checks, 0 failures (35 suites + 5 gates) |

## 1. Root cause of the Domain notification — verified, not inferred

`src/ui/kit/toast.js` exports `toast({ tone, title, message, duration, action })`. Three call sites in
the Domain route pass a **bare string** instead:

| File:line | Call |
| --- | --- |
| `src/ui/app/routes/name.js:257` | `toast('Domain imported' \| 'Removed from this wallet' \| 'Primary name updated')` |
| `src/ui/app/routes/name.js:867` | `toast('Transaction confirmed')` |
| `src/ui/app/routes/name.js:912` | `toast('Primary name updated')` |

Every other caller in the tree (4 in `dashboard.js`, 1 in `domain/token-drawer.js`) passes the
documented object. The three Domain calls are the only ones that do not.

A string argument is destructured into the defaulted parameter object, so `tone` falls back to
`info`, and `title` and `message` are both `''`. The element is still built and appended. Probe, using
the real module and the repository's DOM shim (`test/fixtures/dom-shim.mjs`) — the toast rendered by
`toast('Transaction confirmed')`:

```text
<BODY>
  <DIV class="toast-host">
    <DIV class="toast.toast-info.open">
      <SPAN class="toast-icon"> <SVG>…</SVG>
      <DIV class="toast-body">            <- no children at all
      <BUTTON class="toast-close"> <SVG>…</SVG>
```

`textContent` of the rendered toast is `""`.

Why that is a big, empty, black bar rather than nothing:

- `.toast` paints `background: var(--ink)` — the wallet's near-black ink token — and `border-radius`,
  padding `10px 10px 10px 12px`; the tallest child is the 22px close button, so the empty bar is
  ~42px tall. Nothing collapses, because the icon chip (20px) and the close button are always
  present: the component always has content, it just has no *message*.
- `.toast-host` is `position: fixed; left: 12px; right: 12px; bottom: 14px`, so the bar spans the
  whole popup width and floats over the connection footer. In a 400×600 popup that is ~42px of
  full-width near-black chrome — about 7% of the viewport — carrying zero information.
- `.toast-body { flex: 1 }` pushes the close button to the far edge, which maximises the empty run.

So the empty message area is a **call-site type error**, and the vertical space is the toast
component's own padding plus its always-present affordances. The bar is the *notification* system
doing exactly what it was told: "show a notification with no text".

Two structural facts made this possible and are the real defect:

1. `toast()` renders a container even when it has neither a title nor a message. It never had a guard,
   so a malformed call degrades silently into chrome instead of failing.
2. Nothing tests the toast component. `grep -rn "toast" test/` found exactly one use: a
   `dismissAllToasts()` cleanup call inside `test-route-lifecycle.mjs`. No suite asserted that a toast
   with no message is never rendered, that tones exist, that timers/listeners are released, or that
   the documented call shape is the one in use.

This is the same failure pattern recorded in `docs/DEFECT_LOG.md` §14: a green suite that never
covers the primitive, so a wrong call shape is invisible.

## 2. Existing shared capabilities (find first, do not rebuild)

| Capability | Authoritative owner | State |
| --- | --- | --- |
| Node factory (the XSS boundary) | `src/ui/kit/dom.js` `h()` | complete; `innerHTML` banned tree-wide |
| Transient notifications | `src/ui/kit/toast.js` | exists, under-tested, no `pending` tone, no dedupe, no resolution API |
| Persistent inline state | `src/ui/kit/feedback.js` `Banner` | used by all 15 routes (65 `banner.set` sites) |
| Empty / loading states | `src/ui/kit/feedback.js` `Empty`, `Spinner` | used by 8 routes |
| Bottom sheet + focus trap | `src/ui/kit/sheet.js` `Sheet` | used by `security-sheet.js`, `token-drawer.js`, `review` sheet |
| Buttons, copy affordance | `src/ui/kit/button.js` (`Button`, `IconButton`, `CopyButton`) | `CopyButton` is the shared copy primitive |
| Fields + field errors | `src/ui/kit/field.js` | shared |
| Tooltips | `src/ui/kit/help-tooltip.js` | shared |
| Amount parsing/formatting | `src/shared/format.js` | single owner; **zero** `parseFloat`/`toFixed` in `src/` outside it |
| Address shortening | `src/shared/format.js` `truncateAddress` | exists, but bypassed in 5 places (§3) |
| Transaction review pipeline | `tx.prepareReview` → `review-card.js` → `tx.confirmReview` → `confirm.js` | one pipeline, enforced by `test-tx-review.mjs` [14] |
| Decoder registry | `src/shared/tx-review/registry.js` + `decoders/` | one table, guarded in [0] |
| Network/account state | `bridge.send('network.getActive')` (9 sites), `account.getActive` (11 sites) | deliberately not cached in the UI: the bridge is the seam, each route binds its own reads to its own lifecycle |
| Error classification (review path) | `src/ui/domain/tx-review/confirm.js` `classifyReviewError` | shared for every reviewed operation |

The wallet core is therefore **not** missing a shared platform; it has one. The defect is that the
notification primitive is not *complete* (no blank-message guard, no pending state, no resolution, no
dedupe, no production teardown) and not *tested*.

## 3. Duplicated implementations found

| Capability | Copies | Where | Verdict |
| --- | --- | --- | --- |
| Address truncation | **6** | `shared/format.js:95` (8…6), `routes/name.js:28` (chars…chars), `domain/account-avatar.js:50` (6…6 + `title`/`aria-label`), `domain/token-drawer.js:51` (6…6), `domain/tx-review/review-card.js:84` (8…6), `shared/tx-review/decoders/domain-record.js:38` (inline 12…) | **Consolidate.** Same operation, six behaviours, one of them inside a decoder (a display concern in the review model). |
| Signature shortening | 1 | `domain/tx-card.js:125` (4…4) | Not an address; keep the call site, implement on the shared helper. |
| Clipboard write | 2 | `kit/button.js:155` (`CopyButton`), `routes/receive.js:111` (inline "Copied" affordance on the address box) | **Keep both, state why.** The receive box swaps its own label to "Copied"; it is an affordance, not a button. Both surface failure. |
| Clipboard read (paste) | 2 | `routes/send.js:354`, `domain/token-drawer.js:245` | Same one-line API, different screens; a wrapper adds nothing today. Recorded, not merged. |
| Bottom-sheet scaffold | 2 remaining | `domain/password-prompt.js:131`, `domain/tx-detail-sheet.js:263` build `.modal-overlay` + `focusTrap` by hand | **Documented follow-up.** `kit/sheet.js` header names these two. Not migrated in this pass (see §6). |
| Tone vocabulary | 3 | toast `success\|info\|warning\|error`; `Banner` `error\|warning\|<anything else → neutral>`; routes pass `'ok'` (`name.js:868`) and `'danger'` (7 sites, CSS class only) | **Consolidate the notification end**: one tone set, unknown tones rejected loudly instead of silently downgraded. |
| Inline informational panels | 7 | `export.js`, `faucet.js`×2, `reset.js`, `send.js`, `review-card.js`×2 build `.notice` blocks | Legitimate static layout panels, not notifications. Not merged. |
| Error taxonomy | 2 | `classifyReviewError` (review path), `classifyFaucetError` (`lib/ratelimit.js`) | Different taxonomies over different backends (vault/auth vs faucet rate limit). Merging them would be "merging what looks similar". Not merged. |

Stale reference found: `src/ui/kit/sheet.js:12` cites `docs/06_MODULAR_REUSE_AUDIT.md`, which does not
exist in this tree. Corrected to point at this record.

## 4. Missing shared capabilities

1. **A toast that cannot render blank.** No guard, no test.
2. **A pending state.** Requirement 3 names success/error/warning/info/pending. `toast()` has no
   pending tone and no way to resolve a toast in place, so "submitting…" can only be a Banner.
3. **Resolution/dedupe.** Repeated events (`toast('Primary name updated')` twice) stack two identical
   bars up to `MAX_VISIBLE`; nothing can key a toast to replace its predecessor.
4. **Production teardown.** `dismissAllToasts()` is exported and used **only by a test**. No route
   change, lock, or network switch clears the host, so a success toast survives the screen that
   produced it and a locked wallet can still be showing wallet content.
5. **Notification tests.** None for the component.

## 5. Contracts that must remain compatible

- `toast({ tone, title, message, duration, action })` object shape — 5 existing call sites.
- `Banner({tone, message})` and `.set(message, tone)`, `.clear()`, `.destroy()` — 65 call sites.
- `truncateAddress(address)` output (8…6) — 4 call sites (`send.js`, `tx-card.js`,
  `tx-detail-sheet.js`×3).
- `AddressText({address, chars})` — 4 call sites; it also feeds `title` and `aria-label`.
- The review pipeline, the decoder registry and the background contract are untouched by this pass.
- No backend method is added, renamed or reshaped by this pass. Backend delta: none.

## 6. Migration sequence (this pass vs deferred)

Phase B — notification foundation (this pass):
`kit/toast.js` gains a blank-message guard, a `pending` tone, in-place `update()`, `key` dedupe,
a `dismissAllToasts()` that is actually called (lock + network switch), and a test suite. The three
Domain call sites stop passing strings.

Phase C — first representative migration (this pass): Domain is the migrated feature — its three
toasts, its success Banner tone, and its local address truncation all move onto the shared
implementations. Send, Activity and the token drawer then adopt the shared address helper in the same
change (mechanical, same output for their current arguments).

Phase D — enforcement (this pass): a `test/test-shared-platform.mjs` that fails if a second address
truncation, a second clipboard write, or a second toast host reappears; plus the documented usage
rules in `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.

Deferred, with reasons (recorded so they are not mistaken for oversights):

- **`password-prompt.js` / `tx-detail-sheet.js` → `Sheet`.** Mechanical but layout-bearing
  (`.modal-card` height, scroll container, focus ring). Hard rule 14 requires a real browser before
  shipping an overlay layout change; this environment has no browser binary, so migrating them here
  would be an unverifiable layout change to a security-sensitive prompt.
- **Route-level error taxonomy unification.** Two different backends, two different vocabularies.
- **A shared "async staleness" helper.** Every route re-implements `destroyed` + `seq` guards, but
  they differ in what they must protect (paint vs sign vs submit). A generic helper would hide the
  security-relevant cases; left as-is deliberately.

## 7. What this record does not claim

No browser pass, no popup-dimension verification, no live-chain behaviour. The Domain bar's *height*
is derived from the stylesheet, not measured on screen. "Fixed" below means the call site no longer
produces an empty message and the component refuses to render one.

## 8. What shipped (same day, five commits)

Hashes are the ones on `arena/0439c226-thru-wallet-ext` after rebasing onto the owner's `46682e2`
(the pre-rebase equivalents were `05f1134`/`8072dd8`/`512ecdc`).

| Commit | Scope |
| --- | --- |
| `98a04d9` | The notification foundation and the Domain migration: blank-message guard, string shorthand, `pending` + `handle.update()`, `key` dedupe, `dismissAllToasts()` wired to lock/account/network, `Banner` success tone, the three Domain call sites, `test/test-toast.mjs` |
| `d3843df` | One truncation primitive (`shortenMiddle`/`shortAddress`, `truncateAddress` as an alias), six call sites migrated with their existing widths, `test/test-shared-platform.mjs` (45 checks) |
| `6cea7ab` | This record, `docs/DECISIONS.md` D-018, `docs/ARCHITECTURE.md` "Shared UI platform", `docs/DEFECT_LOG.md` §16, `CONTEXT.md` file map, `docs/AUDIT_REPORT.md` refresh, and the stale `06_MODULAR_REUSE_AUDIT.md` citation in `kit/sheet.js` |
| `67475c7` | Two edges the first pass left: `update({ action: null })` now removes a button that is already on screen (the guard tested the merged state, so a stale "Undo" stayed clickable), and the entrance frame no longer re-opens a toast dismissed in that same frame. `test-toast.mjs` 89 → 92 |
| `d6f3e3f` | The Domain submit path opens its toast as `pending` and resolves the same bar in place with the real outcome (confirmed / outcome-unknown / dismissed), including on route teardown |

State after the pass: `npm run build` exit 0; `npm test` exit 0 — **2,618** `ok -` checks, 0 failures
(37 suites + 5 gates), `test-toast.mjs` 92/92, `test-shared-platform.mjs` 45/45,
`test-route-lifecycle.mjs` 1,113/1,113, `test-tx-review.mjs` 175/175, `test-tx-review-card.mjs` 46/46.

The Domain screen is the migrated feature, as the directive asked: its three notifications are
events on the shared surface with a tone, a message and a dedupe key; its success banner uses the
success state instead of a silently-dropped `'ok'`; its address shortening is the shared helper.

Its registration/renewal submission now also uses the lifecycle states, which is why `pending`
exists at all: the toast opens as `pending` ("Submitting…", spinner, no expiry) and is resolved in
place by the outcome that actually happened — `success` ("confirmed", only when the handler
returned an execution result), `warning` ("Outcome unknown — check Activity") when the RPC answer
was lost, and dismissed (leaving the persistent banner to carry the reason) on cancellation, a
stale review or a refusal. The pending bar is also dismissed if the route is torn down mid-submit,
so an unresolvable spinner cannot outlive its screen.
Send, Activity, the token drawer, the review card and the domain-record decoder adopt the same
helper in the same change, with their existing widths preserved.

### 8a. Still duplicated, with the reason

| Duplicate | Where | Why it remains |
| --- | --- | --- |
| Bottom-sheet scaffold | `domain/password-prompt.js:131`, `domain/tx-detail-sheet.js:263` build `.modal-overlay` + `focusTrap` by hand | Overlay layout is unverifiable without a browser (Hard rule 14), and one of the two is the password prompt. Migrating them blind would be an unverified layout change to a security surface. |
| Clipboard write | `routes/receive.js:111` beside `kit/button.js:155` | The Receive box swaps its own label to "Copied"; it is an affordance, not a button, and both surface failure. |
| Clipboard read (paste) | `routes/send.js:354`, `domain/token-drawer.js:245` | One API call each; a wrapper would add indirection without removing a behaviour difference. |
| Diagnostic truncation in background errors | 24 `slice(0, 12)…` sites in `services/` (dex, name) | Thrown-error text, not a rendered row. The display layer is guarded; the background sweep is a separate, test-visible change. |
| Error taxonomies | `classifyReviewError` (vault/auth/review) vs `classifyFaucetError` (faucet rate limit) | Different backends and different vocabularies. Merging them would be merging what only looks similar. |

### 8b. Verification status — precise

- **IMPLEMENTED + TESTED**: the blank-toast guard, string shorthand, five tones, in-place resolution,
  key dedupe, teardown wiring, the tone vocabulary, the truncation primitive and every migrated call
  site, plus all guards. Proven by the two new deterministic suites and the existing 35.
- **UNVERIFIED**: the bar's rendered height and placement in a real popup, and any pixel claim about
  the new `pending` styling. No browser binary exists in this environment. `scripts/preview-toast.html`
  is the harness for that look (400×600 and 380×600 frames, real component, real stylesheet), and it
  has been served successfully but not opened by an agent.
- **NOT CLAIMED**: that every feature uses the shared platform. §8a lists the known exceptions, and
  the guards only cover notifications, truncation, clipboard writes and kit-only imports.
