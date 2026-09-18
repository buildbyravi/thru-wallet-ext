# Launchpad → DEX migration, charts, and market UX study

> [!IMPORTANT]
> **RESEARCH ONLY — no shipped code corresponds to this document.** There is no DEX, swap, pool,
> quote, chart, bonding curve, migration or prediction-market code in this repository. The legacy
> `src/launchpad/**` page that faked a DEX tab — `parseFloat()` quotes against a hard-coded
> `23.5294` rate and a `setTimeout` "Execute Swap On-Chain" button that reported trades which never
> happened — is **deleted**, not built, and not reachable by URL, flag or control.
> `test-launchpad-quarantine.mjs` enforces that.
>
> Nothing below may be implemented as written: every flow here depends on Thru AMM/indexer surfaces
> that are not yet verified. Do not fabricate quotes, pools, charts or market state. A future DEX is
> an isolated `src/features/dex/**` module with `dex.*` backend namespaces per
> `docs/MODULE_BOUNDARIES.md`, reading real data through a verified adapter.
>
> For current state read `docs/STATUS_AND_ROADMAP.md` and `CONTEXT.md` §9. Retained as UX research.

Date: 2026-09-18  
Scope: frontend/product architecture for the post-launch and post-graduation experience. This is a
UX/design document only. It does **not** implement Thru AMM, DEX migration, market indexing, token
trading, or charting.

> Correction: Thru is a native Layer 1, not an EVM chain. External DEXs such as Uniswap,
> Raydium, PancakeSwap, FOMO, and Pons are UX references only. The Thru implementation target is
> Thru-native Token Program, AMM Program, official gRPC/gRPC-Web transport after endpoint/devnet validation, and a future verified read/indexer adapter where needed. See
> `docs/THRU_NATIVE_DEFI_TAB_UX.md` for the corrected architecture.

Related docs:

- `docs/LAUNCHPAD_UX_STUDY.md` — launchpad create/discover UX.
- `docs/MIGRATION_MAP.md` — security-first migration sequence.
- `docs/AUDIT_REPORT.md` — current security findings.
- `docs/BACKEND_GAPS.md` — verified vs unverified Thru backend capabilities.

---

## 0. The added requirement

After a token launches, the launchpad product needs a clear UX for:

```text
token created
  ↓
launch market opens, if supported
  ↓
graduation threshold reached, if using a bonding-curve model
  ↓
DEX pool migration / direct DEX pool activation
  ↓
charts, liquidity, volume, holders, transactions, and risk facts
  ↓
post-launch creator and trader actions
```

This mirrors the market pattern seen across PumpSwap/Raydium/Meteora/Jupiter/Orca on Solana,
Uniswap/Aerodrome/Clanker/Zora/Flaunch on Base/EVM, PancakeSwap/Four.Meme/GraFun on BNB,
Pons/Pools.trade on Robinhood Chain, and other DEX/terminal ecosystems.

For Thru, the product should be designed for this lifecycle now, while shipping only verified
chain functionality.

---

## 1. Important distinction: DEX venue vs analytics terminal

The frontend must separate three concepts that launchpad UIs often blur:

| Concept | Examples from other ecosystems | Product role |
| --- | --- | --- |
| **Launch source** | Pump.fun, BONK.fun, Pons, Four.Meme, Zora, Clanker | Creates token and initial launch market. |
| **Execution DEX / pool venue** | PumpSwap, Raydium, Meteora, Orca, Uniswap, Aerodrome, PancakeSwap | Where buy/sell transactions execute after launch or graduation. |
| **Analytics / chart layer** | DEX Screener, GeckoTerminal, DexTools, Defined.fi, Birdeye, Bitquery-powered dashboards | Displays prices, candles, liquidity, volume, holders, trades, market cap, and discovery feeds. |

Thru Wallet must not make the analytics layer authoritative for signing. The safe hierarchy is:

```text
Thru program / RPC state       authoritative for whether a transaction can be built
internal indexer/cache         derived truth for fast UI
third-party market terminals   enrichment and cross-checks only
```

