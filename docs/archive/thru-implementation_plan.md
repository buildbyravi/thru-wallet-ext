# Thru Wallet Extension — $100M Redesign

**Goal**: Transform the existing `thru-wallet-ext` from a functional MVP into the **reference wallet for the Thru ecosystem** — Rabby-quality UX, instrument-grade Industrial UI, and a modular architecture designed to absorb new features (tokens, NFTs, dApp connector, multi-network) without rewrites.

> [!IMPORTANT]
> This is a UI/UX architecture redesign, **not a rewrite**. The vault security layer (`vault.js`), Thru client (`thru-client.js`), and cryptographic foundation are production-quality and remain untouched. We're restructuring the presentation layer and adding extensibility hooks.

---

## User Review Required



> [!IMPORTANT]
> **Scope Decision**: This plan covers **Phase 1** (full UI redesign + architecture refactor) and **Phase 2** (new features). Phase 3 (dApp connector, tokens, NFTs) is documented but not implemented. Should we execute Phase 1 only, or Phase 1 + Phase 2?

> [!WARNING]
> **No React/Framework Migration**: Per ChatGPT's advice (and I agree), we stay vanilla JS. The existing extension is 50KB bundled. Adding React would 10× that for no user benefit. The redesign achieves Rabby-quality UX through better architecture, not more dependencies.

---

## Open Questions

> [!IMPORTANT]
> **1. Brand Name**: Keep "Thru Wallet" or adopt a distinct name like "Gauge"? Affects manifest, onboarding, wordmark, Chrome Web Store listing.

> [!IMPORTANT]
> **2. Settings Screen**: The current wallet has no settings screen. Phase 2 adds one. Should settings include RPC endpoint override (for local dev nodes), or is that too advanced for v1?

> [!NOTE]
> **3. Auto-refresh interval**: Current design requires manual "Refresh balance" clicks. Phase 2 adds auto-refresh. What interval? The plan assumes 30 seconds. Thru's alphanet RPC may not tolerate faster polling.

---

## Architecture Overview

### Current Architecture (Monolithic)
```
src/
  background.js          ← 20 lines, alarm-based auto-lock
  manifest.json
  lib/
    vault.js             ← 297 lines, encryption + key management (KEEP AS-IS)
    thru-client.js       ← 339 lines, RPC + tx construction (KEEP AS-IS)
  popup/
    popup.html           ← 286 lines, ALL 16 screens in one file
    popup.js             ← 624 lines, ALL logic in one handleAction() switch
    popup.css            ← CSS aggregator
    icons.js             ← SVG icon set + byte-mark identicon
    styles/
      tokens.css         ← Design tokens (EVOLVE)
      base.css           ← Reset + primitives (EVOLVE)
      components.css     ← Reusable components (EVOLVE)
      screens.css        ← Screen layouts (EVOLVE)
```

### Target Architecture (Modular)
```
src/
  background.js                    ← Enhanced: auto-lock + auto-refresh + notification relay
  manifest.json                    ← Updated permissions

  lib/                             ← UNTOUCHED (production-grade)
    vault.js                       ← Encryption + key management
    thru-client.js                 ← RPC + transaction construction

  popup/
    popup.html                     ← Streamlined shell (screen containers only)
    popup.css                      ← CSS aggregator (same pattern, more imports)

    core/                          ← NEW: Application framework
      router.js                   ← Screen navigation + history stack + transitions
      state.js                    ← Reactive state store (replaces scattered variables)
      events.js                   ← Typed event bus (replaces direct DOM coupling)
      toast.js                    ← Toast notification system

    screens/                       ← NEW: One file per screen
      welcome.js                  ← Onboarding entry
      create-password.js          ← Password setup
      backup.js                   ← Mnemonic backup
      import.js                   ← Mnemonic/key import
      unlock.js                   ← Lock screen (redesigned)
      reset-confirm.js            ← Reset confirmation
      dashboard.js                ← Main hub (redesigned)
      accounts.js                 ← Account switcher (redesigned)
      send.js                     ← Send flow (with tx preview)
      receive.js                  ← Receive (with QR code)
      faucet.js                   ← Faucet claim
      history.js                  ← Transaction history (with filters)
      settings.js                 ← NEW: Settings screen
      add-key.js                  ← Import private key
      export-password.js          ← Export auth
      export-reveal.js            ← Secret reveal

    components/                    ← NEW: Reusable UI builders
      account-pill.js             ← Account selector pill
      account-row.js              ← Account list item
      tx-row.js                   ← Transaction history row
      tx-preview.js               ← Transaction simulation preview
      balance-hero.js             ← Balance display
      action-grid.js              ← Quick action buttons
      modal.js                    ← Modal overlay system
      qr-code.js                  ← QR code generator (canvas-based)
      search-input.js             ← Filtered search
      status-indicator.js         ← Network health dot
      copy-button.js              ← Copy with animation feedback

    icons.js                      ← Expanded icon set (new icons for settings, QR, etc.)

    styles/
      tokens.css                  ← EVOLVED: new tokens for overlays, toasts, transitions
      base.css                    ← EVOLVED: enhanced typography + transitions
      components.css              ← EVOLVED: new component styles
      screens.css                 ← EVOLVED: new screen compositions
      overlays.css                ← NEW: modals, toasts, drawers
      transitions.css             ← NEW: screen transition animations
```

