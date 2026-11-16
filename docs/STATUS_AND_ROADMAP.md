# Status and Roadmap

**Document Class:** Authority (Single Source of Truth for Current Shipped State & Active Verification Work)
Source baseline re-verified on `main` at contract v33 (2026-11-16). `src/`, `test/`, and `scripts/` remain authoritative.

---

## 1. Shipped Baseline (Contract v33)

- **Shared Contract (`v33`, `154` methods, `15` routes):** Declared in `src/shared/contract/manifest.js` (`88` wallet-core + `23` `name.*` + `43` DeFi M0 methods in `src/shared/contract/defi-schema.js` whose build-time flags in `src/shared/flags.js` are all `false`). Exact pins: `@thru/sdk@0.4.2` and `@thru/programs@0.4.2`.
- **Verified Token Import (`v33`):** Dashboard uses `token.importVerified` (`auth: 'unlocked'`, mint address and optional fallback symbol only). The background verifies mint ownership, SDK layout and denomination from a captured account snapshot before network-scoped persistence, rejects caller-supplied name/decimals and duplicate imports, and fences network-generation changes. Legacy `token.import` retains its metadata-only contract. Deterministic router coverage is in `test/test-token-balances.mjs`; browser and live-network import verification remain `UNVERIFIED`.
- **One UI Stack (`15` Routes):** `/welcome`, `/unlock`, `/dashboard`, `/accounts`, `/account`, `/add-account`, `/keyring`, `/export`, `/send`, `/receive`, `/faucet`, `/name`, `/history`, `/settings`, `/reset`. Toolbar popup (`400x600`) and resizable side panel (`popup.html?thru_panel=1`) share one HTML shell with synchronous close-listener registration and mutual exclusion; Side Panel Mode is an explicit Settings opt-in.
- **Transaction Review & Background Consent Gate (`v29`–`v32`):** Every value-moving screen (`/send` native & token, `/name` register/purchase/renew/claim, `/faucet` claim — plus contract-level `domain-record`, `9` review kinds total including display-only `raw`) prepares via `tx.prepareReview`, renders `src/ui/domain/tx-review/review-card.js`, and confirms via `tx.confirmReview`. As of **v32**, `tx.confirmReview` mints a single-use 60s `consentToken` (`src/background/services/review/consent.js`) bound to `{ method, sha256(canonicalParams), accountAddress, networkId }`, and `api-router.js` rejects any non-exempt value-moving call lacking a valid token (`REVIEW_REQUIRED`). Full spec: `docs/guides/transaction-review.md`.
- **Signing & Owned-Account Activation (`D-003`, `v12`):** Unlocked session signing is the default (`requirePasswordForSigning: false`); per-sign password re-auth is a password-gated Settings opt-in. `tx.registerAccount` (`auth: 'unlocked'`) self-signs (`NOOP_PROGRAM_ADDRESS`, fee `0n`, nonce `0n`, `stateUnits: 1`) exclusively for vault-owned addresses at creation, on `/dashboard`, and JIT on `/send` (never external addresses).
- **Domains (`/name`, `v21`–`v31`):** Two tabs (`Register` and `My Domains`), `.thru`-only registration and renewal (`via: 'custom'` wired in `v30`), `.id` lookup-only resolution, versioned per-network tracked domain inventory (`thru_registered_domains`), opcode-2 text record append (`name.setRecord`, `v31`, contract-only), reverse lookup (`name.reverseLookup`, `v31`), and unified header network fees via `tx-units.networkFeeUnits` (`2026-11-12`). Full spec: `docs/guides/domains-and-registrar.md`.
- **History (`/history`, `v9`–`v12`):** Flat newest-first card stream without day headers; storage-only cache-first paint (`tx.getCachedHistory`); provenance-tagged timestamps (`block` -> own `submitted` -> `Block <slot>`); lazy `tx.getDetail` sheet reporting `Fee (declared)` (`feeCharged: false`). Full spec: `docs/guides/history-and-activity.md`.
- **Quarantines (`v7`, `D-005`):** Legacy `src/launchpad/` is deleted and guarded (`test/test-launchpad-quarantine.mjs`). Custom RPC activation and writes are refused in the background (`CUSTOM_NETWORK_DISABLED`, `CUSTOM_RPC_SUPPORTED = false`) and stale stored IDs self-heal to `betanet` before client binding. No `window.thru` dApp provider exists.

