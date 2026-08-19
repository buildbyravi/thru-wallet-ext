--# CONTEXT.md -- file-by-file map of thru-wallet-ext

Purpose: let any agent or new contributor answer "where do I look for X?" without grepping the
whole tree. Every line count and `file:line` reference below was verified against the working
tree.

Read `AGENTS.md` first for the rules. `docs/STATUS_AND_ROADMAP.md` for current state and next
steps. `docs/DEFECT_LOG.md` for every defect found and why.

> **The frontend rebuild is complete.** There is ONE UI stack. The legacy `show()`-based tree
> (`src/popup/screens/**`, `src/ui/components/**`, `src/ui/router.js`, `store.js`, `events.js`,
> `bridge.js`, the 1,100-line `popup.js` monolith and ~430 lines of static `popup.html` markup)
> was deleted in `c0ba23a`. If a document elsewhere describes two stacks, it is stale.
> Recover deleted files from git history or `legacy-ui-backup-*.zip` in the root.

---

## 1. Where to look -- quick index

| I need to | Go to |
| --- | --- |
| **build or change a screen** | `src/ui/app/routes/` -- one file per route |
| **create any DOM node** | `src/ui/kit/dom.js` `h()`. Never `innerHTML`. |
| add/change a backend API method | `src/shared/contract/manifest.js` **then** `src/background/api-router.js` |
| touch encryption, keyrings, seed derivation | `src/lib/vault.js` |
| touch RPC, transactions, history decoding | `src/lib/thru-client.js` |
| add or change a network | `src/lib/networks.js` |
| decide if stored data is per-network | `src/shared/network-scope.js` |
| format or parse a THRU amount | `src/shared/format.js` |
| address an account in a URL | `src/shared/refs.js` |
| change colors, spacing, type | `src/popup/styles/tokens.css` |
| register a route | `src/ui/app/boot.js` |
| add an icon | `src/ui/kit/icon.js` (path data, not markup) |
| turn a feature on/off | `src/shared/flags.js` |
| token/AMM/CLOB/oracle program calls | `@thru/programs/*` -- never hand-roll |
| change the build | `build.mjs` |
| change permissions or CSP | `src/manifest.json` |
| verify against a live chain | `scripts/verify-*.mjs` |

---

## 2. Architecture in one picture

```
UI (src/ui)  --------bridge.send(method, params)-------->  api-router  -------->  services  -------->  lib
                                                    --
        <---------------- event-service.emit(event) ----------------------------------------------------
```

Four rules, all enforced by `scripts/check-layering.mjs`:

1. `src/background/**` must not import `src/ui/**` or `src/popup/**` or `src/launchpad/**`
2. `src/ui/**` must not import `src/background/**`, `lib/vault.js` or `lib/thru-client.js`
3. `src/ui/kit/**` must not import the bridge, features, or domain
4. Only `src/ui/app/bridge.js` may call `sendMessage` outbound; only
   `background/services/event-service.js` may push inbound

---

## 3. Root files

| File | Purpose |
| --- | --- |
| `build.mjs` | esbuild. 5 bundles + static copies. `dist/` is reproducible. |
| `test-derivation.mjs` | **Runs first.** Golden vectors: a fixed phrase must derive fixed addresses. |
| `test-contract.mjs` | Contract --! router agreement, both directions. 34 checks. |
| `test-ui-dom.mjs` | `h()` security properties + ref codec. 89 checks, DOM shim. |
| `test-vault.mjs` | Real vault against real `@thru/crypto`. |
| `test-thru-client.mjs` | Instruction layouts, amount round-trips, network binding. |
| `test-api-router.mjs` | Background integration + JSON-serializability probes. |
| `scripts/check-layering.mjs` | Import boundaries + DOM-sink ratchet (**at 0**). |
| `scripts/check-routes.mjs` | Route reachability + CSS class existence. |
| `scripts/verify-*.mjs` | Live-chain reports. **Not** in `npm test`. |
| `legacy-ui-backup-*.zip` | The deleted legacy UI. Gitignored. |

`npm test` order: derivation --  layering --  routes --  contract --  dom --  vault --  thru-client -- 
api-router. Guards first, so structural breakage fails fast.

---

## 4. `src/lib/` -- the sacred layer

Change only for a verified bug or a tested additive primitive.

### `src/lib/vault.js` -- 737 lines

Encrypted vault and keyring model. PBKDF2 600k + AES-256-GCM. Encrypted blob in
`chrome.storage.local`; decrypted vault and derived key in `chrome.storage.session` only.

Keyrings: `seed` (derives many HD accounts) and `privateKey` (exactly one). Each carries
`origin: 'generated' | 'imported' | 'unknown'` and, for seeds, `backedUpAt`.

