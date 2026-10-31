# THRU extension DeFi: BACKEND build prompt (background services, contract, optional server)

Prompt version 2.0.0 (2026-10-28), rewritten after the repo audit. Shared contract 2.0.0.

Companion file: `thru-defi-frontend.md`. Both files carry the same PROJECT INPUTS, BUILD STATE and SHARED CONTRACT blocks, so two different builders can work in parallel and still meet at the same interface. This file adds the backend spec.

Shared-block fingerprint (sha256 over the SHARED CONTRACT block, from its BEGIN line through its END line): `fd6d1d7e47513cb1403f23dcc2a39b1961060d1ef46bbc4e93c2ab90e955cc8f`
Both files must show the same fingerprint. If you edit the shared block in one file, make the identical edit in the other and treat this fingerprint as void.

This prompt contains no code. It says what must be built, what each part depends on, and what must be proven before it ships.

"Backend" here means three things: the extension's background layer (contract manifest, router, services, adapters, registry, risk engine, intent pipeline, market reads, storage, permissions), the page-context data access the UI consumes through the contract, and the optional project server (market read API, signed feeds, image proxy). Layer 0, the on-chain programs, is not yours: you verify and integrate them, you do not write them (D1).

## Human setup (model: ignore this section)

1. Give the model the repo (at least `AGENTS.md`, `CONTEXT.md`, `docs/`, `src/`, `scripts/` and `test/`). It must read `AGENTS.md` first and run recon before planning. Remind it to reload the extension itself, not just the popup, after backend changes.
2. Fill PROJECT INPUTS in both files with the same answers. Blank means default.
3. Input limit? Paste in this order: this header, PROJECT INPUTS, SHARED CONTRACT S0 to S4, S5 to S11, S12 to S14, then the backend spec one section at a time.
4. **Gate 0 is a research task on a live test network.** Use a throwaway account on a test network only. Every chain fact the build depends on must trace to a recorded evidence entry. Answers from memory or from this prompt do not count.
5. M0 is delivered. Each new slice repeats the M0 drop (S13) before the frontend builds against it.
6. Relay change requests (CCRs, S0) between the two builders verbatim.
7. Never give a model a real seed or a mainnet key.
8. BUILD STATE records what is already built, what was observed on the network and what is known to be broken. When that changes, edit that block identically in both files. It is not fingerprinted.

## Role

You are the senior backend engineer and security reviewer adding swap, pools and a launchpad to a Thru wallet extension. You own: the contract manifest and schema, the router and services, the adapters over official Thru bindings, the program registry and capability matrix, the risk engine and signed feeds, the intent and signing pipeline, the market read layer, storage, permissions, live-verification scripts, privacy documentation and (if D2 says so) the project server.

You do not own: screens, copy, formatting, UI components, or the on-chain programs. You do not touch the vault or the existing Thru client internals unless a tested, verified bug requires it.

Thesis: chain state is authoritative. Anything that can reach a signature is read from the chain at prepare time. When the chain or a program cannot be verified, the answer is `supported: false` with a reason, never a guess.

## First reply (terse, in this order)

Start with one line: the repo's current commit and `CONTRACT_VERSION`, and whether BUILD STATE is still accurate.

1. **ASSUMPTIONS**: every default you applied.
2. **REPO RECON**: the B1 recon list, confirmed or corrected. Map every path this prompt names to its current equivalent. List every conflict with this prompt, with `AGENTS.md`, and with guides 09 to 11 (B1).
3. **PRECONDITIONS**: status of P1 to P5 (B1).
4. **DOSSIER STATUS**: the B2 table with evidence or NOT VERIFIED per row, and the resulting unsupported matrix.
5. **DECISIONS**: the project inputs, with what you applied.
6. **PLAN**: the current gate (S12) and the M0 drop.

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

# BACKEND SPEC

## B0. What the backend must never do

- Hardcode a program address, fee, instruction layout or capability. Everything comes from the registry, which comes from evidence.
- Mark a program verified from documentation alone, or auto-trust a newly seen program.
- Hand-write instruction bytes. Use official bindings through an adapter. Do not regenerate byte goldens from new output.
- Sign bytes the user did not review, or sign through any path other than `intent.submit` and the existing `signing` class.
- Show or report success on endpoint acceptance. Resubmit blindly after an ambiguous result.
- Use indexed or third-party data in a signing path.
- Put a secret in the extension. Any key shipped in a bundle is public.
- Log secrets, addresses or amounts.
- Run unbounded timers, or assume the service worker survives.
- Add a method outside S6 or a code outside S10 without a CCR.
- Modify `src/lib/vault.js` or `src/lib/thru-client.js` (or their current equivalents) except for a verified bug or a tested additive primitive, with their own test suites passing (AGENTS.md rule 2).
- Rename or reshape an existing method. The contract is append-only. Do not repurpose `tx.simulate`.
- Add a dependency other than a first-party Thru package, a framework, or a build-system change (AGENTS.md rule 5). The optional project server is a separate deployable outside this repo and is not bound by that rule, but nothing it needs may leak into the extension.
- Introduce a second store or tracker. The intent store builds on the existing pending-transaction tracker (S8).
- Build a swap, add or withdraw with a zero minimum bound. The bindings read zero as "no protection" (R17).
- Add a query or storage override for a DeFi flag, or a dApp provider.
- Report a gate, price, fee or capability as true without dated evidence that could have failed (R19), or write a waiver up as closure.
- Leave a read-modify-write store unserialised (R21), or emit a code the manifest does not declare (R24).

## B1. Recon, preconditions and corrections

Read `AGENTS.md`, `CONTEXT.md`, `docs/STATUS_AND_ROADMAP.md`, `docs/MODULE_BOUNDARIES.md`, `docs/BACKEND_GAPS.md`, `docs/SEND_PATH_AUDIT.md`, `docs/BUILD_SPEC.md` and `PRIVACY.md` first. Where the repo's own docs disagree, `docs/STATUS_AND_ROADMAP.md` wins on current engineering state, and the code wins over all of them.

**Recon list** (state of the repo when this was written is in parentheses; confirm each): `CONTRACT_VERSION` and the manifest layout (version 28 on 2026-10-28, 144 methods, append-only, auth classes none, unlocked, password, signing, an events map, an error-code map); the router, its auth check and its sync-read set (polled reads are exempt from the activity stamp that feeds auto-lock); the services directory (account, balance, history, keyring, network, pending-tx, preferences, registration, send-context, token, tx and others); how `src/lib/thru-client.js` is used and `src/lib/networks.js` (only `betanet` enabled; per-network program addresses taken from the pinned packages; measured native fee of 1 base unit and a reserve; CSP agreement enforced by `scripts/check-csp.mjs`); the preferences service (validated whitelist of keys, a security-field set changed only through the password-gated method); storage namespacing in `src/shared/network-scope.js`; the existing mint deploy path (`token.deploy` and its helpers; the studies report drift between `ticker` and `symbol` and a mint seed that must be 64 hex characters, so reconcile it before any launch work); the pending-tx service and `send-context`; `scripts/` probes and live-verification scripts (`measure-fee`, `verify-token-transfer`, `verify-live-e2e`, `verify-autoregister`, `probe-explorer-mcp`, `probe-oracle-feed` and others, which may already hold dossier evidence); `test/` and the `npm test` chain; `build.mjs`; and the manifest's permissions (storage, alarms, sidePanel, clipboardRead, notifications are declared today, no `host_permissions`).

