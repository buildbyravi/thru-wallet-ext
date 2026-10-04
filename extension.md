# Chrome Web Store listing — Thru Wallet

Source of truth for the public Chrome Web Store listing. When the listing needs to change,
edit the fields here first, then mirror the text into the Chrome Web Store dashboard. Keep
the copy in this file identical to what is live on the store (whitespace and punctuation
included) so diffs here are real listing diffs.

| | |
| --- | --- |
| Listing | <https://chromewebstore.google.com/detail/thru-wallet/ocahgpmgfeapjnceaknkikanjikhjgok> |
| Item ID | `ocahgpmgfeapjnceaknkikanjikhjgok` |
| Developer dashboard | <https://chrome.google.com/webstore/devconsole> |
| Website (listing) | <https://thruwallet.vercel.app> (`homepage_url` in `src/manifest.json`) |
| Support | Telegram channel <https://t.me/walletext> (store listing + `SUPPORT.md`) · Telegram group <https://t.me/+dA8TwsOECcIxZWZl> (shown in Settings → About) |
| Privacy policy URL (as submitted) | <https://github.com/buildbyravi/thru-wallet-ext/blob/main/PRIVACY.md> |
| Package version at last sync | `1.4.1` (`src/manifest.json`) |
| Last synced with the live listing | 2026-10-04 |

---

## 1. Product details

**Title from package**

```text
Thru Wallet
```

**Summary from package**

```text
High-performance self-custody wallet and key manager for Thru.
```

**Description**

```text
Thru Wallet is an experimental, open-source self-custody wallet for Thru's betanet blockchain.

Key Features:

- Self-Custody Account Management: Generate recovery phrases or import existing accounts and private keys.

- On-Chain Transfers: Send THRU and custom tokens with detailed transaction review, recipient lookup, and fee estimation.

- Native Token Management: Inspect balances across native THRU and program-derived tokens with a clean Rabby-inspired sliding token drawer.

- Verified Custom Tokens: Import tokens by contract address with on-chain verification of ticker, decimals, and supply.

- Receive & Scan: View your address and QR code to receive testnet funds.

- Testnet Faucet: Claim testnet THRU directly from the extension to test transactions.

- Transaction Activity & Auto-Sync: Real-time activity feed with live auto-refresh every 30 seconds and transaction details.

- Desktop Notifications: Optional native desktop notifications alerting you when transactions confirm or fail on-chain.

- Local Encryption: Keys are encrypted at rest using PBKDF2 (600k iterations) + AES-256-GCM.

- Auto-Lock Protection: Inactivity lock automatically clears decrypted keys from memory after 15 minutes. Shortcut: Ctrl+L.

- Zero Telemetry: No analytics, tracking, third-party scripts, or remote code execution.

Notice: This is community-built, open-source software for the Thru Betanet testnet. It is not affiliated with or endorsed by Unto Labs and has not been audited. Do not use with real financial value.
```

**Category**

```text
Tools
```

**Language**

```text
English
```

## 2. Single purpose description

```text
A dedicated cryptocurrency key and transaction manager for the Thru Betanet testnet, enabling users to store encrypted keys, review transaction details, and perform transfers on the Thru blockchain.
```

## 3. Permission justifications

The manifest requests exactly five permissions (`src/manifest.json`: `storage`, `alarms`,
`sidePanel`, `clipboardRead`, `notifications`) — one justification each, matching what the dashboard holds.

**storage**

```text
Used exclusively to store the user's AES-256-GCM encrypted vault data, active account selection, and first-run disclaimer preferences locally on their device. No stored data is ever transmitted to external servers or third parties.
```

**alarms**

```text
Used to power the 15-minute auto-lock security timer. When the timer expires after inactivity, the extension automatically locks the wallet and clears decrypted keys from memory to protect the user.
```

**sidePanel**

```text
This extension uses the side panel as the wallet interface so users can view balances, accounts, transaction history, and approve actions without leaving the current page. It provides a secure, quick-access self-custody wallet experience for managing Thru assets in context while browsing.
```

