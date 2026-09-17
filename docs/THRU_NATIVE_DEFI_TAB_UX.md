# Thru-native launchpad, DEX, charts, and full-tab DeFi UX

Date: 2026-09-18  
Status: corrective product/architecture note after reviewing Thru docs. No runtime code changes.

This document supersedes any interpretation that Thru launchpad tokens should literally migrate to
EVM venues such as Uniswap. Thru is a new Layer 1 with its own VM, transaction format, account
model, Token Program, AMM Program, indexing stack, gRPC/gRPC-Web API, and explorer tooling. External
launchpads/DEXs remain useful UX references only.

---

## 1. Correction: Thru is not EVM

Thru should be treated as a native L1, not an EVM deployment target.

From Thru docs reviewed for this correction:

- Thru programs run on the Thru VM and can be written in C.
- Transactions have Thru-native headers, account ordering, state proofs, resource units, nonce,
  fee, chain id, and Ed25519 signatures.
- Web integrations should use Thru packages such as `@thru/sdk`, `@thru/programs`, `@thru/wallet`,
  `@thru/replay`, and `@thru/indexer`.
- `@thru/programs/token` exposes Token Program builders/parsers for mints, token accounts,
  transfers, minting, burning, freeze/thaw, and token-account derivation.
- `@thru/programs/amm` exposes AMM helpers for pool derivation, init pool, add/withdraw liquidity,
  swaps, pool metadata parsing, and exact-input quote helpers.
- Thru gRPC/gRPC-Web exposes Query, Command, and Streaming services; the StreamingService supports
  account/block/transaction monitoring.
- `@thru/replay` and `@thru/indexer` are the correct direction for historical + live market data
  pipelines and Postgres-backed read models.
- Explorer MCP can inspect accounts, transactions, blocks, recent activity, search, and on-chain
  ABIs without scraping explorer pages.

Therefore, the Thru product model is:

```text
Thru Launchpad Program / Token Program
  → Thru launch state
  → Thru Token Mint + Token Accounts
  → Thru AMM pool / future Thru DEX venue
  → Thru indexer/replay market data
  → Thru wallet popup + full-tab DeFi terminal
```

Not:

```text
Thru token → EVM Uniswap pool
```

External venues like PumpSwap, Raydium, Meteora, Uniswap, PancakeSwap, Aerodrome, Pons, Clanker,
and FOMO are comparative UX references, not implementation targets unless a future bridge or
cross-chain product is explicitly built and verified.

---

## 2. Product shape: Rabby-like extension + full-tab advanced DeFi

Rabby’s relevant lesson is not “copy Ethereum/EVM.” It is the two-surface product model:

### Popup / extension panel

The popup is the high-frequency wallet surface:

```text
- unlock / account switch
- balance and assets summary
- send / receive / swap shortcuts
- transaction review and approval
- recent activity
- network health
- security settings
```

For launchpad and DeFi, the popup should show compact entry points:

```text
Swap                         quick Thru-native swap, when AMM is verified
Launchpad                    opens full tab
Markets                      opens full tab
Perps / advanced apps         opens full tab once verified
```

### Full-tab wallet / DeFi terminal

The browser tab is for workflows that need more width, state, and charts:

```text
- launchpad discover/create/manage
- token market page
- candlestick charts and volume
- pool/liquidity details
- advanced swap route/quote review
- portfolio analytics
- perps or CLOB-style trading later
- prediction markets later
- developer/creator dashboards
```

This should feel like a Thru-native DeFi terminal embedded in the wallet product, while still using
the wallet core only for account context and signing approval.

---

## 3. Full-tab information architecture

Target tab routes:

```text
/wallet                 portfolio overview, larger than popup
/swap                   Thru AMM swap terminal
/markets                token/pool discovery
/markets/:asset         token detail + chart + pools + trades
/launchpad              launch discovery
/launchpad/create       quick/advanced create
/launchpad/review       pre-sign launch review
/launchpad/:launch      launch lifecycle + migration/graduation
/my-launches            creator dashboard
/perps                  future; disabled until Thru-native venue is verified
/predictions            future; disabled until Thru-native program is verified
/settings               advanced settings and custom RPCs
```

Popup routes should remain focused and should open full-tab routes for advanced contexts.

---

## 4. Thru-native launch lifecycle models

Do not hardcode one launch lifecycle. Thru can support multiple models over time through native
programs.

