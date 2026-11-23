# Status and Roadmap

**Document Class:** Authority (Single Source of Truth for Current Shipped State & Active Verification Work)
Source baseline re-verified on `main` at contract v33 (2026-11-19, v1.6.0). `src/`, `test/`, and `scripts/` remain authoritative.

---

## PR #31 Local Validation (2026-11-23)

**IMPLEMENTED / TESTED locally:** the actual-built-UI record is indexed in
[docs/screenshots/README.md](screenshots/README.md). The gallery's manifest records its exact
source baseline on local `pr-31` plus any uncommitted capture/tooling changes:
150 Chromium captures of all 15 routes in selected safe states and additional onboarding,
account-cache/error/search, Assets and Settings scenarios, light/dark at `400x600`, `320x600`
and `820x720`. The existing store screenshots remain synthetic marketing compositions.

The [visual record protocol](MANUAL_SMOKE_CHECKLIST.md#visual-record-protocol) owns active-change
feedback and confirmed/merged refresh requirements. Capture/check tooling rebuilds the popup,
records source/build/image hashes and checks coverage; the Windows fixture path separator was
corrected after reproducing a failed page load. CI artifact capture is **IMPLEMENTED** but its
remote execution on the current fixes is **UNVERIFIED**. No images are automatically committed.

**UNVERIFIED by this record:** native popup/side-panel hosting, real vaults/signing, live-chain
values, exhaustive interaction/scroll/review states and design approval. A separate native MV3
load/absence-of-provider smoke test passed locally in Chromium `159.0.8154.6`; that narrow check
does not verify toolbar/side-panel hosting, wallet lifecycle or planned dApp authorization/signing.
Git remote PR head was observed as `197c833`; local `3611e18` and later uncommitted oracle fixes
are not proof of green remote checks or a merge. `gh` is unavailable locally, so the latest remote
check conclusions were not independently retrieved.
The earlier branch handoff below is historical context and does not describe the latest PR head.

**IMPLEMENTED / TESTED locally:** build, full Node suite and all seven browser scripts passed with
the permanent pinned Playwright module and cached Chromium `159.0.8154.6`, without another browser
download. The original contrast failure (`1.407:1`) dropped the active-row background alpha; an
independent calculation gave about `6.75:1`. The revised oracle also composites translucent text,
all ancestor layers and group opacity without intermediate rounding, checks five independently
specified ratios per theme, and retains the `4.5:1` threshold. It fails closed on relevant image
backgrounds/unsupported computed colors; it is not a general pixel-based accessibility audit.

The chooser timeout was independently reproduced as a test readiness race: its opening frame
reassigned focus to Back after the test had focused a network choice. The test now waits for the
open state and initial focus, retaining pending/error, duplicate suppression and dismissal checks
with injected duplicate-message controls. No production stylesheet or network policy was changed.
Capture's native unload-warning exception is exact, recorded per image, and cannot swallow an
application-error near-match. Captures now render frozen hashed asset bytes after a concurrent
rebuild was observed deleting `dist/popup.html` mid-run; missing snapshot assets are refused rather
than read from a replacement build. The final gallery must pass `capture-ui --check` after every source
or build change; local results do not clear remote checks on an older commit.

## Current branch handoff — PR #26

The baseline below describes `main`, not automatically the latest store package or this PR. The
working branch `arena/1b860a7c-thru-wallet-ext` is based on `38434abe` and PR #26 is **open,
unmerged and not release-approved**. The prior baseline evidence below is for `98650f4`; the branch also contains `46f0acc` and the current Settings work; use
`git status`, `git log` and the PR checks to identify later work. Product behavior belongs in
`docs/BUILD_SPEC.md`; pending manual checks are in `docs/MANUAL_SMOKE_CHECKLIST.md`.

- **IMPLEMENTED / TESTED in branch:** inset dashboard and Assets drawer with verified import,
  hide/restore and cache-first rendering; dashboard network chooser reuses Settings controls;
  flat History cards with independently clickable explorer links; Settings sheets, disabled
  planned options, wallet branding and address contrast improvements. Receive redesign was
  reverted; the existing Receive flow remains. No new Mainnet, custom RPC or DeFi enablement.
- **IMPLEMENTED / TESTED in branch:** health indicator retries transient failures with bounded
  delays and fences old network results. Its milliseconds measure RPC probe latency, **not block
  time**. The installed-extension report and actual cause remain **UNVERIFIED** on live Betanet.
- **TESTED at `98650f4`:** build and `npm test` passed (1,240/1,240 route lifecycle, 15/15 QR;
  API router passed); `npm audit --omit=dev` reported zero vulnerabilities. Six checked-in
  Playwright fixtures passed with a synthetic bridge in Chromium 153. Fixtures are neither a
  loaded MV3 extension nor live network evidence. No new independent audit was performed.
- **BLOCKED:** an older delayed token-registry read can overwrite a newer balance cache after
  import (controlled reproduction). Agent A added in-flight invalidation in `46f0acc`, but its test
  holds an RPC after registry loading; the previously reproduced delayed-registry-read ordering
  occurs before in-flight registration and remains unverified by that test. A pending preference
  write can return stale Side Panel mode
  (controlled stale read; full Chrome timeout divergence not reproduced). Both remain unresolved.
  Native popup/panel and worker lifecycle, physical QR scan, approved disposable-wallet Betanet
  flows, final independent review and owner approval remain open. See the manual checklist for scope.
- **PARTIAL owner feedback:** Side panel open/close worked on several attempts after one failure to load; extension version and Chrome version were not supplied. This does not reproduce or rule out the separate preference timeout race. See `docs/MANUAL_SMOKE_CHECKLIST.md` for the pending retest.
- **UNVERIFIED (Agent C review at older `3d51e0a`):** History pending rendering parses persisted
  `amountUnits` without guarding `BigInt`; malformed stored records can plausibly break rendering,
  but no regression reproduction or fix has been completed. The proposed stuck-spinner scenario
  also needs a controlled reproduction; context changes start a new load. Do not treat either as
  resolved. `onExecution` is called without awaiting its promise by the SDK stream wrapper, so the
  report's claim that it blocks the stream is not supported by that code. History refreshes every
  five seconds, while one-second pending polling runs only with pending entries; performance
  changes need measurement and owner review.
- **IMPLEMENTED in branch:** Theme, Auto-lock and Signing settings sheets use full-width selectable rows; their existing save and password-confirmation flows are unchanged. Browser fixture evidence is not installed-extension verification.

---

## 1. Shipped Baseline (Contract v33)

- **Shared Contract (`v33`, `154` methods, `15` routes):** Declared in `src/shared/contract/manifest.js` (`88` wallet-core + `23` `name.*` + `43` DeFi M0 methods in `src/shared/contract/defi-schema.js` whose build-time flags in `src/shared/flags.js` are all `false`). Exact pins: `@thru/sdk@0.5.2` and `@thru/programs@0.5.2`.
- **SDK 0.5.2 upgrade (`VERIFIED AGAINST LIVE NETWORK`, 2026-11-19):** `@thru/sdk`/`@thru/programs` pinned at 0.5.2 per D-030. HD coin type moved 9999 → 8478 (`m/44'/8478'/index'/0'`), `ROOT_MANAGER_PROGRAM_ADDRESS` → `CORE_MANAGER_PROGRAM_ADDRESS`, 1-byte token account discriminator, and Ledger path compatibility helpers. Existing 0.4.x seed keyrings derive new addresses after this upgrade (goldens regenerated, no legacy path). Verified live against Betanet: host HD index 0 account derived/activated/funded, custom registrar program deployed & initialized (`vmError: 0`), live domain `probe4pwpy.thru` registered (`vmError: 0`), and 16-rung token transfer suite passed.
- **Verified Token Import (`v33`):** Dashboard uses `token.importVerified` (`auth: 'unlocked'`, mint address and optional fallback symbol only). The background verifies mint ownership, SDK layout and denomination from a captured account snapshot before network-scoped persistence, rejects caller-supplied name/decimals and duplicate imports, and fences network-generation changes. Legacy `token.import` retains its metadata-only contract. Deterministic router coverage is in `test/test-token-balances.mjs`; browser and live-network import verification remain `UNVERIFIED`.
- **One UI Stack (`15` Routes):** `/welcome`, `/unlock`, `/dashboard`, `/accounts`, `/account`, `/add-account`, `/keyring`, `/export`, `/send`, `/receive`, `/faucet`, `/name`, `/history`, `/settings`, `/reset`. Toolbar popup (`400x600`) and resizable side panel (`popup.html?thru_panel=1`) share one HTML shell with synchronous close-listener registration and mutual exclusion; Side Panel Mode is an explicit Settings opt-in.
- **Transaction Review & Background Consent Gate (`v29`–`v32`):** Every value-moving screen (`/send` native & token, `/name` register/purchase/renew/claim, `/faucet` claim — plus contract-level `domain-record`, `9` review kinds total including display-only `raw`) prepares via `tx.prepareReview`, renders `src/ui/domain/tx-review/review-card.js`, and confirms via `tx.confirmReview`. As of **v32**, `tx.confirmReview` mints a single-use 60s `consentToken` (`src/background/services/review/consent.js`) bound to `{ method, sha256(canonicalParams), accountAddress, networkId }`, and `api-router.js` rejects any non-exempt value-moving call lacking a valid token (`REVIEW_REQUIRED`). Full spec: `docs/guides/transaction-review.md`.
- **Signing & Owned-Account Activation (`D-003`, `v12`):** Unlocked session signing is the default (`requirePasswordForSigning: false`); per-sign password re-auth is a password-gated Settings opt-in. `tx.registerAccount` (`auth: 'unlocked'`) self-signs (`NOOP_PROGRAM_ADDRESS`, fee `0n`, nonce `0n`, `stateUnits: 1`) exclusively for vault-owned addresses at creation, on `/dashboard`, and JIT on `/send` (never external addresses).
- **Domains (`/name`, `v21`–`v31`):** Two tabs (`Register` and `My Domains`), `.thru`-only registration and renewal (`via: 'custom'` wired in `v30`), `.id` lookup-only resolution, versioned per-network tracked domain inventory (`thru_registered_domains`), opcode-2 text record append (`name.setRecord`, `v31`, contract-only), reverse lookup (`name.reverseLookup`, `v31`), and unified header network fees via `tx-units.networkFeeUnits` (`2026-11-12`). Full spec: `docs/guides/domains-and-registrar.md`.
- **History (`/history`, `v9`–`v12`):** Flat transaction stream without date sections; storage-only cache-first paint (`tx.getCachedHistory`); provenance-tagged timestamps (`block` -> own `submitted` -> `Block <slot>`); lazy `tx.getDetail` sheet reporting `Fee (declared)` (`feeCharged: false`). Full spec: `docs/guides/history-and-activity.md`.
- **Quarantines (`v7`, `D-005`):** Legacy `src/launchpad/` is deleted and guarded (`test/test-launchpad-quarantine.mjs`). Custom RPC activation and writes are refused in the background (`CUSTOM_NETWORK_DISABLED`, `CUSTOM_RPC_SUPPORTED = false`) and stale stored IDs self-heal to `betanet` before client binding. No `window.thru` dApp provider exists.

### Recorded Automated Baseline (`IMPLEMENTED`, `TESTED`)

Full build and test gates were rerun successfully on 2026-11-19. The smoke checklist records both
mocked-runtime visual checks and partial unpacked-extension checks in real Chrome; remaining browser
and live-chain verification gates are listed below.

- `npm run build` -> **PASS** (`dist/` regenerated cleanly from `src/`, zero warnings).
- `npm test` -> **PASS** across all **9 guard scripts** and **41 test suites**: contract v33 (`154` methods), `1,174/1,174` route-lifecycle checks, `206/206` review pipeline checks, and `68/68` review-card checks. Structural guards retain zero DOM-injection sinks and the existing import-cycle ratchet.
- Deterministic Node tests use a hand-rolled DOM shim and stubbed RPCs; **they never close real-browser or live-chain verification gates**.

---

## 2. Live Betanet Evidence Matrix (What Is Proven vs Open)

| Area | Status | Recorded Evidence & Exact Scope |
| --- | --- | --- |
| **Native THRU Transfer & Fee** | `VERIFIED AGAINST LIVE NETWORK` *(partial UI smoke)* | `1` base-unit transfer fee measured on managed-genesis deployment (`2026-09-26`); one native Betanet self-send exercised end-to-end in real Chrome popup (`2026-10-04`, `docs/MANUAL_SMOKE_CHECKLIST.md` §8 — charged fee not captured; JIT activation not exercised). |
| **Faucet Claim & Cap** | `VERIFIED AGAINST LIVE NETWORK` *(script)* | Raw base-unit amount confirmed (`2026-09-26`); the historical SDK `0.4.1` zero-unit regression was resolved via `src/lib/tx-units.js` (`2026-10-09`); exact `10,000` base-unit per-tx cap confirmed (`2026-10-24-faucet-cap.json`). Browser v29/v32 faucet review smoke remains `UNVERIFIED`. |
| **Token Mint, Init & Transfer (`P3`)** | `VERIFIED AGAINST LIVE NETWORK` *(script, 2026-10-23)* | `scripts/defi-evidence/2026-10-23-live-chain-run3.json`: all 13 rungs passed on Betanet using pre-funded sender; proved sender-paid token-account initialization succeeds for a **never-registered** recipient wallet (`created: true`) while recipient native wallet stays unregistered, and observed `2` base units across init + transfer (`1` base unit/tx). Promoting token fee from `"unmeasured"` into `src/lib/networks.js` awaits explicit config decision. |
| **18 Bootstrap Programs & AMM Swap** | `VERIFIED AGAINST LIVE NETWORK` *(historical script, 2026-10-23..25)* | The historical probe used `@thru/programs@0.4.2` to verify all 18 bootstrap addresses on Betanet, plus AMM pool init, LP add, and exact-in swap with `vmError: 0` (`2026-10-25-live-swap-probe.json`). The current exact pin is `0.5.2`; all `DEFI_*` flags remain `false`. |
| **Custom `.thru` Registrar** | `VERIFIED AGAINST LIVE NETWORK` *(script, 2026-11-19)* | Compiled with `link.x.in` (29,416 B), deployed/upgraded on Betanet (`ta2vDCBzzptN2qVZgz6PXsCp5cNB7Nef4yeQ3W-OqzZcfF`), initialized layout-2 root registrar + config (`ta_9lLvhxurg4J5DyZ82W14rzzGWCEfj9B7Y8wa99amPBa`) with `vmError: 0`. Live subdomain `probe4pwpy.thru` registered via custom registrar on Betanet (`vmError: 0`), creating on-chain domain and lease accounts. |
| **Full Domain Enumeration** | `BLOCKED` | Betanet `ListAccounts` filtered by Name Service program returned `RESOURCE_EXHAUSTED` (`2026-10-27`); wallet uses explicit local tracked registry (`thru_registered_domains`). |
| **`name.setRecord` & `reverseLookup` (`v31`)** | `UNVERIFIED` *(live chain)* | Deterministic router/decoder suites pass (`test-name-records.mjs`, `test-name-reverse.mjs`); zero live Betanet writes/reads executed yet; no UI screen exposes `domain-record`. |
| **Real Chrome UI, Side Panel & MV3** | `PARTIAL` | `/send` popup self-send (`2026-10-04`), mocked `NameRoute` harness (`2026-10-27`), and a `2026-11-18` Chrome 150 run: real toolbar popup and real side panel (360/320/820 px) on `/faucet` with the real background review, focus trap and rejection recovery (no live claim). Still open: live claim, physical toolbar click, mutual exclusion, QR scan, the rest of §3, §7 across other routes, `toast()` bar, MV3 worker eviction, auto-lock and secret hygiene. |

---

## 3. Release Blockers & Ordered Next Work

### Release Status & Ordered Next Work

Version `1.6.0` released per owner directive (`docs/DECISIONS.md` D-031) on 2026-11-19, with `@thru/sdk` and `@thru/programs` 0.5.2, contract v33, and live Betanet registrar and token-transfer verification.

1. **Registrar Fee Verification:** Execute a real `Register` and `Renew` with `--probe-collection`, verify the non-canonical config `0xD112` rejection, and measure the treasury balance delta before claiming that a registration charge was collected. The deployed Betanet registrar still requires Mainnet upgrade-authority gating and a `max_fee` bound on `Register`/`Renew` per `docs/GLOBAL_SMART_CONTRACT_POLICY.md`.
2. **`name.setRecord` Product & Surface Disposition (`D-028`):** Per owner directive, the extension remains focused on Option B (high-speed minting, renewal, primary aliases; complex editing deferred to web / future desktop tab "Expand" button), while Option A remains enabled at the contract layer to support external profile builders and monetize registrations. Live Betanet probe of append-only limits remains planned prior to any UI editing surface.
3. **Owner-Deferred Domain Copy:** `"Import"` (`name.trackDomain`, read-only local watching) and `"Unlink"` (`name.unlinkPrimary`, local alias removal without signing) are held for owner-chosen replacement labels.

### Ordered Wallet-Core Verification Sequence

1. **Complete `docs/MANUAL_SMOKE_CHECKLIST.md` in Real Chrome:** Toolbar popup + side panel (`<400px` and `>=800px`), mutual exclusion, QR scan, focus traps, `toast()` bar, and §7 `TxReviewCard` across Send, Token Send, Domain, and Faucet.
2. **Close Release Blockers (1) & (2) on an RPC-Reachable Host:** Registrar fee measurement + `name.setRecord` probe.
3. **Live Multi-Account `v12` Activation & `scripts/verify-live-e2e.mjs betanet`:** Exercise multi-HD creation registration, `/send` JIT activation for an owned absent recipient, and MV3 worker suspension/restart during in-flight registration/send.
4. **Promote Measured Token Fee Config (Optional Follow-Up):** Decide whether to wire the `2026-10-23` observed `1`-base-unit Token Program fee into `src/lib/networks.js` with dated provenance, and wire `tx-units.autoUnits` to read `network.baseFeeUnits` rather than literal `1n` ahead of Mainnet.
5. **Live History & Explorer Route Confirmation:** Measure `blocks.get` block-time availability/latency on Betanet, match a newly submitted wallet transaction to its `https://scan.thru.org` `/tx/` deep link (route verified read-only), and confirm no typed RPC/explorer field exposes charged fees.
6. **Dependency & Security Audit Gate:** Re-run `npm audit --omit=dev`, verify `@thru/*@0.5.2` & `esbuild` advisories, and complete an **independent external security audit** (`EXTERNAL AUDIT REQUIRED` — `docs/AUDIT_REPORT.md` Gate E).
7. **Mainnet Configuration & Live Re-Verification:** Measure Mainnet fees (`baseFeeUnits` is `null` today), verify Mainnet program deployments and explorer routes, update `src/manifest.json` `connect-src`, and re-run live verification against Mainnet.

Unshipped product expansions (DeFi/Launchpad UI, `.thru` public profiles, Passkey smart accounts, local MCP companion) are tracked separately in `docs/roadmap/FUTURE_ROADMAP.md`.
