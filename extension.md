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
| Privacy policy URL (as submitted) | <https://github.com/buildbyravi/thru-wallet-ext/blob/main/PRIVACY.md> |
| Package version at last sync | `1.2.0` (`src/manifest.json`) |
| Last synced with the live listing | 2026-09-26 |

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
Thru Wallet is an experimental, open-source self-custody wallet for Thru's alphanet blockchain.

Key Features:

- Self-Custody Account Management: Generate recovery phrases or import existing accounts and private keys.

- On-Chain Transfers: Send THRU testnet tokens with transaction review and address validation.

- Receive & Scan: View your address and QR code to receive testnet funds.

- Testnet Faucet: Claim testnet THRU directly from the extension to test transactions.

- Local Encryption: Keys are encrypted at rest using PBKDF2 (600k iterations) + AES-256-GCM.

- Auto-Lock Protection: Inactivity lock automatically clears decrypted keys from memory after 15 minutes.

- Zero Telemetry: No analytics, tracking, third-party scripts, or remote code execution.

Notice: This is community-built, open-source software for the Thru Alphanet testnet. It is not affiliated with or endorsed by Unto Labs and has not been audited. Do not use with real financial value.
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
A dedicated cryptocurrency key and transaction manager for the Thru Alphanet testnet, enabling users to store encrypted keys, review transaction details, and perform transfers on the Thru blockchain.
```

## 3. Permission justifications

The manifest requests exactly four permissions (`src/manifest.json`: `storage`, `alarms`,
`sidePanel`, `clipboardRead`) — one justification each, matching what the dashboard holds.

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

## 6. Copy accuracy notes (verified against the code 2026-09-26)

Documentation summarizes the code; it does not override it. When refreshing the listing,
re-check these claims against `src/` and fix the copy if the code moved.

| Listing claim | Code | Status |
| --- | --- | --- |
| PBKDF2 (600k iterations) | `src/lib/vault.js` — `PBKDF2_ITERATIONS = 600_000`, PBKDF2-SHA-256 | ✅ exact |
| AES-256-GCM at rest | `src/lib/vault.js` — 256-bit non-extractable AES-GCM key | ✅ exact |
| Auto-lock after 15 minutes | `src/shared/autolock.js` — `DEFAULT_AUTOLOCK_MINUTES = 15` | ✅ default is 15 min; user-configurable 0–240 min. The listing says "after 15 minutes" — consider "by default after 15 minutes" at the next copy refresh |
| Four permissions, one purpose each | `src/manifest.json` — exactly `storage`, `alarms`, `sidePanel`, `clipboardRead` | ✅ exact |
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
| 2026-09-26 | Initial capture of the live listing into this file | Mirrors the listing as submitted (package `1.2.0`); all §6 claims verified against code |
