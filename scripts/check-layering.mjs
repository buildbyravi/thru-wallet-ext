// Layering check — fails the build when an import crosses an architectural boundary.
//
// These rules are the mechanism behind "the backend never breaks because of the frontend".
// Stated as prose in AGENTS.md they decay; stated here they are enforced on every test run.
//
// Run: node scripts/check-layering.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** Collect every JS file under a directory. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'vendor' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

/** Normalize a path to forward-slash relative form for stable matching and output. */
function rel(file) {
  return relative(ROOT, file).split(sep).join('/');
}

/** Extract import/export-from specifiers and dynamic import() targets. */
function importsOf(source) {
  const specifiers = [];
  const staticRe = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
  const bareRe = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [staticRe, bareRe, dynamicRe]) {
    let m;
    while ((m = re.exec(source)) !== null) specifiers.push(m[1]);
  }
  return specifiers;
}

const RULES = [
  {
    id: 'background-must-not-import-ui',
    when: (f) => f.startsWith('src/background/'),
    forbid: (spec) => /(^|\/)(ui|popup|desktop)\//.test(spec),
    why: 'The background must never depend on a UI layer. It has to keep working if the frontend is replaced wholesale.',
  },
  {
    id: 'ui-must-not-import-background-or-vault',
    when: (f) => f.startsWith('src/ui/') || f.startsWith('src/popup/') || f.startsWith('src/desktop/') || f.startsWith('src/features/'),
    forbid: (spec) => /(^|\/)background\//.test(spec) || /lib\/vault(\.js)?$/.test(spec) || /lib\/thru-client(\.js)?$/.test(spec),
    why: 'The UI reaches the backend only through bridge.send(). Importing vault.js or a service would pull key material into the popup bundle.',
  },
  {
    id: 'kit-must-stay-domain-free',
    when: (f) => f.startsWith('src/ui/kit/'),
    forbid: (spec) => /bridge/.test(spec) || /(^|\/)features\//.test(spec) || /(^|\/)domain\//.test(spec),
    why: 'ui/kit primitives must be reusable with no knowledge of wallets, the bridge, or any feature.',
  },
  {
    id: 'shared-must-stay-portable',
    when: (f) => f.startsWith('src/shared/'),
    forbid: (spec) => /(^|\/)(ui|popup|desktop|background|features)\//.test(spec) || /lib\/vault(\.js)?$/.test(spec),
    why: 'src/shared is imported by both sides, so it must not reach into either.',
  },
];

// chrome.runtime.sendMessage is a two-way street and each direction gets exactly ONE owner:
//
//   UI -> background : src/ui/bridge.js only. Keeps the callable API surface in one auditable
//                      place instead of scattered across screens.
//   background -> UI : src/background/services/event-service.js only. Keeps every push event
//                      declared in the contract's EVENTS map and swallows "no receiver"
//                      rejections in one spot.
//
// index.js is NOT on this list on purpose: the worker entry point should emit through the
// event service like everything else.
const SEND_MESSAGE_ALLOWLIST = new Set([
  'src/ui/app/bridge.js',
  'src/background/services/event-service.js',
]);

const violations = [];
const files = walk(SRC);

// Comment/string-stripped source, computed once per file and reused by every check.
// Stripping was originally applied only to the DOM-sink scan, so a comment EXPLAINING a
// rule still tripped that rule — network-service.js documenting why BigInt breaks
// chrome.runtime.sendMessage was reported as calling it. Any check that looks for code
// must look at code.
const stripped = new Map();
for (const file of files) {
  stripped.set(rel(file), stripCommentsAndStrings(readFileSync(file, 'utf8')));
}

for (const file of files) {
  const f = rel(file);
  const source = stripped.get(f);

  for (const spec of importsOf(source)) {
    if (!spec.startsWith('.') && !spec.startsWith('src/')) continue; // package import
    for (const rule of RULES) {
      if (rule.when(f) && rule.forbid(spec)) {
        violations.push({ rule: rule.id, file: f, detail: `imports '${spec}'`, why: rule.why });
      }
    }
  }

  if (/chrome\s*\.\s*runtime\s*\.\s*sendMessage/.test(source) && !SEND_MESSAGE_ALLOWLIST.has(f)) {
    violations.push({
      rule: 'single-seam',
      file: f,
      detail: 'calls chrome.runtime.sendMessage directly',
      why: 'Only the bridge may talk to the service worker, so the API surface stays auditable in one place.',
    });
  }
}

