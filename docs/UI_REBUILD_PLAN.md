# Thru Wallet — Frontend Rebuild Plan (Rabby-class UI, future-proof)

Status: proposal, not yet implemented.
Owner: this document is the contract. The executable instruction set for an AI agent is
`docs/UI_REBUILD_AGENT_PROMPT.md`.

---

## 0. What I could and could not verify

| Source | Access | Used for |
| --- | --- | --- |
| `src/**` of this repo | full read | audit facts below (all `file:line` refs verified) |
| `github.com/RabbyHub/Rabby` `src/` tree | fetched directory listings | route/view/component naming and layering facts |
| `comet-extension://acmacodkjbdgmoleebolmdjonilkdbch/...` | **no access** | — |

`comet-extension://` URLs resolve only inside your browser profile. I have no browser, no
screenshot, and no DOM access to a running extension. So every statement about *how Rabby looks*
is inferred from its open-source view/component structure, not from pixels.

**To get pixel-accurate cloning, do one of these and drop the artifacts in `docs/reference/`:**

1. Open each URL, `Ctrl+Shift+I` → Elements → right-click `<body>` → Copy → Copy outerHTML.
   Save as `docs/reference/<route>.html`. Also copy the computed styles panel for the 3–4 key
   containers.
2. Or screenshot each route at 2x (`Ctrl+Shift+P` → "Capture full size screenshot") into
   `docs/reference/<route>.png`.
3. Or `git clone https://github.com/RabbyHub/Rabby` locally so the agent can read the actual
   `.less` files and JSX for the six views listed in §2.

Without (1), (2), or (3) an agent will produce a *Rabby-shaped* UI, not a Rabby-identical one.

> Licensing note: Rabby is MIT-licensed. Reusing its **layout patterns, information architecture,
> and route naming** is fine. Do not paste its source verbatim into this repo without carrying the
> MIT notice. This plan deliberately specifies an independent implementation.

---

## 1. Current state — why this is a rebuild, not a patch

Full audit findings are summarized here; each was verified by reading the file.

### 1.1 The frontend has two incompatible routers fighting each other

`src/popup/popup.js:99` registers the legacy `show()` function as the router's fallback:

- `src/ui/router.js:133` does `container.innerHTML = ''` on the element `#screen-<id>` — which is
  the same element that holds `popup.html`'s static markup for that screen.
- So the first `router.navigate('dashboard')` (`popup.js:278`) **destroys** the static markup of
  `#screen-dashboard`.
- Meanwhile 26 of 28 navigation sites in `handleAction` call `show('...')`, which only toggles
  `.hidden` and never mounts the module.

Consequences confirmed by code reading:

| Symptom | Cause |
| --- | --- |
| Dashboard's switch-account / copy / lock / refresh buttons die permanently after visiting History, Receive, Faucet or Settings and coming back | `go-dashboard` is handled by the monolith (`popup.js:1029-1033` → `loadDashboard()` → `show()`), so `dashboardScreen.mount()` never re-runs after `cleanup()` removed the listeners at `dashboard.js:205-208` |
| **Secret export is completely unreachable** | `data-action="go-export-password"` exists only at `popup.html:255` inside `#screen-accounts`; every path into `#screen-accounts` requires already being inside it. The modular path (`account-detail.js:127`) is also dead — see next row |
| Account detail screen never renders | `account-switcher.js:155` calls `router.navigate('account-detail')`, but `popup.html` has no `#screen-account-detail` and no `#app-root`, so `router.js:131`'s `if (container)` fails silently |
| "Yes, Reset This Wallet" can become a no-op | reaching reset-confirm via Settings mounts the module; reaching it later via `unlock.js:42` → `popup.js:528 show('reset-confirm')` re-shows the module's DOM *after* its `cleanup()` removed the button listener |
| Enter on the send review step re-runs "Review" instead of broadcasting | `popup.js:1077` picks the first `.btn.primary:not(:disabled)`; `send.js` collapsed two screens into one container so `#send-review-btn` (`send.js:144`) precedes `#send-confirm-btn` (`send.js:151`) |

### 1.2 ~70 KB of the shipped bundle is unreachable

Bundled by esbuild (because `popup.js:16-32` imports all 20 screens) but never mounted:
`screens/account-detail.js`, `create-password.js`, `backup.js`, `import.js`, `export-password.js`,
`export-reveal.js`, and `domain/wallet-model.js` — ≈30 KB.
Plus ≈51% of `popup.js` and ≈66% of `popup.html` are dead branches/markup, ≈32 KB.
Plus three files with zero importers: `src/background.js`, `src/domain/asset.js`,
`src/ui/components/skeleton.js`.

