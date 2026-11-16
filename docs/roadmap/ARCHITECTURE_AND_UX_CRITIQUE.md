# Architectural Critique, Non-Coder UX Strategy, and Critical Blind Spots

**Document Class:** Strategic Architecture & Product Critique (`PLANNED` — Advisory Blueprint, Not Shipped Runtime Behavior)
**Baseline Evaluated:** Contract **v32** (`153` methods, `15` routes, `9` review kinds, `@thru/sdk@0.4.2`, `@thru/programs@0.4.2`)

> [!IMPORTANT]
> **Governance Boundary (`AGENTS.md` Architecture Freeze):**
> `thru-wallet-ext` has an active architecture freeze on wallet core prior to shipping the verified Betanet release. Do **not** execute greenfield refactors during bug-fix or release-candidate work; adopt the patterns below incrementally at natural phase boundaries with explicit owner approval (`docs/DECISIONS.md`).

---

## 1. What Current Architecture Gets Right (Keep & Protect)

Before critiquing what would change in a greenfield build, five decisions in `thru-wallet-ext` are stronger than most production browser wallets and should be preserved:

1. **Zero-Framework, Minimal Supply Chain (`Rule 5`):** Only two runtime dependencies (`@thru/sdk@0.4.2`, `@thru/programs@0.4.2`, both Apache-2.0) plus `esbuild`. Browser wallets fail most often through transitive npm supply-chain compromises.
2. **Single UI/Backend Seam (`Rule 3`) & Zero HTML Sinks (`Rule 7`):** `bridge.send()` -> `api-router.js` with `0` `innerHTML` sinks across `128` runtime files eliminates entire classes of XSS and state-desync bugs.
3. **Centralized Review + Router Consent Token (`v29`–`v32`, `Rule 16` & `Rule 28`):** Requiring a single-use `consentToken` at `api-router.js` prevents feature routes from quietly signing unreviewed payloads.
4. **Strict `BigInt` Money & Network-Scoped Storage (`Rule 6`, `network-scope.js`):** Prevents float precision drift and testnet-to-mainnet cache contamination.
5. **Self-Testing Mechanical Guards (`Rule 22`):** Pairing rules in `AGENTS.md` with negative-controlled scripts (`scripts/check-*.mjs`) stops rule erosion across AI sessions.

---

## 2. Greenfield Architectural Improvements (What to Build Differently & How to Evolve)

If architecting this extension from scratch for multi-year Mainnet scale, custodian interoperability, and multi-agent development, five structural changes would eliminate the root causes behind `docs/DEFECT_LOG.md`:

### 2.1 Strict TypeScript (`strict: true`) + Schema-Derived Bridge Types (Zero Runtime Cost)
- **Current Weakness:** `128` untyped ES module `.js` files rely on prose `returns` descriptions in `manifest.js`. Multiple historical bugs (`String(meta.owner)` producing `"[object Object]"`, `record.binding.accountAddress` `TypeError`, `toast('string')` empty bar, missing parameter reads) were pure type mismatches invisible until runtime.
- **Greenfield Pattern:** Author `src/` in TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`, branded types `ThruAddress`, `BaseUnitString`, `NetworkId`). `esbuild` already strips TypeScript natively in milliseconds with **zero new runtime dependencies**, while `tsc --noEmit` becomes a deterministic compile-time gate that catches AI agent hallucinations before tests even run.
- **Incremental Path:** Add `tsconfig.json` (`allowJs: true`, `checkJs: true` on `src/shared/` and `src/lib/` first) without rewriting working modules or changing `build.mjs` output.

### 2.2 Pluggable `SignerBackend` Port & Stateless `ChainContext` (Decoupling `thru-client.js` from `vault.js`)
- **Current Weakness:** `src/lib/thru-client.js` (`1,435` lines) holds a mutable module-level `activeClient` singleton (requiring `signing-guard.js` global locks and contributing to the 5-service circular import cycle) and couples transaction construction directly to raw `Uint8Array` private keys (`buildAndSign`).
- **Greenfield Pattern:** Separate **Transaction Construction** from **Key Custody** behind a clean `SignerBackend` interface, leveraging `@thru/sdk@0.4.2`'s native BYO-signer primitives (`Transaction.toWireForSigning()`, `buildTransactionSigningMessage(body)`, and `attachTransactionSignature(msg, sig)`):
  ```ts
  // Immutable per-request chain binding — eliminates mutable global RPC races:
  interface ChainContext {
    readonly networkId: string;
    readonly chainId: number;
    readonly genesisFingerprint: string;
    readonly rpc: Thru;
  }

  // Pluggable custody backends sharing the exact same TxReviewCard & pending-tx pipeline:
  interface SignerBackend {
    readonly kind: 'vault-seed' | 'vault-imported' | 'watch-only' | 'external-airgap' | 'passkey-bridge' | 'hardware';
    readonly canSignTransactions: boolean;
    readonly canPayNativeFees: boolean; // false for Passkey PDAs & watch-only!
    signTxnMessage(msg: TransactionSigningMessage, opts: SignOptions): Promise<Uint8Array>; // 64B Ed25519 sig over 48B msg.m
  }
  ```
- **Why It Matters:** Adding **External/Offline Custodian Signing**, **Watch-Only Accounts**, **Hardware Wallets**, or **Passkey Bridge Mode** becomes a new `SignerBackend` adapter rather than rewriting Send, Domains, or DeFi.

### 2.3 Stable `accountId` (`UUID`) + Explicit `feePayer` Separation
- **Current Weakness:** `src/shared/refs.js` addresses accounts by `{ keyringId, accountIndex }`. That assumes every account lives inside a local vault keyring array and is its own fee payer.
- **Greenfield Pattern:** Address accounts by a stable internal `id` (`acct_<uuid>`) with explicit `{ address, publicKeyHex, type, derivationPath?, canSign, defaultFeePayerAccountId? }`. On Thru L1, Passkey accounts are PDAs that **cannot be account index `0` (`feePayer`)**; modeling `feePayer` separately from `authority` now avoids a breaking storage migration later.

### 2.4 MV3-Native Durable State Machine (Zero Worker-RAM Assumptions)
- **Current Weakness:** Chrome MV3 terminates service workers after ~30s of inactivity. Storing v32 `consentToken`s in an in-memory `Map` (`consent.js`) or scheduling reconciliation with `setTimeout(2s / 10s)` (`pending-tx-service.js`) means a worker sleep during an external/hardware/passkey ceremony drops in-memory state.
- **Greenfield Pattern:** Persist short-lived ceremony state in `chrome.storage.session` (encrypted with a per-unlock ephemeral key in `chrome.storage.session`, auto-wiped on browser close/lock), drive background reconciliation via `chrome.alarms` + `@thru/sdk` `StreamingClient` (`trackTransaction`) while any UI port is connected, and make every multi-step write idempotent via a durable write-ahead journal (mirroring `@thru/sdk`'s `CompressionJournal` pattern).

### 2.5 Isolated Worker / Sandboxed Page for Dynamic ABI Reflection
- **Current Weakness:** Core decoders (`src/shared/tx-review/decoders/*`) are pure JS and safe, but supporting arbitrary dApp contracts later via `@thru/sdk/abi` (`abi_reflect_wasm_bg.wasm`) requires WebAssembly + YAML parsing of third-party on-chain ABIs.
- **Greenfield Pattern:** Never load untrusted WASM/YAML parsers inside the privileged vault service worker. Run `@thru/sdk/abi` inside an isolated MV3 `sandbox` page or restricted Web Worker with zero `chrome.storage` access.

---

## 3. User Experience Abstractions for Non-Coders & Everyday Users

Non-EVM chains fail mainstream adoption when protocol internals leak onto user screens. Add two layers of abstraction:

### 3.1 Abstractions for Non-Technical Wallet End Users
1. **Invisible Account & Token-Account Lifecycle:**
   - Thru requires EOA activation (`NOOP` / `EOA_CREATE`) before receiving native `THRU`, and `105`-byte Token Account PDAs before receiving tokens.
   - *UX Abstraction:* Never show `"Account does not exist"` or `"Initialize PDA"` jargon. For own accounts, keep automatic background activation; when sending native `THRU` to an unactivated external friend, present a plain-English explanation (*"This address has not been activated by its owner yet"*) with a one-click **"Copy Activation Guide / Share Receive Request"** card, or use `@thru/sdk`'s `eoa.buildEOACreateMessage` (`82`-byte authorization) if delegated activation is supported.
2. **Human Time & Plain-Language Error Translation:**
   - Translate `SEND_EXPIRY_SLOTS = 1000` into *"Expires in ~100 minutes if unconfirmed"* (or ~90s for tight DeFi quotes) and map raw ThruVM `vmError` / `userErrorCode` integers into plain-language cause + next action (*"Faucet per-claim limit is 0.00001 THRU — reduce claim amount"*).
3. **Watch-Only Mode + Visual Address Safety Net:**
   - Let users add any `ta...` address or `.thru` name as **Watch-Only** (clearly badged `"View only — keys held externally"`) to monitor cold/custodian balances safely.
   - Pair every address with a deterministic color/identicon tag, *"First interaction with this address"* indicator, and `.thru` human-readable resolution with look-alike character warnings.
4. **Guided Security & Backup Health Center:**
   - Expand `security-sheet.js` into an actionable safety checklist: non-destructive **Practice Recovery Check** (verifying the user still has their 12 words without resetting the wallet), connected-sites manager (once dApp bridge ships), and plain-English explanations of `Session-only` vs `Password on every transaction`.

### 3.2 Abstractions for You (Non-Coder Product Owner Directing AI Agents)
1. **Unified Visual Storybook (`scripts/preview-all.html`):** Extend the existing `preview-tx-review.html` / `preview-toast.html` harnesses into a single clickable browser gallery showing all 15 routes across `loading`, `empty`, `ready`, `blocked`, and `offline` states at `400x600` and `300px` side-panel widths — letting you review UI visually without touching code or live keys.
2. **Plain-English Gate Summary Script (`npm run verify:summary`):** Output a 10-line traffic-light scorecard (`Build`, `Contract Parity`, `Signing Consent`, `Bundle Size`, `Zero Retired Refs`, `Manual Browser Status`, `Live Betanet Status`) after every agent run so you never have to parse 2,000 lines of terminal output.

---

## 4. Seven Critical Blind Spots in the Current Approach

These gaps are **not yet solved** by your current documentation or prompt setup and represent the highest real-world risks between today and Mainnet:

| # | Critical Gap | Why It Can Hurt You | Concrete Fix |
| --- | --- | --- | --- |
| **1** | **Multi-Agent Working-Tree Collisions** | Running multiple AI coding sessions against one shared working tree caused `manifest.js` (`v33`) and `50+` files to drift out of sync with docs mid-flight. | Isolate parallel agents into separate `git worktree` branches (`one agent = one branch/PR`), and enforce a Git `pre-commit` hook running `npm run build && npm run test:guards && node scripts/check-docs-truth.mjs`. |
| **2** | **`ThruTransactionIntent.review` Phishing Surface in `@thru/sdk`** | `@thru/sdk@0.4.2` defines `ThruTransactionIntent.review` (`appName`, `instruction`, `simulation: { before, after }`). A malicious dApp can populate `intent.review` with fake "+100 THRU reward" text while `instructionData` drains tokens. | **Hard Rule for dApp Bridge:** Treat `intent.review` as untrusted dApp hint metadata; **never** render dApp-supplied `simulation` or `instruction` claims as wallet truth — always decode raw `(programAddress, accounts, instructionData)` inside `review-service.js`. |
| **3** | **WASM CSP & Mutable On-Chain ABI Trap (`@thru/sdk/abi`)** | `@thru/sdk/abi` (`reflectInstruction`) loads `abi_reflect_wasm_bg.wasm` (blocked by `script-src 'self'` without `'wasm-unsafe-eval'`), and `@thru/programs/abi-manager` allows **`ABI_STATE_OPEN` (mutable)** and **`external` (third-party)** ABIs. An attacker can mutate an open ABI to disguise a drain instruction! | Keep hand-audited JS decoders for core programs; when adding ABI reflection later, run WASM in a sandboxed worker and trust **only** `ABI_META_KIND_OFFICIAL` + `ABI_STATE_FINALIZED` ABIs (flagging `OPEN` or `external` ABIs with a prominent warning). |
| **4** | **Passkey PDA Fee-Payer Deadlock** | Moving to a "100% keyless Passkey extension" ignores that Thru Passkey accounts are PDAs with **no Ed25519 private key** and **cannot pay transaction fees (`index 0`)** without a relayer or funded EOA fee-payer. | Keep hybrid `SignerBackend` support (local EOA fee-payer / vault + Passkey / External Signer), never delete `vault.js`, and require a verified fee-sponsorship or EOA gas-tank path before defaulting users to Passkeys. |
| **5** | **Deterministic Extension ID & Supply-Chain Hardening** | `src/manifest.json` has no pinned public `key` (meaning unpacked `chrome-extension://<id>` changes per machine, breaking WebAuthn RP IDs), `.npmrc` does not set `ignore-scripts=true`, and builds are not hash-verified in CI. | Add `.npmrc` (`ignore-scripts=true`, `save-exact=true`), pin public `key` for consistent dev/CI extension ID, and assert deterministic `sha256` bundle hashes in CI (`docs/roadmap/LIFECYCLE_SECURITY_AND_QA_PLAN.md`). |
| **6** | **Single-RPC Outage & Correlation Risk** | Hardcoding a single `https://rpc.betanet.thru.org` endpoint means one node hiccup stalls every balance, nonce, and review check. | Add ordered multi-endpoint fallback (`primary` + `secondary` Unto/first-party HTTPS RPCs per built-in network, verified in `check-csp.mjs`) with exponential backoff and health circuit-breaking. |
| **7** | **CWS Review Lag During an Active On-Chain Incident** | Chrome Web Store review takes 24–72 hours if a registrar or DeFi contract bug is discovered on Mainnet, while `FEED_POLICY` publisher keys in `feed-record.js` are currently unconfigured. | Before enabling DeFi or Mainnet custom contracts, pin an offline cold-held Ed25519 publisher key in `FEED_POLICY` so a signed **narrowing-only** `SignedFeedRecord` kill-switch can pause a vulnerable capability in minutes without a store update. |
