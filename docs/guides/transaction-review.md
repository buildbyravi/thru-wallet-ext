# Transaction Review and Consent Pipeline

**Document Class:** Authority (Topical Guide — Shipped Behavior)
**Baseline:** Contract **v33** (`154` methods, `15` routes) | **Status:** `IMPLEMENTED`, `TESTED` (DOM-shim & router suites); real-browser layout and funded live-chain confirmation `UNVERIFIED`.
**Related Authorities:** `AGENTS.md` (Rules 10, 16, 17, 20, 21, 24, 28, 29) · `docs/ARCHITECTURE.md` · `docs/DECISIONS.md` (D-003, D-010, D-017, D-021, D-023)

---

## 1. Core Guarantee

Every value-moving operation in the shipped UI uses **one shared review, authentication, and background-consent pipeline**. Feature routes never build their own signing screen, fee line, warning copy, or password modal, and never invoke an `auth: 'signing'` method directly.

```text
UI Route (send.js / name.js / faucet.js)
  1. bridge.send('tx.prepareReview', { kind, ...intentParams })
       -> src/background/services/review-service.js
       -> src/background/services/review/kinds.js (fetches chain facts)
       -> src/shared/tx-review/decoders/<kind>.js (pure facts -> Review envelope)
       -> src/background/services/review/store.js (persists network-scoped tx_reviews, 120s TTL)
  2. Renders src/ui/domain/tx-review/review-card.js (TxReviewCard)
       -> fires onChange({ canConfirm, acknowledgements }) synchronously in constructor
  3. User clicks Confirm -> submitReviewedReview(...) in src/ui/domain/tx-review/confirm.js
       -> requires an AbortSignal tied to route teardown
       -> bridge.send('tx.confirmReview', { reviewId, bindingHash, acknowledgements })
       -> re-validates TTL, account, network, state === 'ready', acknowledgements, and kind rechecks
       -> mints a one-time 32-byte consentToken (60s TTL, memory-only in services/review/consent.js)
       -> prompts for master password ONLY if submit.requiresPassword is true (D-003 opt-in)
       -> bridge.send(submit.method, { ...submit.params, consentToken, password? })
       -> api-router.js verifies and burns consentToken BEFORE signing-guard or handler runs
       -> discards reviewId on successful submission (single-use)
```

### Checked Send Eligibility

These checked-send invariants remain mandatory even though the route paints before its RPC reads finish:

- Cached native balances are display-only and labelled last known. Native Max and Review require a live balance and a verified fee reserve; a missing fee estimate never becomes a zero reserve.
- Token selection requires a known positive balance denominated using on-chain mint decimals. A proven absent token account is zero; a failed or unreadable balance/mint read is unknown and cannot enable token spending.
- Balance, fee, token and picker hydration updates facts without replacing typed inputs. Account/network changes invalidate the review; late replies cannot reuse proofs from the previous context. Coverage lives in `test/test-route-lifecycle.mjs`, `test/test-balance-network.mjs` and `test/test-token-balances.mjs`; real-browser timing and MV3 scheduling remain open checks.

### Enforced Exemptions

`src/background/api-router.js` (`CONSENT_EXEMPT`) permits exactly **two** `TRANSACTION_METHODS` without a `consentToken`:

1. **`tx.registerAccount` (`auth: 'unlocked'`):** Self-registers an exact vault-owned address (`NOOP_PROGRAM_ADDRESS`, fee `0n`, nonce `0n`, `stateUnits: 1`). Invoked by account creation, `/dashboard` (for an absent active account), and `/send` JIT (for an absent vault-owned recipient). Takes no user-chosen transfer parameters and never registers external addresses.
2. **`intent.submit` (`auth: 'signing'`):** Dormant DeFi M0 method gated off behind `FLAGS.DEFI_INTENT === false` (refuses with `FEATURE_DISABLED`). Takes only `{ intentId, bindingHash, password }` against a wallet-prepared intent record.

Direct calls to any other member of `TRANSACTION_METHODS` (`tx.claimFaucet`, `tx.sendChecked`, `tx.autoCreateAccount`, `token.deploy`, `token.transferChecked`, `name.register`, `name.purchase`, `name.renewLease`, `name.claimExpired`, `name.setRecord`) without a valid one-time `consentToken` fail closed at the router with `REVIEW_REQUIRED` before touching the network.

### Stated Security Boundary of `consentToken`

`consentToken` (`src/background/services/review/consent.js`: `MAX_TOKENS = 40` with oldest-first eviction, `60s` TTL) strips `{ consentToken, password }` before computing canonical sorted-key SHA-256 over `submit.params` and distinguishes six refusal reasons on `consumeConsent` (`missing | unknown | expired | method | params | context`). It proves that a signing request is the unmodified continuation of a `tx.prepareReview` -> `tx.confirmReview` sequence for the exact `{ method, sha256(canonicalParams), accountAddress, networkId }` within 60 seconds, preventing direct-method bypasses, post-confirm parameter mutation, and hidden batch loops. Because both `tx.prepareReview` and `tx.confirmReview` are callable over the same extension bridge, the background token **cannot** independently prove that a human visually read the rendered DOM card.

