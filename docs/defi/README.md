# DeFi backend workstream — index

Started: 2026-10-05 by explicit owner directive (decision `docs/DECISIONS.md` D-012, amending the
2026-10-04 "wallet core first" order — see `docs/STATUS_AND_ROADMAP.md` §2 amendment).
Scope: **backend only** — contract manifest/router, background services, adapters, registry,
risk engine, intent pipeline, market reads, storage, permissions, live-verification scripts,
privacy docs. A companion *frontend* prompt exists and joins at the M0 contract drop; its owner
runs it in a separate session.

Class of every document here: **Operational verification** (records and runbooks). Nothing in
this folder is a claim of shipped behavior; the authority documents remain
`docs/STATUS_AND_ROADMAP.md`, `docs/BUILD_SPEC.md`, `docs/BACKEND_GAPS.md` and `src/`.

## Governing prompt

The workstream runs under an imported two-file build prompt (backend file given to this session;
frontend file is its companion). Shared-contract fingerprint (both files must match):
`ca11b7bc900656e4580369ccc319d6c03ca86f2dd0c353f7cc560a671b3147e5`, SHARED CONTRACT v1.0.0.
The prompt text itself is not stored in the repo; this folder records its recon corrections,
answered inputs, dossier results, gate state and CCR traffic.

## Documents

| File | Owns |
| --- | --- |
| `G0_DOSSIER.md` | Gate 0: preconditions P1–P5, the Q1–Q26 evidence table, the unsupported matrix, leads disposition. Gate state: **G0 delivered; owner-side review agent verified the repo state green on 2026-10-05 and the owner directed M0; P3 (live token-transfer verification) remains an open live-chain task tracked separately** |
| `DECISIONS_G0.md` | Answered PROJECT INPUTS (all defaults), recon corrections (incl. contract-version correction to READ 17 / EXEC 18), CCR candidates |
| `M0_INVENTORY.md` | M0 contract drop: per-method code inventory (handler/service/flag gate/env), deliverables checklist, changelog, and boundary statement |
| `REGISTRY_AND_CAPABILITY_SEED.md` | How the registry and capability seeds work, the unsupported matrix and the reason mapping |
| `README.md` | this index |

Machine-readable artefacts: `scripts/defi-evidence/` (evidence entries, registry seed,
capability-matrix seed) with its own README; `scripts/collect-offline-evidence.mjs` regenerates
the package-surface entry (`--check` fails on pin drift or missing shared-contract methods).

## Boundaries (restated from `AGENTS.md`, D-005 and the prompt)

- **No feature code at G0.** First code is the M0 contract drop; the deliberate
  `test/test-launchpad-quarantine.mjs` rewrite (B16) travels in the **same** change — never
  earlier, never silently.
- D-005 re-entry conditions bind: new work only as isolated `src/features/<name>/` +
  `src/background/features/<name>/` modules with own namespaces (`launchpad.*`, `dex.*`),
  centralized signing through one pipeline, verified chain data only, same-PR quarantine update.
  Core wallet must not depend on any of it.
- The chain and programs are Layer 0: verified and integrated, never authored (D1).
- Live-chain facts require `live-chain` evidence (`scripts/defi-evidence/README.md`); this build
  sandbox cannot reach Thru endpoints (evidence `2026-10-05-environment-egress`), so live rows
  are scheduled for a network-reachable machine — they are **not** claimed here.
- "Guides 09–11" referenced by the prompt are **not present in this checkout**; the methods they
  assume (`price.get`, `tx.waitFor`, `featureflags.all`, …) never existed here. Closest
  ancestors are the already-frozen `docs/archive/` originals (`DOCS_INDEX.md` §5). Treat both as
  superseded wherever they conflict with this folder and the maintained docs.

## Gate plan (S12, backend side)

G0 recon/dossier/seeds (this folder) → **M0 contract drop — CLOSED 2026-10-05 by owner
sign-off** (manifest v17/v18 entries, `src/shared/contract/defi-schema.js`, honest gated
handlers, fixtures/presets/intent scripts under `test/fixtures/defi/`, integrity gate
`test/test-defi-m0.mjs`; code inventory in `M0_INVENTORY.md`) → **G1 read-only +
registry/feeds/market layer — IN PROGRESS** (G1-A delivered: registry service owns records +
derivation with stateless B3 genesis binding, `docs/defi/G1_REGISTRY.md`; feed verification +
market layer + live rows pending; G1-B delivered: SignedFeedRecord verification + narrowing, `docs/defi/G1_FEED.md`; G1-C delivered 2026-10-06: coalescing read cache + per-slice market assembly, `docs/defi/G1_MARKET.md`; live rows pending) → G2 intent
pipeline proven on send, then mint-only launch → G3 swap (exit first) → G4 pools and
direct-pool launch → G5 curve (only if Q20/Q21 allow) → G6 scale. Sequence per the owner:
G0 → M0 → verified capability matrix → real fixtures → mint-only launch pipeline. Each gate
closes only on human sign-off.

M0 boundary (still standing): the contract drop is the *contract*, not the feature. No DeFi flag
is on, no chain read/write DeFi path exists, the intent store is unbuilt, and the only two
"real" derivations (`risk.assetAssess`, `launchpad.validateDraft`) are deterministic offline
functions of the evidence layer — proven on the flag-on rung, unreachable with flags off.
G1 keeps the boundary: the registry reads evidence; it does not create it. Live rows land only
via the evidence session (`scripts/verify-token-transfer.mjs` and successors).
