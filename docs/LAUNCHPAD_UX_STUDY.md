# Launchpad frontend design and UX study

Date: 2026-09-18  
Scope: frontend/product study for a future Thru-native launchpad surface. This is a design and
architecture document only; it does not verify or implement new Thru protocol semantics.

---

## 0. Purpose

The wallet already has a disabled `src/launchpad/` surface. Before it is redesigned or enabled,
we need a clear UX target based on the current permissionless token-launch market:

- Pump.fun-style ultra-fast launch and trade boards.
- Raydium/Meteora-style configurable bonding-curve infrastructure.
- Pons-style one-transaction token + locked pool launch flows.
- Zora/Clanker/Bags-style social and creator-native launch experiences.
- BNB/Base launchpads that package bonding curves, automatic DEX handoff, fee sharing, and risk
  disclosure into consumer-facing flows.

This document extracts **interaction principles** for Thru. It must not be read as approval to ship
unverified bonding curves, DEX trading, prediction markets, or token balances in the wallet.

---

## 1. Sources and reference universe

The user-provided reference universe contains these launchpad families:

| Segment | Launchpads to study | What they teach |
| --- | --- | --- |
| Solana ultra-fast meme launch | Pump.fun, BONK.fun / LetsBONK, Moonshot, Boop.fun, Heaven | Minimal create flow, live token board, bonding-curve progress, immediate trading, viral/social loops. |
| Solana configurable infrastructure | Raydium LaunchLab, Meteora DBC, Jupiter Studio / LFG | Quick vs advanced launch modes, configurable curve/vesting/liquidity, graduation lifecycle, post-migration fee surfaces. |
| Solana creator/social launch | Bags.fm, Believe | Creator identity, revenue share, community feed, mobile-first discovery. |
| Robinhood Chain | Pons Family, Pools.trade | One-transaction token + pool creation, locked liquidity messaging, creator fee wallet, factory/pool event indexing. |
| BNB Chain | Four.Meme, Flap, GraFun | BNB-native bonding curve, PancakeSwap graduation, anti-bot/fair-curve fee disclosure. |
| Base / EVM social launch | Virtuals Protocol, Zora, Clanker, Flaunch, Arena/Arena.trade | AI/social launch intent, creator/content coins, referral/reward economics, social-native token pages. |

Reference pages checked during this study included:

- Pons docs: `https://docs.ponsfamily.com/`
- Pons contracts repository: `https://github.com/ponsdotdev/pons-labs`
- Raydium LaunchLab create flow docs: `https://docs.raydium.io/user-flows/creating-a-launchlab-token`
- Meteora DBC docs: `https://docs.meteora.ag/core-products/dbc/what-is-dbc`
- Zora Coins Protocol docs: `https://docs.zora.co/coins`
- Base token launch docs covering Zora/Clanker/Flaunch: `https://docs.base.org/get-started/launch-token`

Other market descriptions were used only as UX/product context, not as protocol authority.

---

## 2. What the market converged on

### 2.1 Launchpads are no longer just “create token” forms

The dominant pattern is a **full lifecycle surface**:

```text
Discover launch
↓
Open token page
↓
Inspect creator / curve / liquidity / risk
↓
Buy or watch
↓
Track graduation
↓
Trade on post-graduation venue
↓
Claim or manage creator fees
```

For Thru, this means the launchpad should not be a single deploy form hidden in a tab. It should be
an isolated product area with its own information architecture.

### 2.2 The winning consumer UX is fast by default, advanced by choice

Raydium LaunchLab documents two paths: a fast “JustSendit” style mode and a fuller configurable
mode with supply, curve allocation, target, vesting, and fee options. That split is the right mental
model for Thru:

- **Quick launch**: name, symbol, image, short description, optional first buy; everything else is a
  safe platform preset.
- **Advanced launch**: supply, decimals, launch template/curve, quote asset, vesting/lock settings,
  creator-fee recipient, social links.

The quick path creates speed and accessibility. The advanced path keeps serious teams from leaving
for external tools.

