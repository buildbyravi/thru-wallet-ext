# Architecture

**Status:** IMPLEMENTED unless a section is explicitly labelled otherwise. Source and tests remain authoritative.

## Dependency direction

```text
popup / side-panel routes
  → src/ui/app/bridge.js
  → src/shared/contract/manifest.js
  → src/background/api-router.js
  → src/background/services/*
  → src/lib/thru-client.js | src/lib/vault.js | src/lib/networks.js
  → pinned @thru/sdk and @thru/programs
```

`scripts/check-layering.mjs` enforces this direction, contains first-party Thru package imports in
`src/lib/`, forbids direct UI storage access, and permits one Chrome message owner per direction.
The UI cannot import the vault, backend services, network implementation, or RPC adapter.

## Authoritative responsibilities

| Concern | Authority |
| --- | --- |
| API compatibility and auth declaration | `src/shared/contract/manifest.js` |
| API dispatch, centralized auth, error envelope | `src/background/api-router.js` |
| Key material, encryption, derivation, account resolution | `src/lib/vault.js` |
| Thru RPC, transaction construction, program bindings | `src/lib/thru-client.js` |
| Network identity and verified capabilities | `src/lib/networks.js` |
| Network activation and adapter binding | `src/background/services/network-service.js` |
| Amount parsing/formatting | `src/shared/format.js` |
| Persistent user preferences | `src/background/services/preferences-service.js` |
| Submitted transaction lifecycle | `src/background/services/pending-tx-service.js` |
| UI DOM construction | `src/ui/kit/dom.js` |

## Signing and transaction boundary

Shipped UI calls only `tx.sendChecked` and `token.transferChecked`. Contract v16 removed the retired
unbound mutation methods. The background verifies authorization and reviewed account/network context.
A signing-operation guard prevents active-network rebinding from operation entry through submission
completion. Pending acceptance is recorded as `submitted`; it is never presented as confirmation.

The current adapter uses one process-level SDK binding. The operation guard is therefore a required
part of the design, not a UI convenience. A future immutable per-network SDK client may replace the
lock only with equivalent interleaving and live-network evidence.

## Persistent state

Global identity/security state includes the encrypted vault, unlocked trusted-context session,
account labels, contacts, preferences, lockout state, and active network identity. Chain-derived state
uses `scopedKey(base, networkId)` for balances, pending transactions, deployed tokens, and History.

Durable structured records use explicit schema versions and legacy migration handling. Unsupported
future versions fail closed. Balance and History stores are rebuildable caches: they are network
scoped, freshness-labelled, and discarded when chain identity evidence does not match. Schema changes
must add old→new fixtures before shipping.

## Optional features

Core wallet services do not depend on optional products. Future Launchpad, DEX, Prediction,
Portfolio, NFT, or token-product UI belongs under `src/features/<feature>/`; backend code uses a
separate feature namespace. Features never import the vault or implement signing. Detailed target
boundaries and deletion criteria are in `docs/MODULE_BOUNDARIES.md`.

## Verification boundaries

Deterministic Node tests enforce contracts, derivation vectors, transaction encoding, storage
migration, network isolation, layering, CSP, routes, lifecycle teardown, and secret hygiene. They do
not verify browser layout, Chrome extension lifecycle behavior, or live-chain semantics. Those remain
separate checks in `docs/MANUAL_SMOKE_CHECKLIST.md` and `docs/STATUS_AND_ROADMAP.md`.