Notable functions: `createVault`, `unlock`, `lock`, `resetWallet`, `listKeyrings`,
`createSeedKeyring` (generates a phrase **in the background** and never returns it),
`addSeedKeyring`, `addPrivateKeyKeyring`, `renameKeyring`, `removeKeyring`, `setKeyringBackedUp`,
`previewHdAccounts` (derives without persisting), `addHdAccounts` (batch, one AES write),
`removeHdAccount`, `resolveAccount`, `exportAccountSecret`, `exportAccountPrivateKey`,
`verifyMasterPassword`, `sanitizeLabel`.

Password-verified operations re-check against the **encrypted blob**, not session state.

### `src/lib/thru-client.js` -- 703 lines

RPC, transaction construction, history decoding, token deployment.

**Network binding matters here.** `configureNetwork(config)` sets the RPC URL and program
addresses; `network-service` calls it on every config read and on switch. Before that existed the
client memoized a hardcoded alphanet URL, so network switching was cosmetic.

Token derivation delegates to `@thru/programs/token` -- `deriveTokenMintAddress` needs a mint
authority and a **64-hex-character** seed. `generateMintSeed()` produces exactly that.

### `src/lib/networks.js` -- 193 lines

Every network as data. `alphanet` and `localnet` are `enabled: true`; `testnet` and `mainnet` are
declared but `enabled: false` so the shape is exercised before they are real.

Per-network fields that must never become module constants: `rpcUrl`, `explorerUrl`, the three
program addresses, `faucetStateAccount`, `faucetMaxPerClaim`, `baseFeeUnits`, `feeReserveUnits`,
`isTestnet`.

`baseFeeUnits` is `1n` on alphanet (**measured**) and `null` on testnet/mainnet, so
`tx.estimateFee` reports unknown rather than quoting a devnet number.

---

## 5. `src/background/` -- the service worker

| File | Lines | Purpose |
| --- | --- | --- |
| `index.js` | 62 | Message listener (validates `sender.id`), inactivity auto-lock heartbeat |
| `api-router.js` | 306 | Validates every method against the contract, enforces `auth`, catches unserializable payloads |
| `services/wallet-service.js` | 204 | Lifecycle, unlock backoff, export, on-chain registration |
| `services/keyring-service.js` | 119 | Multi-seed add/create/rename/remove/backup-state |
| `services/account-service.js` | 203 | Public accounts, HD preview/batch/remove, preference ordering |
| `services/tx-service.js` | 308 | Faucet, transfer, history, validation, fee estimate |
| `services/token-service.js` | 165 | Deploy, registry, derivation, visibility |
| `services/balance-service.js` | 201 | Batched + cached balances, **per-network** |
| `services/pending-tx-service.js` | 227 | Submitted-- confirmed tracking, badge, **per-network** |
| `services/preferences-service.js` | 178 | Order/pin/hide, whitelist, settings |
| `services/network-service.js` | 188 | Active network, custom RPCs, **binds thru-client** |
| `services/contacts-service.js` | 82 | Address book |
| `services/auth-service.js` | 99 | Unlock throttling with persisted backoff |
| `services/system-service.js` | 189 | Auto-lock, activity stamping, diagnostics |
| `services/event-service.js` | 47 | The **only** inbound push channel |

Contract v4, **~75 methods**, append-only. `src/shared/contract/manifest.js` (524 lines) is the
allowlist, not documentation.

Deliberately unimplemented, returning `{ supported: false, reason }` rather than fabricated
values: `tx.simulate`, `token.getBalances`.

---

## 6. `src/ui/` -- the only frontend

### `src/ui/kit/` -- domain-free primitives

| File | Lines | Purpose |
| --- | --- | --- |
| `dom.js` | 285 | `h()`, `text()`, `clear()`, `render()`, `on()`, `disposer()`, `isSafeUrl()` |
| `icon.js` | 168 | Icons as `[tag, attrs]` data --  real SVG nodes |
| `button.js` | 166 | `Button`, `IconButton`, `CopyButton` |
| `field.js` | 193 | `Field` -- label + control + error + hint + password reveal |
| `feedback.js` | 124 | `Banner`, `Empty`, `Spinner`, `PageHeader`, `Actions`, `Stack`, `Row` |

**`dom.js` is the entire XSS defense.** Text only via `textContent`; `on*` attribute names throw;
`javascript:`/`vbscript:`/`file:`/`about:`/`blob:` and non-image `data:` URLs are refused; there is
no prop that accepts markup.

### `src/ui/domain/` -- wallet-aware components

`account-avatar.js` (59)  `account-row.js` (151)  `account-picker.js` (147, grouped by keyring)
 `asset-selector.js` (105)  `token-row.js` (88)  `password-prompt.js` (122,
`requirePassword()`)  `seed-phrase-grid.js` (160, grid + backup challenge)

### `src/ui/app/` -- router and routes