### 1.3 The CSS utility classes the modular screens depend on do not exist

`.w-100`, `.mt-1`…`.mt-4`, `.mb-2`, `.mb-3`, `.my-2`, `.my-3`, `.py-4`, `.ml-2`, `.tag-accent`,
`.status-dot`, `.spinning`, `.clickable`, `.btn.lg`, `.btn.sm` are used at ~80 sites across
`src/popup/screens/**` and `src/ui/components/**` and are **not defined** in
`src/popup/styles/**`. `base.css:7` sets `* { margin: 0 }` and the module wrappers
(`#unlock-form`, `#send-form-view`, …) are not flex containers, so every modular screen renders
with its fields, error text and buttons flush against each other. The legacy `popup.html` looks
correct only because its fields are direct children of `.screen`, which supplies
`gap: var(--sp-4)` at `screens.css:130-136`.

`.tag-accent` and `.status-dot` exist only in `desktop.css:222` / `desktop.css:121`, which the
popup bundle does not import.

### 1.4 Secret-handling defects

| Ref | Issue |
| --- | --- |
| `popup.js:465` | `grid.dataset.raw = secret.mnemonic` — the seed phrase is written into a DOM attribute and **never removed**. The three cleanup sites (`popup.js:541`, `:799`, `:1003`) only clear `innerHTML`. `manifest.json:24-26` registers `popup.html` as a **side panel**, so that document can live for days. |
| `popup.js:1003-1010` | `case 'lock'` does not null `pendingMnemonic` (`:129`) or `pendingExportSecret` (`:136`), so `copy-export-secret` (`:882`) still copies the seed to the clipboard **after the wallet is locked** |
| `router.js:117` | secrets are passed as navigation params (`create-password.js:87`, `export-password.js:85`) and pushed verbatim into `_history`, so the "wipes secret on unmount" comments at `backup.js:5` / `export-reveal.js:5` are false |
| `popup.html:95`, `:99`, `:138` | the mnemonic and private-key textareas that are **actually rendered** have no `spellcheck="false"` and no `autocomplete="off"`. With Chrome Enhanced Spell Check on, seed words are sent to Google. The hardened versions at `import.js:41` / `add-key.js:35` are in the dead modules. |
| `token-row.js:23` | `onerror="..."` inline handler injected via `innerHTML` — blocked by `manifest.json:28`'s `script-src 'self'`, so the logo fallback silently never fires |
| 20+ sites | account labels, search queries and token metadata are interpolated into `innerHTML` with **no escaping helper anywhere in the repo**. `rename-account.js:40` is an attribute-value breakout (`value="${currentName}"`), and `vault.js:226-232` applies no length or charset limit, so `maxlength="32"` is client-side only. |
| `manifest.json:28` | CSP has no `default-src`, so `frame-src`/`img-src`/`style-src`/`connect-src`/`form-action`/`base-uri` are unrestricted — an injected `<iframe src="https://evil">` renders inside trusted extension chrome |
| `popup.html:6-8`, `desktop.html:7-9` | Google Fonts is fetched on every popup open — a usage oracle for a wallet, and a CSS-injection vector |
| everywhere | no unlock rate limiting (`vault.js:208-217`, `wallet-service.js:55`); auto-lock is a fixed-period alarm (`background/index.js:10-15`) while `settings.js:36` calls it "Lock after inactivity" |

### 1.5 The single most important finding: your multi-seed backend already exists and is unreachable

`src/lib/vault.js` implements the full Rabby-style keyring model:

```
vault.js:322  listKeyrings()
vault.js:333  addSeedKeyring(mnemonic, password, label)      // multi-seed, dedupes phrases
vault.js:347  addPrivateKeyKeyring(privateKeyHex, password, label)
vault.js:361  renameKeyring(keyringId, label, password)
vault.js:369  removeKeyring(keyringId, password)
vault.js:234  setAccountLabelAuthenticated(address, label, password)
vault.js:312  removeLegacyBackup(password)
```

`src/background/api-router.js` exposes **none of them**. Grep across `src/` finds zero callers
outside `vault.js` itself. There is no `keyring.*` namespace in the router.

