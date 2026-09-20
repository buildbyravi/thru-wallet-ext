# P2 hand-off — transaction detail sheet

For the local Windows auditor. Everything below is stated so it can be diffed and
re-verified independently. Where a claim is *not* verified, it says so explicitly.

Branch: `arena/01a0bf21-thru-wallet-ext` · base: `main` @ `b73ebd6`
Commits: `773d5f7` (spike docs) → `4542b14` (contract v10) → `28255f8` (P2 UI + tests)

---

## 1. Gate results

Run before any change (baseline) and again after every commit.

```
npm run build   PASS — 0 warnings (checked explicitly; the build only WARNS on CSS errors)
npm test        PASS — 13/13 suites
```

Per-suite `ok -` counts, baseline → now. **No count went down.**

| Suite | Baseline | Now | Δ |
| --- | --- | --- | --- |
| test-derivation.mjs | 16 | 16 | — |
| test-qr.mjs | 13 | 13 | — |
| scripts/check-layering.mjs | 0 (pass/fail only) | 0 | — |
| scripts/check-csp.mjs | 0 (pass/fail only) | 0 | — |
| scripts/check-routes.mjs | 0 (pass/fail only) | 0 | — |
| scripts/check-css-nesting.mjs | 0 (pass/fail only) | 0 | — |
| test-launchpad-quarantine.mjs | 45 | 45 | — |
| test-contract.mjs | 60 | **65** | +5 |
| test-ui-dom.mjs | 93 | 93 | — |
| test-route-lifecycle.mjs | 757 | **797** | +40 |
| test-vault.mjs | 86 | 86 | — |
| test-thru-client.mjs | 110 | **119** | +9 |
| test-api-router.mjs | 32 | 32 | — |

Re-derive with:
```
for f in test-derivation.mjs test-qr.mjs scripts/check-layering.mjs scripts/check-csp.mjs \
         scripts/check-routes.mjs scripts/check-css-nesting.mjs test-launchpad-quarantine.mjs \
         test-contract.mjs test-ui-dom.mjs test-route-lifecycle.mjs test-vault.mjs \
         test-thru-client.mjs test-api-router.mjs; do
  echo "$f: $(node $f 2>&1 | grep -c 'ok -')"; done
```

DOM-sink ratchet still reports **0 sinks, fully closed**.

---

## 2. Every file touched

### Added

| File | What it is |
| --- | --- |
| `docs/TX_DETAIL_SPIKE.md` | The read-only spike, written before any UI. Records what the RPC surface can/cannot answer and why the fee is a declaration. |
| `src/ui/domain/tx-detail-sheet.js` (308 lines) | The sheet. `{el, update, destroy}`, focus-trapped, `document.body`-parented. |
| `docs/handoff/P2_TX_DETAIL_HANDOFF.md` | This file. |

### Modified — source

| File | Change | Blast radius |
| --- | --- | --- |
| `src/lib/thru-client.js` | **SACRED.** One appended export, `getTransactionDetail`. **Zero existing lines modified** — verify with `git diff b73ebd6 -- src/lib/thru-client.js`, which shows a single `+` hunk after `listAccountHistory`. | additive only |
| `src/background/services/tx-service.js` | One appended export, `getTransactionDetail`. Serializes for the seam; reuses the existing `resolveTokenHistory`. | additive only |
| `src/background/api-router.js` | One line: `'tx.getDetail'` handler. | additive only |
| `src/shared/contract/manifest.js` | `CONTRACT_VERSION` 9 → 10 plus one new `tx.getDetail` entry. No existing method's name/params/auth/returns touched. | append-only, as rule 4 requires |
| `src/ui/domain/tx-card.js` | Optional `onOpen`. When passed, the card becomes `<article role="button" tabindex="0">` with click + Enter/Space, and a guard that ignores events originating in the nested copy button / explorer anchor. Without `onOpen` the card is byte-for-byte the old inert `<div>`. | card only |
| `src/ui/app/routes/history.js` | Owns one sheet at a time: `openDetail`/`closeSheet`, passes `onOpen` to `TxCard`, calls `closeSheet()` in `destroy()`. Supplies `loadDetail` so the domain component never touches the bridge itself. | history route only |
| `src/popup/styles/kit.css` | `.detail-val.positive/.negative`, `.tx-sheet-overlay`, `.tx-sheet`, `.tx-sheet-sig`, `.tx-sheet-sig-value`, `.detail-sheet-mono`, `.tx-sheet-note`. All colours via existing tokens. | new classes only |
| `src/popup/styles/screens.css` | `.tx-card-open` (cursor + hover). Updated the stale "nothing here is clickable yet" comment. | new class + comment |

### Modified — tests

| File | Change |
| --- | --- |
| `test-route-lifecycle.mjs` | `DETAIL_ENTRIES` + `DETAIL_BLOCK_TIME_MS` fixtures, a `tx.getDetail` fixture, a 33-assertion P2 block in `navigationTest()`, and 4 pairs of negative controls (8 assertions). |
| `test-contract.mjs` | v10 assertions, including one that fails if `feeDeclaredUnits`/`feeCharged:false` is ever renamed to a bare `feeUnits`. |
| `test-thru-client.mjs` | Section 11: the additive primitive's shape promises, including source-level assertions that the function body contains no `Date.now()` and treats `0n` block time as unknown. |

