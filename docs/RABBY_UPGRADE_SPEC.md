# Rabby-style upgrade spec (design system, R1 forward)

Status: **R1 implemented on `arena/01a0c008-thru-wallet-ext`; R2–R8 not started.**
This document is the durable record of the direction change and of every claim in the
external "upgrade wallet to Rabby style" package that was checked against this tree.
Companion docs: `docs/REDESIGN_TRIAGE.md` (line-by-line verdicts on suggestion set 1 of 4),
`docs/STATUS_AND_ROADMAP.md` (current state), `docs/DOCS_INDEX.md` (which doc to trust).

---

## 1. The direction change, and why it is this file and not a rewrite

Before R1 the UI was built as an *instrument panel*: pale steel chrome, a white column with
hairline borders on both edges, near-zero radii (2/3/4px), monospace uppercase micro-labels,
and a black primary button. That is a coherent look, and it has one structural consequence:

> With no surface hierarchy there is no way to say "this is a card" except to draw a box
> around it — and there were **70** opaque `border: 1px solid` declarations doing exactly
> that, at the same visual volume.

The second consequence was worse than cosmetic: `--ink: #151b1e` drove every primary CTA while
`--accent: #d33c43` (a red) was reserved for warnings. The wallet's "tap this" colour was the
quietest thing on screen and its "careful" colour was the only saturated one.

R1 replaces the system, not the code:

| Rule | Meaning |
| --- | --- |
| Hierarchy by contrast and elevation | page `--bg` → card `--surface-1` + `--shadow-card` → inset `--surface-2`/`--surface-inset` → hover `--surface-3` |
| One saturated hue | `--brand` = CTAs, links, active states. `--negative` (deeper red) = error/destructive. `--positive`/`--gold` = status |
| Hairlines only where they divide | between rows in a list/table, and under the app chrome. Never around a card |
| Shape scale | `--radius-xs 4 / sm 6 / md 8 / lg 12 / xl 16 / pill` |
| Colour literals only in `tokens.css` | enforced by `scripts/check-design-tokens.mjs` |

The component CSS kept its class names. R1 is a token and surface change, so it touches no DOM,
no route, no bridge method and no contract version.

## 2. What R1 shipped

- `src/popup/styles/tokens.css` — rewritten. 66 tokens (was 92; the unused steel/teal/brick/yellow
  scales, `--golden`, `--text-inverse`, `--fs-2xl`, `--sp-7`, `--t-screen` are gone), new shape
  scale, brand ramp, elevation recipe, `--control-height: 44px`, `--fs-display: 38px`.
  `--accent*` now aliases `--brand*` so there is exactly one saturated hue; `--ink` aliases
  `--text-1` and is kept only for the focus ring and focused-field border.

  The `--accent` / `--accent-bright` / `--accent-tint` / `--accent-border` names stay as
  aliases rather than being deleted, because ~200 rules reference them. The alias list is
  the migration: when a rule is next edited it should read `--brand*`; a rule that still
  reads `--accent*` is not a bug, it is the same colour under the old name. Deleting them in
  one commit would be a rename with no visual delta and a large review surface.
- `base.css` — `.app` is the page backdrop; the two vertical hairlines that framed the old white
  column are gone.
- `components.css` / `kit.css` / `screens.css` — cards, rows, tiles, avatars, modals, sheets,
  drawers, notices, tags and fields moved onto the new system: **opaque `border: 1px solid`
  declarations fell from 70 to 14**, and every survivor is deliberate: eleven hairlines that
  genuinely divide (rows in a list, the chrome edge under the topbar), the accent underline on a
  link, and two rules for the dead drawer-item selectors, which were moved onto the card
  treatment rather than left as the only two card outlines in the codebase. Five more are
  `1px solid transparent`,
  kept deliberately as box-model placeholders so a focus/error/copied state can turn a border
  on without moving the layout.
