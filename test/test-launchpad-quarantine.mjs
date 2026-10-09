// Launchpad quarantine checks — the legacy launchpad/DEX/prediction surface must stay out of
// the shipped extension. REWRITTEN for the M0 DeFi contract drop (2026-10-05, docs/defi/):
//
//   BEFORE M0 this file asserted "no code with dex/launchpad vocabulary may exist anywhere in
//   the shipped runtime". That was right when DeFi meant exactly one fake page.
//
//   FROM M0 the repository intentionally contains a DeFi BACKEND surface (contract v17/v18
//   methods, feature backends under src/background/features/**, capability snapshot, fixtures)
//   shipping in dist/background.bundle.js — gated off by build-time flags. A file-name ban on
//   "dex" would now forbid exactly the structure docs/MODULE_BOUNDARIES.md requires. So the
//   invariant moved from "no dex strings" to the B16 statement:
//
//     1. DeFi code exists only in designated feature/backend locations (allowlist).
//     2. Every DeFi route is unreachable while its flag is off (flags + live probes).
//     3. No flag has a URL or storage override.
//     4. dist/ contains no fixture, mock, or gallery content.
//
//   AND EVERYTHING THAT STILL PROTECTS IS KEPT:
//     - the legacy tree (src/launchpad/**, src/popup/icons.js, src/popup/toast.js) stays deleted;
//     - no FEATURE_LAUNCHPAD, no ?launchpad=1, no launchpad.html anywhere, including dist/;
//     - no fabricated DeFi math (23.5294, tokenRate, float money) or fake trade copy;
//     - zero HTML-injection sinks; the popup bundle + pages carry no DeFi surface at all.
//
// Restoring the legacy surface still fails this file at multiple checks. Weakening an
// assertion here to make something pass is exactly the failure mode this file exists to catch.
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
// Scanning helpers (unchanged semantics: comments stripped, strings kept)
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

    if (c === '\\') { out += source[i + 1] ?? ''; i += 2; continue; }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code';
    }
    out += c; i += 1;
  }

  return out;
}

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
      state = 'code';
    }
    out += c === '\n' ? '\n' : ' '; i += 1;
  }

  return out;
}

function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

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
// 1. The legacy tree is deleted (kept from the pre-M0 file, verbatim)
// ---------------------------------------------------------------------------

section('Legacy launchpad tree is deleted, not flagged off');

const DELETED = [
  'src/launchpad',
  'src/launchpad/launchpad.js',
  'src/launchpad/launchpad.html',
  'src/launchpad/launchpad.css',
  'src/popup/icons.js',
  'src/popup/toast.js',
];
for (const path of DELETED) {
  ok(`${path} does not exist`, !existsSync(path));
}

// M0 change: DeFi vocabulary in FILE NAMES is now allowed — but only under the designated
// backend feature locations. Everything else named after the surface is still a violation.
const DEFI_FILE_ALLOWLIST = /^src\/background\/(features\/|services\/(defi\/|(program|feed|market|risk|intent|desktop)-service\.js$))/;
const resurrected = [...SHIPPED_JS, ...SHIPPED_CSS, ...SHIPPED_HTML]
  .filter((f) => /launchpad|\bdex\b|prediction/i.test(f))
  .filter((f) => !DEFI_FILE_ALLOWLIST.test(f));
ok(
  'no shipped source file is named after the surface outside src/background/features|services/defi',
  resurrected.length === 0,
  resurrected.join(', '),
);

