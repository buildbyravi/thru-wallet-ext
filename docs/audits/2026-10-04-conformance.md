# Production-rules conformance audit — 2026-10-04

**Scope:** branch `arena/01a10602-thru-wallet-ext` at `7883219`. Audited the current repository
against the permanent production-engineering rules (mainnet standard, single source of truth,
security-sensitive reuse, boundaries, network/transaction/storage safety, legacy cleanup,
documentation truth). Read every maintained governance document, inspected `src/`, `test/`,
`scripts/`, `build.mjs`, and `src/manifest.json`, and recorded the baseline before any edit.
This is a source-level audit; no live-chain transaction, real-Chrome lifecycle/layout test, or
external security audit was performed.

**Result at audit time:** no P0 fund-loss/security defect is confirmed. The prior (2026-10-03)
remediations MR-01…MR-07 are all present in source and covered by tests. The findings below are
documentation-truth defects (including two that misstate the signing security policy), one
fee-provenance mislabel in code, and two dead-code leftovers from completed migrations.
**External audit remains required** before any Mainnet-readiness claim; nothing here is one.

### Baseline recorded before any modification

```text
npm run build       PASS — background.bundle.js 1.0mb, popup.bundle.js 190.0kb, popup.css 68.9kb; no warnings
npm test            PASS — derivation 16/16; QR 15/15; layering 80 files / 0 violations / 0 DOM sinks;
                    CSP pass; routes 14/14; CSS nesting pass; launchpad quarantine 47/47;
                    contract 80/80; security-checks 20; DOM/refs 130/130; route lifecycle 1017/1017;
                    storage migrations, vault, thru-client, token-balances, balance-network,
                    history-cache, history-block-time, registration, api-router, auto-lock all pass
npm audit --omit=dev  PASS — 0 vulnerabilities
git diff --check     clean
Contract v16, 81 methods; 14 routes; @thru/sdk and @thru/programs exact-pinned 0.4.1;
derivation vectors record verification against 0.4.1 with unchanged golden addresses.
```

### 1. Passing rules (verified, no action)

| Rule area | Evidence |
| --- | --- |
| Mainnet engineering standard | AGENTS.md codifies it; no "testnet-only/temporary" escape hatches in shipped code; SECURITY.md keeps an honest betanet scope notice rather than overclaiming. |
| SDK version safety | `package.json` exact-pins `@thru/sdk`/`@thru/programs` at 0.4.1; `npm ci` is the CI install; derivation goldens pin `sdkVersion: '0.4.1'` and fail on drift. |
| Golden vectors | 16 derivation checks pass unchanged; transaction/token wire goldens pinned in `test-thru-client.mjs`; no expected value was changed to make anything pass. |
| Frontend/backend boundary | One seam (`bridge.send`); `check-layering.mjs` enforces import rules and the `chrome.runtime.sendMessage` allowlist (UI→background: `src/ui/app/bridge.js` only; background→UI: `event-service.js` only); 0 violations across 80 files. |
| Thru SDK boundary | Only `src/lib/networks.js`, `src/lib/thru-client.js`, `src/lib/vault.js` import `@thru/*`. No SDK leak into UI/application logic. |
| Network safety | Stable network ids (not display names); `network-scope.js` GLOBAL/SCOPED key sets asserted in tests; balances/pending/tokens/history network-scoped; keys/labels/contacts global; v7 custom-network quarantine background-enforced with self-healing. |
| Transaction safety | v16 retired the unbound send paths; checked sends bind reviewed account+network before and after preflight; signing-guard locks network mutation for the whole operation; duplicate protection (synchronous in-flight set + persisted pending + 30s window + mint-aware keying); track-at-submission; timeout ≠ failure; `confirmed` only on positive chain evidence. |
| Storage safety | Vault envelope v1 (KDF params pinned per record) + V1→V2 migration; preferences v1 (future versions fail closed); contacts v1; pending-tx v1 envelope + per-network serialized writes; labels versioned; balance/history are network-scoped rebuildable caches with chain-identity checks. |
| DOM/secret safety | 0 injection sinks across all of `src/` (vendored QR excluded); no `localStorage`/`sessionStorage` in `src/`; secrets never in URLs/`data-*`/console (route-lifecycle sweeps assert it); CSP `default-src 'none'` with `connect-src` exactly matching enabled networks. |
| Launchpad/DEX quarantine | Tree deleted, not flagged; 47-check quarantine test covers source, manifest, flags, routes, and a real `dist/` build. |
| No fake implementations | `estimateFee` returns `supported:false` where unmeasured; `simulate` unsupported; token reads distinguish proven-zero vs unknown; `feeCharged: false` distinguishes declared from charged. |
| One UI stack | Legacy tree deleted; 14 routes registered, mounted, reachable; `check-routes.mjs` both directions. |
| Observability | Diagnostics log method/error class/network id/addresses only; all 15 `console.*` sites in `src/` reviewed — none log secrets. |

