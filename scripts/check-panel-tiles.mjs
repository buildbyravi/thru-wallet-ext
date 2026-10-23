#!/usr/bin/env node
// Guard: dashboard panel tiles are one uniform geometry — Send, Receive, and the Faucet
// tile are the SAME component with the SAME class and the SAME square size.
//
// Why: 2026-10-09→10 the faucet tile visually diverged twice while everything still
// shipped green — once as a full-width 48px bar (last-child nth-child 3n+1 rule) and once
// from the fixed 88px cell-era sizing. Owner directive 2026-10-10: faucet must match the
// Send/Receive tiles exactly. A browser screenshot is the real proof (manual smoke
// checklist, /dashboard row); this static guard makes the regression structurally loud in
// CI: the square rule cannot be deleted without a failing test, and no code path may
// re-introduce a tile-by-tile size override.
//
// Usage: node scripts/check-panel-tiles.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const css = readFileSync(repo('src/popup/styles/screens.css'), 'utf8');
const dashboard = readFileSync(repo('src/ui/app/routes/dashboard.js'), 'utf8');
const panelItem = readFileSync(repo('src/ui/domain/panel-item.js'), 'utf8');

let errors = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); errors += 1; };
const ok = (msg) => console.log(`  ok - ${msg}`);

// 1. The square rule itself: .panel-item must be width/aspect-ratio sized, not a fixed
//    pixel height (the 88px rectangle era) — and squareness must be declared on it.
const panelBlock = css.match(/^\.panel-item\s*\{([^}]*)\}/m);
if (!panelBlock) {
  fail('screens.css: no `.panel-item { … }` rule found — tiles would render unstyled');
} else {
  if (!panelBlock[1].includes('aspect-ratio: 1 / 1')) fail('.panel-item does not declare `aspect-ratio: 1 / 1` — tiles are not guaranteed square');
  if (/height:\s*\d/.test(panelBlock[1])) fail('.panel-item declares a fixed pixel height again — squareness breaks the moment content or column width changes');
  if (!/width:\s*100%/.test(panelBlock[1])) fail('.panel-item no longer fills its grid column (width: 100%) — square base is unstable');
  if (!errors) ok('.panel-item is square by aspect-ratio with no fixed pixel height');
}

// 2. No descendant override may re-shape individual tiles (the retired
//    "7th tile spans the full row as a 48px bar" treatment is the exact pattern being
//    guarded against: per-tile geometry belongs to .panel-item alone).
if (/\.dashboard-panel-grid\s+\.panel-item/.test(css)) {
  fail('a `.dashboard-panel-grid .panel-item …` override exists — per-tile sizing divergence made possible again');
} else {
  ok('no per-tile geometry overrides inside the dashboard grid');
}

// 3. Every grid tile (incl. Faucet) is the same component, and only `display` may be
//    touched inline on a tile element — width/height/font-size overrides would break parity.
for (const name of ['sendTile', 'receiveTile', 'swapTile', 'historyTile', 'nameTile', 'securityTile', 'faucetTile']) {
  if (!dashboard.includes(`const ${name} = track(PanelItem({`)) fail(`dashboard.js: ${name} is not a PanelItem — tile parity lost`);
}
if (!errors) ok('all seven dashboard tiles (incl. Faucet) are the same PanelItem component');
const tileStyles = [...dashboard.matchAll(/\w+Tile\.el\.style\.(\w+)/g)].map((m) => m[1]);
const badStyles = tileStyles.filter((prop) => prop !== 'display');
if (badStyles.length) fail(`inline style on a tile element that is not display: ${badStyles.join(', ')}`);
else ok(`tile elements only touch inline \`display\` (${tileStyles.length} site(s)) — no width/height overrides`);

// 4. PanelItem itself must emit the shared class and must not size itself.
if (!/class:\s*'panel-item'/.test(panelItem)) fail('panel-item.js: tiles no longer carry the `.panel-item` class');
if (/\.style\.(width|height)|height:\s*\d/.test(panelItem)) fail('panel-item.js: the component sizes itself — sizing must stay in CSS so every tile shares it');
if (!errors) ok('PanelItem emits `.panel-item` and carries no self-sizing');

if (errors) {
  console.error(`\npanel-tile geometry parity: ${errors} violation(s)`);
  process.exit(1);
}
console.log('\nPanel-tile geometry parity checks passed: Faucet === Send === Receive (same class, same square rule).');
