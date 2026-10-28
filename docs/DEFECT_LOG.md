# Defect log

Every defect found while rebuilding the frontend, with its root cause and the lesson. This
exists because most of these were **not** typos — they were failures of a *kind*, and the kind
is what predicts the next one.

Ordered by how much they cost to find, not by severity.

Legend for how each was found:
`TEST` automated · `BROWSER` manual testing by the user · `READ` code reading · `TOOL` a
guardrail script caught it


## Status convention — current as of 2026-10-28

The defects in §§1–4 are **historical**: their old paths and failure descriptions are retained to
explain the fixes, not to claim those paths still ship. §5 records resolved legacy duplication, not
a current backlog. The current verification gaps are listed in §6; the popup/side-panel and History
cross-network fixes in §§7–8 are implemented and locally tested, but their real-Chrome/live-RPC
checks remain open. §9–§12 are v29 review fixes verified in source and the deterministic suite; none
of them has a real-browser pass. Check `src/` before treating any historical symptom as current.

---

## 1. The expensive ones

### 1.1 BigInt at the message port — `BROWSER`

`src/lib/networks.js` declares `faucetMaxPerClaim: 10_000n`. Chrome extension messaging
serializes with **JSON**, and `JSON.stringify` throws on BigInt. Chrome reports this only as
the opaque string `Could not serialize message.` with no method and no field.

Every method returning a network config failed at the port: `network.getActive`,
`network.setActive`, `network.list`, and `system.bootstrap`, which embeds one.

**Why it survived so long:** the legacy `popup.js` wraps its bootstrap call in a `try/catch`
that quietly falls back to individual queries. The visible symptom was a slow start and a dash
instead of a balance — never an error. It had probably been broken for months.

Fix: `toPublicNetwork()` applied **only at the UI boundary**. The BigInt is not removed —
`tx-service` needs the real value for faucet clamping — so internal getters are unchanged.

Guard: `test/test-api-router.mjs` walks 13 real responses for BigInt, functions, symbols, typed
arrays, `Map`/`Set` and cycles, and asserts `faucetMaxPerClaim` survives as a string that
re-widens with `BigInt()`. Additionally `api-router.js` now `JSON.stringify`-checks every
payload before returning and names the offending path.

> **Lesson:** a `try/catch` that falls back silently converts a hard error into a permanent
> mystery. If a fallback fires, say so.
>
> **Lesson:** the boundary between BigInt-native code and JSON transport must be explicit and
> tested. Money is BigInt internally and a string on the wire — never both in the same object.

### 1.2 The migrated routes were unreachable — `BROWSER`

After unlock the new router navigated to `/dashboard`, which had not been migrated, so it fell
through to the legacy tree. From there every control is a legacy `show()` call: the account
pill opened the *old* drawer, export stayed as unreachable as always, and four finished routes
sat in the bundle with nothing linking to them.

I told the user to test them. They could not have worked.

Fix: `NEXT_UI_REDIRECTS` in `popup.js` routes migrated destinations into the new stack, and the
dashboard was subsequently migrated so it is the landing route.

> **Lesson — the most important one here:** every test passed. They verified the routes
> *build*, that their bridge calls *exist*, and that `h()` cannot be exploited. Not one asked
> **"can a user get to this screen?"** Reachability is a property no unit test in this repo
> currently checks, and it is the property that made a whole feature area invisible before.

### 1.3 Falling back revealed screens without loading them — `BROWSER`

`legacyFallback` called bare `show(screenId)`. But `show()` only toggles `.hidden` — the data
comes from the legacy `handleAction` case: `go-receive` fills the address and QR, `go-history`
loads entries, `go-send` resets the form and token, `go-dashboard` hydrates the pill and
balance.

Because `init()` returns early into the new stack, `activeAccount` was never set either. Result:
`Account —` and `— THRU` on the dashboard, and it would have hit Send, Receive, History and
Faucet identically.

Fix: the fallback delegates to `handleAction('go-<screen>')` and hydrates `activeAccount` /
`activeNetwork` first, reusing the legacy logic instead of reimplementing it five times.

> **Lesson:** "show a screen" and "load a screen" were separate operations in the legacy code,
> and I assumed they were one. When bridging two architectures, enumerate what the old one did
> *besides* the obvious thing.

---

## 2. Security defects

