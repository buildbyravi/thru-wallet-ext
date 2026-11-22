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

**Chosen.** Exact pins only (currently `@thru/sdk` and `@thru/programs` at `0.5.2`), `npm ci` as the install gate, and golden vectors for mnemonic→key→address derivation, public keys, amount conversion, and transaction encoding/decoding. The 0.4.2→0.4.4 upgrade removed the obsolete native-faucet rate-limit dependency: the native THRU faucet has no per-account policy, while the separate THRUSD faucet's limit does not apply to native claims. The legacy `tx.getFaucetLimit` contract method remains explicitly not applicable.

**Why.** Wallet addresses must never change silently. The goldens make any derivation or encoding drift fail the build instead of shipping.

**Trade-offs.** Upgrades require deliberate work: changelog/API review, full deterministic suite (derivation, transaction, network, migration tests), bundle inspection, and a recorded reason.

**Consequences.** An unexpected golden-vector change is a STOP condition — investigate, never merely update the expected value. The 0.4.0→0.4.1 and 0.4.1→0.4.2 upgrades were verified this way with unchanged golden addresses (`test/test-derivation.mjs`).

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

**Chosen.** Exactly one route tree: 15 routes in `src/ui/app/boot.js`, one Router, one bridge, one DOM factory. There is no legacy fallback path; an unknown hash redirects to the router fallback.

**Why.** Two stacks means every fix lands twice or not at all, and the weaker stack defines the user's experience. The migration itself is D-009.

**Trade-offs.** Legacy behavior is recoverable only from Git history. Any new screen must be a route — there is no side door.

**Consequences.** `scripts/check-routes.mjs` enforces both directions (every navigated route exists; every registered route is reachable), and `test/test-route-lifecycle.mjs` mounts all 15 routes in all three vault states. A future second frontend (e.g. full-tab) requires a new explicit decision, not a quiet exception.

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

**Chosen.** Explicit ownership: `AGENTS.md` (permanent rules) · `docs/DOCS_INDEX.md` (which doc to trust) · `docs/STATUS_AND_ROADMAP.md` (current state + open checks — start here) · `docs/PROJECT_LEDGER.md` (identifiers, phase history) · `CONTEXT.md` (file facts) · `docs/BUILD_SPEC.md` (product/security behavior) · `docs/DECISIONS.md` (durable decisions) · `docs/BACKEND_GAPS.md` (capabilities/unsupported) · `docs/guides/*` (cohesive subsystem guides) · `docs/MANUAL_SMOKE_CHECKLIST.md` (browser-only runbook) · `docs/roadmap/FUTURE_ROADMAP.md` (planned/unshipped specs) · `docs/audits/` (append-only historical audit snapshots). `src/`, tests, and scripts always outrank documentation. One explanation lives in its owning document; others link instead of copying.

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

## D-012 — DeFi/launchpad workstream opened under owner direction, verify-first gating

**Context.** The owner-confirmed order of 2026-10-04 (`docs/STATUS_AND_ROADMAP.md` §2) put wallet-core verification first with no DEX/launchpad/prediction work, and D-005 fences any launchpad re-entry. On 2026-10-05 the owner directed backend-only DeFi work (swap, pools, launchpad) under an imported two-file backend/frontend build prompt (shared-contract v1.0.0, fingerprint ca11b7bc…3147e5) with the staged sequence: Gate 0 dossier → M0 contract drop → verified capability matrix → real fixtures → mint-only launch pipeline.

**Options considered.** (a) Refuse or defer until the wallet-core steps close; (b) start immediately against memory/docs assumptions; (c) start under the imported spec's verify-first regime with every live-verification dependency mapped as a dossier row.

**Chosen.** (c). The owner may change the order; what may never change is *how* this surface gets built. The imported spec is adopted because it enforces D-005's re-entry conditions structurally: build only from recorded chain evidence (R1), exit paths verified before entry (R2), one signing pipeline (R12), honest unsupported states (R15), flags that cannot be URL/storage-enabled (R16), and the deliberate same-change quarantine-test rewrite (B16).

**Why.** A silent deviation from the 2026-10-04 order would be the failure mode this repository repeatedly names. The order change is explicit, dated, and recorded here; the stricter spec gives the launchpad more gates, not fewer.

**Trade-offs.** Gate 0's live rows need a network-reachable machine (the build sandbox cannot reach Thru endpoints — `scripts/defi-evidence/2026-10-05-environment-egress.json`), so "verified capability matrix" and any enabled write path wait on live evidence; the wallet-core sequence (steps 3–10) remains open in parallel and its chain-facing parts are now also dossier rows (step 4 ↔ Q2/Q4/Q6, step 6 ↔ Q13 = P3, step 7 ↔ Q6/Q7/Q22).

