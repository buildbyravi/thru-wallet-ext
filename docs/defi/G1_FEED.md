# G1-B — Signed feed records: verification + narrowing (delivery record)

**Delivered 2026-10-06**, branch `arena/01a10804-thru-wallet-ext` (PR #19). Gate: G1
(read-only + registry/feeds/market layer), second slice. G1-A audit by the owner's agent on
2026-10-05 verified the registry slice green; this slice fills the FEEDS appendix behind it.
G1-C (market read layer) and the live evidence rows remain — see "Remaining G1" in
`G1_REGISTRY.md`.

## What G1-B builds

- **`src/background/services/defi/feed-record.js`** — the SignedFeedRecord type, the canonical
  signed bytes, per-record verification, and quorum aggregation.
- **`FEED_POLICY`** in the capability snapshot — honestly empty (no publishers, quorum 0, no
  required feeds), with the pinning rule written where it executes.
- **Registry integration** — verify-at-intake + sync reads, feed narrowing inside
  `getFeature`, and `feedChanged` events on real transitions only.

## The record

```json
{
  "recordVersion": 1,
  "feedId": "thru-ops",
  "networkId": "betanet",
  "fingerprint": "betanet|ta…|ta…|ta…|ta…|ta…",
  "publisher": "<hex 32-byte Ed25519 pubkey>",
  "issuedAt": 1759689600000,
  "expiresAt": 1759690200000,
  "ops": { "kill": ["balances"] },
  "signature": "<hex 64-byte>"
}
```

- **Crypto:** `@thru/sdk` `verifyWithDomain` over `SignatureDomain.MSG` — the same
  domain-separated Ed25519 the chain uses, off-chain message domain, so a feed record can
  never be replayed as a transaction. Signed bytes = canonical JSON (recursively sorted keys,
  no whitespace) of everything except `signature`.
- **v1 ops:** `kill` only. A quorum of distinct pinned publishers voting kill on a feature
  narrows that feature to `unsupported / KILL_SWITCH`.

## The verification state machine

Per record, in trust order (shape → chain → publisher → crypto → time):

`MALFORMED` · `NETWORK_MISMATCH` · `GENESIS_MISMATCH` · `PUBLISHER_UNPINNED` ·
`SIGNATURE_INVALID` · `RECORD_STALE` (expired, or issued beyond clock skew) · `VALID`

Aggregate over presented records per policy:

`INERT` (quorum 0 — the shipped truth) · `NO_FEEDS` · `QUORUM_NOT_MET` · `LIVE`, plus
`killFeatures[]` and `liveFeedIds[]` computed from distinct-publisher votes. One publisher =
one vote; spamming records buys nothing; an unpinned co-signer cannot reach quorum.

Wire mapping (S10 vocabulary): `GENESIS_MISMATCH → NETWORK_RESET`,
`RECORD_STALE → INDEX_STALE` (when the staleness matters to a required feed),
absent required feed `→ FEED_MISSING`, quorum'd kill `→ KILL_SWITCH`.

## Narrowing semantics (the standing rule: feeds narrow, never widen)

`getFeature` resolution order: **genesis binding → feed narrowing → dossier.**

1. GENESIS RESET dominates everything (a kill record signed for the old chain dies with the
   old fingerprint — records bind networkId + fingerprint).
2. Narrowing applies to **enabled** rows only: `KILL_SWITCH` (quorum kill vote), then
   `FEED_MISSING` (feature's required feed isn't LIVE).
3. Unsupported dossier rows are untouched — a kill on `swap` changes nothing;
   `PROGRAM_NOT_VERIFIED` stands.
4. **Flags still dominate**: a flag-off method answers `FLAG_OFF` before any feed state.

Ladder as it now exists end-to-end: `FLAG_OFF → KILL_SWITCH/FEED_MISSING → dossier(+reset)`.

## Events

`feedChanged` fires on a REAL aggregate transition only — boot re-establishes the baseline
silently, repeats of the same records emit nothing, and every transition
(`NO_FEEDS → LIVE`, kill activation, clear) emits exactly once with
`{ networkId, state, killFeatures, liveFeedIds }`.

## Verification (recorded at delivery)

- `npm test` green, including **`test/test-defi-feed.mjs` (35/35)**: canonical bytes, all six
  dishonest-record states, quorum/vote rules, narrowing on enabled rows only, flag and genesis
  dominance, narrow-never-widen, events-exactly-once, zero storage writes. M0 98/98 and
  registry 27/27 unchanged — the shipped policy is a proven no-op.
- Test seams (`_setFeedStateForTests`, `_resetFeedBaselineForTests`) are documented like the
  G1-A fingerprint seam; production never calls them.

## Boundary (where records come from — NOT this slice)

No transport exists: nothing pulls records from a server or chain event yet, and no publisher
is pinned. The flow that creates the first publisher is the evidence session, run on a
network-reachable machine (this sandbox has no Betanet egress):

```bash
# P3 — token transfer path, proving launchMint preconditions (throws away its own accounts)
node scripts/verify-token-transfer.mjs betanet

# Q22 — oracle feed read via the RPC path (THRU/USD source; exists:false is a valid answer)
node scripts/probe-oracle-feed.mjs --seed thru-usd --network betanet

# afterwards — re-check the offline evidence bundle still holds
node scripts/collect-offline-evidence.mjs --check
```

Their output lands as evidence seeds; a probe-verified publisher key then enters
`FEED_POLICY.publishers` with an evidenceRef, exactly like program addresses did — and the
fixture tests pin it. Record transport (server pull or oracle-event read) lands with the
first real publisher, inside the G1-C/G2 work.
