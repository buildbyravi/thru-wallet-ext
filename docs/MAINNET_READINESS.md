# Mainnet-readiness / multi-chain audit (2026-10-09, owner-directed, pre-G2)

Verdict per owner's checklist, each with where it is proven. The rule across all of them:
nothing hard-codes a network fact; every chain-specific answer comes from the network
config, a scoped storage key, or a live chain read (never a guess).

## 1. Testnet + mainnet as parallel networks — READY
`src/lib/networks.js` is the single typed registry: `betanet` (live, enabled), `localnet`
(disabled, local-only), `testnet` (declared+disabled — RPC/faucet positions unverified),
`mainnet` (declared+disabled: `faucetProgramId/stateAccount/maxPerClaim` all `null`, fees
`null/UNKNOWN`, `isTestnet:false`). Enabling any of them is two deliberate edits (config +
`manifest.json` connect-src) and `scripts/check-csp.mjs` fails in either direction of
disagreement, so a network cannot become selectable without its RPC also being permitted.

## 2. Data isolation (storage) — READY
`src/shared/network-scope.js` codifies the split and tests assert the key sets:
- **scoped per network** (`key::<networkId>`): balance cache, pending txs, deployed tokens,
  history cache (`test-storage-migrations.mjs`).
- **global on purpose**: vault/keys (one keyring controls the same address on every chain),
  account labels, contacts, prefs, unlock lockout, active network.
- Imported-token registry records **carry `networkId` inside the global prefs blob** and are
  filtered to the active network at read (`token-service.js:87`).
- DeFi read caches (G1-C) embed `networkId + fingerprint + params hash` in the cache key —
  (`read-cache.js:35`).

## 3. Faucet button — FIXED this pass
- `/faucet` route already refuses gracefully on faucet-less networks (`faucet.js:230`).
- Dashboard tap-tile: previously rendered + disabled; now **hidden unless the active network
  declares a faucet** (`applyNetworkCapabilities`, dashboard.js), and hidden until the
  network record first loads — no click-through flash on mainnet, per the owner word "hide".
- Backend `tx.claimFaucet` throws `The <id> network has no faucet.` when the config is null
  (thru-client.js:434) — the chain can never see a faucet tx on mainnet.

## 4. Sign tx across two chains — READY
- `signing-guard.js` freezes `network.setActive` during build/sign/submit (no mid-sign
  network hop); the wallet's single mutable binding cannot be confused between chains.
- `buildAndSign` fetches `chainId` (+ nonce/startSlot/expiry) **from the node being signed
  for** at build time — a transaction built under mainnet cannot be replayed on betanet by
  construction (chain binding inside the signed bytes, not client's memory).
- Program addresses come from the pinned packages; they are *chain constants by design
  (systems programs sit at the same address on every network — thruscan-concordant)*, any
  move lands via a deliberate pinned bump with a full regression pass.

## 5. Token management — READY
Deployed tokens scoped (`thru_deployed_tokens::<net>`); imported tokens networkId-filtered;
token-balance reads go through the active-network binding; token-lab/deploy surfaces tied to
`activeNetwork.tokenProgramId`.

## 6. Swap / launchpad / AMM / DeFi — READY (by gating design)
Feature flags OFF in every build; contract methods take an explicit `networkId`; capability
reads (`program.capabilities`, launchpad/market answers) resolve **per network** through the
registry (records carry `networkId`). Mainnet-specific capabilities (AMM presence, launchpad
deployments) are unknown → they answer `PROGRAM_NOT_VERIFIED`/absent, never assumed-on.

## 7. Resource budgeting for a fee-bearing chain — READY with one calibration note
`tx-units.autoUnits()` decides budgets by class + payload + live ceilings, fee
`0n-if-empty/1n-if-funded` — this mirrors the only two live-proven flows. **MAINNET CALIBRATION
LINE (open):** on a fee-bearing launch chain the tip value must come from a chain fact —
`networks.mainnet.baseFeeUnits` is `null` until measured (honest UNKNOWN, quoted as such by
`tx.estimateFee`); the budget module takes an override/ceiling, so pricing lands as config +
one measured probe, not as scattered code changes.

## What this does for G2
Data-management changes in G2 (intent pipeline, mint-only launch) build against
per-network-capable state and per-network contract params only — the audit's invariant list
(kept green by tests): scoped storage keys unmixed, no network-string conditionals scattered
into feature code, no faucet affordance or claim tx on faucet-less networks, cross-chain
replay impossible by chainId construction, disabled networks neither selectable nor CSPed.
