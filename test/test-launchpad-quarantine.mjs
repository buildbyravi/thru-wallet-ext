// Launchpad quarantine checks — the legacy launchpad/DEX/prediction surface must stay out of
// the shipped extension.
//
// WHY THIS EXISTS
//
// The launchpad used to be a FEATURE FLAG rather than a deletion, and a flag is a product
// decision about what the UI advertises — it is not a security boundary. The consequences were
// all real (docs/AUDIT_REPORT.md F-04):
//
//   - `src/launchpad/**` kept building, so `dist/launchpad.html` shipped in every release and
//     was reachable by direct URL even with FEATURE_LAUNCHPAD false.
//   - `popup.html?launchpad=1` turned the whole surface on for anyone who typed it.
//   - that page interpolated token names, tickers, mint addresses and explorer URLs into
//     `innerHTML`/`insertAdjacentHTML`, outside the src/ui DOM-sink ratchet — the strongest
//     XSS guardrail the wallet has, bypassed by the one page nobody looked at.
//   - its DEX tab quoted swaps from `parseFloat()` and a hard-coded 23.5294 rate, and its
//     "Execute Swap On-Chain" button was a `setTimeout` that reported a trade that never
//     happened. A wallet that fabricates a price or a fill is worse than one with no price.
//
// The tree is deleted. These checks are what keeps it deleted: they fail on the source, on the
// flags, on the route/control surface, and on a real build's dist/ output.
//
// WHAT THIS IS NOT
//
// Not a statement that a launchpad can never exist. It can — as an isolated
// `src/features/launchpad/**` module with `launchpad.*` backend namespaces, guarded DOM, and
// real quotes from a verified AMM/indexer, per docs/MODULE_BOUNDARIES.md and the retained
// research in docs/LAUNCHPAD_UX_STUDY.md, docs/LAUNCHPAD_DEX_MIGRATION_UX.md and
// docs/THRU_NATIVE_DEFI_TAB_UX.md. Building that is a deliberate, reviewed change which must
// update this file on purpose. Do not weaken an assertion here to make a regression pass.
//
// Backend token methods (`token.deploy`, `token.list`, `token.deriveAddress`, …) are NOT part
// of the quarantined surface and are NOT touched by it: the contract is append-only, and the
// RPC/instruction code behind them is sacred. Only the legacy UI is gone.
//
// Run: node test-launchpad-quarantine.mjs
// Set QUARANTINE_SKIP_BUILD=1 to assert against an existing dist/ instead of rebuilding it.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { transform } from 'esbuild';

const ROOT = process.cwd();

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

// ---------------------------------------------------------------------------
// Scanning helpers
// ---------------------------------------------------------------------------

function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      walk(full, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const rel = (f) => relative(ROOT, f).split(sep).join('/');

/**
 * Blank out comments while KEEPING string literals, preserving line numbers.
 *
 * A comment that explains why the launchpad was removed must not read as a launchpad
 * reference — src/shared/flags.js documents the quarantine at length. Strings must survive,
 * because that is exactly where a URL like `getURL('launchpad.html')` lives.
 *
 * String state is tracked so a `//` inside `'https://rpc…'` is not mistaken for a comment.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  let state = 'code'; // code | line | block | single | double | template
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && next === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'single'; out += c; i += 1; continue; }
      if (c === '"') { state = 'double'; out += c; i += 1; continue; }
      if (c === '`') { state = 'template'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }

    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }

    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }

    // Inside a string or template literal: copy verbatim so markers in strings are visible.
    if (c === '\\') { out += source[i + 1] ?? ''; i += 2; continue; }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code';
    }
    out += c; i += 1;
  }

  return out;
}

/** Blank out comments AND string bodies — for finding code that runs, not text that mentions. */
function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  let state = 'code';
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && next === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'single'; out += ' '; i += 1; continue; }
      if (c === '"') { state = 'double'; out += ' '; i += 1; continue; }
      if (c === '`') { state = 'template'; out += ' '; i += 1; continue; }
      out += c; i += 1; continue;
    }

    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }

    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }

    if (c === '\\') { out += '  '; i += 2; continue; }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code'; out += ' '; i += 1; continue;
    }
    out += c === '\n' ? '\n' : ' '; i += 1;
  }

  return out;
}