/**
 * Strip comments and string literals before scanning for code patterns.
 *
 * Without this, a comment explaining WHY innerHTML is banned counts as a use of it, and
 * the file that documents the rule fails the rule. Replacing with equal-length runs of
 * spaces keeps line and column numbers accurate for reporting.
 *
 * This is a scanner, not a parser: it tracks quotes, template literals and comments well
 * enough for these checks, and does not attempt to handle nested template expressions.
 */
function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  let state = 'code'; // code | line | block | single | double | template

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

    // Inside a string or template literal.
    if (c === '\\') { out += '  '; i += 2; continue; }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code'; out += ' '; i += 1; continue;
    }
    out += c === '\n' ? '\n' : ' '; i += 1;
  }

  return out;
}

// DOM-injection gate, implemented as a RATCHET.
//
// The legacy components under src/ui/components/ still build markup by interpolating into
// innerHTML. They are scheduled for replacement phase by phase, so a hard zero would block
// every commit until the whole rebuild lands. Instead the known sinks are baselined per
// file and the count may only ever go down:
//
//   - a file not listed here may have ZERO sinks
//   - a listed file may not exceed its budget
//   - a listed file below its budget FAILS TOO, so fixing a sink forces the budget down
//     and the list can never rot into a permanent exemption
//
// Target: every entry reaches 0 and this map becomes empty.
// EMPTY. The legacy components that owned all 8 sinks are deleted, so the ratchet is closed:
// any innerHTML/insertAdjacentHTML/outerHTML under src/ui or src/features now fails the build
// outright. Do not add entries back - the whole point of the ratchet was to reach this state.
const DOM_SINK_BASELINE = {};

const DOM_SINK_DIRS = ['src/ui/', 'src/features/'];
const DOM_SINK_RE = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\s*\.\s*write\s*\(/;

const sinksByFile = new Map();
for (const file of files) {
  const f = rel(file);
  if (!DOM_SINK_DIRS.some((d) => f.startsWith(d))) continue;
  const source = stripped.get(f);
  const hits = [];
  source.split('\n').forEach((line, i) => {
    if (DOM_SINK_RE.test(line)) hits.push(`${f}:${i + 1}`);
  });
  if (hits.length) sinksByFile.set(f, hits);
}

const newSinks = [];
const overBudget = [];
const improved = [];

for (const [f, hits] of sinksByFile) {
  const budget = DOM_SINK_BASELINE[f];
  if (budget === undefined) {
    newSinks.push(...hits);
  } else if (hits.length > budget) {
    overBudget.push(`${f} — ${hits.length} sinks, budget ${budget}\n          ${hits.join('\n          ')}`);
  }
}
for (const [f, budget] of Object.entries(DOM_SINK_BASELINE)) {
  const actual = sinksByFile.get(f)?.length ?? 0;
  if (actual < budget) {
    improved.push(`${f} — now ${actual}, baseline still says ${budget}. Lower it to ${actual}.`);
  }
}

let failed = false;

if (violations.length) {
  failed = true;
  console.error(`\nLayering violations (${violations.length}):\n`);
  const byRule = new Map();
  for (const v of violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }
  for (const [ruleId, list] of byRule) {
    console.error(`  [${ruleId}] ${list[0].why}`);
    for (const v of list) console.error(`      ${v.file} — ${v.detail}`);
    console.error('');
  }
}

if (newSinks.length) {
  failed = true;
  console.error(`HTML-injection sinks in files with no baseline (${newSinks.length}):\n`);
  for (const s of newSinks) console.error(`      ${s}`);
  console.error('\n  Build nodes with ui/kit/dom.js h() and set text with textContent.\n');
}

if (overBudget.length) {
  failed = true;
  console.error(`HTML-injection sinks above their baseline budget (${overBudget.length} file(s)):\n`);
  for (const s of overBudget) console.error(`      ${s}\n`);
  console.error('  The baseline may only shrink. Do not raise it.\n');
}

if (improved.length) {
  failed = true;
  console.error(`Baseline is stale — sinks were removed but DOM_SINK_BASELINE was not updated:\n`);
  for (const s of improved) console.error(`      ${s}`);
  console.error('\n  Lower the budget in scripts/check-layering.mjs so the ratchet holds.\n');
}

if (failed) {
  process.exit(1);
}

const remaining = [...sinksByFile.values()].reduce((n, hits) => n + hits.length, 0);
console.log(`Layering OK — ${files.length} files checked, ${RULES.length} rules, 0 violations.`);
console.log(
  remaining === 0
    ? 'DOM sinks: 0. The injection ratchet is fully closed.'
    : `DOM sinks: ${remaining} remaining in ${sinksByFile.size} legacy file(s), all within baseline.`,
);