Worse, `api-router.js:61` wires `account.addImported` to `accountService.addImportedKey` →
`vault.js:463`, which is explicitly documented at `vault.js:461-462` as the **legacy path that
skips password verification**. The safe, password-checked `addPrivateKeyKeyring` is unused.

So "multi-seed like Rabby" is roughly a **one-file backend change** (`api-router.js`) plus UI.
This is the cheapest high-value work in the whole project and it is Phase 1.

---

## 2. Rabby route → Thru route map

Verified against Rabby's `src/ui/views/` directory listing.

| Your URL | Rabby view | Thru route (target) | Notes |
| --- | --- | --- | --- |
| `popup.html#/dashboard` | `views/Dashboard` | `#/dashboard` | account pill + total balance + asset list + action row + network footer |
| `popup.html#/switch-address` | `views/AddressManagement` | `#/accounts` | search box; rows **grouped by keyring**; each row has an info affordance → detail |
| `popup.html#/settings/address-detail?address=…&type=HD%20Key%20Tree&byImport=true` | `views/AddressDetail` | `#/account?ref=<opaque>` | `HD Key Tree` ⇒ our `keyring.type === 'seed'`; `byImport` ⇒ imported vs generated phrase |
| `…?type=Simple%20Key%20Pair` | same view, other branch | same route | `Simple Key Pair` ⇒ our `keyring.type === 'privateKey'` |
| `popup.html#/add-address` | `views/AddAddress` | `#/add-account` | option cards: new seed / import seed / import private key / next account from existing seed |
| `popup.html#/send-token?rbisource=dashboard` | `views/SendToken` | `#/send?token=native&src=dashboard` | `src` is analytics/back-target only, never trusted |
| `desktop.html#/desktop/profile` | `views/DesktopProfile` + `views/DesktopRoute.tsx` | `desktop.html#/profile` | wide layout, left nav (`component/DesktopNav`) |
| `desktop.html#/desktop/profile?action=send` | same, `action` opens an overlay | `desktop.html#/profile?action=send` | **copy this pattern**: overlays are addressable via query param |

Three structural lessons from Rabby worth copying exactly:

1. **`views/SortHat.tsx`** — a boot gate that decides the landing route (no vault → welcome,
   locked → unlock, else dashboard). Replaces our ad-hoc `proceedAfterDisclaimer()`.
2. **`component/PrivateRoute.tsx`** — a declarative guard for routes needing an unlocked wallet.
   Replaces scattered `if (!isUnlocked)` checks.
3. **`views/MainRoute.tsx` vs `views/DesktopRoute.tsx`** — two route trees, one component
   library. This is exactly the popup/desktop split we need, done properly.

Also note: Rabby keeps `src/migrations/` and `src/@types` + `src/types` at the top level. Those
two directories are the reason a 4-year-old Rabby install still upgrades cleanly. We have neither.

### 2.1 Gap this map exposes

Rabby's `byImport=true` distinguishes an imported seed phrase from a generated one. Our
`seedKeyring()` at `vault.js:62-71` does not record provenance. Add
`origin: 'generated' | 'imported'` to the keyring record, defaulted by a migration. Without it the
account-detail screen cannot show "Backup your phrase" only where it is meaningful.

---

## 3. Target architecture

```
src/
  shared/                 # imported by BOTH sides. no chrome.*, no DOM.
    contract/
      manifest.js         # THE frozen API surface: method -> {params, returns, since}
      errors.js           # error codes
    format.js             # single formatThru / parseThruAmount (delete the copy in lib/thru-client.js:39-73)
    refs.js               # encode/decode opaque account refs for URLs

  background/             # MUST NOT import src/ui, src/popup, src/desktop
    index.js
    api-router.js         # validates every request against shared/contract/manifest.js
    migrations/           # numbered, idempotent, tested
    services/
    features/<feature>/   # launchpad, dex, perps, prediction

  ui/
    kit/                  # domain-free primitives. no bridge, no chrome.*
      dom.js              # h(), text(), esc(), on() — the ONLY way nodes are made
      button.js field.js input.js password-input.js textarea.js
      sheet.js modal.js toast.js list.js row.js tabs.js pill-switch.js
      badge.js spinner.js empty.js skeleton.js copyable.js tooltip.js
      search-input.js page-header.js navbar.js card.js amount-input.js
      confirm-slider.js
    domain/               # wallet-aware, still no routing
      account-avatar.js account-row.js keyring-group.js address-viewer.js
      account-selector-sheet.js token-row.js token-selector.js
      recipient-field.js tx-review-card.js network-selector.js
      seed-phrase-grid.js password-prompt.js
    app/
      router.js           # hash router, ONE implementation
      routes.popup.js     # data table: path -> {view, guard, layout}
      routes.desktop.js
      boot.js             # SortHat equivalent
      guards.js           # requireUnlocked, requireVault
      store.js            # one store, subscribe actually used
      bridge.js           # send/onEvent, validates method against contract manifest

  features/<feature>/     # self-contained; registered, never hard-wired
    index.js              # { id, routes, navEntries, enabled }
    views/ services/

  popup/
    popup.html            # SHELL ONLY: <div id="app"></div>. zero screen markup.
    popup.js              # ~30 lines: boot(routes.popup)
    styles/
  desktop/
    desktop.html          # SHELL ONLY
    desktop.js            # ~30 lines: boot(routes.desktop)
```

