# Gate 0 decisions — PROJECT INPUTS as answered, recon corrections, CCR candidates

Date: 2026-10-05. The owner left every PROJECT INPUTS field blank → **all defaults apply**
("blank means default"). Corrections found at recon are listed explicitly (S0: report every
conflict, never resolve one silently).

## 1. Networks

`betanet` is the only network in scope (only enabled network in the repo). Mainnet joins when
declared and enabled; custom networks never get DeFi (D14), enforced by the contract-v7
quarantine. Genesis binding: pending (registry seed).

## 2. Names and operator details (defaults kept)

Desktop tab name: **Desktop** (`build.mjs` reserves `desktop.html` — confirmed line 44 comment;
`check-layering.mjs` already anticipates `src/desktop/`). Popup tiles: Swap, Markets, Launchpad.
Operator name / report URL / terms & privacy URLs: **none provided** → disclosures and the D12
publishing-process document name the operator as "project operator, TBD" until supplied; nothing
ships requiring them before that. This is a CCR-adjacent gap for the owner, not a guessed value.

## 3. Services (defaults kept → features degrade honestly)

No market read API, no image proxy, no feed publisher, no feed key ids. Consequences, per the
prompt's own defaults: `discovery` and `charts` stay `NO_INDEXER` (D2 default path allows a
project API later, gated by D16 privacy change); images are placeholders/identicons only (D3);
no signed feeds at launch — the verified-list/kill-switch layer is built to tolerate an absent
publisher and falls back to the stricter unverified-asset policy (`FEED_MISSING`); no USD (D8,
until Q22).

## 4. Decisions D1–D16 (defaults kept in full)

D1 official/verified programs only · D2 direct-chain for money-critical reads; project API only
if dossier finds no official index, and only after D16 · D3 placeholders · D4 separate Desktop
tab · D5 wallet signing policy + DeFi step-up classes, `defiAlwaysRequirePassword` as a
password-gated security field · D6 per-step auth · D7 no monetisation · D8 no USD for non-core
assets · D9 contract versions — **corrected, see C-1** · D10 Chromium first · D11 no telemetry,
local diagnostics export · D12 project-curated signed list with public criteria (publisher TBD —
see §2) · D13 terms + risk acknowledgement at first DeFi use (copy owed by frontend; no counsel
conclusions in code) · D14 custom RPC = no DeFi · D15 in-house SVG/canvas charts via the DOM kit,
no charting dependency · D16 any server/feed/proxy is a `PRIVACY.md` + store-listing change made
before it ships.

## 5. Starting limits (defaults kept)

Recorded in `scripts/defi-evidence/betanet.capability-matrix.json` `limits` (quoteTtl 15s,
preparedTtl 2min, slippage 50/300/2000 bps default/warn/cap, price impact 500/1500 bps warn/block,
USD floor TBD per network, 1000 candles, 5s poll floor). They are proposals for the product
owner, not facts.

## 6. Out of scope

S14 untouched — nothing written "include". Perps/prediction remain non-goals even where the
pinned package ships bindings (`./perp`, `./clob`).

---

## Recon corrections (applied; parenthetical prompt text corrected, not silently followed)

- **C-1 Contract identifiers.** Prompt assumed "contract 15, 83 methods … so 16 and 17". Repo
  reality: **contract v16, 81 methods** (manifest import, 2026-10-05). DeFi takes **READ = 17,
  EXEC = 18**. Bump rule unchanged: reads first, execution after.
- **C-2 Guides 09–11 absent.** No such documents exist in this checkout; their assumed methods
  never existed here. Closest ancestors are the already-frozen `docs/archive/` originals
  (DOCS_INDEX §5). The prompt's corrections table for those guides is adopted as binding rules
  for this workstream (recorded in `README.md` "Boundaries"); nothing to edit in frozen files.
- **C-3 Sync-read set reality.** Prompt assumed a general polled-read exemption. Reality:
  `SYNC_READ_METHODS = {tx.getPending, tx.reconcilePending}` only. Every DeFi polled read must be
  registered there at G1 (B5/B12) so page polling never counts as user activity for auto-lock.
