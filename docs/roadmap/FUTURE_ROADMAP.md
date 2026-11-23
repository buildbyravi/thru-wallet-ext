# Future Roadmap and Phased Development Plan

**Document Class:** Roadmap (`PLANNED` — **NONE OF THE FEATURES IN THIS FILE ARE SHIPPED IN THE UI OR ENABLED IN RUNTIME**)
**Baseline:** Synchronized against Contract **v33** (`154` methods, `15` routes, `9` review kinds, all `FLAGS.* === false`)
**Companion Strategy Docs:** `docs/roadmap/ARCHITECTURE_AND_UX_CRITIQUE.md` · `docs/roadmap/LIFECYCLE_SECURITY_AND_QA_PLAN.md`

> [!IMPORTANT]
> **AI AGENT GUARDRAIL — DO NOT HALLUCINATE AS IMPLEMENTED:**
> Everything in this document is **`PLANNED`**, **`BLOCKED`**, or **retained UX/protocol specification** for upcoming phases.
> - Do **not** describe any feature below as current wallet behavior.
> - Do **not** enable any flag in `src/shared/flags.js` or touch `test/test-launchpad-quarantine.mjs` / `test/test-release-flags.mjs` without an explicit owner directive and a same-commit `docs/DECISIONS.md` entry (`Rule 23`, `Rule 25`).
> - Every future value-moving operation — including external signing, dApp requests, Passkey bridges, and DeFi — **must** integrate into the shipped v29/v32 review & background-consent pipeline (`tx.prepareReview` -> `TxReviewCard` -> `tx.confirmReview` one-time `consentToken` -> `confirm.js`, `Rule 16` & `Rule 28`).

## Cross-Screen UX & Error-Feedback Follow-Ups (`PLANNED`)

These are quality improvements to existing screens, not new wallet capabilities. Review and ship them in small, independently verifiable slices; do not loosen the architecture, security boundaries, or capability descriptions to achieve visual similarity with another wallet.

- **Error feedback, informed by Rabby and accessible component patterns:** Align field validation, persistent screen-state banners, and transient event toasts. Prefer a concise explanation plus a safe next step. Offer Retry only when the wallet can prove the operation was not submitted; for uncertain submission outcomes, tell the user to check Activity and do not invite a duplicate send. Keep secret-bearing values out of telemetry. Reuse Thru's safe DOM kit, shared banner/toast, and theme tokens; do not copy Rabby source or add React, Tailwind, Radix, Sonner, CDN assets, or other runtime dependencies.
- **Consistent domain action names:** The tracked-domain list currently says `Make primary` / `Unlink`, while the detail view says `Set as primary` / `Primary`. Pick one label per action and align list, detail, and confirmation copy without changing the underlying operations.
- **Dashboard affordance honesty:** Review the `Swap` tile, which currently responds that Swap is planned but has no shipped swap UI. Remove or replace the affordance unless and until the supported capability and owner-approved copy are clear. Do not add sample swap quotes, balances, or other simulated results.
- **Accounts layout:** The current open UI PR tightens account-list spacing and strengthens row hierarchy. Treat its layout as `UNVERIFIED` until inspected in real Chrome at popup and side-panel sizes, in light and dark themes. Revisit the pinned `Add account` action if it leaves unnecessary blank space on short lists.
- **Welcome, Unlock, Settings — medium-priority visual review:** These flows already have substantial deterministic lifecycle coverage. This branch adds scoped presentation refinements: larger Welcome option cards and icons, a stronger but compact Unlock brand/form group, and tighter Settings group rhythm with 52px settings rows. Welcome sends a newly created phrase directly into the required backup flow; on import failure it clears the phrase field, and on success it clears the phrase and password fields. Unlock handles return-to routes, password clearing, and lockout backoff; Settings covers theme, auto-lock, signing-password, network, and explicit Side Panel Mode controls. Remaining: inspect hierarchy, inline errors, keyboard focus, and compact-height scrolling in real Chrome. Preserve mandatory phrase backup, lockout timing, secret clearing, password gates, network restrictions, and existing setting semantics. Do not infer live-Chrome verification from DOM-shim tests.
- **Responsive and accessible acceptance:** Capture the actual extension in real Chrome at popup (`400×600`), narrow side panel (`320×445`), and a wider panel; check both themes, keyboard/focus order, status announcements, reduced motion, and forced-colors. Use fixture data only for layout, label it as synthetic, and never present fixture values as live wallet evidence. Add route-specific browser assertions before calling a redesign `VERIFIED`.

