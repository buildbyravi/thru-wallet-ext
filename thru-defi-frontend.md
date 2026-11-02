# THRU extension DeFi: FRONTEND build prompt (popup + Desktop tab)

Prompt version 2.0.0 (2026-10-28), rewritten after the repo audit. Shared contract 2.0.0.

Companion file: `thru-defi-backend.md`. Both files carry the same PROJECT INPUTS, BUILD STATE and SHARED CONTRACT blocks, so two different builders can work in parallel and still meet at the same interface. This file adds the frontend spec.

Shared-block fingerprint (sha256 over the SHARED CONTRACT block, from its BEGIN line through its END line): `fd6d1d7e47513cb1403f23dcc2a39b1961060d1ef46bbc4e93c2ab90e955cc8f`
Both files must show the same fingerprint. If you edit the shared block in one file, make the identical edit in the other and treat this fingerprint as void.

This prompt contains no code. It says what must be built, what each part depends on, and what must be proven before it ships.

## Human setup (model: ignore this section)

1. Give the model the repo (at least `AGENTS.md`, `CONTEXT.md`, `docs/`, `src/ui/`, `src/popup/`, `src/shared/`, `test/` and `scripts/`). It must read `AGENTS.md` first and run recon before planning. Remind it to reload the extension itself, not just the popup, after backend changes.
2. Fill PROJECT INPUTS in both files with the same answers. Blank means default.
3. Input limit? Paste in this order: this header, PROJECT INPUTS, SHARED CONTRACT S0 to S4, S5 to S11, S12 to S14, then the frontend spec one section at a time.
4. The frontend builds against the repo's delivered M0 fixtures (BUILD STATE, S13) on a fixture bridge, and switches to the real bridge as each slice lands. It never waits idle: it builds the shell, components and state gallery from the shared vocabulary.
5. Relay change requests (CCRs, S0) between the two builders verbatim.
6. Reject any chain fact a model asserts. Chain facts come only from the backend's dossier.
7. Never give a model a real seed or a mainnet key.
8. BUILD STATE records what is already built, what was observed on the network and what is known to be broken. When that changes, edit that block identically in both files. It is not fingerprinted.

## Role

You are the senior frontend engineer and UX reviewer adding swap, pools and a launchpad to a Thru wallet extension. You own: the popup additions, the Desktop page and its routes, every screen and component, the rendering of the shared review component, copy, number formatting, accessibility, client-side input checks (UX only), UI fixtures, the state gallery and the UI tests.

You do not own: chain facts, risk logic, quote math, signing, transport, permissions, storage of secrets, or the optional server. If a screen needs a field, code or method that the shared contract does not contain, file a CCR. Never invent one and never work around the gap by computing the value in the UI.

Thesis: fast enough for a routine swap, precise enough for a signature, honest when the chain cannot do something yet. The wallet stays fully useful with every DeFi flag off.

## First reply (terse, in this order)

Start with one line: the repo's current commit and `CONTRACT_VERSION`, and whether BUILD STATE is still accurate.

1. **ASSUMPTIONS**: every default you applied.
2. **REPO RECON**: confirm the UI stack (the docs say vanilla ES modules, esbuild, the guarded `h()` helper, no framework), design tokens and CSS layout, route registration and the route checks, the bridge convention including the error shape, the password prompt, the existing send review and token and transaction sheets, how the build produces `popup.html`, the CSP in force, the test chain and the visual harness, and how copy is stored today. Map every path this prompt names to its current equivalent. List every conflict with this prompt and with `AGENTS.md`.
3. **CONTRACT FIT**: any gap in the shared contract that blocks a screen, written as CCRs.
4. **PLAN**: the current gate (S12), the steps in order, and what waits on M0.

Then build only the current gate and stop at its boundary with a report. Never half-finish a step.

<!-- BEGIN:PROJECT-INPUTS -->
# PROJECT INPUTS (you fill these; the same block sits in both files; blank means "use the default")

**1. Networks.** Use the ids from the extension's existing network registry. Custom networks never get DeFi (D14).

| Network id | Label | Class | DeFi features wanted | Notes |
|---|---|---|---|---|
| betanet | Betanet | test | every feature the dossier verifies | default. The only network enabled in the repo today. Add mainnet here when it is declared and enabled. |
| | | | | |
| | | | | |

**2. Names and operator details** (used in copy, disclosures and store text).

| Item | Default | Your answer |
|---|---|---|
| Desktop tab name | Desktop (the repo reserves `desktop.html` for it) | |
| Popup tile labels | Swap, Markets, Launchpad | |
| Operator name for disclosures | none yet | |
| Report and support URL | none yet | |
| Terms and privacy URLs | none yet | |

**3. Services you will provide, if any** (public addresses only, never keys or tokens).

| Item | Default | Your answer |
|---|---|---|
| Market read API base URL | none (discovery stays unsupported). Adding one needs D16. | |
| Image proxy base URL | none (placeholders only) | |
| Feed publisher base URL | none (feeds unavailable, stricter policy applies) | |
| Feed signing key ids | none | |

**4. Decisions.**

| ID | Decision | Default | Trade-off | Your answer |
|---|---|---|---|---|
| D1 | Program supply path | Official or verified programs only for DeFi. One exception on record: the custom `.thru` registrar (D-016), Betanet-only until it meets S16. | A curve program is a separate audited project. Waiting limits launchpad depth. | |
| D2 | Market data source | Direct-chain for money-critical reads. A project read API for discovery and analytics if the dossier finds no official index. | The operator becomes a privacy, availability and trust dependency. | |
| D3 | Image and metadata hosting | Project proxy and server-side pinning. Placeholders when absent. | Needs hosting and ops. The alternative is no images. | |
| D4 | Desktop surface | A separate full-page tab (`desktop.html`, `src/desktop/`, its own esbuild entry, single instance), as `build.mjs` and the layering rules already anticipate. Not built yet. | The existing side panel is narrower and shares the popup page. A second page needs build, CSP and quarantine-test changes, which AGENTS.md says to confirm with the owner. | |
| D5 | DeFi signing auth | Inherit the wallet's signing policy (`requirePasswordForSigning`, off by default in the code). Add step-up: the password is required regardless of that setting for the first use of a program, pool or asset by this account on this network, for any intent carrying a `high` warning, and for launch create, migrate and claim. A stricter-only user option (`defiAlwaysRequirePassword`) demands it for every DeFi signature. | Fewer prompts than password-per-swap, at the cost of relying on the review, the binding and the step-up classes. | |
| D6 | Batch authorisation | Per-step auth. Batch auth only when every transaction is predetermined, hash-bound and short-lived. | Fewer prompts versus a larger blast radius. | |
| D7 | Monetisation | None at launch. Any later fee is program-enforced and itemised. | Revenue is deferred. | |
| D8 | USD for non-core assets | Never. Native THRU only. | Less familiar UX versus manipulation risk. | |
| D9 | Contract versions | READ was delivered at 17 and EXEC at 18. The repo is at 28. Each new slice takes the next free version. | One release per slice. | |
| D10 | Browser targets | Chromium (Chrome, Edge, Brave) first. | Firefox needs separate MV3 work. | |
| D11 | Telemetry | None. Local diagnostics export instead. | Harder remote debugging. | |
| D12 | Verified-list governance | Project-curated signed list with public criteria and a takedown and appeal path. | Operator conflict of interest and ongoing workload. | |
| D13 | Geo and terms | Terms and risk acknowledgement at first DeFi use. Geoblocking per counsel. | Friction. Not a compliance programme. | |
| D14 | Custom RPC networks | DeFi disabled. | Power users lose features. | |
| D15 | Charts | Built in-house on SVG or canvas through the DOM kit. No charting library. | AGENTS.md allows only first-party Thru packages as new dependencies. A library needs the owner to lift that rule explicitly. In-house charts cost build time. | |
| D16 | Privacy posture | Treat any project server, feed fetch or image proxy as a change to `PRIVACY.md` and the store listing, made before it ships. | `PRIVACY.md` today promises no proxy, relay or backend server and zero telemetry. Without a server, discovery and images stay unsupported. | |
| D17 | Product order | Launchpad backend first (owner directive 2026-10-26), built as "launchpad-lite": create a token, seed an AMM pool, list it. The swap UI stays withdrawn until you re-approve it. | Without a trade surface, a token created in the wallet cannot be bought in the wallet. | |
| D18 | Liquidity and venues | The project seeds no liquidity. The only pools are user-created. The verified list starts empty. | A DEX with no liquidity is an empty shell. A seeded pool makes the project a market maker. | |
| D19 | User content hosting and moderation | The project hosts no user images or descriptions in v1. Identicons and on-chain fields only. | Hosting user content creates legal duties: illegal-content scanning, takedown handling, copyright notices. | |
| D20 | Mainnet gating | DeFi stays disabled on mainnet until S16 is met, independent audits are done, counsel has signed off, and P3 has passing evidence. | Delays mainnet. | |
| D21 | Project fees and treasury | Zero. No fee is shown or collected until a program enforces it and evidence shows the balance delta. | No revenue at launch. | |
| D22 | Test chain and CI | Record-and-replay fixtures in CI. Live probes run by the owner. A blocked probe is never green. Ask Thru for a local validator image. | Without a local chain, evidence depends on a testnet that resets and has faucet faults. | |
| D23 | Key types for DeFi | Mnemonic accounts only. | Passkey and hardware accounts need their own signing UX and review. | |
| D24 | dApp provider | None until Thru publishes an extension contract. | Without a provider the wallet is not usable from dApps. | |
| D25 | Incident ownership | The owner holds the feed-signing and kill-switch keys, with a written rotation procedure and a named contact. | A single key holder is a single point of failure. | |
| D26 | Dashboard entry | DeFi entries go in the dashboard's second services grid. The main six-tile grid stays frozen. | A tile in the main grid needs an owner decision and a guard change in the same commit. | |
| D27 | Names and the custom registrar | Out of this workstream. Their signing paths still meet R20 and move onto the pipeline when next touched. The custom registrar stays Betanet-only until S16. | Two signing paths to maintain until then. | |

**5. Starting limits.** These are proposals for the product owner, not facts. The backend seeds them and serves them through `program.capabilities`.

| Limit | Starting value | Your answer |
|---|---|---|
| Quote lifetime | 15 seconds | |
| Prepared (unsigned) intent lifetime | 2 minutes | |
| Default slippage | 50 bps for verified assets, 300 bps suggested for unverified or curve assets | |
| Slippage warning above | 300 bps | |
| Slippage hard cap | 1000 bps, as the swap service enforces today (the capability matrix advertises 2000: fix, A6). Raise only deliberately, in Desktop advanced, with typed confirmation. | |
| Price impact warning above | 500 bps | |
| Price impact block above | 1500 bps | |
| USD liquidity floor (no USD below this pool size) | to be set per network from observed liquidity | |
| Maximum candles per request | 1000 | |
| Minimum poll interval for display data | 5 seconds | |

**6. Out of scope confirmation.** Everything in S14 stays out of v1 unless you write "include" next to it here: ______

**7. Questions only you can answer.** The builders must not guess these. Each changes what gets built.
1. Who is the operator, in which jurisdiction, and is running a token-creation and trading surface permitted there? (Counsel, before G3 is enabled and before any launch flow.)
2. What does "successful" mean for the launchpad, in one measurable sentence? The order of work flipped twice in a day because this is unwritten.
3. Who provides liquidity? Without pools there is nothing to trade. Will you seed, incentivise creators, or wait for an official venue?
4. Who controls the AMM program's upgrade authority? Ask the Thru team. If it is one key, every swap trusts that key.
5. When is mainnet, and will Betanet reset again? Registry, caches, drafts and pending intents all need a reset runbook.
6. Will Thru provide a local validator and a fix for the account-creation fault that blocked token-transfer evidence? Until then P3 cannot pass.
7. Where does DeFi enter the popup, given the frozen grid and the Swap tile that is a roadmap toast?
8. Is the custom registrar kept and audited, or replaced by the official one? Who holds its admin key and treasury?
9. What are the budget and dates for the independent audits (the extension, and any project-authored program)?
10. Who holds the feed-signing and kill-switch keys, and who is on call?
11. Must passkey or hardware accounts work with DeFi? Does interoperability with Thru's embedded wallet matter?
12. Will you accept a small hosted service and the privacy-policy change it forces, or stay serverless and live with no discovery and no images?
13. Is "Launchpad" the right name for a flow with no bonding curve? "Create token" promises less.
<!-- END:PROJECT-INPUTS -->

<!-- BEGIN:BUILD-STATE -->
# BUILD STATE (as of 2026-10-28, repo `main` at `1b9d096`; it is not fingerprinted, so refresh it identically in both files when facts move)

This is what exists, what was observed on the network, and what is known to be broken. Treat it as the starting point. If recon disagrees, recon wins and you report the difference.

**Versions.** Extension 1.4.1. `CONTRACT_VERSION` 28 (144 methods). `@thru/sdk` and `@thru/programs` 0.4.2, pinned exactly. Only `betanet` is enabled. Mainnet is not declared.

