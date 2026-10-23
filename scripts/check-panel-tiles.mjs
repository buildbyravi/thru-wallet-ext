#!/usr/bin/env node
// Guard: dashboard panel tiles are one uniform geometry — main's exact composition
// (6 tiles / 2 rows / 3 columns, Faucet in row 2 col 3 as on 14e16b1) with each tile the
// SAME component, SAME class, SAME size (88px cell). Owner directive 2026-10-23: the
// dashboard must render exactly like main; the 7th "Domain" tile was removed because it
// left a 1-item orphan row (owner: looks bad). The /name route remains registered —
// the screen works via deep link — but has no tile.
//
// Why: 2026-10-09→23 the faucet tile visually diverged three times while everything still
// shipped green — once as a full-width 48px bar (last-child nth-child 3n+1 rule), then as
// an aspect-ratio square that grew every tile ~119px tall at popup width (a big visual
// change from main the owner flagged as bad), then it was restored to 88px. Owner
// directive 2026-10-23: faucet matches Send/Receive exactly, dashboard stays faithful to
// main. A browser screenshot is the real proof (manual smoke checklist, /dashboard row);
// this static guard makes the regression structurally loud in CI: the 88px parity rule
// cannot be deleted without a failing test, and no code path may re-introduce a
// tile-by-tile size override.
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

// 1. The parity rule itself: .panel-item must be main's exact geometry — fixed 88px
//    height, width 100%, and NO aspect-ratio (the square experiment stretched every tile
//    to ~119px at popup width — exactly the dashboard bloat the owner flagged).
const panelBlock = css.match(/^\.panel-item\s*\{([^}]*)\}/m);
if (!panelBlock) {
  fail('screens.css: no `.panel-item { … }` rule found — tiles would render unstyled');
} else {
  if (!panelBlock[1].includes('height: 88px')) fail('.panel-item lost main\'s `height: 88px` — tile geometry diverged from main');
  if (/aspect-ratio\s*:/.test(panelBlock[1])) fail('.panel-item declares aspect-ratio again — that was the 2026-10-23 regression (tiles balloon to ~119px at popup width)');
  if (!/width:\s*100%/.test(panelBlock[1])) fail('.panel-item no longer fills its grid column (width: 100%)');
  if (!errors) ok('.panel-item keeps main\'s exact 88px geometry (no aspect-ratio)');
}

// 2. No descendant override may re-shape individual tiles (the retired
//    "7th tile spans the full row as a 48px bar" or the 7-tile orphan-row layout are the
//    exact patterns guarded against: per-tile geometry and the 6-tile grid are fixed).
if (/\.dashboard-panel-grid\s+\.panel-item/.test(css)) {
  fail('a `.dashboard-panel-grid .panel-item …` override exists — per-tile sizing divergence made possible again');
} else {
  ok('no per-tile geometry overrides inside the dashboard grid');
}

// 3. Every grid tile (incl. Faucet) is the same component, and only `display` may be
//    touched inline on a tile element — width/height/font-size overrides would break parity.
for (const name of ['sendTile', 'receiveTile', 'swapTile', 'historyTile', 'securityTile', 'faucetTile']) {
  if (!dashboard.includes(`const ${name} = track(PanelItem({`)) fail(`dashboard.js: ${name} is not a PanelItem — tile parity lost`);
}
if (!errors) ok('all six dashboard tiles (incl. Faucet) are the same PanelItem component');
const gridMatch = dashboard.match(/dashboard-panel-grid'\s*\}\s*,\s*\[([^\]]*)\]/s);
const gridTiles = gridMatch ? (gridMatch[1].match(/\w+Tile\.el/g) || []) : [];
if (gridTiles.length !== 6) fail(`dashboard grid must hold main's exactly 6 tiles — found ${gridTiles.length} (${gridTiles.join(', ')})`);
else ok(`grid composition is main's exact 6 tiles: ${gridTiles.join(', ')}`);
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
console.log('\nPanel-tile geometry parity checks passed: Faucet === Send === Receive (same class, main\'s exact 88px geometry).');
