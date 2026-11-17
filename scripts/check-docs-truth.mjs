// Docs-truth check — the "current state" numbers and cross-references in the maintained SSoT
// docs must match the code and filesystem.
//
// Why this exists: the status docs lagged by two contract versions, twice, and each time the
// stale figure was quoted onward as fact. Following the 2026-11-15 SSoT overhaul, this guard
// enforces across the maintained SSoT documentation set:
//
//   contract version   src/shared/contract/manifest.js  CONTRACT_VERSION
//   method count       Object.keys(METHODS).length
//   route count        the routes registered by src/ui/app/boot.js
//   review kinds       listDecoderKinds().length in src/shared/tx-review/registry.js
//   test files         any `test/test-*.mjs` a maintained doc names must exist
//   markdown links     every relative markdown link `[...](target)` in maintained docs resolves
//   conflict markers   no `<<<<<<<` / `=======` / `>>>>>>>` merge markers in maintained docs
//
// A claim whose sentence has been rewritten fails with instructions, rather than passing
// vacuously — a checker that quietly matches nothing is worse than no checker.
//
// Run: node scripts/check-docs-truth.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { CONTRACT_VERSION, METHODS } = await import('../src/shared/contract/manifest.js');
await import('../src/shared/tx-review/decoders/index.js');
const { listDecoderKinds } = await import('../src/shared/tx-review/registry.js');

