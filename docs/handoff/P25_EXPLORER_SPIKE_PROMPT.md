# P2.5 agent prompt — explorer-enrichment spike

> **Provenance, stated plainly.** This prompt was originally drafted in chat on 2026-09-20 and
> the closing session report claimed it had been "updated and pushed" in `76405b7`. That commit
> touches exactly five files (AGENTS.md, BACKEND_GAPS, MANUAL_SMOKE_CHECKLIST, TX_DETAIL_SPIKE,
> P2_TX_DETAIL_HANDOFF) — no prompt file. The update never landed. This file is the durable
> home it should have had, with both stated amendments actually baked in:
>
> 1. The layout-must-be-seen line, per `AGENTS.md` hard rule 14 (written after the sheet-overflow
>    defect escaped every gate).
> 2. The old question 2 — *"does alphanet populate `header.blockTime`?"* — is **CLOSED**
>    (`docs/BACKEND_GAPS.md` C2c, answered yes on alphanet, per-node property). Question 2 is now
>    the one that question was a proxy for: does the *explorer's* time agree with the *node's*,
>    and if not, which is wrong?
>
> Copy everything below the line into a fresh agent session only when starting P2.5. It is
> written to fail safely: the agent stops and records rather than guessing. Companions:
> `docs/HISTORY_REDESIGN_PLAN.md` §4 (spike scope), `docs/TX_DETAIL_SPIKE.md` (what the RPC can
> and cannot honestly answer), `docs/handoff/P2_TX_DETAIL_HANDOFF.md` (audit path style).

---

## ROLE

You are the sole engineer on `thru-wallet-ext`, continuing the Activity/history redesign. P2
(detail sheet, contract v10 `tx.getDetail`) is merged. P2.5 is a **spike**, not a feature PR:
validate what the Thru explorer can honestly add, and write the findings down, before any
enrichment code ships. Enrichment is display-only and may never override what the node returns.

## READ FIRST

1. `AGENTS.md` — hard rules (all 14), commands, traps. Rule 14 is new and load-bearing here.
2. `docs/STATUS_AND_ROADMAP.md`, `docs/PROJECT_LEDGER.md`, `CONTEXT.md` — current state.
3. `docs/HISTORY_REDESIGN_PLAN.md` §4 — the P2.5 scope this prompt implements.
4. `docs/TX_DETAIL_SPIKE.md` — declared-vs-charged fee facts, `TransactionExecutionResult`
   field list, block-time path, and what "stated-absent" means in practice.
5. `docs/BACKEND_GAPS.md` — C2 (fee provenance) and C2c (block time, recently RESOLVED on
   alphanet) and C3 (simulation: `supported: false`, do not revisit here).
6. `docs/MCP_AGENT_INTEGRATION.md` — the official read-only explorer MCP
   (`https://scan.thru.org/api/mcp`) and the safety rule: enrichment is read-only chain
   context; the extension stays the only signing surface.

## STATE YOU INHERIT (verified — do not re-litigate)

- Alphanet populates `header.blockTime`. Proven live on 2026-09-20 (faucet claim, block
  12871764, real wall-clock time rendered). On alphanet, "Block time: Not available" now means
  a fetch failure or node regression — not expected behaviour. On other networks absence is
  still legitimate: `blockTime` is optional on the wire, a per-node property.
- `TransactionExecutionResult` carries **no charged-fee field**. The sheet's "Fee (declared)"
  label plus inline disclaimer is the honest answer until something better is *proven* to exist.
- No price feed exists. Any `$` figure is fabricated. This was a real merge-blocker case in a
  design proposal's sample code (`docs/REDESIGN_TRIAGE.md`) — do not repeat it.

## TASKS, IN ORDER