- Buttons: `--control-height` tap target; primary is the brand fill; `.btn.accent` is **deleted**
  (it became the same button as `.btn.primary` once the ramp was unified) and its four callers
  moved to `variant: 'primary'`; `.btn.secondary` is a white card-button; `.btn.danger` is red
  text that fills on hover only.
- Fields: filled wells (`--surface-inset`) with a transparent border, hover wash, ink border on
  focus, `--negative` border on `[aria-invalid]`.
- `scripts/check-design-tokens.mjs` — new guard, wired into `npm test`. It fails the build if a
  colour literal appears outside `tokens.css`, if a themed token is missing from either theme
  block, if any of the derived colour-completeness rules is violated, if any of the asserted
  contrast pairs (40, counting both themes) drops below its threshold (4.5:1 text, 3:1 graphic),
  or if a defined token has no `var()` caller. Its three failure modes were negative-tested —
  a hex literal in a component stylesheet, a colour token defined only in `:root`, and a named
  colour (`white`) each fail the guard, so it is a check and not a decoration.

### The one place R1 deliberately disagrees with the supplied palette

The supplied light ramp is `--brand: #e04e4e` with `--brand-ink: #ffffff`. Measured, that is
**3.91:1** — below AA for the label on the wallet's most important button, and 3.55:1 when the
same hue is used as link text on the page backdrop. R1 therefore ships `--brand: #c8323a`
(white text 5.29:1, brand-as-text 4.80:1 on the backdrop) and keeps the hue recognisably Thru's
brick red. In dark the supplied `#ff6b6b` is kept, because there the ramp is bright and the
*label* inverts instead (`--brand-ink: #26100f`, 6.50:1). `--text-3`, `--positive` and `--gold`
were deepened by the same check.

`node scripts/check-design-tokens.mjs --table` prints every pair and its measured ratio; the
guard is the reason the palette cannot silently drift back.

## 3. Claims in the external package that are wrong for this tree

Each of these would break a gate, a rule, or a user-visible promise. They are recorded here so a
future agent does not "restore" them.

| # | Claim | Reality |
| --- | --- | --- |
| 1 | "contract bumped to **8**" | `CONTRACT_VERSION = 10` (`src/shared/contract/manifest.js:52`). The next version is **11**; going to 8 is a downgrade. |
| 2 | `import { trapFocus }` | No such export. Real API: `focusTrap(container, { onEscape, initial, restoreFocus })` → `{ destroy, focusables, focusFirst }` (`src/ui/kit/focus-trap.js:96`). |
| 3 | "add `kit/sheet.js`" | `src/ui/domain/tx-detail-sheet.js` already is the focus-trapped bottom sheet. Extract it; do not write a second one. |
| 4 | "remove `.eyebrow` except in export.js" | `export.js` does not use `.eyebrow`. Users: `account-detail`, `dashboard`, `faucet`, `keyring`, `send`, `settings`, `seed-phrase-grid`. |
| 5 | "delete the lock button" | `test-route-lifecycle.mjs` asserts the topbar exposes a lock control, then locks through it. The test must be rewritten in the same commit and lock must stay reachable. |
| 6 | nanostores / Preact + TS | Violates `AGENTS.md` hard rule 5 (no new dependencies except first-party Thru packages). |
| 7 | `fiatHint // ≈ $1.46` | No price feed exists and CSP `connect-src` is pinned to `rpc.alphanet.thru.org`. A fiat figure would be fabricated — the honesty rule's merge-blocker case. |
| 8 | `pageState` in DOM `sessionStorage`/`localStorage` | Per-account page state belongs in `chrome.storage.session` (session-only, cleared on lock), never `local`. |
| 9 | sample `preflight` services (`contactsService.has`, `accountService.owns`, `balanceService.getUnits`, `thruClient.accountExists`) | None exist. Closest is `getAccountInfo` (`src/lib/thru-client.js:178`). The *rules* the sample encodes are sound; the code is pseudocode. |
| 10 | "popup 400×600" | 408×580, and the same document is registered as the resizable side panel (`manifest.json` → `side_panel.default_path`). Width is not a free variable. |