**clipboardRead**

```text
The extension reads clipboard content only when the user explicitly chooses to paste a wallet address, transaction hash, or other importable value into the wallet. This enables faster and less error-prone address/transaction entry and is only used for user-initiated import workflows.
```

**notifications**

```text
Used to display native desktop notifications when on-chain transactions confirm or fail, alerting users of transaction finality even when the popup is closed. Configurable via on/off toggle in Settings.
```

## 4. Are you using remote code?

```text
No, I am not using Remote code
```

True in code: `script-src 'self'`, `default-src 'none'` (see `src/manifest.json` CSP and
`scripts/check-csp.mjs`).

## 5. Privacy policy

<https://github.com/buildbyravi/thru-wallet-ext/blob/main/PRIVACY.md> — maintained in
`PRIVACY.md` in this repository. If `PRIVACY.md` moves or changes scope, update the URL or
content in the dashboard in the same release.

## 6. Copy accuracy notes (verified against the code 2026-10-04)

Documentation summarizes the code; it does not override it. When refreshing the listing,
re-check these claims against `src/` and fix the copy if the code moved.

| Listing claim | Code | Status |
| --- | --- | --- |
| PBKDF2 (600k iterations) | `src/lib/vault.js` — `PBKDF2_ITERATIONS = 600_000`, PBKDF2-SHA-256 | ✅ exact |
| AES-256-GCM at rest | `src/lib/vault.js` — 256-bit non-extractable AES-GCM key | ✅ exact |
| Auto-lock after 15 minutes | `src/shared/autolock.js` — `DEFAULT_AUTOLOCK_MINUTES = 15` | ✅ default is 15 min; user-configurable 0–240 min. The live listing still says "after 15 minutes" (verified 2026-10-04) — consider "by default after 15 minutes" at the next copy refresh |
| Five permissions, one purpose each | `src/manifest.json` — exactly `storage`, `alarms`, `sidePanel`, `clipboardRead`, `notifications` | ✅ exact |
| Zero telemetry / no remote code | no analytics, no remote scripts; CSP `script-src 'self'` | ✅ exact |
| Features: HD/import, send + review, receive QR, faucet | routes in `src/ui/app/routes/` (dashboard, send, receive, add-account, settings/faucet) | ✅ shipped |

## 7. Related Thru ecosystem listings (reference)

Seen on the Chrome Web Store (2026-09-26). Not affiliated. Useful as comparison when
refreshing our title/summary/description positioning — read them for context, never copy
their claims into ours without verifying against this codebase.

| Extension | Listing |
| --- | --- |
| ThruScan Wallet | <https://chromewebstore.google.com/detail/thruscan-wallet/gblngdlddahgpkimebbljmpedddckafb> |
| ThruShield | <https://chromewebstore.google.com/detail/thrushield/fdilacbieiajomeepcjknbncahhfmeia> |

## 8. Updating the listing

Update this file whenever any of the following land, then mirror to the dashboard:

1. **A release changes user-visible behavior** — feature bullets, summary, or the single
   purpose description no longer match `src/` (see §6 for the claims table).
2. **`src/manifest.json` permissions or CSP change** — add/rewrite the matching justification
   in §3 in the same release. Never let the dashboard hold a justification the manifest
   contradicts.
3. **`PRIVACY.md` changes scope or location** — refresh §5 and the dashboard privacy URL.
4. **Security-relevant defaults change** (KDF iterations, cipher, auto-lock default) — the
   marketing claims in §1 quote these numbers; they must track the code.

Workflow: edit this file → run `npm run build && npm test` → update the Last-synced row and
add a changelog row below → paste the changed fields into the dashboard → note the store's
review status.

## 9. Listing changelog

