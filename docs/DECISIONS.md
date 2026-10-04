# Architecture decisions

This file records durable choices and why they exist. Current behavior is in
`docs/STATUS_AND_ROADMAP.md`; implementation details are in `docs/ARCHITECTURE.md`.

**Numbering note (2026-10-04):** D-001–D-009 now follow the canonical topic list (bridge, SDK
pinning, signing default, network-scoped state, quarantine, one UI stack, SDK adapter boundary,
documentation hierarchy, strangler migration). D-003 kept its number and topic. Two prior
decisions with no slot in that list continue as D-010/D-011. No decision was deleted and no
decision changed; this was a renumbering plus explicit recording of policies that previously
lived only in `AGENTS.md` and audit history.

## D-001 — One UI/backend bridge

**Context.** The UI must reach the background (vault, signing, RPC) somehow, and every reachable path is an attack surface. The deleted legacy stack also showed UI code importing services directly, which spread protocol churn and created bypass paths.

**Options considered.** (a) UI imports services/vault/RPC modules directly; (b) an ad-hoc message protocol per screen; (c) one versioned, allowlisted bridge with background-owned auth.

**Chosen.** UI calls one bridge, `bridge.send(method, params)`; the background validates a versioned allowlist (`src/shared/contract/manifest.js`) and owns authorization.

**Why.** Frontend replacement and Thru SDK changes must not alter wallet security behavior, and the callable API surface must be auditable in one place.

**Trade-offs.** Additive contract evolution takes more ceremony than calling services directly.

**Consequences.** `test/test-contract.mjs` checks the contract in both directions; `scripts/check-layering.mjs` enforces the import rules and the single `chrome.runtime.sendMessage` owner per direction (`src/ui/app/bridge.js` outbound, `event-service.js` inbound).

## D-002 — Exact Thru SDK version pinning

**Context.** Derivation, address encoding, transaction wire formats, and program bindings all come from `@thru/sdk` and `@thru/programs`. A floating or caret range could change key derivation or wire encoding between installs without any code review; a wrong address or instruction is a direct fund-loss vector.

**Options considered.** (a) SemVer ranges for easy upgrades; (b) exact pins with a mandatory upgrade protocol; (c) vendoring the SDK.

**Chosen.** Exact pins only (currently `@thru/sdk` and `@thru/programs` at `0.4.1`), `npm ci` as the install gate, and golden vectors for mnemonic→key→address derivation, public keys, amount conversion, and transaction encoding/decoding.

**Why.** Wallet addresses must never change silently. The goldens make any derivation or encoding drift fail the build instead of shipping.

**Trade-offs.** Upgrades require deliberate work: changelog/API review, full deterministic suite (derivation, transaction, network, migration tests), bundle inspection, and a recorded reason.

**Consequences.** An unexpected golden-vector change is a STOP condition — investigate, never merely update the expected value. The 0.4.0→0.4.1 upgrade was verified this way with unchanged golden addresses (`test/test-derivation.mjs`).

## D-003 — Session-only signing default

**Context.** Every value-moving operation needs an authorization policy. Requiring the master password for every signature is the most conservative option; requiring only an authenticated session is more usable on a wallet that auto-locks. Major self-custody wallets follow the same shape: an authenticated unlock session with configurable auto-lock (e.g. Phantom, Keplr), not a mandatory password before every transaction.

**Options considered.** (a) Password required for every signature by default; (b) an authenticated session may sign by default, with an opt-in per-signature password policy; (c) per-operation prompting.

**Chosen.** **Session authentication is sufficient for signing unless the user enables stronger signing authentication.** An unlocked session may sign by default (`requirePasswordForSigning: false`); users may enable password re-authentication for every signature; changing the setting **in either direction** requires the master password. The default chain is: encrypted vault → password unlock → authenticated session → auto-lock → signing authorization → transaction review → signature. The stronger policy inserts password re-auth between review and signature.

**Why.** Deliberate product/security decision — selected during the 2026-10-03 audit remediation and confirmed by the owner 2026-10-04. It is a legitimate wallet UX model, not a weakened security posture.