`bridge.js` (138)  `router.js` (162)  `guards.js` (138)  `boot.js` (250)  `shell.js` (141,
topbar + network badge + footer)

| Route | File | Lines |
| --- | --- | --- |
| `/welcome` | `routes/welcome.js` | 295 |
| `/unlock` | `routes/unlock.js` | 191 |
| `/dashboard` | `routes/dashboard.js` | 335 |
| `/accounts` | `routes/accounts.js` | 194 |
| `/account?ref=` | `routes/account-detail.js` | 296 |
| `/add-account` | `routes/add-account.js` | 392 |
| `/keyring?id=` | `routes/keyring.js` | 190 |
| `/export?ref=` | `routes/export.js` | 279 |
| `/send` | `routes/send.js` | 671 |
| `/receive` | `routes/receive.js` | 137 |
| `/faucet` | `routes/faucet.js` | 241 |
| `/history` | `routes/history.js` | 234 |
| `/settings` | `routes/settings.js` | 287 |
| `/reset` | `routes/reset.js` | 163 |

**Component contract:** every component returns `{ el, update(props), destroy() }`, and
`destroy()` removes the *same* handler references it added. Use `disposer()`.

---

## 7. `src/shared/` -- imported by both sides

No `chrome.*`, no DOM.

`contract/manifest.js` (524)  `format.js` (42, the only money math)  `refs.js` (92, opaque
account refs for URLs)  `network-scope.js` (87, the per-network vs global split) 
`flags.js` (73)  `autolock.js` (36)

---

## 8. `src/popup/` -- the shell

| File | Lines | Notes |
| --- | --- | --- |
| `popup.js` | 50 | Boot stub. Was 1,118 lines. |
| `popup.html` | 32 | Shell with one `#app`. Was ~430 lines of static screen markup. |
| `icons.js` | 79 | Legacy markup-string icons. Only `launchpad.js` uses it now. |
| `toast.js` | 60 | Uses `textContent`. Only `launchpad.js`. |
| `qr.js` | 63 | Canvas only, no network. Used by `/receive`. |

### `src/popup/styles/` -- 2,573 lines

`tokens.css` (152) light theme matched to thru.org  `base.css` (115)  `utilities.css` (194) 
`components.css` (1,774)  `kit.css` (345)  `screens.css` (793)

Import order matters: tokens --  base --  utilities --  components --  kit --  screens. `kit.css` loads
after `components.css`, which is what lets `.btn.w-auto` beat `.btn { width: 100% }`.

`components.css` and `screens.css` still contain rules for deleted screens. Pruning them is
pending; `check-routes.mjs` catches used-but-undefined, not defined-but-unused.

---

## 9. `src/launchpad/` -- flagged off

`launchpad.js` (522)  `launchpad.html` (443)  `launchpad.css` (1,057)

Emits `launchpad.*`. **`desktop.html` is reserved** for a future expanded-wallet-in-a-tab view.
Hidden behind `FLAGS.FEATURE_LAUNCHPAD`; still built and still covered by the checks.

Uses `ui/app/bridge.js`. Its account/network switcher buttons point users at the popup -- the
legacy drawers they used to open were already non-functional on this page.

---

## 10. `src/manifest.json` -- 30 lines

MV3. Popup + side panel both `popup.html`. Permissions: `storage`, `alarms`, `sidePanel`,
`clipboardRead`.

CSP is `default-src 'none'` with explicit `script-src`/`style-src`/`img-src`/`font-src`/
`connect-src`/`frame-src`/`form-action`/`base-uri`/`object-src`. **No inline `style=""` or
`on*=""` anywhere** -- the browser refuses both.

---

## 11. Traps -- things that will waste your time

1. **Reload the extension, not just the popup.** Chrome caches the service worker, so a backend
   fix appears not to work until the extension card's Reload button is used.
2. **Money is BigInt internally, a STRING on the wire.** `JSON.stringify` throws on BigInt;
   `api-router.js` now names the offending method and field.
3. **The build only WARNS on CSS syntax errors.** Check for `---- [WARNING]`.
4. **Do not ship a control before its destination route exists.** `check-routes.mjs` enforces it.
5. **A test can assert a bug.** `generateMintSeed` had a test demanding the wrong seed length,
   which would have blocked the correct fix.
6. **Amount units differ by screen on purpose.** Faucet takes **base units**; Send takes **whole
   THRU**. Verified on alphanet: claiming 10000 credits 10000 base units.
7. **A transfer recipient must already exist on-chain.** Accounts this wallet creates are
   registered automatically; an external unused address cannot receive.
8. **Never hand-roll a program instruction.** `@thru/programs` ships `token`, `amm`, `multicall`,
   `passkey-manager`, `clob`, `oracle`.
9. **`chrome.storage.session` holds the unlocked session.** It survives a page reload but not an
   extension reload. Use `system.diagnostics` before blaming auto-lock.