- **C-4 Quarantine sequencing.** The 47-check quarantine asserts *zero* `launchpad|dex|prediction`
  references across `src/**`, `build.mjs`, `src/manifest.json`, `dist/`. M0 cannot add manifest
  entries without it → the deliberate B16 rewrite (gated-enable invariants: feature code only
  under feature dirs/registered entries, routes unreachable while flags off, no URL/storage flag
  override, no fixtures/mocks/gallery in `dist/`) ships **in the same change as M0**, earlier
  than S12's G1-exit line implies. Verified to fail when the legacy surface is restored.
- **C-5 Flags module shape.** `src/shared/flags.js` currently holds only `DEBUG_ROUTING` with a
  query override; the quarantine asserts product surfaces can never be flag/URL-enabled. DeFi
  flags join as build-time constants with **no** query/storage override path, in the M0 change.
- **C-6 `token.deploy` drift.** The `ticker`/`symbol` + 64-hex-seed drift is already *bridged*
  in `src/background/services/token-service.js` (both spellings passed to the client). B8 still
  requires reconciling it to one spelling before launch work builds on it; the existing method
  stays unchanged for compatibility (append-only contract).
- **C-7 Session logistics.** All work lands on branch `arena/01a10804-thru-wallet-ext`
  (session-fixed); PR #19 accumulates the G0 commits alongside the earlier smoke-record commit.
  `node_modules` does not persist across sandbox turns — re-run `npm ci` per session.

## CCR candidates (for the human to relay to the frontend builder; none blocking)

1. **PATCH (clarification):** SHARED CONTRACT S0 "the repo was at CONTRACT_VERSION 15 (83,
   …so 16 and 17)" → actual v16/81; READ=17, EXEC=18. Numbers move; the rule does not.
2. **PATCH (clarification):** S12/G1-exit "quarantine test rewritten deliberately" happens at
   M0 (first manifest change), not G1 — sequencing note only.
3. **INFO:** operator identity fields (§2 names/URLs) still blank; both builders should treat
   operator-referencing copy as placeholder until supplied.

## Gate status (2026-10-05, post-G0)

- **G0: closed by owner direction.** The owner's review agent ran the repo path (contract
  integrity, quarantine 47/47 at the time, layering, collector, full tests incl. lifecycle
  1017/1017) green on their machine and the owner directed M0. The one owner-side fix
  (`pathToFileURL` in the evidence collector, commit `ea628cb`) is incorporated.
- **M0: delivered 2026-10-05** on schedule with this file's corrections — READ=17 / EXEC=18,
  43 methods, `defi-schema.js` as the machine schema, fixtures under `test/fixtures/defi/`
  (outside the shipped corpus), the B16 quarantine rewrite in the same commit as the first
  dex/launchpad-named code, and the quarantine corpus left alone otherwise. Inventory:
  `docs/defi/M0_INVENTORY.md`. Closes with owner sign-off after the frontend-team contract
  review; P3 (`verify-token-transfer.mjs` on a reachable machine) is independent of M0.
- **M0 owner-side verification (2026-10-05):** the owner's local forensic audit agent fetched
  `bddfef6` (ff-only) and re-ran the repo path on Windows: `npm run build` PASS, full `npm test`
  PASS (22 suites incl. contract 130/130, quarantine 66/66, DeFi M0 98/98, lifecycle 1017/1017),
  `scripts/check-layering.mjs` 93 files / 0 violations / 0 sinks, `git diff --check` clean.
  Their report confirms append-only v17/v18 (81 -> 124), the single signing path
  (`intent.submit` + signing guard + `defiAlwaysRequirePassword`), master-flag dominance with
  no URL/storage override, pre-auth `INVALID_INPUT` validation, and the rewritten quarantine
  allowing only the allowlisted backend surface. Stream/API errors in their agent log were the
  agent tool's own connectivity; every repo command succeeded. Audit verdict: no repo defects
  found; "formal M0 sign-off" listed as the owner's pending decision.