**Preconditions (G2 and later are blocked until each is true; report status in the first reply)**
- **P1** Backend-enforced signing policy is in place. In the repo it is: signing methods are declared `signing`, the wallet must be unlocked, `requirePasswordForSigning` (default off in the code, although AGENTS.md rule 10 says on by default; report the real default) turns on password checks, and changing it is itself password-gated. Confirm that D5's step-up can be layered on top without weakening any of it.
- **P2** The legacy launchpad is gone and the quarantine test is green (true at the time of writing). The test is then rewritten deliberately (B16).
- **P3** The token balance and transfer path is verified live and golden-tested (dossier Q13). **Not met on 2026-10-28.** Live runs FAILED from 2026-10-06 to 2026-10-08 (an account-creation fault at the faucet rung) and were BLOCKED_ENV on 2026-10-23. G2-S0 landed under an owner waiver. Record it as a waiver with its risk, never as closure (A12).
- **P4** The DOM-sink ratchet and the layering check exist and cover new paths (true: zero sinks across all of `src/`; the layering rules already name `src/desktop/` and `src/features/`). Confirm the sibling-feature import ban exists, and add it if not.
- **P5** The contract test runs in both directions inside the normal test command (true at the time of writing).

**Fix-first list (from the 2026-10-27 audit of the repo; A1, A2, A3, A5 and A6 must be done before any DeFi flag is enabled).**

| ID | Finding | Required change | Proof |
|---|---|---|---|
| A1 | The custom registrar's `register` discards the fee-transfer result, all three live probes show the treasury at 0 before and after, the probe passes either way, and the UI quotes a price. | Propagate the error or change the fee mechanism. Add a max-fee bound to the instruction. Make the probe fail on a wrong treasury delta. Until a fee is proven collected, remove the quoted price from the UI copy. | A probe that fails when no fee moved. A UI copy test. |
| A2 | The intent store's `upsert` is an unserialised async read-modify-write, and two concurrent `intent.submit` calls both pass the status check. | A single-flight queue per network. | Concurrency tests for upsert and submit. |
| A3 | A submit with no reply is recorded `failed` with `TX_DROPPED` and is resumable. Every other error becomes `PROGRAM_ERROR`. `intent.rePrepare` re-arms a `failed` intent. A test pins this. | An `unknown` state, a signature lookup before any resubmission, refusal to re-prepare an unproven intent, error classification by cause that keeps specific codes. Change the pinning test. | Ambiguity tests. |
| A4 | The native-send review reports `simulation.supported: true`. Nothing was simulated. | `supported: false` with a reason, or label it a balance check. | A test that no review claims simulation unless simulate ran. |
| A5 | `applySlippage` floors, so a tiny quote gives a zero minimum output. The bindings read zero as no protection. | Refuse with `ZERO_BOUND`. | A one-unit quote test. |
| A6 | `program.capabilities` advertises `slippageMaxBps` 2000 while the swap service enforces 1000. | One constant feeds both. | A test comparing them. |
| A7 | Twelve emitted error codes are not in the manifest's error-code map. | Declare them and add the emitted-versus-declared test (R24). | That test. |
| A8 | Name-write parameters (`networkId` on `name.register`) are declared and ignored. `name.initRoot` and `name.setRecord` are `unlocked` stubs. | Enforce a pinned context or remove the parameter. Make the stubs `signing` before implementing them. Add the signing-method enumeration test (R20). | The enumeration test. |
| A9 | The exported flags object is mutable. | Freeze it. | A mutation test. |
| A10 | Signed feed records carry no sequence number, so an old valid record can be replayed until it expires. | A monotonic sequence per publisher, before any transport exists. | A replay test. |
| A11 | `STATUS_AND_ROADMAP.md` says contract 18 and dates itself 2026-10-03. The "Option B" directive exists only in a commit message. | Refresh it, record the directives, add the docs-truth check (R25). | The check script. |
| A12 | P3 was waived at G2 but is written as closed. | Passing evidence, or a signed waiver that states the risk. Never "closed". | The docs-truth check. |
| A13 | A buyer of a brand-new token cannot swap: the output account must exist and nothing creates it. | `intent.prepareCreateAccount`, by CCR. | An intent script for create-then-swap. |
| A14 | The custom registrar program is project-authored and unaudited, and fails S16 on several counts (B19). | Apply S16 and B19 before any mainnet use. | The S16 checklist. |
| A15 | An evidence probe has a green branch for "skipped by VM". | Falsifiable probes only (R19). | The harness lint. |

**Corrections to guides 09 to 11.** Those guides were written against an earlier snapshot. The repo is far past them (contract 15, not 7 or 8), and several methods they assume (`price.get`, `portfolio.summary`, `history.list`, `network.health`, `account.validate`, `tx.waitFor`, `featureflags.all`) do not exist. Treat the guides as superseded where they conflict with this prompt, mark them so in the repo's docs index, and apply these specific corrections:

| Where | Problem | Required change |
|---|---|---|
| G11 rule 1, the quarantine test, "one page" | Forbids shipping and caps the extension at one page. Contradicts this task. | Replace with gated-enable invariants (B16). Change the test in the same change that adds the Desktop page. Never loosen it silently. |
| G11 §3 slippage sketch | Fee constant borrowed from Uniswap v2. A helper it calls is undefined. The execution-price formula in the impact function is wrong. No decimals normalisation. | Delete. Use the official AMM quote helper through the adapter and test it differentially (B6). |
| G11 §5 approval table | EVM-shaped (approvals, spenders, routers). | Replace with the account-model facts in S9 and B9. |
| G09 `tx.preview`, `tx.signAndSend` | Static fee, no hash binding, no multi-step, no resume. | The existing `tx.estimateFee`, `tx.checkDuplicate`, `tx.sendChecked` and `token.transferChecked` stay as they are. New work goes through the intent pipeline (B4), which generalises the checked-send pattern. |
| G09 §6 "popup closed means zero timers" | Kills tracking of an in-flight transaction when the popup closes. | Surface-scoped polling for display data plus bounded background tracking of in-flight intents (B10). |
| G10 local indexer and oracle | Enrichment only. No discovery, candles or holders. No price service exists in the repo, and the oracle adapter is "if official and verified" only. | Market read layer plus the data-source decision (B5, B11, D2). USD only for native THRU and only with a verified source (D8, Q22). |
| G10 `verified` flag | Nobody defined who verifies. | Signed list with published criteria and a takedown path (B9). |
| G09 "UI renders warnings verbatim" | Message strings from the background. | Keep the intent (the UI cannot add, hide or downgrade). Emit codes, params and `fallbackText`. The UI owns copy (S10). |
| Naming | Guides use `swap.*`, `pool.*`, `market.*` for everything and `Alphanet`. | Namespaces per `docs/MODULE_BOUNDARIES.md` (S6). The only enabled network is `betanet`. |

## B2. Gate 0 dossier

Answer from the live test network and official docs. Record each answer as an evidence entry: network, date, tool or method (never a secret), account or transaction reference, a one-paragraph finding, and confidence. Store entries in the evidence folder (B16). The registry cites them.

