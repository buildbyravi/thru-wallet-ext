// Route and CSS-class reachability checks.
//
// WHY THIS EXISTS
//
// Every UI defect found by manual testing in this project was a reachability or rendering
// problem that the existing suite structurally could not see. The suite verifies that code
// builds, that bridge methods exist, and that h() cannot be exploited. None of it asks:
//
//   - can a user actually GET to this screen?
//   - does this control point at a route that EXISTS?
//   - is every CSS class this code uses actually DEFINED?
//
// Concrete defects this would have caught, each of which shipped:
//   - `/reset` was navigated to from the unlock screen but never registered, so it fell through
//     to a legacy fallback and errored on a blank panel.
//   - a gear button navigated to `/keyring` before that route existed.
//   - four finished routes (accounts, account, add-account, export) had NO click path to them
//     for an entire session, and were pronounced testable.
//   - ~80 usages of CSS classes (.w-100, .mt-*, .tag-accent, .status-dot) that were defined
//     nowhere, so every modular screen rendered with its fields flush together.
//
// This needs no DOM, so it is deterministic and cannot flake.
//
// Run: node scripts/check-routes.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

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

/** Strip comments and string bodies so a comment cannot look like code. */
function stripComments(source) {
  let out = '';
  let i = 0;
  let state = 'code';
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i += 2; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i += 1; continue; }
      out += ' '; i += 1; continue;
    }
    if (c === '*' && n === '/') { state = 'code'; out += '  '; i += 2; continue; }
    out += c === '\n' ? '\n' : ' '; i += 1;
  }
  return out;
}

const errors = [];
const warnings = [];

// ---------------------------------------------------------------------------
// 1. Route reachability
// ---------------------------------------------------------------------------

const bootSource = stripComments(readFileSync('src/ui/app/boot.js', 'utf8'));

const registered = new Set();
for (const m of bootSource.matchAll(/path:\s*'(\/[a-z0-9-]*)'/g)) registered.add(m[1]);

if (registered.size === 0) {
  errors.push('check-routes: found no registered routes in src/ui/app/boot.js — the regex or the route table shape changed.');
}

// Every navigate() target across the new stack.
const uiFiles = [
  ...walk('src/ui/app', ['.js']),
  ...walk('src/ui/domain', ['.js']),
  ...walk('src/features', ['.js']),
];

const navigated = new Map(); // path -> [sites]
for (const file of uiFiles) {
  const source = stripComments(readFileSync(file, 'utf8'));
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    // navigate('/x'), navigate(`/x?...`), and location.hash = '#/x'
    for (const m of line.matchAll(/navigate\(\s*[`'"](\/[a-z0-9-]*)/g)) {
      if (!navigated.has(m[1])) navigated.set(m[1], []);
      navigated.get(m[1]).push(`${rel(file)}:${i + 1}`);
    }
    for (const m of line.matchAll(/hash\s*=\s*[`'"]#(\/[a-z0-9-]*)/g)) {
      if (!navigated.has(m[1])) navigated.set(m[1], []);
      navigated.get(m[1]).push(`${rel(file)}:${i + 1}`);
    }
  });
}

// The legacy bridge intentionally routes some paths back to the old stack while the migration
// is in progress. Those are declared in popup.js and are NOT expected to be registered routes.
const legacySource = stripComments(readFileSync('src/popup/popup.js', 'utf8'));
const legacyFallbackPaths = new Set();
for (const m of legacySource.matchAll(/'go-[a-z-]+':\s*'(\/[a-z0-9-]*)'/g)) {
  legacyFallbackPaths.add(m[1]);
}
// Paths that deliberately fall through to the legacy stack until they migrate.
const UNMIGRATED_OK = new Set(['/receive', '/faucet', '/history', '/welcome']);

for (const [path, sites] of navigated) {
  if (registered.has(path)) continue;
  if (UNMIGRATED_OK.has(path)) {
    warnings.push(`'${path}' is not migrated yet; falls through to the legacy stack. Used at: ${sites[0]}`);
    continue;
  }
  errors.push(
    `NAVIGATES TO AN UNREGISTERED ROUTE: '${path}'\n`
    + `      used at: ${sites.join(', ')}\n`
    + `      Either register it in src/ui/app/boot.js or add it to UNMIGRATED_OK here.\n`
    + '      A control pointing at a non-existent route falls through to the legacy fallback and errors.',
  );
}

// A registered route nobody can reach is the other half of the same bug.
const ENTRY_ROUTES = new Set(['/unlock', '/dashboard', '/welcome']);
for (const path of registered) {
  if (ENTRY_ROUTES.has(path)) continue;
  if (!navigated.has(path)) {
    errors.push(
      `UNREACHABLE ROUTE: '${path}' is registered but nothing navigates to it.\n`
      + '      A finished screen with no click path is invisible to users. Add a control, or\n'
      + '      remove the route.',
    );
  }
}

// ---------------------------------------------------------------------------
// 2. CSS classes used but never defined
// ---------------------------------------------------------------------------

const cssFiles = walk('src/popup/styles', ['.css']);
const defined = new Set();
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][-\w]*)/g)) defined.add(m[1]);
}