- **M0: CLOSED 2026-10-05 by owner sign-off.** The owner answered the sign-off question in the
  review channel: "Sign off M0 — start G1." The forensic audit of `bddfef6` is the verification
  of record; the audit record itself shipped in `2718b70`.
- **G1 in progress (same day): G1-A delivered** — the DeFi registry service
  (`src/background/services/registry-service.js`) now owns program/feed/feature records and
  capability derivation; program/feed/risk/gating read through it. B3 genesis binding is wired
  STATELESS: the seed pins the chain fingerprint it was evidence-verified against, the runtime
  re-derives the fingerprint via `history-service.chainFingerprint`, and a managed genesis swap
  downgrades every seed-derived capability to NETWORK_RESET with exactly one
  `capabilitiesChanged` event per transition — no storage on the read path. Record:
  `docs/defi/G1_REGISTRY.md`. Gate: `test/test-defi-registry.mjs` (27/27).
- **G1-A verified by owner-side audit (2026-10-05, ff-only `1997838`):** their agent re-ran
  fetch/build/`npm test`/layering/registry gate — all green (23 suites, registry 27/27,
  contract 130/130, quarantine 66/66, M0 98/98, lifecycle 1017/1017, build clean). Owner
  directed: proceed straight to G1-B.
- **G1-B delivered 2026-10-06:** SignedFeedRecord verification + narrowing
  (`src/background/services/defi/feed-record.js`, empty-by-evidence `FEED_POLICY`, registry
  verify-at-intake + sync narrowing, `feedChanged` events). Ladder order locked:
  FLAG_OFF → KILL_SWITCH/FEED_MISSING → dossier(+B3 reset); feeds narrow, never widen; records
  bind networkId + genesis fingerprint. No transport and no publisher yet — both arrive only
  through the evidence chain. Record: `docs/defi/G1_FEED.md`. Gate: `test/test-defi-feed.mjs`
  (35/35).
- **G1-B verified by owner-side audit (2026-10-06, ff-only `c246b67`):** their agent re-ran
  build/`npm test`/feed gate/layering — all green (24 suites, feed 35/35, layering 96 files/0
  violations, 0 DOM sinks). Crypto containment (feed-crypto adapter), pinning-before-signature
  order, one-publisher-one-vote, and narrow-never-widen all confirmed. Owner directed: proceed
  to G1-C.
- **G1-C delivered 2026-10-06:** market read layer — coalescing read cache (one in-flight per
  key, TTL honesty, errors uncached, B3 binding by key, bounded, in-memory only) + per-slice
  assembly with chain-before-index ladders and honest S10 fallbacks
  (`services/defi/read-cache.js`, `services/defi/market-reads.js`), wired into market-service
  past-gate. Wire byte-identical to M0 (gate ladder still resolves first); search/candles/
  trades/holders keep the loud NOT_READY branch until a reader exists. Record:
  `docs/defi/G1_MARKET.md`. Gate: `test/test-defi-market.mjs` (25/25). The G1
  registry/feeds/market triad is now structurally complete; closure awaits the live evidence
  session + owner sign-off.
