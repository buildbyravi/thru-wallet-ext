# Phase 1 — Backend API Layer + Network Config (COMPLETED)

- [x] `src/lib/networks.js` — Typed network config map (alphanet, testnet, mainnet ready)
- [x] `src/shared/format.js` — Pure formatting utilities (`formatThru`, `parseThruAmount`, `truncateAddress`)
- [x] `src/ui/bridge.js` — WalletBridge RPC client with `send`, `onEvent`, and `bootstrap`
- [x] `src/background/services/` — All domain services (wallet, account, tx, token, network)
- [x] `src/background/api-router.js` & `src/background/index.js` — Service worker with auto-lock & port/message routing
- [x] `test-api-router.mjs` — Background API integration test suite

---

# Phase 2 — Reusable UI Component System & Store (COMPLETED)

- [x] `src/ui/store.js` — Reactive pub/sub state store for active account, balances, network, and tokens
- [x] `src/ui/components/drawer.js` — Reusable Rabby-style bottom-sheet slide-up drawer overlay
- [x] `src/ui/components/account-switcher.js` — Rabby-style Account Drawer with live search, derivation, rename, and categorization
- [x] `src/ui/components/network-switcher.js` — Rabby-style Network Drawer with live health and active badges
- [x] `src/ui/components/token-row.js` — Token list item component with avatar fallbacks & tabular numerals
- [x] `src/ui/components/skeleton.js` — CSS shimmer placeholder loading states
- [x] `src/popup/styles/components.css` — Added drawer, token row, account item, and skeleton animation styles

---

# Phase 3 & 4 — Rabby-Style Dashboard & Pre-Sign Transaction Review (COMPLETED)

- [x] **History Serialization Bug Fix**: Fixed `"Could not serialize message"` by properly sanitizing all BigInt fields (`entry.amount`, `entry.slot`) to JSON strings before background RPC message passing.
- [x] **Pre-Sign Simulation Card** (`src/ui/components/tx-review.js`):
  - Visual `- X THRU` balance change box in negative brick-red tint.
  - Pre-sign security checks (self-transfer detection, address verification).
  - Network and fee breakdown before signing.
- [x] **Rabby-Style Dashboard**:
  - Live token asset list showing Native THRU + user-deployed Token Program mints.
  - Seamless Account Switcher and Network Switcher integration.
  - Launchpad & DEX quick-entry banner.
- [x] All test suites passing (`node test-vault.mjs && node test-thru-client.mjs && node test-api-router.mjs`).

---

# Next: Phase 5 & 6 — Desktop Full-Browser Launchpad & Polish

## Planned Modules
- [ ] Hash-based routing for desktop tab (`#/launchpad`, `#/my-tokens`, `#/dex`, `#/predictions`)
- [ ] Modular desktop tabs (`src/ui/desktop/tabs/`)
- [ ] Settings screen (export secrets, auto-lock timer, reset wallet)