| ID | Question | Evidence | If the answer is no |
|---|---|---|---|
| Q1 | Can one transaction invoke several programs or instructions atomically? Is there a multicall program, and what are its signer-privilege, failure and trust semantics? | Program and ABI. A test-network transaction with two or more calls, including a deliberate failure. | Every multi-step flow is a multi-transaction machine. "Create account then swap" is not atomic and needs its own reviewed step. |
| Q2 | Nonce semantics, validity window or expiry, behaviour under concurrent submits, replacement or cancellation. | Two same-account transactions on a test network. Docs. | Single-flight per account across all surfaces, short windows, no parallel submits. |
| Q3 | How fees derive from compute, state and memory units. Is estimation exposed. Can the fee payer differ from the signer. Minimum balances. | Measured fees across transaction types. Estimator endpoint. | Measured table per instruction type plus a margin, labelled approximate. Max disabled. |
| Q4 | How token and pool accounts are created. State-proof needs and freshness. Who pays. Atomic with first use. Closing and reclaiming. | Create-and-use traces and costs. | Creation becomes a separate disclosed step. Swaps into new assets are flagged. |
| Q5 | Does RPC simulate? Fidelity and outputs: logs, errors, resource use, account or balance deltas. | Simulate a known transfer and a swap. Compare with the real result. | Flows are labelled unsimulated. Review is decoder-only. Max and large sizes off. |
| Q6 | Commitment levels, reorg possibility, time to finality, dropped-transaction detection, status API. | Docs plus observation. | "Included" stays `confirming` until a defined depth or time. Nothing is marked done earlier. |
| Q7 | gRPC and gRPC-Web per network. Browser CORS and streaming. Auth tokens. Rate limits. Terms. Subscription APIs. | A browser test from an extension page and from the service worker. | Polling only. v1 has no streaming. Record the browser and worker constraints that rule it out. |
| Q8 | Do programs emit structured events? On-chain ABI reflection? History depth, pagination, ordering. | Fetch events for the token and AMM programs. | Account-state diffing only. Thinner history. |
| Q9 | Is there an official or public indexer? Official indexing framework and replay tooling? Hosting needs. | Docs, packages, endpoints. | The D2 decision applies. Discovery stays unsupported until built. |
| Q10 | Address format, checksum, derivation rules for mint, token account, pool and launch. Hazards of pasting an address from another chain. | SDK helpers and test vectors. | R3 cannot apply. Treat index data as untrusted and block entries that need derivation. |
| Q11 | Mint model: authorities (and whether any instruction can revoke or transfer them after minting, or create a fixed supply), ticker, name, decimals, metadata location and mutability, supply cap, burn, extensions or hooks. | Read live mints. The instruction set. | Each extension gets a risk fact before it is supported. |
| Q12 | Token accounts: canonical derivation, optional seeds (several accounts per owner and mint), delegate and close authority, sending to a missing account, dust and spam. | Live accounts. Transfer tests. | Define the wallet's canonical-account rule and show non-canonical accounts. |
| Q13 | Is the token balance and transfer path verified live (BACKEND_GAPS C1 and C2)? | Goldens from spec. A live round trip. | Nothing else ships. |
| Q14 | AMM program per network: address, version, management and upgrade state, authority, audit status, who controls pool creation. | Program account read. Docs. | Swap and pools are unsupported. Launches limited to mint-only. |
| Q15 | Pool model (constant-product, stable, concentrated), fee tiers and destination, LP model, status flags, oracle or TWAP, permissionless pool init, pause powers. | Pool accounts. ABI. | Unknown model means no quote. |
| Q16 | Instructions: exact-in or exact-out, add, remove, init. On-chain slippage enforcement. Deadlines. Account lists. Error codes. | ABI plus test-network traces. | A missing instruction is a missing feature (and R2 for remove). |
| Q17 | Is native THRU a mint (wrapped) or does it need wrap and unwrap? Decimals. | Pool accounts for THRU pairs. | Wrapping becomes an extra priced step. |
| Q18 | Pool discovery: derive from the mint pair or tier, a registry account, or a program-account scan with filters. Cost and limits. | Queries on a test network. | Pools are known only through the index or a registry feed. |
| Q19 | Quote parity: reference vectors from the program, or a reproducible simulation, including dust, maximum, an empty side and fee rounding. | At least a dozen vectors. | No parity means no swap enablement. |
| Q20 | Does a launch, curve or template program exist on the target network, official or third-party? Admin powers, audit status. | Program search. Docs. | Launchpad is mint-only plus direct-pool. A curve is a separate program workstream outside this prompt. |
| Q21 | If it exists: create (one or many transactions), curve math, fees, graduation trigger and caller, LP lock or burn, migration atomicity, creator-fee claim, anti-snipe options, pause and admin. | ABI and traces. | Each unknown mechanic keeps its UI section unsupported. |
| Q22 | THRU/USD source: official endpoint or oracle program, cadence, manipulation resistance. | Endpoint or program read. | No USD (a dash). Manual price stays advanced-only. |
| Q23 | What provider interface do Thru dApps and the browser or embedded SDKs expect from an extension? Are passkey accounts in scope? | Docs and SDK source. | Out of scope. Built-in flows still use the shared pipeline. |
| Q24 | Key types the extension supports (mnemonic, passkey, hardware) and the signing UX for each. | Repo. | Unsupported key types get no DeFi. |
| Q25 | `@thru/*` licence terms for redistribution, package telemetry, public RPC terms for a commercial wallet. | Licence files, terms. | Block distribution until cleared. |
| Q26 | Current official package names and versions, deprecation history. | Registry metadata. | Pin exact versions. Keep an adapter layer so renames never reach features. |

**Leads already in hand.** These come from the repo's docs and scripts and from the pinned 0.4.1 package declarations. They are starting points. Each still needs live evidence, and none is a fact about the network.
- **Fees and envelope (Q2, Q3).** One native transfer between registered accounts cost 1 base unit on betanet (one amount and size sampled). The account-activation transaction is documented with fee 0, nonce 0 and state units 1. The token-program fee is unmeasured. The chain's detail response reports only a header-declared fee, never the charged one.
- **Accounts (Q4, Q12).** Activation is a fee-payer transaction against the NOOP program. Whether the token program accepts a never-registered owner for a sender-created token account is open. Token init takes a state proof, and AMM init takes four.
- **Simulation (Q5).** `tx.simulate` is a declared-unsupported stub today.
- **Transport (Q6, Q7).** The repo reaches `https://rpc.betanet.thru.org` through the pinned SDK. Block time is optional. The explorer transaction route is unconfirmed.
- **Events and ABIs (Q8).** The AMM package declares structured events (swap, mint, burn, pool init, sync). The programs package also has ABI-manager and managed-program inspection helpers (ownership, authority, relationships), useful for decoding and for the program-change watch.
- **Indexer (Q9).** Package listings show an indexing framework and a replay package. A third-party README says no public indexer endpoint exists.
- **Mints (Q11).** The token binding lists initialise mint (decimals, mint authority, optional freeze authority, ticker, seed, state proof), initialise account, mint-to and transfer. No set-authority, burn, approve, freeze or close builder appears. Verify whether authority can be revoked at all, because the launchpad's default authority policy depends on it.
- **AMM (Q14 to Q19).** Builders for init pool, add liquidity, withdraw liquidity and exact-in swap. An exact-in quote helper returning amount in, amount after fee, fee and amount out. Pool derivation from a sorted mint pair plus a fee in basis points, so several pools per pair can exist and anyone may initialise one. Minimum-output bounds on every call, where zero disables protection. Constants for default fee, maximum fee, basis-point denominator and minimum liquidity. The AMM is a bootstrap-managed program with a seed-derived address, so whether it is deployed on betanet, and who controls its upgrades, is unverified.
- **Native THRU (Q17).** The bootstrap package lists a wrapped-THRU managed program with mint and vault state addresses. Verify how native THRU enters a pool.
- **Launch programs (Q20).** None appears in the bootstrap list.
- **Price (Q22).** An oracle program is bootstrap-managed and the repo has an oracle probe script. No price service ships.
- **Licences and names (Q25, Q26).** npm metadata for the pinned `@thru/sdk` and `@thru/programs` says Apache-2.0. A third-party README says proprietary. Read the licence files. Names and versions have changed before.
- **Chain resets.** The repo records a managed-genesis reset on 2026-09-26 that replaced the old system-program scheme, and its history service already guards caches with a chain-identity check because a genesis swap can reuse the same managed addresses. Every registry record must be bound to the network's genesis identity (B3).