- **Owner-approved live-automation (2026-10-06) → delivered same day:** `scripts/live-betanet-verify.mjs`
  — the manual live-verify loop is now ONE command (`npm run test:live`). It orchestrates the
  existing probes as child processes (P3 token transfer, Q22 oracle feed) plus inline program-
  layer checks (Q14 amm presence, Q20 registry↔bootstrap↔chain consistency), classifying every
  outcome as PASS / honest-NEGATIVE / FAIL / BLOCKED_ENV and appending a dated
  `<date>-live-chain.json` evidence entry. Throwaway faucet-funded keys only (Betanet
  self-funds); nothing reads the vault or any saved key. Live runs stay OUT of `npm test`:
  the offline battery is the deterministic gate; the live battery writes evidence into the
  seeds. Desktop smoke flows stay manual on the checklist (real UX can't be scripted that way).
- **First live battery run (owner's networked host, 2026-10-06) → the first real-flow FAIL was
  found and fixed the same day.** Chain finding: standalone NOOP self-activation reverts on
  current Betanet for 0-balance accounts (vmError table: -497 state 0 / -767 halted / -764 CU
  exhausted / -765 revert user -26, -506 stale slot); the wallet is unaffected because
  registration defers (faucet-first is the working path). Root cause of the probe abort was
  ORDERING: it tested a path the wallet avoids. `verify-token-transfer.mjs` reordered to
  faucet-first, NOOP kept as a recorded lifecycle evidence row; the trace recorded in
  `scripts/defi-evidence/2026-10-06-live-chain.json` (owner-agent provenance, re-confirmable
  via `npm run test:live`). P3's token leg awaits the re-run.
- **Second live run (owner host, 2026-10-06) → rung-level findings landed.** test:live executed
  end-to-end: preflight PASS, **q14/q20 PASS (amm program DEPLOYED on betanet; registry map
  consistent)**, **q22 LIVE-NEGATIVE (no thru-usd oracle feed account)**, **p3 FAIL at rung 2**:
  activation gets through existence-verified (NOOP writes the account despite vmError -767),
  but the **faucet program itself REVERTS claims (-765, user -26n) — a chain regression vs the
  pinned 2026-09-26 verified claim (tsjbbZW9sT…)** that also breaks the shipped wallet's
  faucet feature until Betanet is fixed. Probe rewritten as a classified rung ladder
  (existence-verified activation, per-claim funding), oracle probe not_found classification
  fixed (exists:false, not 'unreachable'). amm registry record upgraded to
  'deployment observed' — trust stays unverified (existence ≠ verification, R4). **P3 stays
  CHAIN-BLOCKED; B17 unchanged.**
- **G1: CLOSED 2026-10-06 by owner sign-off.** The owner's forensic audit of `59a47b7…b4bcb6f`
  verified all three slices green (registry 27/27, feed 35/35, market 25/25, M0 98/98, full
  npm test, build clean) plus the live battery against real Betanet state. Verdict: "GATE G1
  SIGNED OFF (APPROVED)". The registry/feeds/market triad and the live evidence loop are the
  verified G1 deliverable; P3 remains chain-blocked (faucet regression) as the only G2 gate.
- **Owner-directed next track (same day): AMM read-side evidence.** `scripts/probe-amm.mjs`
  delivered (read-only, no signing: program account read, pool derivation evidence via
  `deriveAmmPoolAddresses` + `sortAmmMints` (Q18), pool parsing via the official
  `parseAmmPoolMetadata` (Q15)). Wired into the battery as check `q15-amm-pool-model`: PASS =
  program+parser surface verified; the pool-model parse honestly awaits on-chain mints
  (P3-blocked). The owner raised chain-side: faucet claim revert (-765/user -26n). A
  `--funder` leg for the P3 probe stays an explicit owner option IF a pre-funded betanet
  account exists — key discipline (throwaway isolation) is preserved by design.
- **Live battery fully operational (2026-10-07, owner host at `be92394`):** first run with the
  AMM row: **4 PASS / 1 FAIL / 1 NEGATIVE** — preflight, q14/q20 program layer,
  **q15-amm-pool-model PASS** (program read + official parser surface verified; pool-model
  parse awaits mints), q22 NEGATIVE (no thru-usd feed), **p3 FAIL at the faucet rung only
  (regression confirmed, activation existence-verified)**. The owner pushed the evidence entry
  themselves (`66f0e4f`, `scripts/defi-evidence/2026-10-07-live-chain.json` — verified in-repo
  byte-for-byte). The one-command live evidence loop is now the standing instrument.
- **Q9-first query-surface probe delivered (2026-10-07, owner directive "both — Q9 first,
  then Q18").** Reading the pinned SDK runtime surfaces NATIVE query primitives the dossier
  never knew existed: `transactions.listForAccount` — the same primitive the extension's own
  history feature already calls (thru-client:691) — plus `events.list/stream`,
  `transactions.get/getStatus/list`, `blocks.list/stream`, `node.getStatus`. The 2026-09
  wallet probes' TRANSACTIONS_BY_ACCOUNT_UNSUPPORTED row means the chain REJECTED this
  primitive then — whether betanet serves it TODAY is a live question, now answerable by
  `scripts/probe-indexer.mjs` (`q9-query-surface` battery row). Q18 is covered IN the same
  probe: `listForAccount(amm program)` answers "program activity queryable" (pool discovery
  substrate on-node) and `events.list` unfiltered answers the event-surface question; a
  PoolInit-filtered iteration follows once the surface answer is known (no filter shapes are
  fabricated — live answer first). Probe discipline identical to the oracle/amm probes:
  UNSUPPORTED and EMPTY_RESULT are answers; only UNREACHABLE is BLOCKED_ENV (exit 1). The
  probe even validated its own input shapes offline (Pubkey → ta-address string; SDK's
  `page`-as-class binding) before any live run — instrumentation IS verification.
- **Q9 dossier consequence queued for the first live run:** if tx-by-account serves natively,
  the "NO_INDEXER" rows (history discovery contexts, deep-history honest fallbacks) move to
  "on-node substrate, no external indexer required — but the indexer package question
  (exploration/registry contract? @thru/indexer?) remains OPEN". If UNSUPPORTED, Q9 flips to
  the definitive LIVE-NEGATIVE and the indexer-lack is the verified truth. Either outcome
  closes the assumption; the evidence is the differentiator, not a guess.
- **QUERY SUBSTRATE LIVE-PASS (2026-10-07, owner run of q9-query-surface, battery 5/1/1).**
  EVERY native query primitive serves on betanet: `node.getStatus` (ready:true,
  consensus.active, finalizedSlot 595,581+), `chain.getChainInfo` (**chainId: 2 = Betanet,
  live-pinned**), `version.get` (thru-node a81ff4cbb, 2026-09-30), `transactions.listForAccount`
  (fresh account → supported empty result; **amm program → 1 transaction, queryable activity**),
  `events.list` (50 events/page, hasNext — enumerable event surface), `transactions.getStatus`
  (live sig → CLUSTER_EXECUTED, 21,788 CU, vmError 0). The 2026-09 UNSUPPORTED row is dated;
  the history substrate is ON-NODE — no external indexer needed for per-account history or
  program-activity enumeration. Q9 closed for substrate (the dedicated-indexer-PACKAGE question
  — registry/explorer contract — remains open); Q18's global-discovery substrate LIVE-PASS.
- **Q18 discovery probe delivered over the verified substrate (same day):**
  `scripts/probe-amm.mjs --discover` (battery row `q18-amm-pool-discovery`): enumerate amm
  activity FULL-view → candidate account union minus payer/program → **official parser is the
  judge** (no layout assumptions, no internals; strictly bounded ≤8 candidates) → verified
  pools cross-checked against `deriveAmmPoolAddresses` (discovered address must reproduce
  from parsed mints+fee). Verdict semantics: 1+ pools → PASS (Q15 model evidence live); 0 →
  NEGATIVE (substrate green, honest absence — mint-blocked); UNSUPPORTED → drift-FAIL.
- **Owner classification fix (2bae35c) folded:** battery rows must test exit code BEFORE
  substring markers when a probe prints its own legend — the q9 row's footer contained the
  word UNREACHABLE and would have false-BLOCKED a successful run. Regression noted; the
  ordering rule now stands for all classifier code (exit first, markers second).
- **"PR build broke the faucet" — disentangled and refuted (2026-10-08).** Forensic: every
  src/ delta vs released v1.4.1 is additive-only (new DeFi handlers behind flags=all-off);
  thru-client.js/vault.js untouched across the entire PR; tx.claimFaucet route unchanged.
  The decoded evidence (same chain, same day): fresh-account createOnChainAccount reverts
  VM_FAILED (-767) yet persists the account (battery rung 1 since 10-06) → such accounts are
  poisoned; claims from them revert — and the error-of-the-day DRIFTED (-765/-26n on
  10-06/07 → -767 on 10-08): the chain is being touched under investigation (through-team
  engaged after our finding). The released 1.4.1 works for the OWNER because their wallet
  activated in the healthy era — long-lived activated accounts claim FINE. A dev/unpacked PR
  install yields a DIFFERENT storage area → a FRESH wallet whose activation hits the
  fresh-path regression. Decisive confirmation test for the owner: import the same seed into
  the PR build → claim; expectation: works (same wallet, same account). Fault model stands:
  P3 closed-ish is blocked on fresh-activation heals; code-side: nothing to fix.
- **The verify-token-transfer rung-2 error prose** now states the refined model so the
  battery stops hard-coding the 10-06 error code; the evidence trail (error by date)
  remains the canonical record instead of a stale constant.
- **App-wide audit vs official surfaces (2026-10-08): deps CLEAN, spec-corrected fault
  model.** npmjs account thru-core fetched live: wallet pins match latest EXACTLY
  (`@thru/sdk@0.4.1` = latest, published 2026-09-30 — same epoch as thru-node a81ff4cbb;
  0.4.0 was published 2026-09-26, the day of the last verified claim). No API drift, nothing
  to upgrade into. `@thru/indexer@0.4.1` + `@thru/replay@0.4.1` EXIST (2026-09-30): official
  indexer framework (chain->Postgres, auto REST) + history-replay engine — the Q9
  dedicated-package answer; a hosted public endpoint is still not observed, and our wallet
  needs none (on-node substrate live-passed). Official runtime spec fetched (runtime/errors,
  runtime/transaction-execution) and pinned in
  `scripts/defi-evidence/2026-10-08-official-docs.json`, INCLUDING a correction of this
  file's 'poisoned account' reading: pre-exec creates fresh fee-payer accounts with a valid
  CREATION proof BEFORE program execution (rung-1 'exists despite error' is legitimate,
  spec-mandated), and 'failed executions preserve nonce advancement and fee collection ONLY'
  — partial state-write poisoning is impossible per spec. Remaining facts unchanged and
  stronger: failures are EXECUTE-class inside the faucet program (-765 revert+user -26n
  10-06/07 -> -767 VM fatal 10-08, drifting = chain being touched; -767 is worse than a
  revert). No wallet-code fix exists for a chain-side program fault; our placed bount: the
  -767 audit demanded here approves the code (additive-only, byte-identical claim route).
  Owner action stands (chain escalation + same-seed import test).
- **Ecosystem learning pass: pgreyy/thruscan (2026-10-08, owner's direction).** ThruScan is a
  community explorer+wallet+swap+launchpad+names suite on alphanet with its OWN deployed C
  programs (programs/: thruswap.c AMM, thrupad2.c launchpad, thrucpi.c CPI example, name
  service root …), an SDK-0.4.x base, and a year of painful-translated-to-comments production
  lore. Incorporated learnings, each pinned by file:
  1. **Network identity**: they verified rpc.alphanet.thru.org ≡ rpc.betanet.thru.org on
     2026-10-05 (same block hash at slot 2,908,038; chainId 1 both names). Our battery read
     chainId 2 + finalized ~0.6M on rpc.betanet.thru.org on 10-07 — EITHER topology evolved in
     the window OR a value drifted; probe-indexer now pins chainId + finalizedSlot + RPC url
     on every live run ("RESULT chain-identity:") so drift is battery-visible. Their networks.js
     lesson applies to us: node+addresses chosen TOGETHER (our configureNetwork does).
  2. **System-program map completed from OUR OWN pin**: the bootstrap table in the pinned
     @thru/programs/bootstrap-addresses 0.4.1 has 18 roles — our registry had only 5.
     Completed seed + capability snapshot (+fixtures/tests) with verbatim addresses from the
     package itself (clob, nft, name_service, thru_registrar, passkey_manager, abi_manager,
     block_producer, consensus_validator, eoa, faucet, noop, uploader, compression, wthru);
     ThruScan's per-network addresses cross-confirm the overlap (token/eoa/multicall/name_service/
     faucet/noop/amm/clob/oracle/nft/wthru). q20-program-map now verifies all 19 records live.
  3. **max_state_units_per_block = 8192 with a SILENT-DROP failure mode** (ThruScan lost a
     whole site to it 28 Sept): over-asking state units is not rejected — the tx is never
     admitted, signature returns, 'not found' forever. Our sends/claims all use stateUnits 1 —
     safe — but this caps any future batched write; live value readable via feature gates:
     'thru feature-gates list'.
  4. **Send-landing discipline (production-verified)**: -511 = nonce taken lands in-block and
     FAILS (not dropped); send can answer "busy" yet execute; "a transaction the node never
     admits looks exactly like one never sent". Their sendLanded pattern: send → wait nonce
     movement → verify by signature lookup → rebuild with next nonce. Matches our pending-tx
     + tracked-send philosophy — independent production corroboration of our G5/G17 design.
  5. **One signature = fee payer alone**: a hosted sponsor account can CREATE/OPEN for users
     but can never move their tokens (env THRU_SPONSOR_* on their serverless). Our policy
     stands: no server, no hosted keys; documented as the ecosystem's funding-UX solution
     during chain-regression eras.
  6. **Multicall**: system-shipped; wire format [count u16][program_idx u16][data_size u64][data]
     per instruction; merged account list indexing; atomicity proven running wrap-THRU since
     September (Q1 multi-program: community production proven — dossier upgraded).
  7. **CORS**: alphanet node sends none (their browser→serverless proxy). Ours (betanet)
     serves CORS fine for extension pages (G1 live rows proven). Hazards pinned: never trust
     SDK DEFAULT_HOST (theirs was a dead host hardcoded); we always configureNetwork
     explicitly with pinned origins.
  8. **Pool discovery design space proven**: their swap keeps an on-chain REGISTRY account —
     validates the registry-pattern supply for our Q18 global-discovery iterator.
  9. Their deploy pipeline (programs/build.sh + C sources) is the reference for our eventual
     token/program deploys (G4+ build steps) — no DevKit mystery left.
- **Dossier rows upgraded with these proofs** (Q1 multicall production-proof, Q7 transport
  CORS contrast + DEFAULT_HOST hazard, Q18 registry-discovery proven, Q20 full 0.4.1 map).
- **SDK 0.3.18→0.4.1 diff audit + address-provenance correction (owner directive, 2026-10-08).**
  Two pinned binaries installed side-by-side and diffed: public SDK surface is ADDITIONS-ONLY
  (12 program-address constants + CompressionError; zero removals); every type/method the
  wallet touches is byte-identical across versions (build/query/fee-payer/proofs/crypto). The
  one CONTENT change is the whole system-address family replaced at 0.4.0 (15 re-addressed +
  3 added, released 2026-09-26 — both packages, same epoch; faucet taWpJIo6… → taFCTxR0y2…).
  Wallet-side coherence confirmed: networks.js and thru-client derive addresses from the
  packages (the wallet is 0.4.x-native — EOA_PROGRAM_ID-etc imports only exist in 0.4.x);
  released 1.4.1 pins 0.4.1/0.4.1 and claims work today for existing accounts. The registry
  snapshot NOW ALSO derives all 18 role addresses from the package (owner's callout: never
  hardcode what the pin already declares — package upgrades flow through; the dated evidence
  seed remains a B3-era pin that fails loud on any future move). VERDICT: if the chain has an
  issue, it is the chain: every client-side seam checks out; the -767 fault is coherently
  assigned to the running 0.4.1-epoch node's faucet program on fresh-account claim paths
  (older accounts unaffected; chainId drifted 1→2 during 10-05..10-07 — the exact genesis
  the claims now run on). Full audit record: scripts/defi-evidence/2026-10-08-official-docs.json
  (sdkDiffAudit block).