### 4.1 Mint-only launch, verified first

This is closest to the current token mint capability.

```text
Draft
  ↓
Review mint
  ↓
Password auth + sign
  ↓
Mint account created
  ↓
Token shown in My launches
  ↓
Trading unsupported until pool/AMM support is verified
```

UI should show:

- mint address
- creator account
- supply/decimals/metadata
- transaction hash
- “Trading not enabled yet” state

### 4.2 Direct Thru AMM pool launch

Future, once `@thru/programs/amm` pool init + liquidity semantics are verified.

```text
Draft
  ↓
Create token + initialize AMM pool
  ↓
Add initial liquidity
  ↓
Pool live on Thru AMM
  ↓
Chart + swaps + pool facts
```

This is the Thru-native analogue of Pons-style token + pool creation, but **not Uniswap**. The UI
may study Pons’ clarity around locked liquidity and pool facts, while the execution target remains
Thru AMM.

### 4.3 Bonding curve → Thru AMM graduation

Future, only if a Thru launch/curve program exists and is verified.

```text
Draft
  ↓
Launch token into Thru curve program
  ↓
Curve trading
  ↓
Graduation threshold reached
  ↓
Migrate/graduate into Thru AMM pool
  ↓
AMM trading + charts
```

This is the Thru-native analogue of Pump.fun/Raydium/Meteora graduation, but the data source should
be Thru program events/account state, not Solana/EVM assumptions.

### 4.4 Manual migration fallback

If a future Thru launch program requires an explicit graduation call:

```text
Ready to migrate
  → Review migration
  → Password auth + sign
  → Submitted
  → Pool live / failed with reason
```

The UI must show exact verified facts:

- source launch account
- mint account
- destination AMM pool account
- token and THRU liquidity amounts
- LP/migration ownership or lock policy
- caller reward, if any
- fee and resource units

---

## 5. Swap UX in extension vs full tab

### Popup swap

The popup swap should be compact and safe:

```text
Swap

From
[ THRU        100.00 ]

To
[ TOKEN       est. 24,120 ]

Pool / route
Thru AMM · best verified pool

Price impact  0.8%
Fee           ...

[Review swap]
```

It must not become a full trading terminal. The popup should block if quote/AMM support is not
verified.

### Full-tab swap / DeFi terminal

The tab view can show advanced controls:

```text
- token search
- route/pool selection
- liquidity depth
- slippage settings
- price impact
- min received
- chart beside trade panel
- recent trades
- pool metadata
- developer details / raw account addresses
```

### Shared signing rule

Both popup and tab must use the same backend signing path:

```text
quote → review → password auth → sign → submit → pending → confirmed/failed
```

No surface should be able to sign directly with only an unlocked session.

---

## 6. Chart and market data architecture for Thru

A Thru-native chart system should be built from Thru data sources.

```text
Thru StreamingService / @thru/replay
  → ordered block/transaction/account/event stream
  → MarketIndexer using @thru/indexer
  → candles, trades, pool snapshots, holder snapshots
  → frontend market API
  → chart components
```

### Data sources by phase

| Phase | Primary Thru source | UI output |
| --- | --- | --- |
| Mint-only | Token mint account + local deploy record | token identity, creator, supply, no trade chart |
| Curve live | Launch/curve program account + events | curve price, progress, buys/sells if verified |
| AMM live | AMM pool account + swap/add/withdraw events | candles, volume, liquidity, pool facts |
| Portfolio | Token accounts + native account balances | holdings and PnL once pricing is available |
| Debug | Explorer MCP / explorer API | transaction/account/program ABI inspection |

### Chart states

Never draw fake prices.

```text
No verified market data yet
This token exists on Thru, but the wallet has not verified a Thru market indexer for it.
```

```text
Pool live, chart building
The AMM pool exists. Candles will appear after indexed swaps are available.
```

```text
Data stale
Last market update was 4m ago. A fresh quote is required before signing.
```

---

## 7. Full-tab launchpad screen design

### 7.1 Launchpad home

```text
Thru Launchpad                                      [Account] [Network]
Create and discover native Thru assets.

[Create token] [My launches]

Tabs: New | Live | Near graduation | AMM live | Watchlist
Search: name, symbol, mint, creator, launch account

Cards / table:
$SYMBOL  Name         Phase          Liquidity      Volume      Age
Mint ta…              AMM live       10.2K THRU     4.8K        12m
Creator ta…           Risk: new mint, low liquidity
```