### Data Flow
```
┌──────────────────────────────────────────────────────┐
│                    User Clicks / Inputs               │
└──────────────┬───────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────┐
│              events.js (Typed Event Bus)              │
│   action:go-send, action:submit-send, state:balance  │
└──────────────┬───────────────────────────────────────┘
               ▼
┌──────────────────────────────────────────────────────┐
│              state.js (Reactive State Store)          │
│   { activeAccount, balance, accounts[], history[],   │
│     networkStatus, settings, pendingTx }             │
└──────────────┬───────────────────────────────────────┘
               ▼
┌─────────┬────┴─────┬────────────────────────────────┐
│ vault.js│thru-cli  │ chrome.storage                  │
│ (crypto)│(network) │ (persistence)                   │
└─────────┴──────────┴────────────────────────────────┘
```

### Predicted Failure Modes
| Failure | Mitigation |
|---|---|
| RPC down / alphanet offline | Network health indicator, cached last-known balance, graceful error states |
| Session timeout during send | Re-check unlock state before signing, prompt re-auth if needed |
| Stale balance after tx | Auto-refresh after successful send/faucet, with exponential backoff |
| Screen state corruption | Router manages clean screen lifecycle (mount/unmount/cleanup) |
| Memory leaks from listeners | Each screen module has explicit `cleanup()` called on navigation away |

---

## Proposed Changes

### Phase 1: Architecture Refactor + UI Redesign

---

#### Core Framework

##### [NEW] [router.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/core/router.js)
Screen navigation engine replacing the flat `show()` function:
- Navigation history stack (back button works naturally)
- Screen lifecycle: `mount()` → `update()` → `cleanup()`
- CSS transition hooks for screen enter/exit animations
- Prevents re-mount of already-visible screens
- `clearSensitiveFields()` called automatically on navigate-away

##### [NEW] [state.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/core/state.js)
Reactive state store replacing scattered `let` variables:
- Subscribe/notify pattern for UI reactivity
- Selector-based subscriptions (only re-render on relevant state change)
- Serializable snapshot for debugging
- Replaces: `activeAccount`, `pendingMnemonic`, `importMode`, `pendingExportRef`, `pendingExportSecret`

##### [NEW] [events.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/core/events.js)
Typed event bus replacing the monolithic `handleAction()` switch:
- Action events: `action:go-send`, `action:submit-send`, etc.
- State events: `state:balance-updated`, `state:account-switched`
- Each screen registers its own handlers on mount, removes on cleanup

##### [NEW] [toast.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/core/toast.js)
Toast notification system for transient feedback:
- Auto-dismiss (3s default), manual dismiss
- Types: success (green), error (red), info (amber)
- Replaces inline status text like `statusEl.textContent = 'Claimed.'`

---

#### Screen Modules

Each screen module exports `{ mount, cleanup, update? }`:

##### [NEW] [dashboard.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/screens/dashboard.js)
Redesigned main hub:
- **Account pill** (byte-mark + truncated address + chevron)
- **Balance hero** (tabular mono, large, with THRU unit)
- **Network status dot** with latency (🟢 120ms / 🔴 offline)
- **Quick actions**: Send, Receive, Faucet, History (4-column grid)
- **Recent activity** section (last 3 transactions, inline)
- **Auto-refresh** indicator (spinning dot during fetch)
- **Bootstrap banner** (create on-chain account) with better copy

##### [NEW] [unlock.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/screens/unlock.js)
Redesigned lock screen:
- "Welcome back" heading
- Password field with show/hide toggle
- Subtle entry animation
- Error state with shake animation
- Keyboard: Enter to submit

