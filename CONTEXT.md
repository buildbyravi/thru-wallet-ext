# CONTEXT.md — file-by-file map of thru-wallet-ext

Purpose: let any agent or new contributor answer "where do I look for X?" without grepping the whole
tree. Every line count and `file:line` reference below was verified against the working tree.

Read `AGENTS.md` first for the rules. Read `docs/BUILD_SPEC.md` for product intent. Read
`docs/UI_REBUILD_PLAN.md` for the target architecture.

**Status legend**

| | Meaning |
| --- | --- |
| ✅ | live, reachable at runtime, working |
| ⚠️ | live but has a known defect or partially-dead API |
| 💀 | bundled into `dist/` but unreachable at runtime — shipped dead weight |
| ☠️ | zero importers — dead file, not even bundled |

---

## 1. Where to look — quick index

| I need to… | Go to |
| --- | --- |
| add/change a backend API method | `src/background/api-router.js` |
| touch encryption, keyrings, seed derivation | `src/lib/vault.js` |
| touch RPC, transaction building, history decoding | `src/lib/thru-client.js` |
| change how the UI talks to the background | `src/ui/bridge.js` |
| add a network | `src/lib/networks.js` |
| format or parse a THRU amount | `src/shared/format.js` |
| change colors, spacing, type | `src/popup/styles/tokens.css` |
| find the screen the user actually sees | `src/popup/popup.js` + `src/popup/popup.html` (**not** `src/popup/screens/`) |
| understand why a screen looks broken | §6 — the dual-router problem |
| add an icon | `src/popup/icons.js` |
| change the build | `build.mjs` |
| change permissions or CSP | `src/manifest.json` |
| add a test | root `test-*.mjs` + `package.json` `scripts.test` |

---

## 2. Root files

| File | Lines | Status | Notes |
| --- | --- | --- | --- |
| `package.json` | 35 | ✅ | `build` → `node build.mjs`; `test` → three `.mjs` suites. Deps: `@thru/crypto ^0.2.21`, `@thru/sdk ^0.3.4`. Dev: `esbuild ^0.28.1`. |
| `build.mjs` | 60 | ✅ | esbuild, IIFE, minified, `chrome115`. Five bundles + static copies. See §3. |
| `README.md` | — | ✅ | user-facing overview |
| `AGENTS.md` | — | ✅ | agent rules — read first |
| `CONTEXT.md` | — | ✅ | this file |
| `test-vault.mjs` | — | ✅ | mocks `chrome.storage`, runs the real vault against real `@thru/crypto`/`@thru/sdk` |
| `test-thru-client.mjs` | — | ✅ | instruction byte layouts, BigInt amount round-trip, checksum rejection, history decode |
| `test-api-router.mjs` | — | ✅ | background API integration |
| `test-auto-sponsor.mjs` | — | ⚠️ | **not wired into `npm test`**. Either add it or delete it. |
| `SECURITY.md` `PRIVACY.md` `SUPPORT.md` `LICENSE` | — | ✅ | policy docs |

### Docs

| File | Role |
| --- | --- |
| `docs/BUILD_SPEC.md` | merged product + architecture spec. Authority on **behaviour**. |
| `docs/UI_REBUILD_PLAN.md` | audit + target layout + phase plan. Authority on **structure**. |
| `docs/UI_REBUILD_AGENT_PROMPT.md` | executable prompt for an agent doing the rebuild |
| `docs/archive/guide.md` | superseded by `BUILD_SPEC.md`. Historical only. |
| `docs/archive/thru-implementation_plan.md` | superseded. Its line counts and target layout are both stale. |
| `docs/archive/task.md` | superseded. Marks Phases 1–4 "COMPLETED"; see `BUILD_SPEC.md` Part 0 for the corrected status. |

### Not present but referenced elsewhere