/** Blank out `<!-- … -->` blocks, preserving line numbers. */
function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Blank out CSS block comments, preserving line numbers. */
function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Every `file:line` where a pattern matches, across a prepared corpus. */
function findHits(corpus, re) {
  const hits = [];
  for (const { file, text } of corpus) {
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${file}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return hits;
}

// The shipped runtime: everything that can end up in dist/. Dev tooling (scripts/, test files)
// is excluded — a check may name the thing it forbids.
const SHIPPED_JS = walk('src', ['.js']).map(rel);
const SHIPPED_CSS = walk('src', ['.css']).map(rel);
const SHIPPED_HTML = walk('src', ['.html']).map(rel);

const corpus = [
  ...SHIPPED_JS.map((f) => ({ file: f, text: stripComments(readFileSync(f, 'utf8')) })),
  ...SHIPPED_CSS.map((f) => ({ file: f, text: stripCssComments(readFileSync(f, 'utf8')) })),
  ...SHIPPED_HTML.map((f) => ({ file: f, text: stripHtmlComments(readFileSync(f, 'utf8')) })),
  { file: 'build.mjs', text: stripComments(readFileSync('build.mjs', 'utf8')) },
  { file: 'src/manifest.json', text: readFileSync('src/manifest.json', 'utf8') },
];

// ---------------------------------------------------------------------------
// 1. The legacy tree is deleted
// ---------------------------------------------------------------------------

section('Legacy launchpad tree is deleted, not flagged off');

const DELETED = [
  'src/launchpad',
  'src/launchpad/launchpad.js',
  'src/launchpad/launchpad.html',
  'src/launchpad/launchpad.css',
  // Both existed only to serve launchpad.js: icons.js is a markup-string factory whose output
  // was consumed by insertAdjacentHTML, and toast.js fed the #toast-container that only that
  // page filled. The guarded replacements are src/ui/kit/icon.js and src/ui/kit/feedback.js.
  'src/popup/icons.js',
  'src/popup/toast.js',
];
for (const path of DELETED) {
  ok(`${path} does not exist`, !existsSync(path));
}

const resurrected = [...SHIPPED_JS, ...SHIPPED_CSS, ...SHIPPED_HTML].filter((f) => /launchpad|\bdex\b|prediction/i.test(f));
ok(
  'no shipped source file is named after the quarantined surface',
  resurrected.length === 0,
  resurrected.join(', '),
);

// ---------------------------------------------------------------------------
// 2. Nothing in the shipped runtime points at it
// ---------------------------------------------------------------------------

section('No shipped source references the quarantined surface');

const SURFACE_MARKERS = [
  { id: 'launchpad page/bundle reference', re: /launchpad\.(html|css|bundle\.js)|['"`]launchpad['"`]|getURL\(\s*['"]launchpad/i },
  { id: 'launchpad feature flag', re: /FEATURE_LAUNCHPAD|FEATURE_TOKEN_DEPLOY/ },
  { id: 'launchpad query override', re: /\?launchpad=1|params\.get\(\s*['"]launchpad['"]\s*\)/ },
  { id: 'launchpad banner control', re: /launchpad-banner/i },
  { id: 'dex/prediction hash route', re: /#\s*\/\s*(dex|swap|predictions?|launchpad|my-tokens)\b/i },
  { id: 'dex/prediction tab or action', re: /data-(?:tab|route|action)=["']?(?:dex|predictions?|launchpad|bet-market)\b/i },
];

for (const marker of SURFACE_MARKERS) {
  const hits = findHits(corpus, marker.re);
  ok(
    `no ${marker.id} in src/, build.mjs or the manifest`,
    hits.length === 0,
    hits.join('\n         '),
  );
}

section('No fabricated DeFi math or copy in the shipped runtime');

const FAKE_DEFI_MARKERS = [
  // The legacy DEX tab: `const tokenRate = 23.5294;` then `payVal * tokenRate`, both floats.
  { id: 'hard-coded bonding-curve rate', re: /23\.5294|tokenRate\b|bondingCurve/i },
  // Rule: money is BigInt only (AGENTS.md #6). Nothing in the shipped runtime may parse a
  // float — the only calls that ever existed were the fake quote and the fake "max" chip.
  { id: 'float money math', re: /parseFloat\s*\(/ },
  { id: 'simulated trade copy', re: /Execute Swap|Swap simulated|Simulated prediction|Executing on-chain/i },
  { id: 'dex/prediction vocabulary', re: /\bDEX\b|\bdex\b|\bpredictions?\b|\bswapMode\b|\bamm\b/i },
];

// Only our own code is scanned for these. Third-party bundles under node_modules are not part
// of the corpus, and dist/ is checked separately below with a narrower pattern list.
for (const marker of FAKE_DEFI_MARKERS) {
  const hits = findHits(corpus, marker.re);
  ok(
    `no ${marker.id} in src/, build.mjs or the manifest`,
    hits.length === 0,
    hits.join('\n         '),
  );
}

// ---------------------------------------------------------------------------
// 3. Flags: the override is gone and inert
// ---------------------------------------------------------------------------

section('Feature flags cannot re-enable the surface');

const { FLAGS, isEnabled, applyQueryOverrides } = await import('../src/shared/flags.js');

ok('FLAGS has no FEATURE_LAUNCHPAD key', !('FEATURE_LAUNCHPAD' in FLAGS));
ok('FLAGS has no FEATURE_TOKEN_DEPLOY key', !('FEATURE_TOKEN_DEPLOY' in FLAGS));
ok('isEnabled() reports the retired flag as disabled', isEnabled('FEATURE_LAUNCHPAD') === false);

const before = { ...FLAGS };
applyQueryOverrides('?launchpad=1');
ok(
  '`?launchpad=1` changes nothing',
  JSON.stringify(FLAGS) === JSON.stringify(before),
  `before ${JSON.stringify(before)} after ${JSON.stringify(FLAGS)}`,
);

applyQueryOverrides('?launchpad=1&dex=1&predictions=1&token-deploy=1');
ok(
  'no retired-surface query parameter is honoured',
  JSON.stringify(FLAGS) === JSON.stringify(before),
  `flags after override: ${JSON.stringify(FLAGS)}`,
);

// The function itself must still work, or "changes nothing" would be a vacuous pass.
applyQueryOverrides('?debug=1');
ok('a supported override still works, so the check above is not vacuous', FLAGS.DEBUG_ROUTING === true);
FLAGS.DEBUG_ROUTING = before.DEBUG_ROUTING;
ok('the remaining flags are only NEXT_UI and DEBUG_ROUTING', JSON.stringify(Object.keys(FLAGS).sort()) === '["DEBUG_ROUTING","NEXT_UI"]');

// ---------------------------------------------------------------------------
// 4. Routes and controls
// ---------------------------------------------------------------------------

section('No route or control points at the quarantined surface');

const bootSource = stripComments(readFileSync('src/ui/app/boot.js', 'utf8'));
const registered = [...bootSource.matchAll(/path:\s*'(\/[a-z0-9-]*)'/g)].map((m) => m[1]);
ok('the route table is non-empty (14 popup routes)', registered.length === 14, registered.join(', '));
const defiRoutes = registered.filter((p) => /launchpad|dex|prediction|swap|market|token/i.test(p));
ok('no registered route is a launchpad/DEX/prediction surface', defiRoutes.length === 0, defiRoutes.join(', '));

// `chrome.tabs.create({ url: chrome.runtime.getURL('launchpad.html') })` was the dashboard
// control that opened the page. The wallet has exactly one extension page now, so nothing in
// the shipped runtime should be opening another tab at all.
const tabHits = findHits(corpus, /chrome\s*\.\s*(?:tabs|windows)\s*\.\s*(?:create|update|remove)\s*\(/);
ok('the shipped runtime opens no separate extension tab/window', tabHits.length === 0, tabHits.join('\n         '));

// A control pointing at a page that is not built is the same defect as a route pointing at a
// screen that is not registered: it fails only when a user clicks it.
const urlHits = findHits(corpus, /chrome\s*\.\s*runtime\s*\.\s*getURL\s*\(/);
ok('no getURL() call targets a page that is no longer built', urlHits.length === 0, urlHits.join('\n         '));

// ---------------------------------------------------------------------------
// 5. Manifest
// ---------------------------------------------------------------------------

section('Manifest ships one page and advertises no launchpad');

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
const manifestText = JSON.stringify(manifest);

ok('the manifest description does not advertise a launchpad or DEX', !/launchpad|\bdex\b|prediction/i.test(manifest.description), manifest.description);
ok('no manifest key or value references the quarantined surface', !/launchpad|\bdex\b|prediction/i.test(manifestText));
ok('the action popup is popup.html', manifest.action?.default_popup === 'popup.html');
ok('the side panel reuses popup.html with its own non-secret URL marker',
  manifest.side_panel?.default_path === 'popup.html?thru_panel=1');
ok(
  'no web_accessible_resources exposes an extra page',
  !manifest.web_accessible_resources || manifest.web_accessible_resources.length === 0,
  JSON.stringify(manifest.web_accessible_resources ?? []),
);

// ---------------------------------------------------------------------------
// 6. No HTML-injection sink survives anywhere in the shipped runtime
// ---------------------------------------------------------------------------

section('Zero HTML-injection sinks in all of src/ (not just src/ui/)');

const DOM_SINK_RE = /\.(innerHTML|outerHTML)\s*(?:[+\-*/%&|^]|\?\?|\|\||&&)?=(?!=)|insertAdjacentHTML\s*(?:\?\.)?\s*\(|document\s*\??\.\s*write(?:ln)?\s*(?:\?\.)?\s*\(/;
// `${el.innerHTML = value}` executes even inside a nested template. Lower templates and
// canonicalize static bracket properties before masking strings/comments; a literal string
// containing `.innerHTML =` must still not count as code.
async function executableSource(source) {
  const { code } = await transform(source, {
    loader: 'js', target: 'esnext', supported: { 'template-literal': false },
    minifySyntax: true, logLevel: 'silent',
  });
  return stripCommentsAndStrings(code);
}
ok('the source scanner sees executable interpolations and bracket sinks, not literal text',
  DOM_SINK_RE.test(await executableSource('const x = `a ${`b ${el.innerHTML = value}`}`;'))
  && DOM_SINK_RE.test(await executableSource('el["innerHTML"] += value;'))
  && DOM_SINK_RE.test(await executableSource('el.outerHTML ||= value;'))
  && DOM_SINK_RE.test(await executableSource('document?.writeln(value);'))
  && !DOM_SINK_RE.test(await executableSource('const same = el.innerHTML === value;'))
  && !DOM_SINK_RE.test(await executableSource('const x = `.innerHTML =` /* el.innerHTML = */;')));
const sinks = [];
for (const file of SHIPPED_JS) {
  const text = await executableSource(readFileSync(file, 'utf8'));
  text.split('\n').forEach((line, i) => {
    if (DOM_SINK_RE.test(line)) sinks.push(`${file}:${i + 1}  ${line.trim().slice(0, 110)}`);
  });
}
ok(
  `no innerHTML/insertAdjacentHTML/outerHTML/document.write in ${SHIPPED_JS.length} shipped JS files`,
  sinks.length === 0,
  sinks.join('\n         '),
);

// ---------------------------------------------------------------------------
// 7. dist/ proof — build for real, then inspect the artifact
// ---------------------------------------------------------------------------

section('dist/ contains no launchpad code');

const skipBuild = process.env.QUARANTINE_SKIP_BUILD === '1';
// Esbuild emits warnings to stderr, not stdout. Checking stdout alone made the old
// "no CSS/JS warnings" assertion pass even when the build warned about broken CSS.
const hasBuildWarning = ({ stdout = '', stderr = '' }) => /\[WARNING\]/i.test(`${stdout}\n${stderr}`);
ok('the warning detector catches stderr (esbuild) and stdout without matching clean logs',
  hasBuildWarning({ stderr: '▲ [WARNING] broken CSS' })
    && hasBuildWarning({ stdout: '[WARNING] bad JS' })
    && !hasBuildWarning({ stderr: '⚡ Done in 9ms' }));
if (skipBuild) {
  console.log('  note - QUARANTINE_SKIP_BUILD=1: asserting against the existing dist/ instead of rebuilding.');
  ok('dist/ exists to assert against', existsSync('dist'));
} else {
  // Rebuild rather than trust whatever dist/ happens to hold: a stale dist/ from before the
  // quarantine would otherwise be inspected, and the whole point is to prove what the CURRENT
  // source produces. build.mjs wipes dist/ first, so a removed entry point cannot linger.
  const built = spawnSync(process.execPath, ['build.mjs'], { cwd: ROOT, encoding: 'utf8' });
  ok('npm run build succeeds', built.status === 0, `${built.stdout || ''}\n${built.stderr || ''}`.slice(-1200));
  ok('the build reports no CSS/JS warning', !hasBuildWarning(built),
    `${built.stdout || ''}\n${built.stderr || ''}`.slice(-800));
}

if (existsSync('dist')) {
  const distFiles = walk('dist', ['.js', '.css', '.html', '.json', '.png', '.svg', '.woff2']).map(rel);

  const badNames = distFiles.filter((f) => /launchpad|\bdex\b|prediction/i.test(f));
  ok('no dist/ file is named after the quarantined surface', badNames.length === 0, badNames.join(', '));

  const pages = distFiles.filter((f) => f.endsWith('.html'));
  ok('dist/ ships exactly one extension page: popup.html', JSON.stringify(pages) === '["dist/popup.html"]', pages.join(', '));

  const bundles = distFiles.filter((f) => f.endsWith('.js'));
  ok(
    'dist/ ships exactly two bundles: background + popup',
    JSON.stringify(bundles.sort()) === '["dist/background.bundle.js","dist/popup.bundle.js"]',
    bundles.sort().join(', '),
  );

  // Content scan of the artifact itself. Patterns are limited to things OUR code would put
  // there: a third-party SDK bundled into background.bundle.js is allowed to contain the word
  // "index" or its own float parsing, so dist is not held to the src-wide float rule.
  const DIST_MARKERS = [
    { id: 'launchpad reference', re: /launchpad/i },
    { id: 'fabricated bonding-curve rate', re: /23\.5294/ },
    { id: 'simulated trade copy', re: /Execute Swap|Swap simulated|Simulated prediction/i },
    { id: 'prediction-market surface', re: /\bpredictions?\b/i },
    { id: 'HTML-injection sink', re: /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/ },
  ];

  const textFiles = distFiles.filter((f) => /\.(js|css|html|json)$/.test(f));
  const distCorpus = textFiles.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
  for (const marker of DIST_MARKERS) {
    const hits = [];
    for (const { file, text } of distCorpus) {
      if (marker.re.test(text)) hits.push(`${file} (${text.length} bytes)`);
    }
    ok(
      `no ${marker.id} in any of the ${textFiles.length} text files in dist/`,
      hits.length === 0,
      hits.join(', '),
    );
  }

  const distManifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  ok('dist/manifest.json matches src/manifest.json', JSON.stringify(distManifest) === JSON.stringify(manifest));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? 'All' : ''} launchpad quarantine checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(`\n${failures} quarantine check(s) failed.`);
  console.error('The legacy launchpad/DEX/prediction surface must stay out of the shipped extension.');
  console.error('A future launchpad is a new src/features/launchpad/** module, not a revival of this one.');
  process.exit(1);
}
console.log('The legacy launchpad is quarantined: deleted from src/, absent from dist/, unreachable by URL,');
console.log('flag or control. Research docs are retained under docs/.');
