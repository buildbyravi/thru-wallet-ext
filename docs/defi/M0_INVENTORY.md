# M0 contract-first drop — code inventory + changelog

**Delivered 2026-10-05** on branch `arena/01a10804-thru-wallet-ext` (PR #19): commits
`89dc977` (contract surface) + `6314dcb` (fixtures/integrity gate) + docs commit.
Gate spec: `thru-defi-backend.md` S13; corrections C-1..C-7 in `DECISIONS_G0.md` applied.

## What M0 is (and is not)

M0 is the **contract**, not the feature. The complete DeFi API surface is declared, validated,
wired, fixture-backed, and provably refused in this build. No DeFi flag is on and no flag can
be flipped by URL or storage; flipping a flag is a reviewed ship decision in `src/shared/flags.js`.
Out of M0's boundary (intentionally absent): DeFi chain reads/writes, the intent store, the
registry service, market data, feeds, adapters, UI routes/screens, the Desktop page, and any
optional server. Those are G1+ per the gate plan in `README.md`.

## Contract delta

- `CONTRACT_VERSION` 16 → **18**; methods 81 → **124** (43 appended, none changed, none retired).
- Events appended (3): `intentChanged`, `capabilitiesChanged`, `feedChanged`.
- Error codes appended (28): `FEATURE_DISABLED`, `UNSUPPORTED`, `INVALID_INPUT`, `ALREADY_EXISTS`,
  `ACCOUNT_MISSING`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_FEE_RESERVE`, `USER_REJECTED`,
  `CONTEXT_CHANGED`, `QUOTE_EXPIRED`, `BINDING_MISMATCH`, `INTENT_EXPIRED`, `INTENT_LOCKED`,
  `NONCE_CONFLICT`, `SIMULATION_FAILED`, `PROGRAM_ERROR`, `SLIPPAGE_EXCEEDED`, `TX_DROPPED`,
  `TX_REPLACED`, `NOT_READY`, `NOT_AUTHORIZED`, `NOTHING_TO_CLAIM`, `UPLOAD_REJECTED`,
  `RATE_LIMITED`, `RPC_UNAVAILABLE`, `UPSTREAM_UNAVAILABLE`, `VERSION_MISMATCH`, `INTERNAL`.
- Auth discipline (DEFI-03): exactly one DeFi signing method — `intent.submit`.

## Method inventory (43)

Handler location shorthand: `svc/` = `src/background/services/`, `feat/` = `src/background/features/`.
"Answer today" is the probed current-build behavior (M0 suite dispatches every method for real).

### v17 READ (21) — callable per S3 (public reads while locked; wallet-scoped reads unlocked)

| Method | Auth | Gate | Answer today | Handler |
| --- | --- | --- | --- | --- |
| `program.capabilities` | none | always | full Capabilities from evidence snapshot | `svc/program-service.js` |
| `program.list` | none | always | 5 ProgramRecords from snapshot | `svc/program-service.js` |
| `feed.status` | none | always | `{ feeds: [] }` (no publisher, honest) | `svc/feed-service.js` |
| `feed.lookup` | none | always | `{ feeds: { id: null } }` per id | `svc/feed-service.js` |
| `market.assetGet` | none | DEFI_MARKET | `supported:false / FLAG_OFF` (result) | `svc/market-service.js` |
| `market.assetSearch` | none | DEFI_MARKET | `supported:false / FLAG_OFF` | `svc/market-service.js` |
| `market.snapshot` | none | DEFI_MARKET | `supported:false / FLAG_OFF` | `svc/market-service.js` |
| `market.candles` | none | DEFI_MARKET | `supported:false / FLAG_OFF` | `svc/market-service.js` |
| `market.trades` | none | DEFI_MARKET | `supported:false / FLAG_OFF` | `svc/market-service.js` |
| `market.holders` | none | DEFI_MARKET | `supported:false / FLAG_OFF` | `svc/market-service.js` |
| `risk.assetAssess` | none | DEFI_RISK | `FEATURE_DISABLED` envelope (**real offline RiskReport on flag-on**, pinned byte-exact) | `svc/risk-service.js` |
| `launchpad.list` | none | DEFI_READ | `supported:false / FLAG_OFF` | `feat/launchpad/` |
| `launchpad.get` | none | DEFI_READ | `supported:false / FLAG_OFF` | `feat/launchpad/` |
| `launchpad.templates` | none | DEFI_READ | `supported:false / FLAG_OFF` | `feat/launchpad/` |
| `launchpad.listMine` | unlocked | DEFI_READ | `WALLET_LOCKED` → `FEATURE_DISABLED` | `feat/launchpad/` |
| `launchpad.validateDraft` | none | DEFI_READ | `FEATURE_DISABLED` (**real offline DraftValidation on flag-on**, pinned byte-exact) | `feat/launchpad/` |
| `dex.listPools` | none | DEFI_READ | `supported:false / FLAG_OFF` | `feat/dex/` |
| `dex.getPool` | none | DEFI_READ | `supported:false / FLAG_OFF` | `feat/dex/` |
| `dex.positions` | unlocked | DEFI_READ | `WALLET_LOCKED` → `FEATURE_DISABLED` | `feat/dex/` |
| `intent.list` | unlocked | DEFI_INTENT | `WALLET_LOCKED` → `FEATURE_DISABLED` | `svc/intent-service.js` |
| `intent.get` | unlocked | DEFI_INTENT | `WALLET_LOCKED` → `FEATURE_DISABLED` | `svc/intent-service.js` |

### v17 LOCAL (8) — non-secret, network-scoped; no network traffic

| Method | Auth | Gate | Answer today | Handler |
| --- | --- | --- | --- | --- |
| `launchpad.draftList/draftGet/draftSave/draftDelete` | unlocked | DEFI_LAUNCHPAD | `WALLET_LOCKED` → `FEATURE_DISABLED` (storage arrives with the feature) | `feat/launchpad/` |
| `market.watchlistGet/watchlistAdd/watchlistRemove` | unlocked | DEFI_MARKET | `WALLET_LOCKED` → `FEATURE_DISABLED` | `svc/market-service.js` |
| `desktop.open` | none | DEFI_DESKTOP | `{ enabled:false, reason:FLAG_OFF }` (no Desktop page exists) | `svc/desktop-service.js` |

### v18 PREPARE (13) — build transactions/reviews, never sign

| Method | Auth | Gate | Answer today | Handler |
| --- | --- | --- | --- | --- |
| `intent.prepareSend` | unlocked | DEFI_INTENT | `WALLET_LOCKED` → `FEATURE_DISABLED` | `svc/intent-service.js` |
| `intent.rePrepare` / `intent.resume` / `intent.discard` / `intent.stopWaiting` | unlocked | DEFI_INTENT | `WALLET_LOCKED` → `FEATURE_DISABLED` | `svc/intent-service.js` |
| `dex.quote` | none | DEFI_DEX | `supported:false / FLAG_OFF` (dossier `PROGRAM_NOT_VERIFIED` on flag-on) | `feat/dex/` |
| `dex.quoteLiquidity` | none | DEFI_DEX | `supported:false / FLAG_OFF` | `feat/dex/` |
| `dex.prepareSwap` / `dex.prepareLiquidity` | unlocked | DEFI_DEX | `WALLET_LOCKED` → `FEATURE_DISABLED` | `feat/dex/` |
| `launchpad.uploadImage` | unlocked | DEFI_LAUNCHPAD | `WALLET_LOCKED` → `FEATURE_DISABLED` | `feat/launchpad/` |
| `launchpad.prepareCreate` / `prepareMigrate` / `prepareClaim` | unlocked | DEFI_LAUNCHPAD | `WALLET_LOCKED` → `FEATURE_DISABLED` | `feat/launchpad/` |

### v18 EXECUTE (1) — the only DeFi signing method

| Method | Auth | Gate | Answer today | Handler |
| --- | --- | --- | --- | --- |
| `intent.submit` | signing (+ `password` param) | DEFI_INTENT | `WALLET_LOCKED` → (auth) → `FEATURE_DISABLED`; password re-auth honoured including `defiAlwaysRequirePassword` | `svc/intent-service.js` |

## Code inventory (new/changed files)

**New, shipped (src/):**
- `src/shared/contract/defi-schema.js` — machine schema: S3 groups, S10 unsupported-reason
  enum, gates, result keys, declared errors, `validateDefiParams()` (runs in the router before
  auth and before any service, raising `INVALID_INPUT`).
- `src/shared/flags.js` extended — `DEFI` master + `DEFI_READ/DEX/LAUNCHPAD/MARKET/RISK/INTENT/FEED/DESKTOP`,
  all build-time false; `isDefiFeatureEnabled()` (master dominance); no override path.
- `src/background/services/defi/capability-snapshot.js` — shipped twin of the G0 seeds
  (13 features, 5 programs, limits); exit condition: replaced by the registry service, with the
  pin test as the guardrail.
- `src/background/services/defi/gating.js` — the single gate ladder (FLAG_OFF → kill switch →
  dossier) with `result`/`error` delivery.
- `src/background/services/{program,feed,market,risk,intent,desktop}-service.js` — handlers above.
- `src/background/features/{dex,launchpad}/{*-handlers.js,*-service.js}` — feature backends
  behind the layering bans (no sibling imports, no vault/client imports, router-integrated).

**Changed:** `src/shared/contract/manifest.js` (v18 + 43 entries + 3 events + 28 error codes),
`src/background/api-router.js` (wiring, schema validation at the seam, `intent.submit` in the
signing-guard set, 20-sync-read registration, `defiAlwaysRequirePassword` in signing auth,
membership exports for tests), `src/background/services/preferences-service.js` (6 DeFi prefs +
security field + validators), `scripts/check-layering.mjs` (3 DeFi rules),
`test/test-contract.mjs` (v18 invariants), `test/test-launchpad-quarantine.mjs` (B16 rewrite).

**New, not shipped (test/):** `test/fixtures/defi/{README.md,fixtures.mjs,capability-presets.mjs,intent-scripts.mjs}`,
`test/test-defi-m0.mjs` (wired into `npm test`). The quarantine dist scan asserts the corpus
never ships (`__defiFixtureVersion` marker).

## Changelog (relative to G0, 2026-10-05)

1. Contract v18: 43 DeFi methods + schema + events + error codes (details above).
2. Flags exist now; every DEFI_* is false with probe-level proof of inert overrides.
3. Quarantine test rewritten deliberately (B16): legacy bans kept verbatim where they protect;
   allowlists for the pre-approved backend surface; live refusal probes; dist fixture scans.
4. Preferences gained the DeFi keys and the security-gated `defiAlwaysRequirePassword`,
   which is honoured by signing auth for DeFi methods even when session-only signing is default.
5. Feature backends exist as directories (per `MODULE_BOUNDARIES.md`, with extended layering rules).
6. Evidence tooling unchanged in behavior; collector regenerated its package-surface JSON with
   the new 124-method surface (+ the seed/meta pins the M0 test enforces).
7. Doc-truth cascade: `PROJECT_LEDGER.md` (v18/124 + v17/v18 history rows), `STATUS_AND_ROADMAP.md`,
   `BACKEND_GAPS.md`, `llms.txt`, `CONTEXT.md`, `MODULE_BOUNDARIES.md`, this directory.

## Verification (recorded at delivery)

- `npm test` green: 21 suites + DeFi M0 gate; contract-direction 130/130, quarantine 66/66,
  DeFi M0 98/98, route lifecycle 1017/1017, vault/thru-client integration, security checks.
- `npm run build` clean, zero warnings; dist proof in the quarantine section (two bundles, one
  page, no fixture/mock content, no legacy artifacts).
- `scripts/collect-offline-evidence.mjs --check` PASS.
- `git diff --check` clean.

**Owner-side verification (2026-10-05):** the owner's forensic audit re-verified `bddfef6`
ff-only on Windows — build, full `npm test` (22 suites), layering (93 files, 0 violations),
diff clean — with no repo defects found and append-only evolution confirmed byte-for-byte.
Formal human sign-off on M0 is recorded with the owner, not by the audit.

## Known gaps / explicitly not in M0

- No live-chain DeFi evidence (P3 / Q1–Q26 live rows are live-session work on a reachable machine).
- Intent store, registry service, feed verifier, market layer, adapters: G1/G2 scope.
- Unlocked-path dispatch probes for `unlocked`/`signing` DeFi methods stop at `WALLET_LOCKED` in
  the suite (no in-test vault); the post-unlock ladder is exercised by fixtures and asserted
  structurally, and gets full dispatch coverage when the fixture bridge lands with the frontend.
