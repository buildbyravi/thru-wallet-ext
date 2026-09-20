#!/usr/bin/env node
// Design-token guard.
//
// WHY THIS EXISTS
//
// R1 made the visual system a token system: shape, surfaces, one brand ramp, one
// elevation recipe. Token systems decay in three specific ways, and each of them
// is invisible in review because the file still looks right:
//
//   1. A colour literal creeps into a component stylesheet. The palette then has
//      two sources of truth, and a theme change silently misses whatever hardcoded
//      `#fff` someone added during a debugging session.
//   2. A theme block stops covering a token. `[data-theme="dark"]` overrides values,
//      never names, so a token defined only in :root keeps its light value in dark —
//      which is how "the dark theme has one white card" defects ship.
//   3. A token pair stops being readable. Nothing in CSS says that `--text-3` sitting
//      on `--bg` is 4.2:1, and no test in this repo could see it.
//
// This script fails the build on all three. It is deliberately a TEXT check over
// the stylesheets (like check-css-nesting.mjs) rather than a rendered check: the DOM
// shim used by npm test has no layout or colour engine, so an assertion about
// contrast can only exist here.
//
// Usage: node scripts/check-design-tokens.mjs
//
// Thresholds: 4.5:1 for body text, 3:1 for large/graphic elements (WCAG AA).
// A disabled control is exempt per WCAG 1.4.3 and is not asserted.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = fileURLToPath(new URL('../src/popup/styles', import.meta.url));
const TOKENS_FILE = 'tokens.css';
const files = readdirSync(STYLES).filter((f) => f.endsWith('.css')).sort();

let errors = 0;
const fail = (msg) => { console.error(`  ${msg}`); errors += 1; };

/* ---------------- 1. colour literals live only in tokens.css ---------------- */

const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
// A named colour is the same defect spelled differently: `border: 1px solid white` in a
// component stylesheet is a value that no theme can reach. `transparent` is a geometry
// keyword (a transparent border keeps the box stable while a state turns it on) and is
// allowed; so are the `currentColor`/`inherit`/`none` keywords.
const NAMED_COLOUR = /(?<![\w-])(white|black|red|green|blue|gray|grey|silver|maroon|navy|teal|olive|purple|fuchsia|aqua|lime|orange|yellow)(?![\w-])/i;
for (const file of files) {
  if (file === TOKENS_FILE) continue;
  const text = readFileSync(join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  text.split('\n').forEach((line, i) => {
    if (COLOUR_LITERAL.test(line) || NAMED_COLOUR.test(line)) {
      fail(`${file}:${i + 1}: colour literal outside tokens.css — use a var(--token) (${line.trim()})`);
    }
  });
}

/* ---------------- 2. parse the token blocks ---------------- */

const tokensSource = readFileSync(join(STYLES, TOKENS_FILE), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Extract `--name: value;` pairs from the block whose selector matches. */
function block(selector) {
  const at = tokensSource.indexOf(`${selector} {`);
  if (at === -1) return null;
  const body = tokensSource.slice(at, tokensSource.indexOf('\n}', at));
  const map = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

const light = block(':root');
const dark = block('[data-theme="dark"]');
if (!light) fail('tokens.css: no :root block found');
if (!dark) fail('tokens.css: no [data-theme="dark"] block found');

/** Tokens the system cannot work without, spelled out so deleting one is a loud failure. */
const REQUIRED_THEMED = ['--bg', '--surface-1', '--surface-2', '--surface-3',
  '--text-1', '--text-2', '--text-3', '--brand', '--brand-ink', '--negative', '--positive'];
for (const name of REQUIRED_THEMED) {
  if (!light.has(name)) fail(`${TOKENS_FILE}: ${name} missing from :root`);
}

// The completeness rule is derived, not maintained: any token whose LIGHT value is a colour
// literal must be redefined in the dark block. An alias (`var(--x)`) is exempt because it
// resolves through whatever x resolves to in the active theme, which is how --accent follows
// --brand without appearing in the dark block at all. A hand-written list of themed names
// would be the exact thing that rots — the next themed token someone adds would simply not
// be in it.
const COLOUR_VALUE = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
for (const [name, value] of light) {
  if (!COLOUR_VALUE.test(value)) continue;
  if (!dark.has(name)) {
    fail(`${TOKENS_FILE}: ${name} is a colour in :root but is not redefined in [data-theme="dark"] —`
      + ' the dark theme would keep the light value (and if that is intentional, alias it or make it theme-invariant)');
  }
}
for (const name of dark.keys()) {
  if (!light.has(name)) {
    fail(`${TOKENS_FILE}: ${name} is defined in [data-theme="dark"] but not in :root — dark overrides values, never names`);
  }
}

/** The shape scale, elevation recipe and control metric the system depends on. */
for (const name of ['--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill',
  '--shadow-card', '--shadow-pop', '--shadow-sheet', '--control-height', '--fs-display']) {
  if (!light?.has(name)) fail(`${TOKENS_FILE}: ${name} missing — the design system depends on it`);
}

/* ---------------- 3. resolve values, with aliases and alpha ---------------- */

const parseHex = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
};
const parseRgba = (str) => {
  const nums = str.match(/[\d.]+/g)?.map(Number) || [];
  return [nums[0], nums[1], nums[2], nums[3] ?? 1];
};

/** Resolve a token (or literal) to [r,g,b,a] in a theme context, following var() aliases. */
function resolve(name, theme, depth = 0) {
  if (depth > 8) throw new Error(`token alias cycle at ${name}`);
  const raw = theme.get(name) ?? light.get(name);
  if (raw == null) return null;
  const value = raw.trim();
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/);
  if (alias) return resolve(alias[1], theme, depth + 1);
  if (value.startsWith('#')) return parseHex(value);
  if (/^rgba?\(/.test(value)) return parseRgba(value);
  return null; // non-colour token
}

/** Composite a translucent colour over an opaque backdrop. */
function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a)));
}

