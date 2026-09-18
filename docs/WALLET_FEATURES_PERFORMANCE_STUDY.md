# Wallet feature and performance study for a Rabby-class Thru-native extension

Date: 2026-09-18  
Scope: product/architecture study for what a modern browser wallet generally needs, and how the Thru wallet should scale without popup lag or hanging. This is a design document only; it does not implement new chain, token, DEX, launchpad, chart, or dApp-provider behavior.

> Thru-specific rule: use MetaMask, Rabby, Phantom, Keplr, Brave Wallet, and Coinbase/Base Wallet as UX and architecture references only. Thru is a native Layer 1, so implementation must use verified Thru-native SDKs/programs, official gRPC/gRPC-Web transport after endpoint/devnet validation, and a future verified read/indexer adapter where needed. Do not copy EVM/Solana/Cosmos assumptions into Thru.

---

## 1. What popular extension wallets generally include

### A. Core wallet features every serious extension needs

| Area | Expected features |
|---|---|
| Onboarding | Create wallet, import seed, import private key, backup flow, password setup, lock/unlock |
| Accounts | Multiple accounts, account labels, hide/pin/reorder accounts, account switching |
| Receive | Address copy, QR code, network-aware receive warnings |
| Send | Reviewed send flow, address validation, amount validation, fee display, confirmation, pending tx tracking |
| Activity | Transaction history, pending/confirmed/failed states, explorer links |
| Assets | Native coin balance, token balances, custom token import, spam/hidden token handling |
| Security | Auto-lock, password re-auth, phishing/risk warnings, clear signing review, no raw secret leakage |
| Settings | Network selection, custom RPCs, currency/display prefs, security prefs |
| Backup/export | Password-gated seed/private-key export, backup reminders |
| Hardware wallets | Ledger/Trezor style integration for higher-value accounts |
| dApp connection | Connect/disconnect sites, per-site permissions, account/network permissions |
| Signing | Human-readable signature/transaction preview, password or session policy, rejection path |

MetaMask's portfolio dashboard is an example of the broader asset-hub direction: it aggregates accounts/assets and supports buy, swap, bridge, and stake flows from a wider dashboard surface.

MetaMask also treats swaps as a built-in flow across extension/mobile/portfolio, with quote review before confirmation.

---

## 2. Features by wallet type

### MetaMask-style wallet

Good general model for:

- dApp connection
- account permissions
- custom networks
- swaps
- portfolio dashboard
- hardware-wallet compatibility

MetaMask-style dApp connection exposes accounts/networks to a dApp, but transactions still require user approval. For Thru, the important lesson is: **connection is not signing**. Thru's current official docs describe `@thru/wallet` connecting a web app to the hosted `wallet.thru.org/embedded` iframe; that hosted flow is not evidence of an extension-compatible provider or a BYO-signer path. Do not invent an unverified `window.thru` standard or copy the hosted protocol. A future dApp integration must follow an official extension/BYO-signer contract, if published, and its documented `connect()`, `getSigningContext()`, and `signTransaction()` lifecycle after compatibility is validated.

### Rabby-style wallet

Good model for:

- pre-sign simulation
- balance-change preview
- risk alerts
- approval risk detection
- DeFi-heavy users
- clear “what will happen if I sign?” review

Rabby's strongest transferable pattern is the pre-sign security engine: transaction simulation, balance-change preview, risky approval alerts, and risk alerts before signing. Some signing flows disable the sign button until the user processes alerts.

For Thru: this should become a **Thru-native signing review engine**, not an EVM simulator clone.

### Phantom-style wallet

Good model for:

- fast consumer UX
- simple token/NFT experience
- swaps
- staking
- spam token/NFT filtering
- readable transaction previews

Phantom's useful pattern is fast daily use: transaction previews, spam detection, auto-lock, activity tracking, token/NFT organization, and simple quick actions.

For Thru: this is useful for “no-lag consumer wallet feel”: fast home screen, simple actions, strong anti-spam/risk treatment.

### Keplr-style wallet

Good model for:

- app-chain / L1 ecosystem wallet
- staking
- governance
- validator workflows
- chain add/support flows
- Ledger support

Keplr is useful as an L1/app-chain reference because it centers account management, staking, governance voting, adding chains, and Ledger support.

For Thru: if Thru later has staking/governance, the right UX is closer to Keplr than MetaMask.

### Brave Wallet-style architecture lesson

