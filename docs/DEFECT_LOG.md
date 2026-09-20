# Defect log

Every defect found while rebuilding the frontend, with its root cause and the lesson. This
exists because most of these were **not** typos — they were failures of a *kind*, and the kind
is what predicts the next one.

Ordered by how much they cost to find, not by severity.

Legend for how each was found:
`TEST` automated · `BROWSER` manual testing by the user · `READ` code reading · `TOOL` a
guardrail script caught it

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

Guard: `test-api-router.mjs` walks 13 real responses for BigInt, functions, symbols, typed
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

**The structural response**, rather than fixing 20 sites and hoping:

- `src/ui/kit/dom.js` `h()` is the only way to build a node. Text goes through `textContent`.
  `on*` attribute names throw. `javascript:`/`vbscript:`/`file:`/`about:`/`blob:` and non-image
  `data:` URLs are refused, including obfuscated forms. There is no prop that accepts markup.
- `scripts/check-layering.mjs` greps for `innerHTML =`, `insertAdjacentHTML`, `outerHTML =`
  under `src/ui` and `src/features`, as a **ratchet**: the per-file budget may only shrink, and
  going below budget without lowering it also fails, so the list cannot rot into a permanent
  exemption.
- Sensitive operations are `auth: 'password'` in the contract, re-verified against the
  encrypted blob rather than against session state. `test-contract.mjs` asserts this for eight
  specific methods.
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
| `manifest.json` `side_panel.default_path: popup.html` | The panel was declared and built, and nothing in the app could open it — the only way in was the browser's own menu. A declared capability with no caller, in the same family as `bridge.onEvent()`. Now Settings > Window > **Open side panel**, which calls `chrome.sidePanel.open({ windowId })` from a real user gesture and deliberately never calls `setPanelBehavior` (that would swap the toolbar popup for the panel for every user). |
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
| `test-contract.mjs`'s hand-maintained UI file list | `READ` (self) | Had stopped covering new files, which is precisely how the phantom `wallet.generateMnemonic` reached a finished route. Now walks directories. |
| `check-layering.mjs` false positives on comments — **twice** | `TOOL` | First for DOM sinks, then again for imports and the single-seam rule, because I fixed stripping in one place only. The file documenting why `innerHTML` is banned failed the `innerHTML` rule. |
| Base64url padding appended as `'=='` in my own test | `TEST` | — |
| Margin utilities stacking on `.screen`'s gap | `BROWSER` | Defining the missing utilities fixed the flush-together screens but created 16/20/24/28px inconsistency. Resolved by making `gap` the single source of rhythm. |
| `initialSupply` shown in the balance column | `READ` | Inherited, but I carried it forward initially. A mint's total supply is not your balance. |
| `reset.js` built its `PageHeader` inline (`PageHeader({...}).el`) and discarded the instance | `TEST` (`test-route-lifecycle.mjs`) | The route's `destroy()` disposed its own listeners and the banner's, but the header's back-button click listener stayed attached to a node that was no longer in the document. Twelve other routes keep their header instance for exactly this reason; this one did not, and nothing caught it until a test counted listeners on detached nodes. |
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
test-thru-client.mjs.

> **Lesson:** a "sacred" hand-rolled encoder is only as trustworthy as its verifier. A wire
> format that no official binding reproduces is not sacred — it is simply untested.

---

## 5. Duplication found

| Logic | Copies | Status |
| --- | --- | --- |
| `setError` | **8** | consolidated into `kit/field.js`, which also adds the `aria-invalid`/`aria-describedby` none of the eight had |
| mnemonic grid render | 3 | consolidated into `domain/seed-phrase-grid.js` |
| `refsEqual` | 3 | consolidated into `shared/refs.js` |
| `FAUCET_MAX_PER_CLAIM` | 3 | still duplicated |
| `formatThru` / `parseThruAmount` | 2 | `lib/thru-client.js:39-73` still duplicates `shared/format.js` |
| `injectIcons` | 2 | still duplicated |
| send form state + address check | 2 | **character-identical** copy-paste, not a divergence |
| routing | 3 | `popup.js` `show()`, `ui/router.js`, `desktop.js` `switchTab()` — new stack is a 4th until the others are deleted |

The comparison that mattered: **neither copy was a superset.** The module had an empty-password
guard, a reveal toggle, autofocus, clear-on-failure and a zero-amount guard the monolith lacked;
the monolith had an inline error surface the module lost. The correct merge was the union — and
teardown was broken in *both*.

> **Lesson:** when deduplicating, diff behaviour before deleting either side. "The newer one is
> better" was false here.

---

## 6. What still has no test coverage

Stated plainly, because the gaps predict the next round of bugs.

1. ~~**Reachability.** Nothing verifies a route can be navigated to from the UI.~~ Closed twice
   over: `scripts/check-routes.mjs` proves every navigated path exists and every registered route is
   reachable, and `test-route-lifecycle.mjs` clicks the real controls (topbar settings, topbar lock,
   the four dashboard tiles, the account pill, Back) and asserts where each one lands.
