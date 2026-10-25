# G1-A — DeFi registry service (delivery record)

**Delivered 2026-10-05**, branch `arena/01a10804-thru-wallet-ext` (PR #19). Gate: G1
(read-only + registry/feeds/market layer). This document is the G1-A slice: the registry
service and the genesis binding. G1-B (feed verification plumbing) and G1-C (market read
layer) plus the live evidence rows are still ahead; see "Remaining G1".

## What G1-A changes

Before G1-A, `program-service`, `feed-service`, `risk-service`, and `gating.js` each imported
the evidence snapshot directly. They now read through **`src/background/services/registry-service.js`**,
the single owner of DeFi program/feed/feature records and capability derivation (appendix B
placement: a distinct background service, not a feature). Behavior is deliberately unchanged
under alignment — proven by the M0 fixture suite against the live dispatch.

## The B3 genesis binding (stateless)

Requirement (dossier seed + B3): records, caches, and prepared intents must bind to the
network's genesis identity; a changed identity must invalidate them with reason NETWORK_RESET.
The previous managed-genesis reset (2026-09-26) is exactly the case this defends.

Design (no storage, restart-proof):

1. The evidence snapshot pins **`SEED_FINGERPRINT`** — the chain fingerprint at evidence time,
   computed once with `history-service.chainFingerprint(getNetworkConfig('betanet'))` and
   embedded as data. It is deliberately *not* recomputed into the snapshot later.
2. At read time the registry re-derives the **runtime fingerprint** from `networks.js` using
   the very same `chainFingerprint()` the history cache uses (an offline value that changes
   exactly when the managed program set changes = the only definition of "chain identity" this
   wallet can trust offline).
3. If the two differ: **every** seed-derived row — dossier rows *and* wallet-core `enabled`
   rows — downgrades to `unsupported / NETWORK_RESET`. Flags still dominate method derivation
   (a flag-off method keeps answering FLAG_OFF); the discovery reads (`program.*`, `feed.*`)
   stay callable and expose the drift via the new `genesis` block in `program.capabilities`.
4. The pin test (`test/test-defi-registry.mjs`) asserts runtime fingerprint == seed fingerprint,
   so a real managed genesis swap **fails the build loudly** until the evidence process
   re-seeds (new facts, new fingerprint), instead of silently following the records to a chain
   they were never verified on.
5. **Events (S7):** the first detected alignment *transition* emits `capabilitiesChanged`
   once — `{ networkId, genesisAligned, reason }`. Boot sets the baseline silently; steady
   state re-derives emit nothing; recovery (re-alignment) emits once with `reason: null`.

Consumers:
- `gating.js` — dossier rung reads `registry.getFeature()`, so every gated handler inherits
  NETWORK_RESET under drift with zero handler changes (asserted end-to-end: `market.candles`
  with its flag flipped answers `NETWORK_RESET`, not the stale dossier reason).
- `program-service` — `program.capabilities`/`program.list` map the registry record to wire.
- `risk-service` — facts derive from the post-binding view (`usd.reason` becomes NETWORK_RESET
  under drift; the M0 byte-exact fixture still pins the aligned output).
- `feed-service` — reads the typed (honestly empty) feed registry.

## Test seam

`_setFingerprintForTests(value)` / `_resetAlignmentBaselineForTests()` — exported test seams in
the same documented style as `history-service.chainFingerprint`; they inject a stale runtime
fingerprint so the B3 path is proven without editing `networks.js`. Production never overrides.

## Verification (recorded at delivery)

- `npm test` green: contract 130/130, quarantine 66/66, DeFi M0 98/98 (unchanged behavior),
  **registry 27/27** (seed pin, fingerprint pin, fixture equivalence, misalignment + recovery +
  event-exactly-once, zero storage writes), lifecycle 1017/1017, vault/thru-client integration.
- `npm run build` clean; layering 94 files / 0 violations; collector `--check` PASS.

## Remaining G1 (not in this slice)

- **G1-B feed plumbing:** publisher-key pinning rules + SignedFeedRecord verification gates
  (types + verification state machine), still honestly empty until a publisher exists.
- **G1-C market read layer:** asset/pool reads routed through registry capability checks; value
  reads still answer NO_INDEXER-specific unsupported states (no fabricated data).
- **Live rows:** the evidence session (`scripts/verify-token-transfer.mjs` + siblings on a
  network-reachable machine) feeds G0 open questions into seeds; the registry then carries
  live-verified rows and the capability matrix starts flipping — that is the owner's
  "verified launchpad capability matrix" track.
- Kill-switch rung activation when the first feed exists (the ladder rung is already in place).
