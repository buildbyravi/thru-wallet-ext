// Import-cycle check — a RATCHET, because one cycle is known and fixing it is a separate change.
//
// The 2026-10-31 review measured the graph and found exactly one cycle, across the five core
// transaction services:
//
//   tx-service ↔ pending-tx-service ↔ history-service ↔ token-service ↔ name-service
//
// Two of those edges are `await import(...)` inside a function, which is why reading the files
// did not surface it. A cycle is not a style question here: those services hold signing, pending
// state and history, and a cycle means one of them can be loaded half-initialised, so the fix
// can change startup order. It is therefore a known, allowed cycle that may only SHRINK — and
// nothing may be added to the list.
//
// Run: node scripts/check-cycles.mjs

import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// The only cycle allowed to exist. A key is a sorted set of file paths; it must match a detected
// cycle EXACTLY (same members, no more, no fewer) and the entry must be deleted as soon as the
// cycle is broken — a stale exemption is how a ratchet rots.
const ALLOWED_CYCLES = [
  [
    'src/background/services/history-service.js',
    'src/background/services/name-service.js',
    'src/background/services/pending-tx-service.js',
    'src/background/services/token-service.js',
    'src/background/services/tx-service.js',
  ],
];

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

const rel = (file) => relative(ROOT, file).split('\\').join('/');

/**
 * Tarjan's strongly-connected components over a Map<file, file[]>.
 *
 * Returns the cycles: components with more than one member, plus any self-loop. Pure, so the
 * negative controls below can run it on synthetic graphs.
 */
function findCycles(graph) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const cycles = [];

  function connect(node) {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) || []) {
      if (!graph.has(next)) continue;
      if (!index.has(next)) {
        connect(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      const selfLoop = component.length === 1 && (graph.get(node) || []).includes(node);
      if (component.length > 1 || selfLoop) cycles.push(component.sort());
    }
  }

  for (const node of graph.keys()) if (!index.has(node)) connect(node);
  return cycles;
}

/**
 * Compare detected cycles against the allowed list, in BOTH directions:
 *   - a cycle that is not allowed fails the build;
 *   - an allowed cycle that no longer exists also fails, so the list can only shrink.
 */
function ratchet(cycles, allowed) {
  const key = (list) => list.join('|');
  const allowedKeys = new Set(allowed.map(key));
  const foundKeys = new Set(cycles.map(key));
  const problems = [];
  for (const cycle of cycles) {
    if (!allowedKeys.has(key(cycle))) {
      problems.push({ kind: 'new-cycle', detail: cycle.join(' ↔ ') });
    }
  }
  for (const cycle of allowed) {
    if (!foundKeys.has(key(cycle))) {
      problems.push({
        kind: 'stale-exemption',
        detail: `${cycle.join(' ↔ ')} — this cycle is gone; delete its entry from ALLOWED_CYCLES`,
      });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The real graph. esbuild parses every file, so a specifier inside a comment or a string is not an
// edge, and `import()` is (it is one of the two edges that hid this cycle from a reading).
// ---------------------------------------------------------------------------------------------
const files = walk(SRC).map(rel).sort();
if (files.length === 0) throw new Error('No source files found; refusing a vacuous pass.');

const analyzed = await build({
  entryPoints: files.map((file) => join(ROOT, file)),
  bundle: true,
  write: false,
  metafile: true,
  outdir: join(ROOT, '.arena-cycle-scan'),
  logLevel: 'silent',
  splitting: false,
});
const inputs = analyzed.metafile.inputs;
const missing = files.filter((file) => !Object.hasOwn(inputs, file));
if (missing.length) throw new Error(`The import scanner omitted: ${missing.join(', ')}`);

const graph = new Map(files.map((file) => [file, []]));
let edgeCount = 0;
for (const [file, input] of Object.entries(inputs)) {
  if (!file.startsWith('src/')) continue;
  for (const { path } of input.imports) {
    if (!path.startsWith('src/') || !graph.has(path)) continue;
    graph.get(file).push(path);
    edgeCount += 1;
  }
}
if (edgeCount === 0) throw new Error('The import scanner found no internal edges; refusing a vacuous pass.');

const cycles = findCycles(graph);
const violations = ratchet(cycles, ALLOWED_CYCLES).map((problem) => ({ ...problem, file: 'src/' }));

// ---------------------------------------------------------------------------------------------
// Negative controls: the detector and the ratchet must each reject a broken input, or the pass
// above proves nothing.
// ---------------------------------------------------------------------------------------------
const controls = [];
function control(name, rejected) {
  controls.push({ name, rejected });
  if (!rejected) violations.push({ file: 'scripts/check-cycles.mjs', kind: 'control', detail: name });
}
const g = (pairs) => new Map(Object.entries(pairs).map(([k, v]) => [k, v]));

control('a two-file cycle is detected', findCycles(g({ a: ['b'], b: ['a'] })).length === 1);
control('a long cycle is detected', findCycles(g({ a: ['b'], b: ['c'], c: ['d'], d: ['a'] })).length === 1);
control('a self-import is detected', findCycles(g({ a: ['a'] })).length === 1);
control('a diamond is not a cycle', findCycles(g({ a: ['b', 'c'], b: ['d'], c: ['d'], d: [] })).length === 0);
control(
  'an allowed cycle passes',
  ratchet(findCycles(g({ a: ['b'], b: ['a'] })), [['a', 'b']]).length === 0,
);
control(
  'a NEW cycle fails',
  ratchet(findCycles(g({ a: ['b'], b: ['a'], c: ['c'] })), [['a', 'b']])
    .some((problem) => problem.kind === 'new-cycle'),
);
control(
  'a cycle that no longer exists fails as a stale exemption',
  ratchet(findCycles(g({ a: ['b'], b: [] })), [['a', 'b']])
    .some((problem) => problem.kind === 'stale-exemption'),
);

if (violations.length) {
  console.error('[cycles] import-cycle ratchet failed:');
  for (const violation of violations) {
    console.error(`  - ${violation.kind}: ${violation.detail}`);
  }
  console.error('  Fix the import (usually: extract the shared helper into a leaf module), '
    + 'or — for a genuinely allowed cycle — edit ALLOWED_CYCLES in this file with the reason.');
  process.exit(1);
}

const detail = cycles.map((cycle) => cycle.map((f) => f.split('/').pop()).join(' ↔ ')).join('; ') || 'none';
console.log(`[cycles] ${files.length} files, ${edgeCount} internal edges, ${cycles.length} cycle(s) `
  + `(${detail}) — allowed and unchanged; ${controls.length} negative controls rejected their input.`);