### 7.2 Create flow

Two modes:

```text
Quick Launch
- name
- symbol
- image/URI
- description
- creator account
- defaults from verified Thru template

Advanced Launch
- supply
- decimals
- authority policy
- launch template
- initial liquidity / first buy, only if verified
- AMM/curve config, only if verified
- migration policy, only if verified
```

### 7.3 Launch review

```text
Review Thru launch

Token
Name, symbol, mint address, decimals, supply

Accounts
Creator account, token mint account, token program, AMM/launch program if used

Mechanics
Mint only / Direct AMM / Curve to AMM
Pool address, if derived
Initial liquidity, if applicable
Graduation threshold, if applicable

Resources
Network fee
Compute units
State units
Memory units, if exposed

Irreversible facts
Supply/decimals/authority settings
Metadata mutability
Liquidity lock policy, if verified

[Cancel] [Authenticate and sign]
```

### 7.4 Token market page

```text
$SYMBOL  Token Name                                [Watch] [Share]
Mint ta...              Creator ta...             Network Alphanet
Phase: AMM live / Curve live / Created / Unsupported

Price | Market cap | Liquidity | Volume | Holders | Pool age

┌───────────────────────────┬─────────────────────────────┐
│ Chart                     │ Swap / Migrate / Unsupported │
│ price + volume + progress │ review-first action panel    │
└───────────────────────────┴─────────────────────────────┘

Tabs: Trades | Pools | Holders | Risks | Creator
```

### 7.5 My launches

```text
My launches

Drafts
Live mints
Curve live
Ready to migrate
AMM live
Failed / needs attention

Each row:
- token identity
- mint address
- launch/pool account
- phase
- creator account
- claimable fees/rewards only if verified
- next safe action
```

---

## 8. Thru-native component list

### Shared wallet/DeFi components

- `FullTabShell`
- `DeFiTopbar`
- `AccountContextPill`
- `NetworkHealthPill`
- `TokenIdentity`
- `AddressCopyLine`
- `RiskBadge`
- `UnsupportedCapability`
- `ReviewSection`
- `SigningStatusRail`

### Launchpad components

- `LaunchCard`
- `LaunchTable`
- `LaunchPhaseBadge`
- `LaunchLifecycleRail`
- `LaunchTemplatePicker`
- `TokenDraftForm`
- `TokenPreviewCard`
- `LaunchReviewCard`
- `MigrationReviewCard`
- `CreatorLaunchRow`

### Market/DEX components

- `MarketChartShell`
- `CandleChart` — only after real indexed candles exist
- `VolumeBars`
- `LiquidityDepthCard`
- `PoolFactsCard`
- `TradeTape`
- `HolderDistribution`
- `SwapPanel`
- `QuoteReviewCard`

All components must use the existing safe DOM system or an equally guarded future component system.
No string-built HTML for token names, symbols, images, social links, pool addresses, or chart labels.

---

## 9. Architecture boundaries

```text
Popup UI / Full-tab UI
  ↓ bridge.send()
Background API router
  ↓ application services
Launchpad service / Market service / Swap service
  ↓ ports
Thru Token Program / Thru AMM Program / Thru RPC / Thru Indexer
```

Forbidden:

```text
feature UI → vault.js
feature UI → raw chrome.storage for secrets
feature UI → direct transaction signing
feature UI → fake DEX/chart data that looks live
```

Allowed:

```text
feature UI → bridge → supported:false market states
feature UI → bridge → verified quote/review/sign APIs
feature UI → non-secret local drafts/watchlist/preferences
```

---

## 10. Data models adjusted for Thru

### Venue

```js
ThruVenue = {
  id,                  // 'thru-amm', 'thru-curve', 'thru-clob-future'
  networkId,
  label,
  programAddress,
  kind,                // 'amm' | 'bondingCurve' | 'clob' | 'perps' | 'prediction'
  verified,
  executionSupported,
  chartSupported,
  quoteSupported,
  migrationSupported,
};
```

### Pool

```js
ThruPool = {
  id,
  networkId,
  venueId,
  poolAddress,
  mintAAddress,
  mintBAddress,
  vaultAAddress,
  vaultBAddress,
  lpMintAddress,
  swapFeeBps,
  reserves,
  metadata,
  liquidityLockFacts,
  createdAt,
  source,              // 'thru-rpc' | 'thru-indexer' | 'explorer-mcp'
};
```