##### [NEW] [welcome.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/screens/welcome.js)
Redesigned onboarding:
- Brand wordmark hero (larger, centered)
- Three clear action cards (not just buttons):
  - "Create a new wallet" — primary, prominent
  - "Import recovery phrase" — secondary
  - "Import private key" — tertiary text link
- Brief security disclaimer

##### [NEW] [send.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/screens/send.js)
Redesigned send flow with **transaction preview**:
- Address input with validation indicator (✓ valid / ✗ invalid)
- Amount input with "MAX" button (fills balance minus estimated fee)
- **Transaction Preview Panel** (Rabby-inspired):
  ```
  You're sending

  0.1 THRU  →  ta8f2k…x9mP

  Network Fee    ~0.000001 THRU
  ─────────────────────────────
  Total          0.100001 THRU

  [Cancel]  [Confirm & Send]
  ```
- Two-step flow: fill → preview → confirm (prevents accidental sends)

##### [NEW] [receive.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/screens/receive.js)
Enhanced receive screen:
- **QR code** generated from address (canvas-based, no external lib)
- Full address in monospace block
- Copy button with animated feedback (checkmark flash)
- Explorer link

##### [NEW] [history.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/screens/history.js)
Enhanced transaction history:
- **Filter tabs**: All | Sent | Received | Faucet | Failed
- Improved row layout with amount prominently displayed
- Relative timestamps ("2 min ago", "yesterday")
- Empty state illustration

##### [NEW] [accounts.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/screens/accounts.js)
Redesigned account switcher:
- Search/filter bar (by name or address fragment)
- Account rows with: byte-mark, label, address, balance preview
- Rename accounts (editable label, stored in local storage)
- Active account highlighted with amber border
- Add account / Import key buttons at bottom
- Export button per account (not global)

##### [NEW] [settings.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/screens/settings.js)
New settings screen:
- **Security**: Auto-lock timer (5/15/30/60 min), change password (future)
- **Network**: RPC endpoint display, network status
- **Advanced**: Developer mode toggle, cache clear, export logs
- **About**: Version, links to GitHub, disclaimer
- **Danger Zone**: Reset wallet

---

#### Reusable Components