| # | Defect | Root cause | Found |
| --- | --- | --- | --- |
| 2.1 | Mnemonic written to `grid.dataset.raw` and never removed, in a document registered as a **side panel** that can live for days | secrets treated as ordinary render data | `READ` |
| 2.2 | Secrets passed as router params; `router.js` pushed params verbatim into history, so the "wipes secret on unmount" comments were false | history retained what the screen cleared | `READ` |
| 2.3 | `case 'lock'` never nulled `pendingExportSecret`, so copy-to-clipboard still worked **after** the wallet locked | lock cleared session state but not UI state | `READ` |
| 2.4 | Recovery phrase stayed on screen during the backup confirmation challenge — answers readable off the grid, so confirmation proved nothing | the challenge was a section, not a step | `BROWSER` |
| 2.5 | `account.addImported` wired to `vault.addImportedKey`, documented in the vault as *the legacy path that skips password verification* | a safer primitive existed and was unused | `READ` |
| 2.6 | No unlock rate limiting anywhere | — | `READ` |
| 2.7 | Auto-lock was a fixed-period alarm while settings called it "lock after inactivity" — it could fire mid-signing and also fail to measure idleness | alarm period mistaken for idle timer | `READ` |
| 2.8 | CSP had no `default-src`, leaving `frame-src`/`img-src`/`connect-src`/`form-action`/`base-uri` unrestricted — an injected iframe would render inside trusted chrome | policy written as an allowlist for one directive only | `READ` |
| 2.9 | Google Fonts fetched on every popup open — a usage/timing oracle for a wallet, plus a CSS-injection vector | convenience over threat model | `READ` |
| 2.10 | ~20 `innerHTML` sinks interpolating token name/ticker/image from **arbitrary on-chain mints**, with no escaping helper in the repo | no safe default for building DOM | `READ` |
| 2.11 | `token-selector.js` serialized whole token objects into `data-token` and `JSON.parse`d them back on click — attacker-controlled data round-tripping through markup with an unguarded parse | markup used as a data channel | `READ` |
| 2.12 | Account labels length-capped only by HTML `maxlength` | client-side validation trusted | `READ` |
| 2.13 | `clipboardRead` missing from permissions while `readText()` was called — Paste silently always failed | — | `READ` |
| 2.14 | Seed/private-key textareas lacked `spellcheck="false"`; with Chrome Enhanced Spell Check the contents are transmitted to Google | a documented exfiltration path, missed | `READ` |
| 2.15 | The password dialog declared `role="dialog"` + `aria-modal="true"` with **no focus trap**: Tab walked into the page behind the overlay, so a user could keep typing a password into a field that was no longer on screen and activate controls they could not see | an ARIA attribute was treated as the mechanism instead of the claim | `READ` |
| 2.16 | Settings offered "Add custom network" for any http(s) endpoint while the manifest CSP allows `connect-src` only to the Thru RPC hosts and localhost, and the network service silently falls back to the DEFAULT transfer/token program ids for a custom network — a saved network could look configured and then build transactions against the wrong programs | a backend capability was surfaced as a feature before its safety design existed | `READ` |
| 2.17 | Removing the Add form left legacy custom rows clickable, and `network.setActive` still accepted their ids directly; UI withdrawal was therefore bypassable and a stale stored custom id could be rebound on worker startup | the UI was mistaken for a security boundary; unsafe state was hidden rather than rejected and migrated | `READ` |
| 2.18 | The vault's KDF work factor (PBKDF2-SHA-256, 600k) lived only in a module constant, so the parameters that derive every wallet's key were a property of the *code*, not of the vault record — a future calibration bump would silently change the derived key and permanently lock every existing vault out (recovery only via the seed phrase), and a lowered constant would weaken every vault without one knowing | encryption parameters are vault state, so they had to be versioned and pinned per-vault | `READ` (external audit) |

Fix for 2.18: the vault record now carries `version: 1` plus a `kdf` envelope
(`{name, hash, iterations}`) written by `encryptVaultData`; every read validates the
envelope *before* any key derivation and fails loudly (unknown KDF / newer version)
instead of masquerading as a wrong password. Re-encrypting an existing vault preserves
its pinned `kdf` — the envelope travels with the record, so a future constant change
affects only new vaults. Legacy records without an envelope fall back to the current
constant and heal to envelope v1 on their first write.

**The structural response**, rather than fixing 20 sites and hoping:

- `src/ui/kit/dom.js` `h()` is the only way to build a node. Text goes through `textContent`.
  `on*` attribute names throw. `javascript:`/`vbscript:`/`file:`/`about:`/`blob:` and non-image
  `data:` URLs are refused, including obfuscated forms. There is no prop that accepts markup.
- `scripts/check-layering.mjs` scans shipped `src/` (vendored QR code excluded) for prohibited
  HTML injection sinks. Current count: zero. The deleted launchpad is also kept out of source and
  `dist/` by `test/test-launchpad-quarantine.mjs`.
- The background enforces each method's declared auth policy: secret export, password-gated
  key/keyring changes, auto-lock, and security-setting changes require a password. `wallet.reset`
  always requires explicit confirmation and also requires a password when the wallet is unlocked;
  ordinary account operations follow their own contract policy. Value-moving transaction signing
  uses `auth: 'signing'` and requires an unlocked wallet, with password re-auth only when the user
  opts in (default false). v12 `tx.registerAccount` is the narrow unlocked-only, exact-owned-address
  exception. `test/test-contract.mjs` guards these declared policies.
- Contract v7 puts custom-network quarantine in `network-service`: direct activation fails with a
  stable, non-retryable code and stale active ids heal before `configureNetwork()`. Settings is a
  presentation of that invariant, not its enforcement point.

