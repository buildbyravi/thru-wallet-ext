# Thru Wallet — Product and Security Build Specification

**Document Class:** Authority (Shipped Product, UX, Security & QA Specification)
**Baseline:** Contract **v33** (`154` methods, `15` routes, `@thru/sdk@0.4.4`, `@thru/programs@0.4.4`)
**Companion SSoT Docs:** `docs/DOCS_INDEX.md` · `docs/STATUS_AND_ROADMAP.md` · `docs/PROJECT_LEDGER.md` · `docs/ARCHITECTURE.md` · `CONTEXT.md` · `docs/MODULE_BOUNDARIES.md`

Where another document disagrees with `src/`, `src/` wins. Where documents disagree on **product or security behavior**, this specification wins (`AGENTS.md`). Unshipped features belong exclusively in `docs/roadmap/FUTURE_ROADMAP.md`.

---

## 1. Engineering Mission & Stack Discipline

Maintain the production-grade self-custody Chrome MV3 wallet for the **Thru native Layer 1**: encrypted multi-keyring vault, owned-account activation, network-scoped native and token balances, reviewed value-moving operations (`Send`, `Token Send`, `Domains`, `Faucet`), `Receive`, `History`, and `Settings`.

- **Stack:** Vanilla ES modules bundled with `esbuild` (`0.28.1`), exact-pinned `@thru/sdk@0.4.4` (including `@thru/sdk/crypto`) and `@thru/programs@0.4.4`. Zero UI frameworks, zero CSS preprocessors, zero external runtime dependencies (`Rule 5`). The native THRU faucet has no per-account rate-limit policy; `tx.getFaucetLimit` remains a compatibility response only and does not read the separate THRUSD faucet policy.
- **Delivery Sequence:** `Preserve -> Understand -> Reuse -> Centralize -> Isolate -> Test -> Verify -> Ship -> Document -> Delete obsolete code`.
- **Rabby Reference Boundary:** Rabby Wallet (`MIT`, brand/logo reserved) informs UX hierarchy and approval legibility only — never copy Rabby source code, icons, or EVM/ABI/gas assumptions.
- **Mandatory Local Gate:** Run `npm run build && npm test` before and after every code or doc change.

---

## 2. Wallet & Keyring Container Model (`src/lib/vault.js`)

Never model the wallet as `1 wallet = 1 address`. One encrypted vault container (single master password, PBKDF2-SHA-256 `600,000` iterations with per-vault v1 KDF envelope + AES-256-GCM) holds multiple isolated keyrings:

```text
Wallet Container (1 password, 1 unlocked session in chrome.storage.session)
├── Seed Keyring A (type: 'seed', origin: 'generated' | 'imported', backedUpAt)
│   ├── HD Account 0
│   ├── HD Account 1 ...
├── Seed Keyring B (type: 'seed' — multi-seed supported)
└── Private-Key Keyrings (type: 'privateKey' — 1 account per keyring)
```

- **Opaque URL References (`src/shared/refs.js`):** Routes address accounts via encoded `{ keyringId, accountIndex }` refs (`/account?ref=`, `/export?ref=`), never raw keys or secrets (`Rule 9`).
- **Unshipped Keyring Types:** Hardware wallets, passkeys, and watch-only accounts are **not** shipped (`docs/roadmap/FUTURE_ROADMAP.md`).

---

## 3. Shipped Route & Feature Behavior (`15` Routes)

All 15 routes are registered in `src/ui/app/boot.js`, mount immediately from local/cached state without blocking on RPC (`Rule 15`), and tear down all listeners via `disposer()` (`Rule 11`):

1. **Onboarding (`/welcome`) & Unlock (`/unlock`, `/reset`):**
   - `/welcome`: Create 12-word recovery phrase (generated inside background `wallet.create` / `keyring.createSeed`), backup reveal + multi-bucket word verification challenge, or import mnemonic / 64-hex private key with address preview.
   - `/unlock`: Master-password unlock with background persisted failure backoff (`auth-service.js`).
   - `/reset`: Reachable from `/unlock` for forgotten-password recovery; requires typed `RESET` confirmation (and master password if invoked while unlocked, `v6`).