##### [NEW] [components/tx-preview.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/components/tx-preview.js)
Transaction simulation preview panel (Rabby's signature feature, adapted for Thru):
- Asset delta display (what you're sending, what you're receiving)
- Fee estimation
- Recipient address validation status
- Confirm/Cancel action footer

##### [NEW] [components/qr-code.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/components/qr-code.js)
Pure canvas-based QR code generator:
- No external dependencies (Reed-Solomon encoder in ~200 lines)
- Renders Thru addresses as scannable QR codes
- Matches the Industrial UI aesthetic (dark bg, amber modules)

##### [NEW] [components/modal.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/components/modal.js)
Overlay modal system:
- Backdrop blur overlay
- Keyboard: Esc to dismiss
- Used for: tx preview, account rename, danger confirmations

##### [NEW] [components/copy-button.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/components/copy-button.js)
Animated copy feedback:
- Click → icon flashes to checkmark → text says "Copied!" → returns to normal (900ms)
- Replaces per-screen copy logic duplication

##### [NEW] [components/status-indicator.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/components/status-indicator.js)
Network health indicator:
- Pings RPC on load, shows latency
- 🟢 Healthy (< 500ms) / 🟡 Slow (500-2000ms) / 🔴 Offline
- Replaces static footer dot

---

#### CSS Evolution

##### [MODIFY] [tokens.css](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/styles/tokens.css)
New tokens for:
- `--overlay-bg: rgba(11, 12, 14, 0.85)` — modal backdrop
- `--toast-success/error/info` — toast backgrounds
- `--t-screen: 200ms ease-out` — screen transition timing
- `--fs-xxl: 22px` — for welcome screen heading
- `--sp-7: 28px`, `--sp-8: 32px` — larger spacing for breathing room
- `--radius-xl: 14px` — for cards/modals
- `--shadow-overlay` — subtle shadow for modals (only exception to "no shadows" rule, justified for overlays)

##### [MODIFY] [components.css](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/styles/components.css)
New component styles for:
- `.toast`, `.toast-success`, `.toast-error`, `.toast-info`
- `.modal-overlay`, `.modal-card`
- `.tx-preview`, `.tx-preview-row`, `.tx-preview-total`
- `.search-input`
- `.filter-tabs`
- `.account-row-balance`
- `.qr-container`
- `.password-toggle`
- `.status-dot.healthy/.slow/.offline`

##### [NEW] [transitions.css](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/styles/transitions.css)
Screen transition animations:
- Forward navigation: slide-in from right (150ms)
- Back navigation: slide-in from left (150ms)
- Modal: fade-in + scale-up (150ms)
- Toast: slide-down from top (150ms)
- All respect `prefers-reduced-motion`

##### [NEW] [overlays.css](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/styles/overlays.css)
Modal and toast overlay positioning and z-index management.

---

#### HTML Restructuring

##### [MODIFY] [popup.html](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/popup.html)
- Screens remain as `<section>` elements but with cleaner, leaner markup
- Each screen's dynamic content is rendered by its JS module, not hardcoded in HTML
- Add `<div id="toast-container">` for toast notifications
- Add `<div id="modal-container">` for modal overlays
- Keyboard event listeners for Esc (dismiss modal) and Enter (submit forms)

---

#### Background Service Worker

##### [MODIFY] [background.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/background.js)
Enhanced with:
- Configurable auto-lock timer (reads from storage, default 15 min)
- Network health check on alarm (lightweight, non-blocking)
- Badge text update for network status

---

#### Icon Expansion

##### [MODIFY] [icons.js](file:///c:/Users/ravi/Downloads/thru-wallet-ext/src/popup/icons.js)
New icons:
- `settings` (gear)
- `qr` (QR code frame)
- `eye` / `eyeOff` (password show/hide)
- `search` (magnifying glass)
- `filter` (funnel)
- `rename` (pencil)
- `warning` (triangle alert)
- `shield` (security)
- `network` (signal bars)
- `refresh` (spinning arrow — distinct from history clock)
- `trash` (delete/reset)
- `chevronDown` (dropdown indicator)
- `max` (maximize/fill)

---

### Phase 2: New Features (After Phase 1 approval)

#### Address Book
- Local storage of named addresses (`chrome.storage.local`)
- Autocomplete on Send screen
- Add/edit/delete from dedicated screen

#### Account Rename
- Editable labels stored in `chrome.storage.local` keyed by address
- Inline edit in account switcher

#### Activity Notifications
- Toast on successful send/receive
- Badge count on extension icon

#### Auto-Refresh
- 30-second balance polling (configurable in settings)
- Visual indicator when refreshing
- Exponential backoff on consecutive failures

#### Network Health Dashboard
- RPC latency display
- Connection status history
- Manual RPC endpoint override (developer mode)

---

### Phase 3: Future Ecosystem Features (Documented, Not Implemented)

#### dApp Connector
- `window.thru` provider injection (when Thru defines a standard)
- Content script + page script bridge
- Permission management per origin
- Signature request popup

#### Token Support
- Asset list on dashboard (when Thru supports token standards)
- Token transfer flow

#### NFT Support
- Gallery view (when Thru supports NFT standards)

#### Multi-Network
- Mainnet / Testnet / Local network selector
- Per-network RPC configuration

---

## Verification Plan

### Automated Tests
```bash
# Existing test suites must continue passing (vault + thru-client)
npm run test

# Build verification
npm run build
# Verify dist/ contains all expected files
```

### Manual Verification
1. **Load extension in Chrome** (`chrome://extensions` → Load unpacked → `dist/`)
2. **Full onboarding flow**: Create wallet → backup → dashboard
3. **Import flow**: Recovery phrase import, private key import
4. **Account management**: Add HD account, import key, switch, rename
5. **Send flow**: Validate address → enter amount → preview → confirm → verify balance update
6. **Receive flow**: QR code renders, copy works, explorer link works
7. **History**: Loads transactions, filters work, explorer links work
8. **Settings**: Auto-lock timer change persists across restarts
9. **Lock/unlock**: Manual lock, auto-lock after configured timeout, unlock
10. **Reset**: Full wallet reset, clean re-onboarding
11. **Network offline**: RPC down → graceful degradation, cached balance shown
12. **Screen transitions**: Smooth animations, no flicker, back navigation works
13. **Keyboard navigation**: Tab order, Enter to submit, Esc to dismiss modals
14. **Accessibility**: Focus rings visible, screen reader labels present

### Performance Budget
- Bundle size: < 80KB (currently ~50KB, budget allows for new features)
- Popup open to dashboard render: < 200ms
- Screen transition: < 200ms (animation budget)
- No layout shift on balance load (skeleton placeholder)