const luminance = ([r, g, b]) => {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------- 4. contrast assertions ---------------- */

// fg / bg are token names. `bgOn` names the surface a translucent bg sits on.
const PAIRS = [
  ['--text-1', '--surface-1', 4.5], ['--text-1', '--surface-2', 4.5], ['--text-1', '--bg', 4.5],
  ['--text-2', '--surface-1', 4.5], ['--text-2', '--bg', 4.5],
  ['--text-2', '--surface-2', 4.5], ['--text-1', '--surface-3', 4.5],
  ['--text-3', '--surface-1', 4.5], ['--text-3', '--bg', 4.5],
  // The primary CTA label on its own fill, resting and hover.
  ['--brand-ink', '--brand', 4.5], ['--brand-ink', '--brand-hover', 4.5],
  // Brand used as TEXT (links, emphasis) rather than as a fill.
  ['--brand', '--surface-1', 4.5], ['--brand', '--bg', 4.5],
  // Status text on its own tinted panel.
  ['--negative', '--negative-tint', 4.5], ['--negative', '--surface-1', 4.5],
  ['--positive', '--positive-tint', 4.5], ['--positive', '--surface-1', 4.5],
  ['--gold', '--gold-tint', 4.5], ['--gold', '--surface-1', 4.5],
  // A brand icon sitting in a brand-tinted tile is a GRAPHIC, not body text: 3:1.
  ['--brand', '--brand-tint', 3],
];

const rows = [];
for (const [themeName, theme] of [['light', light], ['dark', dark]]) {
  for (const [fgName, bgName, min] of PAIRS) {
    const surface = resolve('--surface-1', theme);
    let bg = resolve(bgName, theme);
    let fg = resolve(fgName, theme);
    if (!bg || !fg) { fail(`${themeName}: could not resolve ${fgName} on ${bgName}`); continue; }
    // A translucent token is only meaningful once it is ON something: composite the
    // backdrop over the card surface, then the text over that composite.
    if (bg[3] < 1) bg = over(bg, surface);
    if (fg[3] < 1) fg = over(fg, bg);
    const r = ratio(fg, bg);
    rows.push(`${themeName.padEnd(5)} ${fgName.padEnd(14)} on ${bgName.padEnd(14)} ${r.toFixed(2)}:1`);
    if (r < min) {
      fail(`${themeName}: ${fgName} on ${bgName} is ${r.toFixed(2)}:1, below ${min}:1`);
    }
  }
}

/* ---------------- 5. no dead tokens ---------------- */

const defined = [...new Set([...(light?.keys() || []), ...(dark?.keys() || [])])];
const otherStyles = files.filter((f) => f !== TOKENS_FILE)
  .map((f) => readFileSync(join(STYLES, f), 'utf8')).join('\n');
const withinTokens = tokensSource;
for (const name of defined) {
  const inComponents = new RegExp(`var\\(\\s*${name}\\b`).test(otherStyles);
  const usedByAlias = new RegExp(`var\\(\\s*${name}\\b`).test(withinTokens);
  if (!inComponents && !usedByAlias) {
    fail(`${TOKENS_FILE}: ${name} is defined but nothing references it — delete it or use it`);
  }
}

/* ---------------- report ---------------- */

if (process.argv.includes('--table')) {
  console.log(rows.join('\n'));
}

if (errors) {
  console.error(`check-design-tokens: FAILED with ${errors} problem(s).`);
  process.exit(1);
}
console.log(`check-design-tokens: ${defined.length} tokens, ${PAIRS.length * 2} contrast pairs checked, `
  + 'no colour literals outside tokens.css, both themes complete.');