**Current status:** this backlog is `PLANNED`; the Welcome/Unlock/Settings interactions are `TESTED` by deterministic route-lifecycle checks, but a complete real-Chrome visual pass across those routes is `UNVERIFIED`. The relevant feature and security gates remain authoritative in `docs/STATUS_AND_ROADMAP.md`, `docs/MANUAL_SMOKE_CHECKLIST.md`, and `AGENTS.md`.

---

## 1. Strategic Sequencing (Grok Synthesis + Codebase Reality)

Integrating ecosystem utility analysis with the shipped Contract **v32** wallet establishes a strict **seven-phase build order** (never build downstream DeFi/Launchpad apps before foundational signing, account, and dApp-bridge layers are solid):

| Phase | Milestone | Strategic Rationale | Status |
| --- | --- | --- | --- |
| **Phase 0** | **Stabilize & Ship Wallet Core + `.thru` Domains (`v1.4.2`)** | Close Betanet registrar `.bin`/treasury-delta proof, `name.setRecord` probe, and real-Chrome QA (`docs/STATUS_AND_ROADMAP.md` §3). | **ACTIVE GATE** |
| **Phase 1** | **Account Model v2 (Watch-Only, Fee-Payer Selector, Public-Key Export) + External / Air-Gapped Signing** | Turns Thru Wallet into the ecosystem's reference SDK implementation for power users, validators, hardware, and institutional/MPC signers (`@thru/sdk` `TransactionSigningMessage`) **without** touching dApp injection yet. | `PLANNED` (§2) |
| **Phase 2** | **dApp Connection v1 (`ThruTransactionIntent` Provider) + Safe ABI Reflection** | Highest ecosystem unlock: enables any Thru web app (DEXes, games, `.thru` profile site) to connect and request wallet-decoded signatures. | `PLANNED` (§3) |
| **Phase 3** | **`SignerBackend` Abstraction & Optional Passkey Wallet Bridge** | Adds `PasskeyBridgeSigner` alongside local `VaultSigner` (`hybrid`, never deleting seed self-custody) once PDA fee-paying and live Betanet Passkey probes pass. | `PLANNED` (§4) |
| **Phase 4** | **Built-In Swap (`FLAGS.DEFI_DEX`)** | Highest daily in-wallet financial utility; backend AMM pool + exact-in swap already proven on Betanet (`2026-10-25-live-swap-probe.json`). | `PLANNED` (§5) |
| **Phase 5** | **`.thru` Public Identity & Profile Website (`thru-profile-web` / `thru-wallet-web`)** | Rich profile editing on the web; extension stays fast with a future "Expand" button to desktop tab; open contracts (Option A) power third-party profile builders and monetize via registrar fees. | `PLANNED` (§6) |
| **Phase 6** | **AMM Liquidity Pools (`R2` Exit-First) -> Token Launchpad (`desktop.html`) -> Local MCP Companion** | Heavy multi-tx surfaces deferred until Thru has active liquidity, verified `withdrawLiquidity`, and public indexer coverage. | `PLANNED` (§5, §7) |

---

## 2. Phase 1: Reference Multi-Account v2 & External / Offline Signing (`PLANNED`)

Positions `thru-wallet-ext` as a clean reference implementation for developers, validators, and institutional HSM/MPC workflows while keeping keys strictly self-custodial (never turning the extension into a custodial service):

### 2.1 External / Air-Gapped Signing Flow (`@thru/sdk` BYO-Signer Surface)
Use `@thru/sdk@0.4.2`'s native `TransactionSigningMessage` (`sdk.d.ts:178-215`) — **never** hand-roll serialization or rebuild the transaction after signing:
1. **Build & Review:** Prepare transaction via `tx.prepareReview` -> render `TxReviewCard` showing exact program, accounts, `startSlot` + `expiryAfter` countdown, and `feePayer`.
2. **Export Exact Signing Payload:** Extract `body = unsignedTx.toWireForSigning()` and `msg = buildTransactionSigningMessage(body)` (which locks `expectedPublicKey` from body offset `48` and computes the exact **48-byte** `msg.m = DST_TXN (16B) || SHA-256(body) (32B)` payload). Offer export as:
   - Hex / Base64 of `msg.m` (for stock RFC-8032 Ed25519 HSM/MPC/TSM signers) + SHA-256 body digest display
   - `.thru-tx.json` file download (carrying `bodyBase64`, `signingMessageHex`, `networkId`, `chainId`, `validUntilSlot`)
   - Animated/static QR code for air-gapped signers