### Recorded Automated Baseline (`IMPLEMENTED`, `TESTED`)

Full build and test gates were rerun successfully on 2026-11-16 after integrating the startup,
verified-import, registrar, pending-outcome, and passive-polling auto-lock repairs. Browser
evidence is limited to the mocked-runtime Chrome harness recorded in the smoke checklist.

- `npm run build` -> **PASS** (`dist/` regenerated cleanly from `src/`, zero warnings).
- `npm test` -> **PASS** across all **9 guard scripts** and **41 test suites**: contract v33 (`154` methods), `1,153/1,153` route-lifecycle checks, `205/205` review pipeline checks, and `67/67` review-card checks. Structural guards retain zero DOM-injection sinks and the existing import-cycle ratchet.
- Deterministic Node tests use a hand-rolled DOM shim and stubbed RPCs; **they never close real-browser or live-chain verification gates**.

---

## 2. Live Betanet Evidence Matrix (What Is Proven vs Open)

| Area | Status | Recorded Evidence & Exact Scope |
| --- | --- | --- |
| **Native THRU Transfer & Fee** | `VERIFIED AGAINST LIVE NETWORK` *(partial UI smoke)* | `1` base-unit transfer fee measured on managed-genesis deployment (`2026-09-26`); one native Betanet self-send exercised end-to-end in real Chrome popup (`2026-10-04`, `docs/MANUAL_SMOKE_CHECKLIST.md` §8 — charged fee not captured; JIT activation not exercised). |
| **Faucet Claim & Cap** | `VERIFIED AGAINST LIVE NETWORK` *(script)* | Raw base-unit amount confirmed (`2026-09-26`); SDK `0.4.1` zero-unit regression resolved via `src/lib/tx-units.js` (`2026-10-09`); exact `10,000` base-unit per-tx cap confirmed (`2026-10-24-faucet-cap.json`). Browser v29/v32 faucet review smoke remains `UNVERIFIED`. |
| **Token Mint, Init & Transfer (`P3`)** | `VERIFIED AGAINST LIVE NETWORK` *(script, 2026-10-23)* | `scripts/defi-evidence/2026-10-23-live-chain-run3.json`: all 13 rungs passed on Betanet using pre-funded sender; proved sender-paid token-account initialization succeeds for a **never-registered** recipient wallet (`created: true`) while recipient native wallet stays unregistered, and observed `2` base units across init + transfer (`1` base unit/tx). Promoting token fee from `"unmeasured"` into `src/lib/networks.js` awaits explicit config decision. |
| **18 Bootstrap Programs & AMM Swap** | `VERIFIED AGAINST LIVE NETWORK` *(script, 2026-10-23..25)* | All 18 `@thru/programs@0.4.2` bootstrap addresses verified deployed on Betanet (`2026-10-23`); AMM pool init, LP add, and exact-in swap verified with `vmError: 0` (`2026-10-25-live-swap-probe.json`). All `DEFI_*` flags remain `false`. |
| **Custom `.thru` Registrar** | `PARTIALLY IMPLEMENTED` / `UNVERIFIED` *(strict collection & v32 `.bin`)* | Betanet read (`2026-10-26`) and router `Register` (`2026-10-27`) verified under flat layout-1; `UpdateConfig` (`2026-10-31`, `registrar-deploy-betanet-thru-1793443647724.json`) set layout-2 tiers `100,000 / 10,000 / 1,000` + `feePolicy: "strict"` (`vmError: 0`), **but** `collectionProbe.measured` is `false`, the checked-in `33,714`-byte `.bin` (`0xD112` canonical-PDA check) is 1 build ahead of Betanet's `30,000`-byte deployment, and header `networkFeeUnits` (`1` base unit) has not been broadcast live yet. |
| **Full Domain Enumeration** | `BLOCKED` | Betanet `ListAccounts` filtered by Name Service program returned `RESOURCE_EXHAUSTED` (`2026-10-27`); wallet uses explicit local tracked registry (`thru_registered_domains`). |
| **`name.setRecord` & `reverseLookup` (`v31`)** | `UNVERIFIED` *(live chain)* | Deterministic router/decoder suites pass (`test-name-records.mjs`, `test-name-reverse.mjs`); zero live Betanet writes/reads executed yet; no UI screen exposes `domain-record`. |
| **Real Chrome UI, Side Panel & MV3** | `UNVERIFIED` | Only `/send` popup self-send (`2026-10-04`) and isolated mocked `NameRoute` visual harness (`2026-10-27`) ran in Chrome. Full `docs/MANUAL_SMOKE_CHECKLIST.md` (side panel, `<400px` / `>=800px` widths, `TxReviewCard` §7, `toast()` bar, MV3 worker eviction) remains open. |

