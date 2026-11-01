// AGENTS.md truth check — the rules exist, every file they point at exists, and every rule names
// a gate.
//
// Why this exists: AGENTS.md was 347 lines and agents on this branch still broke rules written in
// it. Two failure modes came out of that review, and neither is prose:
//
//   1. a rule that points at a document which has been renamed or deleted (the pointer rots, the
//      rule becomes unreadable exactly when someone needs it);
//   2. a rule with no enforcing check — a wish. Rules that CANNOT be checked in Node say `review`
//      explicitly, so "no check" is a recorded gap instead of an omission.
//
// The restructure moved detail into docs/agent/ and kept rule numbers stable, because src/ and
// test/ comments cite them (rule 5, 6, 14, 15).
//
// Run: node scripts/check-agents.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['AGENTS.md', 'docs/agent/engineering-directive.md', 'docs/agent/rules-detail.md',
  'docs/agent/traps.md', 'docs/agent/rule-matrix.md'];

// Rules that must exist, in order. Numbers are stable: src/ and test/ cite them.
const REQUIRED_RULES = 17;
// The file may only shrink. Raising this is a deliberate edit of a guard, not a convenience.
const MAX_LINES = 200;

// Files this repository deleted on purpose. A document may name one only in the past tense, so the
// checker accepts them — and asserts they are STILL absent, so an exemption cannot quietly become a
// reference to a live file that was never checked.
const KNOWN_DELETED = new Map([
  ['src/background.js', 'replaced by src/background/index.js (MV3 worker entry)'],
]);

// Directories a bare file name (`test-vault.mjs`, `BUILD_SPEC.md`) may live in. Docs cite both the
// full path and the bare name; resolving both keeps the check about existence, not formatting.
const BARE_NAME_DIRS = ['', 'test', 'scripts', 'docs', 'docs/agent'];

/**
 * Pull repo-relative paths out of markdown. Inline code spans and link targets are both sources;
 * bare prose words are not, so this only accepts things that look like paths we ship.
 *
 * Deliberately conservative: a false positive here fails the build, so the pattern requires a
 * known top-level directory or a markdown link.
 */
function referencedPaths(markdown) {
  const found = new Set();
  const add = (raw) => {
    const value = String(raw || '').trim().replace(/[.,;:)]+$/, '');
    if (!value || value.includes('*') || value.includes('<') || value.includes(' ')) return;
    if (/^https?:/.test(value)) return;
    if (/^(src|test|docs|scripts|contracts|dist)\//.test(value)) { found.add(value); return; }
    if (/^[A-Za-z0-9_-]+\.(md|mjs|json)$/.test(value)) found.add(value);
  };
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) add(match[1]);
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) add(match[1]);
  return [...found].sort();
}

/** True when the reference resolves, directly or under a known bare-name directory. */
function resolves(path, root) {
  if (KNOWN_DELETED.has(path)) return !existsSync(resolve(root, path));
  if (existsSync(resolve(root, path))) return true;
  return /^(?![a-z]+\/)[A-Za-z0-9_-]+\.(md|mjs|json)$/.test(path)
    && BARE_NAME_DIRS.some((dir) => existsSync(resolve(root, dir, path)));
}

/**
 * The numbered hard rules. Format: `N. **Title …` with continuation lines indented.
 * Returns [{ number, text }].
 */
function parseRules(markdown) {
  const rules = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\d+)\. \*\*/.exec(lines[i]);
    if (!match) continue;
    const body = [lines[i]];
    for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]); j += 1) body.push(lines[j]);
    rules.push({ number: Number(match[1]), text: body.join('\n') });
  }
  return rules;
}

/** Every repository path referenced by these documents exists on disk. */
function missingPaths(markdown, root) {
  return referencedPaths(markdown)
    .filter((path) => !resolves(path, root))
    .map((path) => ({ path }));
}