### 2–3. Partial / failing rules (findings)

**F-01 — P1 — README misstates the signing security policy.**
`README.md` "Security basics" says "Signing requires password re-authentication by default.
Session-only signing is an explicit user setting and is less secure." The shipped default is the
opposite (`requirePasswordForSigning: false`; password re-auth is the explicit password-gated
opt-in), as decided in `docs/DECISIONS.md` D-003 and stated correctly in the same README's
"Current state" section, STATUS_AND_ROADMAP, and BUILD_SPEC. A user reading Security basics
forms a false belief about what protects an unattended unlocked wallet. Files: `README.md`.

**F-02 — P1 — `llms.txt` (the agent brief) states wrong current facts.**
It claims contract version 8 (actual v16), that a stale active network id "self-heals to
Alphanet" (actual: Betanet), that password re-authentication is required by default (actual:
session-only default per D-003), the hosted-wallet URL `wallet.thru.org/embedded` (actual:
`app.tid.sh/embedded`, per DOCS_INDEX/BUILD_SPEC), and lists shipped work (token transfer,
contacts UI, account pin/hide/order) as future P0s. This file exists to stop agents acting on
wrong context. Files: `llms.txt`.

**F-03 — P2 — `docs/PROJECT_LEDGER.md` identifiers are stale and self-contradictory.**
§1 says contract v12 while §4 of the same file says v16 (actual v16); SDK "0.3.16" in §1/§4/§8
(actual 0.4.1); "Alphanet and Localnet enabled" in §1/§8 (actual: Betanet enabled, others
declared-disabled); stale baseline commit and test counts (77/904 vs current 80/1017); the §3
milestone table stops at v12, omiting v13 (faucet auth change), v14 (`token.readMint`), v15
(`tx.checkDuplicate`/`allowDuplicate`), v16 (legacy send retirement). The ledger is the
identifier authority; every wrong number here can propagate. Files: `docs/PROJECT_LEDGER.md`.

**F-04 — P2 — `SECURITY.md` permission audit omits a shipped permission.**
The manifest requests five permissions; SECURITY.md says "four" and its audit table omits
`notifications` (used by `history-service.js` for confirmed/failed transfer desktop
notifications). The public security policy must justify every requested permission. Files:
`SECURITY.md`.

**F-05 — P2 — fee provenance is mislabeled by a dead branch.**
`tx-service.estimateFee` computes `source: network.environment === 'devnet' ? 'measured' :
'assumed'`, but no declared network has `environment: 'devnet'` (values are
testnet/local/mainnet), so the 'measured' branch is dead and Betanet reports `assumed`. The
Betanet fee is recorded as MEASURED (managed-genesis chain 2026-09-26, the same program
deployment Betanet runs) in `networks.js`, and the route-lifecycle fixture already returns
`source: 'measured'`. Users therefore see "Network fee: … (assumed, not measured on this
network)" on Betanet — a false statement about a fee in a wallet. Also in the same function: a
stale first JSDoc block ("Blocked on… hardcoded 10_000… as a guess") contradicts the accurate
second block beneath it. Violates standing invariant #9 (network-specific values belong in the
network config). Files: `src/lib/networks.js`, `src/background/services/tx-service.js`,
`docs/BACKEND_GAPS.md` C2 wording.

**F-06 — P3 — stale references to the deleted legacy bridge in rule text.**
AGENTS.md hard rule 3 still names `src/ui/bridge.js` (legacy) as a permitted sendMessage owner;
that file is deleted and `check-layering.mjs`'s actual allowlist is `src/ui/app/bridge.js` +
`event-service.js` (its own comment repeats the stale path). STATUS_AND_ROADMAP Step 5 states
"are exact-pinned at 0.3.16" as present tense for a historical 2026-09-18 pass. Files:
`AGENTS.md`, `scripts/check-layering.mjs` (comment only), `docs/STATUS_AND_ROADMAP.md`.

