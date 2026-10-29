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
| Amount parsing/formatting (incl. the one 9-decimal THRU scale rule) | `src/shared/format.js` |
| Transaction review contract, decoder registry, error codes | `src/shared/tx-review/model.js` + `registry.js` + `decoders/` |
| Review preparation, binding, recheck, dispatch to signing | `src/background/services/review-service.js` + `services/review/{kinds,store}.js` |
| Review rendering and the confirm→auth→submit step | `src/ui/domain/tx-review/review-card.js` + `confirm.js` |
| Persistent user preferences | `src/background/services/preferences-service.js` |
| Submitted transaction lifecycle | `src/background/services/pending-tx-service.js` |
| UI DOM construction | `src/ui/kit/dom.js` |

## Signing and transaction boundary

No UI route signs. A value-moving route calls `tx.prepareReview`, renders
`src/ui/domain/tx-review/review-card.js`, and submits through `tx.confirmReview`
(`src/ui/domain/tx-review/confirm.js`). `confirmReview` re-validates and returns the exact submit
instructions (`method` + `params`); the helper then calls that operation's existing signing method
through the bridge — `tx.sendChecked`, `token.transferChecked`, `name.register` /
`name.purchase` / `name.renewLease` / `name.claimExpired`, or `tx.claimFaucet` — and discards the
review on success. Neither `prepareReview` nor `confirmReview` signs. Contract v16 removed the retired
unbound send mutations; contract v29 added the review trio (`prepareReview`, `confirmReview`,
`discardReview`), all `auth: 'unlocked'` and none of them signing — `confirmReview` returns
`{method, params}` for the existing signed call. The background verifies
authorization and reviewed account/network context on prepare and again on confirm, and a
signing-operation guard prevents active-network rebinding from operation entry through submission
completion. Pending acceptance is recorded as `submitted`; it is never presented as confirmation.

The only signing-adjacent call a UI file makes by name is the v12 activation path,
`tx.registerAccount` (`auth:'unlocked'`, exact vault-owned address, zero declared fee, signed with
that account's own key). Dashboard uses it for the active account and Send uses it JIT for an owned
recipient. `test/test-tx-review.mjs` [14] scans `src/ui/**/*.js` for `bridge.send('…')` literals and
fails on any `auth:'signing'` method, so the older `tx.autoCreateAccount` cannot come back through a
route (it was removed from Dashboard; see `docs/DEFECT_LOG.md` §10).

The review boundary is also a decoding boundary: `decoders/` produces explicit facts for known
intents (`native-send`, `token-transfer`, `domain-register`, `domain-purchase`, `domain-renew`,
`domain-claim`, `domain-record`, `faucet-claim`) and an explicit unknown with raw data (and no
submit policy) for everything else. Facts that assert something about the chain are three-state
where the chain can fail to answer: `domain-record`'s existence/ownership are `null` when the read
failed, and the card then says "could not be verified" instead of asserting an absence. A review
service never guesses a friendly name for an instruction it cannot decode, and never fabricates a
fee, balance change, or simulation result. `tx.simulate` answers `supported:false` on the current
backend, so post-transaction balances are always unavailable by policy, not by omission.

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

Domain tracking (contract v30) is owned by `primary-name-service.js`, alongside primary
aliases. `thru_registered_domains::<networkId>` stores `{version:1, revision, records}`;
each candidate carries its account address, name/root/domain identity, last check status,
and verification timestamps. The absent-registry v0 migration projects existing
`thru_primary_names::<networkId>` aliases without RPC or a read-side write. The next
mutation atomically persists both keys, preserving the old primary-key shape. Unlinking
therefore migrates the old primary before removing its alias. Unsupported versions fail closed.

All registry/primary mutations share a per-network queue. Refreshes only apply to their
unchanged revision, so a late read cannot resurrect an untracked name or overwrite newer
primary/import edits. Reads capture an RPC client before asynchronous derivation; the
adapter's optional bound-client `getAccountInfo` argument prevents cross-network hydration
without blocking network switching. Cached candidates are always stale. Fresh ownership
requires the name-service program, derived identity, decoded name/parent and wallet owner
to agree. Import and primary selection recheck ownership in the backend; local untracking
is not a chain operation. Confirmed registration handlers retain candidates before returning,
even if the popup closes. Persistence failure is reported separately from transaction success.
Program-owner metadata is normalized through `thruClient.getAccountOwnerAddress`: SDK
`Pubkey` objects require `toThruFmt()`, never `String(object)`. Malformed metadata stays unknown.
Wallet reset clears both stores across networks and invalidates late reads/registration saves
with a process-local generation; in-flight storage writes settle before cleanup completes.

## Smart contract integration & engineering policy

All on-chain program integrations (native programs, official registry, custom registrar, token standards, and future DeFi/AMM modules) adhere to `docs/GLOBAL_SMART_CONTRACT_POLICY.md`. Key invariants:
1. **Inspect before build or reuse**: verify ABI, account layouts, and opcode behavior against official Thru protocol implementations before implementation.
2. **Reuse vs. new program hierarchy**: prefer standard SDK and protocol contracts; deploy custom programs only when justified by unresolvable upstream gaps, strictly maintaining integer-only BigInt arithmetic and PDA derivation safety.
3. **Official source reuse discipline**: modified or extended contracts must have separate namespaces, explicit delta documentation, and must never masquerade as official protocol programs.
4. **Mainnet deployment gates**: zero-warning builds, 100% deterministic test passes, Betanet live verification, key security governance, and audit sign-off are required prior to Mainnet release.

## Optional features

Core wallet services do not depend on optional products. Future Launchpad, DEX, Prediction,
Portfolio, NFT, or token-product UI belongs under `src/features/<feature>/`; backend code uses a
separate feature namespace. Features never import the vault, implement signing, or own a signing
screen: they add a decoder + a kind spec and reuse the shared review pipeline. Detailed target
boundaries and deletion criteria are in `docs/MODULE_BOUNDARIES.md`.

## Verification boundaries

Deterministic Node tests enforce contracts, derivation vectors, transaction encoding, storage
migration, network isolation, layering, CSP, routes, lifecycle teardown, and secret hygiene. They do
not verify browser layout, Chrome extension lifecycle behavior, or live-chain semantics. Those remain
separate checks in `docs/MANUAL_SMOKE_CHECKLIST.md` and `docs/STATUS_AND_ROADMAP.md`.