3. **Import & Verify Signature Locally:** Accept `64`-byte signature paste/upload -> call `signedWire = await attachTransactionSignature(msg, sigBytes)` (verifies strict canonical cofactorless Ed25519 against the frozen `#body` snapshot locally, rejecting wrong-key or mutated payloads before touching RPC) -> broadcast via `sendAndTrack` and track in `pending-tx-service.js`.

### 2.2 Watch-Only Accounts, Metadata & Explicit `feePayer` Selection
Extend the existing V2 multi-keyring model (`vault.js` already ships multiple seed keyrings, imported keys, labels, and pin/hide):
- **Watch-Only Accounts (`type: 'watch-only'`):** Import any `ta...` address or `32`-byte hex public key without a password/vault secret; badge clearly (`"Watch-only — cannot sign locally"`, routing `Send`/`Sign` directly to the External/Offline Sign export flow).
- **Rich Account Inspector:** Display `ta...` address alongside raw `32`-byte hex `publicKey`, keyring source (`Seed #1 · m/44'/...`, `Imported`, `Watch-Only`, `Passkey`), color tag, and `Export Public Key` (no password required) vs password-gated secret export.
- **Default `feePayer` Account Selector:** Allow power users (and future Passkey PDA accounts) to designate which funded EOA pays transaction header fees (`index 0`).

### 2.3 Core Wallet UX Polish Candidates
- Popup latency budgets (`< 100 ms` shell, `< 250 ms` cached dashboard, DOM virtualization `> 100` rows), ephemeral non-secret `pageState` form-draft survival in `chrome.storage.session`, calmer sentence-case sub-screen labels, local per-tx personal notes, Dashboard balance privacy mask (`R7`), and recent-recipient quick chips on `/send` (`R9`).

---

## 3. Phase 2: dApp Connection v1 & Verified ABI Reflection (`PLANNED`)

Before enabling any provider, external listener, or manifest permission, require an owner-approved
threat model. Compare an official Thru provider (if verified), an exact-origin allowlist for first-party
sites, and connectionless unsigned-intent handoff without new host permissions. Test spoofing, replay,
locked state, and context switches against the invariants below before any enablement. This is a
planning gate, not a shipped capability.

### 3.1 Minimum `dApp Connection v1` Surface (`ThruTransactionIntent`-Aligned)
Check Unto Labs' published `@thru/wallet` specs first to align global namespace (`window.thru` / `window.thruWallet`) before shipping `content_scripts`. Minimum v1 scope:
- **Methods:** `connect({ silent? }) -> { accounts: [{ address, publicKey, label? }] }`, `disconnect()`, `isConnected()`, `getAccounts()`, `getSelectedAccount()`, `getSigningContext() -> { networkId, chainId }`, and `signTransaction(payload: string | ThruTransactionIntent) -> Promise<string>` (returning base64 signed wire bytes or routing through sign-and-send where requested).
- **Events:** `connect`, `disconnect`, `accountChanged`, `accountsChanged`, `networkChanged` *(do **not** skip network awareness in v1 — binding `networkId`/`chainId` prevents Betanet/Mainnet cross-network signing mistakes)*.
- **Mandatory Security Invariants:**
  1. Reject non-HTTPS origins (except explicit `http://localhost` / `http://127.0.0.1` dev origins); bind permissions to Chrome-verified `sender.origin`, approved account(s), and network; show connected-sites list with one-click `Disconnect` in popup header and `/settings`.
  2. **Ignore Untrusted `ThruTransactionIntent.review` Hints for Security Facts:** `@thru/sdk` allows dApps to attach `intent.review` (`appName`, `instruction`, `simulation`). Never trust dApp-supplied simulation or instruction labels — always decode `(programAddress, accounts, instructionData)` inside wallet-owned `tx.prepareReview` -> `TxReviewCard` (prominently displaying verified `sender.origin`) -> `tx.confirmReview` (`consentToken`).

### 3.2 Three-Level Human-Readable Transaction Decoding Roadmap
1. **Level 1 & 2 (Core Programs — ALREADY SHIPPED in `v29–v32`):** Deterministic pure-JS decoders (`src/shared/tx-review/decoders/*`) for `9` kinds (`native-send`, `token-transfer`, `domain-register/purchase/renew/claim/record`, `faucet-claim`, and fail-closed `raw`), plus unverified-program and risk warnings.
2. **Level 2.5 (Sandboxed On-Chain ABI Reflection — `PLANNED` for dApp Connection v1.1):** Run `@thru/sdk/abi` (`reflectInstruction` + `abi_reflect_wasm_bg.wasm`) inside an isolated sandboxed worker (preserving strict service-worker CSP). Query `@thru/programs/abi-manager` (`deriveOfficialABIAddresses`) and **only** treat `ABI_META_KIND_OFFICIAL` + `ABI_STATE_FINALIZED` ABIs as verified program schemas; flag `ABI_STATE_OPEN` (mutable) or `external` ABIs as unverified publisher metadata, and always fall back cleanly to raw account/hex inspection.
3. **Level 3 (Dry-Run Balance Diffs — `BLOCKED` on Thru RPC):** Enable pre/post balance diffs only if Thru nodes add a verified `simulateTransaction` RPC (`tx.simulate` stays honestly `Unavailable` until then).