**F-07 — P4 — dead duplicate `isValidThruAddress` in `networks.js`.**
`src/lib/networks.js:210` duplicates `src/lib/thru-client.js:116` byte-for-byte. Every importer
(services and tests) uses the thru-client version; the networks.js export has zero references.
Category: dead code (the authoritative implementation stays). Files: `src/lib/networks.js`.

**F-08 — P4 — strangler-migration compatibility surface in `boot.js` has zero callers.**
`boot()` still accepts `legacyFallback`/`onMigratedRoute`, carries "routes migrated to the new
stack"/"unmigrated hashes" comments, logs "leaving the legacy UI in place" and "Migrated
routes:". The migration is complete (one stack, no legacy tree, no caller passes either option),
so the deletion condition defined for this temporary layer is met. Simplify while preserving
unknown-path→fallback and chrome-visibility behavior. Files: `src/ui/app/boot.js`,
`CONTEXT.md` §2 sentence describing the fallback callback.

### 4. Duplicate code found (classification per rule 6)

| Candidate | Class | Action |
| --- | --- | --- |
| `isValidThruAddress` (networks.js vs thru-client.js) | E — dead code | Delete networks.js copy (F-07). |
| `parseThruAmount` vs `parseTokenAmount`, `formatThru` vs `formatTokenAmount` | B — intentionally different scale, same discipline, one module | None. |
| Program-id constants imported in both `networks.js` and `thru-client.js` | C — config definition vs adapter fallback default (documented in v7 quarantine rationale) | None. |
| `token-drawer.js` short-symbol truncation vs `truncateAddress` | B — different input/length semantics | None. |
| Address validation split (UI loose shape check in `refs.js`, authoritative checksum in background) | C — deliberate layering (`refs.js` documents why) | None. |

### 5. Legacy code found

Dead: `isValidThruAddress` (networks.js). Transitional-with-zero-callers: `boot.js`
legacyFallback/onMigratedRoute surface (F-08). No other dead files, routes, CSS, build entries,
or duplicate UI implementations were found: `src/ui/` contains exactly the one route stack;
`scripts/` probe/verify scripts are documented manual live-chain tools, not shipped code;
`docs/handoff/`, `docs/reference/`, `docs/archive/` are frozen per DOCS_INDEX.

### 6. Security risks

None new at P0/P1 severity in code. The security-relevant findings are the two policy-truth
defects (F-01/F-02: a user or agent believing password-per-sign is active when it is not) and
the fee-provenance mislabel (F-05, conservative direction but a false user-facing claim). All
previously identified risks (MR-01…MR-07) remain remediated in source with deterministic tests;
live-network and real-Chrome verification items remain open exactly as listed in
STATUS_AND_ROADMAP §1 and PROJECT_LEDGER §5. External audit: still required, not started.

### 7. Documentation contradictions

F-01, F-02, F-03, F-04, F-06 above, plus: `DOCS_INDEX.md`'s AUDIT_REPORT row will be refreshed
with this report. Historical documents (AUDIT_REPORT 2026-09-18 section, SEND_PATH_AUDIT,
DEFECT_LOG) correctly label their own baselines and are not contradictions. SECURITY.md's
betanet scope notice is a factual limitation, retained deliberately.

### 8. SDK/protocol boundary risks

Contained: all `@thru/*` imports live in `src/lib/`. Pinned exactly (0.4.1) with vector
provenance recorded. No SDK churn risk identified this pass; upgrade protocol (changelog review,
goldens, migration tests) is documented and unchanged. Remaining protocol unknowns stay in
BACKEND_GAPS §2 / STATUS Step 8 — nothing new observed.

### 9. Network risks

No state-leak path found: network identity is id-based; scoped/global key sets are test-asserted;
the signing guard blocks network mutation during signing; stale active ids self-heal; CSP and
enabled networks are two-way checked. The fee-provenance defect (F-05) is the only
network-config finding, and it is a labeling defect, not a binding/scoping one.

### 10. Test gaps