**Invariants — all eight verified against source and tests on 2026-10-04; the decision stands only while they hold:**
1. the wallet is locked unless authenticated (router `WALLET_LOCKED` gate on every auth-gated method);
2. session authentication is secure (PBKDF2-SHA-256 600k + AES-256-GCM vault with per-record KDF envelope, unlock throttling/backoff, trusted-context session storage);
3. auto-lock works correctly (inactivity-based with activity stamping; `test/test-autolock.mjs`);
4. signing is authorized by the unlocked session (`auth: 'signing'` requires unlocked);
5. users may optionally require password re-authentication before signing (`requirePasswordForSigning`);
6. changing that preference is itself password-gated (`settings.setSecurity` is `auth: 'password'`; generic `settings.set` rejects security fields);
7. documentation accurately describes the default;
8. tests cover both default and opt-in modes (`test/test-api-router.mjs` [8]).

**Trade-offs.** An unattended unlocked wallet can sign until auto-lock fires. Centralized `auth: 'signing'` policy, checked reviewed account/network context, the signing-operation network lock, duplicate-submission protection, inactivity auto-lock, and the one signing path remain mandatory regardless of this setting. The Settings dialog's "This is less secure" line appears only when a user switches **from** per-sign re-auth **to** session-only — a directional risk disclosure at that moment, not a description of the default state.

**Consequences.** Documentation must never describe the default as "password protection off"; the accurate model is the Chosen sentence above, and it must never be claimed that password-per-sign is the default. Do not change this decision merely because a reviewer prefers password-per-transaction; changing it requires a preference migration decision and regression fixtures covering both modes.

## D-004 — Network-scoped chain state

**Context.** The wallet declares multiple networks (Betanet enabled today; Localnet, Testnet, Mainnet declared-disabled; custom chains possible later). A balance, pending transaction, token mint, or history cache is only meaningful on one chain. The defect log records a near-miss where a block-time cache keyed by slot alone would have shown one chain's timestamp on another.

**Options considered.** (a) One shared store keyed by address/signature only; (b) per-network storage namespaces with an asserted global/scoped split; (c) wiping all caches on every network switch.

**Chosen.** Stable network ids (never display names) as the identity, and `scopedKey(base, networkId)` in `src/shared/network-scope.js` for chain-derived state. Balances, pending transactions, token registry/deployed tokens, and History caches are scoped; vault/keys, account labels, contacts, preferences, lockout, and the active-network id are global. Caches are discarded when chain-identity evidence does not match rather than wiped on every switch.

**Why.** Switching networks must never show the previous chain's pending transactions or a token list of mints that do not exist there; wiping on every switch would discard valid last-known state needlessly.

**Trade-offs.** Every new persisted key must be classified global-or-scoped deliberately.

**Consequences.** The GLOBAL_KEYS/SCOPED_KEYS sets are frozen and asserted in tests, so a future key cannot be silently scoped or unscoped. Network switching needs no cache wiping, and switching back preserves each chain's own state.

## D-005 — Launchpad/DEX/prediction quarantine

**Context.** A legacy launchpad page shipped built-but-disabled with `innerHTML` rendering of on-chain token metadata, a fabricated swap quote (`parseFloat` × hard-coded rate), and simulated prediction orders. No verified chain semantics existed behind it.

**Options considered.** (a) Keep it flag-disabled; (b) migrate it onto the guarded kit; (c) delete it and quarantine by test.

**Chosen.** Deletion, not hiding: `src/launchpad/**`, its build entry, flags, URL override, and dashboard banner are gone. `test/test-launchpad-quarantine.mjs` (47 checks) fails the build if any of it returns in source or `dist/`.

**Why.** A flagged-off page that still ships is not a security boundary, and migrating 2,000 lines of fabricated-quote UI had no verified protocol to migrate onto. Dormant duplicate implementations remain reachable attack and maintenance surfaces.

**Trade-offs.** Any future launchpad/DEX/prediction surface is new work, not a re-enable. It returns only as an isolated `src/features/<feature>/` module with its own backend namespace, verified chain data (never fabricated quotes), centralized signing, and a deliberate same-PR update to the quarantine test — per `docs/MODULE_BOUNDARIES.md`.