2. ~~**Rendering.** No route is ever mounted.~~ Closed: all 14 routes mount through the real Router,
   guards, bridge and kit in no-vault / locked / unlocked states, with only
   `chrome.runtime.sendMessage` mocked. Still true that no shim proves *what a browser paints* —
   that residue is `docs/MANUAL_SMOKE_CHECKLIST.md`.
3. ~~**CSS.** No check that a class used in JS exists in CSS.~~ Closed by `scripts/check-routes.mjs`,
   which reports every class the new stack uses and whether all are defined (a separate
   `check-css.mjs` was never needed).
4. **Live chain.** Faucet/transfer program addresses, instruction layouts, the amount-unit
   question and explorer URL patterns remain unverified against a running network.
5. ~~**Legacy launchpad surface.**~~ Closed. `src/launchpad/**` is deleted rather than flagged off,
   the DOM-sink ratchet now covers all of `src/`, and `test-launchpad-quarantine.mjs` asserts the
   surface stays out of the source, the flags, the routes and a real `dist/` build.

The **route smoke test** that this section used to call the single highest-value addition now
exists as `test-route-lifecycle.mjs` — built on a hand-rolled shim rather than jsdom, because the
hard rule is no new dependencies and the shim only needs the DOM surface this codebase touches. It
covers gaps 1, 2 and 3, adds listener-teardown and secret-hygiene assertions, and ships a negative
control for each security claim so a vacuous assertion fails loudly.

What remains uncovered is item 4 (live chain) and everything a browser owns: layout at narrow and
wide widths, real focus rings, canvas QR output, side-panel behaviour, service-worker eviction. Those
are checkboxes in `docs/MANUAL_SMOKE_CHECKLIST.md`, not test gaps to close in Node.
| `.copy-address` nested inside `.monospace-block` | `BROWSER` (local agent audit) | A splitted edit dropped the interactive copy-box rules *inside* the unclosed `.monospace-block` rule. CSS nesting is VALID syntax — esbuild emitted 0 warnings and Chrome parsed it as the descendant selector `.monospace-block .copy-address`, which can never match `<button class="monospace-block copy-address">` (both classes on the same element). Result: `display:flex`, `cursor:pointer`, the hover wash, and the `.copied` green confirm were all silently dead in Chrome while every automated gate passed green. Fixed by closing `.monospace-block` first; `scripts/check-css-nesting.mjs` now bans nested rules outright and runs in both `npm test` chains. |

> **Lesson:** "0 CSS warnings" certifies syntax, never semantics. Modern esbuild/Chrome
> feature support (native nesting) turned what would once have been a build error into a
> silent runtime no-op. Guardrails must encode *house intent* ("this repo's CSS is flat"),
> not just "does the toolchain accept it".
| P0 history feed: dupes on load-more + discarded `synced` flag | `BROWSER` (local agent code audit) | The merged feed paints fresh(15) + cached extras with cursor 15, but append was blind — a load-more page re-yielded already-painted signatures, rendering them twice in scrambled order. And the feed's offline honesty flag was returned to the UI and dropped on the floor, exactly the register-but-never-invoke class resurfacing one layer up (a *field* nobody used). Fixes: dedupe-on-append in history.js, and `synced:false` now drives a 'Showing cached activity — offline' label that clears when a synced page lands. Lifecycle reproduces the overlap fixture-side (35 unique entries, load-more re-yielding them) and verified the dedupe assertion FAILs when the fix is removed. |

> **Lesson:** a merge in the backend is a *union*, a cursor is an *offset* — any frontend
> appending to merged data must treat the append as dedupe-by-key, never as blind concat.
> And every honesty field you mint (`synced`, `stale`, `fresh`) needs its UI consumer in the
> same commit, or it is decorative.
| Day-group count badge appended into the previous section's last card | `BROWSER` (local agent P1 audit) | At a day boundary the loop did `listHost.lastChild.appendChild(badge)` — but `lastChild` at that moment is the prior section's last `.tx-card`, not its `<header>`. Every header except the final one lost its count, and cards acquired a stray chip. Both failure modes are invisible to class-name checks and to the DOM shim's text assertions (the chip text rendered — in the wrong parent). Fix: identity reference (`currentHeader`) instead of positional access; lifecycle now asserts every header owns its badge AND every chip's parent is exactly a header. Both FAIL against the positional variant. |

> **Lesson:** in incrementally-built DOM, `lastChild` is a positional guess, and positional
> guesses decay the moment a sibling starts carrying structure of its own. Keep the node you
> intend to mutate by identity. The shim DOES see this class — assert parent identity, not
> just text presence ("the text was on screen" is not "the text was in the right parent").
| P2 detail sheet: in-card controls would double-fire the open handler | `CAUGHT PRE-MERGE` (P2 implementation) | Making `.tx-card` an openable control put a click handler on an element that already CONTAINED a copy `<button>` and an explorer `<a>`. Because the kit's shim and the real DOM both bubble, clicking either would have run the card's open handler too — the copy button would silently open a sheet, and worse, the explorer link would open a background tab *and* a modal the user never asked for. Caught before it shipped by walking the event path from `target` up to the card and bailing on any `<button>`/`<a>` in between. Lifecycle asserts a copy click does NOT open the sheet. |