### 3.1 The four rules that make the backend unbreakable

These are the answer to *"make sure frontend and backend is separate so backend never breaks
because of frontend"*.

**R1 — One seam, and it is data.**
The frontend's only way to reach the backend is `bridge.send(method, params)`. `method` must exist
in `shared/contract/manifest.js`. `bridge.send` throws locally if it does not. `api-router.js`
rejects anything not in the manifest.

**R2 — The contract is append-only.**
Adding a method is always safe. Changing or removing one requires a new name
(`tx.send` → `tx.sendV2`) and keeping the old one until no route references it. A method's shape is
never edited in place.

**R3 — Layering is enforced by a script, not by discipline.**
`scripts/check-layering.mjs` fails the build if:
- anything under `src/background/**` imports from `src/ui/**`, `src/popup/**`, `src/desktop/**`
- anything under `src/ui/kit/**` imports `bridge`, `chrome.*`, or `src/features/**`
- anything under `src/ui/**` imports from `src/background/**` or `src/lib/vault.js`
- any file outside `src/ui/app/bridge.js` calls `chrome.runtime.sendMessage`

**R4 — The contract is tested both ways.**
`test-contract.mjs` asserts manifest ⊇ handlers **and** handlers ⊇ manifest. A backend rename that
forgets the manifest fails CI. A frontend call to a phantom method fails CI. This is the specific
mechanism that would have caught today's `token-service.js:22-25` sending `symbol`/`imageUrl` while
`thru-client.js:455-465` destructures `ticker`/`imageUri` — a live bug where every stored token
record has an empty ticker.

### 3.2 The rule that structurally kills the XSS class

`src/ui/kit/dom.js` exports `h()`. Every node in the app is built with it. It sets text via
`textContent` and attributes via `setAttribute`, and it **refuses** `on*` attribute names and
`javascript:` URLs. Then add to CI:

```
grep -rn "innerHTML\s*=" src/ui src/features src/popup src/desktop   # must be empty
grep -rn "insertAdjacentHTML\|outerHTML\s*=" src/ui src/features     # must be empty
```

Escaping by hand at 20 call sites is a policy that decays. A single node factory plus a grep gate
is a property that holds.

### 3.3 Feature registry — how new things stop breaking old things

A feature is a folder plus one line:

```js
// src/features/index.js
export const FEATURES = [
  require('./launchpad'),   // { id:'launchpad', routes:[...], navEntries:[...], enabled:true }
  require('./dex'),
  require('./perps'),
];
```

Rules:
- A feature may import `ui/kit`, `ui/domain`, `shared/**`. Nothing else.
- A feature adds backend methods only under its own namespace (`launchpad.*`, `dex.*`).
- A feature never edits a core file. If it needs to, that need is a missing kit primitive — add
  the primitive instead.
- `enabled: false` must fully remove it from nav and routes with no other edit.

This is what makes launchpad / pump.fun-style curve / perps / prediction markets additive.

---

## 4. Phase plan

Every phase ends in a **green `npm test` and a loadable extension**. No phase leaves the tree
broken. Phases 0–1 touch zero pixels, which is deliberate: build the safety net before moving
anything.

### Phase 0 — Guardrails (no behaviour change)

1. `src/shared/contract/manifest.js` — transcribe all 34 existing methods from
   `api-router.js:11-83` with their param names. Do not change any handler.
2. `api-router.js` — replace `handlers[method]` with an own-property lookup
   (`Object.prototype.hasOwnProperty.call`) so `bridge.send('constructor')` stops resolving to
   `Object`, and validate `method` against the manifest.
