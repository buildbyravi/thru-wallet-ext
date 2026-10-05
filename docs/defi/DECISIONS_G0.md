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
