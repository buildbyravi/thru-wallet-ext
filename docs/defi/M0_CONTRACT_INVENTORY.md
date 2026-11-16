# DeFi Contract Inventory (43 Methods)

**Document Class:** Operational Verification (Dark-Launched Contract Reference)
**Source Authority:** `src/shared/contract/manifest.js` (`CONTRACT_VERSION = 33`, `154` total methods) + `src/shared/contract/defi-schema.js` (`43` `DEFI_METHODS`, `24` `UNSUPPORTED_REASONS`)
**Verification Gate:** `test/test-defi-m0.mjs` · Fixtures: `test/fixtures/defi/`

---

## 1. Summary by Group and Flag Gate

All 43 DeFi methods were appended in contract `v17` (`21` `READ` + `8` `LOCAL`) and `v18` (`13` `PREPARE` + `1` `EXECUTE`), with `v20` wiring the native-send intent store and `G3` wiring `dex-service.js` pool/quote/swap handlers. Because `FLAGS.DEFI === false` in `src/shared/flags.js`, `isDefiFeatureEnabled(gate)` evaluates to **`false` for every gated method** in shipped builds.

| Gate (`defi-schema.js`) | Count | Methods | Behavior in Current Build (`FLAGS.DEFI === false`) |
| --- | ---: | --- | --- |
| `'always'` | **4** | `program.capabilities`, `program.list`, `feed.status`, `feed.lookup` | Always callable (`auth: 'none'`). `program.list` returns 19 `ProgramRecord`s; `program.capabilities` reports `FEATURE_DISABLED` on flag-gated capabilities; `feed.*` reports empty/unconfigured publisher state. |
| `'DEFI_MARKET'` | **9** | `market.assetGet`, `assetSearch`, `snapshot`, `candles`, `trades`, `holders` (`none`); `watchlistGet`, `watchlistAdd`, `watchlistRemove` (`unlocked`) | Read methods return `{ supported: false, reason: 'FEATURE_DISABLED' }`; watchlist mutations reject `FEATURE_DISABLED`. |
| `'DEFI_READ'` | **8** | `launchpad.list`, `get`, `templates`, `validateDraft` (`none`); `launchpad.listMine` (`unlocked`); `dex.listPools`, `getPool` (`none`); `dex.positions` (`unlocked`) | Return `{ supported: false, reason: 'FEATURE_DISABLED' }` (when `DEFI` + `DEFI_READ` are enabled in tests, `dex.*` executes real AMM reads and `launchpad.validateDraft` runs offline validation). |
| `'DEFI_LAUNCHPAD'` | **8** | `launchpad.draftList`, `draftGet`, `draftSave`, `draftDelete`, `uploadImage`, `prepareCreate`, `prepareMigrate`, `prepareClaim` (all `unlocked`) | Reject or return `{ supported: false, reason: 'FEATURE_DISABLED' }`. |
| `'DEFI_INTENT'` | **8** | `intent.list`, `get`, `prepareSend`, `rePrepare`, `resume`, `discard`, `stopWaiting` (`unlocked`); `intent.submit` (`signing`) | Reject or return `FEATURE_DISABLED` (`intent.submit` is the only `auth: 'signing'` DeFi method; see `docs/defi/README.md` §3 on required v32 `consentToken` convergence before any flag flip). |
| `'DEFI_DEX'` | **4** | `dex.quote`, `quoteLiquidity` (`none`); `dex.prepareSwap`, `prepareLiquidity` (`unlocked`) | Return `{ supported: false, reason: 'FEATURE_DISABLED' }` (when enabled in `test/test-dex-swap.mjs`, `dex.quote` and `dex.prepareSwap` compute constant-product quotes and swap intents via `src/lib/amm.js`). |
| `'DEFI_RISK'` | **1** | `risk.assetAssess` (`none`) | Returns `{ supported: false, reason: 'FEATURE_DISABLED' }` (deterministic registry-based assessment when flag-enabled in tests). |
| `'DEFI_DESKTOP'` | **1** | `desktop.open` (`none`) | Returns `{ enabled: false, reason: 'FEATURE_DISABLED' }` (no `desktop.html` page exists). |

---

## 2. Handler & Service Ownership

| Namespace | Router Dispatch Target | Backing Implementation |
| --- | --- | --- |
| `program.*` | `src/background/services/program-service.js` | `registry-service.js` + `services/defi/capability-snapshot.js` |
| `feed.*` | `src/background/services/feed-service.js` | `services/defi/feed-record.js` + `src/lib/feed-crypto.js` |
| `market.*` | `src/background/services/market-service.js` | `services/defi/market-reads.js` + `services/defi/read-cache.js` |
| `risk.*` | `src/background/services/risk-service.js` | `registry-service.js` |
| `launchpad.*` | `src/background/features/launchpad/launchpad-handlers.js` | `features/launchpad/launchpad-service.js` |
| `dex.*` | `src/background/features/dex/dex-handlers.js` | `features/dex/dex-service.js` -> `services/dex-service.js` + `src/lib/amm.js` |
| `intent.*` | `src/background/services/intent-service.js` | `services/defi/intent-store.js` (`defi_intents::<networkId>`) |
| `desktop.*` | `src/background/services/desktop-service.js` | Stub returning `{ enabled: false }` |

Push events declared in `manifest.js` (`EVENTS`) for DeFi: `intentChanged`, `capabilitiesChanged`, `feedChanged` (alongside wallet-core `accountsChanged`, `lockStateChanged`, `networkChanged`, `balanceChanged`, `pendingTxChanged`).

### Schema Input Caps (`src/shared/contract/defi-schema.js`)
`validateDefiParams` enforces `MAX_STRING = 512`, `MAX_ID = 128`, string-array ceiling `100`, integer base-unit strings (rejecting floats before auth/gating), and `MAX_IMAGE_B64_CHARS = 7_000_000` (~5 MB; strip `image/svg+xml` before enabling `launchpad.uploadImage`).