Brave Wallet is browser-native rather than an extension, and Brave explicitly frames reduced reliance on extra CPU/memory as a benefit. It also includes portfolio, market graphs, swaps, send/receive/bridge, NFT/multichain support, dApp interaction, and hardware wallet import.

For Thru extension: we cannot be browser-native, but we can copy the **principle**:

> keep the popup tiny, keep background work non-blocking, and move heavy views to a full tab.

### Coinbase/Base Wallet-style wallet

Good model for:

- easy onboarding
- dApp access
- DEX trading
- NFT collecting
- self-custody desktop usage

Coinbase/Base Wallet-style desktop extension UX is useful for broad dApp access and easy onboarding.

For Thru: the lesson is broad access, but implementation must remain Thru-native and verified.

---

## 3. Feature set recommended for Thru wallet

### Phase 1 — wallet must feel fast and safe

Already aligned with current MVP direction:

1. Create/import wallet.
2. Lock/unlock.
3. Multi-account management.
4. Native THRU balance.
5. Receive.
6. Send.
7. Faucet/devnet support.
8. Activity/history.
9. Network selection.
10. Export seed/private key with password.
11. Auto-lock.
12. Password re-auth for signing by default.
13. Optional session-only signing setting, clearly labelled less secure.
14. Pending transaction tracking.
15. Clear unsupported states instead of fake token/DEX data.

### Phase 2 — Rabby-class safety

1. Pre-sign review card.
2. Balance-change preview where verified.
3. Risk warnings.
4. Duplicate transaction detection.
5. Whitelist/contacts.
6. Site connection permissions.
7. Session signing policy.
8. Hardware wallet architecture.
9. Address book.
10. Transaction labels.
11. Scam/spam token hiding.
12. “Unknown token / unverified token” warnings.
13. Full activity details with explorer links.

### Phase 3 — Thru-native asset layer

Only after verified Token Program reads/writes:

1. Token balances.
2. Custom token import.
3. Token transfer.
4. Token account activation state.
5. Token metadata.
6. Hide/unhide tokens.
7. Spam token detection rules.
8. Token deploy only if Token Program semantics are verified.
9. No fake balances.

### Phase 4 — swap and DeFi

Popup:

1. Quick swap.
2. Token selector.
3. Quote refresh.
4. Slippage setting.
5. Minimum received.
6. Price impact.
7. Route/venue info.
8. Review + signing auth.
9. Pending swap tracking.

Full tab:

1. Advanced swap terminal.
2. Launchpad.
3. Markets.
4. Charts.
5. Pool detail.
6. Liquidity views.
7. Token launch preparation.
8. Watchlists.
9. Orders/trade history if supported.
10. Perps/prediction modules only if Thru-native primitives are verified.

---

## 4. Two-surface model: popup vs full tab

This is the right model for avoiding lag.

### Popup should only do quick interactions

Popup target:

- 408×580-ish compact UI
- opens instantly
- no heavy charts
- no large tables
- no expensive indexing
- no live polling loops on first paint

Popup pages:

1. Dashboard
2. Send
3. Receive
4. Swap quick form
5. Activity summary
6. Account switcher
7. Network switcher
8. Settings basics
9. Sign request approval

Popup should not host:

- launchpad creation wizard
- DEX terminal
- OHLC charts
- order books
- multi-token screener
- heavy history pagination
- DeFi portfolio analytics
- perps terminal

### Full tab should host advanced workflows

Full-tab mode:

- launchpad
- DEX terminal
- charts
- markets
- token pages
- pool pages
- advanced signing prep
- strategy views
- creator dashboards
- watchlists
- analytics

This avoids making the popup hang because charts, candles, pool data, and market lists are heavy.

---

## 5. How to make the wallet fast: no lag, no hanging

### A. First paint must never wait for network

Bad:

```txt
open popup → wait RPC → wait balances → wait tokens → wait history → render
```

Good:

```txt
open popup → render shell from cached/session state immediately
           → fetch balances/history in background
           → update UI when data arrives
```

For Thru wallet:

- `system.bootstrap` should return local wallet/account/network/cache state quickly.
- Balance refresh should be fire-and-forget.
- History should load after first paint.
- Network health should not block initial render.
- Token metadata should be cached and refreshed in background.

### B. Use stale-while-revalidate

Show:

```txt
Balance: 12.4 THRU
Updated 42s ago
Refreshing…
```

Then update when fresh data arrives.

Do not show blank screen while waiting.