> **Lesson:** escaping at call sites is a policy and policies decay at the site nobody
> reviewed. One factory plus one grep is a property.

---

## 3. Silent no-ops — code that looked correct and did nothing

These are the most dangerous category, because reading them gives false confidence.

| Defect | Why it did nothing |
| --- | --- |
| `removeEventListener` with a freshly created arrow function, at **6 sites** | a new function reference matches nothing; listeners were never removed. This is why the dashboard's pill/copy/lock/refresh buttons died permanently after one round trip. |
| `onsubmit="return false;"` on 6 forms | injected via `innerHTML`; inline handlers are blocked by the extension CSP. The forms were never actually prevented from submitting — they only appeared safe because a click handler usually intercepted first. |
| `onerror="this.style.display='none'..."` on token logos | same CSP block. The fallback never fired, so a broken remote image left an empty box. |
| `bridge.onEvent()` | exposed since the first refactor with **zero callers**, and the background emitted nothing. Every screen had to poll or go stale — the direct cause of the balance not refreshing after a faucet claim. |
| `store.subscribe()` and `store.get()` | zero callers, so `notify()` always iterated an empty set. |
| 11 of 24 `Events.*` constants | no producer and no consumer. Eight more were emitted with no subscribers. |
| `refreshActiveAccountAndBalance` writing `#dash-account-name` | the element did not exist in `popup.html`. Adding it later was only half the fix — nothing populated it either. |
| `.w-100`, `.mt-*`, `.tag-accent`, `.status-dot`, `.spinning` at ~80 sites | defined nowhere. With `* { margin: 0 }` and non-flex wrappers, nothing supplied vertical spacing at all. |
| `router.navigate('account-detail')` | `popup.html` had no `#screen-account-detail`, so `if (container)` failed silently and `mount()` never ran. |
| Secret export | `data-action="go-export-password"` existed only *inside* `#screen-accounts`, and every path into that screen required already being inside it. A user could not retrieve their own recovery phrase. |
| `manifest.json` side panel with no in-wallet entry point | The original declaration had no app action. Current shipped behavior: the Dashboard header explicitly opens the panel; Settings has a separate opt-in **Side Panel Mode** toggle that calls `setPanelBehavior` only on user action, and the worker restores the stored choice after restart. A shared-page listener plus the supported direct-close API enforce popup/panel mutual exclusion. Deterministic tests cover message timing and mode state; real Chrome remains open in the manual checklist. |
| `network.upsertCustom` | A contract method with a form, where the form was the unsafe part. Withdrawn from the UI rather than shipped; the method stays because the contract is append-only. |

> **Lesson:** an API with no callers is not "ready for later", it is unverified code that reads
> as working. Delete it or wire it.
>
> **Lesson:** CSP silently neuters inline handlers. Any `on*=` in an extension is dead code.

---

## 4. Defects I introduced, and what caught them

Recording these matters more than the ones I inherited.