// Classes referenced from the new stack only. The legacy tree is scheduled for deletion and
// already known to reference undefined classes; failing on it would block every commit.
const used = new Map(); // class -> [sites]
const NEW_STACK = [...walk('src/ui/kit', ['.js']), ...walk('src/ui/app', ['.js']), ...walk('src/ui/domain', ['.js'])];

for (const file of NEW_STACK) {
  const source = stripComments(readFileSync(file, 'utf8'));
  source.split('\n').forEach((line, i) => {
    const record = (name) => {
      if (!name || /[${}]/.test(name)) return; // skip interpolated/dynamic
      if (!used.has(name)) used.set(name, []);
      used.get(name).push(`${rel(file)}:${i + 1}`);
    };

    // Strings used in a COMPARISON are values, not class names. Without this,
    // `class: [..., current.size !== 'md' ? current.size : null]` reports a phantom `.md`.
    // A false positive here is worse than a missed one: it trains people to ignore the check.
    const cleaned = line
      .replace(/[!=]==?\s*'[^']*'/g, ' ')
      .replace(/[!=]==?\s*"[^"]*"/g, ' ');

    // class: 'a b' | class: "a b"
    for (const m of cleaned.matchAll(/class:\s*'([^'${}]+)'/g)) m[1].split(/\s+/).forEach(record);
    for (const m of cleaned.matchAll(/class:\s*"([^"${}]+)"/g)) m[1].split(/\s+/).forEach(record);
    // class: ['a', 'b', cond ? 'c' : null]
    for (const m of cleaned.matchAll(/class:\s*\[([^\]]+)\]/g)) {
      for (const s of m[1].matchAll(/'([^'${}]+)'/g)) s[1].split(/\s+/).forEach(record);
    }
    // classList.add('a') / .remove / .toggle
    for (const m of cleaned.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^'${}]+)'/g)) {
      m[1].split(/\s+/).forEach(record);
    }
  });
}

// Utility classes are matched by prefix in CSS via things like [class*=] in some setups; here
// everything is a literal selector, so a plain set lookup is correct.
const undefinedClasses = [...used.keys()].filter((c) => !defined.has(c)).sort();
for (const c of undefinedClasses) {
  errors.push(
    `CSS CLASS NEVER DEFINED: .${c}\n`
    + `      used at: ${used.get(c).slice(0, 3).join(', ')}${used.get(c).length > 3 ? ` (+${used.get(c).length - 3} more)` : ''}\n`
    + '      Define it in src/popup/styles/** or remove the usage. An undefined class silently\n'
    + '      renders nothing, which is how ~80 usages shipped with no spacing at all.',
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`Routes registered: ${registered.size} (${[...registered].sort().join(', ')})`);
console.log(`Routes navigated to: ${navigated.size}`);
console.log(`CSS classes used by the new stack: ${used.size}, all defined: ${undefinedClasses.length === 0}`);

if (warnings.length) {
  console.log('');
  for (const w of warnings) console.log(`  note - ${w}`);
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n`);
  for (const e of errors) console.error(`  FAIL - ${e}\n`);
  process.exit(1);
}

console.log('\nEvery navigated route exists, every registered route is reachable, and every CSS');
console.log('class the new stack uses is defined.');