3. `scripts/check-layering.mjs`, `test-contract.mjs`.
4. Add `jsdom` devDependency + `test-ui-smoke.mjs` harness (mount a route with a mocked bridge,
   assert no throw).
5. Wire all of it into `npm test` and a GitHub Action.
6. Delete the three zero-importer files: `src/background.js`, `src/domain/asset.js`,
   `src/ui/components/skeleton.js`.

**Gate:** `npm test` green; extension loads and behaves exactly as before.

### Phase 1 — Unlock the backend you already paid for (backend only, additive)

1. Add to `api-router.js`, wrapping the existing `vault.js` functions:
   `keyring.list`, `keyring.addSeed`, `keyring.addPrivateKey`, `keyring.rename`,
   `keyring.remove`, `account.setLabelAuthenticated`, `wallet.removeLegacyBackup`.
2. Repoint `account.addImported` at the password-checked `vault.addPrivateKeyKeyring`
   (`vault.js:347`), not the legacy `addImportedKey` (`vault.js:463`).
3. Add `origin: 'generated' | 'imported'` to keyring records + `migrations/001-keyring-origin.js`.
4. Add unlock throttling in `wallet-service.unlock` (persisted `{failedCount, lockedUntil}`,
   exponential backoff) — background-enforced, per §1.4.
5. Make auto-lock inactivity-based: stamp `lastActivityAt` in `handleApiRequest`, 1-minute alarm
   compares against it. Fix the `settings.js:36` label later, in its UI phase.
6. Extend `test-api-router.mjs` to cover every new method, including the failure paths.

**Gate:** new methods callable and tested; the old UI still works untouched.

### Phase 2 — Security stop-the-bleed on the current UI (small, surgical)

Do these now because Phase 3+ takes weeks and these are live exposures:

1. Delete `popup.js:465` (`grid.dataset.raw`).
2. Null `pendingMnemonic` / `pendingExportSecret` / `pendingExportRef` in `case 'lock'`
   (`popup.js:1003`), and gate `copy-export-secret` on `isUnlocked`.
3. Add `autocomplete="off" spellcheck="false" autocapitalize="off"` to `popup.html:95,99,138`.
4. Tighten `manifest.json:28` CSP to `default-src 'none'; script-src 'self'; style-src 'self';
   img-src 'self' data:; font-src 'self'; connect-src <rpc origins>; frame-src 'none';
   form-action 'none'; base-uri 'none'; object-src 'none'`.
5. Self-host the two fonts; remove the `fonts.googleapis.com` links from both HTML files.
6. Null-guard the unguarded `getElementById(...)` chains at `popup.js:541-542` and `:799-800`.

**Gate:** manual pass over create → backup → unlock → send → export; no CSP violations in console.

### Phase 3 — New stack, one route

1. Build `ui/kit/dom.js` + the ~8 primitives the unlock screen needs.
2. Build `ui/app/router.js` (hash-based, query params, guards, one implementation),
   `routes.popup.js`, `boot.js`, `guards.js`.
3. `popup.html` gains `<div id="app"></div>`; the legacy `#screen-*` blocks stay for now.
4. Implement `#/unlock` on the new stack. Route the boot gate to it when
   `location.hash === '#/unlock'`, keep the legacy path otherwise, behind
   `NEXT_UI` in `src/shared/flags.js`.
5. `test-ui-smoke.mjs` covers `#/unlock`.

**Gate:** both stacks coexist; flag off ⇒ byte-identical behaviour to Phase 2.

### Phase 4..N — Strangler migration, one route per PR

Order chosen so the highest-risk and most-broken flows land first:

| # | Route | Replaces | Also fixes |
| --- | --- | --- | --- |
| 4 | `#/welcome`, `#/onboarding/*` | `welcome.js` + `popup.html:49-55` | duplicate welcome markup |
| 5 | `#/accounts` (Rabby *switch-address*) | `account-switcher.js` + `renderAccountsList` | label XSS, keyring grouping, multi-seed visible |
| 6 | `#/account?ref=` (Rabby *address-detail*) | `account-detail.js` | screen that never rendered |
| 7 | `#/add-account` (Rabby *add-address*) | `add-key.js` + `import.js` | seed-phrase spellcheck, multi-seed import |
| 8 | `#/export/*` | `export-password.js` + `export-reveal.js` | **restores an unreachable feature**; one-shot secret handoff, no router params |
| 9 | `#/send` | `popup.js` send + `send.js` | duplicate logic, Enter-key mis-target, missing zero guard |
| 10 | `#/dashboard` | `dashboard.js` + `popup.html:174-236` | listener-death bug in §1.1 |
| 11 | `#/history`, `#/receive`, `#/faucet` | corresponding screens | dead `#faucet-status`, `#network-label` |
| 12 | `#/settings/*` | `settings.js` | real `removeEventListener`, version string, auto-lock label |
| 13 | `desktop.html#/profile` | `desktop.js` | third routing impl, float math at `desktop.js:275-287`, dead account-switcher buttons |