Two more items from the package are release-process decisions, not code: `chrome.notifications`
adds a permission (Web Store re-review, user-visible prompt on update), and a popup resize needs
the side-panel width behaviour in `base.css` re-checked.

## 4. Phase plan (from `docs/REDESIGN_TRIAGE.md` §3, unchanged)

| PR | Scope | State |
| --- | --- | --- |
| **R1** | Tokens + de-bordering | **done here** |
| **R2** | Typography + eyebrow removal + balance hero + action wells | in progress |
| R3 | Extract `kit/sheet.js` from `tx-detail-sheet.js`, Skeleton, screen animation | not started |
| R4 | Shell restructure + avatar | not started — rewrites the lock-control test |
| R5 | Send redesign + dashboard | not started — preserve BigInt parsing, the recipient-exists gate, dead-Enter |
| R6 | `pageState.*` + `tx.preflight` → contract v11 | not started — append-only, `chrome.storage.session` only |
| R7 | Watcher/broadcaster split + notifications | not started — permission change |
| R8 | Comment cleanup + popup size | last |

## 5. Verification for R1

```
npm run build                    clean, no CSS warnings; dist/popup.css 51.1kb -> 48.2kb
npm test                         all gates green, incl. the new design-token guard
node scripts/check-design-tokens.mjs --table
                                 66 tokens, 40 contrast pairs, both themes complete
```

**The one thing no gate can check is how it looks.** `npm test` runs on a DOM shim with no
layout engine, and this development sandbox has no browser at all — the usual escapes are
closed too (no chromium/chrome/firefox binary, no playwright cache, `apt` cannot reach the
Debian mirrors, and a downloaded Chromium would be missing ~15 shared libraries anyway:
`libnss3`, `libatk*`, `libcups`, `libdrm`, `libgbm`, `libxkbcommon`, `libpango`, `libcairo`,
`libasound`, `libdbus`, `libXcomposite` …). So a screenshot cannot be produced here, and no
claim in this document rests on one.

R1 therefore ships a review harness: **`scripts/preview-dashboard.html`**, next to the existing
`scripts/preview-tx-sheet.html`. It loads the real built `dist/popup.css` and renders, in one
page with a light/dark toggle, the dashboard composition (account pill, balance hero, action
grid, asset rows, pending notice) and the system (every button variant, fields, notices, the
detail table, an option card, the modal). Its markup mirrors `shell.js`, `dashboard.js`,
`token-row.js` and `account-avatar.js`; every class it uses is one the stylesheets define
(checked, not assumed).

Open it by building first and then loading the file in a browser:

```
npm run build
open scripts/preview-dashboard.html        # file:// is fine; it only needs ../dist/popup.css
```

The human step this replaces is the one the repo already documents as unskippable
(`AGENTS.md` hard rule 14, "layout must be SEEN"): look at whether a card reads as a card, and
whether the balance is the loudest thing on the dashboard, in **both** themes. Until someone
has done that, R1 is merged-but-unconfirmed.

## 6. Known debt this intentionally does not fix

- **Typography** is still instrument-flavoured: monospace uppercase `.eyebrow` labels on seven
  screens, and ~20 hardcoded `font-size` literals (10–32px) that bypass the scale. That is R2.
- **The dashboard hero** is 34px inside its own card and the quick actions are four bordered
  tiles; R1 only removed the borders. R2 turns them into the hero + action wells.
- **Dead-CSS measurement does not exist.** `check-routes.mjs` proves every class used is
  defined; nothing proves every class defined is used. `.drawer-*`, `.account-drawer-item`,
  `.network-drawer-item` and `.btn-chip` look unreferenced from `src/ui/**` but were left alone:
  deleting CSS on a hand-rolled scan is not safe, and the scan itself would be its own PR.
- **No `sr-only`/visually-hidden utility exists**, which is why R2 must not simply
  `display: none` the balance label — that would delete the accessible name of the number.