---

## 3. Release Blockers & Ordered Next Work

### Active Release Blockers Before Bumping Package Version `1.4.1`

1. **Custom Registrar Upgrade & Measured Treasury Delta:** Deploy the checked-in `33,714`-byte `contracts/thru-custom-registrar/thru-custom-registrar.bin` to Betanet, execute one real `Register` **and** `Renew` with `--probe-collection`, verify the non-canonical config `0xD112` rejection, and record an observed treasury balance delta before any surface claims a registration charge was collected. (Mainnet contract release additionally requires gating `Initialize` on upgrade authority and adding a `max_fee` bound on `Register`/`Renew` per `docs/GLOBAL_SMART_CONTRACT_POLICY.md`.)
2. **`name.setRecord` Live Disposition:** `name.setRecord` is callable at the contract boundary (`auth: 'signing'`, consent-gated) with zero live Betanet probes — either exercise it live on Betanet with a throwaway domain or gate it behind `FLAGS.NAME_SERVICE` before shipping a new store package.
3. **Owner-Deferred Domain Copy & Version Bump:** `"Import"` (`name.trackDomain`, read-only local watching) and `"Unlink"` (`name.unlinkPrimary`, local alias removal without signing) are held for owner-chosen replacement labels; package version stays `1.4.1` until blockers (1)–(2) close.

### Ordered Wallet-Core Verification Sequence

1. **Complete `docs/MANUAL_SMOKE_CHECKLIST.md` in Real Chrome:** Toolbar popup + side panel (`<400px` and `>=800px`), mutual exclusion, QR scan, focus traps, `toast()` bar, and §7 `TxReviewCard` across Send, Token Send, Domain, and Faucet.
2. **Close Release Blockers (1) & (2) on an RPC-Reachable Host:** Custom registrar `.bin` upgrade + treasury-collection measurement + `name.setRecord` probe.
3. **Live Multi-Account `v12` Activation & `scripts/verify-live-e2e.mjs betanet`:** Exercise multi-HD creation registration, `/send` JIT activation for an owned absent recipient, and MV3 worker suspension/restart during in-flight registration/send.
4. **Promote Measured Token Fee Config (Optional Follow-Up):** Decide whether to wire the `2026-10-23` observed `1`-base-unit Token Program fee into `src/lib/networks.js` with dated provenance, and wire `tx-units.autoUnits` to read `network.baseFeeUnits` rather than literal `1n` ahead of Mainnet.
5. **Live History & Explorer Route Confirmation:** Measure `blocks.get` block-time availability/latency on Betanet, verify `https://scan.thru.org` `/tx/` deep links, and confirm no typed RPC/explorer field exposes charged fees.
6. **Dependency & Security Audit Gate:** Re-run `npm audit --omit=dev`, verify `@thru/*@0.4.2` & `esbuild` advisories, and complete an **independent external security audit** (`EXTERNAL AUDIT REQUIRED` — `docs/AUDIT_REPORT.md` Gate E).
7. **Mainnet Configuration & Live Re-Verification:** Measure Mainnet fees (`baseFeeUnits` is `null` today), verify Mainnet program deployments and explorer routes, update `src/manifest.json` `connect-src`, and re-run live verification against Mainnet.

Unshipped product expansions (DeFi/Launchpad UI, `.thru` public profiles, Passkey smart accounts, local MCP companion) are tracked separately in `docs/roadmap/FUTURE_ROADMAP.md`.