> **Lesson:** promoting a container to a control inherits every descendant's clicks. A card
> that grows an affordance must decide what its existing affordances mean *in the same
> change*, or the outer handler quietly swallows the inner ones. The same applies to the
> keyboard path: `Enter`/`Space` on a nested button must activate the button, not the card.

| P2: a detail sheet parented to its card would vanish mid-read | `CAUGHT PRE-MERGE` (P2 implementation) | The Activity list repaints wholesale on a filter change, a `pendingTxChanged` event or load-more — `paintList()` destroys every card and rebuilds. A sheet appended inside the tapped card would have been torn out from under the user by a background event they did not trigger. Fixed by parenting the sheet to `document.body` (as `password-prompt.js` already does) and having the ROUTE own its lifetime, closing it explicitly in `destroy()`. Lifecycle asserts a sheet open at navigation time is gone afterwards and leaves no listener on a detached node. |

> **Lesson:** a modal's lifetime is the ROUTE's, never a list row's. Any surface that must
> survive a repaint has to live outside the subtree that repaints, with its owner holding
> the reference — `{el, update, destroy}` plus an explicit close in the owner's `destroy()`.

| P2: "fee" was one rename away from becoming a fabricated number | `CAUGHT PRE-MERGE` (P2 spike) | `Transaction.fee` is populated and reads like the answer to "what did this cost?" — it is not. The spike against the generated protobuf established that `TransactionExecutionResult` has NO charged-fee field at all (compute/memory/state units, vm_error, events, nonce — nothing else), so `Transaction.fee` is the sender's HEADER DECLARATION, an input to execution. Shipping it as "Fee" would have put a number in front of users that is not what they were debited. Mitigated structurally, not by comment: the field is named `feeDeclaredUnits` end to end, the wire carries `feeCharged: false`, the row is labelled "Fee (declared)", the sheet states inline that the network reports no charged fee, and `test-contract.mjs` fails if the return shape is ever renamed to a bare `feeUnits`. |

> **Lesson:** a field that exists is not a field that means what its name suggests. Before
> surfacing any chain value, check whether it is an INPUT the sender chose or an OUTPUT the
> network reported — they read identically in a type signature and differently to a user.
> Encode the distinction in the identifier, not in a comment, so a rename cannot erase it.

| P2 detail sheet: tall sheets silently amputated their last rows instead of scrolling | `BROWSER` (user, on a real popup — **escaped every automated gate and two code audits**) | `.tx-sheet` inherits `display:flex; flex-direction:column` from `.modal-card` and adds `max-height:88%; overflow-y:auto`. Flex items default to `flex-shrink:1`, so once content exceeded the cap the children were **compressed to fit** rather than overflowing. `.detail-table` carries `overflow:hidden` (for its border-radius), so it absorbed the shrink and clipped its own last rows: "Block time" was sliced through the middle, "Fee (declared)" and "Program" vanished entirely, and the fee note sat flush against the wound. And because the children had been shrunk to fit, `scrollHeight === clientHeight` — `overflow-y:auto` had nothing to scroll and drew no scrollbar, so the missing rows gave no hint they existed. Fixed with `.tx-sheet > * { flex-shrink: 0 }` (plus `overscroll-behavior: contain` so the sheet does not scroll the list behind the backdrop). Verified by reverting the fix: `test-route-lifecycle.mjs` exits 1. |

> **Lesson:** `overflow-y: auto` on a flex column is not a scroll container — it is a scroll
> container *only if its children refuse to shrink*. Otherwise the browser resolves the
> height conflict by compressing content, and an inner `overflow: hidden` (which every
> rounded-corner container has) turns that compression into silent data loss. Whenever
> `overflow-y: auto`, `max-height` and `display: flex` appear on the same element, the
> children need `flex-shrink: 0` or the scroll is decorative.
>
> **The process failure matters more than the CSS.** This shipped because the sheet was
> never rendered — it was reasoned about. `npm test` runs on a hand-rolled DOM shim with no
> layout engine, so it cannot compute a height and structurally *cannot* catch this class of
> bug; both code audits read the CSS and agreed it looked right, because it does look right.
> Two mitigations, both in this commit: a stylesheet-level invariant in
> `test-route-lifecycle.mjs` (any flex-column scroll container must pin its children —
> falsified by reverting the fix), and `scripts/preview-tx-sheet.html`, a dev-only harness
> that renders the real built CSS at the true 408x600 popup size so a human can *look* at
> overflow states. **Any change touching modal or sheet layout must be viewed in that
> harness before it is called done.** "The CSS reads correctly" is not evidence about layout.