**Dossier status at 2026-10-28.** The repo's dossier (`docs/defi/G0_DOSSIER.md`) was last edited before the 2026-10-25 live swap, so read it together with the dated files in `scripts/defi-evidence/`. Answered with evidence: Q5 (no simulation; docs negative), Q14 deployment (AMM deployed on Betanet, management unknown), Q16 in part (init, add and swap built and run; withdraw not yet), Q18 derivation (sorted pair plus fee tier), Q20 (no launch or curve program in the bootstrap set). Supported by one data point only: Q15 (fee and model) and Q19 (parity needs at least a dozen vectors). Treat everything else as open unless a passing, falsifiable evidence file says otherwise, in particular Q1 to Q4 for token and AMM transactions beyond "the output account must exist", Q6, Q7 from a worker, Q13 (P3), Q17 and Q22 to Q26.

**Gate 0 produces**: the evidence entries; a registry seed and a capability matrix seed per network; the unsupported matrix (which features stay unsupported and why); the answered project inputs; and the reason mapping below.

| Unsupported reason | Driven by |
|---|---|
| `PROGRAM_NOT_FOUND` | Q14, Q20 |
| `PROGRAM_NOT_VERIFIED` | registry verification state below `verifiedLive` |
| `PROGRAM_CHANGED` | program-change watch (B3) |
| `NO_QUOTE_PARITY` | Q15, Q19 |
| `NO_SIMULATION` | Q5 |
| `NO_INDEXER` | Q9 and D2 |
| `INDEX_STALE` | market freshness (B5) |
| `NETWORK_NOT_SUPPORTED` | no registry entry |
| `NETWORK_RESET` | genesis binding (B3) |
| `CUSTOM_NETWORK` | D14 |
| `FLAG_OFF` | flags |
| `KILL_SWITCH` | signed feed |
| `FEED_MISSING` | feed unavailable and policy requires it |
| `LAUNCH_MODEL_UNAVAILABLE` | Q20, Q21 |
| `TOKEN_PATH_UNVERIFIED` | Q13 |
| `DEPENDENCY_UNVERIFIED` | Q1 to Q4 and any other prerequisite |
| `NO_LIQUIDITY` | pool state |
| `UNKNOWN` | anything not otherwise classified. Investigate it and add a specific reason through a CCR. |

## B3. Program and network capability registry

Purpose: one source for "what can this network do". Serves `program.capabilities` and `program.list`.

**Must add**
- Per-network `ProgramRecord`s for each role (token, amm, curve, multicall, oracle): address, code hash or version, management and upgrade-authority state, supported instructions, fee parameters, verification state, evidence reference, date. Program addresses come from the pinned official packages through the existing per-network config, never from a literal in a service. The registry adds verification state on top of them.
- **Genesis binding.** Bind every record and every cache to the network's genesis identity as the chain exposes it. Program addresses alone are not a chain identity: a genesis swap can reuse the same managed addresses, as the previous testnet's resets did. The history service already has a chain-identity gate (an offline fingerprint plus a live genesis check). Reuse that mechanism or lift it into a shared helper, and do not build a second one. A changed identity invalidates all records, caches and prepared intents, sets reason `NETWORK_RESET`, and pauses DeFi until the dossier is re-run.
- Capability derivation per network: the flag AND the registry AND the feed AND the dossier results produce each feature's `state` and `reason`. Seed `limits` from the project inputs.
- **Program-change watch.** Before enabling or executing a write, compare the on-chain program identity (address, code hash, management state, as far as the chain exposes them) with the pinned record. Use the official managed-program inspection helpers through the adapter (ownership, authority, program and ABI relationship) rather than reading raw accounts by hand. A change means writes blocked, reason `PROGRAM_CHANGED`, and a `capabilities.changed` event.
- Registry updates and the kill switch arrive through the signed feed (B9). Data only, never code. A feed can only narrow what the build allows, never enable a capability the build does not contain.
- Custom or quarantined networks: DeFi off with `CUSTOM_NETWORK`. No override.

**Needs** Q1 to Q4, Q10, Q14, Q20.
**Never** hardcode an address, or mark a program verified from docs alone.
**Done when** deleting a program record disables the dependent features with a stated reason, and changing a pinned hash blocks writes, both proven in tests.

## B4. Intent and transaction pipeline

Purpose: one lifecycle for every write, from any surface. It generalises the repo's checked-send pattern (`send-context`, `tx.sendChecked`, `token.transferChecked`, `tx.checkDuplicate`, the pending-tx tracker) instead of replacing it. Methods: `intent.prepareSend`, `dex.prepareSwap`, `dex.prepareLiquidity`, `launchpad.prepare*`, `intent.*`, `intent.submit`.

Stages: intent, prepare, simulate where supported, decode and assess, review payload, bind, authenticate, sign, submit, track, reconcile, index-visible. The adapter returns typed intents and instruction data. It never sees a password, a vault or UI state, and it never broadcasts (`docs/MODULE_BOUNDARIES.md`).