---

## 2. UX principle: show the token lifecycle as a timeline

Every launch page should render a lifecycle rail. This is the main orientation device.

```text
Draft → Created → Live market → Near graduation → Graduated → DEX trading → Mature
```

Not every launch model uses every stage:

- **Mint-only launch:** Draft → Created → Mature/Unsupported trading.
- **Direct pool launch:** Draft → Created → DEX trading immediately.
- **Bonding curve:** Draft → Created → Live market → Near graduation → Graduated → DEX trading.
- **Manual migration:** Draft → Created → Live market → Ready to migrate → Migrating → DEX trading.

The UI should show unavailable stages as explicit unsupported states, not as empty cards.

---

## 3. Token page information architecture

A post-launch token page should become the canonical market page, not just a success receipt.

```text
┌───────────────────────────────────────────────────────────────┐
│ $SYMBOL  Token Name                         [Watch] [Share]   │
│ Mint ta...abc  [Copy]  Creator ta...xyz [Copy]  Network       │
│ Phase: Live on curve / Graduated / DEX trading / Unsupported  │
├───────────────────────────────────────────────────────────────┤
│ Price    Market cap    Liquidity    Volume 24h    Holders     │
├──────────────────────────────┬────────────────────────────────┤
│ Chart                         │ Trade / Unsupported / Migrate  │
│ - 1m 5m 15m 1h 4h 1d          │ panel                          │
│ - price + volume              │                                │
│ - curve progress overlay      │                                │
├──────────────────────────────┴────────────────────────────────┤
│ Lifecycle timeline                                             │
│ Risk facts                                                     │
│ Pools / venues                                                 │
│ Recent trades / transactions                                   │
│ Holders / distribution                                         │
│ Creator actions                                                │
└───────────────────────────────────────────────────────────────┘
```

For popup-sized surfaces, show a compact summary and open the full market page in a tab.

---

## 4. Required modules for the frontend architecture

Do not build charting and trading straight into `launchpad.js`. Create independent pieces that can
be disabled or tested separately.

```text
features/launchpad/
  create/                 # draft, preview, review, success
  discover/               # board/search/filter/watchlist
  token/                  # token detail, lifecycle, chart container
  migration/              # graduation/migrate/DEX activation flows
  creator/                # my launches, claim fees, creator settings

features/market/
  chart/                  # candles, line, volume bars, empty states
  pools/                  # pool list, route/pair labels, venue status
  trades/                 # recent swaps/transactions
  holders/                # holder distribution and warnings
  adapters/               # Thru indexer, third-party enrichment later

features/dex/
  trade/                  # buy/sell panels only after verified
  quote/                  # slippage, price impact, route preview
  review/                 # transaction review before signing
```

The wallet core should supply only:

- active account
- balances/assets
- network
- signing/transaction approval
- explorer links
- contact/address display primitives

---

## 5. Data contracts to design now

### 5.1 Launch lifecycle

```js
export const LAUNCH_PHASES = Object.freeze({
  DRAFT: 'draft',
  CREATED: 'created',
  LIVE_MARKET: 'liveMarket',
  NEAR_GRADUATION: 'nearGraduation',
  READY_TO_MIGRATE: 'readyToMigrate',
  MIGRATING: 'migrating',
  GRADUATED: 'graduated',
  DEX_TRADING: 'dexTrading',
  FAILED: 'failed',
  UNSUPPORTED: 'unsupported',
});
```

### 5.2 Launch listing

```js
LaunchListing = {
  id,
  networkId,
  launchModel,       // 'mint-only' | 'bonding-curve' | 'direct-pool' | 'manual-migration'
  launchpadId,
  templateId,
  creatorAddress,
  mintAddress,
  launchAddress,
  phase,
  createdAt,
  graduatedAt,
  migratedAt,
  primaryPoolId,
  metadata,          // untrusted display data
  immutableFacts,
  mutableFacts,
  riskFacts,
};
```

### 5.3 DEX pool record