| Date | What changed | Notes |
| --- | --- | --- |
| 2026-10-04 | **Store sync — package `1.4.1` is live.** The listing now carries this file's §1 copy (betanet description: token drawer, verified custom tokens, desktop notifications, Ctrl+L, the unaudited/community-built notice), five screenshots, and the linked developer website. Verified on the live page 2026-10-04: version `1.4.1`, updated October 4 2026, `272KiB`, five screenshots; the Details block lists Website (`thruwallet.vercel.app`) + Email and a non-trader declaration, and no longer displays an "Offered by" publisher row. | Resolves the 2026-10-03 "store upload of 1.4.1 pending" note. §1/§2/§3 copy verified identical to the live listing. **No browser verification of the shipped package is recorded** — `docs/MANUAL_SMOKE_CHECKLIST.md` has zero ticked boxes; the runbook is the top open item in `docs/STATUS_AND_ROADMAP.md` §2. |
| 2026-10-03 | Package `1.4.1` — **@thru 0.4.1 sync + pre-merge hardening**: `@thru/sdk` & `@thru/programs` 0.4.1 (addresses/PDA vectors verified unchanged); duplicate-send guard now tracks transfers at **submission** so the "Repeated Transaction" security card covers the whole pending window (was: warning only after confirmation); `tx.send` honors `allowDuplicate`; dark-mode readability (action grid, drawer ledger, connection footer); imported-key names persist and all private keys group under one "Private Key" section; Send account rows match Manage Accounts | 20 suites / 1,641 assertions green; store upload of 1.4.1 pending |
| 2026-09-30 | Package `1.4.0` — **Rabby Architecture & Asset Polish**: Centralized token architecture (`NATIVE_TOKEN`, `TokenAvatar`), brand logo on lock screen, desktop notifications for tx confirmation/failure (`chrome.notifications`), Rabby refresh icon with spinning sync indicator, 30s auto-refresh on History, lock wallet button & Ctrl+L shortcut | All 20 test suites green |
| 2026-09-29 | (unreleased, package still `1.4.0`) **Token drawer**: the balance box is now the token entry — click anywhere in it (or Enter/Space, or the Tokens strip) and the Rabby-style drawer slides up with the full token list, live search, and Add custom token; the inline dashboard ledger is gone | TOKEN2049 store copy: mention "tap your balance for the token list" alongside "Add custom tokens by contract address" |
| 2026-09-29 | (unreleased, package still `1.4.0`) **Tokens round**: Add custom token by contract (mint) address — the chain verifies the pasted address and supplies the real symbol/decimals before the token joins the ledger; `token.readMint` lookup (contract v14); deploys now mint their recorded initial supply (InitializeMint alone left supply at 0); `scripts/token-lab.mjs` end-to-end token lab (deploy → add → send → receive) | Include in the TOKEN2049 store copy: "Add custom tokens by contract address" |
| 2026-09-29 | Package `1.4.0` — **Betanet migration**: the wallet now targets `betanet` (`rpc.betanet.thru.org`), Thru's final testnet before mainnet (10 nodes, ~6s blocks — transfers settle in about one block; the single-node alphanet is gone). Explorer links use `?network=betanet`; auto-lock no longer counts background sync as activity; faucet claims no longer ask for the password; RESET must be typed in uppercase | Store copy refresh planned for the TOKEN2049 launch (~early October 2026); mention Betanet (final testnet before mainnet) then |
| 2026-09-28 | Package `1.3.1` — Auto-lock fixed (the worker restarted on every alarm tick and reset the idle clock, so it never fired at any setting); toolbar icon now shows a lock badge while the wallet is locked (like Rabby); create-wallet shows the phrase immediately (no reveal-password gate); Enter submits the import/create forms; explorer links use `/address/?network=`; duplicate-send errors name the exact collision | Fixes shipped as bug reports from manual testing; no description changes |
| 2026-09-27 | Package `1.3.0` — the `@thru/sdk` 0.4.0 release; Website field set to thruwallet.vercel.app; Telegram support group added (Settings → About); Localnet network removed from the shipped wallet (custom chains come later); `connect-src` tightened to the alphanet RPC only | Mirror the new Website/support fields into the dashboard; description bullets unchanged |
| 2026-09-26 | Initial capture of the live listing into this file | Mirrors the listing as submitted (package `1.2.0`); all §6 claims verified against code |
