# Lifecycle Management, Security Monitoring, and QA Strategy

**Document Class:** Strategic Engineering & QA Plan (`PLANNED` Process Upgrades + Active Security Checklists)
**Baseline:** Contract **v33** (`154` methods, `15` routes, `41` Node suites + `9` guard scripts; `.github/workflows/ci.yml` currently runs `npm ci`, `npm run build`, `npm run test` only)

---

## 1. Build, Audit, and Continuous Security Lifecycle

Today `.github/workflows/ci.yml` runs a single 26-line Ubuntu job (`npm ci` -> `npm run build` -> `npm run test`). For a Mainnet self-custody wallet managed by a non-coder orchestrating AI agents, upgrade lifecycle management across five automated layers:

### 1.1 Pre-Commit & Branch Isolation (Stopping Agent Drift Locally)
1. **One Agent = One Git Worktree / PR:** Never run parallel frontend and backend coding agents on the same uncommitted working directory. Merge each slice through pull requests gated by CI.
2. **Local Git Hook (`scripts/install-hooks.mjs` -> `.git/hooks/pre-commit`):**
   - Run `git diff --check` (whitespace & merge-conflict markers).
   - Run `node scripts/check-layering.mjs && node scripts/check-agents.mjs && node scripts/check-docs-truth.mjs && node scripts/check-csp.mjs`.
   - Scan staged diffs for accidental high-entropy hex (`64`-char private keys), `12`-word test mnemonics outside allowlisted golden vector files, or `.env` tokens.

### 1.2 Hardened Six-Stage CI Pipeline (`.github/workflows/ci.yml`)
Expand CI from 1 job into 6 deterministic stages:
1. **Supply-Chain & Lockfile Gate:** Enforce `.npmrc` (`ignore-scripts=true`, `save-exact=true`), verify `package-lock.json` integrity, run `npm audit --omit=dev --audit-level=high`, and fail if any dependency outside `@thru/*` and `esbuild` is added.
2. **Static Architecture & Docs-Truth Gate:** Run all `9` `scripts/check-*.mjs` guards + `tsc --noEmit` (once `checkJs`/`tsconfig.json` is enabled).
3. **Deterministic Build & Bundle Budget Gate:** Run `npm run build` twice in clean temp directories and assert **byte-identical `sha256`** across `dist/popup.bundle.js`, `dist/background.bundle.js`, and `dist/popup.css`. Fail if popup or background bundle size jumps by `> 10%` without approval.
4. **Node Unit & Integration Matrix:** Run all `41` `test/test-*.mjs` suites with `node --unhandled-rejections=strict`.
5. **Real-Browser MV3 E2E Job (Playwright Chromium — Dev-Only CI Runner):** Launch real Chromium with `--load-extension=dist` in CI (`xvfb-run` on Ubuntu) without adding runtime dependencies to `dist/` (§2 Tier 3 below).
6. **Release Candidate Packaging (`tag: v*`):** Generate `thru-wallet-dist-vX.Y.Z.zip`, `SHA256SUMS.txt`, and CycloneDX SBOM; hold behind a GitHub Environment manual approval gate so **only the repository owner** can approve Chrome Web Store upload.

### 1.3 SDK Upgrade & Smart-Contract Audit Protocol
Whenever `@thru/sdk` or `@thru/programs` releases a new version (e.g., `0.4.2 -> 0.4.3`):
1. Run `node scripts/collect-offline-evidence.mjs` in a branch and diff exported functions, protobuf wire fields, and bootstrap program addresses against the committed snapshot (`test-derivation.mjs` golden vectors must remain byte-identical).
2. Re-run `test-thru-client.mjs` and `test-custom-registrar.mjs` sorted-account index sentinels.
3. For `contracts/thru-custom-registrar` (or any future Rust contract): run `cargo test --lib`, `cargo clippy -- -D warnings`, `cargo audit`, and verify the compiled RISC-V `.bin` `sha256` inside Docker for reproducible bytecode before touching Betanet or Mainnet.

### 1.4 Continuous Post-Release Monitoring & Incident Response
- **Scheduled Nightly Read-Only Chain Canary (`.github/workflows/chain-canary.yml`):** Run a zero-key, read-only GitHub Action every 12 hours against `rpc.betanet.thru.org` (and Mainnet once live) checking: (a) `getVersion` / `chainId` / genesis fingerprint stability, (b) bytecode hashes of all 18 bootstrap programs + `thru-custom-registrar`, and (c) `RegistrarConfig` treasury/admin/tier values. Open an automated GitHub Issue + Telegram alert on any unexpected on-chain change.
- **Emergency Narrowing-Only Kill Switch:** Pin an offline-held owner Ed25519 public key in `FEED_POLICY` (`src/background/services/defi/feed-record.js`) before enabling DeFi or Mainnet custom contracts so a signed `SignedFeedRecord` (`ops.kill`) can disable a compromised integration immediately while a CWS hotfix awaits Google review.

---

## 2. Four-Tier Quality Assurance (QA) Strategy

A green Node test suite today proves logic against mocks and a layout-free DOM shim; **it cannot catch CSS clipping, Chrome popup blur behavior, WebAuthn OS dialogs, or live ThruVM state-proof errors.** Close that gap with four distinct testing tiers:

| Tier | Environment | What It Must Prove | Cadence |
| --- | --- | --- | --- |
| **Tier 1: Unit & Property Fuzzing** | Node (`test/test-*.mjs`) | Pure codecs (`thru-client`, `custom-registrar`, `name-service`), `BigInt` decimal/rounding boundary fuzzing (`0`, `1n`, `MAX_U64`, `9`-decimal edges), malformed RPC/ABI byte fuzzing (never throws uncaught), and negative controls (`Rule 22`). | Every save & PR |
| **Tier 2: Worker & Race Integration** | Node + Detached RAM Storage + Fake Timers | Cross-service races: concurrent `network.setActive` during `tx.prepareReview`/`confirmReview`, simultaneous `preferences` security + theme writes, mid-flight `walletService.lock()`, schema `v0 -> v1 -> v99` fail-closed refusal, and simulated MV3 worker memory wipe (`consent.js` + `pending-tx-service.js` recovery). | Every PR (`--unhandled-rejections=strict`) |
| **Tier 3: Real-Chromium MV3 E2E *(Critical Missing Layer)*** | Playwright `chromium.launchPersistentContext` loading unpacked `dist/` | Real Chrome layout & bounding-box checks across all **15 routes** at `400x600` popup, `300px` narrow side panel, and `800px` wide side panel (`scrollWidth <= clientWidth`, Confirm buttons reachable without clipping); popup/side-panel `?thru_panel=1` mutual exclusion; real `chrome.serviceWorker` termination & wake; clipboard & `focus-trap` Tab/Escape cycles; visual screenshot diffs. | Every PR in CI *(Playwright kept strictly out of `dist/`)* |
| **Tier 4: Live-Network Protocol Battery** | Disposable Throwaway Wallet against Betanet (and later Mainnet Canary) | Real gRPC-Web transport, `StateProof` creation, `NOOP` / `EOA_CREATE` activation, native THRU faucet claim (no per-account rate limit), `13`-rung Token Program init+transfer, custom registrar `Register` + `Renew` **before/after user & treasury balance deltas**, `name.setRecord` (`APPEND_RECORD` state units), and `blocks.get` block-time provenance — saved as immutable JSON in `scripts/defi-evidence/`. | Pre-release & after any SDK/contract change |

---

## 3. Master Security & Release Checklists

### 3.1 Every Pull Request Security Checklist
- [ ] `npm run build && npm test` and `git diff --check` pass with zero skipped/weakened tests.
- [ ] `scripts/check-docs-truth.mjs` and `scripts/check-agents.mjs` pass (`0` retired-doc leaks in `dist/`).
- [ ] Every value-moving path requires `tx.prepareReview` -> `TxReviewCard` -> `tx.confirmReview` (`consentToken`) -> `signing-guard.js`.
- [ ] Every RPC read handles `null` / timeout as `unknown` (`stale: true`), never coercing outages into `0` balance or `"available"`.
- [ ] Zero secrets touch URLs, `location.hash`, `data-*`, `localStorage`, `console.*`, or surviving detached DOM subtrees.
- [ ] UI changes inspected in real Chrome (`docs/MANUAL_SMOKE_CHECKLIST.md`) with popup + side-panel screenshots attached.

### 3.2 Pre-Mainnet Launch Gate Checklist (`networks.mainnet.enabled = true`)
- [ ] **External Audit (`Gate E`):** Independent third-party security audit completed on `src/lib/vault.js`, `src/background/api-router.js`, `review-service.js` / `consent.js`, future dApp provider bridge, and any custom Rust contracts (`thru-custom-registrar`), with all Critical/High/Medium findings remediated and re-verified.
- [ ] **Mainnet Fee & Unit Wiring (`Gate D`):** Mainnet `baseFeeUnits` measured on live Mainnet and threaded through **both** `src/lib/networks.js` and `src/lib/tx-units.js` (`autoUnits`).
- [ ] **Contract Hardening:** `thru-custom-registrar` upgraded with caller `max_fee` ceiling and upgrade-authority-gated `InitializeV2`; deployed bytecode `sha256` matches reproducible build.
- [ ] **Manifest & CSP:** Deterministic extension `key` pinned; `connect-src` restricts connections solely to verified HTTPS Mainnet/Betanet RPC origins (`scripts/check-csp.mjs`); `extension.md`, `SECURITY.md`, `PRIVACY.md`, and `SUPPORT.md` updated for Mainnet risk disclosures.
- [ ] **Incident Readiness:** Nightly chain canary active and cold-key `SignedFeedRecord` kill-switch tested end-to-end.

---

## 4. Long-Term Maintenance Cadence (Non-Coder Owner Operating Rhythm)

- **Per Feature / Bug Fix:** Run in an isolated branch using one focused prompt -> verify CI + visual screenshots -> run independent audit prompt on the PR diff (`Rule 30`) before merging.
- **Weekly (15 min):** Review automated Nightly Chain Canary status and `npm audit --omit=dev`.
- **On Every `@thru/sdk` / Chrome Milestone Release:** Run the SDK surface diff + Tier 3 Chromium MV3 smoke + Tier 4 Betanet throwaway probe before bumping pins.
- **Quarterly:** Rotate disposable test-wallet seeds, test the emergency kill-switch in staging, and review `docs/STATUS_AND_ROADMAP.md` against Unto Labs' upstream protocol roadmap.