No regression test asserts fee `source` provenance (the lifecycle fixture hardcodes 'measured'
and nothing compares it to the service). No test covers `estimateFee`'s per-network source at
all — one will be added with F-05. All other gaps are the previously documented, still-open
browser/live-chain boundaries (MANUAL_SMOKE_CHECKLIST; live v12 activation, token transfer
owner/fee, block-time latency, charged-fee source, explorer route, MV3 suspension). This audit
did not and cannot close those.

### 11. Prioritized remediation plan (ordered work units)

1. **U1 (P1, docs/security truth):** fix README Security basics + rewrite llms.txt current-state
   to match shipped truth (v16, Betanet, D-003 signing default, hosted URL, P0 list).
2. **U2 (P2, identifiers + public policy):** refresh PROJECT_LEDGER identifiers/milestones and
   test evidence; add `notifications` to SECURITY.md's permission audit (five permissions).
3. **U3 (P2, code):** move fee provenance into the network config (`feeSource`), make
   `estimateFee` read it, remove the dead `devnet` branch and the stale duplicate JSDoc, align
   BACKEND_GAPS C2 wording, add a per-network source regression test.
4. **U4 (P3, rule text):** correct AGENTS.md rule 3 and the check-layering comment to the real
   allowlist; mark STATUS Step 5's 0.3.16 statement as historical; refresh DOCS_INDEX
   AUDIT_REPORT row and date.
5. **U5 (P4, legacy cleanup):** delete the dead `isValidThruAddress` from networks.js (after
   full reference sweep); remove boot.js's dead migration surface; update the CONTEXT.md
   sentence that describes it.

Each unit: `npm run build && npm test` before and after, one logical commit, no mixing.
Rules that are already satisfied are deliberately left untouched.

### Remediation update — 2026-10-04

All five units were completed on branch `arena/01a10602-thru-wallet-ext`, one commit each:

- **U1 (F-01/F-02):** README Security basics now states the session-only default with the
  password-gated opt-in (D-003) and the current hosted-wallet URL; llms.txt rewritten to
  current truth (v16/81 methods, Betanet, checked sends, 0.4.1 pins, actual open P0 work).
- **U2 (F-03/F-04):** PROJECT_LEDGER refreshed (v16, 81 methods, 0.4.1, Betanet enabled,
  baseline `7883219`, milestones v13–v16, current test counts); SECURITY.md permission audit
  now justifies all five manifest permissions including `notifications`.
- **U3 (F-05):** fee provenance is an explicit per-network `feeSource` field in
  `src/lib/networks.js` (`'measured'` Betanet, `'assumed'` Localnet, null where unmeasured);
  `estimateFee` reads it instead of the dead `environment === 'devnet'` branch; the stale
  pre-measurement JSDoc block is gone; the manifest `returns` prose and BACKEND_GAPS C2 match
  the shipped response. Regression test `test-api-router.mjs [13]` asserts measured/assumed/
  unsupported per network and restores shipped network state; verified to fail against the old
  expression.
- **U4 (F-06):** AGENTS.md rule 3 and the check-layering comment name only the real
  sendMessage owners; STATUS Step 5 records 0.3.16 as history with the current 0.4.1 pin;
  DOCS_INDEX date and AUDIT_REPORT row refreshed.
- **U5 (F-07/F-08):** dead duplicate `isValidThruAddress` deleted from networks.js (importer/
  build/manifest/test sweep first; unused `Pubkey` import removed with it); boot.js's
  zero-caller `legacyFallback`/`onMigratedRoute` migration surface removed with unknown-path
  redirect and chrome-visibility behavior preserved; check-routes' never-used
  `legacyFallbackPaths` scan deleted; CONTEXT.md updated.

**Residual verification:** remediation is IMPLEMENTED and TESTED locally (`npm run build` and
`npm test` green after every unit and on the final tree). Nothing here closes the open
real-browser or live-chain checks in `docs/MANUAL_SMOKE_CHECKLIST.md` and
`docs/STATUS_AND_ROADMAP.md`, and an external audit remains **EXTERNAL AUDIT REQUIRED**.

---

*The five-category mainnet-readiness gate classification produced by this audit is maintained as
current state in [`docs/AUDIT_REPORT.md`](../AUDIT_REPORT.md) ("Mainnet-readiness gates"), not in
this dated record, so it can be re-verified and closed without editing audit history.*