---

## 4. Phase 3: `SignerBackend` & Optional Passkey Wallet Bridge (`PLANNED`)

 Evaluates the **dApp -> Extension Bridge -> Passkey Wallet** model (`@thru/programs/passkey-manager`) without discarding local encrypted-vault self-custody:

1. **Hybrid `SignerBackend` Strategy (Keep `VaultSigner` + Add `PasskeyBridgeSigner`):** Retain `SeedSignerBackend` (`vault.js`) for EOA self-custody, fee-paying, and offline signing, while adding `PasskeyBridgeBackend` (caching only public `{ address, publicKey, label, source: 'passkey' }`) for users who prefer keyless passkey custody.
2. **MV3 Ceremony Surface Rule (No Hidden Iframes):** MV3 service workers have no DOM, `wallet.tid.sh` sends `X-Frame-Options: DENY`, `manifest.json` enforces `frame-src 'none'`, and toolbar popups auto-close on OS WebAuthn prompts. All Passkey bridge or WebAuthn `thru.passkey.validate` (`normalizeP256Signature` low-S) ceremonies **must** run in the **Side Panel or a dedicated Extension Popup Window / Tab**, always showing the extension's own origin + decoded `TxReviewCard` summary first.
3. **Three Gating Live Probes (`scripts/verify-passkey.mjs`):** (1) Confirm live Betanet `AuthorityRecord` layout, (2) verify distinct-account EOA/relayer `feePayer` (`index 0`) sponsorship mechanics, and (3) verify on-chain `VALIDATE` acceptance of `chrome-extension://<pinned-id>` `clientDataJSON.origin` vs `rpIdHash`.

---

## 5. Phases 4 & 6: Swap First, Then Pools/LP & Launchpad (`PLANNED` — Flags Off)

Backend M0/G1/G2-S0/G3 code sits dark-launched behind `FLAGS.DEFI === false` (`docs/defi/README.md`). Sequence strictly **Swap (`Phase 4`) -> AMM Pools/LP (`Phase 6A`, gated on live `withdrawLiquidity`) -> Launchpad (`Phase 6B`)**:

- **Surface Split:** `400x600` Popup handles verified-asset swaps and **selling/exiting any held token or LP ("exit before entry" R2)**; single-instance `desktop.html` (excluded from `web_accessible_resources`, `tx.validateAddress` URL allowlist, `<= 300 KB` gzipped) handles discovery, unverified buys, LP creation, Launchpad (`Quick` vs `Advanced` templates), and zero-dependency `THRU`-denominated SVG/Canvas charts (Line when sparse, Candlestick when dense, with chart-vs-quote divergence guard).
- **Mandatory v32 Consent + Step-Up Auth (`D5`):** Converge `intent.submit` onto `TxReviewCard` + `tx.confirmReview` (`consentToken`), enforce `600 ms` Confirm arming delay, severity tiers (`block` / `high` typed ticker+mint / `warn`), directional rounding (floor `minOut`, ceil cost), `minOut > 0n`, pool-squatting guards (`FIRST_DEPOSITOR`, `DESTINATION_POOL_PRE_EXISTING`), live-chain Launchpad step recovery, and `scripts/preview-defi.html` state gallery.

---

## 6. Phase 5: `.thru` Public Identity & Profile Website (`PLANNED`)

### 6.1 Editing Workflow Strategy & Surface Separation
Rich content and profile editing will primarily be hosted on the website (`thru-profile-web` / `thru-wallet-web`) rather than crammed into the browser extension, preventing extension bloat and UX clutter:
- **Lightweight Extension Core:** The extension popup remains strictly focused on high-speed essential flows: searching availability, minting/registering, renewing leases, and setting primary name aliases.
- **Future "Expand" Milestone:** Add an "Expand" action button within the extension's domain view that opens a full desktop tab (`desktop.html` or web app studio) for seamless, full-screen profile and text-record editing.
- **Secondary In-Wallet Phase:** A subsequent phase may integrate limited, high-frequency inline record editing directly into the extension once the standalone web platform is established.

