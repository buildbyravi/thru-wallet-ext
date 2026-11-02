// Guard-of-guards — every check script must be able to fail.
//
// The 2026-10-31 review found the pattern behind three shipped defects: a probe that could not
// fail was treated as evidence, and a rule with no check was treated as enforced. Both are the
// same mistake — a green result that carries no information.
//
// This script does not (and cannot) prove a control is GOOD. It enforces that one exists and is
// reported, so a new guard cannot arrive as an assertion that is structurally incapable of
// failing without someone deleting a line that says so.
//
// Run: node scripts/check-check-controls.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');
const SELF = 'check-check-controls.mjs';

// Guards written before this rule that carry no declared negative control. The list may only
// SHRINK: each entry is debt with a name on it, and a new guard cannot join. Deleting a file from
// disk without removing it here fails the build, so the list cannot rot into a silent exemption.
const LEGACY_WITHOUT_CONTROL = new Set([
  'check-csp.mjs',
  'check-css-nesting.mjs',
  'check-panel-tiles.mjs',
  'check-routes.mjs',
]);

/**
 * A guard has a control when it (a) contains a `control(` call, and (b) prints the count it ran.
 * Returns the problems for one script's source.
 */
function controlProblems(source, name) {
  const problems = [];
  const structured = (source.match(/\bcontrol\(/g) || []).length > 0;
  // The older guards run their negative controls inline (a synthetic input must be rejected) and
  // say so in a comment; check-layering is the example. Both shapes count, a bare assertion does
  // not.
  const inline = /negative control|positive or negative control/i.test(source);
  if (!structured && !inline) {
    problems.push({ file: name, kind: 'no-control', detail: 'no control(...) call and no negative-control section' });
  }
  if (structured && !/controls\.length|controls\.filter|control count/i.test(source)) {
    problems.push({ file: name, kind: 'unreported', detail: 'never reports how many controls ran' });
  }
  return problems;
}

const guards = readdirSync(SCRIPTS)
  .filter((name) => /^check-.*\.mjs$/.test(name) && name !== SELF)
  .sort();

const violations = [];
for (const name of guards) {
  if (LEGACY_WITHOUT_CONTROL.has(name)) continue;
  violations.push(...controlProblems(readFileSync(join(SCRIPTS, name), 'utf8'), name));
}
// An exemption for a file that no longer exists is stale debt: fail so it gets removed.
for (const name of LEGACY_WITHOUT_CONTROL) {
  if (!guards.includes(name)) {
    violations.push({ file: name, kind: 'stale-legacy', detail: 'no such guard; remove it from LEGACY_WITHOUT_CONTROL' });
  }
}

// ---------------------------------------------------------------------------------------------
// Negative controls: the scan must reject a guard with no control, and accept one with a
// reported control.
// ---------------------------------------------------------------------------------------------
const controls = [];
function control(name, rejected) {
  controls.push({ name, rejected });
  if (!rejected) violations.push({ file: SELF, kind: 'control', detail: name });
}
control('a guard with no control is rejected',
  controlProblems('if (x) process.exit(1);', 'fake.mjs').some((p) => p.kind === 'no-control'));
control('an inline negative-control section is accepted',
  controlProblems('// Negative controls: a bad input must throw.\ncheck(bad);', 'fake.mjs').length === 0);
control('a control that is never reported is rejected',
  controlProblems('control("a", true);', 'fake.mjs').some((p) => p.kind === 'unreported'));
control('a guard with a reported control passes',
  controlProblems('control("a", true); console.log(controls.length);', 'fake.mjs').length === 0);

if (violations.length) {
  console.error('[controls] a guard cannot demonstrate its own failure:');
  for (const violation of violations) {
    console.error(`  - ${violation.file}: ${violation.kind} — ${violation.detail}`);
  }
  process.exit(1);
}

console.log(`[controls] ${guards.length} guard scripts: ${guards.length - LEGACY_WITHOUT_CONTROL.size} `
  + `ship a declared negative control, ${LEGACY_WITHOUT_CONTROL.size} are listed legacy debt; `
  + `${controls.length} controls on this check itself.`);
