# Thru Wallet — Design System

Instrument-grade dark UI for a self-custody wallet. The design language:
**precision terminal** — flat graphite surfaces, hairline borders, tabular
mono numerals, one phosphor-amber accent. Depth comes from stepping a
surface ramp, never from shadows or gradients. Restraint is the brand.

## File layout

```
src/popup/
  popup.css            aggregator only (@imports, order matters)
  styles/
    tokens.css         every color / size / font / motion value
    base.css           reset, document, type primitives, a11y
    components.css     reusable primitives (btn, field, row, byte-mark…)
    screens.css        layout chrome + per-screen composition
  icons.js             inline SVG icon set + byte-mark identicon
```

`npm run build` bundles popup.css (esbuild resolves the @imports) into a
single `dist/popup.css`.

## Rules for adding features

1. **New screen** = `<section id="screen-x" class="screen hidden">` in
   popup.html + name added to `screens` array in popup.js. Compose it from
   existing components; touch screens.css only if composition can't cover it.
2. **New list of things** (assets, NFTs, connected sites…) = `.list` +
   `.row` / `.row-glyph` / `.row-body` / `.row-title` / `.row-sub`.
   Already handles hover, active state, truncation.
3. **New icon** = add one entry in `icons.js`. Stroke-based, 24-unit
   viewBox, `currentColor`. Static markup gets it via `data-icon="name"`;
   dynamic markup calls `icons.name()`.
4. **New color** = add a token in tokens.css. Never hard-code hex in
   components.css or screens.css.
5. **Section / field labels** = `.eyebrow` (uppercase micro-label). That's
   the system's structural voice; don't invent new label styles.

## Token summary

| Group | Tokens |
|---|---|
| Surfaces | `--bg`, `--surface-1..3` (graphite ramp; step up = closer) |
| Borders | `--border`, `--border-strong` |
| Text | `--text-1` (primary), `--text-2` (secondary), `--text-3` (muted) |
| Accent | `--accent` #ffb224 amber + `-bright/-ink/-tint/-border` |
| Semantic | `--positive`, `--negative` (+ `-tint/-border` each) |
| Type | `--font-ui`, `--font-mono`; sizes `--fs-xs..--fs-display` |
| Space | `--sp-1..6` on a 4px base |
| Shape | `--radius-sm/md/lg/pill` |
| Motion | `--t-fast` 100ms, `--t-base` 150ms, ease-out only |

## The signature: byte-mark identicons

Each account renders a 4×4 grid whose cells map deterministically from the
address to a 4-color steel→amber ramp (`byteMarkHtml()` in icons.js). Same
address, same mark — a glanceable visual checksum. Square container =
seed-derived account, round = imported key (Rabby's square/circle
distinction, done natively). This replaces the old H/K letter avatars.

## Deliberate constraints

- **No gradients, no glow shadows, no translate-on-hover.** Hover changes
  background/border/color only. Motion budget: 100–150ms ease-out.
- **Numbers are mono + `tabular-nums`** everywhere (balance, addresses,
  signatures). A wallet is a ledger; the number is the interface.
- **Amber is scarce.** Primary button fills, focus rings, active-row
  borders, byte-mark hot cells, the wordmark glyph. Nothing else. If a new
  feature wants amber, something existing must justify keeping it.
- **`prefers-reduced-motion` respected, `:focus-visible` rings on
  everything** (base.css).