Per-route definition of done:
- new route reachable, guarded, and in `test-ui-smoke.mjs`
- **the legacy screen's markup, `handleAction` cases, and CSS are deleted in the same PR**
- CSS-class audit script passes (no undefined, no unused)
- no `innerHTML =` introduced

Deleting the old copy in the same PR is what prevents a repeat of today's situation.

### Phase Final — Delete the monolith

`popup.js` shrinks to a boot stub; `popup.html` is a shell; `src/popup/screens/**` and
`src/ui/components/**` are gone (replaced by `ui/domain/**`); dead CSS removed; flags removed.

### Phase Features — Launchpad, DEX, perps, prediction

Only after Phase Final. Each is `src/features/<id>/` + one registry line + its own backend
namespace + its own migration if it stores anything. `desktop.html` is the host for the wide ones.

---

## 5. Design system (what "looks like Rabby" means concretely)

Keep `src/popup/styles/tokens.css` — it is the one genuinely good file in the frontend and it
encodes the thru.org palette. Adopt Rabby's *structure*, not its colors.

Rabby's recurring layout idioms to implement as kit primitives:

| Rabby component | Thru kit equivalent | Where used |
| --- | --- | --- |
| `PageHeader` | `kit/page-header.js` | every non-dashboard route: back chevron, centered title, optional right slot |
| `Popup` (bottom drawer) | `kit/sheet.js` | account selector, token selector, network selector, confirmations |
| `Field` / `FieldCheckbox` | `kit/field.js` | labelled input + inline error + hint, one implementation |
| `AddressViewer` / `NameAndAddress` | `domain/address-viewer.js` | truncated address + copy + explorer link |
| `WordsMatrix` | `domain/seed-phrase-grid.js` | numbered seed grid, reveal/blur, no `innerHTML` |
| `AuthenticationModal` | `domain/password-prompt.js` | password re-auth before any sensitive op |
| `PillsSwitch` | `kit/pill-switch.js` | history filters, send/receive tabs |
| `TokenSelect` / `TokenAmountInput` | `domain/token-selector.js` + `kit/amount-input.js` | send, swap, launchpad |
| `Empty` / `Spin` / `LoadingOverlay` | `kit/empty.js`, `kit/spinner.js` | every list |
| `ToConfirmButton` | `kit/confirm-slider.js` | irreversible actions — replaces the Enter-key hazard at `popup.js:1071-1082` |
| `DesktopNav` / `DesktopPageWrap` | `ui/app/layouts/desktop.js` | `desktop.html` routes |

Layout rules that fix §1.3 permanently:
- delete every `.mt-*` / `.w-100` usage; layout is owned by `kit/card.js`, `kit/list.js` and a
  `stack` primitive that sets `display:flex; flex-direction:column; gap:<token>`
- no component reaches outside its own root node
- CI script extracts class names from JS/HTML and diffs against CSS selectors; both directions fail
  the build

---

## 6. Definition of done for the whole programme

- `npm test` runs: vault, thru-client, api-router, contract (both directions), layering, CSS
  audit, UI smoke for every route. Green.
- `rg "innerHTML\s*=" src/ui src/features src/popup src/desktop` → no matches.
- `rg "chrome\.runtime\.sendMessage" src` → only `src/ui/app/bridge.js`.
- Every route in `routes.popup.js` and `routes.desktop.js` is reachable from the UI by clicking,
  and appears in the smoke test.
- Export seed phrase and export private key work from `#/accounts` → `#/account` → `#/export`.
- Two seed phrases + one imported private key coexist, are grouped in `#/accounts`, and each can
  be renamed, exported and removed.
- After lock, `document.body.outerHTML` contains no mnemonic word and no private key hex.
- `manifest.json` CSP has `default-src 'none'`; no remote font or image requests on open.
- `dist/` reproduces exactly from `rm -rf dist && npm run build` (currently false —
  `dist/sidepanel.html` has no source, contradicting `build.mjs:49-51`).