### 2.3 Progress and lifecycle state are the core visual language

Bonding-curve platforms teach users to care about state:

- new
- live on curve / pool
- near graduation
- graduated
- failed/stalled
- migrated / tradable elsewhere

Even if Thru starts with only verified mint creation and no verified bonding curve/trading, the UI
should be designed around an explicit lifecycle. Do not fake a lifecycle that the chain does not
support yet.

### 2.4 Social trust signals matter, but they are not safety signals

Many launchpads emphasize creator identity, X/Telegram links, comments, holders, watchlists,
leaderboards, and trading velocity. Those are useful for discovery, but dangerous if presented as
safety.

Thru copy must distinguish:

```text
Popularity signal: many people are looking/trading.
Safety signal: verified contract behaviour, immutable settings, locked liquidity, audited program.
```

### 2.5 Transaction review is often under-designed

Launchpad UIs optimize for speed. Wallet software must optimize for clarity before signing. Thru’s
launchpad should keep launchpad speed, but final signing must look like a wallet transaction review:

- what accounts/programs are touched
- token metadata being committed
- supply/decimals/authority settings
- liquidity/fee/vesting settings if applicable
- first buy amount and slippage if applicable
- irreversible fields
- network and fee
- explicit password re-authentication before signing by default; any session-only signing opt-out must be password-gated in Settings

This aligns with `docs/AUDIT_REPORT.md`: signing currently needs backend-enforced password gates
before launchpad expansion.

---

## 3. Competitive UX pattern inventory

### 3.1 Pump.fun family

**Observed pattern**

- Very low-friction token creation.
- Token board is the homepage.
- Live cards emphasize image, ticker, market cap/price, replies/social heat, and curve progress.
- Each token page combines chart, trade panel, comments/activity, and creator metadata.
- The product is more like a live arcade/terminal than a classic launchpad.

**Useful Thru lessons**

- Default screen should be discovery, not a blank “create token” form.
- Every listing needs one clear next action: open, trade, watch, or create.
- Cards should expose launch phase and risk flags at a glance.
- A token detail page should keep chart/activity/trade/review in one place.

**Do not copy**

- Frenetic visual noise.
- Ambiguous safety language.
- One-click irreversible actions from the first page.

### 3.2 BONK.fun / LetsBONK and Raydium LaunchLab family

**Observed pattern**

- No-code launch with Raydium/Jupiter liquidity rails.
- BONK community framing and fee/buyback narratives.
- Raydium LaunchLab separates fast default creation from a more configurable launch path.
- Creator fee and post-migration fee surfaces are part of the launch value proposition.

**Useful Thru lessons**

- Provide launch templates.
- Keep advanced economics hidden until the user selects advanced mode.
- Explain graduation and post-launch venue before signing.
- Treat creator fees as a first-class “My launches” management surface.

### 3.3 Meteora DBC

**Observed pattern**

- Partner/config first: a launchpad can define reusable curve templates, fee policies, quote mints,
  migration targets, and liquidity distribution.
- The lifecycle is explicit: config → virtual pool → trade on curve → curve complete → migrate →
  cleanup/claims.

**Useful Thru lessons**

- The front end should model launch templates separately from launches.
- Launch lifecycle should be stored/readable as structured state, not inferred from UI tabs.
- A future Thru launchpad should be able to support multiple templates without rebuilding screens.

### 3.4 Pons Family / Pools.trade

**Observed pattern**

- Pons V1-style docs emphasize token and pool creation in one transaction, WETH trading from the
  first moment, locked liquidity, creator fee wallet, and a clear graduation threshold without later
  migration.
- Pons documentation explicitly says names and symbols can be copied and that users should verify
  token addresses.
- Pons also documents integration through factory/pool events rather than front-end APIs.

**Useful Thru lessons**

- “Locked liquidity” must be described precisely: who can withdraw, when, and what it does not
  guarantee.
- Token address verification should be a persistent UI primitive.
- Indexing should rely on chain events/program accounts, not scraped launchpad APIs.
- The launch review must show the exact immutable settings snapshotted at creation.

