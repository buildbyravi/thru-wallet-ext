# DeFi Contract Fixtures (M0)

Purpose: allow future DeFi UI modules to be developed and tested deterministically against the exact backend contract (`src/shared/contract/defi-schema.js`, appended in contract v17/v18 and extended in v20/G3; current manifest is **v33**) while all `FLAGS.DEFI_*` remain `false`. See `docs/defi/M0_CONTRACT_INVENTORY.md`.

## Files

- `fixtures.mjs` — per-method scenario corpus: `current` (exact match of what each handler returns in the shipped build with all `DEFI_*` flags off), `dossier` (what handlers return when flags are enabled in tests where chain capabilities remain unsupported), success/error specimens, and `validParams` for router probes.
- `capability-presets.mjs` — five `program.capabilities` presets for UI state testing: `everythingOff` (shipped runtime state today — sole non-simulated preset), `swapShipped`, `readOnly`, `swapOnly`, and `full`. Simulated presets are **test-only UI state fixtures**, never live-chain claims.
- `intent-scripts.mjs` — five deterministic intent lifecycle scripts (fresh settle, settle after re-prepare, dropped-tx resume, expired-discard, replaced-failed) with ordered `intentChanged` emissions.
- `test/test-defi-m0.mjs` — automated gate enforcing schema <-> manifest coherence, snapshot <-> seed parity, fixture enum/shape validation, and real `api-router.js` dispatch parity.

## Rules

1. Payloads are wire-exact; test metadata (`note`, `_label`) lives on the wrapper, never inside `data`.
2. Never include real keys, mnemonics, or personal addresses; use synthetic `ta...Fixture...` addresses only.
3. Every unsupported `reason` must belong to `UNSUPPORTED_REASONS` (`src/shared/contract/defi-schema.js`).
4. Nothing in `test/fixtures/defi/` may be imported by `src/` (`test/test-launchpad-quarantine.mjs` scans `dist/` for `__defiFixtureVersion` to verify zero bundle leakage).
5. When a DeFi backend handler changes behavior, update its fixture and `docs/defi/M0_CONTRACT_INVENTORY.md` in the same commit.