| Slice | State |
|---|---|
| G0 dossier and registry seed | done |
| M0 contract drop (READ at contract 17, EXEC at 18), fixtures in `test/fixtures/defi/`, drift tests | done |
| G1 read-only backend | closed by owner sign-off 2026-10-07 |
| G2-S0 intent pipeline for native send | landed 2026-10-09 behind `DEFI_INTENT`. P3 was waived by owner sign-off, not closed. |
| G3 swap backend (pool reads, exact-in quotes, `dex-swap` intents) | landed. One live swap on Betanet on 2026-10-25. |
| Swap UI | shipped 2026-10-26 and withdrawn the same day by owner directive. The backend stays. |
| Desktop page | not built. No `desktop.html`, no manifest or CSP change. |
| DeFi frontend | not started |
| Every DeFi flag | false |

Live but outside the DeFi scope: the name service and registrar (`name.*`, contract 19 to 25 and 28), the faucet limit (24) and cached balances (27).

**Owner directives that bind both sides**
1. 2026-10-26, "Option B": the launchpad backend is built first, and the swap UI stays withdrawn until the owner re-approves it. This exists only in a commit message. Put it in the decisions log.
2. The dashboard's main grid is frozen at six tiles (`scripts/check-panel-tiles.mjs`) and its Swap tile is a roadmap toast. Ecosystem entries go in the second "services grid" (first entry: Domain).
3. AGENTS.md rule 15: the UI never gates first paint on RPC. Every read a first paint needs has a cached counterpart.
4. AGENTS.md rule 14: sheets, drawers and overlays are checked in a real browser or the visual harness. The repo reverted dashboard layout twice and the swap slice once. Enable a flag only on a recorded decision, with screenshots.

**Observed on Betanet (dated evidence, not assumptions)**
- The AMM program is deployed (deployment observed 2026-10-06). Its version, upgrade authority and who controls pool creation are unknown.
- Pools derive from the sorted mint pair plus the fee tier. Init pool, add liquidity and an exact-in swap ran live on 2026-10-25 between two tokens the tester deployed. One quote: 987,158 out for 1,000,000 in against 100,000,000 and 100,000,000 reserves, which fits a fee of about 0.3%. That is one data point, not a parity vector.
- No liquidity exists except pools testers create. The verified list is empty.
- A swap needs the user's output token account to exist. The backend refuses with `TOKEN_ACCOUNT_MISSING`, so a buyer of a brand-new token cannot start.
- Remove-liquidity is not verified live, so adding liquidity stays disabled by R2. Direct-pool launch needs it.
- Simulation is unsupported (`tx.simulate` stub, docs negative).
- No launch or curve program exists among the 18 bootstrap programs.
- Token transfer (P3): FAIL 2026-10-06 to 2026-10-08 (an account-creation fault at the faucet rung) and BLOCKED_ENV on 2026-10-23. No passing evidence is on record.
- The chain was reset on 2026-09-26.
- The custom `.thru` registrar (D-016) is deployed on Betanet. Three live probes recorded the treasury at 0 before and after, so no fee was collected.

**Known defects to fix first** (details, fixes and tests in the backend spec, B1): A1 registrar fee uncollected while the UI quotes it. A2 intent store not serialised. A3 ambiguous submit recorded as failed and re-armable. A4 native-send review claims simulation. A5 zero minimum output possible on tiny quotes. A6 advertised slippage cap 2000, enforced 1000. A7 twelve emitted error codes undeclared. A8 name-write parameters declared but ignored. A9 flags not frozen. A10 feed records have no rollback sequence. A11 status docs stale and directives unrecorded. A12 P3 waived but written as closed. A13 no create-token-account intent. A14 registrar program unaudited. A15 an evidence probe that cannot fail.
<!-- END:BUILD-STATE -->

<!-- BEGIN:SHARED-CONTRACT v2.0.0 -->
# SHARED CONTRACT v2.0.0 (identical in the frontend and backend prompts)

This block is the only agreement between the two builders. It contains no implementation code. Names in backticks are things to create, reuse or verify.

## S0. Precedence, ownership, change protocol

**Precedence.** This block overrides the role spec that follows it. Repo conventions win over both only where this block and the role spec are silent. Report every conflict in your first reply. Never resolve one silently.

**Two version numbers.** The semantic version in the heading tracks the agreement between the two prompts. The extension's integer `CONTRACT_VERSION` tracks the runtime message contract. They move independently. The READ surface (groups R and L in S6) was delivered at contract 17 and the EXEC surface (groups P and X) at 18. The repo was at 28 on 2026-10-28 (BUILD STATE). New slices take the next free version. The contract is append-only: never rename or reshape an existing method. Retirement follows the manifest's own rule: a documented exception, zero callers left, and a test that the method is gone.

**Ownership.**

| Area | Frontend | Backend |
|---|---|---|
| Screens, routing inside popup and Desktop, components, copy, formatting, client-side input checks (UX only), UI fixtures, state gallery | owns | consumes |
| Contract manifest and schema, router, services, adapters, registry, risk engine, intent pipeline, market reads, feeds, permissions, storage, optional server, live-verification scripts, privacy docs | consumes | owns |
| This block, per-method fixtures, end-to-end tests | joint | joint |

**Chain facts** come only from the backend's Gate 0 dossier. The frontend never encodes a chain fact. It learns capabilities and limits from `program.capabilities`.

**Change protocol (CCR).** Nobody edits this block alone. A change request names: id, proposer, reason, exact before and after text per affected section, class (additive, behavioural, breaking), affected fixtures, and the interim seam you will build behind while waiting. The human relays it. Both files are then updated identically. Version bump: MINOR for additive, MAJOR for breaking, PATCH for clarification. Until approved, build to the current version.

**Tolerant reader.** Ignore unknown fields. Render unknown enum values and unknown codes neutrally, with the raw code visible in details. An unknown warning code renders its `fallbackText` at its stated severity. New codes never crash anything.

**Fail closed.** If a required method, capability or version is missing, the affected feature shows its unsupported state. It never guesses.

**Paths are not the contract.** Paths and file names in this prompt reflect the repo as read at the time of writing (extension v1.4.1, contract 28, `@thru/*` 0.4.2, as of 2026-10-28). The rules attach to responsibilities, not filenames. If recon finds a moved module, a new framework or a different structure, follow the repo, map every path named here to its current equivalent in your first reply, and carry on. `AGENTS.md` binds both builders. Where this prompt conflicts with it, stop and raise a CCR or ask the human. Never override it.

**The delivered contract wins.** READ and EXEC are built and signed off. Where S5 to S11 differ from what was delivered, the delivered contract is the truth and S15 records the difference. Do not rename a delivered method to match this text. Raise a CCR to change the text, or to add what is missing.

**Evidence over intention.** A status, price, fee, capability or gate is only as true as the evidence behind it (R19). Where docs, commit messages and code disagree, the code and the dated evidence win, and the disagreement is reported.

## S1. Ground truth

**S1.1 Settled by the repo's own docs (treat as law).**
- Thru is a native L1 with its own VM, transaction format, account model, Token Program, AMM direction, gRPC and gRPC-Web transport, and Explorer MCP. It is not EVM. External DEXs are UX references only. The UI never names one as a destination unless a verified integration exists.
- Official first-party packages only (`@thru/sdk`, `@thru/programs`), pinned exactly (the repo pins 0.4.2). No other new runtime dependency, no framework, no build-system replacement. No hand-written instruction encoding. Byte goldens come from verified specs, never from regenerated output.
- Anything that signs goes through the background `signing` auth class. An unlocked wallet is required. Password re-authentication is the user setting `requirePasswordForSigning`, which the code defaults to off, although AGENTS.md rule 10 says "by default". The repo's own docs disagree, so recon reports the real default. DeFi adds its own step-up policy on top (D5).
- The legacy launchpad is deleted and a quarantine test keeps it out. New work is isolated feature modules (`src/features/<name>`, `src/background/features/<name>`, own contract namespace, own tests, own storage keys, no sibling imports) per `docs/MODULE_BOUNDARIES.md`. Features never import the vault or the Thru client. The layering check and the DOM-sink ratchet (zero sinks across all of `src/`) cover every new path.
- No fabricated quotes, charts or market state. `supported: false` with a reason is a first-class result. Never treat editable metadata as a protocol fact.
- Program addresses and capabilities are per network. Only `betanet` is enabled today. `testnet`, `localnet` and mainnet are declared but disabled. Custom networks stay quarantined (v7 behaviour). Testnets reset: the repo records a managed-genesis reset on 2026-09-26 after which the old program addresses no longer existed.
- BigInt internally, strings on the wire. Money math goes through `src/shared/format.js`, never floats.
- Simulation is not supported today. `tx.simulate` is a declared-unsupported stub, blocked on RPC support (`docs/BACKEND_GAPS.md` C3). Do not repurpose it.
- No dApp provider exists and none may be invented (`window.thru`) until Thru publishes an extension-compatible contract.
- The shipped popup is 400 by 600 px. An opt-in side panel shares the popup page. The extension declares no `host_permissions`. Its CSP allows `connect-src` only to enabled networks' RPC origins, and `img-src` only to self and data URLs. `PRIVACY.md` promises no proxy, relay, backend server or telemetry.
- Source hierarchy: chain and program state, then official or project index, then third-party enrichment. Enrichment never decides a signature.

**S1.2 Reported by public sources, NOT verified (hypotheses for Gate 0).** These came from package listings, repository mirrors and a third-party MCP server's README. thru.org sub-pages could not be retrieved when this was written, and Thru's own docs say they are evolving. Each line is a question. BUILD STATE lists what has since been observed on Betanet, and a line is answered only as far as that evidence goes.
- `@thru/programs` is described as typed clients for core programs: token, AMM, CLOB, oracle, multicall, passkey manager "and others". No launchpad or curve program was named in anything retrievable.
- `@thru/indexer` (a backend indexing framework) and `@thru/replay` (historical replay) exist.
- A transaction record reportedly exposes one fee payer, one invoked program, a fee, a nonce, a start slot, requested compute, state and memory units, and read-write and read-only account lists. If true, that implies a nonce model, a validity window, resource-based fees and possibly one program invocation per transaction. Each changes batching, concurrency and fee preview.
- Public endpoints are reported as gRPC and gRPC-Web. A third-party README states there is no public indexer endpoint and no HTTP faucet.
- Token program: mint creation takes ticker, decimals and authorities. Token-account derivation takes owner, mint, program and an optional seed, so several token accounts per owner and mint may exist.
- Package names have changed over time. A third-party README calls the SDK proprietary-licensed, while npm metadata for the pinned `@thru/sdk` and `@thru/programs` (0.4.1 when read, 0.4.2 now) says Apache-2.0. Read the licence files (a backend dossier item).
- The `@thru/programs` 0.4.1 type declarations (read when this was written; the repo has since pinned 0.4.2, so re-read them; package surface, not a live network) show: AMM builders (init pool, add and withdraw liquidity, exact-in swap), an exact-in quote helper, pool address derivation from a sorted mint pair plus a fee in basis points (so several pools per pair may exist), a pool metadata parser, structured AMM events (swap, mint, burn, pool init, sync), and constants for default and maximum fee and minimum liquidity. Swap, add and withdraw arguments carry minimum-output bounds, and zero explicitly disables a bound. Token builders cover initialise mint (decimals, mint authority, optional freeze authority, ticker, seed, state proof), initialise account, mint-to and transfer. No set-authority, burn, approve, freeze or close builder appears in the listing. The bootstrap package names managed programs for noop, faucet, name service, oracle, multicall, ABI manager, token, AMM, CLOB, registrar, wrapped THRU, passkey manager, NFT, uploader and compression, and a THRUSD mint under legacy CREDITS export names. No launch or curve program is among them. Perp bindings exist but are out of scope. Managed-program deployment and inspection helpers exist (manager, ABI manager, uploader, deploy).
- Thru ships passkey-based embedded-wallet SDKs and a passkey-manager program. What dApps expect from an extension wallet is unknown.

Everything not in S1.1 or S1.2 is unknown.

**S1.3 Banned assumptions.** Approval, allowance or spender thinking · `0x` addresses · 18 decimals (decimals are per mint) · Uniswap-v2 constants (0.3% fee, 997 over 1000) · a single-number "gas" · mempool, MEV or sandwich assumptions (unknown on Thru: research, do not import) · `balanceOf`-style reads (balances live in token accounts) · chain-switch flows · permit signatures · "factory event" language (use program events and account state) · calling any pool, program or token "safe".

## S2. Hard rules (tag shows who carries the main burden; both sides still honour all)

