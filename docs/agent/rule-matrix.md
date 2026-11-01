# Rule-preservation matrix — `AGENTS.md` restructure (2026-10-31)

`AGENTS.md` was 347 lines, 25 KB. Agents on this branch still broke rules that were already written
in it. This file is the audit trail for the slimming: **every former section, and every fact in it,
has a named destination**. Nothing was deleted; the one exception is stated explicitly in §4.

Before: 347 lines. After: see `wc -l AGENTS.md` on this commit — the hard rules and the stop/report
blocks stayed, the long-form prose moved to `docs/agent/`.

## 1. Section-by-section

| Old `AGENTS.md` | Lines | New location |
| --- | --- | --- |
| §What this is | 5–11 | **`AGENTS.md` §What this is** (compressed; same facts) |
| §Mainnet-ready engineering directive | 12–47 | **`docs/agent/engineering-directive.md`** §Mainnet-ready engineering directive — verbatim; `AGENTS.md` keeps the two-sentence summary |
| §Architecture and compatibility invariants | 48–77 | **`docs/agent/engineering-directive.md`** §Architecture and compatibility invariants — verbatim (7 bullets: optional features, dependency direction, exact pins, golden vectors, append-only API, versioned storage, network identity) |
| §Transaction and signing invariants | 78–91 | **`docs/agent/engineering-directive.md`** §Transaction and signing invariants — verbatim |
| §Delivery, migration, and security review | 92–114 | **`docs/agent/engineering-directive.md`** §Delivery, migration, and security review — verbatim |
| §Documents (read-when table, conflict resolution, 4 anti-sprawl rules) | 115–152 | **`docs/DOCS_INDEX.md`** already owned the read order (§1), the document classes (§4) and the anti-sprawl rules (§7). `AGENTS.md` now keeps a 6-line read-before-you-touch index and the conflict-resolution paragraph (which is unique to `AGENTS.md`). The duplicated 38-line table is not copied anywhere — a copy is a place for the two to disagree |
| §Commands | 153–170 | **`AGENTS.md` §Commands** — kept, lightly re-wrapped |
| §Hard rules 1–17 | 171–267 | **`AGENTS.md` §Hard rules**, one rule per entry, each naming its enforcing check; full text of 10/14/15/16/17 in **`docs/agent/rules-detail.md`** (§2 below) |
| §Stop and ask instead of guessing | 268–275 | **`AGENTS.md`** — kept verbatim |
| §Traps that will waste your time | 276–330 | **`docs/agent/traps.md`** — verbatim, same order |
| §Reporting | 331–347 | **`AGENTS.md` §Reporting** — kept verbatim |

## 2. Hard rules — number, status, check

Numbers are **stable**; `src/` and `test/` cite them (`dashboard.js:457` rule 15, `name.js:116`
rule 15, `test-toast.mjs:27` rule 14, `test-launchpad-quarantine.mjs:265` rule 6,
`test-route-lifecycle.mjs:25` rule 5). Never renumber.

| # | Rule | Where its full text lives | Enforcing check |
| --- | --- | --- | --- |
| 1 | Never edit `dist/` | `AGENTS.md` | gitignore + regenerating build |
| 2 | `vault.js` / `thru-client.js` sacred | `AGENTS.md` | `test-vault.mjs`, `test-thru-client.mjs` |
| 3 | One UI/backend seam | `AGENTS.md` | `check-layering` (`single-seam`, `ui-must-not-import-background-or-vault`) |
| 4 | Append-only backend API | `AGENTS.md` | `test-contract.mjs` |
| 5 | No new dependencies, exact pins | `AGENTS.md` | `test-derivation.mjs`, `check-layering` (SDK confined to `src/lib`); adding a dependency has **no gate** |
| 6 | BigInt money only | `AGENTS.md` | `test-launchpad-quarantine.mjs` float scan, `test-tx-units.mjs` |
| 7 | DOM only through `h()` | `AGENTS.md` | `check-layering` DOM-sink ratchet (at 0) |
| 8 | No inline `style`/`on*` | `AGENTS.md` | `check-csp.mjs`, `check-layering` |
| 9 | Secrets stay out of URLs/storage/console | `AGENTS.md` | `test-route-lifecycle.mjs` `findSecrets` |
| 10 | Password re-auth, one signing service, v12 exception, self-signing invariant | `docs/agent/rules-detail.md` §Rule 10 (verbatim) | `test-api-router.mjs` auth matrix |
| 11 | `{ el, update, destroy }` + `disposer()` | `AGENTS.md` | `test-ui-dom.mjs`, `test-route-lifecycle.mjs` teardown |
| 12 | Delete the old copy in the same commit | `AGENTS.md` | **review only** |
| 13 | Small commits | `AGENTS.md` | **review only** |
| 14 | Layout must be SEEN | `docs/agent/rules-detail.md` §Rule 14 (verbatim) | **none possible in Node** — `docs/MANUAL_SMOKE_CHECKLIST.md` + `scripts/preview-*.html` |
| 15 | Never block first paint | `docs/agent/rules-detail.md` §Rule 15 (verbatim) | `test-route-lifecycle.mjs` (routes paint with bridge replies stalled) |
| 16 | One review pipeline; value-moving screens never sign | `docs/agent/rules-detail.md` §Rule 16 (verbatim) | `test-tx-review.mjs` [14], `test-tx-review-card.mjs` |
| 17 | No essays on screens | `docs/agent/rules-detail.md` §Rule 17 (verbatim) | `test-tx-review-card.mjs` forbidden-term scan |

Rules 18–21 were **not** part of the restructure. They are added in the second commit, one at a
time, each after its check exists (see §5 of that commit's report).

## 3. What the restructure deliberately did NOT do

- No rule was renumbered, softened, or merged into another rule.
- No source file changed.
- No new top-level document: everything new lives under `docs/agent/`, as the plan required.
- The `docs/DOCS_INDEX.md` read order was not duplicated back into `AGENTS.md`.

## 4. The one thing dropped, and why

The old §Documents table (38 lines) listed 13 documents with one-line descriptions. `AGENTS.md` no
longer carries it: `docs/DOCS_INDEX.md` §3/§4 maintain the same list, with the three-class split that
the old table did not have. Keeping both meant two lists to drift. `scripts/check-agents.mjs` fails
if `AGENTS.md` points at a file that does not exist, which is the failure the table used to prevent.

## 5. Enforcement

`scripts/check-agents.mjs` (runs inside `npm test`) asserts:

1. every repository path mentioned in `AGENTS.md` and in `docs/agent/*.md` exists;
2. rules **1–17** are all present, numbered and in order;
3. every rule names a `*check:*` (or the literal word `review`) — a rule with neither fails;
4. the file stays under a size ceiling that only ratchets down;
5. **negative controls**: a synthetic document with a missing path, a missing rule, and a rule with
   no check must each be rejected by the same functions the real file goes through.
