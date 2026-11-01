// Docs-truth check — the "current state" numbers in the maintained docs must be the numbers in
// the code.
//
// Why this exists: the status docs lagged by two contract versions, twice, and each time the
// stale figure was quoted onward as fact. A count in prose is a claim with a commit behind it, so
// the four claims that matter most are parsed and compared against `src/`:
//
//   contract version   src/shared/contract/manifest.js  CONTRACT_VERSION
//   method count       Object.keys(METHODS).length
//   route count        the routes registered by src/ui/app/boot.js
//   test files         any `test/test-*.mjs` a maintained doc names must exist
//
// Deliberately NOT checked: the total assertion count (`npm test` prints it, and a doc that must
// be edited on every added assertion trains people to ignore the diff). PROJECT_LEDGER already
// says to use the final test output for that.
//
// A claim whose sentence has been rewritten fails with instructions, rather than passing
// vacuously — a checker that quietly matches nothing is worse than no checker.
//
// Run: node scripts/check-docs-truth.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { CONTRACT_VERSION, METHODS } = await import('../src/shared/contract/manifest.js');
const ACTUAL = {
  version: CONTRACT_VERSION,
  methods: Object.keys(METHODS).length,
  routes: [...read('src/ui/app/boot.js').matchAll(/import \{[^}]*Route[^}]*\} from '\.\/routes\//g)].length,
};

// Each claim names the document, the sentence shape that carries it, and which numbers it holds.
// `groups` maps a capture group to the ACTUAL key it must equal.
const CLAIMS = [
  {
    doc: 'docs/AUDIT_REPORT.md',
    re: /The tree is at contract \*\*v(\d+)\*\* with \*\*(\d+) methods\*\* and \*\*(\d+) routes\*\*/,
    groups: ['version', 'methods', 'routes'],
  },
  {
    doc: 'CONTEXT.md',
    re: /Contract \*\*v(\d+)\*\* has \*\*(\d+) methods\*\*/,
    groups: ['version', 'methods'],
  },
  {
    doc: 'CONTEXT.md',
    re: /Contract \*\*v(\d+)\*\*: \*\*(\d+) methods\*\*/,
    groups: ['version', 'methods'],
  },
  {
    doc: 'docs/STATUS_AND_ROADMAP.md',
    re: /Source baseline re-verified on `[^`]+` at contract v(\d+)/,
    groups: ['version'],
  },
  {
    doc: 'docs/PROJECT_LEDGER.md',
    re: /refreshed \d{4}-\d{2}-\d{2} \(contract v(\d+)/,
    groups: ['version'],
  },
  {
    doc: 'docs/PROJECT_LEDGER.md',
    re: /\| Contract version \| \*\*v(\d+)\*\*/,
    groups: ['version'],
  },
];

/** Compare every claim against ACTUAL. Returns a list of problems (empty means the docs are true). */
function checkClaims(claims, actual, readFile) {
  const problems = [];
  for (const claim of claims) {
    const text = readFile(claim.doc);
    if (text == null) {
      problems.push({ doc: claim.doc, kind: 'missing-doc', detail: 'document not found' });
      continue;
    }
    const match = claim.re.exec(text);
    if (!match) {
      problems.push({
        doc: claim.doc, kind: 'claim-moved',
        detail: `${claim.re} no longer matches — update this pattern (and the number) in check-docs-truth.mjs`,
      });
      continue;
    }
    claim.groups.forEach((key, index) => {
      const stated = Number(match[index + 1]);
      if (stated !== actual[key]) {
        problems.push({
          doc: claim.doc, kind: 'stale-number',
          detail: `${key}: doc says ${stated}, code says ${actual[key]}`,
        });
      }
    });
  }
  return problems;
}

/** Every `test/test-*.mjs` a maintained doc names must exist. */
function missingTestFiles(docs, readFile, root) {
  const named = new Set();
  for (const doc of docs) {
    const text = readFile(doc);
    if (text == null) continue;
    for (const match of text.matchAll(/\b(test\/test-[a-z0-9-]+\.mjs)\b/g)) named.add(match[1]);
    // Docs also cite the bare file name; those live in test/.
    for (const match of text.matchAll(/(?:^|[\s`(])((?:test-)?[a-z0-9-]+\.mjs)\b/g)) {
      if (existsSync(join(root, 'test', match[1]))) named.add(`test/${match[1]}`);
    }
  }
  return [...named].filter((file) => !existsSync(join(root, file)))
    .map((file) => ({ file, kind: 'missing-test', detail: file }));
}

const DOCS = ['CONTEXT.md', 'docs/STATUS_AND_ROADMAP.md', 'docs/PROJECT_LEDGER.md',
  'docs/AUDIT_REPORT.md', 'docs/DOCS_INDEX.md'];

const violations = [
  ...checkClaims(CLAIMS, ACTUAL, (doc) => (existsSync(join(ROOT, doc)) ? read(doc) : null)),
  ...missingTestFiles(DOCS, (doc) => (existsSync(join(ROOT, doc)) ? read(doc) : null), ROOT),
];

// ---------------------------------------------------------------------------------------------
// Negative controls: the comparison and the pattern must each be able to fail.
// ---------------------------------------------------------------------------------------------
const controls = [];
function control(name, rejected) {
  controls.push({ name, rejected });
  if (!rejected) violations.push({ doc: 'scripts/check-docs-truth.mjs', kind: 'control', detail: name });
}
const fake = (text) => () => text;

control('a stale contract version is rejected', checkClaims([CLAIMS[0]], ACTUAL,
  fake('The tree is at contract **v1** with **153 methods** and **15 routes**')).length > 0);
control('a stale method count is rejected', checkClaims([CLAIMS[0]], ACTUAL,
  fake('The tree is at contract **v31** with **99 methods** and **15 routes**')).length > 0);
control('a correct sentence passes', checkClaims([CLAIMS[0]], ACTUAL,
  fake(`The tree is at contract **v${ACTUAL.version}** with **${ACTUAL.methods} methods** and **${ACTUAL.routes} routes**`)).length === 0);
control('a reworded sentence fails instead of passing vacuously', checkClaims([CLAIMS[0]], ACTUAL,
  fake('The tree is at v31, 153 methods.')).some((problem) => problem.kind === 'claim-moved'));
control('a named test file that does not exist is reported',
  missingTestFiles(['fake.md'], fake('see `test/test-not-a-real-file.mjs`'), ROOT).length === 1);
control('a named test file that exists is not reported',
  missingTestFiles(['fake.md'], fake('see `test/test-vault.mjs`'), ROOT).length === 0);
control('the route count is a positive number', ACTUAL.routes > 0, `${ACTUAL.routes}`);

if (violations.length) {
  console.error('[docs-truth] a maintained doc disagrees with the code:');
  for (const violation of violations) {
    console.error(`  - ${violation.doc}: ${violation.kind} — ${violation.detail}`);
  }
  process.exit(1);
}

console.log(`[docs-truth] contract v${ACTUAL.version}, ${ACTUAL.methods} methods, `
  + `${ACTUAL.routes} routes — ${CLAIMS.length} claims across ${DOCS.length} documents match; `
  + `${controls.length} negative controls rejected their input.`);