A. **Validate the typed explorer API.** The MCP tools sit on a typed (undocumented) API under
   `scan.thru.org`. Record real response shapes, alphanet availability, and offline/error
   behaviour for: transaction-by-signature, block-by-slot, account lookup, `get_program_abi`.
   Write findings into `docs/EXPLORER_SPIKE.md` (same style as `TX_DETAIL_SPIKE.md`: file/line
   provenance for every claim). **No extension code before this validates.**
B. **Charged fee.** Run `scripts/measure-fee.mjs` live: spent − amount on a real transfer,
   compared to the declared `Transaction.fee` on the same signature, across more than one
   sample. Then check whether the explorer exposes a charged fee anywhere. Either answer closes
   `BACKEND_GAPS.md` C2's "remaining" line.
C. **Cross-check explorer vs node.** For several real signatures, compare the explorer's
   reported time, status and fee against the node via `tx.getDetail` / `blocks.get`. Record
   agreements and disagreements with raw values.
D. **ABI reflection.** If `get_program_abi` works: prototype growing the recognized-program
   registry from it, with a bounded, network-scoped ABI cache. Spike-grade — measured, not merged.
E. **Only if A validates:** sketch the enrichment lane as a design section in the findings doc —
   background-owned fetch, contract methods appended (`v10 → v11`, append-only), UI renders
   explorer-sourced values with provenance labels and degrades to the current stated-absent
   rows on any failure. Do not implement the lane in this spike.

## HARD RULES (abridged — `AGENTS.md` is authoritative)

- No new dependencies. No `innerHTML` (`src/ui/kit/dom.js` `h()` only). BigInt in background,
  strings over messages. UI reaches nothing directly — `bridge.send` + `manifest.js` only.
- Contract is append-only; never repurpose or reorder existing methods.
- **Layout must be SEEN, not reasoned about.** Any change touching modal, sheet, drawer or
  overlay layout — including any new confirm/detail surface this spike proposes — must be
  visually validated in a real browser, or in a visual harness that loads the real built
  `dist/popup.css` (`scripts/preview-tx-sheet.html` is the pattern), before the PR is opened.
  `npm test` runs on a DOM shim with **no layout engine**: it cannot resolve `max-height`, run
  the flexbox algorithm or read `scrollHeight`. A green suite is not evidence about layout.
- Unknown is stated-absent, never guessed, never interpolated from neighbours or the clock.

## QUESTIONS THIS SPIKE MUST ANSWER

1. Does a **charged fee** exist anywhere (explorer or RPC), and if so does it ever differ from
   the declared header fee? (`scripts/measure-fee.mjs` is the tool.)
2. Does the **explorer's time agree with the node's** `blocks.get({slot}).blockTimeNs` — and if
   not, which is wrong? The wallet keeps using the node's value either way; enrichment labels
   provenance instead of replacing the source of truth. *(Supersedes the closed "does alphanet
   populate blockTime" — answered yes on alphanet, `BACKEND_GAPS.md` C2c.)*
3. Is the typed explorer API stable enough to depend on for enrichment-only data, and what do
   its failure and offline shapes look like?
4. Does `get_program_abi` cover the programs that actually appear in alphanet activity?

## STOP CONDITIONS

- **No network access in your environment** (this has been true of the agent sandbox): record
  that the spike could not run, leave the findings doc with the attempt logged, and stop. Do
  not invent shapes, statuses, fees or timestamps. A plausible fabricated number is worse than
  an honest gap — that failure mode has a named precedent in `docs/REDESIGN_TRIAGE.md`.
- Explorer API fails validation → enrichment stays unshipped; C2's honest answer stands.
- Asked to render unverified values "temporarily" → refuse; escalate instead.

## GATES

- `npm test` green (all suites), `npm run build` with 0 warnings.
- Contract version bumped **only** if methods actually ship in this PR (spike should not).
- Findings live in `docs/EXPLORER_SPIKE.md`; register any new doc in `docs/DOCS_INDEX.md`.
- Every claim in the findings doc carries provenance (file:line, live measurement, or explorer
  response excerpt). "I read it in the docs" is not provenance for a wire shape.