**Consequences.** Backend `token.*` wallet-contract methods remain (append-only contract); they do not imply any launchpad UI exists. Wallet core is built and stabilized before any optional feature.

## D-006 — One UI stack

**Context.** The repository migrated from a legacy `show()`/`#screen-*` monolith to a hash-router route stack. During the migration, unreachable finished routes, shadowing screens, and duplicated logic between stacks caused real user-facing failures (defect log §1).

**Options considered.** (a) Keep both stacks with a fallback bridge indefinitely; (b) one active route tree with a strangler migration and same-commit deletion of migrated screens; (c) big-bang rewrite.

**Chosen.** Exactly one route tree: 14 routes in `src/ui/app/boot.js`, one Router, one bridge, one DOM factory. There is no legacy fallback path; an unknown hash redirects to the router fallback.

**Why.** Two stacks means every fix lands twice or not at all, and the weaker stack defines the user's experience. The migration itself is D-009.

**Trade-offs.** Legacy behavior is recoverable only from Git history. Any new screen must be a route — there is no side door.

**Consequences.** `scripts/check-routes.mjs` enforces both directions (every navigated route exists; every registered route is reachable), and `test/test-route-lifecycle.mjs` mounts all 14 routes in all three vault states. A future second frontend (e.g. full-tab) requires a new explicit decision, not a quiet exception.

## D-007 — Thru SDK adapter boundary

**Context.** The Thru protocol and its SDK evolve. Protocol-specific code scattered across UI or services would make every SDK release a cross-cutting change and invites hand-rolled protocol reimplementation (a historical hand-rolled mint derivation called a non-existent SDK method and threw for months).

**Options considered.** (a) Import `@thru/*` wherever convenient; (b) contain first-party Thru imports to the infrastructure layer; (c) invent adapter wrappers for every SDK call.

**Chosen.** Only `src/lib/` (`vault.js`, `thru-client.js`, `networks.js`) imports `@thru/sdk` (including `@thru/sdk/crypto`) and `@thru/programs`. Official builders/parsers/derivations are used instead of hand-written protocol code. Adapters are created only where SDK volatility or feature specialization justifies them (`src/lib/thru/*-adapter.js` is a documented future shape, not shipped ceremony).

**Why.** Protocol churn must have a contained blast radius, and one implementation of each protocol behavior must exist.

**Trade-offs.** Adapter functions must preserve stable application shapes; adding a protocol behavior means touching the infrastructure layer rather than the nearest caller.

**Consequences.** `scripts/check-layering.mjs` rejects `@thru/*` imports outside `src/lib/`. Dependency upgrades (D-002) have a contained blast radius, and golden vectors remain the compatibility gate.

## D-008 — Documentation source-of-truth hierarchy

**Context.** The repository repeatedly shipped documentation drift: STATUS/LEDGER claimed contract v12 while source was v16, the SDK pin was recorded as 0.3.16 after the 0.4.x migration, "Alphanet enabled" survived the Betanet cutover, and README misstated the signing default (audit findings F-01…F-06, 2026-10-04). Contradictory current claims are a security problem: a user or agent acting on the wrong policy or capability can lose funds.

**Options considered.** (a) Fix docs ad hoc when noticed; (b) one monolithic document; (c) explicit per-document ownership with a conflict-resolution hierarchy.

**Chosen.** Explicit ownership: `AGENTS.md` (permanent rules) · `docs/DOCS_INDEX.md` (which doc to trust) · `docs/STATUS_AND_ROADMAP.md` (current state + open checks — start here) · `docs/PROJECT_LEDGER.md` (identifiers, phase history) · `CONTEXT.md` (file facts) · `docs/BUILD_SPEC.md` (product/security behavior) · `docs/DECISIONS.md` (durable decisions) · `docs/BACKEND_GAPS.md` (capabilities/unsupported) · `docs/MANUAL_SMOKE_CHECKLIST.md` (browser-only runbook) · `docs/archive/` (historical only). `src/`, tests, and scripts always outrank documentation. One explanation lives in its owning document; others link instead of copying.