---

## 2. Registered Review Kinds (9 Kinds)

`src/shared/tx-review/registry.js` (populated by `src/shared/tx-review/decoders/index.js`) and `src/background/services/review/kinds.js` register **9 identical kinds** (enforced by `test/test-tx-review.mjs` [0] and `test/test-signing-surface.mjs`):

| Kind | Decoder File | Recheck Handler | Submit Method | Shipped UI Caller |
| --- | --- | --- | --- | --- |
| `native-send` | `decoders/native-send.js` | `nativeSendRecheck` | `tx.sendChecked` (`signing`) | `routes/send.js` |
| `token-transfer` | `decoders/token-transfer.js` | `tokenTransferRecheck` | `token.transferChecked` (`signing`) | `routes/send.js` |
| `domain-register` | `decoders/domain.js` | `domainRegisterRecheck` | `name.register` (`signing`, `via: 'custom'`) | `routes/name.js` |
| `domain-purchase` | `decoders/domain.js` | `registryWriteRecheck` | `name.purchase` (`signing`) | `routes/name.js` |
| `domain-renew` | `decoders/domain.js` | `domainCustomRenewRecheck` / `registryWriteRecheck` | `name.renewLease` (`signing`) | `routes/name.js` |
| `domain-claim` | `decoders/domain.js` | `registryWriteRecheck` | `name.claimExpired` (`signing`) | `routes/name.js` |
| `domain-record` | `decoders/domain-record.js` | `domainRecordRecheck` | `name.setRecord` (`signing`) | Contract-only (no UI screen yet) |
| `faucet-claim` | `decoders/faucet-claim.js` | `faucetClaimRecheck` | `tx.claimFaucet` (`unlocked`) | `routes/faucet.js` |
| `raw` | `decoders/raw.js` | `null` | `null` (`NOT_EXECUTABLE`) | Display-only fallback; cannot sign |

DeFi/DEX/launchpad review kinds are intentionally absent while `FLAGS.DEFI_*` are all `false`; `tx.prepareReview` returns `{ supported: false }` with the known-kinds list rather than guessing.

---

## 3. Card Layout and Copy Invariants (`TxReviewCard`)

`src/ui/domain/tx-review/review-card.js` renders every review inside a strict one-screen budget enforced by `test/test-tx-review.mjs` [15] and `test/test-tx-review-card.mjs`:

1. **Title + Network Badge:** Operation verb and exact amount/target (e.g., `Send 0.0015 THRU`, `Register vault.thru for 2 years`, `Claim 0.00001 THRU from the faucet`, `Unrecognised transaction`) paired with the network badge (`Betanet`) once.
2. **Context Line:** Names the signing account and marks test networks without repeating the network label (`From Main account · test network`).
3. **Counterparty Block (when present):** Shows the matched contact or resolved `.thru`/`.id` label above the **full, unshortened 46-character Thru address** (`.tx-review-address`, `word-break: break-all` — never ellipsized).
4. **Money Table (`detail-table` #1):** `You pay` / `You receive`, `Network fee` (`about <amount> THRU`, `none` when declared `0` on a measured chain, or `not confirmed` / `not confirmed (paid in THRU)` when unmeasured), and `Total` (omitted when fee is zero or currencies differ).
5. **Non-Money Facts Table (`detail-table` #2, when present):** Operation-specific facts within per-decoder row budgets (`native-send` <= 3, `raw` <= 3, `domain-register` <= 4, `faucet-claim` <= 4, `token-transfer` <= 5, `domain-purchase` <= 5, `domain-claim` <= 5, `domain-renew` <= 6).
6. **Warnings:**
   - **Blocking warnings:** Always rendered on the open card (never folded) and force `state: 'blocked'` (`canConfirm: false`).
   - **Advisory warnings:** Capped at 2 on the open card (one plain sentence each); any additional advisories fold into `Details`.
7. **`Details` Disclosure:** Closed by default for decoded transactions; open by default for `raw` (`decode: 'unknown'`). Contains signing address, target program name/address/trust note, instruction summary, non-duplicated execution accounts, fee provenance, four-state simulation line (`Unavailable` on Thru today because `tx.simulate` returns `supported: false`), and raw-bytes toggle.
8. **Forbidden Copy (`Rule 17` & `Rule 24`):** No disclaimer essays, no predicted post-transaction balance (`assets.balanceAfter` must be `null`), no developer jargon (`provenance`, `base units`, `bindingHash`, `best-effort`), and no repository file paths or decision IDs.

---

## 4. Session Lifecycle, Error Registry, and Feedback Rules

- **Session Boundaries Invalidate Consent (`Rule 21`):** Wallet lock (manual or inactivity alarm via `walletService.lock()`), startup while locked, account switch, network switch, and wallet reset discard all prepared reviews (`tx_reviews::<networkId>`, `REVIEW_SCHEMA_VERSION = 1`, `MAX_RECORDS = 40`, per-network serialized write queue) and clear all in-memory consent tokens (`consent.js`). Enforced by `test/test-review-lifecycle.mjs`.
- **Single Error Registry:** `src/shared/tx-review/model.js` owns `REVIEW_ERROR_CODES` (`KIND_UNSUPPORTED`, `INVALID_INPUT`, `REVIEW_NOT_FOUND`, `REVIEW_EXPIRED`, `BINDING_MISMATCH`, `REVIEW_CONTEXT_CHANGED`, `REVIEW_BLOCKED`, `ACKNOWLEDGEMENT_REQUIRED`, `NOT_EXECUTABLE`, `REVIEW_UNAVAILABLE`, `REVIEW_INTERNAL`), `REVIEW_RECHECK_CODES` (`REVIEW_FEE_CHANGED`, `REVIEW_TOKEN_CHANGED`, `REVIEW_PRICE_CHANGED`, `REVIEW_EXPIRY_CHANGED`, `REVIEW_REGISTRAR_CHANGED`, `REVIEW_FAUCET_CHANGED`), and `STALE_REVIEW_CODES` (adding domain/context recheck failures `NAME_TAKEN`, `NAME_NOT_FOUND`, `LEASE_NOT_FOUND`, `LEASE_NOT_EXPIRED`, `NOT_NAME_OWNER`). Handler-level binding guards add `SEND_CONTEXT_CHANGED`, `REVIEW_ACCOUNT_CHANGED`, and `REVIEW_NETWORK_CHANGED`. `test/test-tx-review.mjs` [13] scans background services to ensure every thrown code is registered in `model.js` or `manifest.js`.
- **Single-Use vs Retry:** A successful submission discards `reviewId` so replaying it returns `REVIEW_NOT_FOUND` (stale). A definite validation/RPC failure retains `reviewId` so the user can retry the exact reviewed facts; a timeout is classified `uncertain` ("outcome unknown — check Activity") and never invites an immediate blind retry.
- **One Surface Per Event (`Rule 29`):** Submission opens one keyed `pending` `toast()` and updates that same toast in place (`success`, `error`, `warning`, or dismissed on cancel). Routes must clear `Banner` and field-validation lines before submitting and must never echo the submission verdict into multiple UI surfaces.

---

## 5. How to Add a New Value-Moving Operation

1. Ensure the underlying signing handler exists in `src/shared/contract/manifest.js` (`auth: 'signing'`) and `src/background/api-router.js` (`TRANSACTION_METHODS`).
2. Add a pure decoder in `src/shared/tx-review/decoders/<kind>.js` and register `<kind>` in `src/shared/tx-review/decoders/index.js`.
3. Add the matching `<kind>` fact-builder, recheck function, and `submit` mapping in `src/background/services/review/kinds.js`.
4. Call `bridge.send('tx.prepareReview', ...)` from the UI route, declare the confirm button **before** constructing `TxReviewCard` (wiring `onChange`), and submit exclusively via `submitReviewedReview({ ..., signal })` with a route-owned `AbortController`.
5. Add unit/router/card assertions in `test/test-tx-review.mjs`, `test/test-tx-review-card.mjs`, `test/test-signing-surface.mjs`, and `test/test-route-lifecycle.mjs`, plus a visual fixture in `scripts/preview-tx-review.fixtures.js`, then visually inspect `scripts/preview-tx-review.html` in a real browser (`Rule 14`).

---

## 6. Automated Coverage vs Open Verification

- **Automated (`IMPLEMENTED`, `TESTED`, 2026-11-19):** `test/test-tx-review.mjs` (206 checks), `test/test-tx-review-card.mjs` (68 checks), `test/test-review-lifecycle.mjs`, `test/test-review-consent.mjs`, `test/test-signing-surface.mjs`, and `test/test-route-lifecycle.mjs` (1,174 checks).
- **Visual Harness:** `node scripts/serve-dist.mjs --root . --port 8000` -> `scripts/preview-tx-review.html` (9 fixtures against real `dist/popup.css`, including 1 synthetic failed-simulation fixture).
- **Open (`UNVERIFIED`):** Real-Chrome pixel inspection of `TxReviewCard` at 400px popup and narrow/wide side-panel widths (`docs/MANUAL_SMOKE_CHECKLIST.md` §7), and live Betanet confirmation of the v32 reviewed signing flows. Historical PR/audit logs live in `docs/audits/2026-10-28-sync-audit.md`, `docs/audits/2026-10-29-v31-audit.md`, and `docs/audits/2026-10-30-review-lifecycle-audit.md`.