### 3.5 Bags / Believe social-creator family

**Observed pattern**

- Creator identity and mobile sharing are central.
- Revenue share and creator royalties are simple, memorable product hooks.
- Social discovery can be as important as chart discovery.

**Useful Thru lessons**

- A token page should have creator context, but wallet safety should not depend on social proof.
- Launch success page should be built for sharing: copy launch URL, copy mint address, open explorer,
  and clear “what to do next”.
- “My launches” should show claimable creator rewards only when they are verified on-chain.

### 3.6 Four.Meme / Flap / GraFun BNB family

**Observed pattern**

- Basic no-code launch forms.
- BNB/PancakeSwap graduation rails.
- Anti-sniper/fair-curve mechanics are communicated as part of launch fairness.
- Some products expose token taxes/fee settings after graduation.

**Useful Thru lessons**

- Anti-bot mechanics must be visible in the review, not buried in docs.
- If token taxes/fees ever exist on Thru, they must be labelled prominently and consistently.
- “Fair launch” should be a defined template, not marketing copy.

### 3.7 Zora / Clanker / Flaunch / Virtuals / Arena Base family

**Observed pattern**

- Launch starts from content, creator identity, or natural language rather than a finance form.
- Zora makes content/creator coins feel like a social post becoming a market.
- Clanker demonstrates a social-native launch flow: the request can begin in Farcaster, while the
  token page is the canonical post-launch surface.
- Fees/rewards/referrals are part of the creator story.

**Useful Thru lessons**

- Thru can support “launch from idea” copy and templates, but should still end in a precise wallet
  review.
- Social import/connectors should be optional and isolated from wallet core.
- Future AI/social launch intent should produce a draft, not directly sign.

---

## 4. Recommended Thru Launchpad UX principles

1. **Launchpad is a feature module, not wallet core.** The wallet provides account, balances,
   network, signing, and transaction review. Launchpad owns launch discovery and creator flows.
2. **One truth source: chain/program state.** The UI may cache, but listings and status should be
   derived from Thru program accounts/events when available.
3. **Fast path + advanced path.** Quick launch for memes/community tokens; advanced launch for teams
   needing exact tokenomics.
4. **Never fake tradability.** If token transfer/trading/curve state is not verified on Thru, show
   “Not supported yet” with clear next steps instead of simulated buy/sell panels.
5. **Review before signing.** Every launch/trade/claim has a dedicated review step with irreversible
   fields and password re-authentication.
6. **Address-first safety.** Names, tickers and images are untrusted. The mint/launch address is the
   identity anchor.
7. **Lifecycle badges over hype labels.** Use `Draft`, `Ready to sign`, `Submitted`, `Live`,
   `Near graduation`, `Graduated`, `Failed`, `Unsupported` rather than vague “hot/moon/safe”.
8. **Creator economics are transparent.** If creator fees/rewards exist, show how they accrue, where
   they are claimable, and who receives them.
9. **Discovery is dense but calm.** Professional trading-terminal density, not casino clutter.
10. **Module can be disabled.** If launchpad is off, no launchpad page with unsafe code should be
    bundled or reachable.

---

## 5. Information architecture for Thru Launchpad

Target top-level pages for a future full-page launchpad:

```text
Launchpad
├── Discover
│   ├── New
│   ├── Trending
│   ├── Near graduation
│   ├── Graduated
│   └── Watchlist
├── Create
│   ├── Quick launch
│   ├── Advanced launch
│   ├── Review
│   └── Success
├── Token detail
│   ├── Overview
│   ├── Chart / price discovery
│   ├── Trade panel or unsupported notice
│   ├── Activity
│   ├── Holders / distribution
│   └── Risk / contract facts
├── My launches
│   ├── Drafts
│   ├── Live launches
│   ├── Claimable fees/rewards
│   └── Post-launch actions
└── Learn / Risks
```

Do not put DEX, prediction markets, and launchpad creation in the same initial screen. Those belong
to separate modules.