### Launch

```js
ThruLaunch = {
  id,
  networkId,
  launchModel,         // 'mint-only' | 'direct-thru-amm' | 'curve-to-thru-amm'
  mintAddress,
  creatorAddress,
  launchAccountAddress,
  poolAddress,
  tokenProgramAddress,
  ammProgramAddress,
  phase,
  createdTx,
  migrationTx,
  metadata,
  supply,
  decimals,
  graduation,
  riskFacts,
};
```

### Market state

```js
ThruMarketState = {
  mintAddress,
  poolAddress,
  priceInThru,
  liquidityThru,
  volumeThru,
  candles,
  trades,
  holders,
  updatedAt,
  stale,
  supported,
  reason,
};
```

---

## 11. How external references should influence design

| External pattern | Thru-native translation |
| --- | --- |
| Pump.fun graduation | Curve phase can graduate into a Thru AMM pool if a Thru curve program supports it. |
| Pons token + pool in one tx | Direct Thru Token + Thru AMM pool launch, if verified. |
| Raydium LaunchLab quick/advanced modes | Quick and Advanced Thru launch templates. |
| Meteora DBC templates | Reusable Thru launch templates and curve configs. |
| DEX Screener chart terminal | Full-tab Thru market page with price, candles, liquidity, volume, trades. |
| Birdeye holder/security panel | Thru holder distribution and risk facts from Thru indexer. |
| Rabby popup + tab split | Popup for wallet actions; full tab for advanced DeFi/launchpad/perps. |
| Clanker social launch | Future launch-from-social/AI draft creation, never direct signing. |

---

## 12. Implementation order after this correction

Do not jump straight to charts or DEX UI. The safe order is:

1. **Security hardening**
   - backend password gates for signing, reset, and security settings
2. **Disable or migrate unsafe current launchpad page**
   - no `innerHTML` launchpad page in shipped extension
3. **Full-tab shell**
   - account/network topbar, left nav, responsive layout
4. **Pure Thru DeFi models**
   - launch phases, venue model, pool model, market state model
5. **Unsupported market shell**
   - token page and chart shell with honest unsupported states
6. **Verified token creation**
   - 64-hex mint seeds, correct symbol/name params, password-gated deploy
7. **Thru AMM research/verification**
   - use `@thru/programs/amm`; verify pool init, swap, liquidity, quote, metadata parsing
8. **Market indexer design**
   - `@thru/replay`/`@thru/indexer` for candles, trades, holders, pools
9. **Popup swap**
   - only after quote + signing + duplicate protection + token account handling are verified
10. **Full-tab DEX terminal**
   - chart/trade/pool/risk panels
11. **Perps/futures advanced tab**
   - only when Thru-native perps/CLOB/oracle program semantics are verified

---

## 13. Acceptance criteria for a Thru launchpad/DEX release

- The UI never names an external DEX as a migration target unless there is a verified integration.
- Every launch/trade/migration action goes through wallet review and backend password auth.
- Token, pool, and launch addresses are shown as Thru `ta...` identities.
- Charts are powered by Thru market/indexer data or clearly marked unavailable.
- No simulated swap/trade/perp action appears as real.
- Full-tab and popup share the same bridge/API contracts.
- Launchpad, DEX, market, and perps remain separable feature modules.
- The wallet remains useful if all DeFi modules are disabled.
- All new feature modules are included in DOM sink and layering guardrails.

---

## Phase report

```text
PHASE: Thru-native DeFi tab and DEX-migration UX correction
FILES ADDED: docs/THRU_NATIVE_DEFI_TAB_UX.md
FILES MODIFIED: docs/LAUNCHPAD_DEX_MIGRATION_UX.md, docs/LAUNCHPAD_UX_STUDY.md
BACKEND CHANGES: none
UI CHANGES: none
SECURITY IMPACT: no runtime change; corrects the architecture to Thru-native Token/AMM/indexer paths and rejects EVM/Uniswap assumptions
TESTS: npm test -> PASS before document creation; rerun after edits
BUILD: npm run build -> PASS before document creation; rerun after edits
KNOWN LIMITATIONS: no live Thru AMM/DEX/perps verification; no UI implemented; docs learned from public Thru docs only
NEXT PHASE: security hardening, then full-tab shell and pure Thru launch/venue/market models
```
