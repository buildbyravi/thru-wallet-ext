# Gate 0 dossier — DeFi backend (betanet)

Date: 2026-10-05 · Gate: **G0 delivered; not closed** — closure needs owner sign-off plus the
live-chain rows below. Evidence classes: **LIVE** (closes build dependencies, R1) · **DOCS**
(official Thru docs, dated retrieval — admissible per B2) · **PKG** (pinned-package declaration)
· **REPO** (repo authority docs/tests) · **HIST** (historical observation; provenance kept,
never closes a current row). Entries live in `scripts/defi-evidence/`.

**Environment constraint:** this build sandbox cannot reach Thru endpoints
(`2026-10-05-environment-egress`). Every LIVE row is therefore OPEN here and has a named
script/probe to run on a network-reachable machine with throwaway accounts. Official-docs rows
were retrieved through the agent fetch tool (`2026-10-05-official-docs`,
`2026-10-05-package-surface`).

## Preconditions (B1)

| # | Status | Evidence |
| --- | --- | --- |
| P1 Backend signing policy in place; D5 step-up can layer without weakening | **TRUE (REPO)** | `auth:'signing'` enforced in `src/background/api-router.js`; `requirePasswordForSigning` **default OFF (session-only)** confirmed in code (`preferences-service.js`), AGENTS rule 10 and STATUS agree; changing it is password-gated via `settings.setSecurity`. Step-up is additive compute (`authRequirement` per review) enforced inside `intent.submit` through the router's own verification — no second auth path. |
| P2 Legacy launchpad quarantined; test green; rewrite deliberate | **TRUE (REPO)** | `test/test-launchpad-quarantine.mjs` 47 checks green. Its corpus is `src/**`, `build.mjs`, `src/manifest.json` + `dist/` — this folder and `scripts/defi-evidence/` are outside it. The deliberate rewrite (B16) ships **with the first code change (M0)**: that is the earliest the manifest/router may legally carry `launchpad.*`/`dex.*` names (S12's G1-exit phrasing assumed later; see DECISIONS_G0 C-4). |
| P3 Token balance/transfer path verified live | **FALSE — OPEN → CHAIN-BLOCKED at fresh-account funding (fault model refined 2026-10-08)** | BACKEND_GAPS C1/C2. Live runs 2026-10-06..08: spec-pinned reading (runtime/transaction-execution, 2026-10-08): fresh fee-payer accounts are created at PRE-EXECUTION with CREATION state proofs (exists:true is legitimate, spec-mandated — no poisoning possible: failed executions persist nonce+fee ONLY); the failures are EXECUTE-class INSIDE the faucet program on the claim leg (-765 revert+user -26n 10-06/07 → -767 VM fatal 10-08, drifting = chain being touched; Thru team engaged). PR build forensically exonerated (additive-only deltas, byte-identical claim route); long-activated accounts claim fine (owner's released 1.4.1). Disentangled 2026-10-08 vs the 'PR build broke the faucet' claim: faucet code is byte-identical vs released 1.4.1, all src/ deltas are additive-only, and **long-activated accounts (owner's released-1.4.1 wallet) claim FINE** — the regression is on the FRESH-ACTIVATION path, not the contract at large. Needs a Betanet-side fix (or an alternative pre-funded path) before the token leg can run. **Blocks G2 and every DeFi write path (B17).** |
| P4 DOM ratchet + layering cover new paths | **TRUE (REPO)** | 0 sinks across `src/`; `check-layering.mjs` already names `src/desktop/` and `src/features/` and forbids sibling-feature imports on the UI side. Background-side (`src/background/features/**`) sibling/vault bans are added in the B16 extension (MODULE_BOUNDARIES §8). |
| P5 Contract test runs both directions in `npm test` | **TRUE (REPO)** | `test/test-contract.mjs` in the chain; manifest↔router↔callers enforced. |

## Q1–Q26

| Q | Status | Finding / evidence | Closes with (LIVE) |
| --- | --- | --- | --- |
| Q1 Multi-program atomic tx | **PARTIAL (DOCS+PKG)** | Spec: one `program_pubkey` + one instruction blob per transaction; CPI exists (execution error attribution). `multicall` program declared in pinned package with address. Signer-privilege/failure semantics unknown. | Multi-call tx incl. deliberate failure; ABI read. Otherwise every multi-step flow is a multi-transaction step machine. |
| Q2 Nonce, validity, concurrency | **PARTIAL (DOCS)** | Header: `nonce` (strict exact-match, advanced at validation), `start_slot`, `expiry_after`, `chain_id`. Temporal window documented. Concurrent-submit/replacement behavior not documented. | Two same-account concurrent submits probe. Design anyway: single-flight per fee payer, short windows. |
| Q3 Fee derivation from units | **PARTIAL (DOCS+HIST)** | Resource model documented (1 CU/byte, syscall 512 CU, MU=4KB pages, state units from net bytes); fee collected at pre-execution, kept on failure. Unit→fee **pricing** not documented. HIST: native transfer = 1 base unit (2026-09-26, same program deployment); token fee unmeasured (C2). | `scripts/measure-fee.mjs` re-run across instruction types; `verify-token-transfer.mjs` for the token fee; `Cost.units` populated from measured tables (declared-basis label, C2b). |
| Q4 Account creation & state proofs | **PARTIAL (DOCS+REPO)** | Spec documents optional fee-payer state proof (CREATION/EXISTING/UPDATING). Repo uses NOOP-program activation (fee 0, nonce 0). Non-fee-payer account proofs (token/AMM init) not documented. | Create-and-use traces: token account init for never-registered owner (C1), AMM init proofs. |
| Q5 Simulation | **OPEN (DOCS-NEGATIVE)** | Repo stub `tx.simulate` declared-unsupported (C3). Fetched spec pages document no simulate endpoint. | Check gRPC query-service docs and live: simulate a known transfer; compare fidelity. Until then: decoder-only reviews, `UNSIMULATED`, no Max where fee unmeasured (R7). |
| Q6 Commitment/finality/status | **OPEN (HIST)** | HIST: ~6s block cadence (2026-09-29); block time optional. Finality depth, dropped-tx detection, status API not documented in fetched pages (gRPC query-service has slot metrics — lead). | Docs read + live observation; define the confirmation criterion used by the intent lifecycle. |
| Q7 Transport (gRPC/gRPC-Web, CORS, streaming) | **PARTIAL (DOCS)** | Official docs: gRPC for apps, gRPC-Web "for browser-based applications", streaming services exist. Browser CORS behavior, auth tokens, rate limits, terms: unknown. | Extension-page + service-worker fetch tests against betanet. v1 stays polling-only regardless (S7). |
| Q8 Structured events / ABI reflection | **PARTIAL (PKG+DOCS)** | VM has an event buffer (spec resources page); AMM package declares swap/mint/burn/pool-init/sync events; abi-manager subpath exists. Live fetch/depth/pagination unknown. | Fetch token+AMM events for a known tx on betanet. |
| Q9 Official/public indexer | **SUBSTRATE LIVE-PASS (on-node, 2026-10-07); indexer PACKAGE question OPEN** | No indexer endpoint/package in repo; BUT native history serves: `transactions.listForAccount` + `getStatus` verified live (q9-query-surface row); per-account history + program-activity + event enumeration all on-node. | Dedicated indexer framework EXISTS officially (`@thru/indexer@0.4.1`, 2026-09-30 — chain→Postgres, auto REST API; + `@thru/replay@0.4.1`); a hosted public endpoint is not observed (self-host model). Discovery/charts honest-fallback story stays until data exists (mints) — reason shifts from substrate-absence to data-absence. |
| Q10 Address format & derivations | **PARTIAL (PKG+REPO)** | Identity strings observed (`ta…` custom-alphabet). `token.deriveTokenAccount`/`token.deriveAddress` golden-tested vs pinned binding (REPO). Pool derivation from sorted mint pair + fee bps declared (PKG). Launch-account derivation: n/a (Q20). Cross-chain-paste hazard rules unwritten. | Live derivation vs index values on known objects (R3). |
| Q11 Mint model & authorities | **PARTIAL (PKG)** | Builders: init-mint (decimals, mint authority, opt freeze authority, ticker, seed, state proof), init-account, mint-to, transfer. Burn/close/freeze/thaw **event** types exist; no corresponding instruction builders seen in package surface. **Whether authority can be revoked after minting is unknown** — this decides the launchpad authority policy (B8). | Read live mints + ABI; if no set-authority instruction exists, templates state it and `MINT_AUTHORITY_HELD` is always disclosed. |
| Q12 Token accounts & canonical derivation | **PARTIAL (REPO+PKG)** | Canonical derivation verified against binding locally; optional seeds exist (multiple accounts per owner+mint possible). Never-registered-owner acceptance: **OPEN (C1)**. | `scripts/verify-token-transfer.mjs`; define the wallet canonical-account rule from the result. |
| Q13 Token transfer path verified live | **OPEN = P3** | C1 (recipient-owner acceptance) + C2 (token-program fee) open. 2026-10-06: chain finding (NOOP activation reverts) captured; probe now mirrors the wallet's faucet-first pattern. | `npm run test:live` on a networked host (includes `verify-token-transfer.mjs`). **Nothing else ships until this closes (B2).** |
| Q14 AMM deployment/management per network | **LIVE-PASS for deployment (2026-10-06); management OPEN** | `taAMM…` DEPLOYED on betanet (battery q14 row, owner host; registry record upgraded to deployment-observed — trust stays `unverified`, R4). Version, upgrade authority, pool-creation control: still unknown. | Manager/abi-manager inspection for management facts. Deployment-closed; management-open ⇒ swap/pools remain unsupported, launches mint-only. |
| Q15 Pool model & fees | **LIVE-NEGATIVE (nothing to parse yet) / PKG for constants** | Constants declared (default/max fee bps, minimum liquidity, LP decimals); `parseAmmPoolMetadata` available and probe-wired (`scripts/probe-amm.mjs --mints/--pool`). Model, tiers, destination, pause powers, oracle/TWAP: unknown — and **no pool can exist to parse until a mint deploys** (P3 blocked at the faucet rung, 2026-10-06). | One `--mints` run after P3 unblocks + a mint deploys. Unknown model ⇒ no quote. |
| Q16 AMM instructions & bounds | **PARTIAL (PKG)** | Builders declared: init pool, add, withdraw, exact-in swap; swap/add/withdraw carry minimum-output bounds per prompt's earlier listing and constant exports. Zero = no protection ⇒ R17 refusal is a hard build rule. | Traces on betanet; error-code table from `AMM_ERROR_LABELS` vs live. |
| Q17 Native THRU in pools (wrapped?) | **OPEN (PKG-only)** | `wthru` program + mint/vault state addresses declared. Whether pools use wrapped THRU or native directly: unknown. Wrapping would be an extra priced step. | Inspect a THRU pair once pools exist. |
| Q18 Pool discovery | **SUBSTRATE LIVE-PASS (2026-10-07); enumeration probe READIED, 0 pools expected** | Derivation proven (sorted pair+fee); global substrate verified live: `listForAccount(amm program)` serves + events enumerable. `probe-amm.mjs --discover` (battery `q18-amm-pool-discovery`) enumerates activity → official-parser-verified pool candidates → derivation cross-check. | Run after P3 unblocks gives pool universe live; today: 0 = honest absence, substrate green. |
| Q19 Quote parity | **OPEN** | Quote math must match the program (fee rounding, dust, max, empty side). ≥12 reference vectors required by spec. | Vectors from program spec/tests; differential integer recomputation; parity gate blocks swap enablement. |
| Q20 Launch/curve program exists? | **PKG-NEGATIVE; live search OPEN** | No launch/curve/bonding-curve program in the pinned package's export map or bootstrap-addresses list (17 managed programs enumerated). | Program-directory/docs search on reachable machine. Negative ⇒ launchpad = mint-only + direct-pool (D1). |
| Q21 Curve/launch mechanics | **OPEN (blocked on Q20)** | — | ABI + traces iff a program is found; each unknown mechanic keeps its UI section unsupported. |
| Q22 THRU/USD source | **LIVE-NEGATIVE (2026-10-06)** | Oracle program declared; **no thru-usd feed account on betanet** (`[not_found]` via `probe-oracle-feed.mjs` on owner's host). No price service in repo. | USD stays native-only (D8) until a feed address is created and verified. |
| Q23 dApp provider expectations | **ANSWERED-REPO (negative for v1)** | No extension/BYO-signer contract published that repo could verify; hosted iframe != extension provider (BACKEND_GAPS C4). S14 keeps providers out of v1. | None — out of scope; revisit when Thru publishes. |
| Q24 Key types supported | **ANSWERED-REPO** | Mnemonic HD + imported private keys ship; passkey = feasibility spike done, implementation not started; hardware none. Unsupported key types get no DeFi. | Re-check when passkey probes are green-lit. |
| Q25 Licenses & terms | **PARTIAL (PKG)** | Both pinned packages declare `license: Apache-2.0` and ship **no LICENSE file** and **no install scripts** (`2026-10-05-package-surface`). Third-party README claim of proprietary licensing remains unresolved. Public-RPC terms for a commercial wallet: unfetched. | Pull license text from the source registry/GitHub mirror; read RPC terms; block distribution until cleared (B13). |
| Q26 Package names/versions | **ANSWERED-PKG** | Runtime deps are exactly `@thru/sdk@0.4.1` + `@thru/programs@0.4.1` (verified by collector incl. export maps); rename/deprecation history needs npm registry metadata. | Registry metadata check on any dependent machine; adapter layer (D-007) contains renames. |

## Reason mapping (prompt B2 table) — current disposition

`PROGRAM_NOT_FOUND` → Q14/Q20 open · `PROGRAM_NOT_VERIFIED` → all records below `verifiedLive` (today: everything except token@goldenTested) · `PROGRAM_CHANGED` → watch not built yet (build-order step 3) · `NO_QUOTE_PARITY` → Q19 open · `NO_SIMULATION` → Q5/C3 · `NO_INDEXER` → Q9 open + D2 default · `INDEX_STALE` → n/a until a feed exists · `NETWORK_NOT_SUPPORTED`/`NETWORK_RESET` → registry rows absent / genesis binding pending · `CUSTOM_NETWORK` → D14 (enforced) · `FLAG_OFF` → flags not yet created (first code change) · `KILL_SWITCH` → no publisher provided · `FEED_MISSING` → no publisher provided · `LAUNCH_MODEL_UNAVAILABLE` → Q20 package-negative · `TOKEN_PATH_UNVERIFIED` → Q13 = P3 OPEN · `DEPENDENCY_UNVERIFIED` → Q1–Q4 open · `NO_LIQUIDITY` → no pools verified yet · `UNKNOWN` → none today; any unknown error gets classified before use.

## Leads disposition ("Leads already in hand", prompt B2)

Fees/envelope → folded into Q2/Q3 (DOCS confirmed the model, pricing still live). Accounts → Q4.
Simulation → Q5. Transport → Q6/Q7. Events/ABIs → Q8 (PKG confirmed). Indexer → Q9.
Mints → Q11 (PKG confirmed builder list; authority-revocation answered only by ABI/live read).
AMM → Q14–Q19 (PKG confirmed builders/constants; everything else live). Native THRU → Q17 (wthru
constants recorded). Launch programs → Q20 (PKG negative confirmed). Price → Q22.
Licences/names → Q25/Q26 (PKG partial recorded: Apache-2.0 declared, no LICENSE file, no install
scripts). Chain resets → genesis binding recorded as pending in the registry seed.

## Next actions (in order)

1. **Owner sign-off on G0** (this dossier, the seeds, DECISIONS_G0), or corrections via CCR.
2. **Live evidence session on a network-reachable machine** (throwaway accounts only):
   `verify-token-transfer.mjs` (closes Q12/Q13/P3 + fee row of Q3) · `token-lab.mjs` (Q11/Q12)
   · `measure-fee.mjs` (Q3) · `verify-live-e2e.mjs` (Q2/Q4/Q6 wallet-core step 4 in the same
   pass) · AMM program-account probe for Q14–Q15 (new script, read-only) · `probe-oracle-feed.mjs`
   (Q22) · program-directory check for Q20. Each run appends a `live-chain` entry to
   `scripts/defi-evidence/` and updates the registry/capability seeds + this dossier **in the
   same commit**.
3. **M0 contract drop** (S13): manifest v17 (READ) + v18 (EXEC) entries, schemas, honest stubs,
   fixtures, presets, intent scripts, code inventory; the deliberate quarantine rewrite (B16) and
   DeFi flags (all off) land in that same change.