```js
DexPool = {
  id,
  networkId,
  venueId,           // 'thru-amm' | 'uniswap-v3' | 'uniswap-v4' | etc.
  protocolFamily,
  poolAddress,
  poolId,
  baseAssetId,
  quoteAssetId,
  feeBps,
  createdAt,
  source,            // 'chain' | 'indexer' | 'third-party'
  liquidityLocked,   // true | false | 'unknown'
  liquidityLockFacts,
};
```

### 5.4 Market snapshot

```js
MarketSnapshot = {
  assetId,
  poolId,
  networkId,
  priceNative,
  priceUsd,
  marketCapUsd,
  fdvUsd,
  liquidityUsd,
  volume: { m5, h1, h6, h24 },
  transactions: { m5: { buys, sells }, h1, h6, h24 },
  holders,
  updatedAt,
  stale,
  source,
};
```

### 5.5 Candle and trade records

```js
Candle = {
  poolId,
  timeframe,         // '1m' | '5m' | '15m' | '1h' | '4h' | '1d'
  openTime,
  open,
  high,
  low,
  close,
  volumeBase,
  volumeQuote,
};

TradePrint = {
  id,
  poolId,
  txHash,
  blockTime,
  side,              // 'buy' | 'sell' | 'unknown'
  baseAmount,
  quoteAmount,
  priceNative,
  traderAddress,
  viewerRole,        // 'self' | 'creator' | 'other' | null
};
```

All amount fields should remain strings at the API boundary and BigInt/decimal-safe internally.

---

## 6. Graduation and migration UX states

### 6.1 Bonding-curve launch states

```text
Live on curve
- progress to threshold
- current curve price
- quote raised
- token amount remaining
- estimated graduation venue
- risks: curve can stall; price can fall; graduation is not endorsement

Near graduation
- threshold progress ≥ configured warning level
- show “DEX pool will open after graduation”
- show expected venue and liquidity handling
- if any user can trigger graduation, show who pays/receives bounty only if verified

Ready to migrate
- curve threshold reached
- migration transaction needed
- show “who can migrate” and exact fee/reward
- button: Review migration

Migrating
- tx submitted
- show tx hash, pending status, no false success

Graduated / DEX trading
- primary pool address
- venue label
- liquidity and lock facts
- chart switches from curve-derived data to pool trade data
```

### 6.2 Direct-pool launch states

Pons/Pools.trade-style systems teach a different lifecycle: token and pool can exist from block one.

```text
Created + pool live
- token mint/contract address
- pool address
- quote asset
- locked liquidity facts
- creator fee recipient
- pool fee
- launch protections if any
```

There may be no “migration” event. The UI must not require one.

### 6.3 Manual migration fallback

If Thru ever supports a model where graduation does not automatically create a DEX pool:

```text
Ready to migrate
This launch reached its threshold. A migration transaction is required to open DEX trading.

[Review migration]
```

Review must show:

- source launch address
- destination DEX/program
- pool/mint addresses
- liquidity amounts
- tokens/proceeds consumed
- resulting LP/lock ownership
- caller fee/reward
- failure handling

---

## 7. Chart UX requirements

### 7.1 Chart types

| Chart mode | When to use | Notes |
| --- | --- | --- |
| **Line** | Very new token with sparse trades | Avoid fake candles where there are too few prints. |
| **Candlestick** | Enough trades for OHLCV | Timeframes: 1m, 5m, 15m, 1h, 4h, 1d. |
| **Curve progress** | Bonding-curve phase | Overlay raised/remaining/graduation threshold. |
| **Liquidity chart** | Post-DEX phase | Show pool depth changes separately from price. |
| **Volume bars** | All tradeable phases | Buy/sell coloring only where side classification is reliable. |

### 7.2 Empty and stale states

Do not draw a flat chart for missing data.

```text
No trades yet
The token is live, but no verified trades have been indexed.
```

```text
Chart data is stale
Last update: 3m ago. Do not rely on this price for signing.
```

```text
Charts unavailable on this network
The wallet has not verified a market indexer for this Thru network yet.
```

### 7.3 Chart safety rules