### C. Separate “critical path” and “background path”

Critical path for popup open:

1. Is vault present?
2. Is wallet unlocked?
3. Active account public info.
4. Cached balance.
5. Cached pending tx count.
6. Render.

Background path:

1. Refresh balance.
2. Reconcile pending tx.
3. Fetch history.
4. Fetch token list.
5. Check network health.
6. Refresh prices.

### D. Never run charts in popup

Charts need:

- OHLCV data
- resize observers
- canvas/SVG work
- crosshair interaction
- historical fetches
- live updates

Put all of that in the full tab.

Popup can show:

```txt
THRU
12.4
+1.2% today
Open chart →
```

### E. Debounce all user input that touches network

For swap/send:

- address validation: debounce 250–400ms
- quote refresh: debounce 300–500ms
- token search: local search first, remote search after debounce
- slippage/amount update: cancel stale quote request

Never let old responses overwrite newer input.

### F. Use request cancellation / request IDs

Pattern:

```js
let quoteRequestId = 0;

async function refreshQuote(input) {
  const id = ++quoteRequestId;
  const quote = await fetchQuote(input);
  if (id !== quoteRequestId) return; // stale response
  renderQuote(quote);
}
```

This prevents UI flicker/hanging when users type quickly.

### G. Cap concurrency

Never fire 100 account/token balance calls at once.

Use:

- max 4–6 concurrent RPC calls
- batch RPC where Thru supports it
- cache per network
- lazy-load lower-priority data

### H. Virtualize long lists

For:

- token lists
- transaction history
- market screeners
- launchpad feed
- NFT grids

Only render visible rows. A wallet popup should not create hundreds of DOM nodes.

### I. Keep service worker awake only when needed

Chrome MV3 service workers sleep. Design for it:

- persisted cache in `chrome.storage.local`
- session/unlocked data in `chrome.storage.session`
- no assumption that in-memory JS survives
- resume background tasks idempotently
- pending tx reconciliation can restart safely

### J. Make every async state explicit

Every card should have:

- cached
- loading
- fresh
- stale
- failed
- unsupported

Not:

- spinner forever
- empty list with no explanation
- frozen button
- silent failure

---

## 6. Performance budget for Thru wallet

### Popup budget

| Item | Target |
|---|---:|
| First visible shell | < 100 ms after JS starts |
| Cached dashboard content | < 250 ms |
| Fresh balance update | async, non-blocking |
| Route change | < 100 ms |
| Button click feedback | immediate |
| Send form validation | local instantly, network async |
| Sign prompt open | immediate |
| No long main-thread task | ideally < 50 ms |

### Full tab budget

| Item | Target |
|---|---:|
| Shell render | < 300 ms |
| Market/charts skeleton | immediate |
| First chart data | async |
| Large lists | virtualized |
| Live updates | throttled |
| Heavy calculations | worker/background/indexer |

---

## 7. Architecture for scale

### Recommended layers

```txt
UI routes
  ↓
UI domain components
  ↓
bridge.send(method, params)
  ↓
api-router
  ↓
application services
  ↓
Thru client / SDK / indexer adapters
  ↓
Future verified read/indexer adapter
```

Rules:

1. UI never imports vault internals.
2. UI never directly signs.
3. UI never directly talks to RPC for wallet-critical state.
4. Background owns auth and signing.
5. Indexer owns market/chart history.
6. Popup reads cached summaries.
7. Full tab can request heavier datasets.

### Data split

| Data | Storage / owner |
|---|---|
| encrypted vault | local encrypted storage |
| unlocked session | session storage only |
| balances | per-network cache |
| pending tx | per-network cache |
| token metadata | per-network cache |
| preferences | local non-secret storage |
| market candles | indexer/full-tab cache |
| chart state | full-tab only |
| secrets | never in UI state, URLs, logs, localStorage |

---

## 8. Quick interaction design

### Best quick actions in popup

1. Copy address
2. Receive QR
3. Send
4. Swap
5. Lock
6. Switch account
7. Switch network
8. View pending tx
9. Open full tab
10. Approve/reject signing request

### Avoid in popup

1. launchpad multi-step creation
2. advanced DEX chart
3. full transaction history
4. portfolio analytics
5. perps trading terminal
6. token discovery feed
7. full DeFi dashboard

### Button behavior

Every money-moving button should have:

```txt
idle → validating → review → auth → signing → submitted → tracked
```

Never:

```txt
click → frozen UI → maybe something happened
```

