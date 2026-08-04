# Privacy Policy — Thru Wallet Extension

**Last Updated:** August 2026  
**Repository:** [github.com/buildbyravi/thru-wallet-ext](https://github.com/buildbyravi/thru-wallet-ext)

Thru Wallet is an unofficial, community-built, self-custody Chrome extension for Thru's alphanet (a non-EVM RISC-V Layer-1 blockchain by Unto Labs). It is designed from the ground up to respect user privacy and operate under strict zero-telemetry principles.

---

## 1. What Data Stays On Your Device

All sensitive cryptographic material and application settings remain exclusively on your local device within the extension's isolated browser storage:

*   **Encrypted Seed Phrase & Private Keys:** Your BIP-39 12-word recovery phrase, derived Ed25519 seed keys, and any individually imported private keys.
*   **Public Keys & Account Metadata:** Derived public keys, account labels, and account indices.
*   **Extension Preferences:** Local settings, UI state, and auto-lock preferences.
*   **Key Derivation Parameters:** Cryptographic salt and PBKDF2 iteration counters required for vault decryption.

---

## 2. What Data Leaves Your Device

The extension only communicates with the specified Thru alphanet RPC endpoint to perform essential blockchain operations. The following data is transmitted:

*   **Public Addresses:** Your account public address is sent to the RPC node via HTTP JSON-RPC to query account state, balance, and transaction nonces.
*   **Signed Transactions:** Fully pre-signed transaction payloads (such as native transfers or faucet claims) are broadcast to the RPC node for network inclusion.

### Official RPC Endpoint
All RPC communication is conducted directly with:
```text
https://rpc.alphanet.thru.org
```

> [!NOTE]
> Network requests are sent directly from your browser to the RPC node. The extension developer does not operate any intermediate proxy, relay, or backend server.

---

## 3. What Data Is NEVER Collected

Thru Wallet adheres to a strict zero-collection policy. The extension does **NOT**:

*   **No Analytics or Telemetry:** No usage statistics, click tracking, performance metrics, or error reports are collected.
*   **No User Tracking:** No IP tracking, user identification, advertising IDs, or behavioral profiling.
*   **No Third-Party Scripts:** No Google Analytics, Mixpanel, Segment, Sentry, or external tracking libraries.
*   **No Remote Code:** All JavaScript is bundled locally into the extension package. No remote scripts (`<script src="...">`), external code injection, or `eval()` calls are used.
*   **No Key Transmission:** Your master password, recovery phrase, and private keys NEVER leave your browser's local memory and are never transmitted over the network.

---

## 4. Encryption & Memory Lifecycle

To ensure your cryptographic keys remain safe while on your device, Thru Wallet employs modern web cryptography primitives (`crypto.subtle`):

*   **Key Derivation Function (KDF):** PBKDF2 using HMAC-SHA-256 with **600,000 iterations** and a cryptographically secure random salt.
*   **Symmetric Encryption:** AES-256-GCM (Galois/Counter Mode) authenticated encryption with a fresh 12-byte Initialization Vector (IV) generated for every encryption operation.
*   **At-Rest Storage:** Encrypted vault ciphertexts are stored in local extension storage (`chrome.storage.local`).
*   **In-Memory Lifecycle:** Unlocked session keys reside exclusively in memory-only session storage (`chrome.storage.session`). Memory contents are automatically cleared and unrecoverable upon browser shutdown, extension reload, or when the 15-minute inactivity auto-lock timer fires.

---

## 5. Third-Party Web Requests

When interacting with external links inside the UI (such as transaction hashes or address links), the extension opens official explorer links (`scan.thru.org`) in a new browser tab. These external websites are governed by their respective privacy policies.

---

## 6. Contact & Audits

Thru Wallet is open-source software provided "as-is". For bug reports, privacy concerns, or security disclosures, please visit the [GitHub Issues](https://github.com/buildbyravi/thru-wallet-ext/issues) repository.
