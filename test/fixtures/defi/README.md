# DeFi contract fixtures (M0)

Purpose: let the frontend build the complete DeFi UI against the **exact backend contract**
(contract v17/v18, `src/shared/contract/defi-schema.js`) before any feature flag ships, per
`thru-defi-backend.md` S13 step 3. These files are the machine-readable contract of record
together with the schema.

## Files

- `fixtures.mjs` — per-method scenario corpus: `current` (byte-exact match of what the handler
  answers **in this build**), `dossier` (what it answers once its flag is on but evidence is
  still missing), success/error specimens per S5 wire shape, and `validParams` for router probes.
- `capability-presets.mjs` — four `program.capabilities` responses for renderer states:
  `everythingOff` (today, byte-exact), `readOnly`, `swapOnly`, `full`. Non-today presets are
  **simulations for UI state coverage**, clearly marked; `capable:false` caveats stay attached
  to every row whose evidence does not exist yet.
- `intent-scripts.mjs` — five deterministic intent lifecycle scripts (fresh settle, settle
  after re-prepare, dropped-tx resume, expired-discard, replaced-failed) with ordered
  `intentChanged` emissions, for the pending-tx timeline UI.
- `test-defi-m0.mjs` (in `test/`) — the gate: schema↔manifest coherence, snapshot↔seed pin,
  fixture shape/enum validation, and fixture↔handler integrity via real router dispatch.

## Rules

1. Payloads are wire-exact. Metadata (`note`, `_label`) lives in the wrapper, never in `data`.
2. No real keys, addresses of real people, or live-chain claims. Addresses are `ta…Fixture…`
   strings; anything labelled a specimen or preset is a rendering sample, not evidence.
3. Every fixture's `reason` values come from `UNSUPPORTED_REASONS` (S10 closed enum).
4. Fixtures for methods whose handler output is deterministic are pinned by **deep equality**
   against real dispatch; changing a service message or the gate ladder breaks the test.
5. Nothing here is imported from `src/` into the bundle — the quarantine test scans dist/ for
   `__defiFixtureVersion` to prove the corpus never ships.
6. Regeneration: there is nothing to regenerate by script at M0 — fixtures are hand-authored
   and test-pinned. When handlers grow real data paths, extend fixtures in the same commit.