---

## 6. Screen blueprints

### 6.1 Discover board

Purpose: help users understand what exists without encouraging blind execution.

Primary layout:

```text
[Network pill] [Account pill]

Launchpad
Create a Thru-native token or discover active launches.
[Create token]

Tabs: New | Trending | Near graduation | Graduated | Watchlist
Search by name, symbol, mint, creator
Filters: phase, verified template, creator, quote asset, risk flags

Token card
┌────────────────────────────────────┐
│ [image] $THRUAI      Live on curve │
│ Thru Agent Index                  │
│ Mint ta8…x9m     Creator ta1…abc  │
│ Market cap —      Liquidity —     │
│ Progress █████░░  62% to graduate │
│ Risk: mutable metadata · new mint │
│ [Open] [Watch]                    │
└────────────────────────────────────┘
```

When market data is unavailable:

```text
Market data unavailable
The wallet can show verified mint information, but this network does not yet expose a verified
launch indexer for prices and progress.
```

### 6.2 Quick create

Fields:

- Token name.
- Symbol.
- Image/logo.
- One-line description.
- Social links.
- Optional initial buy only after trading is verified.
- Creator account selector.

Defaults:

- Thru-approved launch template.
- Default decimals from verified token program behaviour.
- Immutable or explicitly disclosed authorities.
- No fake curve/trading fields before protocol support exists.

UX:

- Live preview card on the right.
- “What will be permanent?” checklist.
- “What can be edited later?” checklist.
- “This does not make your token safe or valuable” risk note.

### 6.3 Advanced create

Only visible after the user chooses advanced mode.

Potential future sections:

- Supply and decimals.
- Authority policy.
- Launch template / curve config.
- Quote asset.
- Graduation target.
- Creator fee recipient.
- Vesting / locked allocation.
- Liquidity lock policy.
- Anti-sniper settings.

Each section needs:

- inline explanation
- sane bounds
- “fixed after launch” marker when applicable
- computed summary

### 6.4 Launch review

This is mandatory before signing.

```text
Review launch

Token
Name: Thru Agents
Symbol: THRUA
Mint: ta… (derived)
Decimals: 6
Supply: 1,000,000,000

Creator
Account: Main Account ta…
Fee recipient: ta…

Launch mechanics
Template: Thru Fair Launch v1
Trading: Unsupported until verified / or Live on bonding curve
Graduation: Not applicable / 10,000 THRU threshold
Liquidity: Locked by program / Not supported

Network
Alphanet
Estimated fee: …

Irreversible fields
[✓] name/symbol/images are public
[✓] supply/decimals cannot be changed after launch
[✓] token names can be copied; verify mint address

[Cancel] [Authenticate and launch]
```

### 6.5 Token detail

Primary layout:

```text
$SYMBOL  Token Name                 [Watch]
Mint ta…x9m                         [Copy] [Explorer]
Creator ta…abc                      [Copy]
Phase: Live / Graduated / Unsupported

Stats strip:
Price | Market cap | Liquidity | Volume | Holders | Progress

Main:
Chart / progress visualization
Activity feed
Risk facts

Right rail:
Trade panel OR unsupported notice
```

Unsupported trade panel copy:

```text
Trading is not enabled in Thru Wallet yet
This token can be displayed once verified on-chain metadata exists. Buying and selling will appear
only after Thru token transfer and AMM/curve behaviour are verified and covered by tests.
```

### 6.6 My launches

Show only launches associated with the active account or selected creator account.

Sections:

- Drafts.
- Submitted/pending.
- Live.
- Graduated.
- Claimable creator fees — hidden until verified.
- Failed/needs attention.

Each row:

- token identity
- mint address
- phase
- creator account
- launch date
- claim/status actions
- explorer link

---

## 7. Component inventory needed

Build only when used by real screens.