### Modified — docs

`docs/HISTORY_REDESIGN_PLAN.md` (status → P0+P1+P2; P2 section marked shipped and its
divergence from the sketch recorded), `docs/BACKEND_GAPS.md` (new C2b charged fee, C2c
block time), `docs/DEFECT_LOG.md` (3 entries + lessons), `docs/STATUS_AND_ROADMAP.md`,
`docs/DOCS_INDEX.md`, `docs/MANUAL_SMOKE_CHECKLIST.md` (2 new rows), `CONTEXT.md`.

---

## 3. Every honesty-of-display claim, and how to falsify it

This is the section to audit hardest. Each row states a claim the UI makes, where it is
enforced, and what you would do to break it.

| # | Claim | Enforced at | How to falsify |
| --- | --- | --- | --- |
| H1 | The fee shown is the **header-declared** fee, never an amount charged. | Named `feeDeclaredUnits` in `thru-client.js`, `tx-service.js` and the manifest; wire carries `feeCharged: false`; row labelled "Fee (declared)". | `test-contract.mjs` asserts the manifest `returns` contains `feeDeclaredUnits` and `feeCharged: false` and does NOT contain a bare `feeUnits`. Rename it and that test fails. |
| H2 | The sheet states that Thru reports no charged fee at all. | `.tx-sheet-note` paragraph in `tx-detail-sheet.js`. | Lifecycle asserts `/no charged-fee field/i` appears in the rendered sheet text. Delete the note and it fails. |
| H3 | The fee is **not** back-filled from `network.baseFeeUnits` when unknown. | The sheet only sets the fee row inside `if (detail.feeDeclaredUnits != null)`. | Lifecycle opens a card whose fixture returns `{supported:false}` and asserts `Fee (declared) Not available`. The estimateFee fixture in the same file returns `feeUnits: '1'`, so a bleed-through would be caught. |
| H4 | Block time is the **block's** time, labelled as such, and absent when the node omits it. | Row label "Block time"; `blockTimeMs` starts `null`; only set when `blockTimeNs > 0n`. | Lifecycle asserts `Block time Not available` on the unsupported fixture. `test-thru-client.mjs` asserts the function body has no `Date.now()` and contains the `> 0n` guard. |
| H5 | No value is ever inherited from a neighbouring entry. | The sheet reads only the tapped `entry` and its own `tx.getDetail` response. The list's day-grouping inference (`displayDayKeys`) is display-only and does not write `entry.timestamp` — unchanged in this PR. | Lifecycle's identity assertion + the pre-existing "timestampless cards show Block \<slot\>" assertions. |
| H6 | The sheet opens against the tapped entry, resolved by **identity**. | `entry` captured per-card in the `paintList` loop closure and handed to `openDetail`. | Lifecycle opens the **second** card (not the first) and asserts its signature is present and the first's is absent. Negative control proves a wrong-entry sheet fails the same predicate. |
| H7 | A failed fetch does not blank facts the list already had. | The sheet paints synchronously from `entry`; the lazy fill only ever moves a row from "Not available" to a value. | Lifecycle asserts signature, block and amount are all still present on the `{supported:false}` sheet. |
| H8 | Status `null` (no execution result yet) renders as "Not available", not "Succeeded". | Three-way branch on `entry.success === true / === false / else`. | Inspect `statusText` in `tx-detail-sheet.js`. Not separately asserted — see §5. |
| H9 | An own-wallet counterparty reads by name; an unknown one reads as a truncated address; an absent one omits the row rather than saying "Not available". | `knownAccounts` lookup then `truncateAddress`; the row is only pushed when a counterparty exists. | Lifecycle asserts both the named case and the truncated-stranger case (and that the full address is NOT rendered). |
| H10 | Nothing secret and no full address/signature reaches the URL or session history. | The sheet has no router involvement; the signature appears only in an `href` to the explorer. | Lifecycle asserts `secretInUrls()` is empty AND that neither `ADDRESS_B` nor the signature appears in `location.href`/`HISTORY_URLS`. |

### Honesty claims about the SPIKE itself (weaker evidence — read this)

The spike's conclusions are claims about **the pinned SDK and its generated protobuf**, not
about a running Thru node. No RPC was reachable from the build environment
(`rpc.alphanet.thru.org` and `scan.thru.org` both refused the TLS connect), so:

- "Thru reports no charged fee" means: the generated `TransactionExecutionResult` message has
  no such field in `@thru/sdk@0.3.16`. Re-check at
  `node_modules/@thru/sdk/dist/streaming_service_pb-AoEXbEY2.d.ts:1327-1393`.
- "Transaction.fee is the header declaration" means: `Transaction.fromProto` sets it from
  `header.fee` (`chunk-UN6NDFUB.js:1192`) and the builder defaults it to `DEFAULT_FEE = 1n`
  (`:205`, `:3795`).
