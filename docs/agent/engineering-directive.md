# Engineering directive — on-demand detail

Referenced from `AGENTS.md`. This file is the FULL text of the engineering directive and the
architecture, transaction, delivery and security-review invariants. `AGENTS.md` carries the
short version plus the hard rules; read this file before an architectural, signing, storage or
migration change.

The hard rules (1–17) live in `AGENTS.md`. The long text behind rules 10, 14, 15, 16 and 17 is in
`docs/agent/rules-detail.md`.

## Mainnet-ready engineering directive

This repository is production software now. Betanet is a deployment stage, not permission for
temporary security, architecture, validation, protocol behavior, or storage. Engineer every private
key, transaction, and persisted wallet state as though it already belongs to a Mainnet user.

For every change: **preserve → understand → reuse → centralize → isolate → test → verify → ship →
document → delete obsolete code**. Never copy → patch → duplicate → hide → “fix later.” Read the
implementation, tests, defect history, current docs, dependency boundaries, and blast radius before
editing. Search for equivalent names and behavior before adding any helper, service, component,
validation, API call, CSS, transaction builder, or signing path. Implement the smallest correct
change in the correct layer.

Optimize for correctness, security, auditability, maintainability, deterministic behavior, upgrade
safety, reuse, testability, and controlled blast radius—not for making one screen work quickly.
Duplication is a security problem: address validation, amount parsing/formatting, network identity,
account resolution, transaction preparation/validation, authorization, signing, password checks,
asset/error normalization, storage schemas, and SDK adaptation each require one authoritative
implementation. Reuse established security-sensitive wallet primitives; UI components must not
reimplement them. Modularity means stable responsibilities and limited dependencies, not one file
per function.

**Architecture freeze (2026-10-04):** the wallet core has converged — exact SDK pins with golden
vectors, one UI/backend seam, network-scoped state, checked signing with the network-mutation
lock, versioned storage, secret hygiene, strict CSP, launchpad quarantine, one UI stack, and
route/lifecycle coverage. Do not accept an architectural refactor without a measurable security,
correctness, performance, or maintainability benefit that names the failure it prevents, the
duplication it removes, or the boundary it improves — and the test that proves it. The current
priority is verification (real browser, live chain, races, external audit), not restructuring.

Use these status terms precisely: **IMPLEMENTED, TESTED, VERIFIED AGAINST LIVE NETWORK,
UNVERIFIED, PARTIALLY IMPLEMENTED, BLOCKED, PLANNED, DEPRECATED, SECURITY REVIEW REQUIRED,
EXTERNAL AUDIT REQUIRED**. Never claim verification that did not occur or describe plans as shipped.
Do not use “community build,” “prototype,” “testnet only,” “temporary implementation,” or “not for
real funds” as an excuse or status unless factually necessary.

### Architecture and compatibility invariants

- Core wallet capabilities (vault/keyrings, accounts, networks, assets, balances, transactions,
  signing, receive, history, settings, security) remain independent of optional products. Optional
  features belong under `src/features/<feature>/` when that isolation provides real value and may
  request wallet operations only through stable application interfaces. They never access private
  keys, mnemonics, decrypted vaults, or encryption keys.
- Dependency direction is UI → application/service interface → bridge → backend API contract →
  backend services → Thru adapter/vault/RPC. UI never imports backend, crypto, vault, or raw RPC
  implementation; backend never imports UI. Contain Thru SDK churn at the adapter/infrastructure
  boundary. Never scatter SDK calls across UI/features or hand-roll crypto, derivation, program
  addresses, instruction encoding, or protocol serialization when an official implementation exists.
- Pin all Thru SDK/program dependencies exactly. An upgrade requires changelog/API review, full and
  deterministic wallet/encoding/network/migration tests, bundle inspection, a recorded reason, and
  before/after behavior comparison. If derivation or another golden vector changes unexpectedly,
  stop and determine why; never merely update the expected value.
- Protect golden vectors for mnemonic/key derivation, public keys, address encoding, amount
  conversion, transaction encoding/decoding, and critical network identifiers. Unexpected drift
  fails the build.
- Treat backend APIs as compatibility boundaries. Prefer additive methods, migrate every caller,
  prove zero references and tests, then deliberately remove legacy methods. Do not silently reshape
  existing methods.
- Version persisted vault, preferences, account metadata, address book, networks, token registry,
  pending transactions, assets, and feature state. Every schema change requires an explicit
  old → migration → new path with regression fixtures. Never assume an empty wallet or silently
  reinterpret old data. Stop for clarification before changing storage semantics.
- Identify networks with explicit stable identity—not display names—and scope balances, pending
  transactions, history/cache, token metadata, assets, and network settings by network. Keys,
  keyrings, wallets, and account labels may be global. Switching networks must never leak state.

### Transaction and signing invariants

Transactions move explicitly through draft → validated → review → authenticated → signed → submitted
→ pending → confirmed. Represent rejected, simulation-failed, submission-failed, timeout,
network-error, and unknown distinctly. RPC acceptance is not confirmation. Before signing, verify the
active account and network, recipient, amount, sufficient balance, authorization, and freshness where
applicable. Prevent duplicate submission, replay, stale-account/network signing, and review-to-sign
recipient or amount alteration.

There is one authoritative signing path. DEX, Launchpad, Prediction, NFT, and future modules request
signatures through wallet services and never access seeds/private keys or implement signing. Do not
guess protocol wire formats, fee units, activation semantics, token standards, simulation, explorer
routes, signing behavior, or provider standards; unsupported is safer than fabricated behavior.

### Delivery, migration, and security review

Migrate legacy UI by strangling one path at a time: replacement → behavior comparison → tests → route
switch → verification → old-code deletion. A temporary compatibility layer must state its purpose,
dependencies, exit condition, and deletion criteria. Once replacement is proven, delete old routes,
handlers, markup, CSS, helpers, and compatibility code; Git is rollback.

Before merge, explicitly review whether the change can expose secrets, bypass password/signing
authorization, alter recipient/amount/derivation, mix network data, weaken CSP, enable XSS/replay or
duplicate submission, persist secrets, or create another signing path. Add focused tests for every
applicable risk. Diagnostics may record method, error category, network ID, timing, state transition,
module, and appropriate transaction signatures; never log mnemonics, private keys, passwords,
decrypted vaults, encryption keys, or raw secrets. Keep diagnostics local unless safe telemetry is
deliberately designed.

Do not weaken quality gates. Done means implemented in the correct layer, one source of truth,
regression coverage, security review, successful build/full tests, reachability verification,
real-browser checks where required, current documentation, and deletion of replaced legacy code.
Keep commits small and logically isolated. Stop instead of guessing when product/protocol/network
semantics are uncertain, an SDK invariant changes, a test would need weakening, a second source of
truth/router/store/bridge is proposed, a security boundary is crossed, or persisted-wallet migration
could be affected.