- **R1 Verify before build [B].** Every chain fact is recorded in the registry with evidence (network, date, tool, account or transaction reference) before code depends on it. No evidence means an honest unsupported state. The frontend consumes capability flags and never decides.
- **R2 Exit before entry [B+F].** A sell, remove-liquidity or withdraw path is verified live before the matching buy or add path is enabled. Leaving a position is cheap on every surface. Entering an unverified asset needs Desktop context.
- **R3 Derive, don't trust [B].** Every pool, launch, mint and token account in a review is re-derived from program and seeds (where derivation exists) and compared with what the index or user supplied. A mismatch is a block.
- **R4 Chain before index [B].** Anything that can reach a signature (quote inputs, balances, authorities, pool state, claimable amounts) is read from the chain at prepare time. Indexed data is for display and discovery.
- **R5 Review what is signed [B+F].** The review binds the semantic payload: programs, accounts, instruction data, amounts, limits. Volatile envelope fields (nonce, start slot, resource limits) may finalise at signing inside a stated tolerance. Beyond it, re-review.
- **R6 No blind signing [B].** Built-in flows call registry programs only. Any other program in a built-in flow is a hard block.
- **R7 Simulation is a control [B+F].** Simulation is unsupported today. Until the dossier proves otherwise, every flow is labelled unsimulated. The review then shows declared moves decoded from the instructions the wallet itself built, and the flow is restricted (no Max where the fee is unmeasured, lower caps, extra confirmation) or disabled. Declared moves are never presented as simulated.
- **R8 No fake success [B+F].** Submitted, included, confirmed, indexed and done are different states. Show the one that is true. "Failed" needs proof. Otherwise the outcome is unconfirmed.
- **R9 Untrusted text stays text [F, with B sanitising at ingest].** Names, tickers, metadata, links, images and creator labels render as text nodes only. Bidi and control characters are stripped, length is clamped, confusables are flagged. No remote images in review or signing screens. DOM-sink checks cover every new module.
- **R10 Identity is the address [F].** Names, tickers and images never imply verification. Addresses are visible and copyable on every card, review and success screen.
- **R11 One risk authority [B produces, F renders].** Surfaces render every warning the backend returns, at the severity returned. They may not add, hide or downgrade one. They own only the copy.
- **R12 One pipeline [B+F].** Send, swap, liquidity, create, migrate and claim use the same intent pipeline and the same review component.
- **R13 Privacy by default [B+F].** No address leaves the device except to the user's selected chain endpoint. Project and third-party calls carry public identifiers only, unless the user opts into an account-scoped feature. Every outbound request is inventoried.
- **R14 No hidden economics [B+F].** Any fee to the project is a visible line item, enforced by the program or shown as its own instruction, defaults to zero, and appears in the ToS and store listing. No paid ranking. Sponsored slots are labelled.
- **R15 Honest degradation [B+F].** Stale, offline, unsupported, unverified, indexing and program-changed are each a designed state with a reason. Never an empty card.
- **R16 Reversible rollout [B, F honours].** Every capability sits behind a flag that defaults off and can be killed through a signed feed without a store release. DeFi flags are build-time constants with no URL or query override (the retired `?launchpad=1` pattern is banned).
- **R17 No zero bounds [B].** The AMM bindings treat a zero minimum as "no protection". No built-in flow ever builds a swap, an add or a withdraw with a zero minimum bound.
- **R18 Pin the context [B+F].** The reviewed account and network are pinned at prepare time and re-checked around signing (the existing checked-send pattern). A switch of either invalidates the intent. Signing uses the pinned network's client, not whichever network is active at that moment.
- **R19 Falsifiable evidence [B].** Every verification probe can fail. "Skipped", "non-fatal", "blocked" and "unknown" are never green and never count toward a gate. A price, fee or capability shown to a user must trace to evidence that it was observed: a fee is shown only if a measured balance delta proves it was charged. (The registrar fee probe passed while the treasury stayed at zero.)
- **R20 One signing guard [B].** Every method that signs or broadcasts (send, deploy, faucet, names, registrar, intents) is declared `signing` or documented as a narrow exception, sits in the transaction-guard set, and pins account and network. A test enumerates every handler that reaches a signing helper and asserts all three. A parameter the manifest declares must be enforced or removed.
- **R21 Serialised stores [B].** Any store that does read-modify-write over async storage goes through a single-flight queue and has a concurrency test. A comment claiming atomicity is not evidence.
- **R22 Ambiguity is not failure [B+F].** After a submit whose outcome is unproven, the state is `unknown`, the backend looks the signature up before any resubmission, and a re-prepare of an unproven intent is refused. The frontend never says "failed" without proof and never offers retry on `unknown`.
- **R23 Declared limits equal enforced limits [B].** The capability matrix serves the limits the handlers enforce, read from one constant, and a test compares them.
- **R24 Every emitted code is declared [B].** A test fails on any code a handler can emit that is missing from the manifest's error-code map.
- **R25 Docs say what the code does [B+F].** Status docs, decision records and gate states change in the same change as the code. A script compares the contract version and method count in the status doc with the manifest. A directive that exists only in a commit message is not recorded.
- **R26 Dark launch, then decide [F + owner].** A UI slice is built behind its flag, reviewed with screenshots in the visual harness, and enabled only on a recorded owner decision. Withdraw by flag, not by deleting the slice.

## S3. Surfaces and the split rule

```text
POPUP (400x600 as shipped)             DESKTOP TAB (full page, long-lived)    APPROVAL WINDOW (dApp requests)
balances, send, receive                markets, token pages, charts            only if a dApp provider exists
quick swap, token quick view           advanced swap, pools, liquidity         (same review component)
pending intents, network health        launchpad: discover, create, manage
"Open in Desktop" deep links              risk centre, activity, settings
        \                                    |                                  /
         +--- background: the single authority (registry, intents, risk, services) ---+
                                             |
                 official Thru transport, optional project read API
```

| Capability | Popup | Desktop |
|---|---|---|
| Routine swap between verified assets | Yes, quick | Yes, advanced (depth, route detail, chart beside) |
| Swap into an unverified asset | No. Deep link to Desktop. | Yes, after the risk view and typed confirmation |
| Sell or exit any held asset | Yes | Yes |
| Launch discovery | Entry in the dashboard's services grid only (opens Desktop) | Full |
| Token page: chart, trades, holders | Quick view | Full |
| Create a launch | No | Yes |
| Add or remove liquidity | No | Yes |
| Creator fees | Status only | Full dashboard, including claims |
| Migrate or graduate | No | Yes |
| Risk centre | Chips only | Full |
| Settings | Basics | Full, plus diagnostics |

**Rules**
- **Deep links** carry a route plus public identifiers only: `mint`, `pool`, `launch`, `tab`, `intent`. Never drafts, amounts, names or account data. The Desktop page is not web-accessible, so links into it cannot be shared outside the extension. Account and network context is restored from the background, never from the URL. Unknown routes or parameters fall back to the Desktop home.
- **One Desktop tab.** Opening it again focuses the existing one.
- **Naming.** This prompt calls the full-tab surface Desktop. The repo already reserves `desktop.html` and `src/desktop/` for it (`build.mjs`, `scripts/check-layering.mjs`). Existing popup routes use a leading slash (for example `/dashboard`), and Desktop routes follow that convention.
- **Same behaviour, different layout.** Both surfaces call the same methods, render the same review component and use the same copy keys.
- **Locked wallet.** Public reads may render. Any write path shows the unlock gate.
- **Dashboard entry.** The dashboard's main six-tile grid is frozen by owner directive and a guard script. DeFi entries go in the services grid below it. A new tile needs an owner decision and a change to the guard in the same commit.
- **Swap UI.** Withdrawn on 2026-10-26 (BUILD STATE). The popup swap row above is the target design, not a commitment, until the owner re-approves it.
- **Feature off** means no route, no message handler, no nav item. The wallet behaves as before.
- **Desktop routes** (register a route only when its capability is on): `wallet`, `swap`, `markets`, `markets/asset`, `pools`, `pools/pool`, `launchpad`, `launchpad/create`, `launchpad/review`, `launchpad/launch`, `my-launches`, `activity`, `risk`, `settings`, `diagnostics`, `learn`. Perps and predictions are not registered.

## S4. Wire conventions

- **Amounts** are base-unit integers as strings. Decimals travel with the asset. **Prices and ratios** are non-negative decimal strings. **Percentages** are integer basis points. Nothing is parsed with floating point on either side.
- **Addresses** are Thru identity strings, opaque, produced and compared only through official helpers. Never lowercased, trimmed by hand or compared as raw strings after transformation.
- **Time**: wall-clock as integer milliseconds. Chain position as a `slot` string. Durations in milliseconds, with the unit in the field name.
- **Every read that depends on a capability** returns `supported`. When false it carries a `reason` (S10) and nothing else is guaranteed. Unsupported is a result, not an error.
- **Every data record** carries `freshness` (S5). Stale data is rendered and marked, never hidden and never presented as live.
- **Errors** use the repo's existing envelope: success carries the data, failure carries an error with a stable `code`, a human `message` and a `retryable` flag. DeFi errors use the same envelope. Their `code` comes from S10, `message` carries the short English `fallbackText`, and an added `params` map carries machine-readable detail. New codes are appended to the manifest's error-code map. Raw upstream detail goes to diagnostics only.
- **Idempotency.** Every prepare call accepts `clientRequestId`. A repeated id returns the original result.
- **Pagination** uses opaque cursors. Sorting is stable. Pages carry freshness.
- **Networks** are identified by the extension's existing `networkId`. DeFi exists only for networks that have registry entries.
- **Parameter names** follow the existing manifest: `address` (the acting account), `networkId`, `mintAddress`, `toAddress`, `amountUnits`. Entity fields in S5 use the short names (`mint`, `amount`).
- **Logs** never contain secrets, addresses or amounts.

## S5. Vocabulary (fields every implementation must carry; follow repo naming style)

