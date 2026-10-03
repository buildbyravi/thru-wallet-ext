# Architecture decisions

This file records durable choices and why they exist. Current behavior is in
`docs/STATUS_AND_ROADMAP.md`; implementation details are in `docs/ARCHITECTURE.md`.

## D-001 — Stable UI/background contract

**Decision:** UI calls one bridge; the background validates a versioned allowlist and owns auth.

**Why:** frontend replacement and Thru SDK changes must not alter wallet security behavior.

**Alternative rejected:** importing services, vault code, or RPC code into screens. That spreads
protocol churn and creates bypass paths.

**Trade-off:** additive contract evolution takes more ceremony.

**Consequence:** `test/test-contract.mjs` checks both directions and layering checks reject bypasses.

## D-002 — First-party Thru packages behind `src/lib/`

**Decision:** only infrastructure adapters import `@thru/sdk` or `@thru/programs`.

**Why:** the protocol is evolving and protocol behavior must not be recreated across services/UI.

**Alternative rejected:** direct SDK calls from features and screens.

**Trade-off:** adapter functions must preserve stable application shapes.

**Consequence:** dependency upgrades have a contained blast radius and golden vectors remain the
compatibility gate.

## D-003 — Session-only signing default

**Decision:** an unlocked session may sign by default. Users may enable password re-authentication for
every signature; changing the setting in either direction requires the master password.

**Why:** this is the explicit product decision selected during the 2026-10-03 audit remediation.

**Alternative:** require a password for every signature by default.

**Trade-off:** an unattended unlocked wallet can sign until auto-lock. Central auth, checked reviewed
context, auto-lock, duplicate protection, and one signing path remain mandatory.

**Consequence:** documentation must not claim password-per-sign is the default. Changing this policy
requires a preference migration decision and regression fixtures.

## D-004 — One checked signing path

**Decision:** native/token sends require reviewed source account and network. Contract v16 removed the
legacy unbound methods. Active network mutation is locked for the complete signing operation.

**Why:** the weakest callable signing method defines wallet security; mutable SDK binding cannot be
allowed to cross network contexts during asynchronous signing.

**Alternative rejected:** retain legacy callable mutation methods indefinitely for compatibility.

**Trade-off:** contract v16 deliberately removes methods after zero shipped callers were proven.

**Consequence:** tests fail if legacy handlers return or a network switch succeeds during signing.

## D-005 — Version durable state; rebuild caches

**Decision:** vault, preferences, contacts, labels, pending transactions, and deployed-token records
have explicit schema handling. Balance and History are network-scoped rebuildable caches with
freshness/chain-identity checks.

**Why:** installed wallets survive upgrades; future data must not be silently reinterpreted.

**Alternative rejected:** assuming empty storage or coercing unknown versions into current shapes.

**Trade-off:** migrations and fixtures are required for every schema change.

**Consequence:** unsupported future durable schemas fail closed; cache loss may affect first paint but
must never alter keys or transaction authority.

## D-006 — Delete retired implementations

**Decision:** the old UI and fabricated Launchpad/DEX/Prediction surface are deleted, not hidden.

**Why:** dormant duplicate implementations remain reachable attack and maintenance surfaces.

**Alternative rejected:** permanent feature flags and compatibility copies without deletion criteria.

**Trade-off:** rollback uses Git history rather than shipped dead code.

**Consequence:** quarantine, route, and DOM-sink tests prevent accidental return.