- A chart is informational; signing uses a fresh quote/simulation where available.
- The trade review must re-fetch price/quote/liquidity immediately before signing.
- Prices from third-party terminals are never execution guarantees.
- If chart data source and on-chain quote disagree materially, show a warning and block one-click
  submit until the user reviews details.

---

## 8. DEX/pool detection architecture

The product should detect the **first meaningful liquidity pool**, not just “token launched”.

```text
LaunchDetector
  → observes verified Thru launch/token events
PoolDetector
  → observes DEX pool creation / graduation / migration events
MarketIndexer
  → builds price, liquidity, volume, trades, holders, candles
RiskScorer
  → summarizes liquidity lock, authority, holder concentration, creator history
Alert/Notification layer
  → optional future feature, not wallet core
```

### Source priority

1. **Thru on-chain program/RPC/indexer state** — authoritative.
2. **First-party Thru APIs or official SDK/program bindings** — preferred.
3. **Third-party market terminals** — enrichment only.
4. **Scraped frontends** — avoid; too brittle and untrusted for wallet decisions.

---

## 9. Venue abstraction

Create a generic venue record even if Thru initially has only one verified venue.

```js
DexVenue = {
  id,
  networkId,
  label,
  kind,              // 'amm' | 'clob' | 'aggregator' | 'bonding-curve' | 'hybrid'
  executionSupported,
  chartSupported,
  poolsSupported,
  quoteSupported,
  verified,
  explorerUrlPattern,
};
```

Example UI labels:

```text
Thru AMM         Verified venue
Thru Curve       Trading not verified
External chart   Enrichment only
```

Do not show “Uniswap”, “Raydium”, “FOMO”, or any external brand inside Thru as a live destination
unless Thru actually routes there or the UI is intentionally showing cross-chain market research.

---

## 10. Trading panel design

Trading must be absent or disabled until Thru execution semantics are verified. When enabled, use a
wallet-grade flow.

### Compact panel

```text
Trade $SYMBOL
[ Buy | Sell ]

Pay
[ 100.00 THRU ]       Balance 1,245.00

Receive estimated
[ 24,320 TOKEN ]

Slippage
[ 0.5% ] [ 1% ] [ Custom ]

Price impact    1.2%
Min received    24,198 TOKEN
Pool            Thru AMM · ta...pool

[Review buy]
```

### Review step

```text
Review buy

You pay           100 THRU
You receive at least 24,198 TOKEN
Price impact      1.2%
Slippage          0.5%
Pool              ta...pool
Venue             Thru AMM
Network fee       ...

Warnings
- This token was created 4 minutes ago.
- Liquidity is thin; your trade may move the price.
- Chart price is informational; this quote will be rechecked before signing.

[Cancel] [Authenticate and sign]
```

### Hard blocks

Block submit when:

- wallet locked
- account missing/invalid
- unsupported venue
- stale quote
- invalid amount
- insufficient balance
- recipient/token account missing and cannot be created safely
- slippage/price impact exceeds configured threshold
- duplicate pending trade
- RPC/indexer disagreement above threshold, unless an explicit advanced override is implemented

---

## 11. Migration action design

If a launch can graduate automatically, the UI should show status only. If a user/creator must call
migration, make it a first-class flow.

### Token page panel

```text
Ready to migrate
The launch threshold was reached. A migration transaction will open DEX trading.

Destination
Thru AMM pool

Liquidity to move
10,000 THRU + remaining launch tokens

Who can migrate
Anyone / Creator only / Launchpad operator  (show only verified fact)

Reward
Unknown / 5 THRU  (show only verified fact)

[Review migration]
```

### Migration review

```text
Review migration

Launch             ta...launch
Token mint         ta...mint
Destination pool   ta...pool (derived)
Assets moved       ...
LP ownership       locked by program / creator / unknown
Caller reward      ...
Network fee        ...

This does not guarantee price, liquidity, or demand after graduation.

[Cancel] [Authenticate and migrate]
```

---

## 12. Market stats hierarchy

### Above the fold