`docs/reference/` — drop Rabby HTML dumps or screenshots here for pixel-accurate work.
`dist/` — gitignored build output. **Never edit.** Note `dist/sidepanel.html` currently exists with
no source file and is not produced by `build.mjs`, contradicting the comment at `build.mjs:49-51`.

---

## 3. Build graph

```
src/background/index.js   → dist/background.bundle.js      (build.mjs:14)
src/popup/popup.js        → dist/popup.bundle.js           (build.mjs:20)
src/popup/popup.css       → dist/popup.css                 (build.mjs:30)
src/desktop/desktop.js    → dist/desktop.bundle.js         (build.mjs:37)
src/desktop/desktop.css   → dist/desktop.css               (build.mjs:45)
copied: popup.html, desktop.html, manifest.json, icons/*    (build.mjs:52-58)
```

Only three JS entry points exist. Anything not transitively imported by one of them is dead.

**Critical distinction:** `src/popup/popup.js:16-32` statically imports all 20 files in
`src/popup/screens/` and all of `src/ui/`. So they are all **bundler-reachable** (they ship) while
many are **runtime-unreachable** (they never mount). That is the single most confusing thing about
this codebase.

---

## 4. `src/lib/` — the sacred layer

Do not modify for cosmetic reasons. Changes here require a passing `test-vault.mjs` /
`test-thru-client.mjs`.

### `src/lib/vault.js` — 486 lines ✅

Encrypted vault, keyring model, account resolution. PBKDF2 600k iterations SHA-256 + AES-256-GCM.
Encrypted vault in `chrome.storage.local`; decrypted vault + derived key in `chrome.storage.session`
only.

| Region | Lines | What |
| --- | --- | --- |
| constants | 11-17 | `PBKDF2_ITERATIONS`, storage keys, `VAULT_VERSION = 2` |
| encoding helpers | 19-47 | b64, hex, `parsePrivateKeyHex` (enforces 32 bytes) |
| `normalizeMnemonic` | 49-55 | lowercases, collapses whitespace, validates via `MnemonicGenerator` |
| keyring factories | 62-82 | `seedKeyring()`, `privateKeyKeyring()` — **`seedKeyring` does not record provenance; see gap below** |
| ref helpers | 92-206 | `accountRef`, `normalizeRef`, `externalRef`, legacy `hd`/`imported` ↔ `keyring` conversion |
| crypto core | 106-153 | derive / encrypt / decrypt / persist |
| V1→V2 migration | 161-186, 283-298 | runs inside `unlock()`; keeps `vault_legacy_backup_v1` until two successful unlocks |
| labels | 221-237 | `getAccountLabels`, `setAccountLabel`, `setAccountLabelAuthenticated` |
| lifecycle | 241-318 | `createVault`, `importMnemonicVault`, `importPrivateKeyVault`, `unlock`, `lock`, `resetWallet` |
| **keyring management** | **322-387** | **`listKeyrings`, `addSeedKeyring`, `addPrivateKeyKeyring`, `renameKeyring`, `removeKeyring`, `hasSeed`** |
| account resolution | 391-475 | `switchActiveAccount`, `resolveAccount`, `listAccounts`, `addHdAccount`, `addImportedKey` |
| export | 479-486 | `exportAccountSecret(ref, password)` — re-verifies the password |

**⚠️ The most important fact in this repo:** lines 322–382 implement full multi-seed support and
**nothing outside this file calls them.** `api-router.js` has no `keyring.*` namespace. Multi-seed is
built, paid for, and invisible.

**⚠️** `addImportedKey` (463) is documented at 461-462 as the legacy path that **skips password
verification**. `api-router.js:61` uses it. The safe `addPrivateKeyKeyring` (347) is unused.

**⚠️** `setAccountLabel` (226) applies only `String(label).trim()` — no length or charset limit. The
`maxlength="32"` in the UI is client-side only.

