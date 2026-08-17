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

> **Lesson:** three of these were shipped-control-before-destination or stale-list problems.
> Both are symptoms of the same thing — **no check that the graph is connected.**
>
> **Lesson:** a guardrail with an inconsistency (stripping comments in one scan but not
> another) will eventually flag the very file that documents the rule.

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

1. **Reachability.** Nothing verifies a route can be navigated to from the UI. This caused §1.2.
2. **Rendering.** `test-ui-dom.mjs` uses a DOM shim with no `innerHTML` property. It proves
   *which DOM APIs are called*, not what a browser paints. No route is ever mounted.
3. **CSS.** No check that a class used in JS exists in CSS. This is why ~80 undefined-class
   usages shipped. `docs/UI_REBUILD_PLAN.md` specifies `scripts/check-css.mjs`; it is not built.
4. **Live chain.** Faucet/transfer program addresses, instruction layouts, the amount-unit
   question and explorer URL patterns remain unverified against a running network.
5. **The legacy stack.** Untested throughout, and still serving send, receive, faucet, history
   and settings.

The single highest-value addition is a **jsdom route smoke test**: mount every registered route
in locked / unlocked / no-vault states with a mocked bridge, assert no throw, and assert every
class it uses is defined. That covers gaps 1, 2 and 3 at once.
