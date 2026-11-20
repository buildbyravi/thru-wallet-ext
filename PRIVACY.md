# Privacy Policy — Thru Wallet Extension

**Last Updated:** November 2026
**Repository:** [github.com/buildbyravi/thru-wallet-ext](https://github.com/buildbyravi/thru-wallet-ext)

This policy describes data stored by the extension and requests sent to the Thru Betanet RPC.

---

## 1. What Data Stays On Your Device

All sensitive cryptographic material and application settings remain exclusively on your local device within the extension's isolated browser storage:

*   **Encrypted Seed Phrase & Private Keys:** Your BIP-39 12- or 24-word recovery phrase, derived Ed25519 seed keys, and any individually imported private keys.
*   **Public Keys & Account Metadata:** Derived public keys, account labels, and account indices.
*   **Extension Preferences:** Local settings, UI state, and auto-lock preferences.
*   **Key Derivation Parameters:** Cryptographic salt and PBKDF2 iteration counters required for vault decryption.

---

## 2. What Data Leaves Your Device

The extension only communicates with the specified Thru betanet RPC endpoint to perform essential blockchain operations. The following data is transmitted:

*   **Public Addresses:** Your account public address (and queried token or `.thru`/`.id` domain addresses) is sent to the RPC node to query account state, balances, domain ownership, and transaction nonces.
*   **Signed Transactions:** Fully pre-signed transaction payloads (such as native/token transfers, `.thru` domain operations, account activations, or faucet claims) are broadcast to the RPC node for network inclusion.

### Official RPC Endpoint
All RPC communication is conducted directly with:
```text
https://rpc.betanet.thru.org
```

> [!NOTE]
> Network requests are sent directly from your browser to the RPC node. The extension developer does not operate any intermediate proxy, relay, or backend server.

---

## 3. What Data Is NEVER Collected

Thru Wallet does not:

*   Collect analytics, click tracking, performance metrics, or error reports.
*   Track IP addresses, user identity, advertising IDs, or behavior.
*   Load third-party scripts or tracking libraries.
*   Load remote code. JavaScript is bundled into the extension package; no remote scripts, code injection, or `eval()` calls are used.
*   Transmit your master password, recovery phrase, or private keys. They remain in local memory.

---

## 4. Encryption & Memory Lifecycle

To ensure your cryptographic keys remain safe while on your device, Thru Wallet employs modern web cryptography primitives (`crypto.subtle`):

*   **Key Derivation Function (KDF):** PBKDF2 using HMAC-SHA-256 with **600,000 iterations** and a cryptographically secure random salt.
*   **Symmetric Encryption:** AES-256-GCM (Galois/Counter Mode) authenticated encryption with a fresh 12-byte Initialization Vector (IV) generated for every encryption operation.
*   **At-Rest Storage:** Encrypted vault ciphertexts are stored in local extension storage (`chrome.storage.local`).
*   **In-Memory Lifecycle:** Unlocked session keys reside exclusively in memory-only session storage (`chrome.storage.session`). Memory contents are automatically cleared and unrecoverable upon browser shutdown, extension reload, or when the inactivity auto-lock timer fires (15 minutes by default, configurable in Settings).

---

## 5. Third-Party Web Requests

When interacting with external links inside the UI (such as transaction hashes or address links), the extension opens official explorer links (`scan.thru.org`) in a new browser tab. These external websites are governed by their respective privacy policies.

---

## 6. Contact & Audits

Thru Wallet is open-source software provided "as-is". For bug reports, privacy concerns, or security disclosures, please visit the [GitHub Issues](https://github.com/buildbyravi/thru-wallet-ext/issues) repository.
