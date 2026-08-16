# Security Policy & Architecture — Thru Wallet Extension

**Repository:** [github.com/buildbyravi/thru-wallet-ext](https://github.com/buildbyravi/thru-wallet-ext)  
**Manifest Version:** Manifest V3  

Thru Wallet is an experimental, open-source, self-custody browser extension designed for Thru's alphanet (a non-EVM RISC-V Layer-1 blockchain built by Unto Labs). Security and transparency are paramount to establishing user trust.

---

## 1. Threat Model & Scope Notice

> [!CAUTION]
> **ALPHANET SOFTWARE**  
> Thru Wallet is designed strictly for testnet/alphanet evaluation, development, and experimentation. **Do not use this wallet with mainnet assets or any keys holding real financial value.**

### Threat Assumptions & Boundaries
*   **Target Network:** Thru Alphanet (`rpc.alphanet.thru.org`).
*   **Host Environment:** Chrome / Chromium extension runtime executing under Manifest V3 security boundaries.
*   **Out-of-Scope Risks:** Compromised local host machines (e.g., OS keyloggers, malware with access to browser process memory), physical access to unlocked hardware, or vulnerabilities within the underlying WebCrypto implementation.

---

## 2. Key Storage & Encryption Architecture

Key security is implemented using native browser WebCrypto primitives (`crypto.subtle`), avoiding third-party JavaScript crypto dependencies for core vault operations.

```
       [ Master Password ]
                │
                ▼
  PBKDF2-HMAC-SHA256 (600,000 Iterations + Random Salt)
                │
                ▼
       [ Derived Encryption Key ]
                │
     ┌──────────┴──────────┐
     ▼                     ▼
 AES-256-GCM        AES-256-GCM
 (Encrypted Vault)  (Session Keys)
     │                     │
     ▼                     ▼
chrome.storage.local  chrome.storage.session
(At-rest ciphertext)  (In-memory transient state)
```

### Encryption Specifications
*   **Key Derivation Function:** PBKDF2 with HMAC-SHA-256 and **600,000 iterations**. A unique 16-byte salt is generated via `crypto.getRandomValues()` during wallet setup.
*   **Authenticated Encryption:** AES-256-GCM (Galois/Counter Mode) provides both confidentiality and integrity verification.
*   **Initialization Vector (IV):** A fresh 12-byte IV is generated via `crypto.getRandomValues()` for **every** encryption write operation to prevent IV reuse attacks.
*   **Session-Only Decryption:** Unlocked vault state and private keys reside strictly within `chrome.storage.session` (an in-memory storage area isolated to the browser process lifetime). Decrypted keys are never written to disk or `chrome.storage.local`.

---

## 3. Inactivity Auto-Lock Lifecycle

To prevent unauthorized access when a device is left unattended:

*   **15-Minute Timeout:** An auto-lock timer managed via `chrome.alarms` automatically fires after 15 minutes of inactivity.
*   **Memory Wipe:** Upon lock, `chrome.storage.session` is completely cleared, instantly purging all decrypted seed phrases, derived keys, and private key representations from runtime memory.
*   **Browser Termination:** Closing the browser window or terminating the extension background worker immediately destroys the session memory.

---

## 4. Minimal Extension Permissions

Thru Wallet adheres strictly to the **Principle of Least Privilege**. The extension requests only two Manifest V3 permissions:

```json
"permissions": [
  "storage",
  "alarms"
]
```

### Permission Audit
| Permission | Justification |
| :--- | :--- |
| `storage` | Required for persisting encrypted vault payloads (`local`) and holding transient unlocked state (`session`). |
| `alarms` | Required to manage the 15-minute inactivity auto-lock timer in background service workers. |

### Explicitly Excluded Permissions
*   `tabs` / `activeTab`: **Not requested.** The extension cannot inspect browser tabs or web page contents.
*   `webRequest` / `declarativeNetRequest`: **Not requested.** The extension cannot observe or mutate browser network traffic.
*   `<all_urls>` / Host Permissions: **Not requested.** The extension cannot interact with random external websites.

---

## 5. Content Security Policy (CSP)

Thru Wallet enforces a strict Manifest V3 Content Security Policy:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```

*   **No Inline Scripts:** Inline JavaScript execution (`<script>...</script>` or event handlers like `onclick=""`) is completely disabled.
*   **No Remote Scripts:** No external JavaScript files, CDNs, or remote resources can be loaded or executed.
*   **No Dynamic Execution:** Functions like `eval()`, `new Function()`, or dynamic script insertion are strictly forbidden.

---

## 6. What Thru Wallet Does NOT Do

To maintain a clean security footprint and prevent attack vectors common to web3 browser extensions:

*   **No Injected Providers:** Thru Wallet does **not** inject any `window.thru` or `window.ethereum` scripts into web pages.
*   **No Web Page Interaction:** The extension does **not** inspect, read, or modify DOM contents of visited websites.
*   **No Network Interception:** The extension cannot intercept or modify third-party network traffic.
*   **No DApp Connection Layer:** There is no standard yet for third-party extensions to interface with Thru dApps; therefore, no dApp provider or RPC bridge is injected into websites.
*   **No Key Transmission:** Private keys and seed phrases are never transmitted across the network under any circumstance.

---

## 7. Responsible Vulnerability Disclosure

If you discover a potential security flaw, vulnerability, or unexpected behavior in Thru Wallet, please disclose it responsibly:

*   **Reporting Channel:** File a report on [GitHub Issues](https://github.com/buildbyravi/thru-wallet-ext/issues).
*   **Details to Include:** Describe the problem, steps to reproduce, impact assessment, and any relevant environmental details (browser version, OS).
*   **Remediation:** Issues involving cryptographic safety or key storage will be investigated and addressed with high priority.