| Defect | Caught by | Notes |
| --- | --- | --- |
| `wallet.generateMnemonic` returning a fresh phrase to the UI | `READ` (self, before commit) | Would have put a new secret across the seam with only an unlocked session behind it. Replaced with `keyring.createSeed`, which generates *and* registers in one password-gated call so entropy never leaves the background. |
| `child instanceof Node` in `dom.js` | `TEST` | Ties the check to one realm's constructor: returns false for a valid node from another iframe, and throws where the global is absent. Now duck-types `nodeType`. |
| CSS comment containing `.mt-*/.mb-*` | `TOOL` (esbuild warning) | The `*/` closed the comment early. **Note the build only warns on CSS syntax errors — easy to miss.** |
| Disabling seed reveal to protect the challenge | `BROWSER` | Overcorrection: the challenge rendered immediately, so the phrase could never be read at all. Split into two pages instead. |
| Challenge decoys drawn from the whole phrase **including the correct word** | `BROWSER` | A repeated word made a pick ambiguous, so validation could never succeed and "Confirm backup" stayed disabled. |
| Challenge positions by rejection sampling | `BROWSER` | Could cluster at 0,1,2, making "Word N" read as a question number. Now one per bucket, labelled "Word #N of your phrase". |
| `seedKeyrings[0]` hardcoded in add-account | `BROWSER` | Once a second phrase existed there was no way to derive from it — defeating the entire point of multi-seed. |
| A gear button navigating to `/keyring` before that route existed | `BROWSER` | Fell through to `legacyFallback`, matched no legacy screen, errored on a blank panel. **I shipped a control before its destination.** |
| `test/test-contract.mjs`'s hand-maintained UI file list | `READ` (self) | Had stopped covering new files, which is precisely how the phantom `wallet.generateMnemonic` reached a finished route. Now walks directories. |
| `check-layering.mjs` false positives on comments — **twice** | `TOOL` | First for DOM sinks, then again for imports and the single-seam rule, because I fixed stripping in one place only. The file documenting why `innerHTML` is banned failed the `innerHTML` rule. |
| Base64url padding appended as `'=='` in my own test | `TEST` | — |
| Margin utilities stacking on `.screen`'s gap | `BROWSER` | Defining the missing utilities fixed the flush-together screens but created 16/20/24/28px inconsistency. Resolved by making `gap` the single source of rhythm. |
| `initialSupply` shown in the balance column | `READ` | Inherited, but I carried it forward initially. A mint's total supply is not your balance. |
| `reset.js` built its `PageHeader` inline (`PageHeader({...}).el`) and discarded the instance | `TEST` (`test/test-route-lifecycle.mjs`) | The route's `destroy()` disposed its own listeners and the banner's, but the header's back-button click listener stayed attached to a node that was no longer in the document. Twelve other routes keep their header instance for exactly this reason; this one did not, and nothing caught it until a test counted listeners on detached nodes. |
| `isFocusable()` first checked only the element's own `.hidden` class | `TEST` | This codebase hides sections with a `display:none` utility class on a *parent*, so controls inside a hidden section counted as Tab stops and focus would have gone somewhere invisible — reading to a keyboard user as "Tab stopped working". Now walks ancestors. |
| A synchronous `requestAnimationFrame` in the test shim | `TEST` | The shim ran rAF callbacks inline, which changed ordering the app relies on: `requirePassword` captures the element to restore focus to when it builds its trap, *before* its rAF callback focuses the field. Inline rAF made the trap capture its own input, so focus was "restored" to a detached field. Browsers run rAF after the current task; the shim now queues a microtask. A fidelity bug in a test harness produces false failures that look like product bugs. |
| `knownTokenAccounts` surviving a network switch (PR #6 review) | `READ` | The cache is chain state keyed only by address. Switching networks left it warm, so a send on a fresh chain would have skipped initializing the recipient's token account and reverted on-chain. `configureNetwork` now clears both caches whenever the chain identity changes. The worst of the four findings: silent, cross-network, and money-facing. |
| Review button disabled forever after amount-first typing (PR #6 review) | `READ` + `TEST` | `validateRecipient` mutated `recipientState` asynchronously but nothing re-evaluated the Review gate afterwards — only input handlers did. It survived because the lifecycle suite never exercised the *order* of form interactions. `refreshReviewEnabled` is now route-scoped and runs in a `finally` on every validation completion; the lifecycle test types amount-then-recipient and asserts the button activates (verified to fail pre-fix). |
| Recipient picker discarding a pre-typed amount (PR #6 review) | `READ` + `TEST` | Both picker exits (`onPick` and Back) passed `amount: ''`, clobbering `formState.amount`, because nothing asserted retention through an excursion. The lifecycle test now round-trips both exits with an amount typed and asserts the value survives (verified to fail pre-fix). |
| No sequence guard on async recipient checks (PR #6 review) | `READ` | A slow earlier validation could resolve after a newer one and overwrite both `recipientState` and the status line. Checks now carry a monotonically increasing sequence; stale results return without touching state or DOM, and typing invalidates in-flight work immediately. |
| `.mnemonic-grid span` styling the word's inner span | `BROWSER` (user, first manual run) | The tile rule used a descendant selector but the component nests `<em>` + `<span>` inside each tile — so every word drew its **own** second border inside the tile, sized per word, and the reveals looked like uneven input boxes. Meanwhile the number rule targeted a `<b>` the component has never emitted, so numbers were italic UA default. Selector-vs-DOM drift between kit component and stylesheet: **class-name checks can't see it** — `mnemonic-grid` "existed in CSS" the whole time. Scoped to `> span` with `em` and `> span > span` rules that match the real DOM. Only a rendered pixel catches this class; no guardrail in the repo could. |
| Confirmed sends stuck as "pending" for the whole popup session | `BROWSER` (local agent, manual smoke) | `sendTransfer` waits for on-chain confirmation, then `pending.track()` records SUBMITTED — and `reconcile()` was only called from bootstrap and unlock, so nothing settled the record while the popup stayed open. History rendered the transaction **twice**: confirmed in the list, and "Waiting for confirmation" in Pending. `tx.reconcilePending` existed in the manifest and router **with zero callers** — a method shipped without a destination, cousin of "shipped control before destination". Fix at three layers: deferred passes scheduled inside `track()` (2s/10s, error-swallowing, unref'd), reconcile-on-view in Dashboard/History with a refetch, and render-level dedupe so a signature the list shows can never also be a Pending row. Lifecycle asserts all of it, verified to fail with the view triggers removed. |

> **Lesson:** existence checks stop too early — "the method is in the manifest and the router"
> does not mean the behaviour exists. The question that matters is "what calls this, and when."
> Register-but-never-invoke is the async twin of ship-control-before-destination.

> **Lesson:** CSS drift is the DOM's version of a changed wire format — when a component's
> markup structure evolves, its stylesheet is a *callsite* and must be re-checked like one.

> **Lesson:** the class shared by three of these is *async UI state with no defined refresh
> owner*. Any state mutated by an awaited path must name the call site that re-renders from it;
> "the input handler does it" is not enough the moment the mutation is asynchronous.

> **Lesson:** three of these were shipped-control-before-destination or stale-list problems.
> Both are symptoms of the same thing — **no check that the graph is connected.**
>
> **Lesson:** a guardrail with an inconsistency (stripping comments in one scan but not
> another) will eventually flag the very file that documents the rule.

### 4.7 The deploy-authority derivation that could never have worked — `READ`

`deriveTokenMintAddress(mintSeed)` was called with **no mint authority**, so the wallet derived
the trivial-authority mint address while the InitializeMint instruction it then broadcast was
built with real authority bytes — two different programs' worth of state that could never meet
on-chain. And the hand-rolled `encodeInitializeMintInstructionData` sitting next to it had no
official binding to be pinned against, so nothing could have caught its wire layout either. The
deploy path was in fact always-throwing on the first live call. Both halves were retired in the
same change: `deriveTokenMintAddress(mintSeed, address)` (authority mandatory) plus
`createInitializeMintInstruction` from `@thru/programs/token`, with derivation goldens pinned in
test/test-thru-client.mjs.

> **Lesson:** a "sacred" hand-rolled encoder is only as trustworthy as its verifier. A wire
> format that no official binding reproduces is not sacred — it is simply untested.

---

## 5. Legacy duplication — resolved or historical snapshot

The following consolidations came out of the old multi-screen UI. These are lessons, not current
open defects:

| Logic | Current status |
| --- | --- |
| Field error rendering (`setError`) | Shared through `src/ui/kit/field.js`. |
| Seed-phrase grid | Shared through `src/ui/domain/seed-phrase-grid.js`. |
| Account-reference equality/codec | Shared through `src/shared/refs.js`. |
| Old popup/desktop routing, markup factories, duplicate icon injection | Historical legacy code; do not use its old counts as the current tree. |

For any additional duplication, inspect the current source before adding a count here. A historical
monolith comparison is not evidence of duplicate code in the shipped route stack.

> **Lesson:** when deduplicating, compare behavior before deleting either implementation. The old
> versions differed; preserve the required behavior in the shared current component and its tests.

## 6. Open verification gaps — refreshed 2026-10-28

Automated coverage is materially stronger than the original audit: `scripts/check-routes.mjs`
checks route reachability/CSS classes; `test/test-route-lifecycle.mjs` mounts all 15 routes through
the real Router/guards/bridge and checks secret hygiene, listeners, focus-trap behavior, the reviewed
Send/Name/Faucet flows and History; `test/test-tx-review.mjs` covers the review pipeline; focused
suites cover registration, history cache/block-time, network scoping, the API router, and contract
invariants. These tests use deterministic fixtures/DOM shims and do not close
the following items:

| Boundary | Still open |
| --- | --- |
| Real Chrome | Popup/side-panel layout and focus at narrow/wide sizes, QR rendering, clipboard prompt, actual mutual exclusion/toolbar mode, and MV3 worker eviction/restart. Use `docs/MANUAL_SMOKE_CHECKLIST.md`. |
| Review card in a browser | The v29 card has DOM-level tests and a static fixture harness (`scripts/preview-tx-review.html`), but no real-browser pass at 400px or in the side panel (Dashboard/Send activation and the reviewed flows are DOM-shim only). Checklist §7 lists the specific checks (simple-transfer hierarchy, fee honesty, no simulated balance, blocking warnings, single-use confirm, timeout wording). |
| Transaction simulation | Not available on the current Thru backend: `tx.simulate` returns `{supported:false}`. Reviews therefore show no post-transaction balances. Enabling it requires a trustworthy dry-run RPC boundary, not a UI change. |
| Live v12 registration | Creation-time registration and Send JIT for an owned absent recipient on a live enabled network; include offline-vs-absent and exact target signer checks. |
| Live token transfer | Recipient-owner acceptance when the recipient has never registered, and the actual token-program fee (`scripts/verify-token-transfer.mjs`). |
| Send/pending races | A network switch after the final preflight while SDK signing is in progress, and concurrent pending-record read/modify/write operations (`docs/SEND_PATH_AUDIT.md`). |
| History live data | Current block-time availability/latency per enabled network, charged-fee source beyond the current RPC response, and confirmation of the explorer route (`docs/HISTORY_REDESIGN_PLAN.md`). |

Do not mark these resolved based only on a green Node suite or a build.

## 7. Popup and side-panel mutual exclusion — FIXED in source; Chrome check OPEN

The first exclusion attempt waited for `initTheme()` **and** `bridge.bootstrap()` before
registering the panel's close-message listener. A popup opening during either round-trip could
broadcast before the panel was listening. Separately, it identified a panel with
`innerHeight > 600`; a short browser window gives the side panel a viewport **at or below 600px**,
so it was treated as another popup and ignored the close signal even when the listener fired.
Neither defect was observable in the old test's 900px mock panel / fully settled boot.

Fix: the manifest loads the same page with a non-secret `?thru_panel=1` marker in the panel;
`boot()` registers the listener synchronously before its first await; Chrome 141+ also gets a
`sidePanel.close({ windowId })` call from the popup, which does not depend on the panel's page
having loaded at all. The broadcast remains the compatibility path on earlier Chrome. The
lifecycle test interleaves a message while theme storage is pending and tests a 480px panel,
a tall popup, the exact manifest path, and the no-listener native-close path. Actual Chrome
interaction (including the side panel picker and short browser windows) remains a required
manual smoke check — a Node shim cannot certify Chrome's side-panel UI.

> **Lesson:** a viewport dimension cannot identify a browser-owned surface; URL/context identity
> can. Register cross-context listeners before *any* awaited initialization, and if the platform
> offers a direct close API, do not make mutual exclusion rely solely on the other page being ready.

## 8. History block-time cache leaked across networks — FIXED in source/tests; live check OPEN

The first flat-History implementation memoized a timestamp by numeric **slot alone**. Two
independent chains can both have slot 427 but different dates, so switching networks could
show Alphanet's timestamp on Localnet. It also fetched missing block headers while holding the
per-network storage-write queue, so a slow header for one address could delay another address's
refresh. The first version enriched only the first page; "Load more" returned raw slot-only cards.

Fix: bind each header RPC to a captured SDK client/network; key the bounded successful lookup cache
by network ID, RPC endpoint, and slot; discard late replies after a network switch; and resolve block
times outside the serialized cache-write section. The cache records verified provenance as
`timestampSource: 'block'`. Paginated `tx.listHistory` enriches the displayed page while retaining
its existing method/API. An actual local submission time is only a fallback for the wallet's own
send; otherwise the card uses `Block <slot>` rather than an invented date.

`test/test-history-block-time.mjs` and `test/test-history-cache.mjs` exercise cross-network slot
collisions, races, absent dates, write-queue progress, and paging against deterministic SDK
fixtures. Those tests do not establish current live-node block-time availability or first-load
latency; keep that check open in `docs/MANUAL_SMOKE_CHECKLIST.md`.

> **Lesson:** a block height is meaningful only together with its chain, and optional enrichment
> RPCs should never run under the lock that protects unrelated cached accounts.

## 9. The shared review card and its two integration seams — FIXED in source/tests

Found while verifying the v29 transaction-review pipeline against Rabby's source and while building
the browser harness (`scripts/preview-tx-review.html`). Neither was a pipeline bug; both were seams
where a feature met the shared component.

### 9.1 A feature can re-derive the card's decision and get it wrong — `READ` + `TEST`

The Domain review sheet kept its confirm button enabled by listening for a DOM `change` event on the
card element, and built that button *after* the card. `TxReviewCard` fires its documented
`onChange({canConfirm})` from inside its constructor, so the sheet's handler ran before its own
button existed, and afterwards depended on an event that only bubbles when an acknowledgement input
changes. A review with no acknowledgements — a plain registration — therefore had one code path
(render) and no path at all for "confirmability changed".

Fix: every caller declares its confirm control first and passes `onChange`; the card remains the only
place that decides confirmability. Send already did this; Domain now does, and the faucet route was
written that way from the start.

> **Lesson:** a shared component's callback contract is the contract. A caller that recreates the
> decision from DOM events is not "using" the component, it is duplicating it.

### 9.2 Acknowledgement ids were unique per review, not per document — `BROWSER HARNESS`

The card rendered `id="tx-review-ack-<ackId>"`. One card per screen hid it. The harness mounts seven
cards in one document, and the duplicated ids made a `<label for>` resolve to the first match — so a
click on card 5 could tick card 3's checkbox. Accessibility and correctness both broken, silently.

Fix: ids are namespaced by a per-instance counter (`tx-review-ack-<instance>-<ackId>`).

> **Lesson:** "one at a time" is a runtime assumption, not a property of the markup. Ids belong to the
> document, not to the component.

### 9.3 A prepared review could be confirmed twice inside its TTL — `READ`

`tx.confirmReview` did not consume the record, so the same `reviewId` could be confirmed repeatedly
within 120 s. The handlers' own duplicate guards and the disabled-while-in-flight button were the
only protection, which is a weaker claim than the pipeline advertises.

Fix: a successful submit discards the review (`submitReviewedReview` → `tx.discardReview`), so a
replay fails with `REVIEW_NOT_FOUND` and is classified stale. A *failed* submit deliberately keeps
the review: retrying from the same reviewed facts is safe and avoids a needless re-read.

> **Lesson:** "the downstream guard will catch it" is a reason a bug is survivable, not a reason to
> leave the upstream hole open.

## 10. Dashboard activated accounts through a signing-gated method — FIXED in source/tests

Found by the new "no UI file names a signing method" scan added in `test/test-tx-review.mjs` [14],
prompted by a second independent review asking whether any direct signing call remained.

`routes/dashboard.js` fired `tx.autoCreateAccount` (declared `auth: 'signing'`) whenever a live
balance read reported `exists: false` for the active account. Two problems, one of them user-facing:

1. **It bypassed the v12 activation policy.** Every other activation path — account/keyring creation,
   Send's JIT path — goes through `tx.registerAccount`, which is `auth: 'unlocked'` precisely
   because it proves vault ownership, signs with the *target* account's own key, re-checks the
   network immediately before signing, and declares fee `0n`. The Dashboard path called the older
   method that signs with whatever the active account is.
2. **It could never succeed for a user who enabled per-sign password re-auth.** The Dashboard call is
   fire-and-forget from a background refresh (`.catch(() => {})`). A `signing` method behind the
   opt-in needs a password argument, and no screen was asking for one, so the call failed silently
   and the account simply stayed unregistered — with no message anywhere.

Fix: Dashboard now calls `bridge.send('tx.registerAccount', { address: account.address })`, the same
narrow exception the rest of the wallet uses. `tx.autoCreateAccount` remains in the contract
(append-only) but has zero UI callers.

Guards: `test/test-tx-review.mjs` [14] scans every `src/ui/**/*.js` for `bridge.send('…')` literals
(comments stripped), fails on any `auth:'signing'` or unknown method, asserts the sanctioned literals
are present so the scan cannot pass vacuously, and asserts `tx.autoCreateAccount` has no caller.
`test/test-route-lifecycle.mjs` mounts Dashboard with `exists:false` and asserts the call is
`tx.registerAccount`, targets the active address, passes only `{address}` (no password), and never
touches `tx.autoCreateAccount`.

> **Lesson:** "documented as allowed" is not the same as "reaches the one sanctioned implementation".
> A capability that is convenient to call directly will be called directly; make the direct call
> fail in a test, not in a user's wallet.

## 11. The review surface was over-built — FIXED in source/tests

Found by the owner reading the shipped screen, not by a test: "the send view changed too much — make
it back like the previous one from main", "the Domain register preview is so long users get
confused", with two of their own Rabby before-sign screenshots as the target shape.

### 11.1 Symptom — `BROWSER` (owner)

A native THRU send rendered **eleven** blocks: an eyebrow + title, a prose summary, a two-column
"signing account / interaction" box with the program address and provenance, a "What you are doing"
heading over a table, a "Balance change" heading over one large box plus a "Balance after: not
available" row and its note, a "Network fee" heading over four rows (fee, reserve, provenance, note)
and two more hints, a "Simulation unavailable" box, an "Execution details" heading over program +
instruction + four account roles + a raw toggle, a "Warnings" heading, acknowledgements, and the
blocked notice. A `.name` registration was longer still, because it has more facts.

The facts were all true; the screen answered "what am I signing?" only after a scroll. The previous
`main` Send screen had done the same job with one table, and Rabby's before-sign screen shows the
value, one card and two taps of detail at 400 px.

### 11.2 Root cause — `READ`

Two defaults compounded:

1. **Every decoder fact got a section of its own.** The card's contract said "render the envelope",
   so each new fact (protocol provenance, simulation status, balance-after note, fee provenance,
   reserve) was added as a visible block rather than folded into the facts the user needs to decide.
   The envelope grew; the card grew one section per field, forever.
2. **The old Send review's information architecture was treated as replaced rather than preserved.**
   The single `detail-table` with From/To/Amount/fee/total was exactly the right shape for a transfer;
   it was rebuilt from scratch as three sections, so the screen the owner recognised disappeared
   instead of becoming the shared one.

### 11.3 Fix

`review-card.js` now renders one table (`detail-table`, the same component as old `main`) with the
decoder's rows + `Network fee (estimated)`/`Not quoted` + `Total` when arithmetic is possible, above
it one signed exact value box per movement, above that a one-line program identity, and **one closed
`Advanced details` disclosure** holding program address/provenance, instructions, account roles, fee
provenance/reserve/note, the simulation status and the raw toggle. Unknown reviews open that
disclosure. Decoders dropped the redundant `Network` row (the header badge owns it), the registrar
row (the protocol line owns it), and the per-year price when it duplicates the total.

### 11.4 A clipped destination address, found while simplifying — `READ`

The first card rendered mono summary values with the shared `.detail-address` class, which is
`white-space: nowrap; text-overflow: ellipsis`. At the 400 px popup width a 44-character Thru address
was therefore **visually truncated in the "To" row** of a send review — the destination the user is
about to pay irreversibly. The full address existed in the DOM (and in `Advanced details`), so no test
noticed; the old `main` screen deliberately rendered `to` with `word-break: break-all`.

Fix: review values now use `.tx-review-address` (`word-break: break-all`, no ellipsis), so a long
address wraps to a second line instead of being cut off. `.detail-address` stays for the compact
account rows that actually want ellipsis.

> **Lesson:** "the data is in the DOM" is not the same as "the user can read it". Any class borrowed
> from a compact list can silently shorten the one string the decision depends on.

### 11.5 Guards

- `test-tx-review.mjs` [15] fails if the card grows a second table or a third top-level section, if
  the old section classes return, if any decoder exceeds its row budget, or if any decoder repeats
  the network in its rows. It also asserts the folded facts still exist in the envelope, so the next
  simplification cannot become deletion.
- `test-route-lifecycle.mjs` asserts the rendered DOM through the real Send and Faucet routes: one
  table, no sections, disclosure closed by default, opening it reveals the program/fee note/simulation
  without re-preparing the review, and an unmeasured fee prints `Not quoted` rather than a number.

> **Lesson:** a shared component's envelope is a data contract, not a layout. Every new fact does not
> earn a section; the screen has to stay the size of the decision. And when replacing a screen users
> already know, the old shape is the baseline to beat, not the thing to throw away.

## 12. The review pipeline's truth-states, store and simulation gate — FIXED in source/tests

Found by an external audit of `2e2178f`, re-checked finding-by-finding at the current head
(`docs/TX_REVIEW_VERIFICATION.md` §12). Every item below was still true at `983724b`; all are fixed
with a regression test in `test/test-tx-review.mjs`.

### 12.1 An unreadable mint was reported as a proven absence — `READ` + `TEST`

`review/kinds.js` deliberately keeps `mintExists: null` when `token.readMint` fails, but the decoder
tested truthiness:

```js
if (!facts.mintExists) { /* "This mint does not exist on this network", blocking */ }
```

An RPC outage therefore became an authoritative chain statement, and the review blocked with a fact
the wallet had not established. Fixed by branching on `=== false` (proven absent, blocking) versus
`== null` (unreadable, warning; the token handler re-reads the mint before signing).

> **Lesson:** a tri-state fact needs three branches. `!value` silently merges "unknown" into "no",
> which is the one collapse this wallet's rules exist to prevent.

### 12.2 A failed simulation changed nothing — `READ`

`simulationBlock()` could return `status:'failed'`, but state came only from decoder warnings and the
card rendered every non-`supported` state as "Simulation unavailable". A dry run that ran and failed
is *proof the transaction cannot succeed*, so it must block — and "failed" must not read as "we
couldn't check".

Fix: `simulationWarning()` produces a blocking warning; the service folds it in before computing and
persisting state; `confirmReview` refuses any record that is not `ready`; the card labels the four
states distinctly. Dormant today (Thru has no dry-run RPC), which is why it survived: the only tests
that could exercise it needed a seam that did not exist.

> **Lesson:** a status enum that the UI renders but the gate ignores is decoration. If a state can
> exist, decide what it means for signing, or delete the state.

### 12.3 Concurrent prepares erased each other — `READ` + `TEST`

`review/store.js` said "single-writer per network" in its header and then did plain
read-modify-writes. Two prepares from popup and side panel could read the same list and the later
write dropped the earlier record, so a visible review then answered `REVIEW_NOT_FOUND` for no reason
the user could see. Fixed with the per-network promise queue `pending-tx-service` already uses.
Negative control: restoring the old body makes the new put/put test lose a record and the suite fail.

> **Lesson:** "single writer" is a property you enforce, not a comment you write. Any read-modify-write
> over a shared array needs a queue before the second caller exists.

### 12.4 The faucet review invented an activation and ignored a policy mismatch — `READ` + `TEST`

`accountExists: state.exists === true` turned an unreadable account into "does not exist", so the
review promised "Your account will be activated first" on no evidence. Separately, the facts carried
`targetMatchesFaucet:false` (the rate-limit policy belongs to another program) and the decoder never
showed it, although the confirm-time recheck refused to sign. Fixed: tri-state existence with an
`account-state-unverified` warning, and a blocking `faucet-target-mismatch`.

> **Lesson:** when a recheck refuses on a fact, the review must show that fact. Otherwise the button
> is disabled for a reason the user never saw.

### 12.5 The registrar treasury rendered as `unknown` — `READ` + `TEST`

The facts builder emitted `treasurer: cfg.treasurer`; the decoder read `facts.treasury`. The real
authoritative address was already in hand and the execution table said "unknown". One name is now
used end-to-end, and a decoder test asserts the address reaches the account table.

> **Lesson:** `?? 'unknown'` hides naming drift. A fallback that turns a missing field into a word
> makes a type error look like a chain limitation.

### 12.6 "Verified program" could be true with no address — `READ`

Native and token decoders hard-coded `verified: true` while allowing the pinned program id to be
`null`; the validator did not require the pair. Fixed in both decoders (blocking
`program-unidentified` when the id is missing) and enforced structurally in `model.js` for the
protocol and execution program, so no future decoder can repeat it.

> **Lesson:** a trust label is a claim about a specific identifier. The validator is the right place
> to make "verified without an address" unrepresentable.

### 12.7 What the audit also raised, and why it is not in this section

F-01 (the dormant `intent-service` lifecycle), F-02's general form (direct signing methods remain
callable; no one-shot authorization), F-05's residual (background `confirmReview` is idempotent by
design) and F-08 (the Domain lifecycle) are architecture decisions, not defects: each is recorded as
open in `docs/TX_REVIEW_VERIFICATION.md` §12 rather than "fixed" here. One enforcement gap *was*
closed on the way: `confirmReview` now refuses a review whose persisted state is not `ready`, so a
blocked review is no longer confirmable merely because the UI would have disabled the button.