2. **Dashboard (`/dashboard`):**
   - `196px` ink header (`BalanceHero`), active account/copy/side-panel controls, single `Tokens` drawer trigger (native `THRU` + verified custom/discovered mints; proven-zero `0` vs unknown `—` kept distinct), frozen `2x3` primary action grid (`88px` cells enforced by `scripts/check-panel-tiles.mjs`), secondary services grid (`Domain`), and `CurrentConnection` network/health footer.
   - Automatically invokes `tx.registerAccount` (`auth: 'unlocked'`) when a live read proves the active vault-owned account does not yet exist on-chain.
3. **Accounts & Keyrings (`/accounts`, `/account`, `/add-account`, `/keyring`, `/export`):**
   - Account switching, background-sanitized labels (`<= 32` chars, markup stripped), preference-backed pin/hide/order, non-persisting HD preview (`account.previewHd`), batch HD derivation (`account.addHdBatch`), single HD removal (preserving at least 1 account per keyring), and password-gated phrase/private-key export (`/export` clears revealed DOM immediately on navigate-away or lock).
4. **Send (`/send`) — Native THRU & Token Program Transfers:**
   - Form renders immediately while balances/tokens hydrate. Supports pasted address, contact/own-account picker, and `.thru`/`.id` forward/reverse name resolution (displaying matched name above the full `ta...` address).
   - **JIT Owned-Recipient Activation (`v12`):** If a native transfer targets an unregistered address **owned by this unlocked vault**, `/send` runs `tx.registerAccount` (`NOOP_PROGRAM_ADDRESS`, self-signed by the target account) and keeps Review disabled until activation settles. External unregistered addresses cannot be activated by the sender (`RECIPIENT_NOT_ACTIVATED`).
   - **Token Transfers (`v8`):** Denominated using verified on-chain mint decimals (`parseTokenAmount` / `formatTokenAmount`). Missing recipient token PDAs are initialized by the sender in a preceding transaction (disclosed in review). Token network fees remain labelled `"not confirmed (paid in THRU)"` until promoted into `networks.js`.
5. **Transaction Review & Consent Pipeline (`v29`–`v32`):**
   - Every value-moving screen (`/send`, `/name`, `/faucet`) prepares via `tx.prepareReview`, renders the single `TxReviewCard`, confirms via `tx.confirmReview` (minting a single-use 60s `consentToken` verified in `api-router.js`), and submits via `confirm.js` (`submitReviewedReview` with required route `AbortSignal`). Undecodable (`raw`) intents have `submit: null` and cannot sign; `tx.simulate` returns `supported: false` so post-tx balances are never fabricated. Full specification: `docs/guides/transaction-review.md`.
6. **Domains (`/name`, `v21`–`v31`):**
   - Two tabs (`Register` and `My Domains`), `.thru`-only registration and renewal (`via: 'custom'` tiered layout-2 registrar first, official paid registry fallback), `.id` lookup-only support, per-network tracked inventory (`thru_registered_domains`), and `tx-units.networkFeeUnits` header fees. Full specification: `docs/guides/domains-and-registrar.md`.
7. **Faucet (`/faucet`, `v13`, `v24`):**
   - Testnet native THRU claim (`raw base units`, network-configured `10,000` per-claim cap on Betanet); there is no per-account rate-limit readout (the separate THRUSD faucet policy does not apply). Claims use `faucet-claim` review and are bound to `fromAddress` + `networkId`.
8. **Receive (`/receive`):**
   - Branded canvas QR (`src/popup/qr.js`), full `ta...` address, inline `"Copied"` copy affordance, account label, explicit active-network badge, and explorer link.
9. **History (`/history`, `v9`–`v12`):**
   - Flat newest-first stream without day headers, cache-first `tx.getCachedHistory`, provenance-tagged timestamps (`block` -> own `submitted` -> `Block <slot>`), and lazy `tx.getDetail` sheet reporting `Fee (declared)`. Full specification: `docs/guides/history-and-activity.md`.