**Why.** Documentation that summarizes code drifts unless each claim has exactly one owner and a defined conflict order.

**Trade-offs.** Editors must know the index before writing; a fact change touches the owning doc plus pointers.

**Consequences.** Current-state identifiers (contract version, method count, SDK pin, enabled networks, signing default) live in `docs/PROJECT_LEDGER.md` §1/§8 and are cross-checked against `src/`. Status terms (IMPLEMENTED, TESTED, VERIFIED AGAINST LIVE NETWORK, UNVERIFIED, BLOCKED, PLANNED, EXTERNAL AUDIT REQUIRED) must be used precisely; a Node test never closes a browser or live-chain item. The 2026-10-04 pass reconciled all maintained documents after the drift findings.

## D-009 — Legacy strangler migration

**Context.** The UI rebuild could not be a big-bang rewrite (the wallet had to stay shippable), but a long-lived dual-stack period was itself the source of the worst historical defects (unreachable routes, duplicated logic, stale fallbacks).

**Options considered.** (a) Big-bang rewrite; (b) indefinite dual-stack with feature flags; (c) strangler migration: one path at a time, replacement proven, old code deleted in the same commit.

**Chosen.** Migrate one screen at a time: replacement → behavior comparison → tests → route switch → real verification → old-code deletion in the same commit. Temporary compatibility layers must state purpose, dependents, exit condition, and deletion condition. Git is the rollback mechanism, not shipped dead code.

**Why.** Proven replacement plus immediate deletion is the only combination that avoids both big-bang risk and permanent duplication.

**Trade-offs.** Each step is slower than a flag flip; deletion makes any mistake recoverable only through Git history.

**Consequences.** The UI migration completed this way (one route tree, D-006). The migration-era `boot()` fallback surface was deleted once zero callers remained (2026-10-04, audit finding F-08), and the launchpad deletion followed the same discipline (D-005).

## D-010 — One checked signing path

**Context.** After contract v11 added `tx.sendChecked`/`token.transferChecked` (reviewed source account and network pinned at the backend boundary), the older unbound `tx.send`/`token.transfer` remained callable. Two signing contracts meant the weaker one defined wallet security.

**Options considered.** (a) Keep the legacy methods indefinitely for compatibility; (b) make them aliases with checked semantics; (c) retire them once zero shipped callers remained.

**Chosen.** Contract v16 removed the unbound send methods and their handlers after confirming every shipped UI caller uses checked methods. Active-network mutation is locked for a signing operation's full duration (entry through submission).

**Why.** The weakest callable signing method defines wallet security; mutable SDK network binding must never cross network contexts during asynchronous signing.

**Trade-offs.** A deliberate compatibility break (documented alongside the v5–v7 security exceptions); any external caller of the old names breaks loudly rather than silently weakening.

**Consequences.** Contract tests fail if legacy handlers return or if a network switch succeeds during signing. New signing methods must bind reviewed context and cannot be added unbound.

## D-011 — Version durable state; rebuild caches

**Context.** Installed wallets survive upgrades. Durable records (vault, preferences, contacts, labels, pending transactions, deployed tokens) must not be silently reinterpreted by a newer or older build, while chain-derived data (balances, History) is only a cache of what the chain already knows.

**Options considered.** (a) Assume empty storage / coerce shapes on read; (b) explicit schema versions with old→new migrations and fail-closed future versions; (c) version everything including disposable caches identically.

**Chosen.** Durable records carry explicit schema versions with tested migration paths; a record from a newer schema fails closed with a clear error. Balances and History remain network-scoped, freshness-labelled, rebuildable caches with chain-identity checks.

**Why.** Future data must not be silently relabeled as current (especially security fields), and losing a cache must never affect keys or transaction authority.

**Trade-offs.** Every durable schema change requires migration fixtures and a version bump — more ceremony than mutating shapes in place.

**Consequences.** `test/test-storage-migrations.mjs` covers v0→v1 migrations and future-version refusal; unsupported future versions fail loudly instead of masquerading as a wrong password or empty state.