**Gap:** no `origin: 'generated' | 'imported'` on seed keyrings, so the UI cannot tell an imported
phrase from a generated one (Rabby's `byImport` flag).

### `src/lib/thru-client.js` — 532 lines ⚠️

RPC client, transaction construction, history decoding, token deployment.

| Region | What |
| --- | --- |
| 38-73 | ⚠️ **duplicate** `UNITS_PER_THRU` / `formatThru` / `parseThruAmount` — byte-identical to `src/shared/format.js:5-36`. The exported `parseThruAmount` here has zero external callers. Delete. |
| ~284 | only internal use of the duplicate formatter |
| ~455-465 | ⚠️ destructures `ticker` / `imageUri` while `background/services/token-service.js:22-25` sends `symbol` / `imageUrl` → **every stored token record has an empty ticker and no image** |
| ~516-527 | token deploy; no sanitization of user-supplied token metadata (correct — sanitize at render) |
| `decodeHistoryEntry` | reconstructs `[feePayer, program, ...readWrite, ...readOnly]` ordering to resolve account indices back to addresses. Never hardcodes indices — uses the SDK's own `getAccountIndex`. |
| `explorerTxUrl` / `explorerAddressUrl` | route patterns unconfirmed; worst case a dead link |

Faucet and transfer program addresses / instruction layouts are **reverse-engineered**, not from Thru
docs. If either fails with a low-level format error, doubt those constants first.

### `src/lib/networks.js` — 93 lines ✅

Typed network config map (alphanet / testnet / mainnet-ready) + `explorerTxUrl` /
`explorerAddressUrl`. The only place network info should live.

---

## 5. `src/background/` — the service worker

Entry per `manifest.json:21` → `background.bundle.js` ← `build.mjs:14` ← `src/background/index.js`.

| File | Lines | Status | Notes |
| --- | --- | --- | --- |
| `index.js` | 55 | ✅ | message listener; **validates `sender.id === chrome.runtime.id` at :34** (correct); auto-lock alarm at :10-15 |
| `api-router.js` | 116 | ⚠️ | 34 methods in a `handlers` object literal (:11-83); dispatch at :90-116 |
| `services/wallet-service.js` | 87 | ✅ | thin wrapper over vault lifecycle + `exportSecret` |
| `services/account-service.js` | 88 | ✅ | `toPublicAccount()` at :8 strips private key bytes before returning to UI |
| `services/tx-service.js` | 81 | ✅ | `getAccountInfo`, `claimFaucet`, `sendTransfer`, `listHistory`, `checkNetworkHealth`, `autoCreateAccount` |
| `services/token-service.js` | 49 | ⚠️ | field-name mismatch with `thru-client.js` (see §4) |
| `services/network-service.js` | 40 | ✅ | active network get/set/list |
| `services/system-service.js` | 47 | ✅ | auto-lock minutes; recreates the alarm on change (:37-43) |

### API surface (`api-router.js:11-83`)

```
system.bootstrap  system.setAutoLock  system.getAutoLock

wallet.hasVault  wallet.isUnlocked  wallet.create  wallet.importMnemonic
wallet.importPrivateKey  wallet.unlock  wallet.lock  wallet.reset
wallet.hasSeed  wallet.exportSecret

account.getActive  account.getActiveRef  account.list  account.switch
account.addHd  account.addImported  account.setLabel  account.getLabels

tx.getAccountInfo  tx.claimFaucet  tx.send  tx.listHistory
tx.checkHealth  tx.autoCreateAccount

token.deploy  token.list  token.deriveAddress  token.generateSeed

network.getActive  network.setActive  network.list
```

**Missing (exists in `vault.js`, unexposed):** `keyring.list`, `keyring.addSeed`,
`keyring.addPrivateKey`, `keyring.rename`, `keyring.remove`,
`account.setLabelAuthenticated`, `wallet.removeLegacyBackup`.

**⚠️ `api-router.js:96`** `handlers[method]` is a plain property lookup on an object literal, so
`bridge.send('constructor')` resolves to `Object` and returns `{ok:true}` instead of
`UNKNOWN_METHOD`. Use `Object.prototype.hasOwnProperty.call`.

**⚠️ Auto-lock is a fixed-period alarm** (`index.js:10-15`), not inactivity-based, and is not
(re)created after `wallet.create` / first `unlock`. `screens/settings.js:36` mislabels it "Lock after
inactivity".

### ☠️ `src/background.js` — 19 lines

Superseded by `src/background/index.js`. Zero importers, not in `build.mjs`. Delete.

---

## 6. `src/ui/` — shared frontend layer

### `src/ui/bridge.js` — 77 lines ✅

**The only sanctioned path from UI to background.** `send(method, params)` → resolves `data` or
rejects with `{ message, code, retryable }`. `bootstrap()` → `system.bootstrap` in one round-trip.

⚠️ `onEvent()` (:52-60) has **zero callers**, so background push events (`accountsChanged`,
`lockStateChanged`, `networkChanged`) are never consumed. It also omits a `sender.id` check, unlike
the background listener.

### `src/ui/router.js` — 250 lines ⚠️ — **read this before touching navigation**

Screen registry + `navigate()` + history stack + legacy fallback.

`navigate()` at :124-139 behaves in two mutually destructive ways:

```
if a module is registered for the id:
    _hideAllLegacyScreens()                  :127
    container = getElementById('screen-'+id) :236
    container.innerHTML = ''                 :133   <-- DESTROYS popup.html's static markup
    module.mount(container, params)
else:
    _legacyShow(id)                          :138   <-- only toggles .hidden
```

Because `popup.js:99` registers legacy `show()` as the fallback and `popup.js:272-287` always makes
its first navigation through the router, **the static markup of `#screen-welcome`, `#screen-unlock`
and `#screen-dashboard` is destroyed at startup**, while the 26 `show('...')` calls inside
`handleAction` never mount a module. This is the root cause of most frontend defects.

⚠️ `_history.push(this._current)` at :117 stores navigation **params verbatim**, and secrets are
passed as params (`create-password.js:87`, `export-password.js:85`). The "wipes secret on unmount"
comments in `backup.js:5` / `export-reveal.js:5` are therefore false.

Dead API (zero callers): `back()` :154, `canGoBack()` :182, `getCurrentScreen()` :166,
`getCurrentParams()` :174, `updateCurrentScreen()` :197, `onBeforeNavigate`/`onAfterNavigate` :51-54.

### `src/ui/store.js` — 153 lines ⚠️

`setState` / `getState` / `select` are used. `subscribe()` :74 and `get()` :32 have **zero callers**,
so `notify()` :104 always iterates an empty set. `currentScreen` is set only by legacy `show()`
(`popup.js:93`) and is therefore permanently wrong for module screens.

### `src/ui/events.js` — 156 lines ⚠️ — functionally inert

`emit` / `on` are used. `once()` :54, `removeAll()` :79, `destroy()` :105 have zero callers.

11 of 24 `Events.*` constants have neither producer nor consumer (:123-149). Eight more are emitted
with **zero** subscribers. The only three subscribed events are registered in
`screens/dashboard.js:200-202` and torn down by its `cleanup()` at :283 — so
`screens/faucet.js:68` and `screens/send.js:343` emit `BALANCE_UPDATED` into an empty handler set
and the balance does not refresh.

### `src/ui/components/`

| File | Lines | Status | Notes |
| --- | --- | --- | --- |
| `drawer.js` | 91 | ✅ | bottom-sheet overlay. `Drawer.closeAll()` :84 is dead. |
| `account-switcher.js` | 204 | ⚠️ | account drawer with search. Unescaped label at :85/:89/:112/:116. `router.navigate('account-detail')` :155 and `('rename-account')` :163 **do nothing on `desktop.html`** (no container). |
| `network-switcher.js` | 65 | ⚠️ | uses `.tag-accent` :33 and `.status-dot` :26 — both undefined in the popup CSS bundle |
| `token-row.js` | 44 | ⚠️ | :23 injects an inline `onerror=` handler via `innerHTML` — **blocked by CSP**, so the logo fallback never fires. Unescaped `src`/`alt`. |
| `token-selector.js` | 130 | ⚠️ | unescaped query :78 and metadata :86-100; `data-token='${JSON.stringify(t)…}'` :92 round-trips an object through the DOM and `JSON.parse` :122 is unguarded |
| `recipient-selector.js` | 145 | ⚠️ | unescaped labels :71-98. Imports `formatThru` :5 and never uses it. |
| `tx-review.js` | 68 | ✅ | pre-sign review card. Only ever emits `negative`, so `.balance-change-box.positive` CSS is dead. |
| `skeleton.js` | 31 | ☠️ | zero importers. Its CSS (`components.css:1063-1111`) is dead too. |

---

## 7. `src/popup/` — the popup the user actually sees

### `src/popup/popup.js` — 1118 lines ⚠️ — the monolith

The live application. ~51% of it is unreachable.

| Region | Lines | Status |
| --- | --- | --- |
| imports (all of `ui/` + all 20 screens) | 1-32 | ✅ |
| `FAUCET_MAX_PER_CLAIM` | 36 | ⚠️ third copy (also `desktop.js:9`, `screens/faucet.js:13`) |
| `injectIcons()` | 39-44 | ⚠️ byte-identical to `desktop.js:40-45` |
| `show()` legacy navigator | ~85-99 | ✅ live; :93 sets `store.currentScreen`; :99 registers itself as the router fallback |
| `setError(id, msg)` | 102-112 | ⚠️ one of **eight** copies |
| `refsEqual` | 114-117 | 💀 one of three copies |
| `renderMnemonicGrid` | 119-126 | ⚠️ `span.innerHTML` at :123 |
| module-scope secrets | 129-136 | ⚠️ `pendingMnemonic`, `pendingExportSecret`, `pendingExportRef` — **not cleared on lock** |
| `updateSendScreenState` | 148-195 | 💀 duplicate of `screens/send.js:373-419` |
| `checkRecipientAddress` | 197-243 | 💀 character-identical to `screens/send.js:434-465` |
| `init` / `proceedAfterDisclaimer` | 245-291 | ✅ always routes first navigation through the router |
| `loadDashboard` / `refreshBalance` | 293-410 | ✅ duplicate of `screens/dashboard.js:220-278` |
| `renderAccountsList` | 307-351 | 💀 unreachable (`#screen-accounts` has no entry point) |
| history helpers | 412-452 | 💀 identical to `screens/history.js:18-33,127` |
| `renderExportReveal` | 454-473 | ⚠️ **:465 writes the mnemonic to `grid.dataset.raw` and nothing ever deletes it** |
| `handleAction` switch | ~490-1014 | ⚠️ ~28 of its cases are unreachable |
| `case 'go-dashboard'` | 537-544 | ⚠️ unguarded `getElementById(...).innerHTML` at :541-542 |
| `case 'lock'` | 1003-1010 | ⚠️ does not null the module-scope secrets |
| global keyboard handlers | 1071-1090 | ⚠️ Enter clicks the first `.btn.primary` — on the send preview that is "Sign & Broadcast" |
| delegated `data-action` listener | 1029-1033 | ⚠️ fires for module-rendered buttons too → double handling |

### `src/popup/popup.html` — 428 lines ⚠️

~66% dead markup. Contains static `<section id="screen-*">` blocks for welcome, unlock, dashboard,
accounts, add-key, export-password, export-reveal, rename-account, send, send-preview, receive,
faucet, history. Several are destroyed at startup by `router.js:133`.

⚠️ **:95, :99, :138** — the mnemonic and private-key textareas that are actually rendered lack
`spellcheck="false"` and `autocomplete="off"`.
⚠️ **:6-8** — Google Fonts loaded from the network on every open.
Dead ids never written by any JS: `#network-label` :421, `#faucet-status` :401,
`#send-submit-btn` :356, `#tx-review-container` :366.
`#export-privatekey-display` :168 is read by `popup.js:458,542,800` but the module renamed it to
`#export-pk-display` (`screens/export-reveal.js:45`).

Contains **zero** inline `on*` handlers — correct.

### `src/popup/screens/` — 20 files

Registered with the router. Reachable ones are entered from module screens; the rest are shadowed by
`handleAction`'s `show()` calls.

| File | Lines | Status | Reached from / why dead |
| --- | --- | --- | --- |
| `dashboard.js` | 288 | ⚠️ | reachable. **Its `cleanup()` :283 removes the pill/copy/lock/refresh listeners (:205-208) and `go-dashboard` never re-mounts it → those four buttons die permanently** |
| `unlock.js` | 127 | ✅ | `popup.js:280,287`; `dashboard.js:158`. Strictly better than the legacy markup (show/hide, autofocus, empty guard). |
| `welcome.js` | 27 | ✅ | `popup.js:272,285`. 100% duplicate of `popup.html:50-54`. Imports `icons` :6 unused. |
| `send.js` | 489 | ⚠️ | `dashboard.js:163`. Has a zero-amount guard :292-295 the monolith lacks; loses the inline error the monolith sets. |
| `receive.js` | 68 | ✅ | `dashboard.js:164` |
| `faucet.js` | 99 | ⚠️ | `dashboard.js:165`. Emits `BALANCE_UPDATED` into an empty handler set → no refresh. |
| `history.js` | 141 | ✅ | `dashboard.js:166`. Adds filter chips the monolith lacks. |
| `settings.js` | 148 | ⚠️ | `popup.js:1013`, `dashboard.js:150`. `cleanup()` :132-137 passes **fresh arrows** to `removeEventListener` → listeners stack on every network switch. Version string :72 says `v0.1.0` vs manifest `1.2.0`. |
| `reset-confirm.js` | 85 | ⚠️ | `settings.js:128`. Reachable via Settings; if later re-shown by `popup.js:528 show()` the confirm button is inert. |
| `add-key.js` | 103 | ✅ | `account-switcher.js:199` |
| `rename-account.js` | 103 | ⚠️ | `account-switcher.js:163`. **:40 `value="${currentName}"` is an attribute breakout.** |
| `account-detail.js` | 147 | 💀 | `router.navigate` is called but `popup.html` has no `#screen-account-detail` and no `#app-root` → `mount()` never runs |
| `create-password.js` | 122 | 💀 | no `router.navigate('create-password')` anywhere; `popup.js:499 show()` wins |
| `backup.js` | 115 | 💀 | only navigator is dead `create-password.js:87` |
| `import.js` | 168 | 💀 | no `router.navigate('import')`; has empty-input validation the live path lacks |
| `export-password.js` | 123 | 💀 | only navigator is dead `account-detail.js:127` |
| `export-reveal.js` | 105 | 💀 | only navigator is dead `export-password.js:85` |

**💀 Whole feature unreachable: secret export.** `data-action="go-export-password"` exists only at
`popup.html:255` inside `#screen-accounts`, and every path into `#screen-accounts` requires already
being inside it. The modular path is dead as shown above. **A user cannot export their recovery
phrase or private key.**

### Other popup files

| File | Lines | Status | Notes |
| --- | --- | --- | --- |
| `icons.js` | 69 | ⚠️ | SVG set + `byteMarkHtml` identicon. :62 degrades to a constant pattern for empty addresses. |
| `toast.js` | 60 | ✅ | uses `textContent` :39 — the correct pattern, and proof the codebase knows it |
| `qr.js` | 63 | ✅ | canvas `fillRect` only, no network |
| `vendor/qrcode-generator.js` | — | ✅ | no `eval`, no `innerHTML`, no network |

### `src/popup/styles/` — 2494 lines total

| File | Lines | Notes |
| --- | --- | --- |
| `popup.css` | 6 | `@import` aggregator only |
| `tokens.css` | 116 | ✅ **the good file** — thru.org palette, type, spacing, radius, motion, popup dimensions. Keep. |
| `base.css` | 90 | reset; `* { margin: 0 }` :7; `--popup-width` 408px :12 |
| `components.css` | 1593 | ⚠️ `.icon-btn.copied` defined twice (:97, :634); ~200 lines dead |
| `screens.css` | 689 | ⚠️ `.account-pill-address` defined twice and conflicting (:225, :686) |

**⚠️ Used in JS/HTML but defined nowhere** — the reason every modular screen looks broken:
`.w-100` (26 sites), `.mt-1`–`.mt-4`, `.mb-2`, `.mb-3`, `.my-2`, `.my-3`, `.py-4`, `.ml-2` (~40
sites), `.clickable`, `.spinning`, `.sm`, `.dash-assets-section`, `.dash-assets-header`,
`.dash-tokens-list`, `.token-avatar-text`, `.fallback`, `.detail-val`, `.account-detail-actions`,
`.btn.lg`, `.btn.sm`.
`.tag-accent` and `.status-dot` exist **only** in `desktop.css` (:222, :121), which the popup does
not import.

**Defined but never referenced:** `.tx-preview*` (:540-586), `.dash-tab*` (:1245-1282),
`.tab-tabular-nums` (:1113), `.notice` (:208), all `.skeleton-*` + `.w-60/40/30` (:1063-1111),
`.balance-change-box.positive` (:1156).

---

## 8. `src/desktop/` — the full-tab launchpad

Opened via `chrome.tabs.create({url: chrome.runtime.getURL('desktop.html')})` from
`popup.js:531-535` and `screens/dashboard.js:169-172` (duplicated verbatim). **Not referenced from
`manifest.json`** — which is correct for an extension-internal page.

| File | Lines | Status | Notes |
| --- | --- | --- | --- |
| `desktop.js` | 506 | ⚠️ | **third routing implementation** — own hash `ROUTE_MAP` :19-30, `switchTab()` :130-144. Does not use `ui/router.js`, `ui/store.js`, or `ui/events.js`. |
| `desktop.html` | 444 | ⚠️ | Google Fonts :7-9. Uses `.btn.lg` / `.btn.sm` / `.status-text` / `.form-card` — none defined. |
| `desktop.css` | 1057 | ⚠️ | imports `tokens.css` + `base.css` + `components.css` but **not** `screens.css` → ~900 lines of `components.css` ship unused here |

Duplicated from the popup: `injectIcons` (:40-45 ≡ `popup.js:39-44`), `FAUCET_MAX_PER_CLAIM` :9,
`activeNetwork` literal :11-12, `refreshBalance` :101-118, account header render :93-99,
`updateNetworkStatus` :120-128.

Divergences worth knowing:
- ⚠️ `:275-287` `updateSwapEstimate` uses `parseFloat` + a hardcoded rate — **float math on money**,
  exactly what `shared/format.js` exists to prevent
- ⚠️ `:115-117` the `catch` branch of `refreshBalance` forgets to reset `#swap-user-balance`
- ⚠️ `:319-335` faucet claim has no input and no validation, and passes a **String** where the popup
  passes a Number (both survive only because `tx-service.js:26` coerces with `BigInt`)
- ⚠️ `:174-175` accepts `http://` and arbitrary `data:` for a logo preview, fetched on every keystroke
- ⚠️ no inline error surface at all — everything is a toast
- ⚠️ the shared account switcher's detail/rename buttons are **inert here** (no `#screen-*` container)

---

## 9. `src/shared/` and `src/domain/`

| File | Lines | Status | Notes |
| --- | --- | --- | --- |
| `shared/format.js` | 42 | ✅ | `formatThru`, `parseThruAmount`, `truncateAddress`. Strict `^\d+(\.\d+)?$` + BigInt only. **The single source of truth for money.** |
| `domain/wallet-model.js` | 177 | 💀 | sole importer is the dead `screens/account-detail.js:13` |
| `domain/asset.js` | 128 | ☠️ | zero importers |

---

## 10. `src/manifest.json` — 30 lines ⚠️

MV3. Popup + side panel both `popup.html`. Service worker `background.bundle.js`.
Permissions: `storage`, `alarms`, `sidePanel`.

⚠️ **CSP :28** is `script-src 'self'; object-src 'self'` — no `default-src`, so `frame-src`,
`img-src`, `style-src`, `connect-src`, `form-action` and `base-uri` are unrestricted.
⚠️ **`side_panel` :24-26** is declared but nothing calls `chrome.sidePanel.*`. This matters for
security: as a side panel the document can live for days, so anything left in the DOM persists.
⚠️ **`clipboardRead` is missing** but `popup.js:641` and `screens/send.js:196` call
`navigator.clipboard.readText()` → the "Paste" button always fails.

---

## 11. Cross-cutting duplication ledger

| Logic | Copies | Locations |
| --- | --- | --- |
| `setError` | **8** | `popup.js:102`, `send.js:468`, `faucet.js:80`, `unlock.js:106`, `create-password.js:99`, `import.js:143`, `add-key.js:82`, `export-password.js:101` |
| mnemonic grid render | **3** | `popup.js:119`, `backup.js:64`, `export-reveal.js:62` |
| `refsEqual` | **3** | `popup.js:114`, `account-switcher.js:11`, `recipient-selector.js:8` |
| `FAUCET_MAX_PER_CLAIM` | **3** | `popup.js:36`, `desktop.js:9`, `faucet.js:13` |
| `formatThru` / `parseThruAmount` | **2** | `shared/format.js:5-36`, `lib/thru-client.js:39-73` |
| `injectIcons` | **2** | `popup.js:39`, `desktop.js:40` |
| send form state + address check | **2** | `popup.js:148-243`, `send.js:373-465` |
| balance + token list render | **2** | `popup.js:353-410`, `dashboard.js:220-278` |
| history row + decode helpers | **2** | `popup.js:412-452`, `history.js:18-130` |
| routing | **3** | `popup.js` `show()`, `ui/router.js`, `desktop.js` `switchTab()` |

---

## 12. Traps — things that will waste your time

1. **`src/popup/screens/` is mostly not what runs.** The live UI is `popup.js` + `popup.html`. Verify
   reachability before editing a screen module.
2. **Editing `popup.html` markup for welcome / unlock / dashboard may have no effect** — `router.js:133`
   wipes those containers at startup.
3. **`removeEventListener` with a fresh arrow function removes nothing.** Six sites do this:
   `settings.js:132-137`, `dashboard.js:205-208`, `import.js:137-138`,
   `account-detail.js:132-134`, `export-reveal.js:87-88`, `backup.js:98-100`.
4. **Inline `on*` attributes injected via `innerHTML` are silently blocked by CSP.** Six
   `onsubmit="return false;"` and one `onerror=` exist and do nothing.
5. **`src/background.js` is not the service worker.** `src/background/index.js` is.
6. **Most of `src/` is untracked in git** (`src/ui/`, `src/popup/screens/`, `src/background/`,
   `src/desktop/`, `src/shared/`, `src/domain/`). Commit before refactoring so rollback exists.
7. **`dist/sidepanel.html` has no source** and is not produced by `build.mjs`. Do not treat `dist/`
   as reproducible until that is resolved.
8. **Amount units are an open question.** Faucet takes raw base units; Send takes human-scale THRU.
   Neither is confirmed against a live network.