- "Block time exists but is optional" means: `BlockHeader.block_time = 13` in the protobuf
  (`streaming_service_pb-AoEXbEY2.d.ts:893`) and `Block.fromProto` only sets `blockTimeNs`
  when `proto.header.blockTime` is truthy (`chunk-UN6NDFUB.js:1926`).

**Not established:** whether alphanet actually populates `header.blockTime`, and whether the
declared header fee ever differs from what is debited. Both are manual-smoke/live-probe
questions and are recorded as such in `BACKEND_GAPS.md` C2b/C2c and in two new
`MANUAL_SMOKE_CHECKLIST.md` rows.

---

## 4. House-rule compliance

| Rule | Status |
| --- | --- |
| `dist/` never edited | ✅ only `src/` + tests + docs |
| `vault.js` / `thru-client.js` sacred | ✅ vault untouched; thru-client is one appended function, zero modified lines — the diff is explainable line by line |
| One seam (`bridge.send`) | ✅ the domain component takes a `loadDetail` callback; only the route calls the bridge. `check-layering` green |
| Backend API append-only | ✅ v10 appends `tx.getDetail`; `test-contract` checks both directions |
| No new dependencies | ✅ none added |
| Money BigInt internal / string on wire | ✅ `feeDeclaredUnits`/`nonce` are `.toString()`-ed in the service; the sheet re-widens with `BigInt()` before formatting |
| All DOM via `h()` | ✅ 0 sinks, ratchet closed |
| No inline `style=""` / `on*=""` | ✅ CSP-clean; `check-csp` green |
| Secrets never in DOM/URL/storage | ✅ asserted; a signature is public data and appears only in the explorer `href` |
| `{el, update, destroy}` + `disposer()` | ✅ both new/changed components |
| Delete superseded code same commit | ✅ nothing superseded; the stale "nothing here is clickable yet (detail sheet is P2)" CSS comment was corrected in place |
| Small commits | ✅ 3: spike docs, backend contract, UI+tests |
| `check-routes` class existence | ✅ every new class defined in `src/popup/styles/**` |
| Theme-safe | ✅ colours only via tokens that exist in both `:root` and `[data-theme="dark"]` |

**Non-goals respected:** no explorer consumption, no watch-only, no passkeys, no dApp, **no
`manifest.json` version bump** (still 1.2.0), no new settings/theme work, no refactors outside
the sheet's blast radius.

---

## 5. Known gaps — please probe these

1. **H8 is not asserted.** A `success: null` entry (decoded before the execution result
   landed) should render "Not available" for status. The code branches correctly but no
   fixture exercises it. Cheap to add if you want it gated.
2. ~~**Nothing is verified against a live chain.**~~ **CLOSED 2026-09-20.** Alphanet DOES
   send `header.blockTime`: a live faucet-claim sheet at block 12871764 rendered a real
   wall-clock time. `docs/BACKEND_GAPS.md` C2c is resolved for alphanet. Inverted
   consequence worth noting: on alphanet, "Block time: Not available" now signals a fetch
   failure or a node regression rather than expected behaviour.
3. **The declared-vs-charged fee question is open.** `scripts/measure-fee.mjs` measures the
   charged fee as `spent − amount`; comparing that to `Transaction.fee` on the same signature
   would settle whether the declaration is ever misleading. Not run here (no network).
4. **Slot-ratio day weighting still parked**, deliberately — see the plan doc for why it was
   not a 10-line change.
5. **LAYOUT WAS NOT VERIFIED IN A BROWSER — and a defect escaped because of it.** The sheet
   shipped with tall content compressed rather than scrolled: flex children defaulted to
   `flex-shrink: 1`, `.detail-table`'s `overflow: hidden` clipped its own last rows, and
   because nothing overflowed there was no scrollbar. "Fee (declared)" and "Program"
   disappeared silently. Found by a user on a real popup; fixed in `c3992ae` with
   `.tx-sheet > * { flex-shrink: 0 }`, a stylesheet-level invariant in
   `test-route-lifecycle.mjs` (falsified by reverting the fix), and
   `scripts/preview-tx-sheet.html` for visual checks. **When auditing, open that harness —
   do not re-derive layout from the CSS.** AGENTS.md hard rule 14 now requires this.
6. **Two RPC round trips per sheet open** (`transactions.get`, then `blocks.get`). Fine for a
   tap-triggered action; would not be fine if it ever moved to the list path. It has not.

## 6. Suggested audit path

```
git fetch origin && git checkout arena/01a0bf21-thru-wallet-ext
git diff b73ebd6 -- src/lib/thru-client.js      # must be ONE added function, no deletions
git diff b73ebd6 -- src/shared/contract/manifest.js  # must be append-only
npm ci && npm run build && npm test             # expect 0 warnings, 13/13
grep -rn "Not available" src/ui/domain/tx-detail-sheet.js   # the UNKNOWN constant, one source
grep -rn "feeUnits" src/ | grep -v feeDeclaredUnits          # should only match estimateFee (C2)
```

Then load `dist/` unpacked, **reload the extension** (not just the popup — the service worker
caches), and walk the two new `MANUAL_SMOKE_CHECKLIST.md` rows.