### 6.2 Feature Differentiation (Option B vs. Option A Hybrid)
- **Option B (Extension Focus):** The extension UI is optimized for high-speed, low-complexity actions (minting, renewing, primary alias) without heavy form suites, preserving popup performance and responsiveness.
- **Option A (Web & Profile Builder Focus):** At the smart contract and protocol level (`name.setRecord`, opcode 2), the capability remains open. The web platform, community developers, and third-party teams can leverage our smart contracts to construct external profile builders and directory tools.

### 6.3 Monetization & Ecosystem Revenue Model
Under Option A, third-party profile builders and decentralized social applications integrate directly with our registrar smart contracts. When new users onboarding through these partner platforms register their `.thru` domains to complete their profiles, all registration transactions are processed through our custom registrar smart contracts, generating on-chain registration fees and steady treasury revenue.

### 6.4 Technical Safety & On-Chain Schemas
- **P0 Betanet Probe First:** Measure `APPEND_RECORD` (opcode 2) state units, record ceiling, `NS_OP_DELETE_RECORD = 3` support, and lease-expiry behavior.
- **Schema & Conflict Safety:** Keys `<= 32B`, values `<= 256B` (`addr`, `display`, `bio`, `url`, `avatar` rendered as identicon in extension, `x`/`github`/`telegram`, `profile` JSON hash; no email/phone on-chain). Enforce **conflict-means-invalid** on multiple `addr` records and strict 4-tier verification copy (never showing verified checkmarks on unverified social handles).

---

## 7. Long-Horizon Capabilities & Legacy Disposition Matrix

- **Out-of-Worker Local MCP Companion (`PLANNED`):** Optional local Node process (`tools/mcp-server/`) with 3-tier permissions (scoped reads -> unsigned `TxReviewCard` preparation -> hard-forbidden secrets/direct signing).
- **Custom RPC Activation (`BLOCKED` on 4 Preconditions):** HTTPS-only + narrow runtime `host_permissions` + chain-verified program map + password re-auth (`D-004`).
- **Hardware Wallets & Native Staking (`PLANNED`):** Plug into Phase 1/3 `SignerBackend` (`WebHID`/`WebUSB` in side panel/tab) and future Thru L1 validator staking programs.

| Former File(s) (2026-11-15 SSoT Overhaul) | Disposition | Current Owner |
| --- | --- | --- |
| `mcp.txt` | **Discarded** | Unrelated scratch paste containing a credential URL. |
| `thru-defi-frontend.md`, `thru-defi-backend.md` | **Distilled & Deleted** | §5 above & `docs/defi/`. |
| `thru-identity-profile-plan.md` | **Distilled & Deleted** | §6 above. |
| `docs/REDESIGN_TRIAGE.md` | **Distilled & Deleted** | Shipped R1–R6/R8 in `src/`; remaining items in §2.3 above. |
| `docs/HISTORY_REDESIGN_PLAN.md` | **Merged & Deleted** | `docs/guides/history-and-activity.md`. |
| `docs/MAINNET_READINESS.md`, `docs/SEND_PATH_AUDIT.md` | **Merged & Deleted** | `docs/AUDIT_REPORT.md`, `docs/BACKEND_GAPS.md`, `docs/STATUS_AND_ROADMAP.md`. |
| `docs/TX_REVIEW_VERIFICATION.md` | **Split/Distilled & Deleted** | `docs/guides/transaction-review.md` & `docs/DEFECT_LOG.md`. |
| `docs/archive/{WALLET_FEATURES_PERFORMANCE_STUDY,LAUNCHPAD_UX_STUDY,LAUNCHPAD_DEX_MIGRATION_UX,THRU_NATIVE_DEFI_TAB_UX}.md` | **Distilled & Deleted** | §2.3 & §5 above + `docs/MODULE_BOUNDARIES.md`. |
| `docs/archive/{PASSKEY_SPIKE,MCP_AGENT_INTEGRATION}.md` | **Distilled & Deleted** | §4 & §7 above. |
| `docs/archive/{TX_DETAIL_SPIKE,EXPLORER_SPIKE}.md` | **Distilled & Deleted** | `docs/guides/protocol-and-rpc.md` & `docs/guides/history-and-activity.md`. |
| `docs/archive/{guide,thru-implementation_plan,task,UI_REBUILD_PLAN,UI_REBUILD_AGENT_PROMPT,MIGRATION_MAP}.md`, `docs/handoff/*`, `docs/reference/*` | **Discarded** | Obsolete pre-rebuild prompts/plans; DevTools helpers in `docs/MANUAL_SMOKE_CHECKLIST.md` §9. |