10. **Settings (`/settings`):**
    - Built-in network switcher (`betanet` enabled; legacy custom RPC rows inert with `Remove` only, `v7`), password-gated Signing policy (`Session-only` default vs `Require password`, `D-003`), password-gated Auto-lock (`1–240` min or `Never`, `15` min default), Side Panel Mode opt-in, Send whitelist, notifications toggle, and theme selector, with bounded in-popup `?` help cards (`help-tooltip.js`).

---

## 4. Security Policy & Test Matrix

- **Secret Hygiene (`Rule 9`):** Mnemonics, private keys, passwords, and decrypted vaults never touch URLs, `location.hash`, router history, `data-*`, `localStorage`, `sessionStorage`, `window`, or `console.*`. Secret inputs disable `spellcheck`, `autocorrect`, `autocapitalize`, and `autocomplete`.
- **Storage Separation:** Ciphertext, versioned preferences/contacts, and `scopedKey` caches live in `chrome.storage.local`; decrypted session keys live exclusively in `chrome.storage.session`; v32 `consentToken`s live exclusively in worker JS memory (`Map`).
- **Strict CSP (`Rule 8`):** `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://rpc.betanet.thru.org; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`, verified against `src/lib/networks.js` by `scripts/check-csp.mjs`.

| Security Scenario | Enforced Behavior | Automated Gate |
| --- | --- | --- |
| Repeated wrong unlock passwords | Rejected with persisted exponential lockout/backoff | `test/test-api-router.mjs` |
| Signing call while wallet is locked | Rejected with `WALLET_LOCKED` before handler | `test/test-api-router.mjs`, `test/test-review-lifecycle.mjs` |
| Value-moving call without `tx.confirmReview` token | Rejected at router with `REVIEW_REQUIRED` (`0` RPC touches) | `test/test-review-consent.mjs` |
| Replayed `consentToken` or `reviewId` | Token burned on first attempt; review discarded on submit | `test/test-review-consent.mjs`, `test/test-tx-review.mjs` |
| Lock / account switch / network switch after prepare | Discards `tx_reviews` and clears `consentToken`s | `test/test-review-lifecycle.mjs` |
| Opt-in `requirePasswordForSigning` enabled | Missing/wrong password rejected before signing | `test/test-api-router.mjs` [8] |
| Changing `requirePasswordForSigning` or `autoLock` | Requires master password via `settings.setSecurity` / `system.setAutoLock` | `test/test-api-router.mjs` [7], `test/test-security-checks.mjs` |
| Foreign address passed to `tx.registerAccount` | Rejected by vault ownership verification; never signs | `test/test-registration.mjs` |
| Hostile on-chain token ticker/name markup | Rendered via `textContent` in `h()`; `0` HTML sinks | `scripts/check-layering.mjs`, `test/test-ui-dom.mjs` |
| Secret left in DOM after route teardown or lock | Fails detached-subtree & live-DOM `findSecrets` scan | `test/test-route-lifecycle.mjs` |
| Direct `network.setActive` to custom/disabled network | Permanently refused (`CUSTOM_NETWORK_DISABLED`); self-heals on boot | `test/test-api-router.mjs` [11] |

---

## 5. Design System & Accessibility

- **Palette & Typography (`src/popup/styles/tokens.css`):** Industrial Thru aesthetic (Steel, Teal, Brick `#c43a40` / `#d33c40`, Gold `#ffad42`, self-hosted `Inter Tight` + `JetBrains Mono`, tabular numerals for financial figures). Flat CSS only (`scripts/check-css-nesting.mjs`); all used classes defined (`scripts/check-routes.mjs`).
- **Dimensions:** Toolbar popup is `400px x 600px`; side panel caps cleanly to narrow (`~300px`) and wide (`>=800px`) viewports. Every modal/sheet change requires real-browser inspection (`Rule 14`, `docs/MANUAL_SMOKE_CHECKLIST.md`).
- **Accessibility:** Modals/sheets trap Tab/Shift+Tab and Escape via `src/ui/kit/focus-trap.js` and restore focus on close.
