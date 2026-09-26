# Defect log

Every defect found while rebuilding the frontend, with its root cause and the lesson. This
exists because most of these were **not** typos — they were failures of a *kind*, and the kind
is what predicts the next one.

Ordered by how much they cost to find, not by severity.

Legend for how each was found:
`TEST` automated · `BROWSER` manual testing by the user · `READ` code reading · `TOOL` a
guardrail script caught it


## Status convention — current as of 2026-09-26

The defects in §§1–4 are **historical**: their old paths and failure descriptions are retained to
explain the fixes, not to claim those paths still ship. §5 records resolved legacy duplication, not
a current backlog. The current verification gaps are listed in §6; the popup/side-panel and History
cross-network fixes in §§7–8 are implemented and locally tested, but their real-Chrome/live-RPC
checks remain open. Check `src/` before treating any historical symptom as current.

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

## 6. Open verification gaps — as of 2026-09-26

Automated coverage is materially stronger than the original audit: `scripts/check-routes.mjs`
checks route reachability/CSS classes; `test/test-route-lifecycle.mjs` mounts all 14 routes through
the real Router/guards/bridge and checks secret hygiene, listeners, focus-trap behavior, Send and
History flows; focused suites cover registration, history cache/block-time, network scoping, the API
router, and contract invariants. These tests use deterministic fixtures/DOM shims and do not close
the following items:

| Boundary | Still open |
| --- | --- |
| Real Chrome | Popup/side-panel layout and focus at narrow/wide sizes, QR rendering, clipboard prompt, actual mutual exclusion/toolbar mode, and MV3 worker eviction/restart. Use `docs/MANUAL_SMOKE_CHECKLIST.md`. |
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