1. Phase badge.
2. Mint address and pool address.
3. Price / market cap / liquidity.
4. 24h volume and 5m momentum.
5. Progress to graduation or pool status.

### Details tabs

| Tab | Fields |
| --- | --- |
| Overview | description, links, template, creator, immutable settings. |
| Chart | price, candles, volume, liquidity overlay. |
| Trades | timestamp, buy/sell, amount, price, wallet, tx link. |
| Holders | holder count, top holders, creator/team concentration when available. |
| Pools | venue, pool address, quote asset, liquidity, fee, age, lock facts. |
| Risks | authority facts, metadata mutability, lock status, indexer freshness, warnings. |

### Popup summary

In the wallet popup, do not cram the full terminal. Show:

```text
$TOKEN
Price: — / stale / current
Liquidity: —
Phase: Live on curve
[Open market page]
```

---

## 13. Creator dashboard after launch

A creator needs a different view from a trader.

```text
My launches

Live
- $TOKEN    62% to graduation    claimable fees: unsupported/0/123 THRU

Needs action
- $TOKEN    Ready to migrate     [Review migration]

Graduated
- $TOKEN    Thru AMM pool ta...   creator fees: claimable/unsupported
```

Creator actions:

- share launch
- copy mint/pool
- open explorer
- claim fees, only when verified
- migrate, if required and permitted
- update metadata/social links, only if mutable and verified
- transfer creator role, only if protocol supports it and password-gated

Every creator action that signs uses background `auth: 'signing'`, which requires password re-authentication by default unless the user has explicitly enabled the password-gated session-only signing setting.

---

## 14. Risk and warning language

### General launch warning

```text
New tokens are experimental. Names, symbols, images, and social links are user-provided and can be
copied. Verify the mint and pool addresses before trading.
```

### Graduation warning

```text
Graduation means the configured liquidity threshold was reached. It is not an endorsement and does
not guarantee future liquidity, price, or an exit.
```

### Locked liquidity wording

```text
Liquidity lock: verified by template
The launch template prevents the creator from withdrawing the initial pool liquidity. Token price
can still fall to zero.
```

If unverified:

```text
Liquidity lock: unknown
The wallet has not verified who controls this pool liquidity. Treat the token as high risk.
```

### Chart warning

```text
Charts are delayed market data. The signing review will fetch a fresh quote before submitting.
```

---

## 15. Visual design direction

Use a **professional market terminal** style, not a casino launchpad clone.

### Layout

- Full-page desktop/tab surface for charts and token detail.
- Popup shows compact state and links out to full page.
- Left navigation: Discover, Create, My launches, Watchlist, Learn.
- Top bar: network, active account, health/staleness.
- Token detail: chart left, action/review rail right, facts below.

### Color semantics

- Teal: verified/connected/complete.
- Gold: pending/near graduation/review needed.
- Brick red: danger/high risk/failed.
- Steel/muted: unsupported/stale/unknown.

### Motion

Only animate:

- submitted → pending
- pending → confirmed
- progress updates
- stale/refresh state

Avoid animated “pump” effects around buy buttons.

---

## 16. Implementation constraints for this repo

Before implementing this UX:

1. Do not modify `src/lib/vault.js` or `src/lib/thru-client.js` unless a tested verified bug requires
   it.
2. Keep `FEATURE_LAUNCHPAD` false until unsafe `src/launchpad/**` is removed or migrated.
3. Do not ship simulated DEX trading or fake charts.
4. Extend `scripts/check-layering.mjs` to cover future launchpad/market feature paths.
5. Keep token deploy/trade/migration actions on background `auth: 'signing'` with password re-authentication enabled by default.
6. Store chart/market data as non-secret cache only; never mix with vault storage.
7. Use Thru SDK/program bindings where available; document uncertainty where not.

---

## 17. Recommended next architecture slice

After Phase A security hardening, add pure contracts only:

```text
src/shared/market/
  launch-phases.js
  market-model.js
  venue-model.js

src/features/launchpad/
  index.js
  launchpad.routes.js
  components/
    launch-phase-badge.js
    launch-progress.js
    launch-review-card.js
    token-market-summary.js

src/features/market/
  components/
    market-chart-shell.js      # empty/stale/loading states only at first
    pool-list.js
    trade-list.js
  services/
    market-service.js          # returns supported:false until verified
```

Initial behaviour should be honest:

```js
{
  supported: false,
  reason: 'Thru market indexing and DEX migration are not verified yet.',
}
```

This lets UI/UX be built and tested without faking market data.

---

## 18. Design-ready wireframes

### 18.1 Token success after launch

```text
Token created

$THRUX  Thru X Market
Mint: ta...mint [Copy]
Creator: Main Account ta...creator
Network: Alphanet
Tx: abc...xyz [Explorer]

Market status
Trading is not enabled in Thru Wallet yet.
DEX migration will appear here once the launch template supports it and the behavior is verified.

[Open token page] [Create another] [Back to dashboard]
```

### 18.2 Live launch with curve

```text
$THRUX                                    [Watch]
Live on curve                             Mint ta... [Copy]

Price        0.000012 THRU
Raised       6,200 / 10,000 THRU
Progress     ██████░░░░ 62%
Liquidity    Curve reserves

[Chart: curve price + volume]

Trade panel
[Buy] [Sell]
Amount...
[Review buy]

Warnings
- Graduation is not guaranteed.
- Chart data is informational.
```

### 18.3 Ready to migrate

```text
$THRUX
Ready to migrate

The launch reached its threshold. A migration transaction opens DEX trading.

Destination: Thru AMM
Pool: ta...pool (derived)
Liquidity: 10,000 THRU + remaining token allocation
LP control: locked by launch template

[Review migration]
```

### 18.4 DEX trading page

```text
$THRUX
DEX trading · Thru AMM
Mint ta...mint     Pool ta...pool

Price    Market cap    Liquidity    Volume 24h    Holders

[ Candlestick chart + volume ]        [ Buy/Sell panel ]

Tabs: Trades | Holders | Pools | Risks
```

---

## 19. Acceptance criteria before enabling DEX/migration UI

- Launch lifecycle is represented by data, not hardcoded tab state.
- Token page can render `unsupported` without broken actions.
- All untrusted token metadata uses text nodes and safe URL filtering.
- Chart shell handles loading, empty, stale, offline, and unsupported states.
- Trade/migration buttons are absent or disabled until verified support exists.
- Signing actions require backend password re-authentication by default via `auth: 'signing'`.
- Duplicate trade/migration clicks cannot submit duplicate transactions.
- RPC accepted does not equal success; pending/confirmed states are distinct.
- Market stats name their source and staleness.
- Pool/mint addresses are always visible and copyable.
- Tests cover route mount, no secret leakage, and no DOM sinks in feature modules.

---

## 20. Immediate decision

The product direction is:

```text
Launchpad creates the token.
Market module owns charts/pools/trades.
DEX module owns execution.
Migration module bridges launch state into DEX pool state.
Wallet core only approves and signs.
```

This keeps the architecture compatible with Pump.fun-style curves, Pons-style direct pools,
Uniswap-style pools, and future Thru-native AMM/DEX migration without contaminating the wallet core
or pretending unverified Thru behaviour exists today.

---

## Phase report

```text
PHASE: Launchpad → DEX migration, charts, and market UX study
FILES ADDED: docs/LAUNCHPAD_DEX_MIGRATION_UX.md
FILES MODIFIED: none
BACKEND CHANGES: none
UI CHANGES: none
SECURITY IMPACT: no runtime change; documents that trading/migration/chart actions must remain unsupported until Thru semantics and password-gated signing are implemented
TESTS: npm test -> PASS before and after document creation
BUILD: npm run build -> PASS before and after document creation
KNOWN LIMITATIONS: no live Thru DEX/AMM/migration verification; external DEX references used for UX principles only; no UI implementation yet
NEXT PHASE: Phase A security hardening, then pure launch/market/venue model contracts and chart-shell empty states
```