// DeFi names must not show up in UI-facing trees at all (screens arrive with their flags).
const uiDefi = [...SHIPPED_JS, ...SHIPPED_CSS, ...SHIPPED_HTML]
  .filter((f) => /^src\/(ui|popup|desktop)\//.test(f))
  .filter((f) => /launchpad|\bdex\b|prediction/i.test(f));
ok('no UI-tree file is named after the DeFi surface', uiDefi.length === 0, uiDefi.join(', '));

// ---------------------------------------------------------------------------
// 2. Legacy markers stay banned; DeFi vocabulary stays in the backend allowlist
// ---------------------------------------------------------------------------

section('No shipped source references the legacy quarantined surface');

const SURFACE_MARKERS = [
  { id: 'launchpad page/bundle reference', re: /launchpad\.(html|css|bundle\.js)|['"`]launchpad['"`]|getURL\(\s*['"]launchpad/i },
  { id: 'launchpad feature flag', re: /FEATURE_LAUNCHPAD|FEATURE_TOKEN_DEPLOY/ },
  { id: 'launchpad query override', re: /\?launchpad=1|params\.get\(\s*['"]launchpad['"]\s*\)/ },
  { id: 'launchpad banner control', re: /launchpad-banner/i },
  { id: 'dex/prediction hash route', re: /#\s*\/\s*(dex|swap|predictions?|launchpad|my-tokens)\b/i },
  { id: 'dex/prediction tab or action', re: /data-(?:tab|route|action)=["']?(?:dex|predictions?|launchpad|bet-market)\b/i },
];

// The detectors must still fire, so "no hits" below is never a vacuous pass.
ok('the legacy detectors still fire on synthetic legacy references',
  /launchpad\.html/.test("getURL('launchpad.html')")
    && /FEATURE_LAUNCHPAD/.test('const x = FEATURE_LAUNCHPAD;')
    && /\?launchpad=1/.test('open popup.html?launchpad=1')
    && /#\s*\/\s*dex\b/i.test("location.hash = '#/dex'")
    && /data-tab=["']?dex\b/i.test('<a data-tab="dex">Trade</a>'));

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
  // Hard-coded quote rate from the fake legacy DEX tab. `bondingCurve` as an identifier is
  // banned here; the concept is discussed in comments/docs (comments are stripped for this scan).
  { id: 'hard-coded bond-curve rate', re: /23\.5294|tokenRate\b|bondingCurve/i },
  // Money is BigInt only (AGENTS.md #6). Nothing in the shipped runtime may parse a float.
  { id: 'float money math', re: /parseFloat\s*\(/ },
  { id: 'simulated trade copy', re: /Execute Swap|Swap simulated|Simulated prediction|Executing on-chain/i },
];

for (const marker of FAKE_DEFI_MARKERS) {
  const hits = findHits(corpus, marker.re);
  ok(
    `no ${marker.id} in src/, build.mjs or the manifest`,
    hits.length === 0,
    hits.join('\n         '),
  );
}

section('DeFi vocabulary is confined to the backend contract surface');

// dex/launchpad/amm/prediction words are expected in the M0 backend (method names, the
// capability matrix, feature services). They must appear NOWHERE else in the shipped runtime:
// not in UI code, not in build.mjs, not in src/manifest.json, not in shared UI-facing helpers.
const DEFI_VOCAB_ALLOWLIST = /^src\/(background\/(features\/|api-router\.js$|services\/(defi\/|(program|feed|market|risk|intent|desktop)-service\.js$))|shared\/contract\/)/;
const vocabHits = [];
for (const { file, text } of corpus) {
  if (DEFI_VOCAB_ALLOWLIST.test(file)) continue;
  text.split('\n').forEach((line, i) => {
    if (/\bdex\b|\bamm\b|\bpredictions?\b|\blaunchpad\b|\bswapMode\b/i.test(line)) {
      vocabHits.push(`${file}:${i + 1}  ${line.trim().slice(0, 110)}`);
    }
  });
}
ok(
  'dex/launchpad/amm/prediction vocabulary exists only under src/background/features, src/background/services/(defi|*-service) and src/shared/contract',
  vocabHits.length === 0,
  vocabHits.join('\n         '),
);

// ---------------------------------------------------------------------------
// 3. Flags: no override path exists for any product flag
// ---------------------------------------------------------------------------

section('Feature flags cannot re-enable the surface');

const { FLAGS, isEnabled, isDefiFeatureEnabled, applyQueryOverrides } = await import('../src/shared/flags.js');

ok('FLAGS has no FEATURE_LAUNCHPAD key', !('FEATURE_LAUNCHPAD' in FLAGS));
ok('FLAGS has no FEATURE_TOKEN_DEPLOY key', !('FEATURE_TOKEN_DEPLOY' in FLAGS));
ok('isEnabled() reports the retired flag as disabled', isEnabled('FEATURE_LAUNCHPAD') === false);

const EXPECTED_FLAGS = ['DEBUG_ROUTING', 'NAME_SERVICE', 'DEFI', 'DEFI_READ', 'DEFI_DEX', 'DEFI_LAUNCHPAD', 'DEFI_MARKET', 'DEFI_RISK', 'DEFI_INTENT', 'DEFI_FEED', 'DEFI_DESKTOP'];
ok(
  'the flag set is exactly: routing diagnostics + the M0 DeFi gates',
  JSON.stringify(Object.keys(FLAGS)) === JSON.stringify(EXPECTED_FLAGS),
  JSON.stringify(Object.keys(FLAGS)),
);

const DEFI_FLAG_NAMES = EXPECTED_FLAGS.filter((f) => f.startsWith('DEFI'));
ok(
  'every DEFI_*/NAME_SERVICE gate flag is false in this build',
  [...DEFI_FLAG_NAMES, 'NAME_SERVICE'].every((f) => FLAGS[f] === false),
  JSON.stringify(Object.fromEntries(DEFI_FLAG_NAMES.map((f) => [f, FLAGS[f]]))),
);

// The master switch must dominate: a lone sub-flag can never enable a feature.
FLAGS.DEFI_READ = true;
ok('a sub-flag alone enables nothing (master switch dominates)', isDefiFeatureEnabled('DEFI_READ') === false);
FLAGS.DEFI_READ = false;

const before = { ...FLAGS };
applyQueryOverrides('?launchpad=1');
ok(
  '`?launchpad=1` changes nothing',
  JSON.stringify(FLAGS) === JSON.stringify(before),
  `before ${JSON.stringify(before)} after ${JSON.stringify(FLAGS)}`,
);

applyQueryOverrides('?launchpad=1&dex=1&predictions=1&token-deploy=1&defi=1&defi-read=1&defi-dex=1&defi-launchpad=1');
ok(
  'no retired-surface or DeFi query parameter is honoured',
  JSON.stringify(FLAGS) === JSON.stringify(before),
  `flags after override: ${JSON.stringify(FLAGS)}`,
);

// The function itself must still work, or "changes nothing" would be a vacuous pass.
applyQueryOverrides('?debug=1');
ok('the supported diagnostics override still works, so the checks above are not vacuous', FLAGS.DEBUG_ROUTING === true);
FLAGS.DEBUG_ROUTING = before.DEBUG_ROUTING;

// No persistent override path: the flags module must not read storage of any kind.
{
  const flagsSource = stripComments(readFileSync('src/shared/flags.js', 'utf8'));
  const persistanceHits = flagsSource.split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /chrome\s*\.\s*storage|localStorage|sessionStorage/.test(line))
    .map(({ line, i }) => `src/shared/flags.js:${i + 1}  ${line.trim().slice(0, 110)}`);
  ok('src/shared/flags.js contains no storage access (no persistent flag override path)',
    persistanceHits.length === 0, persistanceHits.join('\n         '));
}

// ---------------------------------------------------------------------------
// 4. Routes and controls
// ---------------------------------------------------------------------------

section('No route or control points at the DeFi surface');

const bootSource = stripComments(readFileSync('src/ui/app/boot.js', 'utf8'));
const registered = [...bootSource.matchAll(/path:\s*'(\/[a-z0-9-]*)'/g)].map((m) => m[1]);
// M0 adds NO DeFi routes: DeFi screens ship with their flags in later gates, not before.
// 2026-10-09: deliberate addition — '/name' (Domain) is a WALLET-identity screen behind the
// always-on name.* READ surface (ownership verified on-chain, nothing signs, nothing gated),
// not a DeFi surface. The meaningful invariant stays: no launchpad/DEX/market/swap/token
// route may register.
ok('the route table is unchanged (15 popup routes, no DeFi routes)', registered.length === 15, registered.join(', '));
const defiRoutes = registered.filter((p) => /launchpad|dex|prediction|swap|market|token/i.test(p));
ok('no registered route is a launchpad/DEX/prediction surface', defiRoutes.length === 0, defiRoutes.join(', '));

const tabHits = findHits(corpus, /chrome\s*\.\s*(?:tabs|windows)\s*\.\s*(?:create|update|remove)\s*\(/);
ok('the shipped runtime opens no separate extension tab/window', tabHits.length === 0, tabHits.join('\n         '));

const urlHits = findHits(corpus, /chrome\s*\.\s*runtime\s*\.\s*getURL\s*\(/);
ok('no getURL() call targets a page that is not built', urlHits.length === 0, urlHits.join('\n         '));

// ---------------------------------------------------------------------------
// 4b. Live gating probes: gated DeFi methods refuse IN THIS BUILD
// ---------------------------------------------------------------------------

section('DeFi handlers provably refuse while every DEFI_* flag is off');

// chrome stubs let the background module graph load; only handler dispatch is exercised.
globalThis.chrome = {
  runtime: { id: 'test', onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  storage: {
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
  },
};
const { handleApiRequest } = await import('../src/background/api-router.js');

// env:'result' reads (auth none): the gate answer is a real wire value, not an error.
const quote = await handleApiRequest({
  method: 'dex.quote',
  params: { poolId: 'taPoolFixture1', inputAssetId: 'native', outputAssetId: 'taAssetFixture1', inputAmountUnits: '1' },
});
ok('dex.quote answers { supported:false, reason:FLAG_OFF } in data',
  quote.ok === true && quote.data?.supported === false && quote.data?.reason === 'FLAG_OFF',
  JSON.stringify(quote));

const candles = await handleApiRequest({
  method: 'market.candles',
  params: { assetId: 'native', interval: '15m' },
});
ok('market.candles answers { supported:false, reason:FLAG_OFF } in data',
  candles.ok === true && candles.data?.supported === false && candles.data?.reason === 'FLAG_OFF',
  JSON.stringify(candles));

const desktop = await handleApiRequest({ method: 'desktop.open', params: { page: 'markets' } });
ok('desktop.open answers { enabled:false, reason:FLAG_OFF } in data',
  desktop.ok === true && desktop.data?.enabled === false && desktop.data?.reason === 'FLAG_OFF',
  JSON.stringify(desktop));

// env:'error' reads require unlock first: in this stubbed environment the wallet is locked, so
// the honest answer is WALLET_LOCKED — proving a locked wallet cannot even reach the gate.
const intentGet = await handleApiRequest({ method: 'intent.get', params: { intentId: 'in_fixture1' } });
ok('intent.get is refused (WALLET_LOCKED) before any pipeline code could run',
  intentGet.ok === false && intentGet.error?.code === 'WALLET_LOCKED', JSON.stringify(intentGet));

const submit = await handleApiRequest({
  method: 'intent.submit',
  params: { intentId: 'in_fixture1', bindingHash: 'bh_fixture' },
});
ok('intent.submit is refused (WALLET_LOCKED) — the only DeFi signing path stayed closed',
  submit.ok === false && submit.error?.code === 'WALLET_LOCKED', JSON.stringify(submit));

// Schema validation runs BEFORE auth: a malformed request fails as INVALID_INPUT even from a
// locked wallet, so no service is ever touched by garbage input.
const badQuote = await handleApiRequest({
  method: 'dex.quote',
  params: { poolId: 'taPoolFixture1', inputAssetId: 'native', outputAssetId: 'taAssetFixture1', inputAmountUnits: '12.5' },
});
ok('dex.quote rejects a float amount with INVALID_INPUT at the seam',
  badQuote.ok === false && badQuote.error?.code === 'INVALID_INPUT', JSON.stringify(badQuote));

const badUpload = await handleApiRequest({
  method: 'launchpad.uploadImage',
  params: { address: 'taUserFixture1', networkId: 'betanet', payload: { bytesBase64: 'AAAA', mime: 'text/html' } },
});
ok('launchpad.uploadImage rejects a non-image payload with INVALID_INPUT before auth',
  badUpload.ok === false && badUpload.error?.code === 'INVALID_INPUT', JSON.stringify(badUpload));

// ---------------------------------------------------------------------------
// 5. Extension manifest (kept unchanged)
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

section('dist/ contains no legacy surface and no fixture content');

const skipBuild = process.env.QUARANTINE_SKIP_BUILD === '1';
const hasBuildWarning = ({ stdout = '', stderr = '' }) => /\[WARNING\]/i.test(`${stdout}\n${stderr}`);
ok('the warning detector catches stderr (esbuild) and stdout without matching clean logs',
  hasBuildWarning({ stderr: '▲ [WARNING] broken CSS' })
    && hasBuildWarning({ stdout: '[WARNING] bad JS' })
    && !hasBuildWarning({ stderr: '⚡ Done in 9ms' }));
if (skipBuild) {
  console.log('  note - QUARANTINE_SKIP_BUILD=1: asserting against the existing dist/ instead of rebuilding.');
  ok('dist/ exists to assert against', existsSync('dist'));
} else {
  // Rebuild rather than trust whatever dist/ happens to hold: build.mjs wipes dist/ first, so a
  // removed entry point cannot linger.
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

  // Bans that apply to EVERY text artifact. background.bundle.js legitimately contains
  // dex.*/launchpad.* METHOD NAMES (the gated M0 contract surface) — that is pre-approved
  // backend vocabulary, not the page. What must never appear in any artifact:
  const DIST_MARKERS = [
    { id: 'legacy launchpad page reference', re: /launchpad\.html|\?launchpad=1|launchpad-banner/i },
    { id: 'legacy launchpad flag', re: /FEATURE_LAUNCHPAD|FEATURE_TOKEN_DEPLOY/ },
    { id: 'fabricated bond-curve rate', re: /23\.5294/ },
    { id: 'simulated trade copy', re: /Execute Swap|Swap simulated|Simulated prediction/i },
    { id: 'prediction-market surface', re: /\bpredictions?\b/i },
    { id: 'HTML-injection sink', re: /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/ },
    // B16-4: no fixture/mock/gallery content may ship. The fixture corpus marks itself with
    // __defiFixtureVersion; any leak into dist means the test tree escaped into the bundle.
    { id: 'fixture, mock or gallery content', re: /__defiFixtureVersion|mock-bridge|test-fixture/i },
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

  // UI-facing artifacts must carry no DeFi SURFACE: the popup bundle legitimately embeds the
  // shared contract manifest via src/ui/app/bridge.js (it always has — that is how the bridge
  // validates method names), so contract method-name vocabulary is expected there; what must
  // not appear anywhere UI-side is prediction vocabulary (never in the contract) or any
  // launchpad/prediction word in the page/CSS/manifest artifacts themselves.
  {
    const popupBundle = readFileSync('dist/popup.bundle.js', 'utf8');
    ok('dist/popup.bundle.js contains no prediction vocabulary and no legacy page artifacts',
      !/\bpredictions?\b/i.test(popupBundle) && !/launchpad\.html|\?launchpad=1/i.test(popupBundle),
      `${popupBundle.length} bytes scanned`);
    // Non-vacuous guard: the bridge really does embed the contract names, so this file would
    // catch the removal of the approval this comment records.
    ok('dist/popup.bundle.js embeds the shared contract (bridge design, pre-approved)',
      /launchpad\.listMine/.test(popupBundle) && /dex\.quote/.test(popupBundle),
      'contract method names not found — bridge.js no longer embeds the manifest?');
  }
  const UI_ARTIFACTS = ['dist/popup.html', 'dist/popup.css', 'dist/manifest.json'];
  for (const file of UI_ARTIFACTS) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    ok(
      `${file} contains no launchpad/prediction vocabulary`,
      !/launchpad|\bpredictions?\b/i.test(text),
      `${text.length} bytes scanned`,
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
  console.error('The M0 DeFi backend surface ships gated off: flags false, allowlisted locations,');
  console.error('probed refusals, no fixtures in dist/. Weakening any of that on purpose is a');
  console.error('reviewed, deliberate change to this file — never a silent edit.');
  process.exit(1);
}
console.log('The legacy launchpad stays quarantined: deleted from src/, absent from dist/, unreachable by');
console.log('URL, flag or control. The M0 DeFi contract surface ships in the background bundle with every');
console.log('flag off, refused by live probes, and no fixture or mock content in any artifact.');