| Component | Purpose |
| --- | --- |
| `LaunchCard` | Discovery grid/list item with phase, mint, creator, stats, risk flags. |
| `LaunchPhaseBadge` | Consistent lifecycle marker. |
| `LaunchProgressBar` | Curve/graduation progress with accessible label. |
| `TokenIdentity` | Image fallback, symbol, name, mint copy. |
| `CreatorIdentity` | Creator account/avatar/ref, not social proof as safety. |
| `RiskFactList` | Immutable/mutable/supported/unsupported facts. |
| `LaunchTemplatePicker` | Quick/advanced preset selector. |
| `TokenPreviewCard` | Creation live preview without `innerHTML`. |
| `LaunchReviewCard` | Final pre-sign summary. |
| `CreatorFeePanel` | Future claim/reward status. |
| `UnsupportedCapability` | Honest blocked-state component. |
| `WatchButton` | Local watchlist only; no hidden network writes. |

All components must use `src/ui/kit/dom.js` `h()` or the future guarded component system; no
string-built HTML.

---

## 8. Data model sketch

Keep this pure/shared; do not wire to unverified RPC yet.

```js
LaunchPhase =
  | 'draft'
  | 'readyToSign'
  | 'submitted'
  | 'live'
  | 'nearGraduation'
  | 'graduated'
  | 'failed'
  | 'unsupported';

LaunchTemplate = {
  id,
  name,
  networkId,
  verified,
  launchModel,       // 'mint-only' | 'bonding-curve' | 'direct-pool'
  quoteAsset,
  defaultDecimals,
  supportsTrading,
  supportsGraduation,
  supportsCreatorFees,
  riskNotes,
};

LaunchDraft = {
  name,
  symbol,
  description,
  imageUrl,
  links,
  creatorRef,
  templateId,
  supplyUnits,
  decimals,
  firstBuyUnits,
};

LaunchListing = {
  id,
  networkId,
  mintAddress,
  launchAddress,
  creatorAddress,
  name,
  symbol,
  imageUrl,
  phase,
  templateId,
  createdAt,
  stats,             // nullable until indexer support exists
  riskFacts,
};
```

---

## 9. What to change in the existing launchpad surface

Current `src/launchpad/` should not be polished in place as-is. It mixes future products and legacy
patterns:

- Launchpad, DEX, and prediction markets share one page.
- DEX trading is simulated, which conflicts with the wallet rule against fake unverified behaviour.
- It imports legacy popup icon HTML helpers.
- It uses `innerHTML`/`insertAdjacentHTML` outside the current UI sink ratchet.
- It generates an invalid non-hex mint seed for current token derivation expectations.
- It submits `ticker` while the background service expects `symbol`.

Recommended path:

1. **Short term:** keep `FEATURE_LAUNCHPAD` false and stop treating current launchpad UI as shippable.
2. **Before enabling:** either remove it from the build while disabled or include `src/launchpad/**`
   in DOM sink checks.
3. **Migration:** create `src/features/launchpad/` with its own routes/components/services and use
   `src/ui/kit` primitives.
4. **No fake DEX/prediction tabs:** move DEX and prediction concepts to future feature modules.
5. **Use current wallet bridge only:** no direct vault/storage access.
6. **Signing:** launchpad deploy must use backend `auth: 'signing'` and require password re-authentication by default after Phase A of
   `docs/MIGRATION_MAP.md`.

---

## 10. Thru-specific phased rollout

### Phase 0 — Design-safe shell

Can be built now:

- Feature route shell.
- Discover empty/unsupported state.
- Create draft form with local validation.
- Token preview card.
- Launch review screen that stops before signing if capability is unsupported.
- Learn/risk screen.
- Static local draft persistence only if it contains no secrets.

Do not submit transactions from the new launchpad in this phase.

### Phase 1 — Verified mint creation

Only after token mint creation is confirmed against current Thru SDK/program APIs:

- Valid 64-hex mint seed generation.
- Symbol/name/decimals validation.
- Derived mint address preview.
- Password-gated launch signing.
- Pending transaction tracking.
- Success screen with mint address/explorer link.
- My launches list from local records plus chain confirmation where available.

### Phase 2 — Token accounts and balances

