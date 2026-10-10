# Registry and capability seeds (Gate 0)

Date: 2026-10-05 · Gate: **G0 delivered** · Network in scope: `betanet` only (the only enabled
network; Localnet/Testnet/Mainnet declared-disabled; custom networks `CUSTOM_NETWORK`, D14).

Two machine-readable artifacts, owned by this document:

- `scripts/defi-evidence/betanet.registry-seed.json` — one `ProgramRecord` per role
  (token, amm, curve, multicall, oracle) plus the pending genesis-binding requirement.
- `scripts/defi-evidence/betanet.capability-matrix.json` — the per-feature state/reason seed
  with limits, contract-version note and feed summary.

## Rules the seeds encode

1. **Addresses come from the pinned packages, verification is layered on top**
   (`@thru/programs/bootstrap-addresses` via the existing `src/lib/networks.js` pattern, B0/B3).
   A package-declared address is never proof of live deployment or management state.
2. **Nothing is verified from documentation alone.** Only `live-chain` evidence
   (`scripts/defi-evidence/README.md`) moves a record to `verifiedLive`; the token program is at
   `goldenTested` today (local wire goldens against the official binding) with live semantics
   open (BACKEND_GAPS C1/C2).
3. **Genesis binding is a hard requirement, currently pending.** The 2026-09-26 managed-genesis
   reset proved managed addresses can be reused across a reset; the history service's
   chain-identity gate (offline fingerprint + live genesis check) is the one mechanism to reuse
   or lift — never a second implementation.
4. **Capability derivation = flag AND registry AND feed AND dossier.** Flags do not exist yet
   (they arrive with the first code change, all off, build-time, no URL/storage override — the
   retired `?launchpad=1` pattern is banned). A signed feed can only narrow a build, never widen it.
5. **Limits are proposals for the product owner** (PROJECT INPUTS §5, blank input = defaults):
   quoteTtl 15s · preparedTtl 2min · slippage default 50 bps (300 bps suggested for
   unverified/curve) · warn 300 bps · max 2000 bps (Desktop-advanced typed confirmation only) ·
   price-impact warn 500 bps · block 1500 bps · USD floor per-network TBD · max 1000 candles ·
   min poll 5s.

## Unsupported matrix (today, G0)

| Feature | State | Reason | Driven by |
| --- | --- | --- | --- |
| balances | enabled | — | wallet core (observed live 2026-10-04) |
| tokenTransfer | enabled (live semantics open) | — | ships in wallet v8; C1/C2 open |
| swap | unsupported | `PROGRAM_NOT_VERIFIED` | Q14–Q16, Q19; R2 exit-first |
| pools | unsupported | `PROGRAM_NOT_VERIFIED` | Q15, Q17, Q18; R2 |
| launchMint | unsupported | `TOKEN_PATH_UNVERIFIED` | Q13 = P3; Q11, Q12 |
| launchDirectPool | unsupported | `DEPENDENCY_UNVERIFIED` | needs launchMint + pools (B8 order) |
| launchCurve | unsupported | `LAUNCH_MODEL_UNAVAILABLE` | Q20 package-side negative; live search open |
| migrate | unsupported | `LAUNCH_MODEL_UNAVAILABLE` | Q21; destination-pool griefing check |
| claim | unsupported | `LAUNCH_MODEL_UNAVAILABLE` | Q21 |
| charts | unsupported | `NO_INDEXER` | Q9, D2 default |
| discovery | unsupported | `NO_INDEXER` | Q9, D2 default |
| simulation | unsupported | `NO_SIMULATION` | C3 stub; Q5 open |
| usd | unsupported | `DEPENDENCY_UNVERIFIED` | Q22; D8 native-only |

The full reason → question mapping lives in `G0_DOSSIER.md` §"Reason mapping". When a row
changes it changes here and in the capability seed in the same edit.

## What the first code change (M0) inherits

- Manifest READ version **17**, EXEC version **18** (recon correction — see DECISIONS_G0 C-1).
- Every method stub returns these states honestly (`supported:false` + reason, or
  `FEATURE_DISABLED` once flags exist); fixtures in S13 mirror them.
- The capability matrix above is fixture "preset: everything off". Other presets (read-only,
  swap-only, full) activate rows **only** where the dossier has closed.