**Must add**
- **Prepare** builds instructions through official bindings only. It resolves accounts (existence, derivation, whether creation is needed), the resource estimate, fee payer, nonce, validity window and chain id.
- **Itemised costs** as separate `Cost` lines: network fee with resource units, account creation, pool fee, platform or creator fee, caller reward, reserve.
- **Binding.** `bindingHash` covers the semantic payload (programs, accounts, instruction data, amounts, limits) per R5. Volatile envelope fields may finalise at signing inside a stated tolerance. Beyond it, re-review. Prepared payloads expire (`preparedTtlMs`). Auto re-prepare is offered, never silent.
- **Intent store** in the background (non-secret): everything in the `Intent` vocabulary. It survives popup close, service-worker restart and browser restart. Supports resume, discard and stop-waiting. There is no on-chain cancel unless Q2 proves one. It extends or links to the existing pending-tx tracker (S8), serialises its own writes, and is network-scoped through `network-scope`. If extending is impossible, stop and ask: AGENTS.md forbids a second store without approval.
- **Pinned context (R18).** Pin the reviewed account and network at prepare time. Re-check them around signing and refuse with `CONTEXT_CHANGED` on any difference. Close the open race in the repo's send path (a network switch during the signing sequence, `docs/SEND_PATH_AUDIT.md`) for DeFi by signing and submitting through a client bound to the pinned network, not the globally active one.
- **Step-up auth (D5).** Compute `authRequirement` for each review: the user's `requirePasswordForSigning` policy, plus step-up for the first use of a program, pool or asset by this account on this network, for any `high` warning, for launch create, migrate and claim, and when `defiAlwaysRequirePassword` is on. `intent.submit` enforces it server-side.
- **Zero bounds.** The builders refuse to produce a zero minimum bound (R17). A zero bound found anywhere is a `ZERO_BOUND` block.
- **Serialised writes (R21).** Put the intent store behind a single-flight queue. Test concurrent upserts and concurrent submits for the same intent.
- **Ambiguity (R22).** After a submit with no proof either way, record `unknown`, look the signature up on the chain, and refuse `intent.rePrepare` until the earlier attempt is proven absent. Classify errors by cause and keep the specific code (`SEND_CONTEXT_CHANGED`, `WALLET_LOCKED`, `INSUFFICIENT_BALANCE`) instead of folding everything into `PROGRAM_ERROR` or `TX_DROPPED`.
- **Honest review labels.** `simulation.supported` is true only when a simulation ran. The native-send review says true today (A4).
- **One pipeline for every write (R12, R20).** Name, registrar, deploy and faucet writes are not on the pipeline today. Migrate them when next touched, or record an exemption with its reason in the decisions log. Until then each one pins account and network and sits in the guard set.
- **Create-account intent.** Add `intent.prepareCreateAccount` by CCR so a buyer of a new token can start (A13).
- **Concurrency.** If the nonce model needs it (Q2), serialise submissions per fee-payer account across all surfaces and detect collisions.
- **Idempotency.** A lock per (network, account, action, asset or pool). `clientRequestId` returns the original result. `intent.submit` is idempotent per (intentId, bindingHash) and never signs twice.
- **Multi-step flows** (launch, migrate, create-account-then-swap when not atomic): an explicit step machine. Each step is idempotent and detectable from chain state. `needsAttention` offers only safe actions: resume, view, abandon.
- **Error taxonomy**: program, endpoint and simulation errors map to the S10 codes with params and `fallbackText`. Unknown errors become `INTERNAL` with raw detail in diagnostics only.
- **Reconciliation.** After confirmation, compare actual balance deltas with the review. Principal amounts are compared exactly. The fee is declared, never reported as charged, so compare it against the declared bound and label it declared. Record `matched` or `mismatch`.
- **Events** to every surface (`intentChanged`, declared in the manifest's events map and emitted only by the event service), the existing extension-icon badge for active intents, and notifications behind the `defiNotifications` opt-in (the permission is already declared).
- **Bounded tracking.** Track in-flight intents in the background through alarms and on-demand checks when a surface opens. Proposed starting caps (confirm in the dossier): five tracked intents, fifteen minutes after submit, then rely on on-demand checks. Ambiguous outcomes stay `unknown` and are re-checked, never declared failed without proof.
- **Unsigned cleanup.** Prepared intents are discarded on TTL and on surface close when detectable.
- The existing `signing` handshake is used unchanged. Do not add a second authorisation path. The new handlers receive public account addresses, never decrypted key material.

**Needs** Q1 to Q6, P1, P3.
**Never** sign bytes the user did not review, report success on endpoint acceptance, or resubmit blindly.
**Done when** killing the service worker mid-flow, closing the popup and opening Desktop leaves one coherent intent state. Duplicate submit is impossible. Rejected, expired, replaced, failed, dropped and unknown each have a test.

## B5. Market read layer

Purpose: honest reads for discovery, charts, pools, holders. Methods: `market.*`, `risk.assetAssess` inputs, `launchpad.listMine` inputs.

**Must add**
- An official gRPC or gRPC-Web read adapter behind a port: endpoints per network from the registry, failover, backoff. Custom endpoints are allowed only for non-DeFi use.
- Direct-chain reads for balances, token accounts, mint state, known pools, a user's own launches (derive, then read), claimables and transaction status.
- Discovery and analytics from the project read API (B11), always labelled `index`. If it is absent they return unsupported with `NO_INDEXER`.
- **Pricing**: THRU-denominated from pool reserves or the curve. USD only for native THRU, only when a verified source exists (Q22; the repo has no price service today), with source and age (D8). `fdvThru` is supply times price, and the frontend labels it as such. No market-cap claim.
- **Trending rule**: publish the ranking rule (for example trade count and unique traders over a stated window). It is documented and never paid.
- **Candles**: sparse, gaps real, no synthetic series, a continuous price definition across curve and pool with a graduation marker, density-appropriate intervals, a cap at `maxCandles`.
- **Caches**: network-scoped, TTL'd, size-capped, with defined eviction. Large data in IndexedDB when read from Desktop. Never stored beside secrets. Extend the cross-network leak test.
- **Polling model, no leases.** Pages poll through the bridge while visible (S7). The backend answers from a coalescing read-through cache keyed by (network, method, params) with TTLs from each record's freshness, so two surfaces cost one upstream call. Register every polled read in the router's sync-read set so polling does not count as user activity for auto-lock. Never assume the service worker survives between calls: rehydrate caches from storage. Do not add a page-side data port or any second seam to the chain: UI code reaches data only through the bridge, and only the bridge file may send messages (AGENTS.md rule 3). Streaming is out of scope for v1.
- Freshness on everything. A stale price blocks Max in quotes and forces a re-quote.

**Needs** Q7 to Q10, Q18, D2.
**Never** scrape explorers or third-party frontends, use a third-party price in a signing path, or present "Trending" as a safety signal.
**Done when** with the project API off, the wallet, swap and known pools still work. With the endpoint off, every read returns a designed offline or unsupported result.

## B6. Swap services

Methods: `dex.quote`, `dex.prepareSwap`.

**Must add**
- Scope v1: direct-pool swaps, exact-in. Two-hop through THRU only if atomic multi-hop is verified (Q1). Exact-out, limit orders and DCA come later.
- **Quote engine**: use the official AMM bindings' exact-in quote helper (`@thru/programs/amm`, pinned) through the AMM adapter as the primary source, fed with pool state read from the chain at quote time (reserves, fee in basis points, all read, none constant). Do not hand-write the math unless the official helper is absent or fails the vectors. Add an independent integer re-computation as a differential test (protocol-favouring rounding, tolerance as the program defines it, ideally zero or one unit), plus test vectors from the program's spec, plus a comparison with simulation when it exists. Derive the pool from the sorted mint pair and fee tier, and when several fee tiers exist for a pair, quote each and present the best by output with its tier shown.
- **Quote contents**: `expectedOut`, `minOut`, `priceImpactBps` computed from reserves, pool fee, itemised costs (including account creation when the output account does not exist), venue and trust, `readAtSlot`, `expiresAt`.
- **Slippage**: validate against `limits`. Return `HIGH_SLIPPAGE` above the warning level and refuse above the cap. Compute `minOut` from the quote and the slippage, and never pass a zero minimum to the builder (R17). The swap call has no deadline field, so time-bounding comes from the transaction's own validity window (Q2) and the quote's `expiresAt`. Ordering behaviour on Thru is unknown, so make no MEV-protection claims.
- **Max** resolves to balance minus fee, account-creation cost and reserve.
- **Minimum output must be positive (A5, R17).** `applySlippage` floors, so a tiny quote can round to zero, which the bindings treat as no protection. Refuse with `ZERO_BOUND`, and test with a one-unit quote.
- **Limits come from one constant (A6, R23).** The cap the service enforces is the cap the capability matrix serves.
- **Receive account (A13).** `TOKEN_ACCOUNT_MISSING` is the delivered behaviour. The fix is the create-account intent, as a separate reviewed step.
- **Hard blocks** (returned as `block` warnings): locked wallet, unsupported or changed venue, stale quote or index-versus-chain disagreement, unsimulated when policy requires simulation, simulation shows value leaving a user-owned account other than the intended one, unknown writable accounts, destination account missing and not creatable atomically, pool paused or closed, price impact above the block threshold, insufficient fee reserve, a duplicate pending swap, a derived-address mismatch.
- **Unverified entry**: if the output asset is unverified, `requiredAcks` includes a typed acknowledgement (the ticker plus the last characters of the mint).
- The output token account must exist for the swap. When it does not, include its creation (Q4) as an itemised cost, as an atomic step only if Q1 allows it, and otherwise as its own reviewed step.
- After the swap: reconcile, refresh balances, report indexing state.

**Needs** Q1 to Q6, Q14 to Q19, B3, B4, B9.
**Never** hardcode a fee, route through a venue outside the registry, show an external DEX, or retry automatically after a failure.
**Done when** parity tests pass on a test network for each venue and every hard block has a test.

## B7. Pool services

Methods: `dex.listPools`, `dex.getPool`, `dex.positions`, `dex.quoteLiquidity`, `dex.prepareLiquidity`.

**Must add**
- Pool state reads through the official pool-metadata parser and pool derivation (sorted mint pair plus fee tier): reserves, fee in basis points, LP supply, the locked minimum liquidity, lock and burn facts, admin and upgrade authority, age. Show every fee tier that exists for a pair.
- Add and remove previews: ratio math from reserves, maximum-in and minimum-out protections (never zero, R17), LP-account creation cost.
- **Pool-init guard.** Pool addresses are deterministic per mint pair and fee tier and the init call is open to any payer, so the first depositor sets the price and anyone can squat a pair at a bad price. Return `poolInit` plus `FIRST_DEPOSITOR` and `POOL_INIT_PRICE_DEVIATION` where relevant, and a typed acknowledgement. Init also needs the state proofs the bindings list (Q4), so treat pool creation as its own multi-account step.
- Positions from LP token accounts of known pools only.
- Fee accrual and impermanent loss only when computable from verified inputs. Otherwise omit.

**Needs** Q14 to Q19, R2 (verify remove before add), B6.
**Never** report an APR without a data source and window, or enable add before remove is verified.
**Done when** an add-then-remove round trip on a test network returns the expected amounts within the stated tolerance, encoded as a test.

## B8. Launch services

Methods: `launchpad.templates`, `launchpad.validateDraft`, `launchpad.uploadImage`, `launchpad.prepareCreate`, `launchpad.prepareMigrate`, `launchpad.prepareClaim`, `launchpad.listMine`, `launchpad.list`, `launchpad.get`.

Launch models, enabled strictly in this order: (1) mint-only, (2) direct AMM pool launch (mint, pool and initial liquidity), (3) bonding curve to AMM graduation, only if a curve or launch program is verified (Q20, Q21). Templates come from the signed registry.

**Launchpad-lite (the owner's first target).** With no curve program, a launch is: deploy the mint (the existing deploy path), initialise a pool for the pair, add the creator's initial liquidity, and list the pool. The 2026-10-25 live evidence ran exactly that sequence on test tokens. Build it as one resumable multi-step intent. Two blockers come first: remove-liquidity must be verified live before add is enabled (R2), and the create-account step (A13). Discovery without a server comes from on-node program activity and AMM events (the dossier's Q9 and Q18 substrate). Prove it at the scale of a few hundred pools before promising a Markets screen.

**Must add**
- **Templates and validation.** `Template.fields` describes every advanced field with bounds and defaults, so new templates need no frontend change. `validateDraft` returns field issues, derived addresses (mint, pool, launch account), cost previews and the permanent and editable lists.
- **Authority policy.** Default to revoked mint and freeze authority, or disclose exactly what is retained. The token binding lists no set-authority builder, so first establish through Q11 whether revocation or a fixed supply is possible at all. If it is not, the template says so, `MINT_AUTHORITY_HELD` is always true for it, and the copy never claims otherwise. Report metadata mutability and creator holding at launch.
- **Metadata pipeline.** Image upload goes to the project proxy (B11): type, size and dimension checks, re-encode, metadata stripped, no SVG. Hosting and pinning keys stay server-side. Without that service there is no image, and the upload method says so.
- **Orchestration.** The existing mint deploy path (`token.deploy` and its helpers) is the starting point for mint-only launches: move it onto the intent pipeline, keep the old method unchanged for compatibility, and fix the `ticker` versus `symbol` and 64-hex seed drift first. Multi-transaction creation is a resumable step machine. Resume is detected from chain state (derive the mint and pool addresses, then read them), never from local records alone. Abandoned partial launches become `needsAttention`.
- **Anti-impersonation.** Normalise and compare ticker and name against the verified list (case, confusables, spacing). Emit `LOOKALIKE_OF_VERIFIED` and `SUSPICIOUS_TEXT`. Ingest sanitising: strip bidi and control characters and clamp lengths before data leaves the backend.
- **Creator economics** only if verified on-chain: accrual, recipient, and a claim flow that reads the claimable amount from the chain at prepare time.
- **Graduation and migration.** Report status when automatic. When manual, `prepareMigrate` shows who may call, the reward, accounts moved, LP ownership or lock and the destination pool. Before enabling it, check for a pre-existing or tampered destination pool (the griefing case: pool addresses are deterministic and init is open to anyone, so a squatted pool at a bad price is possible). Emit `DESTINATION_POOL_PRE_EXISTING` when it exists. Report success only after the pool state is verified.
- **`listMine`**: derived from chain state plus local records. Chain wins on any disagreement. `nextSafeAction` is computed here, not in the UI.
- Sharing is a frontend concern: it copies a mint address and an explorer link.

**Needs** Q11 to Q13, Q20, Q21, B3, B4, B5, B9, D1.
**Never** name an external DEX as a destination, report "locked" or "safe" without the program-verified fact and its exact meaning, or trust a local launch record over chain state.
**Done when** every phase and every unsupported stage is produced from fixtures, and killing the browser mid-creation either resumes the launch or flags it correctly.

## B9. Risk engine and signed feeds

**Must add**
- **Asset facts** and **transaction facts** exactly as listed in S9, each tagged with its verification source. `verified` only for chain-read facts.
- **Severity assignment.** Document a rule per code: which are `block` (unknown program in a built-in flow, program changed, unintended outflow, derivation mismatch, denylisted asset or pool, kill switch), which are `high` (unverified asset entry, authority held, failed exit simulation, lookalike), and which are `warn`. Blocks cannot be overridden in built-in flows.
- **Honeypot test**: a small simulated exit must succeed, otherwise `EXIT_SIMULATION_FAILED`. Simulation is unsupported today (Q5), so say `UNSIMULATED` and make no claim. Where simulation is missing, the decoder explains every writable account and every outflow from the instructions the wallet built, and an outflow it cannot explain is a block.
- **Signed feeds**: verified assets, venues and programs, denylist (assets, pools, programs, creators), registry updates, kill switch. Signature is checked against an embedded key set that supports rotation. Versioned, expiring and monotonic (no rollback). Fetched on use with a TTL, not by background polling. Every fetch is a privacy event and is inventoried. A stale feed raises `FEED_STALE` and applies a stricter policy to unverified assets. It never fails silently.
- **Publishing process** (deliverable): public inclusion criteria, a takedown and appeal path, key custody and rotation, and a statement of the operator's conflicts of interest (D12).
- **Spam and poisoning**: unknown assets stay hidden by default (existing behaviour), emit `NEW_ADDRESS` (existing) and lookalike-contact warnings, and flag dust from unknown senders.

**Done when** a red-team fixture set (copycat tickers, bidi names, a drained-account simulation, an unknown program, a changed program, a stale feed, an invalid signature, an authority change) produces the expected blocks and warnings.

## B10. Extension platform

- **Permissions and CSP.** The manifest declares no `host_permissions`. Network reach is governed by the CSP, which allows `connect-src` only to enabled networks' RPC origins and `img-src` only to self and data URLs, and `scripts/check-csp.mjs` enforces that a disabled network stays out and an enabled one stays in. Every new host (market API, feed publisher, image proxy) is a manifest CSP change. Extend the CSP check so a DeFi host appears if and only if the feature that needs it is enabled in the build. Cross-origin reads from the worker then depend on the server's CORS headers, since there is no host permission. Keep a permission-justification table for store review. `notifications` and `sidePanel` are already declared. Do not add broad host patterns.
- **MV3.** The service worker can die at any time, so rehydrate from storage and never rely on in-memory state. Alarm granularity is coarse (verify the current minimum), so only in-flight intent tracking uses alarms. Display data is polled by pages (S7). Reload the extension, not just the popup, when testing backend changes (AGENTS.md).
- **Timer policy** (replaces "popup closed means zero timers"): no timers for display data. Bounded background tracking only for in-flight intents (B4), through alarms and on-demand checks when a surface opens. Everything else stops when no surface is open.
- **Storage.** Network-scoped through `network-scope` for every new cache, intent, draft, watchlist and registry record. Non-secret only. A quota plan (`chrome.storage.local` limits versus IndexedDB for large caches, and whether an unlimited-storage permission is warranted). Versioned migrations. Extend the cross-network leak test.
- **Images.** The CSP already blocks remote images, which is correct. Token images, if wanted, load only through the project proxy host added to `img-src` under D16, re-encoded server-side (no SVG, metadata stripped, size and dimension caps). Otherwise the UI shows identicons.
- **Desktop page.** Not web-accessible (no `web_accessible_resources` entry), opened by the background through the contract. One instance. Same CSP as the other extension pages.
- **Dependencies and build.** Only first-party Thru packages, pinned exactly, no build-system change, and a licence read for each (Q25). Any package with install scripts or telemetry is rejected.
- **Browsers.** Chromium first (D10).

## B11. Optional project server (decide, then justify; separate deployable outside this repo)

**Decision rule.** A server is needed if the product promises global discovery, candles, trades or holders at scale. Direct-chain reads cannot deliver those from an extension. It is also a change to the product's privacy posture: `PRIVACY.md` today promises no proxy, relay or backend server and zero telemetry. D16 requires that policy and the store listing change before anything here ships. If a server is needed it provides:
- ingestion from the chain (the official indexing framework if it fits), with ordering and finality handling per Q6
- decoding through the programs' official ABIs (Q8)
- derived tables: launches, pools, trades, candles, holders, risk inputs
- a read-only, versioned HTTP API: no cookies, CORS limited as far as possible, rate limits, no account-scoped endpoints by default, responses carrying freshness
- signed feed publishing (B9)
- an image proxy and re-encoder, and metadata pinning with keys held server-side only (an extension can never hold a secret)
- monitoring (lag, error rate), runbooks, a retention policy that does not correlate IPs with addresses, a capacity plan and a named cost owner

**Failure design.** The wallet degrades to direct-chain features with an explicit banner. The API is never in a signing path.

**If not built**: discovery shows "unsupported", the launchpad reduces to own-launch management plus by-address token pages, and the product copy says so.

**Trade-offs to record**: privacy (the operator sees interest and IPs), availability (a single point of failure), trust (ranking and lists), cost, and abuse protection (no client secrets, so rate limits are best-effort). **Hosting user content** (images, descriptions) creates legal duties: illegal-content scanning, takedown handling and copyright notices. D19 defaults to hosting none.

## B12. Contract implementation duties

- **Manifest first, always.** Add each method to `src/shared/contract/manifest.js` with its parameter names, a prose `returns`, `auth`, and `since`, bump `CONTRACT_VERSION`, then implement the handler in the router. Let the contract test fail before the handler exists. The test checks both directions. A green test after a hand-edit to only one side is a broken test.
- Add the machine-readable schema for params and results (S13), new events to the events map, and new codes to the error-code map.
- Validate parameter types before touching a service. Return values are JSON-serialisable (the router already names the offending field when they are not). BigInt leaves as a string.
- Declare only `intent.submit` as `signing`. Every other new method is `none` (reads, local data, prepare, manage). Prepare methods require nothing secret, but run behind `unlocked` where they touch account data.
- Register every polled read in the sync-read set.
- A test enumerates every handler that reaches a signing helper and asserts it is declared `signing` (or a documented exception), is in the transaction-guard set, and pins account and network (R20). A second test fails on any declared parameter the handler never reads, and on any emitted code missing from the error-code map (R24).
- The capability matrix and the enforcing service read limits from one constant (R23). The exported flags object is frozen.
- Existing methods, including `tx.simulate` and `tx.estimateFee`, are untouched. Preserve the v7 custom-network quarantine.
- Feature handlers live under `src/background/features/dex` and `src/background/features/launchpad` (own handler map, own service, own storage keys). Shared services (`market`, `risk`, `program`, `feed`, `intent`, `desktop`) live with the core services. Neither feature imports the other. No feature imports the vault.
- No secret, seed, key, address or amount in any log line.

## B13. Privacy, legal, licensing and store

- **Outbound inventory** in `PRIVACY.md`: endpoint, trigger, data sent, retention. Today the only endpoint is the user's chain RPC. Any addition is a D16 change made and published before it ships.
- **Licences.** Read the licence files of the pinned `@thru/*` packages (npm metadata says Apache-2.0, a third-party README says otherwise). Check the terms of the public RPC endpoint for a commercial wallet and its rate limits. Block distribution until cleared (Q25).
- **Store policy.** Re-read the current Chrome Web Store policies on remote code, user data, permissions and financial or crypto content before every gate that adds a permission or a host. Update the single-purpose statement and the permission justifications. The manifest description must change to be honest about swap and launch features once they exist.
- **Legal.** Token trading and launch tooling can trigger securities, consumer-protection, sanctions and advertising rules that differ by jurisdiction. Get counsel before G3 (swap) and G4 (launch). A UX-level geoblock, a terms gate and a risk acknowledgement are not a compliance programme. Put no legal conclusions in code or copy.
- **Disclosures**: fees, operator conflicts (verified list, ranking), standing risk language, no endorsement language.
- **Telemetry**: none (D11). The repo promises zero collection. If that ever changes: opt-in, no addresses, no amounts, no token identifiers tied to an install.

## B14. Testing matrix

All suites live in `test/` and join the `npm test` chain. Build and tests run before and after every change.

| Area | Required |
|---|---|
| Math | Quote parity with the official helper and an independent integer re-computation. Vectors from the program's spec. Property tests (output monotonic in input, no value created, round trip loses at least the fees). Decimals boundaries (zero, one unit, widest amount). Zero-bound refusal for swap, add and withdraw. |
| Bindings | Byte goldens from verified specs only. A test that fails if an official package version drifts from the exact pin. |
| Decoder and risk | Every instruction the wallet builds decodes to the expected summary. The red-team set from B9. |
| Pipeline | Service-worker kill, popup close, lock, account or network switch mid-flow (`CONTEXT_CHANGED`). Duplicate submit across surfaces. Nonce collision. Endpoint accepts but drops. Expiry. Partial launch failure and resume from chain. Index disagreement. Stale quote. Intent-store concurrent writes. Step-up classes. |
| Contract | Manifest and router in both directions. Events map and error-code map entries. JSON-serialisable returns. BigInt as strings. Parameter validation. Only `intent.submit` is `signing`. Fixture shapes match real handler output. |
| Security | Layering (including the sibling-feature ban and no vault or Thru-client import from features). The DOM-sink ratchet at zero. CSP assertion and the extended CSP-versus-enabled-features check. No secret in logs or payloads. Cross-network cache leak. Preferences: new keys validated, `defiAlwaysRequirePassword` unreachable through the generic setter. A flag cannot be turned on by URL or storage. |
| Platform | Chromium end to end with the extension loaded: popup and Desktop together, worker restart, storage quota exhaustion, offline. The repo's manual smoke checklist extended. |
| Live verification scripts | One per feature under `scripts/`, in the style of the existing ones. Idempotent, throwaway accounts only, never run in CI. They emit evidence entries that the registry consumes. |
| Audit-derived | Concurrency tests for the intent store and the pending tracker (R21). Ambiguous-submit tests: `unknown`, signature lookup, refusal to re-prepare (R22). A one-unit quote cannot produce a zero minimum. Declared limits equal enforced limits. Every emitted code is declared. Every signing handler is `signing`, guarded and pinned. The flags object is frozen. A replayed feed record is rejected. |
| Evidence | The harness rejects a probe that has a green branch for skipped, non-fatal or blocked outcomes. Each row records expected and observed values. A fee shown to users needs a row with a measured balance delta (R19). |
| Quarantine | The rewritten test (B16) passes, and fails when the legacy surface is restored. |

## B15. Operations (required before any production enable)

- A kill-switch drill: disable a feature through the signed feed and confirm the UI shows "DeFi is paused. Your funds are on-chain and the wallet still works."
- A runbook: disable a feature, publish a denylist entry, rotate the feed key, communicate to users.
- Staged rollout: allowlisted installs, then a percentage, then everyone, per network. The store's own staged rollout may be the only lever, so plan for that.
- A post-incident review template.
- Local error-code counters in diagnostics, with no addresses or amounts.

## B16. Backend repo changes

- **Rewrite `test/test-launchpad-quarantine.mjs` deliberately, in the same PR as the first feature code** (AGENTS.md). Keep what still protects: the legacy tree stays deleted, no `FEATURE_LAUNCHPAD`, no query override, no fake float quote, no `innerHTML`, no stray launchpad bundle in `dist/`. Replace the blanket bans that the new work must break: the name scans for `launchpad`, `dex`, `swap` and `amm` in shipped files, the route-name scan, and the single-page assertion. The new invariants are: DeFi code exists only under the feature directories and their registered entries, every DeFi route is unreachable while its flag is off, no flag has a URL or storage override, and `dist/` contains no fixture, mock or gallery file. Verify the rewritten test fails when the legacy surface is restored.
- Extend `scripts/check-layering.mjs` for background features (no sibling imports, no UI imports) and `scripts/check-csp.mjs` (DeFi hosts present if and only if enabled).
- Add the DeFi flags to `src/shared/flags.js` (all false, build-time, no override).
- Add the new preference keys with validation, and keep `defiAlwaysRequirePassword` in the security set.
- Add `src/lib/thru/` adapters (`token-adapter`, `amm-adapter`, and `read-adapter`, `oracle-adapter`, `intent-builder` as needed) only where an official package provides the surface, each thin and tested. Return unsupported where unverified.
- Update `PRIVACY.md`, `SECURITY.md`, `docs/MODULE_BOUNDARIES.md`, `docs/DOCS_INDEX.md`, `docs/STATUS_AND_ROADMAP.md`, `docs/BACKEND_GAPS.md` and `CONTEXT.md`. Restate the AGENTS.md rule: no unverified protocol behaviour. Mark guides 09 to 11 superseded in the docs index.
- Create an evidence folder for registry verification artefacts and the live-verification scripts under `scripts/`.
- Update the manifest description once swap or launch features exist, so the store listing and the extension agree.
- Add a docs-truth script that compares the contract version and method count in the status doc and README with the manifest, and fails when they differ (R25). Refresh `STATUS_AND_ROADMAP.md`. Record the 2026-10-26 "Option B" directive and the dashboard directives in the decisions log.
- Freeze the exported flags object and add the mutation test.

## B17. Build order (the owner's order: launchpad first, swap UI withdrawn)

0. Recon, BUILD STATE check, preconditions P1 to P5 stated honestly (P3 is a waiver).
1. The fix-first list: A1, A2, A3, A5 and A6 before any flag is enabled, then the rest. Refresh the docs and record the directives (A11, A12).
2. A falsifiable evidence harness (R19). Verify remove-liquidity live (R2). Get P3 passing, or record a signed waiver with its risk.
3. Launchpad-lite: mint-only on the pipeline, the create-account intent (A13), then direct-pool launch as one resumable intent (B8). Token-page and `listMine` data from on-node events, with no server.
4. The M0 drop for each new slice (S13): manifest, schema, fixtures, intent scripts, code inventory. The frontend builds against it.
5. Re-enable swap only on an owner decision, with the pipeline fixes in place.
6. Pools and liquidity management. Curve, graduation and claims only if a program exists.
7. Hardening, performance, runbooks, drills, and the mainnet gates of D20 and S16.

## B18. Reply format

Per reply: (1) findings and decisions, (2) design notes for the current gate (what, why, trade-offs), (3) module and file tree, (4) code per file from G1 onward, (5) tests run with results (build and test before and after), (6) open risks, blockers and CCRs, (7) the gate status line: done, blocked on a named Q or precondition, or waiting for sign-off. Do not narrate what code does. If a needed chain fact is not in the dossier, say so and build the honest unsupported state instead of guessing. Stop and ask on anything AGENTS.md lists.

## B19. Project-authored programs and the registrar

Apply S16 to every program the project authors. The custom `.thru` registrar (D-016) is the live case, and the audit found these, none of which is a reason to remove it from Betanet, all of which block mainnet:
- `register` ignores the result of its fee transfer, and the in-code note says a program cannot debit an unowned EOA, so a fee may never be collectable that way (A1).
- `Initialize` is first-caller-wins, so a watcher can take the admin role between deploy and init.
- `UpdateConfig` lets the admin set fee and treasury with no cap or timelock, and `Register` carries no max-fee bound, so a fee raised between quote and execution is charged.
- Leases never expire on-chain and nothing reclaims a name, so lease, renew and expiry copy must not promise otherwise.
- The Rust host tests were written but not run in the authoring sandbox, and the JavaScript tests match source text and byte pins. Run the host tests and add behavioural ones.
- A compiled binary is committed with no reproducible-build check, and the vendored core is pinned to a branch commit, not a release.
- Until S16 is met, the wallet labels the flow "Operated by <operator>. Not audited." (D27).