const ACTUAL = {
  version: CONTRACT_VERSION,
  methods: Object.keys(METHODS).length,
  routes: [...read('src/ui/app/boot.js').matchAll(/import \{[^}]*Route[^}]*\} from '\.\/routes\//g)].length,
  kinds: listDecoderKinds().length,
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
    doc: 'CONTEXT.md',
    re: /Contract \*\*v(\d+)\*\*, `(\d+)` methods, `(\d+)` routes, `(\d+)` review kinds/,
    groups: ['version', 'methods', 'routes', 'kinds'],
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
  {
    doc: 'docs/PROJECT_LEDGER.md',
    re: /\| Contract methods \| \*\*(\d+)\*\*/,
    groups: ['methods'],
  },
  {
    doc: 'docs/DOCS_INDEX.md',
    re: /Contract \*\*v(\d+)\*\* \(`(\d+)` methods, `(\d+)` routes, `(\d+)` review kinds/,
    groups: ['version', 'methods', 'routes', 'kinds'],
  },
  {
    doc: 'docs/ARCHITECTURE.md',
    re: /Contract \*\*v(\d+)\*\* \(`(\d+)` methods, `(\d+)` routes\)/,
    groups: ['version', 'methods', 'routes'],
  },
  {
    doc: 'docs/BUILD_SPEC.md',
    re: /Contract \*\*v(\d+)\*\* \(`(\d+)` methods, `(\d+)` routes/,
    groups: ['version', 'methods', 'routes'],
  },
  {
    doc: 'docs/BACKEND_GAPS.md',
    re: /Contract \*\*v(\d+)\*\* \(`(\d+)` methods/,
    groups: ['version', 'methods'],
  },
  {
    doc: 'docs/MODULE_BOUNDARIES.md',
    re: /Current source authority is `src\/shared\/contract\/manifest\.js` \(v(\d+), (\d+) methods\)/,
    groups: ['version', 'methods'],
  },
  {
    doc: 'README.md',
    re: /\*\*Contract v(\d+) \(`(\d+)` Methods\):\*\*/,
    groups: ['version', 'methods'],
  },
  {
    doc: 'llms.txt',
    re: /\*\*Contract version:\*\* \*\*v(\d+)\*\* \(`(\d+)` methods/,
    groups: ['version', 'methods'],
  },
  {
    doc: 'docs/defi/M0_CONTRACT_INVENTORY.md',
    re: /`CONTRACT_VERSION = (\d+)`, `(\d+)` total methods/,
    groups: ['version', 'methods'],
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

/** Every `test/test-*.mjs` a maintained doc names must exist (wildcard globs excluded). */
function missingTestFiles(docs, readFile, root) {
  const named = new Set();
  for (const doc of docs) {
    const text = readFile(doc);
    if (text == null) continue;
    for (const match of text.matchAll(/\b(test\/test-[a-z0-9-]+\.mjs)\b/g)) named.add(match[1]);
    for (const match of text.matchAll(/(?:^|[\s`(])((?:test-)?[a-z0-9-]+\.mjs)\b/g)) {
      if (existsSync(join(root, 'test', match[1]))) named.add(`test/${match[1]}`);
    }
  }
  return [...named].filter((file) => !existsSync(join(root, file)))
    .map((file) => ({ doc: file, kind: 'missing-test', detail: file }));
}

/** Every relative markdown link `[...](target)` in maintained docs must exist on disk. */
function brokenMarkdownLinks(docs, readFile, root) {
  const problems = [];
  for (const doc of docs) {
    const text = readFile(doc);
    if (text == null) continue;
    const baseDir = dirname(join(root, doc));
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      const raw = match[1].split('#')[0].trim();
      if (!raw || /^(https?:|mailto:)/.test(raw)) continue;
      if (!existsSync(resolve(baseDir, raw))) {
        problems.push({ doc, kind: 'broken-link', detail: match[1] });
      }
    }
  }
  return problems;
}

/** No retired/deleted documentation path may appear in compiled bundles or runtime schemas/seeds. */
const RETIRED_DOC_RE = /\b(?:docs\/(?:archive|handoff|reference)\/[A-Za-z0-9_.-]+|docs\/(?:MAINNET_READINESS|SEND_PATH_AUDIT|REDESIGN_TRIAGE|HISTORY_REDESIGN_PLAN|TX_REVIEW_VERIFICATION)\.md|docs\/defi\/(?:G0_DOSSIER|DECISIONS_G0|REGISTRY_AND_CAPABILITY_SEED|M0_INVENTORY|G1_REGISTRY|G1_FEED|G1_MARKET)\.md|thru-defi-(?:frontend|backend)\.md|thru-identity-profile-plan\.md)\b/;

function retiredPathLeaks(files, readFile) {
  const problems = [];
  for (const file of files) {
    const text = readFile(file);
    if (text == null) continue;
    const match = RETIRED_DOC_RE.exec(text);
    if (match) {
      problems.push({ doc: file, kind: 'retired-doc-ref', detail: match[0] });
    }
  }
  return problems;
}

const BUNDLE_AND_SEED_FILES = [
  'src/shared/contract/manifest.js',
  'src/background/services/defi/capability-snapshot.js',
  'scripts/defi-evidence/betanet.capability-matrix.json',
  'scripts/defi-evidence/betanet.registry-seed.json',
  'dist/popup.bundle.js',
  'dist/background.bundle.js',
];
/** No Git merge-conflict markers may exist in maintained docs. */
function conflictMarkers(docs, readFile) {
  const problems = [];
  const markerRe = /^(<{7}\s|={7}$|>{7}\s)/m;
  for (const doc of docs) {
    const text = readFile(doc);
    if (text == null) continue;
    if (markerRe.test(text)) {
      problems.push({ doc, kind: 'merge-conflict', detail: 'unresolved Git conflict marker found' });
    }
  }
  return problems;
}

const DOCS = [
  'AGENTS.md',
  'CONTEXT.md',
  'README.md',
  'llms.txt',
  'SECURITY.md',
  'PRIVACY.md',
  'SUPPORT.md',
  'extension.md',
  'docs/DOCS_INDEX.md',
  'docs/STATUS_AND_ROADMAP.md',
  'docs/PROJECT_LEDGER.md',
  'docs/ARCHITECTURE.md',
  'docs/BUILD_SPEC.md',
  'docs/DECISIONS.md',
  'docs/BACKEND_GAPS.md',
  'docs/MODULE_BOUNDARIES.md',
  'docs/GLOBAL_SMART_CONTRACT_POLICY.md',
  'docs/MANUAL_SMOKE_CHECKLIST.md',
  'docs/AUDIT_REPORT.md',
  'docs/DEFECT_LOG.md',
  'docs/guides/transaction-review.md',
  'docs/guides/domains-and-registrar.md',
  'docs/guides/history-and-activity.md',
  'docs/guides/protocol-and-rpc.md',
  'docs/defi/README.md',
  'docs/defi/DOSSIER_AND_CAPABILITIES.md',
  'docs/defi/M0_CONTRACT_INVENTORY.md',
  'docs/roadmap/FUTURE_ROADMAP.md',
  'docs/roadmap/ARCHITECTURE_AND_UX_CRITIQUE.md',
  'docs/roadmap/LIFECYCLE_SECURITY_AND_QA_PLAN.md',
];

const readSafe = (doc) => (existsSync(join(ROOT, doc)) ? read(doc) : null);

const violations = [
  ...DOCS.filter((doc) => !existsSync(join(ROOT, doc))).map((doc) => ({
    doc, kind: 'missing-doc', detail: 'listed in maintained SSoT DOCS but absent on disk',
  })),
  ...checkClaims(CLAIMS, ACTUAL, readSafe),
  ...missingTestFiles(DOCS, readSafe, ROOT),
  ...brokenMarkdownLinks(DOCS, readSafe, ROOT),
  ...conflictMarkers(DOCS, readSafe),
  ...retiredPathLeaks(BUNDLE_AND_SEED_FILES, readSafe),
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
  fake('The tree is at contract **v32** with **99 methods** and **15 routes**')).length > 0);
control('a correct sentence passes', checkClaims([CLAIMS[0]], ACTUAL,
  fake(`The tree is at contract **v${ACTUAL.version}** with **${ACTUAL.methods} methods** and **${ACTUAL.routes} routes**`)).length === 0);
control('a reworded sentence fails instead of passing vacuously', checkClaims([CLAIMS[0]], ACTUAL,
  fake('The tree is at v32, 153 methods.')).some((problem) => problem.kind === 'claim-moved'));
control('a named test file that does not exist is reported',
  missingTestFiles(['fake.md'], fake('see `test/test-not-a-real-file.mjs`'), ROOT).length === 1);
control('a named test file that exists is not reported',
  missingTestFiles(['fake.md'], fake('see `test/test-vault.mjs`'), ROOT).length === 0);
control('a broken relative markdown link is reported',
  brokenMarkdownLinks(['docs/DOCS_INDEX.md'], fake('See [gone](does-not-exist.md).'), ROOT).length === 1);
control('a valid relative markdown link passes',
  brokenMarkdownLinks(['docs/DOCS_INDEX.md'], fake('See [status](STATUS_AND_ROADMAP.md).'), ROOT).length === 0);
control('a merge-conflict marker is rejected',
  conflictMarkers(['fake.md'], fake('line\n<<<<<<< HEAD\nother\n')).length === 1);
control('a retired doc path in a bundle or seed is rejected',
  retiredPathLeaks(['dist/popup.bundle.js'], fake('See docs/archive/TX_DETAIL_SPIKE.md.')).length === 1);
control('the route and review-kind counts are positive numbers',
  ACTUAL.routes > 0 && ACTUAL.kinds > 0);

if (violations.length) {
  console.error('[docs-truth] a maintained doc disagrees with the code:');
  for (const violation of violations) {
    console.error(`  - ${violation.doc}: ${violation.kind} — ${violation.detail}`);
  }
  process.exit(1);
}

console.log(`[docs-truth] contract v${ACTUAL.version}, ${ACTUAL.methods} methods, `
  + `${ACTUAL.routes} routes, ${ACTUAL.kinds} review kinds — ${CLAIMS.length} claims and `
  + `all links across ${DOCS.length} SSoT documents verified; `
  + `${controls.length} negative controls rejected their input.`);