Only after token account read/parse semantics are verified:

- Owned token balances.
- Imported token metadata.
- Token detail balance panel.
- Asset selector shows sendable token state only when token transfer exists.

### Phase 3 — Trading / curve / graduation

Only after Thru AMM/curve contracts/programs are verified:

- Bonding curve or direct pool templates.
- Buy/sell panels.
- Slippage and price impact.
- Graduation progress.
- Post-graduation DEX links.
- Creator fee claim flows.

### Phase 4 — Social/discovery extensions

Only after core launch lifecycle is reliable:

- Watchlists.
- Trending feed.
- Creator profiles.
- Comments/social links.
- Notifications.
- Launch detector/indexer based on program events.

---

## 11. Visual design direction for Thru

Avoid copying any launchpad’s brand. Use a Thru-native style:

- Dark industrial surfaces already established in the wallet.
- Dense token board with calm hierarchy.
- Monospace addresses and tabular stats.
- Steel/teal/gold/brick palette from existing design tokens.
- No casino neon, no meme-site chaos in wallet chrome.
- Motion only for lifecycle changes: submitted, confirmed, graduation progress, stale/offline.
- Prominent unsupported/offline states.

Suggested tone:

```text
Fast enough for creators.
Precise enough for a wallet.
Honest enough for irreversible on-chain actions.
```

---

## 12. Copy principles

Use concrete, non-promissory language.

| Avoid | Prefer |
| --- | --- |
| Safe launch | Locked liquidity: creator cannot withdraw this pool under the current template. Tokens can still lose value. |
| Guaranteed graduation | Graduation threshold: the launch graduates only if this amount is reached. |
| Verified token | Verified mint address / verified template. |
| Buy now | Review buy. |
| Launch instantly | Create draft / Review launch / Sign and submit. |
| Trending = good | Trending: high recent activity. Not a safety signal. |

---

## 13. QA checklist for launchpad UI

Before enabling any launchpad route:

- Launchpad page has zero `innerHTML`, `insertAdjacentHTML`, `outerHTML`, or `document.write` sinks.
- Every untrusted token field renders through text nodes or safe URL handling.
- Unsupported capabilities are explicit and cannot be clicked through.
- Token names/symbols/images cannot impersonate verified state.
- Mint address is always copyable and visible on detail/review/success screens.
- Create form cannot place name, symbol, image, draft, or account ref secrets in URLs.
- Launch signing uses background `auth: 'signing'`, which requires password re-authentication by default.
- Duplicate launch submit cannot create duplicate transactions.
- RPC failure cannot show success.
- Route destroy clears draft-only sensitive temporary fields.
- Build and full test suite pass.

---

## 14. Immediate next design tasks

1. Draw low-fidelity wireframes for:
   - Discover board.
   - Quick create.
   - Advanced create.
   - Launch review.
   - Token detail.
   - My launches.
2. Decide whether disabled launchpad should be removed from `dist/` until migrated.
3. Add launchpad to DOM sink enforcement or move it under `src/features/launchpad/`.
4. Fix contract drift before any launchpad signing work:
   - `ticker` vs `symbol`.
   - 64-hex mint seed generation.
   - password-gated deploy method.
5. Define `LaunchTemplate` and `LaunchListing` as pure shared domain records.

---

## Phase report

```text
PHASE: Launchpad frontend design and UX study
FILES ADDED: docs/LAUNCHPAD_UX_STUDY.md
FILES MODIFIED: none
BACKEND CHANGES: none
UI CHANGES: none
SECURITY IMPACT: no runtime change; documents launchpad security/UX requirements and warns against enabling current unsafe disabled surface
TESTS: npm test -> PASS before and after document creation
BUILD: npm run build -> PASS before and after document creation
KNOWN LIMITATIONS: no Thru token/AMM/curve live verification; external launchpad research used for UX principles only; no wireframes implemented yet
NEXT PHASE: security hardening from docs/MIGRATION_MAP.md Phase A, then launchpad wireframes/shell after guardrails are in place
```