/** Rules are 1..N, in order, each naming a check (or the word `review`). */
function ruleProblems(markdown, expected) {
  const rules = parseRules(markdown);
  const problems = [];
  if (rules.length !== expected) {
    problems.push({ kind: 'count', detail: `${rules.length} rules, expected ${expected}` });
  }
  rules.forEach((rule, index) => {
    if (rule.number !== index + 1) {
      problems.push({ kind: 'order', detail: `rule ${index + 1} is numbered ${rule.number}` });
    }
    if (!/\*check:\*/.test(rule.text) && !/\breview\b/.test(rule.text)) {
      problems.push({ kind: 'no-check', detail: `rule ${rule.number} names neither a check nor review` });
    }
  });
  return problems;
}

const violations = [];

for (const doc of DOCS) {
  const full = join(ROOT, doc);
  if (!existsSync(full)) {
    violations.push({ doc, kind: 'missing-doc', detail: 'referenced by AGENTS.md but absent' });
    continue;
  }
  const markdown = readFileSync(full, 'utf8');
  for (const { path } of missingPaths(markdown, ROOT)) {
    violations.push({ doc, kind: 'missing-path', detail: path });
  }
}

const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
for (const problem of ruleProblems(agents, REQUIRED_RULES)) {
  violations.push({ doc: 'AGENTS.md', kind: problem.kind, detail: problem.detail });
}
const agentLines = agents.split('\n').length;
if (agentLines > MAX_LINES) {
  violations.push({
    doc: 'AGENTS.md', kind: 'too-long',
    detail: `${agentLines} lines > ${MAX_LINES}; move detail to docs/agent/ rather than raising this`,
  });
}

// ---------------------------------------------------------------------------------------------
// Negative controls. Each one feeds the SAME functions above a broken input and requires a
// rejection: a checker that cannot fail proves nothing about the file it just passed.
// ---------------------------------------------------------------------------------------------
const controls = [];
function control(name, failed) {
  controls.push({ name, failed });
  if (!failed) violations.push({ doc: 'scripts/check-agents.mjs', kind: 'control', detail: name });
}

control(
  'a referenced path that does not exist is reported',
  missingPaths('See `docs/agent/does-not-exist-on-purpose.md`.', ROOT).length === 1,
);
control(
  'a path inside a markdown link is checked too',
  missingPaths('Read [this](src/ui/not-a-file.js).', ROOT).length === 1,
);
control(
  'a real path is not reported',
  missingPaths('See `docs/agent/traps.md` and `test-vault.mjs`.', ROOT).length === 0,
);
control(
  'a bare file name that resolves under test/ is accepted',
  missingPaths('`test-vault.mjs`', ROOT).length === 0,
);
control(
  'a known-deleted path is accepted only while it is still absent',
  missingPaths('`src/background.js`', ROOT).length === 0,
);
control(
  'a rule with no check and no review is rejected',
  ruleProblems('1. **A bad rule.**\n    Nothing enforces me.\n', 1)
    .some((problem) => problem.kind === 'no-check'),
);
control(
  'a rule that says review is accepted',
  ruleProblems('1. **A rule.**\n    — *check:* review.\n', 1).length === 0,
);
control(
  'a missing rule number is rejected',
  ruleProblems('1. **One.**\n    *check:* review\n3. **Three.**\n    *check:* review\n', 3)
    .some((problem) => problem.kind === 'order'),
);
control(
  'a short rule list is rejected',
  ruleProblems('1. **One.**\n    *check:* review\n', 17)
    .some((problem) => problem.kind === 'count'),
);

if (violations.length) {
  console.error('[agents] AGENTS.md / docs/agent checks failed:');
  for (const violation of violations) {
    console.error(`  - ${violation.doc}: ${violation.kind} — ${violation.detail}`);
  }
  process.exit(1);
}

console.log(`[agents] ${DOCS.length} documents, ${REQUIRED_RULES} rules in order, `
  + `every referenced path exists, ${controls.length} negative controls rejected their input. `
  + `AGENTS.md is ${agentLines}/${MAX_LINES} lines.`);