| Type | Fields |
|---|---|
| `Address` | Thru identity string exactly as official helpers produce it. |
| `Amount` | base-unit integer string. |
| `Decimal` | non-negative decimal string, used only for prices and ratios. |
| `Freshness` | source (one of: chain, index, feed, third_party, cache), slot (string or null), updatedAt (ms), ageMs, stale (bool), staleAfterMs |
| `Page<T>` | items, nextCursor (opaque string or null), freshness |
| `Asset` | mint, ticker, name, decimals, supply (Amount), mintAuthority and freezeAuthority (each: state one of revoked, held, unknown; holder Address when held), metadataMutability (one of immutable, mutable, unknown), listStatus (one of verified, denylisted, unlisted), imageRef (string or null: a project-proxied reference, never a third-party URL), description (string or null), links (list of strings, display only), createdAt (ms or null), holdersCount (int or null) |
| `AssetMatch` | Asset plus matchKind (one of: exactAddress, verifiedList, holding, index) |
| `Venue` | id, label (taken from the registry only), kind (one of: amm, curve, clob), programAddress, trust (one of: verified, unverified, blocked), capabilities (quote, execute, pools, chart, migrate: each bool), feeModel (descriptor code plus params) |
| `Pool` | poolAddress, venueId, mintA and mintB (in the chain's sorted order), vaultA, vaultB, lpMint, reserveA, reserveB (Amount), readAtSlot, feeBps (the pool's swap fee in basis points, or null when the model has none; pools derive from the sorted mint pair plus the fee, so several pools can exist for one pair), feeModel, status (one of: open, paused, closed, unknown), lock (state one of locked, burned, unlocked, unknown; whoCanWithdraw Address or null; until ms or null; verification one of chain, inferred, indexed), adminAuthority (Address, null, or unknown), createdAt, createdSlot, freshness |
| `Stage` | key (one of: draft, created, liveMarket, nearGraduation, readyToMigrate, ammLive), status (one of: done, current, upcoming, notApplicable, unsupported) |
| `Launch` | launchRef, mint, asset (Asset), creator (Address), launchAccount (Address or null), model (one of: mintOnly, directPool, curveToAmm), graduationMode (one of: automatic, manual, notApplicable, unknown), phase (one of: created, curveLive, nearGraduation, readyToMigrate, ammLive, unknown), stages (list of Stage, built by the backend so the frontend never hardcodes a lifecycle), template (id, version), curve (progressBps, thresholdThru, raisedThru, priceThru, or null), poolAddress (or null), graduation (txId, at, lpPolicy, callerReward, or null), fees (creatorRecipient, creatorAccrued, claimable, verification, or null), createdTx, createdAt, riskChips (list of codes), freshness |
| `LaunchCard` | launchRef, mint, ticker, name, imageRef, phase, model, creator, listStatus, liquidityThru, volume24hThru, progressBps (curve only), createdAt, riskChips, freshness |
| `MyLaunch` | Launch plus drafts and pending intents linked to it, claimable (Amount or null, with freshness), nextSafeAction (one of: view, resume, migrate, claim, none) |
| `Template` | id, version, label, model, trust, supports (trading, graduation, creatorFees, antiSnipe: each bool), quoteAsset (mint), fields (list: key, kind, bounds, default, fixedAfterLaunch, helpKey), riskNoteKeys |
| `DraftValidation` | fieldIssues (list: field, code, params), derived (mint, poolAddress, launchAccount: each Address or null), costsPreview (list of Cost), permanent (list of codes), editable (list of codes) |
| `MarketSnapshot` | target, priceThru (Decimal or null), fdvThru (Amount or null: supply times price, labelled "fully diluted value"), liquidityThru, volumeThru (h1, h24), trades (h1, h24), holders (int or null), usd (only for native THRU and only when a verified price source exists: Decimal, source, age; otherwise null with a reason; no price service exists in the repo today), freshness |
| `CandleSeries` | interval, candles (sparse list: t, o, h, l, c as Decimal; volumeThru; trades), markers (list: t, kind such as graduation), freshness. Gaps are real. Nothing is interpolated. |
| `Trade` | txId, time, kind (one of: buy, sell, addLiquidity, removeLiquidity, migrate), trader (Address), tokenAmount, thruAmount, priceThru |
| `HolderPage` | summary (top10ShareBps, creatorShareBps, count), page (Page of: owner, tokenAccount, amount, shareBps, tags from creator, pool, vault, locker, program, you) |
| `Position` | poolAddress, lpMint, lpAmount, shareBps, underlyingA, underlyingB, freshness |
| `Quote` | quoteId, venueId, poolAddress, route (list of hops, v1 is one), inMint, outMint, amountIn, expectedOut, minOut, priceImpactBps, rate (Decimal), poolFee (Cost), costs (list of Cost), readAtSlot, expiresAt, warnings, supported, reason |
| `PoolQuote` | quoteId, action, amounts (in, out, lp), minimums, shareAfterBps, poolInit (bool), costs, readAtSlot, expiresAt, warnings, supported, reason |
| `CapabilityMatrix` | features (list: key, state, reason, evidenceRef), limits (S11), registryVersion, contractVersion, feedSummary. Feature keys: balances, tokenTransfer, swap, pools, launchMint, launchDirectPool, launchCurve, migrate, claim, charts, discovery, simulation, usd. State is one of: enabled, readOnly, unsupported, paused. |
| `ProgramRecord` | role (one of: token, amm, curve, multicall, oracle), address, trust, verification (one of: unknown, observed, verifiedLive, goldenTested, deprecated), changeStatus (one of: unchanged, changed, unknown), managementState, updatedAt, evidenceRef |
| `FeedStatus` | kind (one of: verifiedList, denylist, registry, killSwitch), version, issuedAt, expiresAt, stale, signatureValid, active (killSwitch only) |
| `RiskReport` | facts, warnings, maxSeverity, listStatus, freshness |
| `Warning` | code, severity (one of: info, warn, high, block), params (map), subject (Address or null), fallbackText (plain English, at most 140 characters) |
| `Fact` | code, value (string, number, bool or null), verification (one of: chain, inferred, indexed, list), severity (optional), params |
| `Move` | direction (out or in), mint, amount, decimals, bound (one of: exact, min, max, estimated), owner (Address), counterparty (Address or null), noteCode (optional) |
| `Interaction` | role (one of: program, pool, mint, tokenAccount, launchAccount, recipient), address, label (registry label or null), trust (one of: verified, unverified, unknown, blocked) |
| `Cost` | kind (one of: networkFee, accountCreation, poolFee, platformFee, creatorFee, callerReward, reserve), amount, mint, basis (one of: exact, declared, measured, estimated; a network fee is `declared` because the chain does not report the charged fee, per the repo's BACKEND_GAPS C2b), units (resource-unit breakdown or null), params |
| `Ack` | id, kind (checkbox or typed), expected (exact text, typed only), codeRef |
| `Review` | intentId, type (one of: send, swap, poolAdd, poolRemove, launchCreate, launchMigrate, launchClaim), bindingHash (opaque), expiresAt, authRequirement (state one of: session, password; reason code when the password is due to step-up rather than the user's own setting), step (index, total, labelKey, or null), account (Address, label), networkId, moves, interactions, irreversible (list of codes with params), costs, warnings, facts, simulation (status one of: ok, failed, unavailable, and `unavailable` is the default today; deltas as list of Move, only when `ok`), requiredAcks, raw (feePayer, programs, accounts with writable flag and owner, instruction summaries, resource units, validity window, chain id) |
| `Step` | index, labelKey, state (one of: pending, awaitingAuth, signing, submitted, confirming, confirmed, failed, dropped, unknown, skipped), txId (or null), detectableFromChain (bool) |
| `Intent` | id, type, address, networkId, state (S8), steps (list of Step), attention (reasonCode and safeActions from: resume, view, abandon; or null), params (public summary only), createdAt, updatedAt, expiresAt (prepared only), txIds, error (code, params, or null), reconcile (status one of: pending, matched, mismatch, notApplicable; deltas), indexing (one of: notApplicable, pending, visible, timedOut) |

## S6. Method catalog

Groups: **R** read (READ version) · **L** local, non-secret, network-scoped, no network traffic (READ version) · **P** prepare and manage, cannot sign (EXEC version) · **X** execute (EXEC version).

Namespaces follow `docs/MODULE_BOUNDARIES.md`. `dex.*` and `launchpad.*` belong to their features and never call each other. `market.*`, `risk.*`, `program.*`, `feed.*`, `intent.*` and `desktop.*` are shared core services that both features call through explicit interfaces. They live outside both feature directories. Anything not listed is not part of this contract.

Existing methods stay untouched. The ones this contract relies on, by current name (confirm in recon): `tx.getBalances`, `tx.getCachedBalances`, `tx.getTotalBalance`, `token.getBalances`, `token.readMint`, `token.deriveTokenAccount`, `tx.getHistoryFeed`, `tx.getDetail`, `tx.getPending`, `tx.reconcilePending`, `tx.checkDuplicate`, `tx.sendChecked`, `token.transferChecked`, `tx.registerAccount`, `tx.checkHealth`, `tx.validateAddress`, `settings.get`, `settings.set`, `settings.setSecurity`, `network.getActive`, `system.ping`. `tx.simulate` stays a declared-unsupported stub and `tx.estimateFee` keeps its current behaviour.

| Method | Grp | Params | Result |
|---|---|---|---|
| `program.capabilities` | R | networkId | `CapabilityMatrix` |
| `program.list` | R | networkId | list of `ProgramRecord` |
| `feed.status` | R | none | list of `FeedStatus` |
| `feed.lookup` | R | networkId, kind (asset, pool, program, creator), ids | list of id plus status (verified, denylisted, unlisted, unknown) |
| `market.assetGet` | R | networkId, mintAddress | `Asset` |
| `market.assetSearch` | R | networkId, query, limit | list of `AssetMatch` |
| `launchpad.list` | R | networkId, tab (new, trending, nearGraduation, ammLive, watchlist), query, cursor, limit | `Page<LaunchCard>` or unsupported |
| `launchpad.get` | R | networkId, ref (mint address or launch address) | `Launch` |
| `dex.listPools` | R | networkId, mintAddress (optional), cursor, limit | `Page<Pool>` |
| `dex.getPool` | R | networkId, poolAddress | `Pool` |
| `market.snapshot` | R | networkId, target (mint address, pool address or launch ref) | `MarketSnapshot` |
| `market.candles` | R | networkId, target, interval, from, to, limit | `CandleSeries` |
| `market.trades` | R | networkId, target, cursor, limit | `Page<Trade>` |
| `market.holders` | R | networkId, mintAddress, cursor, limit | `HolderPage` |
| `risk.assetAssess` | R | networkId, mintAddress | `RiskReport` |
| `dex.positions` | R | networkId, address | list of `Position` |
| `launchpad.templates` | R | networkId | list of `Template` |
| `launchpad.listMine` | R | networkId, address | list of `MyLaunch` |
| `launchpad.validateDraft` | R | networkId, draft | `DraftValidation` |
| `intent.list` | R | networkId, address, scope (active or all), cursor, limit | `Page<Intent>` |
| `intent.get` | R | intentId | `Intent` |
| `launchpad.draftList`, `launchpad.draftGet`, `launchpad.draftSave`, `launchpad.draftDelete` | L | networkId, id, body | drafts. Never secrets. |
| `market.watchlistGet`, `market.watchlistAdd`, `market.watchlistRemove` | L | networkId, target | watchlist |
| `desktop.open` | L | route, params (S3 whitelist) | ok |
| `intent.prepareSend` | P | networkId, address, toAddress, mintAddress (absent for native THRU), amountUnits | `Review` |
| `intent.prepareCreateAccount` | P | networkId, address, mintAddress | `Review` (to add by CCR, S15) |
| `dex.quote` | P | networkId, address, inMintAddress, outMintAddress, amountUnits, amountMode (exact or max), slippageBps | `Quote` |
| `dex.prepareSwap` | P | quoteId, clientRequestId | `Review` |
| `dex.quoteLiquidity` | P | networkId, address, poolAddress, action (add or remove), amountOneUnits and amountTwoUnits (add) or lpAmountUnits (remove), slippageBps | `PoolQuote` |
| `dex.prepareLiquidity` | P | quoteId, clientRequestId | `Review` |
| `launchpad.uploadImage` | P | networkId, bytes, mime | imageRef and contentHash, or `UPLOAD_REJECTED` |
| `launchpad.prepareCreate` | P | networkId, address, draft, clientRequestId | `Review` for step one. The intent carries every step. |
| `launchpad.prepareMigrate` | P | networkId, address, ref, clientRequestId | `Review` |
| `launchpad.prepareClaim` | P | networkId, address, ref, clientRequestId | `Review` |
| `intent.rePrepare` | P | intentId | `Review` (expired or changed payload) |
| `intent.resume` | P | intentId | `Review` for the next step |
| `intent.discard` | P | intentId | `Intent` (before signing only) |
| `intent.stopWaiting` | P | intentId | `Intent` (after submit; implies nothing about the outcome) |
| `intent.submit` | X, `signing` | intentId, bindingHash, acknowledgements, and `password` when required | `Intent` |

Notes
- `intent.submit` is the only new method declared `signing`. It uses the repo's existing handshake unchanged: the router demands and verifies `password` when the user's signing policy says so. When D5's step-up applies and the wallet policy would not already ask, the handler itself demands the password and verifies it through the router's own verification routine. There is no second authorisation path.
- `intent.submit` re-validates the binding hash and the acknowledgements, re-checks the pinned account and network (R18), signs, submits and returns. A repeated call with the same intentId and bindingHash returns the current state and never signs twice.
- A prepare result is inert. It can be signed only through `intent.submit`. Prepared intents carry no password and no secret.
- A prepare or quote call returns only after assessment has run (and simulation, where it exists, or the marker that it is unavailable). The frontend never renders a partial review.
- `amountMode: max` is resolved by the backend (balance minus fee, account-creation cost and reserve).
- `intent.prepareSend` exists so the pipeline can be proven on the known-good send flow. The existing checked-send methods stay the default until parity tests pass.
- Every new method is added to the manifest and the router in the same change. The contract test checks both directions.
- Every read a first paint needs has a cached counterpart or answers cache-first with its `freshness` (AGENTS.md rule 15; `token.getCachedBalances` is the model).

## S7. Events and live data

New events are declared in the manifest's events map, camelCase like the existing ones, and are emitted only through the event service.

| Event | Payload |
|---|---|
| `intentChanged` | intentId, status, networkId (as delivered; `stepIndex` is a pending CCR, S15) |
| `capabilitiesChanged` | networkId |
| `feedChanged` | kinds |
| existing, unchanged: `accountsChanged`, `lockStateChanged`, `networkChanged`, `balanceChanged`, `pendingTxChanged` | as today |

**Live data is page-driven polling through the bridge.** Only visible pages poll. Cadence follows `freshness.staleAfterMs` and never goes below `pollMinMs` in the limits. The backend serves reads from a coalescing read-through cache, so a popup and a Desktop tab open together cost one upstream call. Every polled read is registered as a sync read so polling never counts as user activity for auto-lock (the repo's existing sync-read set). No surface holds a timer once it is hidden or destroyed.

## S8. Intent lifecycle

| State | Meaning | Next |
|---|---|---|
| `prepared` | Review produced. Nothing signed. Has `expiresAt`. | awaitingAuth, expired, discarded |
| `expired` | The payload outlived its validity before signing. | prepared (via `intent.rePrepare`), discarded |
| `awaitingAuth` | Re-authentication started. | signing, rejected |
| `signing` | Authenticated. Signing in progress. | submitted, failed |
| `submitted` | Sent to the endpoint. Transaction id known. | confirming, failed, dropped, unknown |
| `confirming` | Included but not yet at the confirmation criterion the dossier defines. | confirmed, failed, dropped |
| `confirmed` | Executed successfully and met the criterion. Reconciliation runs. | indexing, done |
| `indexing` | Confirmed, but the index does not show it yet. Only where discovery matters. | done |
| `done` | Confirmed, reconciled, and visible (or indexing not applicable, or timed out and labelled). | none |
| `rejected` | The user declined at auth or signing. Neutral, not an error. | none |
| `failed` | Proven on-chain failure with an error code. | none |
| `dropped` | The validity window passed and the chain proves no inclusion. | none |
| `unknown` | Ambiguous after submit (endpoint error, no proof either way). The backend keeps checking. | any submitted-or-later state |
| `needsAttention` | Multi-step flow where an earlier step succeeded and a later one did not. `attention` lists the safe actions. | awaitingAuth (via `intent.resume`), stopped |
| `discarded` | Dropped before signing, by the user or by TTL. | none |
| `stopped` | The user stopped waiting. No claim about the outcome. | none |

Rules
- An unsigned prepared intent is short-lived and discarded on TTL or on the surface closing. If the popup closes before signing, nothing is pending.
- **One tracker.** States from `submitted` onward are backed by the existing pending-transaction tracker, which already survives worker restarts, marks `confirmed` only on positive chain evidence, and gives up to `unknown` rather than guessing. The intent store links to its records. It never keeps a second tracker, because AGENTS.md says to stop and ask before adding a second store. That tracker has an open read-modify-write race on concurrent writes (`docs/BACKEND_GAPS.md`). The intent store serialises its own writes and must not copy the race.
- After `submitted`, the backend keeps tracking whether or not any surface is open, within the bounded policy in the backend spec.
- Multi-step flows: each step is idempotent and detectable from chain state. Resume is decided from the chain, never from local records alone.
- The backend never blindly resubmits after an ambiguous result. It checks the chain for the transaction first.
- **Reconciliation** compares actual balance deltas with the review. Principal amounts are compared exactly. The fee is only declared in the chain's detail response and never reported as charged, so it is compared against the declared bound and labelled declared. `mismatch` is flagged to the user and logged locally.
- **Delivered vocabulary.** The delivered store uses `prepared`, `waitingUser`, `waitingChain`, `submitted`, `failed`, `cancelled`, `expired`, `rejected`. S15 maps them. `unknown` and `needsAttention` do not exist yet and must be added before any multi-step flow or any resubmission path ships.
- Step label keys are open-ended. Examples: createMint, createMetadata, initPool, addInitialLiquidity, initialBuy, createTokenAccount, swap, addLiquidity, removeLiquidity, migrate, claim, send.

## S9. Review and risk output

**Severity** is one of: info, warn, high, block. **Facts** carry the verification tag (chain, inferred, indexed, list). The word "verified" is shown only for facts read from the chain, or for list membership that names the list.

**Simulation honesty.** `simulation.supported` is true only when a simulation ran. A balance check, a decoder or a quote is not a simulation. Declared moves are labelled declared.

**Interpretation of severity.** `block`: the action cannot proceed in a built-in flow and no override exists. `high`: requires a typed acknowledgement. `warn`: may require a checkbox. `info`: shown, no gate.

**Review contents, in display order.** What you send and receive (simulated deltas when simulation exists, otherwise the declared moves decoded from the instructions the wallet built, labelled unsimulated). What you interact with (programs, pools, mints with addresses and trust). Irreversible facts. Itemised costs. Warnings, verbatim. Facts. A raw-details expander.

**Required acknowledgements.** The backend lists them. The frontend renders them. The backend re-checks them at submit. A typed acknowledgement is the exact text in `expected` (for example the ticker plus the last characters of the mint).

**Asset facts** (backend produces): mint and freeze authority state, metadata mutability, whether authority can be revoked at all given the token program's instruction set, supply concentration, creator holding, liquidity amount, lock or burn state and who can withdraw, pool admin and venue-program management state, age, lookalike of a verified asset, duplicate image, a simulated exit (only where simulation exists; otherwise `UNSIMULATED` and no claim), token extensions or transfer restrictions if the token program has any.

**Transaction facts** (these replace any approval-style table): programs invoked and their registry membership, the writable account set and owners, authority changes or delegations, balance deltas for every user-owned account (simulated where possible, otherwise declared, and any outflow the decoder cannot explain is a block), account closures, unknown instruction layouts, a fee payer other than the user, envelope anomalies, any wallet or platform fee line, and any minimum-output bound that is zero (always a block, R17).

## S10. Codes (starter lists; unknown values are tolerated, additions are MINOR)

**Unsupported reasons**: `PROGRAM_NOT_FOUND`, `PROGRAM_NOT_VERIFIED`, `PROGRAM_CHANGED`, `NO_QUOTE_PARITY`, `NO_SIMULATION`, `NO_INDEXER`, `INDEX_STALE`, `NETWORK_NOT_SUPPORTED`, `NETWORK_RESET`, `CUSTOM_NETWORK`, `FLAG_OFF`, `KILL_SWITCH`, `FEED_MISSING`, `LAUNCH_MODEL_UNAVAILABLE`, `TOKEN_PATH_UNVERIFIED`, `DEPENDENCY_UNVERIFIED`, `NO_LIQUIDITY`, `UNKNOWN`.

**Warning and fact codes**
- Asset: `NEW_ASSET`, `UNVERIFIED_ASSET`, `DENYLISTED_ASSET`, `LOOKALIKE_OF_VERIFIED`, `DUPLICATE_IMAGE`, `MINT_AUTHORITY_HELD`, `FREEZE_AUTHORITY_HELD`, `METADATA_MUTABLE`, `SUPPLY_CONCENTRATED`, `CREATOR_HOLDS_MAJORITY`, `THIN_LIQUIDITY`, `LIQUIDITY_NOT_LOCKED`, `LIQUIDITY_LOCK_UNVERIFIED`, `POOL_ADMIN_PRESENT`, `EXIT_SIMULATION_FAILED`, `TOKEN_EXTENSION_PRESENT`, `SUSPICIOUS_TEXT`.
- Transaction: `UNKNOWN_PROGRAM`, `PROGRAM_CHANGED`, `UNKNOWN_WRITABLE_ACCOUNT`, `UNINTENDED_OUTFLOW`, `AUTHORITY_CHANGE`, `ACCOUNT_CLOSURE`, `FEE_PAYER_NOT_USER`, `UNKNOWN_INSTRUCTION`, `ENVELOPE_ANOMALY`, `UNSIMULATED`, `SIMULATION_FAILED`, `PLATFORM_FEE_PRESENT`, `DERIVATION_MISMATCH`, `ZERO_BOUND`.
- Market: `HIGH_PRICE_IMPACT`, `HIGH_SLIPPAGE`, `STALE_QUOTE`, `STALE_DATA`, `INDEX_CHAIN_MISMATCH`, `ACCOUNT_CREATION_REQUIRED`, `POOL_INIT_PRICE_DEVIATION`, `FIRST_DEPOSITOR`, `DESTINATION_POOL_PRE_EXISTING`, `NEAR_GRADUATION`, `WILL_GRADUATE`, `POOL_PAUSED`.
- Platform: `FEED_STALE`, `FEED_UNAVAILABLE`, `KILL_SWITCH_ACTIVE`, plus the existing `NEW_ADDRESS`, `SELF_SEND`, `DUST`, `FEE_UNKNOWN` where the repo already emits them.

**Error codes.** Existing and reused with their current meaning: `WALLET_LOCKED`, `AUTH_REQUIRED`, `AUTH_LOCKED_OUT`, `INVALID_REQUEST`, `UNKNOWN_METHOD`, `METHOD_ERROR`, `UNEXPECTED_ERROR`, `CUSTOM_NETWORK_DISABLED`, `SEND_CONTEXT_CHANGED` (send only). New: `USER_REJECTED`, `CONTEXT_CHANGED` (the DeFi equivalent of the send context code), `FEATURE_DISABLED`, `UNSUPPORTED`, `INVALID_INPUT`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_FEE_RESERVE`, `QUOTE_EXPIRED`, `BINDING_MISMATCH`, `INTENT_EXPIRED`, `INTENT_LOCKED`, `NONCE_CONFLICT`, `SIMULATION_FAILED`, `PROGRAM_ERROR` (with the program's own code in params), `SLIPPAGE_EXCEEDED`, `ACCOUNT_MISSING`, `ALREADY_EXISTS`, `RPC_UNAVAILABLE`, `TX_DROPPED`, `TX_REPLACED`, `NOT_READY`, `NOT_AUTHORIZED`, `NOTHING_TO_CLAIM`, `UPLOAD_REJECTED`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `VERSION_MISMATCH`, `INTERNAL`. Delivered but not yet declared in the manifest's error-code map: `INTENT_NOT_FOUND`, `PAIR_MISMATCH`, `POOL_UNAVAILABLE`, `SWAP_REVERTED`, `SWAP_STALE`, `TOKEN_ACCOUNT_MISSING`, `TX_RESULT_MISSING` and, for names, `INVALID_PARAMS`, `NAME_NOT_FOUND`, `NAME_ROOT_UNKNOWN`, `NAME_UNREADABLE`, `NOT_NAME_OWNER`. Declare them (R24).

**Copy ownership.** The backend emits codes, params and `fallbackText`. The frontend owns every user-visible string and keeps a copy key for every code above.

## S11. Flags, settings and limits

**Flags** live in the repo's flags module (`src/shared/flags.js`, confirm in recon), use its UPPER_SNAKE naming and default to false: `DEFI` (master), `DEFI_READ`, `DEFI_MARKET`, `DEFI_RISK`, `DEFI_FEED`, `DEFI_INTENT`, `DEFI_DEX`, `DEFI_LAUNCHPAD`, `DEFI_DESKTOP` (as delivered), plus `NAME_SERVICE`. The exported flags object is frozen. They are build-time constants. There is no URL or query override and no storage override, because the repo's own history shows a flag-plus-query override shipping a deleted surface. A flag hides UI. It is not the security boundary: each backend handler also refuses when its capability is off (`FEATURE_DISABLED`), and the security boundary is the signing policy, the pinned context and the review binding. Per-network enablement is expressed in the capability matrix (flag AND registry AND feed).

**User settings** go through the existing validated preferences. New keys must be added to its defaults whitelist with range validation, in the repo's flat camelCase style: `defiSlippageBps`, `defiLoadImages` (default false), `defiShowUnverified` (default false), `defiNotifications` (default false, uses the already-declared notifications permission), `defiTosAcceptedVersion`, `defiRiskAckVersion`. `defiAlwaysRequirePassword` (default false) is a security field: it changes only through the password-gated security-settings method, never through the generic one.

**Limits** arrive in `CapabilityMatrix.limits`. The frontend never hardcodes them: `quoteTtlMs`, `preparedTtlMs`, `slippageDefaultBps`, `slippageWarnBps`, `slippageMaxBps`, `priceImpactWarnBps`, `priceImpactBlockBps`, `usdLiquidityFloorThru`, `maxCandles`, `pollMinMs`. Starting values are in the project inputs and are proposals for the product owner, not facts.

## S12. Gates (both sides deliver to the same gate; a gate closes only on human sign-off)

| Gate | Backend delivers | Frontend delivers | Exit |
|---|---|---|---|
| **G0** | Recon, dossier, capability seed, decisions, preconditions (backend spec) | Recon, UI plan, mock bridge, state-gallery skeleton | Sign-off. The unsupported matrix is known. |
| **G1** Read-only | READ-version methods, registry, signed feeds, risk facts, market reads, privacy inventory, permission and CSP plan | Desktop shell, every read screen with every state, disabled popup entry points with reasons, Learn page | No write path exists. Flags off. Layering, CSP, route, contract, DOM and quarantine checks green (the quarantine test rewritten deliberately). |
| **G2** Pipeline | Intent pipeline, `intent.prepareSend`, `intent.*`, `intent.submit`, mint-only launch prepare, reconciliation | Shared review component, intent strip, status rail, send over the pipeline (flagged), mint-only create flow | Kill-mid-flow, duplicate-submit and reconciliation tests green. Every outcome state tested. Layout checked in a real browser or the visual harness. |
| **G3** Swap | `dex.quote` and `dex.prepareSwap` for one verified venue, parity tests, hard blocks | Popup and Desktop swap | Parity green. Every hard block tested. Counsel check. Kill-switch drill passed. |
| **G4** Pools and direct-pool launch | Liquidity methods (`dex.quoteLiquidity`, `dex.prepareLiquidity`), direct-pool orchestration | Pools UI, direct-pool create flow, step-machine UI | Add-then-remove round trip passes. Partial-failure and resume tests pass. |
| **G5** Curve and creator economics | Curve, graduation, claims, only if the dossier allows | Lifecycle rail, migration flow, creator fee panel | Program facts verified live. A project-owned program needs an independent audit. |
| **G6** Scale | Performance, runbooks, rollout controls | Polish, accessibility, budgets | Budgets met. Rollback rehearsed. |

The order of work is the owner's decision (BUILD STATE, directive 1). The table lists dependencies, not priority.

## S13. Handoff bundle and Milestone M0 (contract-first drop)

M0 (delivered at contract 17 and 18, fixtures in `test/fixtures/defi/`) is the model for every later slice. Each new slice repeats it before the frontend builds against it. M0 contains:
1. Manifest entries for every READ-version method and EXEC-version stubs, new events in the events map, new codes in the error-code map, and a machine-readable schema for each method's params and result. The manifest today lists only parameter names and a prose `returns`, so the schema goes in the repo's chosen place (extend the manifest or add a sibling file). The contract test passes in both directions.
2. Every method has a handler. Anything not yet implemented returns `supported: false` with a real reason, or `FEATURE_DISABLED`.
3. Fixtures for every method: success, each relevant unsupported reason, stale, offline and each error code it can raise.
4. Capability presets: everything off, read-only, swap only, full.
5. Intent scripts: happy path, user rejection, expiry and re-prepare, ambiguous outcome then resolved, multi-step launch with a partial failure and a resume. Each is a timed sequence of events.
6. A code inventory (every code emitted, with its params) and a changelog.

The frontend builds against a fixture-backed bridge until M0 lands, then switches to the real bridge and fixes any drift through CCRs. The frontend hands back a screen-to-method map (which screens call which methods and render which fields) and a copy-key inventory proving every code has copy.

**Fixture integrity.** The backend ships a test that checks real handler output against the fixture shapes (fields present, enum values valid). The frontend's mock mode must fail any production build.

## S14. Non-goals for v1

Perps and CLOB trading UI (perp bindings exist in the pinned package but are out of scope) · prediction markets · limit orders and DCA · aggregator routing · cross-chain and bridging · NFTs · fiat valuation · social features (comments, profiles, server-side watchlists) · token taxes or reflection · AI or social launch-intent creation · copy trading · sponsored or gasless swaps · DeFi on custom networks · fiat ramps · push notifications · any dApp provider or `window.thru` and third-party request interception (the review component and risk service are built so it can be added later, once Thru publishes an extension-compatible contract). Also out of scope until the owner decides: re-shipping the swap UI, and any project-authored on-chain program on mainnet before S16 is met.
## S15. Reconciliation with the delivered contract (the delivered contract wins; amend this block to match, and never rename a delivered method)

| Topic | Earlier text | Delivered | Resolution |
|---|---|---|---|
| Method name | `intent.reprepare` | `intent.rePrepare` | The delivered name is used throughout this block. |
| `intentChanged` payload | intentId, state, stepIndex | intentId, status, networkId | The delivered payload stands. Add `stepIndex` by CCR before multi-step flows ship. |
| Intent field name | `state` in S5 | `status` | The delivered name stands. |
| Intent states | the sixteen states in S8 | `prepared`, `waitingUser`, `waitingChain`, `submitted`, `failed`, `cancelled`, `expired`, `rejected` | Mapping: `cancelled` is S8 `discarded`, `waitingChain` is `submitted` or `confirming`, `waitingUser` is `awaitingAuth`. `unknown`, `needsAttention`, `stopped`, `indexing`, `done`, `dropped` and `confirmed` are added by CCR before the paths that need them ship. The frontend renders any status it does not know neutrally. |
| Flags | the S11 names of v1.0.0 | the nine delivered `DEFI_*` names plus `NAME_SERVICE` | The delivered names stand. |
| Error codes | the S10 list | the S10 list, plus codes emitted but undeclared | Declare them (R24). |
| Limits | `slippageMaxBps` 2000 advertised | 1000 enforced by the swap service | One constant (R23). Until fixed, the frontend uses the lower value. |
| Authentication | `Review.authRequirement` | absent. `defiAlwaysRequirePassword` exists as a security field. Step-up is not implemented. | Implement before any DeFi flag is enabled (D5). |
| Simulation label | `simulation.supported` is honest | the native-send review says `true`. The swap review says `false`, correctly. | Fix the native-send review (A4). |
| Receive account | not covered | nothing creates the buyer's token account | Add `intent.prepareCreateAccount` by CCR (A13). |
| Cached reads | not covered | `token.getCachedBalances` exists | Add cached counterparts for DeFi reads as screens need them (AGENTS.md rule 15). |

## S16. Program trust policy (project-authored or third-party programs)

1. Trust is a registry state, not a claim. A program that is not official and backed by dated evidence is `unverified`. The UI says who operates it and that it is not audited. A built-in flow may call an unverified program only on a non-mainnet network, and only behind a typed acknowledgement.
2. A project-authored program, before any mainnet use, needs all of: an independent audit of the exact deployed bytes; a reproducible-build proof (build from pinned source and toolchain and match the deployed hash, since a committed binary is not a source of truth); a disclosed upgrade authority that is either revoked or held by a documented multisig with a timelock; initialisation in the same transaction as deployment, or a check against the upgrade authority, so that first-caller-wins is impossible; bounded and timelocked admin parameters (fees, treasury); a max-fee bound in every instruction that charges one; propagation of every error from a value-moving call (a discarded result is a defect); on-chain enforcement of any expiry or lease it advertises, or no such copy; and falsifiable evidence for every claim (R19).
3. The wallet shows a fee only when evidence proves it was charged.
4. When an official program replaces a project-authored one, migrate and retire the project one (D1).
<!-- END:SHARED-CONTRACT -->

---

# FRONTEND SPEC

## F0. What the frontend must never do

- Call the network, a chain library or a third-party API from UI code. The bridge is the only door.
- Import the vault, the Thru client, adapters or any background module.
- Build HTML from strings. Untrusted text goes only through the guarded DOM helper as text nodes.
- Compute money, fees, quotes, impact, limits or phase lists. Amounts are strings. Limits come from `CapabilityMatrix.limits`. Lifecycle stages come from `Launch.stages`.
- Hardcode a chain fact, program address, fee, threshold or capability.
- Show success before `confirmed`, or say "failed" without `failed`.
- Hide, downgrade or add a warning. Offer an override for `block`.
- Put drafts, amounts, names or account data in URLs, storage keys or logs.
- Name an external DEX, or show USD for anything except native THRU with its source and age.
- Fill a screen with invented data. Use a designed state.
- Ship fixtures, the mock bridge or the state gallery. They are dev-only and must not exist in `dist/` (F12).
- Block first paint on an RPC call (AGENTS.md rule 15). Render from the cached counterpart immediately, mark its age, then revalidate.
- Add a tile to the dashboard's main grid, or change any existing tile's geometry (owner directive, `scripts/check-panel-tiles.mjs`).
- Enable a flag, or withdraw a shipped slice by deleting it, without a recorded owner decision and screenshots (R26).
- Add any runtime dependency other than first-party Thru packages. No charting library, no framework, no new build tool (AGENTS.md rule 5). Charts are built in-house (D15).
- Use `innerHTML`, `insertAdjacentHTML` or `outerHTML` anywhere (the build fails outright), or inline `style` and `on*` attributes (the CSP refuses them).
- Let a secret, a draft or an amount touch a URL, `location.hash`, router params, `data-*` attributes, storage, `window` or `console` (AGENTS.md rule 9). An account is named in a URL only through `src/shared/refs.js`.
- Ship a component without `{ el, update, destroy }` and a `destroy()` that removes the same handler references it added (use `disposer()`).

## F1. Recon and conformance

Read `AGENTS.md` first, then `CONTEXT.md`, `docs/MODULE_BOUNDARIES.md` and `docs/BUILD_SPEC.md`. At the time of writing the repo is vanilla ES modules bundled by esbuild with no framework. All DOM is built with the guarded `h()` helper in `src/ui/kit/dom.js` (which can create SVG elements), shared primitives live in `src/ui/kit` and `src/ui/domain`, screens are routes in `src/ui/app/routes/` registered in `src/ui/app/boot.js`, and styles are CSS files under `src/popup/styles/` bundled into one stylesheet. Confirm each of those in recon and record what you find:

- The route registration pattern, the route guards, and what `scripts/check-routes.mjs` requires (every navigated route registered, every registered route reachable, every CSS class defined).
- The bridge file and how routes obtain it, including the error shape (`ok`, `data`, `error` with `code`, `message`, `retryable`) and how events arrive. Only the bridge file may send messages to the background.
- The password prompt (`requirePassword()` in `src/ui/domain/password-prompt.js`), the existing send route and its review, the token drawer, the transaction detail sheet, the sheet and focus-trap kit components, and the toast and feedback components. The shared review component should grow from the send review and the existing sheet, not duplicate them.
- Formatting helpers in `src/shared/format.js` (BigInt-only amount formatting and parsing, address truncation). Extend that module for new needs, with tests. Do not write a second one.
- Design tokens and CSS structure, and the CSP in force (`default-src 'none'`, scripts and styles from self only, `img-src` self and data, `connect-src` only to enabled RPC origins).
- Component convention: every component returns `{ el, update, destroy }`, and `destroy()` removes the same handler references it added.
- The popup is 400 by 600 px. The side panel is the same page with a context marker. Mutual exclusion between them is implemented.
- The layering rules already name `src/desktop/` and `src/features/` as UI contexts, and `build.mjs` already reserves `desktop.html`. Confirm how a second page would be added and what `scripts/check-csp.mjs` and the quarantine test require when it is.
- The test chain and the layout rule. `npm test` runs on a DOM shim with no layout engine and cannot detect layout bugs, so AGENTS.md rule 14 requires any modal, sheet, drawer or overlay change to be seen in a real browser or in the visual harness (for example `scripts/preview-tx-sheet.html`, which loads the real built CSS).
- How copy is stored today. If there is no copy mechanism, add one small module for DeFi copy inside the feature, and do not refactor existing screens.

Conformance rules: reuse the kit. Small commits: never mix a security fix, a redesign and a new feature. Delete a replaced copy in the same commit. Never weaken or skip a test. Run build and tests before and after every change. Stop and ask (AGENTS.md) on anything about Thru program semantics, wire formats, fee units, token standards or signing behaviour, on a product decision, on a test that would need weakening, and on introducing a second router, store or way of building DOM.

## F2. Shell, navigation and deep links

**Popup.** Home gains: (a) entries in the dashboard's second services grid. The main six-tile grid is frozen by owner directive, and its Swap tile stays a roadmap toast until the owner re-approves swap. Launchpad and Markets entries open Desktop. An entry whose capability is not `enabled` stays visible but disabled with a one-line reason from the S10 copy, and when the master `DEFI` flag is off the entries do not exist. New entries reuse the existing tile component, class and 88 px cell, and `check-panel-tiles` must pass. (b) A pending-intents strip when `intent.list` (active) is non-empty: one line per intent with headline, state and a status glyph, at most three plus "and N more", tap opens the status screen. (c) An `Unverified` chip on holdings that are unverified. Unverified holdings are hidden by default per the `defiShowUnverified` setting.

**Popup routes** (leading-slash hash routes like the existing ones): swap, swap review, token quick view (by mint), intent status (by intent id). Register them through the existing route table and checks. Everything else opens Desktop through `desktop.open`.

**Desktop shell.** A top bar with the account pill (switch), the network pill (health from the existing network status and `tx.checkHealth`), the lock control and a DeFi status chip. A left nav with the routes in S3 whose capability is on. A content area with a contextual right rail. A banner stack above content, in this priority: kill switch, program changed, feed stale or missing, offline, capability limited. Each banner states its reason and what still works.

**Responsive.** Two columns at 1024 px and wider. Collapsed nav from 768 to 1023. Stacked below 768. Every shared component must also work at the popup's 400 px width.

**Deep links.** Accept only the S3 whitelist. Validate each parameter's shape through the same address helper path the repo uses for the send flow (via `tx.validateAddress` where applicable). On any failure show the Desktop home with a neutral notice. Never read a draft, amount or name from the URL. The Desktop page is not web-accessible, so share actions copy a mint address and an explorer link, never an extension URL.

**Lock.** When the wallet locks, Desktop overlays the unlock screen, keeps non-secret drafts, and returns to the same route after unlock. Public reads may stay rendered behind the overlay only if the repo's existing lock policy allows it. Otherwise blank them.

**Account or network switch.** Close any open quote or review, show a one-line notice, and clear every cache keyed to the old context. An intent already submitted keeps running and stays visible in the strip.

**One Desktop tab.** Opening Desktop again focuses the existing tab and navigates it.

## F3. Screens

Each card states what the screen reads, shows, does and blocks. Every screen must define loading, empty, unsupported (per reason), stale, offline, error (per code), locked and paused states, and every one appears in the state gallery (F12).

### Popup

**P1 Home additions**: see F2.

**P2 Swap (withdrawn 2026-10-26: build it dark behind `DEFI_DEX` and wait for the owner's decision).** Reads: `program.capabilities`, `tx.getBalances` and `token.getBalances` (holdings), `dex.quote`. Layout:

```text
+----------------------------------+
| <  Swap              acct   net  |
+----------------------------------+
| You pay                          |
| [ 0.00           ] [ THRU v ] Max|
| balance 120.40 THRU              |
|             (flip sides)         |
| You receive (estimated)          |
| [ --             ] [ Select v ]  |
+----------------------------------+
| Venue          Thru AMM verified |
| Min received   --                |
| Price impact   --                |
| Network fee    --  + new account |
| Slippage       0.5%  (edit)      |
| Quote age      4s                |
+----------------------------------+
| [ Review swap ]                  |
| reason line when disabled        |
+----------------------------------+
```

Behaviour: the pay side defaults to native THRU and may be any held asset (exit is always allowed). The receive picker lists, in order, your assets, the verified list, and search by name, ticker or address. Unverified results appear flagged and cannot be chosen in the popup: the row says "Open in Desktop to review this asset" and calls `desktop.open`. Input changes request a new quote after a short pause (about 300 ms). The quote refreshes until `expiresAt` while the screen is visible and stops when it is hidden. Warnings from the quote render inline at their severity. The button reads "Review swap". When disabled, one reason line says why (no amount, not enough balance, quote loading, quote stale, unsupported with the S10 copy, locked with an Unlock action, or a `block` warning). The button calls `dex.prepareSwap` and opens the review sheet. When the backend returns `TOKEN_ACCOUNT_MISSING` for the output asset, show a plain step ("Create your <TICKER> account first") that opens its own review through `intent.prepareCreateAccount`, then returns to the swap. Never create it silently.

**P3 Review sheet.** The shared review component (F6) in compact form.

**P4 Token quick view.** Reads `market.assetGet`, `market.snapshot`, `risk.assetAssess`. Shows identity (address first), phase badge if it is a launch, price in THRU with freshness, up to three highest-severity risk chips plus "See all in Desktop", and the actions Swap (only if verified or held) and Open in Desktop. Buying an unverified asset is never offered here.

**P5 Intent status.** Reads `intent.get` and the `intentChanged` event. Shows the status rail (F6), the transaction id with copy, an explorer link, and Open in Desktop. For `needsAttention` it explains in one sentence and sends the user to Desktop to continue.

### Desktop

**D1 Wallet.** Larger portfolio view: holdings (unknown assets hidden behind a toggle), pending intents, recent activity (existing history). Reads the existing `tx.getTotalBalance`, `tx.getBalances`, `token.getBalances`, `tx.getHistoryFeed` and `tx.getPending`, plus `intent.list`.

**D2 Swap terminal.** Two columns. Left: the chart for the selected pair when charts are enabled (otherwise a designed unsupported card), recent trades, pool facts. Right: the swap panel using the same quote and review flow as the popup, plus venue and pool selection when more than one exists, depth, minimum received, price impact, a raw-details expander, and developer details (pool and mint addresses). Entering an unverified asset: show the risk report first, then require the typed acknowledgement from the review. Reads `dex.quote`, `dex.listPools`, `dex.getPool`, `market.candles`, `market.trades`, `risk.assetAssess`.

**D3 Markets.** Discovery with tabs (New, Trending, Near graduation, AMM live, Watchlist), search (name, ticker, mint, creator), and a dense table or card grid. Each row: identity, phase badge, liquidity, volume, age, risk chips, progress for curves. The Trending tab carries its caption: "High recent activity. Not a safety signal." When `discovery` is unsupported: show a lookup-by-address box, your holdings, the verified list, and the reason copy. Reads `launchpad.list`, `market.assetSearch`, `market.watchlistGet` and its add and remove companions.

**D4 Token page.**

```text
+--------------------------------------------------------------+
| $SYM  Token name                       [Watch] [Copy mint]    |
| mint ta..  creator ta..  network  phase badge  list status    |
| Created > Live market > Near graduation > Ready > AMM live    |
+--------------------------------------------------------------+
| Price | Fully diluted value | Liquidity | Volume 24h | Holders|
+------------------------------------+-------------------------+
| Chart (interval chips)             | Trade panel or          |
| price + volume, graduation marker  | unsupported card        |
+------------------------------------+-------------------------+
| Tabs: Trades | Pools | Holders | Risks | Creator              |
+--------------------------------------------------------------+
```

The lifecycle rail comes from `Launch.stages`: render `notApplicable` as hidden, `unsupported` as an explicit unsupported stage, never as an empty card. Stats name their source and age. Reads `launchpad.get` or `market.assetGet`, `market.snapshot`, `market.candles`, `market.trades`, `market.holders`, `risk.assetAssess`.

**D5 Pools.** List and detail with reserves, depth, fee parameters, lock and burn facts, admin authority, age. Positions from `dex.positions`. Add and remove liquidity:

```text
+--------------------------------------------------+
| Add liquidity   pool ta..   THRU / TOK           |
| Deposit  [ THRU ] [ TOK ]  ratio from reserves   |
| You receive  LP at least ...   share after ...   |
| [!] This pool has no reserves. You set the price.|
|     Type the ticker to confirm: [          ]     |
| [ Review liquidity ]                             |
+--------------------------------------------------+
```

The warning and the typed acknowledgement appear only when the backend's `PoolQuote` says `poolInit` or returns the matching warning. Unknown LP tokens are never shown as positions. Fee accrual and impermanent loss appear only if the backend supplies them. Reads `dex.listPools`, `dex.getPool`, `dex.positions`, `dex.quoteLiquidity`.

**D6 Launchpad home.** Discover boards (same data as Markets, launch-focused), a Create call to action, and a My launches shortcut. Cards expose phase and risk at a glance. The default screen is discovery, never an empty create form.

**D7 Create.** Quick and Advanced modes.

```text
+------------------------------+-----------------------------+
| Create token   [Quick|Adv]   | Preview card                |
| Name    [            ]       | image  $TICKER              |
| Ticker  [            ]       | name                        |
| Image   [upload]             | mint ta.. (derived)         |
| Description [        ]       | phase: Draft                |
| Links   [            ]       | What is permanent           |
| Creator account [v]          |  - ticker, name, supply ... |
| Template [Quick v]           | What can change             |
| Costs preview                |  - ...                      |
| [ Review launch ]            | This does not make the      |
|                              | token safe or valuable.     |
+------------------------------+-----------------------------+
```

Quick: name, ticker, image, one-line description, links, creator account, and the default template. Advanced adds only the fields the chosen `Template.fields` lists, each with bounds, a "fixed after launch" marker, inline help and a computed summary. The form is driven by the template, so a new template needs no new screen. After each change, call `launchpad.validateDraft` and render `fieldIssues`, `derived` addresses, `costsPreview`, `permanent` and `editable`. Image upload goes through `launchpad.uploadImage`. If hosting is unavailable the image field says so and the launch can proceed without an image. Drafts save through `launchpad.draftSave` and its companions, never with secrets, and are cleared from memory on route exit. The CTA reads "Review launch" and calls `launchpad.prepareCreate`.

**D8 Launch review and step machine.** The shared review component, plus a stepper for multi-step launches. Each step gets its own review and its own authentication unless D6 allows a bound batch. The screen survives a closed tab: it rebuilds from `intent.get`. `needsAttention` shows what exists on-chain, what is missing, and only the safe actions listed in `attention.safeActions`.

**D9 Launch page (post-creation).** The D4 token page with a lifecycle panel. Automatic graduation: status only. Manual migration: an explicit panel showing who can call it, the reward, the accounts moved, LP ownership or lock, and the destination pool, each only when verified. The panel's action calls `launchpad.prepareMigrate`. A success state appears only after the backend reports the pool state verified.

**D10 My launches.**

```text
Needs attention
  $AAA  mint ta..   step 2 of 3 failed        [Resume] [View] [Abandon]
Ready to migrate
  $BBB  threshold reached                     [Review migration]
Live
  $CCC  curve 62%   claimable 12.4 THRU       [View] [Claim]
Drafts
  untitled          saved 2m ago              [Continue] [Delete]
```

Reads `launchpad.listMine`, `launchpad.draftList`, `intent.list`. One next safe action per row. Claimable amounts are shown only when the backend marks them chain-verified.

**D11 Activity.** Existing history, plus intents with their final states and reconciliation result. A `mismatch` is shown plainly.

**D12 Risk centre.** Feed status and age, program registry with trust and change status, denylist lookup by address, settings for unverified assets. Reads `feed.status`, `program.list`, `feed.lookup`.

**D13 Settings and diagnostics.** Slippage and impact preferences (within backend limits), image loading toggle, unverified visibility, the stricter-only "always ask for my password for DeFi" option (changing it uses the password-gated security-settings path, like the existing signing setting), notifications opt-in, terms and risk acknowledgement status, the capability matrix with reasons and evidence references (it already reflects the build flags), data sources with freshness, contract versions, and a local diagnostics export.

**D14 Learn.** Static page with the standing warnings (F9) and plain explanations of lifecycle stages, authorities, liquidity lock wording, and what the wallet can and cannot check.

## F4. Components

Presentational components take plain data and emit events. Only container modules talk to the bridge. Every component returns `{ el, update, destroy }` and has fixtures for each of its states. Placement follows `docs/MODULE_BOUNDARIES.md`: primitives that are genuinely reusable go in `src/ui/kit` (domain-free) or `src/ui/domain`, and feature-specific pieces go in `src/features/dex/ui` or `src/features/launchpad/ui`. The dex UI never imports the launchpad UI and the reverse. Shared pieces both use (identity, risk, freshness, review, chart) therefore live in `src/ui/domain`.

| Group | Components |
|---|---|
| Identity and trust | `AddressChip` (short form, expand, copy, explorer), `TokenIdentity` (identicon or allowed image, ticker, name, list status), `ListBadge`, `TrustBadge` (verified, unverified, blocked), `RiskChip`, `RiskFactList` |
| State | `FreshnessLabel`, `StaleChip`, `UnsupportedCapability` (reason copy plus what happens next), `DeFiPausedBanner`, `FeedBanner`, `OfflineBanner`, `LockOverlay` |
| Trading | `AmountInput`, `TokenPicker`, `SlippageControl`, `QuoteSummary`, `PriceImpactBadge`, `TypedConfirm`, `SwapPanel`, `QuoteReviewCard` |
| Review and status | `ReviewSheet` and `ReviewSection`, `MoveRow`, `CostRow`, `WarningList`, `AckList`, `RawDetails`, `SigningStatusRail`, `IntentStrip`, `IntentStatus` |
| Market | `MarketChartShell`, `CandleChart`, `VolumeBars`, `DepthCard`, `PoolFactsCard`, `TradeTape`, `HolderDistribution` |
| Launch | `LaunchCard`, `LaunchTable`, `PhaseBadge`, `LifecycleRail`, `ProgressBar`, `TemplatePicker`, `TokenDraftForm`, `TokenPreviewCard`, `PermanenceChecklist`, `CreatorFeePanel`, `MigrationPanel`, `StepMachine`, `WatchButton` |

Rules: no component builds markup from strings, accepts a raw URL, or reads from storage. `TokenIdentity` renders an image only under the F7 image rule. `UnsupportedCapability` is the only way a disabled state is drawn.

## F5. Data flow and state

- A thin client wraps `bridge.send`. It deduplicates in-flight identical requests, caches by (network, account, method, params) for as long as `freshness` allows, and revalidates on the matching event.
- Skeletons for loading. No spinners that hide layout. Never show cached data from another network or account, and clear caches on any context switch.
- First paint never waits on RPC (AGENTS.md rule 15). Render from the cached counterpart at once, mark its age, then revalidate. A screen that blocks on a network call before painting is a defect.
- Live data: poll through the bridge only while the screen is visible, at the cadence the data's `freshness.staleAfterMs` implies and never faster than `pollMinMs`. Stop on hide, route change and `destroy()`. The backend serves polled reads from a shared cache and registers them as sync reads, so a polling Desktop tab does not defeat auto-lock. Show a small live or paused indicator. No timer survives `destroy()`.
- Optimistic updates are banned for anything involving money or status. Intent state comes only from `intent.get`, `intent.list` and the `intentChanged` event.
- Form state is ephemeral per route and cleared on exit. Drafts persist only through the `launchpad.draft*` methods.
- Closing the popup before signing: on page-hide call `intent.discard` as a best effort. The backend also expires prepared intents by TTL, so correctness never depends on this call.
- Event handling is idempotent and order-tolerant. A stale event never rolls the UI backwards past a terminal state.
- An unknown enum value or code renders neutrally (S0). A missing method renders the unsupported state with `UNKNOWN`.

## F6. Review, authentication and status UI

One review component for every action (R12), built from the `Review` payload only. It never reads form inputs to describe what will happen.

**Sections in order**: what you send and receive (use `simulation.deltas` when `ok`, otherwise `moves` with an "unsimulated" label); what you interact with (addresses, roles, trust); irreversible facts; itemised costs, each with its `basis` shown (a network fee is "declared", never "charged"); warnings, verbatim and ordered by severity; facts with their verification tags; raw details (collapsed).

**Controls.** The confirm button is disabled until required acknowledgements are satisfied and for a short delay (about 600 ms) after the review first renders or any content changes. `block` warnings disable it with no override. `high` warnings need the typed text exactly as `expected`. `warn` warnings may need a checkbox. The label is a verb phrase: "Authenticate and sign", "Authenticate and launch", "Authenticate and migrate". Never "Buy now".

**Anti-redress.** The confirm control is not overlapped by anything and is not inside a region that renders untrusted content. No remote images anywhere in review or authentication (address-derived identicons only). Text is clamped and bidi-stripped. Keyboard order is review sections, acknowledgements, then Cancel before Confirm. Focus is trapped in the sheet and returns to the trigger on close.

**Authentication step.** The review's `authRequirement` decides it. When it is `password`, reuse the existing `requirePassword()` prompt, show the reason when it is a step-up (first use of a program, pool or asset, a high warning, or a launch action), and pass the password to `intent.submit`. When it is `session`, submit without a prompt. Repeat a one-line summary (headline plus net moves) in the password step, so the password is never entered blind. Submitting calls `intent.submit` with the `bindingHash` and the acknowledgements. The password is cleared from memory immediately after the call and on `destroy()`.

**Status rail** (from the intent's `status` as delivered, S15, and `steps` where present): awaiting auth, signing, submitted (transaction id, explorer link), confirming, confirmed, indexing, done. Terminal and special states: `rejected` is neutral ("You cancelled"), `expired` offers a refresh through `intent.rePrepare`, `failed` shows the mapped error, `dropped` says the network did not include it, `unknown` says "Outcome unconfirmed. Checking the network." and never "failed", `needsAttention` shows the safe actions, `stopped` shows what was stopped without claiming an outcome. After `confirmed`, show the reconciliation result. A `mismatch` is surfaced plainly with the expected and actual amounts.

**Copy discipline.** All text comes from copy keys derived from codes (F9).

## F7. Forms, numbers and formatting

- **Amount input**: accepts digits and one decimal separator, limits fractional digits to the asset's `decimals`, sanitises pastes, trims leading zeros, treats empty as zero. Convert with `parseTokenAmount` and format with `formatTokenAmount` from `src/shared/format.js` (extend that module for rounding direction and tiny prices, with tests). Never `Number`, never `parseFloat`. Compare as BigInt. Zero-decimal assets must work. Show the asset's balance and a Max action that sets `amountMode: max` and lets the backend compute the number.
- **Slippage input**: integer basis points, presets plus custom, validated against `limits`. Show a plain sentence about what it protects and what it does not. Above `slippageWarnBps` show a warning. Above `slippageMaxBps` the control refuses unless the Desktop advanced path is active.
- **Rounding for display**: amounts you receive are floored, amounts you pay and costs are ceiled, never rounded in the user's favour. A nonzero percentage never displays as zero (use "less than 0.01%"). Minimum received is shown exactly.
- **Large numbers**: grouping separators. Compact notation only in dense tables, with the full value on hover and focus. Never compact in a review.
- **Tiny prices**: use a zero-count notation (a subscript digit for the number of leading zeros) built from text nodes and elements, with the full decimal in the accessible name.
- **Addresses**: short form (first six and last four) in lists. Full form on expand. In a review show the full address in groups of four characters. Copy always copies the exact string. Never transform the string before copying or comparing.
- **Time**: relative ("12m ago") with the absolute time on hover and focus. Tabular numerals everywhere numbers align.
- **Percent change**: sign, arrow glyph and colour together, never colour alone.
- **Identicons**: deterministic from the address, generated locally, no fetches.
- **Images**: render only when the `defiLoadImages` setting is on and `imageRef` points at the project proxy host. Otherwise show the identicon. Always decorative alt text (the name is already in text), no referrer, lazy loading, fixed dimensions. Never render SVG.
- **Lists of untrusted text**: clamp length, strip bidi and control characters, flag confusables with the `SUSPICIOUS_TEXT` treatment, and never let a name or ticker occupy the position of a verified badge.

## F8. Charts

- Build charts in-house on SVG or canvas through the DOM kit (D15). Do not add a charting library: AGENTS.md allows only first-party Thru packages as new dependencies, and lifting that rule is the owner's decision. Check which SVG tags the kit's `h()` creates today (path, line, polyline, polygon, circle, rect, ellipse, g and others) and extend that set with a tested change if axis text or titles need more.
- Charts and screeners live in the Desktop bundle only. The popup shows at most a small sparkline built from the same series.
- Render only `CandleSeries` from `market.candles`. Draw gaps as gaps. Never interpolate or synthesise a flat series.
- Show a marker at graduation when present, and a continuous price definition across curve and pool as the backend supplies it.
- Price axis in THRU. USD only for native THRU, when a source exists, with source and age. Time axis in local time with UTC in the tooltip.
- Intervals come from the backend's response metadata, not a hardcoded list. Cap rendered points to `maxCandles`.
- States, each designed: loading, no trades yet, "Pool live, chart building", stale ("Data stale. Last update 4m ago. A fresh quote is read before signing."), offline, unsupported with reason.
- Accessibility: a text summary and a data-table alternative for every chart. Respect reduced motion.
- A chart never sits above or inside the confirm control of a review.

## F9. Copy system

Every string comes from a copy key. Keys derive from codes: warning, error, reason, phase, stage, step, acknowledgement. Unknown codes use the key for the generic fallback and show `fallbackText` as the body.

**Avoid and prefer.**

| Avoid | Prefer |
|---|---|
| Safe or secure launch | State the verified fact only: "Liquidity is locked: the creator cannot withdraw this pool under this template. The token can still lose value." If not verified: "Liquidity lock not verified." |
| Verified token | "Verified mint address" or "On the verified list" |
| Guaranteed graduation | "Graduates only if this threshold is reached: X THRU." |
| Buy now, Swap now | "Review swap" |
| Launch instantly | "Create draft", "Review launch", "Authenticate and sign" |
| Trending is good | "High recent activity. Not a safety signal." |
| Best price | "Quote from <venue>, <age> old" |
| Gasless or free | Itemised costs |
| A fee shown without proof | Show a fee only when its `Cost.basis` is `measured` or `exact`. Otherwise say "Fee not confirmed". |
| "Operated by this wallet's team" left out for a project-run program | "Operated by <operator>. Not audited." on every flow that calls a program with trust `unverified` (S16). |
| Failed (when unproven) | "Outcome unconfirmed. Checking the network." |
| Success on submit | "Submitted" |
| Market cap | "Fully diluted value (supply times price)" |
| APR or APY with no source | Omit |
| MEV protected | No claim |
| Hot, moon, gem | The phase labels: Live on curve, Near graduation, Ready to migrate, Graduated, AMM live |

**Standing warnings** (Learn page, and the first-use acknowledgement): new tokens are experimental and can lose all value. Names and images are written by the creator and can be copied, so verify the address. Graduation or a list entry is not an endorsement. Charts are delayed market data, and a fresh quote is read from the network before you sign.

**Unsupported reason copy** (starting set; author the rest by the same rule: say what is missing and what still works, claim nothing about the chain). `FLAG_OFF` is never shown, because when a flag is off the feature does not exist on any surface.

| Reason | Copy |
|---|---|
| `PROGRAM_NOT_FOUND` | This feature needs an on-chain program that is not available on this network. |
| `PROGRAM_NOT_VERIFIED` | This feature is waiting for verification. Nothing here can be used yet. |
| `PROGRAM_CHANGED` | The program changed since it was verified. Actions are paused until it is re-checked. |
| `NO_QUOTE_PARITY` | Quotes for this pool cannot be checked yet, so swaps are off. |
| `NO_SIMULATION` | Transaction previews are not available here. Actions that need one are off. |
| `NO_INDEXER` | Market data is not available on this network yet. You can still look up a token by address. |
| `INDEX_STALE` | Market data is delayed. A fresh quote is read before you sign. |
| `NETWORK_NOT_SUPPORTED` | DeFi features are not available on this network. |
| `NETWORK_RESET` | This network was reset. DeFi is paused until its programs are re-verified. |
| `CUSTOM_NETWORK` | DeFi features are off on custom networks. |
| `KILL_SWITCH` | DeFi is paused. Your funds are on-chain and the wallet still works. |
| `FEED_MISSING` | The safety list could not be loaded. Unverified assets are blocked. |
| `LAUNCH_MODEL_UNAVAILABLE` | This launch type is not available on this network yet. |
| `TOKEN_PATH_UNVERIFIED` | Token balances and transfers are not verified yet. |
| `DEPENDENCY_UNVERIFIED` | A step this feature depends on is not verified yet. |
| `NO_LIQUIDITY` | This pool has no liquidity. |
| `UNKNOWN` | This is not available right now. |

## F10. Visual and motion direction

- Dark industrial surfaces already in the wallet. Dense, calm hierarchy. Monospace for addresses, tabular figures for stats. No casino neon, no meme-site chaos in the wallet chrome.
- Colour semantics: teal for positive or confirmed, gold for caution, stale or unverified, brick for negative or blocked, steel for neutral. Colour never carries meaning alone: pair it with a glyph or text.
- Severity: info (steel), warn (gold), high (brick outline), block (brick filled with a lock glyph).
- Motion only for lifecycle changes: submitted, confirmed, graduation progress, stale or offline. Nothing animates around a buy or confirm control. Honour reduced motion.

## F11. Accessibility, internationalisation, performance

- WCAG 2.2 AA. Every flow works by keyboard. Sheets trap focus and restore it (the kit already has a focus trap). Live regions announce status changes. Reduced motion is respected. The popup layout is verified at its shipped 400 px width, and the side panel at narrow widths.
- No literal strings in new components. Number and date formats follow the user's locale for display only. Wire values are never locale-formatted.
- **Budgets.** The build is a single IIFE bundle per page with no code splitting, and AGENTS.md forbids a build-system change, so there are no lazy chunks. Keep weight where it belongs: charts, screeners, pool analytics and the create wizard go in the Desktop bundle only, and the popup gets only the swap module and the shared review. Record the current popup bundle size in recon, then hold the popup's DeFi growth to a proposed 40 KB gzipped and the Desktop bundle to a proposed 300 KB gzipped. Confirm or change these numbers with the owner.
- The popup must not block on market data: render cached state first and mark its age.

## F12. Mock mode, fixtures and the state gallery

- A fixture-backed bridge implements every method in S6 from fixtures (the repo's delivered M0 fixtures in `test/fixtures/defi/`, including `intent-scripts.mjs`; confirm in recon, and write only the gaps S15 lists). It also replays the intent scripts as timed event sequences.
- **Dev-only, outside the shipped tree.** The fixtures, the mock bridge and the state gallery live under `scripts/` or `test/`, in a harness page that loads the real built stylesheet, like the existing `scripts/preview-tx-sheet.html`. Nothing under `src/` imports them. The harness substitutes the bridge module without touching production code (for example with an import map). A test asserts that no file under `src/` references the harness and that `dist/` contains no fixture, mock or gallery file. This also keeps the quarantine test's scan of `dist/` clean.
- The **state gallery** lists every screen and component in every state: loading, empty, success, stale, offline, unsupported (each reason), error (each code), locked, paused, feed stale, each intent state, each capability preset. It is the primary review artifact at each gate, and the harness for the layout checks that AGENTS.md rule 14 demands for every sheet, drawer and overlay.

## F13. Frontend tests and acceptance

| Area | Required |
|---|---|
| Security | The existing DOM-sink ratchet (zero sinks across all of `src/`) stays at zero. A fuzz suite (10,000-character names, bidi text, HTML, `javascript:` links, control characters) renders inert. Deep-link parameter fuzzing falls back safely. The layering check passes for the new UI paths, so UI code imports nothing from the background, the vault, the Thru client or the network config, and the dex UI and launchpad UI do not import each other. A test that no secret, draft or amount reaches a URL, `data-*` attribute, storage, `window` or `console` (extend the route-lifecycle test's seeded-secret walk to the new routes). |
| Contract | Every code in S10 has a copy key. An unknown code renders the fallback. The Desktop route table equals the S3 list, and the route checks (reachable, registered, CSS classes defined) pass for it. Every method the UI calls exists in S6. |
| Lifecycle | Every new route mounts through the real router, guards, bridge and kit, and tears down cleanly: no listener survives `destroy()`, and no timer survives it. Extend `test/test-route-lifecycle.mjs` or add a sibling. |
| Formatting | Rounding direction, zero-decimal assets, widest amounts, tiny prices, percent edge cases, address display, locale display versus wire values, all through `src/shared/format.js`. |
| Flows | Confirm disabled states (delay, acknowledgements, blocks). Duplicate click cannot submit twice. Popup close before sign discards. Context switch clears everything. Every intent state renders. Reconciliation mismatch renders. The password is cleared after submit. |
| Layout | Every new sheet, drawer, overlay and the Desktop shell is viewed in a real browser or in the visual harness at 400 px, narrow side-panel width, 768 px and 1280 px. The automated suite cannot see layout. Record screenshots in the PR. |
| Accessibility | Automated scan on popup swap, review, Desktop swap and token page. Keyboard walkthrough. Reduced motion. |
| Performance | Bundle budgets measured against the recorded baseline. |
| End to end | Chromium with the extension loaded: popup and Desktop open together, service-worker restart mid-flow, lock and unlock, offline, each capability preset. Shared with the backend. |
| Guards | `scripts/check-panel-tiles.mjs`, `check-routes`, `check-layering` and `check-csp` pass. A test that no first paint awaits a bridge call that reaches the network. A test that the review never renders "simulated" unless `simulation.supported` is true. |
| New suites | A per-feature test for dex UI and one for launchpad UI (for example `test/test-feature-dex.mjs`), added to the `npm test` chain. |

Acceptance for a gate: the state gallery is complete for the screens in that gate, the tests above for those screens pass, `npm run build` and `npm test` are green before and after, and a human has reviewed the gallery.

## F14. Frontend repo changes

- Add the Desktop page: `desktop.html`, an entry under `src/desktop/`, and an esbuild entry and copy step in `build.mjs`. Confirm D4 with the owner first, because this edits the build and the CSP and quarantine checks react to it. The page must not be web-accessible.
- Add the UI feature modules under `src/features/dex/ui` and `src/features/launchpad/ui`, and the shared pieces under `src/ui/domain`.
- Register the Desktop route table with `scripts/check-routes.mjs`, and extend the lifecycle test. The layering check already names `src/desktop/` and `src/features/`, so confirm its rules cover them and add the sibling-feature ban if it is missing.
- Add new settings controls in the existing Settings route's style. Any new preference key is added by the backend.
- Update `docs/MODULE_BOUNDARIES.md`, `docs/DOCS_INDEX.md`, `docs/STATUS_AND_ROADMAP.md` and `CONTEXT.md` for the new UI modules. Archive or delete anything the change replaces, in the same commit.

## F15. Build order (the owner's order: launchpad first, swap UI withdrawn)

0. Recon, BUILD STATE check, a mock bridge built from the delivered fixtures, an empty state gallery.
1. Desktop shell: page, nav, banners, lock overlay, deep links, capability-driven routing. All screens render `UnsupportedCapability` correctly.
2. Shared components: identity, state, freshness, risk.
3. Review component, authentication step, status rail and intent strip, grown from the existing send review and run on the delivered `intent.*` fixtures. Render the delivered statuses (S15) and any unknown status neutrally.
4. The launch loop, in this order: Create (mint-only) with review and status; My launches; the token page from on-node data (read-only); the create-account step; direct-pool seeding and listing once the backend has verified remove-liquidity.
5. The services-grid entry for Launchpad and Markets, behind its flag, with a `check-panel-tiles` pass and screenshots.
6. Markets and token-page charts, built in-house.
7. Swap UI: rebuild it dark behind `DEFI_DEX`. Enable it only on a recorded owner decision with screenshots.
8. Pools and liquidity management.
9. Curve lifecycle, migration and creator fees, only if a program exists.
10. Accessibility, performance, polish.

## F16. Reply format

Per reply: (1) findings and decisions, (2) the screens and components in scope for this step, (3) the file tree, (4) code per file from the first build step onward, (5) tests run with results, (6) open questions and CCRs, (7) the gate status line: done, blocked on a named backend dependency, or waiting for sign-off. Do not narrate what code does. If a needed field or code is missing, say so and build the honest state instead of guessing.