### Error behavior

Good error:

```txt
Recipient account is not activated on this network.
The recipient must activate it before it can receive THRU.
```

Bad error:

```txt
vmError=-765
```

---

## 9. What Thru wallet should copy conceptually, not literally

| Wallet | Copy this idea | Do not copy |
|---|---|---|
| Rabby | pre-sign clarity, risk review, DeFi-first layout | EVM assumptions |
| MetaMask | dApp permission model, broad account/network UX | old cluttered popup UX |
| Phantom | speed, simple asset UX, scam/spam handling | Solana-specific token assumptions |
| Keplr | L1/app-chain staking/governance model | Cosmos-specific protocol assumptions |
| Brave Wallet | low-overhead architecture mindset | browser-native implementation |
| Coinbase Wallet | easy onboarding and dApp accessibility | centralized-brand assumptions |

---

## 10. Recommended Thru feature roadmap

### Immediate

1. Keep fixing audit items.
2. Reset password/confirmation policy.
3. Auto-lock password-gated changes.
4. Remove or migrate disabled launchpad DOM sinks.
5. Add route mount tests.
6. Keep popup fast.

### Next

1. Token transfer.
2. Token balances.
3. Token account activation UX.
4. Better pending/history UI.
5. dApp permission model only after a verified Thru extension/BYO-signer standard; the current hosted embedded-wallet package is not that standard.
6. Full-tab shell.

### Then

1. Quick swap in popup.
2. Full-tab DEX terminal.
3. Launchpad tab.
4. Thru-native AMM integration.
5. Indexer-backed charts.
6. Watchlists and market pages.

### Later

1. Hardware wallets.
2. Passkeys if official Thru wallet/passkey flow fits.
3. Staking/governance if Thru supports them.
4. Perps/prediction markets only after verified Thru-native primitives.

---

## 11. Feature-module target shape

Longer-term full-tab features should not remain as tabs inside one legacy launchpad page. They should be isolated by namespace and ownership:

```txt
src/features/
  launchpad/     # deploy/create tokens only
  dex/           # quotes, pools, swaps only
  prediction/    # markets, orders, settlement only
  portfolio/     # optional future module

src/background/features/
  launchpad/
  dex/
  prediction/

src/lib/thru/
  token-adapter.js
  amm-adapter.js
  oracle-adapter.js
  clob-adapter.js
```

Feature rules:

1. Each feature owns its UI, tests, contract entries, background router/service, storage keys, and namespace.
2. Feature namespaces should be explicit: `launchpad.*`, `dex.*`, `prediction.*`, `portfolio.*`.
3. Features must not import one another.
4. Features must not import vault internals.
5. Signing should go through a shared transaction-intent service.
6. Mutating feature actions should create a pending intent, then require extension review/signing.
7. Unsupported Thru-native capabilities must return explicit unsupported states, never fake values.

---

## 12. AI-agent and MCP safety model

A future local companion MCP can help agents inspect wallet state and prepare transactions, but it must not live inside the extension worker and must never bypass the human review/signing boundary.

Safe MCP-style tools:

- read balances
- read public accounts
- read assets
- read activity
- prepare transaction intent
- explain unsupported states

Protected tools:

- all mutations create a pending intent only
- extension UI shows human review
- extension UI applies password/session signing policy
- background performs signing

Forbidden tools:

- mnemonic export
- private-key export
- password access
- direct signing
- direct broadcast from an agent
- security-setting changes
- reset wallet

For AI agents, add a read-only `llms.txt`/`AGENTS.md`-style document that describes architecture, contract versions, safe workflows, and non-goals. That file should teach agents how to work safely without giving them any secret access or signing capability.

---

## Bottom line

A high-quality wallet extension is not just “send/receive.” It needs:

1. **fast popup interactions**
2. **strong signing review**
3. **background-enforced auth**
4. **cached non-blocking data**
5. **full-tab advanced workflows**
6. **honest unsupported states**
7. **no fake balances/charts/DEX behavior**

For this Thru wallet, the right target is:

```txt
Popup = fast wallet + quick swap + signing approvals
Full tab = launchpad + DEX/DeFi terminal + charts + markets
Background = auth, signing, vault, Thru SDK, RPC coordination, and official gRPC/gRPC-Web transport and future read/indexer adapter coordination after endpoint/devnet validation
Indexer = history, market data, chart data
```

That gives the Rabby-class interaction model without pretending Thru is EVM.