**Consequences.** Contract versions assigned READ = 17, EXEC = 18 (repo is v16/81 — the prompt's "15/83" parenthetical was corrected at recon). No feature code exists at G0; the first code change is M0 plus the B16 quarantine rewrite. All records live in `docs/defi/` + `scripts/defi-evidence/`; today every DeFi capability is seeded `unsupported`. D-005 stays in force; guides 09–11 are absent from this checkout and treated as superseded.

## D-013 — Canonical name root derived from official source; .thru preferred over .id

**Context.** The canonical-root candidates shipped at `2fdfe11` mixed a first-party pin (`BOOTSTRAP_PROGRAM_ADDRESSES.thru_registrar`, which is the executable program account and never parses as a root registrar) with a hardcoded third-party fact (ThruScan's `.id` root). On 2026-10-09 the official docs (`thru.org/docs/cli-reference/{registrar,name-service}-commands/`) plus the first-party `thru` CLI 0.4.1 derive-* helpers yielded the official derivation: root registrar = `deriveProgramAddress({ programAddress: NAME_SERVICE_PROGRAM, seed: raw root-name bytes })`, and documented that `.thru` is the OFFICIAL namespace (paid leases) while `.id` is a community root.

**Options considered.** (a) Keep the hardcoded candidate list as shipped; (b) hardcode the two newly-derived addresses with dated evidence; (c) derive candidate addresses in code from the official formula and order them official-first, keeping the parse-before-use proof.

**Chosen.** (c): `src/lib/name-service.js` exports `rootRegistrarAddress(rootName)` / `registrarConfigAddress()` (pins proven in tests against the CLI outputs), and discovery walks `[.thru, .id]` — derived in code, never pasted. The parse-before-use behavior is unchanged: an initialized `.thru` registry wins on any chain where it exists, `.id` remains the fallback on Betanet today, and a chain with neither still answers NAME_ROOT_UNKNOWN with the manual-root UI path.

**Why.** Deriving from the official formula removes the last third-party-sourced address from the read path, and the priority order reflects the documented namespace ownership (official registry leases vs a community root) without asking the user to choose.

**Trade-offs.** A user holding only a `.id` name on a future chain where the `.thru` registry initializes would see lookups resolve under `.thru` first; explicit-root lookups (the UI's manual field) remain available, and links persist the resolved root.

**Consequences.** `test-name-primary` pins the derivations and the priority. The remaining unknowns it called out (lease derivation, config layout, purchase/renew/claim instruction layouts) were recovered first-party the next day — see D-014 and evidence `scripts/defi-evidence/2026-10-09-claim-variants.json` (follow-up entry 2026-10-10).

## D-014 — Registrar lease writes: first-party formats, self-signed fee 0n, honest unsupported states

**Context.** Owner directive 2026-10-10: complete the extension name system — name registration (`.thru` paid-lease purchase) + renew + claim-expired, with the /name tab rebuilt around it and the faucet tile square like Send. Previously the register/setRecord formats were recovered from third-party sources and stayed gated behind `FLAGS.NAME_SERVICE`; the registrar (paid-lease) formats were not recovered at all.

**Options considered.** (a) Reuse the recovered onewire `name.register` path for .thru; (b) gate the new registrar writes behind the flag too; (c) implement against the first-party official ABIs + `name_service.rs`/`txn_tools.rs` builders from `github.com/Unto-Labs/thru` (2026-10-09), un-gated, with honest unsupported states when the registry is absent on the active network.

**Chosen.** (c). Contract v22 adds six `name.*` methods to the 0.4.x core (never flag-gated): `name.getRegistry`, `name.checkLease`, `name.getPaymentBalance` (auth `none`, sync-safe reads) and `name.purchase`, `name.renewLease`, `name.claimExpired` (auth `signing`). `src/lib/registrar.js` encodes the official byte layouts; `src/background/services/registrar-service.js` composes sacred `thru-client` surfaces (accounts/proofs/buildAndSign/sendAndTrack) — no new dependency on those internals elsewhere.

**Key invariants.**
- Self-signed only: authority = fee payer = active account, proven first-party in `resolve_signing_account` (CLI); headers pass fee `0n` explicitly (`THRU_REGISTRAR_PROGRAM_FEE = 0` in the CLI source), never autoUnits.

> **Superseded claim (2026-11-12).** The `0n` header fee is not a first-party requirement. The CLI
> constant is passed straight into `Transaction::new(fee_payer, program, fee, nonce)` — it is the
> transaction header fee the CLI left at zero, not a program-level field. Registrar writes now
> declare the network's measured base fee when the signer can cover it (`tx-units.networkFeeUnits`,
> the same policy sends use), and their review quotes that exact number instead of printing
> "Network fee — none". Unfunded payers still declare 0. See `DEFECT_LOG.md` §21 H-1.
- Nothing hard-coded: root/config/lease/domain addresses derived via CLI-proven formulas (root seed >32B → sha256 first, so `rootRegistrarAddress` is async everywhere); price/mint/treasurer parsed from the 244-byte config account at the exact CLI offsets.
- Honest states: registry absent → reads answer `{ supported: false, reason }` and signing refuses with `REGISTRY_ABSENT`; unreadable config → `REGISTRY_UNREADABLE`; the UI never fabricates a price (decimals come from `token.readMint`; unparseable amounts render as "base units").
- UI action is derived ONLY from a fresh `name.checkLease` read: mine → renew; expired-someone-else → claim; taken-active → refuse; free → purchase. Purchase/claim success auto-`name.linkPrimary` best-effort; a failed link never masquerades as a failed registration.

**Trade-offs.** The purchase flow takes on-chain creation proofs for the new lease/domain accounts (CLI `make_state_proof` semantics); if Betanet ever charges registrar fees the 0n header fails loudly rather than silently scaling — a re-evidence pass under `test:live` would precede any change.

**Consequences.** Chain total is 138 methods (81 + 43 + 14 `name.*`). `test/test-name-registrar.mjs` (9 checks) pins the byte goldens, the parser round-trips, and the service branch matrix offline. Live verification of the three writes on Betanet remains an owner-directed `test:live` run. `name.setRecord` was ungated at contract v31 (2026-10-29) on the same rule — first-party
append-record opcode 2, fee `0n`, authority = fee payer = the active account, reachable only
through the shared review kind `domain-record`; `name.register` was ungated at contract v23 (2026-10-24, owner-directed) after the first-party docs/CLI confirmed its canonical behavior: build_time proof inside txn_tools.rs carries zero payment accounts and `NAME_SERVICE_PROGRAM_FEE = 0` — registration under an existing root is free, self-signed only (authority = fee payer). `name.initRoot` remains gated — creating NEW roots is a namespace-level action, unlike registering beneath one.

## D-015 — Free name-service registration live beneath the canonical root (2026-10-24, owner-directed)

**Decision.** On networks whose paid `.thru` registry is absent but whose name-service root exists (Betanet today: `.id` community root present, `.thru` root + registrar config absent), /name offers free registration: `name.register` — self-signed, fee `0n`, units matching the first-party CLI (500k compute / 10k memory / 1 state), one Creation state proof, no payment token accounts — exactly mirroring `thru nameservice register-subdomain`.

> **Amended (2026-11-12).** "Free" is about the *protocol* price; the transaction header still
> declares the network fee, and it no longer hard-codes `0n` — `name.register` (still gated behind
> `FLAGS.NAME_SERVICE`) declares the measured base fee when the signer holds a balance. See
> `DEFECT_LOG.md` §21 H-3. The CHAIN decides whether the resulting authority (always the signer's own key) is accepted beneath the parent; a revert is surfaced honestly, never retried with another key or sponsored.

**Why now.** Owner's observation that "register is working / maybe free on testnet" is correct per the re-read first-party sources (thru.org/docs/cli-reference/name-service-commands.md + `NAME_SERVICE_PROGRAM_FEE = 0` in the CLI). Betanet is the only live test network; a separate free "testnet" network was ruled out (owner, same day).

> **Superseded claim (2026-10-30).** "Registration is free" is NOT established. The vendored
> registrar (`contracts/thru-custom-registrar/src/processor.rs:238`, `:321`) attempts the fee
> transfer and discards its result (`let _ =`), which proves only that registration can succeed
> without collection. The zero-fee wording below is a release-scope claim pending artifact
> verification and an explicit fee-release decision — see `DEFECT_LOG.md` §17C. Do not put
> "free" in shipped copy on the strength of this entry.

**Consequences.** Contract v23: `name.getCanonicalRoot` read appended (auth none), `name.register` auth tightened unlocked → signing (v5/v22 precedent: a broadcast key-signed write re-verifies the password when the signing-hardening setting is on) and its params gain `password`. UI `/name` picks the flow honestly: registry → paid `.tld` steps at the config price; no-registry + root → free Register CTA; neither → plain reason, nothing clickable. Chain total 139 (81 + 43 + 15 name.*).

## D-016 — Side-by-side custom registrar program: deploy once, initialize with config authority, open register (2026-10-24, owner-directed; **amended by D-019** — the config is now 176 bytes, the fee is tiered, and Initialize is tag 4)

**Decision.** Instead of waiting for an official `.thru`-flavored paid registry, the repo now carries `contracts/thru-custom-registrar/` — its own ThruVM/RISC-V name registrar (tags 0–3: Initialize / Register / Renew / UpdateConfig), provisioned on top of the OFFICIAL name-service program (`taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG`, pinned bootstrap address) without changing any first-party program. Two unique accounts back it: a 144-byte `RegistrarConfig` (magic `TCR1`, admin, treasury, fee/year u64, padded root name, root address, bump) and a 120-byte `DomainLease` per registered label. Registration `fee_per_year × years` moves inside the program (`tn_transact`, no floats) into the config treasury. Initialize is one transaction that creates the config in-program AND CPIs the official name-service tag-0 with `authority = config` (InvokeAuthOne) so the registrar itself — not any EOA — owns the root going forward. Betanet fee intent 1000 base units/year; a mainnet price is deliberately NOT encoded — UpdateConfig carries it when decided. The account table convention was REVISED the same day after an owner's cross-check question: the published @thru/sdk@0.4.2 npm dist byte-sorts each readWrite/readOnly segment (normalizeAccountList → .sort(compareAccounts), proven by an execution sentinel in the test suite — descending inputs come back as indices [3,2]). The registrar ABI therefore carries u16 account-table indices inside the instruction data (the first-party txn_tools.rs convention), resolved client-side via the SDK's own InstructionContext; the program additionally cross-checks treasury/root/target pubkeys against stored identity so an index alone is never trusted. The config pseudo-label `TCR:config:v1` is deliberately not a valid registerable label so no lease can collide with the config address.

**Honesty guardrails.** `test/test-custom-registrar.mjs` (39 checks: byte-pins, Rust-source regexes, and an in-process SDK sort sentinel proving the installed @thru/sdk account-table ordering) runs in `npm test`. Rust host tests are authored (`cargo test --lib`) but un-run in the Arena sandbox — no `cargo` there; recorded in contracts/thru-custom-registrar/README.md. Deploy/initialize and register probe scripts (`scripts/registrar/deploy-and-init.mjs`, `probe-live-registrar.mjs`) run on the owner host only and write evidence JSON.

**Consequences.** Wallet UI ships NOTHING about the registrar until a live Betanet probe passes — the D-013/D-015 domain screen stays on the official root semantics. When evidence exists, a services-grid tile can expose label search + years + the config-derived price read live (never hardcoded).

## D-017 — One shared transaction review pipeline (2026-10-27, owner-directed)

**Decision.** Every value-moving operation goes through one lifecycle — intent → validate → prepare →
decode/explain → review → authenticate → sign → submit → reconcile — implemented once:

- `tx.prepareReview` (contract v29) turns a typed intent into a canonical review plus a `bindingHash`
  that pins account, network and the reviewed facts; the record is network-scoped, TTL'd (120 s) and
  capped (`src/background/services/review/store.js`).
- `src/shared/tx-review/decoders/*` produce the facts. The registry has no fallback: a kind with no
  decoder is refused, and a decode failure yields `kind:'unknown'` with raw data and **no submit
  policy**, so it cannot be signed.
- `src/ui/domain/tx-review/review-card.js` is the only review surface, and
  `src/ui/domain/tx-review/confirm.js` the only confirm→auth→submit path. Feature routes build a
  draft and call these; they own no review rows, fee formatter, warning copy or password flow.
- `tx.confirmReview` re-validates TTL/binding/account/network/facts and returns the exact submit
  instructions (`method` + `params`); it does not sign and does not consume the review. The confirm
  helper then calls that method through the bridge, so the operation's **existing** `auth:
  'signing'` policy applies untouched, and discards the review once a signature comes back.
  `tx.discardReview` covers cancellation.

**Why.** Before v29 the review/confirm step was re-implemented per screen: Send and Domain each had
their own review markup, fee line, warning copy and confirm gate, and Faucet skipped review
altogether. The same class of bug (stale context, double submit, unstated fee, invented success) had
to be fixed per screen, and a new feature could quietly add a second signing path. The owner's standing direction is wallet-core, not feature-owned:
a new feature must not add a second signing path. Rabby was studied as a UX/legibility reference only
(its approval funnel, summary+table+raw disclosure, fail-closed unknown handling). No Rabby code,
EVM/ABI assumption, gas model or brand asset is copied; Rabby's MIT license reserves its brand and
logos, and none are used.

**Honest states, by policy.** Simulation is unavailable (`tx.simulate` → `supported:false`), so no
post-transaction balance, "simulated success" or verified balance change is ever rendered; an
unmeasured token fee is labelled unmeasured; a native fee without a quote stays unknown with its
reason. A timeout is an unknown outcome, never a failure, and no screen claims confirmation without
reconciliation evidence. D-003 is untouched: the default stays session-only signing with the
password-gated opt-in, and the review only *reuses* it.

**Consequences.** Adding an operation means adding a decoder + a kind spec (with the existing submit
method named) and a route that calls `tx.prepareReview` — never a new signing screen.
`test/test-tx-review.mjs` enforces registry↔kind parity, every decoder, malformed/unknown input,
formatting, binding/TTL/account/network refusals and the central error-code registry;
`test/test-route-lifecycle.mjs` drives the migrated Send, Name and Faucet routes through the real
card. DeFi/DEX/launchpad kinds are deliberately absent while their flags are off, and
`tx.prepareReview` answers `supported:false` with the known-kinds list instead of guessing.

## D-018 — One notification surface: toast for events, Banner for state (2026-10-30)

**Context.** The Domain screen shipped an oversized, nearly empty black bar. It was not a CSS
defect: three call sites wrote `toast('Transaction confirmed')` against a props API, the string
destructured into defaults, and the component rendered a full-width `.toast` with an empty message
body. The component had no guard against being asked to render nothing, and no test covered it — the
only `toast(` in `test/` was a cleanup call. Alongside it, address truncation existed in six
implementations with three different widths, and `Banner` accepted any tone string while silently
rendering unknown ones as neutral, so a confirmed registration was painted as a grey box.

**Decision.** Two notification components, one owner each, one vocabulary between them:

- **`toast()` (`src/ui/kit/toast.js`) is for EVENTS.** success · info · warning · error · pending.
  Callers must always pass a props object (`{ tone, title, message?, key? }`); bare-string calls are
  banned across `src/` (`AGENTS.md` Rule 26, enforced by `test/test-toast.mjs`), while internally
  `toast()` normalizes a string to `{ title }` as defense-in-depth and renders **nothing** (returning
  an inert handle) when a payload has no text. `pending` never expires and is resolved in place with
  `handle.update({...})`, so a submission shows one bar that changes verdict. `key` dedupes repeated
  events. `dismissAllToasts()` is called by the app shell on lock, account change and network change,
  because a message quoting a domain, amount or address must not outlive the state it described.
- **`Banner()` (`src/ui/kit/feedback.js`) is for PERSISTENT STATE** on a screen. Same four settled
  tones, `ok` accepted as a synonym for `success`, unknown tones resolve to neutral rather than
  silently inheriting whatever class the element already had.
- **Address shortening has one implementation** (`shortenMiddle`/`shortAddress` in
  `src/shared/format.js`); `truncateAddress` remains as a documented alias. Display-layer copies are
  a build failure (`test/test-shared-platform.mjs`).

**Why.** A wallet's feedback is a safety surface: "confirmed", "failed", "still submitting" are
claims about money. Having one component per job means the claim vocabulary, the dismissal rules and
the honesty rules are enforced once, and a new feature cannot invent a third bar. The blank-toast
guard exists because the alternative — a component that renders chrome when it has nothing to say —
turns a call-site typo into a UI defect that looks like a styling bug for weeks.

**Trade-offs.** Features cannot style their own notification; a genuinely different presentation
(success screen, inline notice panel) is a screen, not a toast. `pending` on a banner is deliberately
unsupported: a banner has no resolution mechanism, so it must never claim progress it cannot end.

**Consequences.** `test/test-toast.mjs` pins the component (92 checks); `test/test-shared-platform.mjs`
pins the ownership (45 checks: one truncation, two clipboard writes, one toast host, one tone set,
kit-only imports). A toast that renders no message, a second truncation in the display layer, or a
feature-owned toast element now fails `npm test`.

## D-019 — Registrar fees are tiered, on-chain, and enforceable (2026-10-30, owner-directed)

**Context.** D-016 shipped one flat `fee_per_year` and collected it with
`let _ = mgr.account_transfer(0, treasury, total_fee)`. Two problems surfaced later: the price is a
product decision that should differ by name length (a 3-character label is scarce, a 6-character
one is not), and the discarded transfer result means the wallet could not honestly say whether a
registration had been charged (`docs/DEFECT_LOG.md` §13.3, §17C — the only live observation is the
VM's `-10 AccountNotWritable`, surfaced as `0xD20A`).

**Decision.**

- **Three per-year prices live in the config** — `fee_3_char`, `fee_4_char`, `fee_5plus_char` — plus
  a `fee_policy`. All four are mutable through `UpdateConfig`, so a mainnet schedule is a config
  transaction, not a new deployment. Betanet intent: 100 000 / 10 000 / 1 000 base units per year
  (0.0001 / 0.00001 / 0.000001 THRU at 9 decimals). The wallet reads them from the chain; no price
  is compiled into the UI, and a route that cannot read a config quotes nothing.
- **The config layout is appended, never reshuffled.** Layout 2 is the deployed 144 bytes plus the
  four new fields at offset 144 (176 bytes total). A live layout-1 config still parses and reads as
  a flat schedule with the best-effort policy — i.e. exactly the behaviour it had — so deploying
  the new program cannot change an existing registration's price by accident. `UpdateConfig`
  resizes a layout-1 account in place (`account_resize`, guarded by `data.len()`), so upgrading the
  schedule needs no re-initialisation and no loss of root authority.
- **Enforcement is a config bit, not a wallet assumption.** `strict` reverts a refused charge
  (`0xD206`; `0xD207` when the source cannot cover it); `best-effort` attempts the debit and ignores
  the refusal (the deployed behaviour). Register and Renew share ONE `collect_fee()`, priced through
  ONE `total_for_term()` with a checked multiply.
- **The wallet reports the policy, never an assumption.** `feeEnforced = (policy === strict)`.
  An unenforced non-zero price renders as unenforced (`registrar-fee-unenforced`), only an enforced
  charge produces an outgoing THRU row, and an enforced charge the account cannot cover blocks the
  review. "Free" is reserved for a zero price.

**Why not make strict the default.** The directive is that a failed transfer must revert, and it
does — under `strict`. But the only evidence about collection is that it has never succeeded, and
the environment that discovered that (VM `-10`) is the same one that would now revert every
registration. So the deploy script defaults to `best-effort` and refuses `--fee-policy strict`
unless the operator passes `--collection-proven "<note>"`, an attestation that a treasury balance
delta was observed after a real registration. `--probe-collection` records the balance for exactly
that measurement. Switching to strict is a one-transaction `UpdateConfig` once the probe passes.

**Consequences.** The checked-in `contracts/thru-custom-registrar/thru-custom-registrar.bin` (`29,416`
bytes, `sha256 4c5095e1…7bd515`, rebuilt with `link.x.in`, the tiered layout-2 fields, and the
canonical-config-PDA check `0xD112`) was deployed to Betanet on `2026-11-18` (`feePolicy:
"best-effort"`, `collectionProbe.measured: false`, `scripts/defi-evidence/registrar-deploy-betanet-thru-1795038501279.json`).
Verifying `0xD112` rejection on-chain and recording a measured treasury balance delta on an
RPC-reachable host remain required before claiming on-chain fee collection (`docs/guides/domains-and-registrar.md`).

## D-020 — Agent rules get checks, not more prose (2026-10-31)

**Context.** `AGENTS.md` was 347 lines and agents still broke rules written in it: a signing
method shipped as `auth:'unlocked'`, a `name.register` parameter was declared and never read, a
prepared review survived a wallet lock, and the status docs lagged two contract versions twice. The
review that measured this also measured the repo: 127 source files, 479 import edges, median 6.4 KB,
and exactly **one** import cycle — across the five core transaction services, twice hidden behind
`await import(...)`.

**Decision.**

- `AGENTS.md` is an **index plus the hard rules**: 30 rules (`1–27` from the 2026-10-31 pass plus
  `28–30` added with v32 consent, one-surface-per-event, and independent verification), each ending in the
  gate that enforces it, or the word `review` when nothing mechanical can. Detail lives in
  `docs/agent/` and is linked, not duplicated. Rule numbers are frozen — `src/` and `test/` cite
  them.
- A new rule ships **with its check**, in the same commit, and the check is watched failing on a
  real broken tree first. Rules 18–29 exist because their checks now exist (`scripts/check-agents.mjs`).
- Checks are written in-repo, with no new dependency (`check-cycles` uses the already-pinned
  esbuild parser; `check-docs-truth` reads the manifest and boot registry).
- **Rejected:** moving to `core/domain/application/infrastructure` folders. The architecture is
  frozen, `check-layering` already defines the boundaries, and no defect traces to folder layout.
  **Rejected:** byte or line caps as a rule — size is a review trigger (`npm run report:size`),
  because a build that fails on a line count teaches people to shuffle lines.

**Consequences.** Nine guard scripts and the full suite run inside `npm test`. Two of them found real
defects on their first run instead of confirming the tree:
`test-signing-surface.mjs` reported `name.register.networkId` and `intent.submit.acknowledgements`
as declared-but-unread (both removed from the contract), and `check-cycles.mjs` pinned the known
cycle so it can only shrink. The cycle itself is deliberately NOT fixed here: it touches
signing-adjacent services and belongs after the release, with its own tests.

## D-021 — Background review consent token (contract v32, 2026-11-02)

**Context.** Under contract v29–v31, review enforcement lived in the UI (`confirm.js` + the
`test-tx-review.mjs` [14] static/dynamic UI source scan). An external probe demonstrated that calling
`tx.sendChecked` directly at the router boundary built, signed, and broadcast without any prepared
review.

**Chosen.** `tx.confirmReview` mints a single-use, 32-byte random `consentToken` (`60s` TTL, cap `40`,
stored strictly in an in-memory `Map` in `src/background/services/review/consent.js`, never
`chrome.storage`) bound to `{ method, sha256(canonicalParams), accountAddress, networkId }`.
`src/background/api-router.js` requires and burns `consentToken` before `signing-guard.js` or any
handler runs (`REVIEW_REQUIRED`), stripping the field before handler dispatch. Only two
`TRANSACTION_METHODS` are listed in `CONSENT_EXEMPT`: `tx.registerAccount` (self-registers an owned
address with zero user-chosen transfer parameters) and `intent.submit` (dormant behind
`FLAGS.DEFI_INTENT === false`, bound by `bindingHash`). Wallet lock, startup while locked, account
switch, network switch, and reset clear all tokens alongside `tx_reviews`.

**Limit (stated explicitly).** The token proves that a signing call is the unmodified continuation of
a confirmed review; it cannot prove a human visually read the DOM card because a caller with code
execution in the page can call `tx.prepareReview` and `tx.confirmReview` too. Enforced by
`test/test-review-consent.mjs`.

## D-022 — Unified `networkFeeUnits` policy across registrar and name-service writes (2026-11-12)

**Context.** Registrar and `name.setRecord` writes previously hardcoded `fee: 0n` (copying a CLI
`THRU_REGISTRAR_PROGRAM_FEE = 0` placeholder that was actually the transaction header fee), causing
domain review cards to print `Network fee — none` right beside `"You pay only the network fee"`.

**Chosen.** One shared policy in `src/lib/tx-units.js`: `networkFeeUnits({ baseFeeUnits, balanceUnits,
sponsored })`. Sponsored operations (`CREATE`, `CLAIM`) declare `0n`; unmeasured chains
(`baseFeeUnits == null`) declare `0n` and render `"not confirmed"` (never `"none"`); unfunded payers
declare `0n`; funded payers declare `BigInt(baseFeeUnits)` (`1n` on Betanet). Confirm-time rechecks
run `assertFeeUnchanged` (`REVIEW_FEE_CHANGED`), and tiered custom-registrar writes compare
`reviewPricePerYear(cfg, label)` rather than the flat `5+` tier.

## D-023 — One surface per event (`toast` vs `Banner` vs field validation, 2026-11-13)

**Context.** Even after `D-018` centralized `toast()`, the `/name` submit handler wrote the same
submission progress and outcome simultaneously to a `pending` toast, the page `Banner`, and the
`.name-status` input helper — printing every refusal or confirmation two to three times.

**Chosen.** Strict surface ownership (`AGENTS.md` Rule 29, enforced by `test/test-route-lifecycle.mjs`):
a transaction submission opens one keyed `pending` `toast()` and resolves that same toast in place;
routes clear `Banner` and field-validation text before submitting; `Banner` is reserved for persistent
screen state (e.g., a review invalidated by context change), and field lines are reserved for input
validation/availability.

## D-024 — Single Source of Truth (SSoT) documentation overhaul and legacy purge (2026-11-15)

**Context.** Legacy `docs/archive/`, `docs/handoff/`, `docs/reference/`, duplicate top-level audit
notes (`MAINNET_READINESS.md`, `SEND_PATH_AUDIT.md`, `REDESIGN_TRIAGE.md`), monolithic PR logs
(`DEFECT_LOG.md` at 88 KB, `TX_REVIEW_VERIFICATION.md` at 38 KB), and stray root agent prompts
(`thru-defi-*.md`, `thru-identity-profile-plan.md`, `mcp.txt`) contradicted `D-003` and `v29–v32`,
causing AI agents to hallucinate unimplemented features and violate signing rules.

**Chosen.** Establish one hierarchical SSoT under `docs/` (`DOCS_INDEX.md` router, core Authority
specs, cohesive `docs/guides/*` for shipped subsystems, synchronized `docs/defi/*` for dark-launched
backend code, `docs/roadmap/FUTURE_ROADMAP.md` as the sole `PLANNED` home for retained frontend/UX and
protocol research, and `docs/audits/*` isolated as frozen historical snapshots), delete all superseded
archive/handoff/prompt files, and enforce cross-document count and path integrity via
`scripts/check-docs-truth.mjs` and `scripts/check-agents.mjs`.

## D-025 - Bounded wallet remediation and cleanup integration (2026-11-14, owner-directed)

**Context.** The owner authorized audited wallet fixes and a written handoff while other workers
were integrating the documentation cleanup. The authorization distinguishes corrective work from
new features, protocol changes, and verification claims.

**Options considered.** (a) Bundle speculative features or restore superseded documentation into
the remediation; (b) retain fabricated fiat values until a price feed exists; (c) integrate the
authorized cleanup and bounded fixes without changing the established security architecture.

**Chosen.** (c), with these explicit owner boundaries:
- Multi-name registration, a multi-name submission queue, and atomic minting remain intentionally deferred;
  this task does not authorize enabling them.
- Preserve the existing architecture and one review/signing flow (D-001, D-006, D-010, D-017,
  D-021), not a second router, store, bridge, or feature-owned signing path.
- Unverified USD values must be honestly unavailable, not a fixed quote, a zero-dollar valuation
  for an unpriced holding, or an invented price feed. A future sourced feed is separate work.
- This remediation does not authorize contract ABI changes or deployment. Such work requires
  verified protocol semantics and separate scoped authorization under the smart-contract policy;
  neither successful Node tests nor existing CLI placeholders establish those semantics.
- Integrate the owner-authorized cleanup and repair active references without restoring
  superseded files. Preserve unrelated owner/parallel-worker changes, the D-008 hierarchy,
  D-024 cleanup, and frozen historical evidence.

**Why.** Correctness fixes must remove demonstrated failures without silently expanding product
scope, implying transaction guarantees, or treating uncertain data as verified facts.

**Trade-offs.** Unavailable fiat and deferred features provide less information or convenience
than speculative implementations, but do not invent evidence or transaction authority.

**Consequences.** This entry records directives, not shipped capabilities or completed fixes.
Implementation results, actual test runs, remaining blockers, and browser/live-network evidence
belong in the separately owned handoff and current-state records; authorization is not verification.

## D-026 - Additive verified token import (contract v33, 2026-11-16)

**Context.** The token drawer sends only a mint address and fallback symbol. Routing that payload
to legacy `token.import` silently defaults missing decimals to zero even when the mint uses a
different denomination. The existing strict `importVerifiedToken` service already verifies a
captured mint snapshot and fences network-generation changes.

**Chosen.** Append `token.importVerified` with `auth: 'unlocked'`, `since: 33`, and only
`mintAddress` / `symbol` parameters; pass the complete request to strict service validation and
route Dashboard imports through it. Reject caller-supplied `name` and `decimals`. Preserve
legacy `token.import` metadata normalization and replacement behavior for compatibility.

**Consequences.** The contract has 154 methods. Router tests use SDK-built mint bytes and detached
storage to prove verified denomination persistence, malformed/unsupported account refusal,
duplicate rejection, and network-generation fences during RPC and queued preference reads.
This adds no signing path, dependency, protocol format, or storage schema. Browser and live-network
verification remain separate gates.

## D-027 - Render local UI before backend hydration (2026-11-16)

**Owner directive.** Remove the post-unlock "Checking wallet" page. Backend loading or sync
must not hold the frontend, including during startup and route transitions.

**Chosen.** Boot paints a safe public unlock/onboarding route synchronously, then hydrates
session state. Guards use the UI session snapshot rather than querying the background on
every navigation. Unknown authentication never mounts private routes. Background authorization
remains authoritative for every protected action; this cache grants no signing permission.
Successful unlock/create/import/reset responses and lock events update the snapshot. Reset
events add optional `hasVault: false` so other open pages can return to onboarding. Newer actions
and events invalidate pending bootstrap replies. Hydration preserves typed input and focus.

**Security and verification.** Departing routes are destroyed synchronously before guard work,
clearing secrets and aborting route-owned reviews. Recoverable error UI is reserved for actual
failures, never routine sync. Router/bridge logs omit arbitrary exception payloads. Regression
coverage in `test/test-route-lifecycle.mjs` holds backend replies and exercises deep links,
unlock-in-flight, reset delivery orders, external unlock events, and secret teardown.

**Documentation cleanup.** Removed the duplicate root/archived documentation-overhaul reports
and the temporary November 14 fixes handoff. Their conflicting intermediate v32/v33 states
are superseded by current source and the maintained status/decision documents. The seven
dated September/October audits remain historical evidence, not implementation instructions.

## D-028 - Domain profile editing strategy, extension vs web differentiation, and monetization model (2026-11-16, owner directive)

**Owner directive.** Content and profile editing will primarily be hosted on the website rather than crammed into the browser extension, keeping the extension lightweight, fast, and clutter-free. The underlying smart contract records API (`name.setRecord`) remains open at the protocol layer to power external profile builders and third-party integrations, driving new domain registrations and protocol revenue.

**Architecture and product strategy.**
1. **Editing Workflow Strategy:**
   - **Primary Web Surface:** Comprehensive profile building and text-record editing live on the web platform (`thru-profile-web` / `thru-wallet-web`), which provides rich form controls, validation, previewing, and asset linking without bloating the extension bundle or crowding the compact popup viewport.
   - **Extension "Expand" Milestone (Phase 5):** The extension route `/name` will add an "Expand" button in a future milestone that opens a dedicated desktop tab (`desktop.html` or direct web app handoff) for seamless full-screen profile editing.
   - **Secondary In-Wallet Phase:** A later phase may explore limited, high-frequency inline editing directly within the wallet after the standalone web editing suite has matured.
2. **Feature Differentiation (Option A vs. Option B Hybrid):**
   - **Option B (Extension Focus):** The extension UI is strictly optimized for high-speed, low-complexity transactions: searching availability, minting/registering, renewing leases, and setting primary name aliases. Complex profile management is excluded from the popup to protect performance and maintain a clean UX.
   - **Option A (Web & Profile Builder Focus):** At the protocol and contract API layer (`name.setRecord`, opcode 2), the capability remains available. The web platform and third-party developers can utilize our smart contracts to construct dedicated profile builders, social directories, and identity tools.
3. **Monetization & Ecosystem Revenue:**
   - Under Option A, third-party profile builders and ecosystem dApps integrate directly with our smart contracts.
   - Any new user who creates a profile or claims a handle through these external platforms registers their `.thru` domain through our custom registrar smart contracts, generating on-chain registration fees for the treasury.

## D-029 — Release v1.5.0 (2026-11-18, owner directive)

**Owner directive.** Release version 1.5.0 for the Chrome extension and repository.

**Context.** Following the stabilization of Contract v29–v33, the integration of `@thru/sdk@0.4.4` and `@thru/programs@0.4.4`, and on-chain Betanet validation of best-effort custom registrar configuration (`feePolicy = 0`) enabling live `.thru` domain minting, the repository advances to release version 1.5.0.

**Shipped scope in v1.5.0:**
1. **Dependency Modernization:** Pinned exact `@thru/sdk@0.4.4` and `@thru/programs@0.4.4`. Removed obsolete native-faucet rate-limit adapter; legacy `tx.getFaucetLimit` method explicitly returns not-applicable without RPC calls.
2. **On-Chain Betanet Registrar:** Verified on-chain `UpdateConfig` execution establishing `best-effort` fee policy (`0`), tiers `100,000 / 10,000 / 1,000` base units, verified live mint of `audit7v7e.thru`, and eliminated duplicate fee-payer account entries.
3. **Unified Review Pipeline & Single-Use Consent (v29–v32):** Value-moving operations enforce background consent tokens (`confirmReview`), single-surface toast notifications (Rule 29), and strict account/network binding.
4. **Verified Token Management & Name Services (v31–v33):** Added `token.importVerified` (`auth: 'unlocked'`) with verified decimals persistence, and contract methods `name.setRecord` and `name.reverseLookup`.
5. **Version Bumps:** Bumped `package.json`, `package-lock.json`, and `src/manifest.json` from `1.4.1` to `1.5.0`.

## D-030 — SDK 0.5.1 upgrade without legacy vault derivation (2026-11-18, owner directive)

**Owner directive.** No legacy vault derivation path is needed for the SDK 0.5.1 upgrade.

**Context.** `@thru/sdk@0.5.1` changes the BIP-44 coin type from 9999 to 8478, so a fixed
recovery phrase derives different addresses than under 0.4.4. The default treatment in
`AGENTS.md`/`test/test-derivation.mjs` is a migration path for existing installs. The owner
explicitly declined that path for this upgrade.

**Chosen.** Pin `@thru/sdk@0.5.1` and `@thru/programs@0.5.1`, use the SDK's 8478 derivation
everywhere, and regenerate the golden derivation vectors on the new version. No compatibility
derivation adapter, per-keyring coin-type field, or storage migration is added. Seed keyrings
created under 0.4.x resolve to their new 8478 addresses after the upgrade; users must re-import
a phrase elsewhere if they need the old addresses. This is a deliberate owner decision, not a
silent SDK drift.

**Follow-up (2026-11-18).** Patched both exact pins to `@thru/sdk@0.5.2` and `@thru/programs@0.5.2`. The patch adds Ledger path helpers and signature-context limits only; the 8478 derivation, program addresses, token layouts and wire formats are unchanged, so no code or golden-address change was needed.

## D-031 — Release v1.6.0 (2026-11-19, owner directive)

**Owner directive.** Release version 1.6.0 for the Chrome extension and repository.

**Context.** Following the upgrade of `@thru/sdk` and `@thru/programs` to `0.5.2`, transition of the BIP-44 coin type to 8478 (`m/44'/8478'/index'/0'`), recompilation and live Betanet deployment of `thru-custom-registrar` with verified `.thru` domain minting, and enforcement of Betanet RPC 10,000 memory units ceiling, the repository advances to release version 1.6.0.

**Shipped scope in v1.6.0:**
1. **SDK & Programs 0.5.2 Upgrade:** Pinned exact `@thru/sdk@0.5.2` and `@thru/programs@0.5.2` (BIP-44 coin type 8478, token account 1-byte discriminator, `CORE_MANAGER_PROGRAM_ADDRESS`, Ledger hardware wallet compatibility helpers).
2. **On-Chain Betanet Registrar:** Recompiled `contracts/thru-custom-registrar` binary (29,416 B with valid ROM header/entrypoint via GNU toolchain), deployed and upgraded to `ta2vDCBzzptN2qVZgz6PXsCp5cNB7Nef4yeQ3W-OqzZcfF`, initialized root registrar for `.thru` (`tsh-o--5Ktns...`, `vmError: 0`), configured treasury to `taYqo1zV5VbNmtEuedubnI51UsvQjsEcDK-MD5cVMlvPJ_` (`vmError: 0`), and live-minted domain `probe4pwpy.thru` (`tsd6IeN94zPeZ...`, `vmError: 0`).
3. **RPC Rate & Resource Compliance:** Enforced maximum 10,000 memory units floor across transfer/swap/registrar transactions to conform to Betanet RPC constraints, with rate-limiting backoff for history and token queries.
4. **Token Operations Live Verification:** 16-rung live token transfer suite passed against Betanet.
5. **Version Bumps:** Bumped `package.json`, `package-lock.json`, and `src/manifest.json` from `1.5.0` to `1.6.0`.

## D-032 — Keep the current extension and reuse only the balance artwork (2026-11-20, owner directive)

After reviewing the isolated frontend prototype, the owner declined a replacement. The prototype
and its integration plan were removed. Keep the existing dashboard structure and Settings, and
reuse only the prototype's local decorative SVG behind the existing balance readout. This does
not change permissions, network policy, wallet behavior, or backend code.

Project-scoped Modern Web Guidance remains development tooling under the
[engineering directive](agent/engineering-directive.md#modern-web-guidance-for-frontend-work).

Follow-up: the owner requested inset dashboard cards and a network shortcut, not a replacement
frontend. The native balance leads when fiat is unavailable. The dashboard shortcut opens only
the existing Settings network rows, uses the same activation path and guards, and does not make
additional networks available.

The token drawer reuses the registered-token snapshot, verified mint reader and visibility API.
“Remove from Assets” hides a token and is reversible; it does not mutate any on-chain state.
The generic close glyph is from Rabby, under its [MIT notice](../src/icons/rabby-close.LICENSE.txt)
([source at 99db353](https://github.com/RabbyHub/Rabby/blob/99db3534192f6d70c23409bc2b5e13244336e470/src/ui/assets/close-16-cc.svg)).
The transaction Multicall program is not a verified Betanet account-read batch API.


## D-033 — Document changes with the code (owner directive)

Update the existing authoritative documentation in the same change as user-visible behavior,
engineering status, decisions, verification evidence, and release-facing copy. A new chat or agent
must be able to find the current branch state and its blockers from the normal read order, while
confirming the actual Git/PR state. `docs/DOCS_INDEX.md` routes each topic to its existing owner;
do not create competing handoff documents. Keep proposed Web Store copy distinct from a verified
live listing and never claim publication without evidence. Documentation guards supplement, but
do not replace, a manual code/evidence comparison.
