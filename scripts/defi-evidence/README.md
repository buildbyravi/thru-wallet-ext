# DeFi evidence folder

Machine-readable evidence entries for the DeFi backend workstream (`docs/defi/`).
The program registry and capability matrix cite entries here by `id`; code may only depend on a
chain fact once an entry records it. **No entry may contain a secret, key, seed or password.**

## Entry schema (JSON, one file per entry)

| Field | Meaning |
| --- | --- |
| `id` | `<date>-<slug>`, unique |
| `kind` | `environment`, `package-surface`, `official-docs`, `repo-record`, `live-chain` |
| `network` | network id the fact binds to (e.g. `betanet`), or `null` |
| `dateUtc` | UTC date the evidence was produced |
| `tool` | exact tool and version/source; for live-chain entries include the script and any account/tx reference (public data only) |
| `refs` | URLs, file paths or ids the entry derives from |
| `finding` | the fact, in one paragraph, with scope and caveats |
| `confidence` | high/medium/low plus why |

## Classes and what they close

- `live-chain` — produced by `scripts/verify-*.mjs` / `scripts/probe-*.mjs` / `scripts/token-lab.mjs`
  run against a reachable network with **throwaway accounts**. The only class that closes a
  dossier build dependency (R1).
- `official-docs` — dated retrieval of official Thru documentation. Admissible dossier evidence
  per the backend spec (B2: "live test network and official docs"), but behavior with funds at
  risk still gets a `live-chain` confirmation before a write path is enabled.
- `package-surface` — declarations read from the pinned `@thru/*` packages. Never live evidence.
  Reproduce with `node scripts/collect-offline-evidence.mjs`.
- `repo-record` — facts established in the repo's own authority docs / tests (e.g. BACKEND_GAPS,
  audits). Historical network observations keep their provenance and do not close current rows.
- `environment` — facts about the build/run environment itself (e.g. blocked egress).

## Current entries

- `2026-10-05-environment-egress.json` — this build sandbox cannot reach Thru endpoints.
- `2026-10-05-package-surface.json` — generated; pinned package surfaces + repo identifiers.
  Do not hand-edit; re-run the collector (`--check` fails on pin drift or missing
  shared-contract methods).
- `2026-10-05-official-docs.json` — dated retrieval of official spec facts (transactions,
  execution, resources, transport).
- `betanet.registry-seed.json` / `betanet.capability-matrix.json` — G0 seeds explained in
  `docs/defi/REGISTRY_AND_CAPABILITY_SEED.md`. Every record is unverified until a `live-chain`
  entry verifies it.
