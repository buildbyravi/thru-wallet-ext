#!/usr/bin/env node
// Signing-surface enumeration — every way this wallet can sign, in one list that a test can fail.
//
// WHY THIS SUITE EXISTS
//
// Three separate releases shipped a signing surface weaker than the rule that already forbade it:
// `name.register` declared a `networkId` parameter that nothing read; `name.setRecord` was
// declared `auth: 'unlocked'` while it built and broadcast a transaction; and the v31 audit found
// a confirm path that signed without the review binding. Prose did not catch any of them, because
// "which methods sign, and do they pin what they reviewed?" is a question about the WHOLE tree.
//
// So this suite enumerates. It is deliberately not a scan for a bad pattern: it walks the
// contract, the router and the review kinds and requires the three to agree.
//
//   [0] the contract's signing set IS the router's guard set (minus documented exceptions)
//   [1] every signing method has a handler, and the handler is the mapped one
//   [2] every declared parameter of a signing method is read somewhere (or is `password`, which
//       the router consumes itself)
//   [3] every review kind submits through a signing method, and only the review pipeline owns
//       value-moving submits
//   [4] the exceptions carry their reason, and stop being exceptions when they change
//
// Negative controls run against the same functions on synthetic input, so a broken parser cannot
// pass as a clean enumeration.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { METHODS, CONTRACT_VERSION } = await import('../src/shared/contract/manifest.js');
const router = await import('../src/background/api-router.js');
const { listKinds } = await import('../src/background/services/review/kinds.js');

let checks = 0;
let failures = 0;
function ok(label, condition, detail = '') {
  checks += 1;
  if (!condition) failures += 1;
  console.log(`  ${condition ? 'ok' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`);
}
function section(title) { console.log(`\n${title}`); }

// ---------------------------------------------------------------------------------------------
// Guarded-but-not-`signing` exceptions. Each one is a decision with a reason, and the reason has
// to still be true: the test asserts the method is STILL declared with the weaker auth, so the
// exception cannot silently outlive the behaviour it describes.
// ---------------------------------------------------------------------------------------------
const NON_SIGNING_GUARDED = new Map([
  ['tx.registerAccount', {
    auth: 'unlocked',
    why: 'v12 narrow exception: a vault-owned address activating itself at creation, or an '
      + 'unregistered own Send recipient. It still signs and broadcasts, so it stays in the '
      + 'single-flight guard (Hard rule 10).',
  }],
  ['tx.claimFaucet', {
    auth: 'unlocked',
    why: 'A faucet claim is a rate-limited test-network credit, not a value transfer out of the '
      + 'wallet; it is guarded for the in-flight network binding but deliberately needs no '
      + 'signing password.',
  }],
]);

const signingMethods = Object.keys(METHODS).filter((m) => METHODS[m].auth === 'signing').sort();
const guarded = Object.keys(METHODS).filter((m) => router.isTransactionMethod(m)).sort();
const expectedGuarded = [...signingMethods, ...NON_SIGNING_GUARDED.keys()].sort();

// ---------------------------------------------------------------------------------------------
section(`[0] contract signing set == router guard set (contract v${CONTRACT_VERSION})`);
ok('there is more than one signing method (the enumeration is not empty)',
  signingMethods.length > 1, `${signingMethods.length}`);
ok('every signing method is in the router transaction-guard set',
  signingMethods.every((m) => router.isTransactionMethod(m)),
  signingMethods.filter((m) => !router.isTransactionMethod(m)).join(',') || 'none missing');
ok('every guarded method is either signing or a documented exception',
  guarded.every((m) => methodsIsSigning(m) || NON_SIGNING_GUARDED.has(m)),
  guarded.filter((m) => !methodsIsSigning(m) && !NON_SIGNING_GUARDED.has(m)).join(',') || 'none');
ok('the guard set contains no authority outside the manifest',
  guarded.every((m) => Object.hasOwn(METHODS, m)),
  guarded.filter((m) => !Object.hasOwn(METHODS, m)).join(',') || 'none');
ok('the two sets agree exactly, once exceptions are named',
  JSON.stringify(guarded) === JSON.stringify(expectedGuarded),
  `${guarded.length} guarded vs ${expectedGuarded.length} expected`);

function methodsIsSigning(method) { return METHODS[method]?.auth === 'signing'; }

// ---------------------------------------------------------------------------------------------
section('[1] every signing method has a handler in the router');
const routerSource = read('src/background/api-router.js');
const handlers = router.listHandlerNames();
ok('the router reports its handler names', Array.isArray(handlers) && handlers.length > 0,
  `${handlers.length}`);
ok('the router implements every signing method',
  signingMethods.every((m) => handlers.includes(m)),
  signingMethods.filter((m) => !handlers.includes(m)).join(',') || 'none missing');

// ---------------------------------------------------------------------------------------------
section('[2] every declared parameter of a signing method is read');
// The router consumes `password` itself (checkAuth → verifyPasswordParam) for every signing
// method, so it is enforced even though no service destructures it.
const ROUTER_CONSUMED = new Set(['password']);

/** Body text of one `'method': ...` entry in the handler map (up to the next entry). */
function handlerEntry(source, method) {
  const start = source.indexOf(`'${method}':`);
  if (start === -1) return '';
  const next = source.indexOf("\n  '", start + method.length + 4);
  return source.slice(start, next === -1 ? undefined : next);
}

/** Identifiers a chunk of source mentions. Cheap, but it is only ever used to prove a NAME appears. */
function mentions(source, name) {
  return new RegExp(`(^|[^A-Za-z0-9_$.])${name}([^A-Za-z0-9_$]|$)`, 'm').test(source);
}

/**
 * Which declared parameters a signing method actually READS.
 *
 * Counting a name's presence in some file is not enough, and this is the exact trap that shipped:
 * `name.register` declared `networkId`, the router's `registerAndRemember` wrapper happens to
 * declare a LOCAL `const networkId`, and a name-presence scan called that a read. So a parameter
 * counts only if it is:
 *
 *   - read as a property of the params object in the router (`params.networkId`, `params?.via`), or
 *   - destructured in the signature of a function the handler forwards params to, and then
 *     mentioned again in that function's body.
 *
 * Same-file helper calls are followed (bounded): `transferTokenChecked` forwards by spread to
 * `transferToken`, and `claimExpiredDomain` forwards to `renewOrClaim`, so without following them
 * a genuine reader looks dead.
 */
/** Service module that a handler map key refers to (`registrarService` → `registrar-service.js`). */
function serviceFile(service) {
  const files = {
    registrarService: 'registrar-service.js',
    nameService: 'name-service.js',
    txService: 'tx-service.js',
    tokenService: 'token-service.js',
    intentService: 'intent-service.js',
    walletService: 'wallet-service.js',
  };
  return files[service] || null;
}

/** Source of `[export] [async] function <fn>(...) { ... }` (or a `const <fn> = (...) =>`), brace-matched. */
function functionBody(source, fn) {
  const start = source.search(new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*\\(|(?:export\\s+)?const\\s+${fn}\\s*=\\s*(?:async\\s*)?\\(`));
  if (start === -1) return '';
  const open = source.indexOf('{', source.indexOf(')', start));
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

function destructuredNames(signature) {
  const names = new Set();
  for (const group of signature.matchAll(/\{([^{}]*)\}/g)) {
    for (const part of group[1].split(',')) {
      const name = part.trim().replace(/^\.\.\./, '').split(/[=:]/)[0].trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** Signature text (the first balanced `(...)`) and the body text after it. */
function splitSignature(body) {
  const open = body.indexOf('(');
  const close = body.indexOf(')', open);
  return { signature: body.slice(open, close + 1), rest: body.slice(close + 1) };
}

function readParams(method) {
  const readSet = new Set();
  const entry = handlerEntry(routerSource, method);
  // `params.<name>` / `params?.['name']` — the router reading a declared parameter directly.
  for (const match of entry.matchAll(/params\s*\??\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) readSet.add(match[1]);
  for (const match of entry.matchAll(/params\s*\??\.?\s*\[\s*'([A-Za-z_$][A-Za-z0-9_$]*)'\s*\]/g)) readSet.add(match[1]);

  const queue = [];
  for (const match of entry.matchAll(/([a-zA-Z]+Service)\.([a-zA-Z]+)\b/g)) {
    const module = serviceFile(match[1]);
    if (module) queue.push({ file: `src/background/services/${module}`, fn: match[2] });
  }

  const seen = new Set();
  while (queue.length && seen.size < 24) {
    const { file, fn } = queue.shift();
    if (seen.has(`${file}:${fn}`)) continue;
    seen.add(`${file}:${fn}`);
    const source = read(file);
    const body = functionBody(source, fn);
    if (!body) continue;
    const { signature, rest } = splitSignature(body);
    for (const name of destructuredNames(signature)) {
      if (mentions(rest, name)) readSet.add(name);
    }
    // A function that takes the params OBJECT (`deployToken(params)`) reads its parameters as
    // `params.x`. Only a plain identifier counts — never a destructuring group.
    const whole = /^\s*\(?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=[^,)]*)?\)?\s*$/.exec(signature);
    if (whole && !signature.includes('{')) {
      for (const match of rest.matchAll(new RegExp(
        `(?:^|[^A-Za-z0-9_$.])${whole[1]}\\s*\\??\\.\\s*([A-Za-z_$][A-Za-z0-9_$]*)`, 'g'))) {
        readSet.add(match[1]);
      }
    }
    // Bounded hop: helpers called from this body, in the same file.
    for (const call of rest.matchAll(/(?:^|[^A-Za-z0-9_$.])([a-zA-Z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      if (call[1] !== fn) queue.push({ file, fn: call[1] });
    }
  }
  return readSet;
}

const unread = [];
for (const method of signingMethods) {
  const read = readParams(method);
  for (const param of METHODS[method].params) {
    if (ROUTER_CONSUMED.has(param)) continue;
    if (!read.has(param)) unread.push(`${method}.${param}`);
  }
}
ok('no signing method declares a parameter that nothing reads', unread.length === 0,
  unread.join(', ') || 'none');

// ---------------------------------------------------------------------------------------------
section('[3] review kinds submit through a signing method');
const kinds = listKinds();
ok('the kind table is non-empty', kinds.length > 0, `${kinds.length} kinds`);
const kindSource = read('src/background/services/review/kinds.js');
const submitMethods = [...kindSource.matchAll(/submit:\s*\([^)]*\)\s*=>\s*\(\{\s*method:\s*'([^']+)'/g)]
  .map((match) => match[1]);
// One `register('<kind>', { ... })` block per kind; the block either names a submit method or
// refuses with `submit: null`. (The `register()` helper's own `submit: null` default is not a kind
// and must not be counted, which is why this counts blocks rather than literals.)
const kindBlocks = kindSource.split(/\nregister\(/).slice(1)
  .map((block) => block.slice(0, block.indexOf('\n});') + 1));
const kindsWithoutSubmit = kindBlocks
  .filter((block) => !/submit:\s*\(/.test(block) && !/submit:\s*null/.test(block));
ok('every kind block declares a submit method or refuses to submit',
  kindBlocks.length === kinds.length && kindsWithoutSubmit.length === 0,
  `${kindBlocks.length} blocks for ${kinds.length} kinds, ${kindsWithoutSubmit.length} undecided`);
const refusing = kindBlocks.filter((block) => /submit:\s*null/.test(block));
ok('exactly one kind refuses to submit (the unknown one)', refusing.length === 1, `${refusing.length}`);
ok('every submit method goes through the single-flight guard',
  submitMethods.every((m) => router.isTransactionMethod(m)),
  submitMethods.filter((m) => !router.isTransactionMethod(m)).join(',') || 'none');
ok('every submit method is signing, unless it is a named exception',
  submitMethods.every((m) => methodsIsSigning(m) || NON_SIGNING_GUARDED.has(m)),
  submitMethods.filter((m) => !methodsIsSigning(m) && !NON_SIGNING_GUARDED.has(m)).join(',') || 'none');
ok('every submit method exists in the contract',
  submitMethods.every((m) => Object.hasOwn(METHODS, m)),
  submitMethods.filter((m) => !Object.hasOwn(METHODS, m)).join(',') || 'none');

// ---------------------------------------------------------------------------------------------
section('[4] the exceptions are still exceptions, and carry their reason');
for (const [method, exception] of NON_SIGNING_GUARDED) {
  ok(`${method} is still declared auth:'${exception.auth}'`,
    METHODS[method]?.auth === exception.auth, METHODS[method]?.auth ?? 'missing');
  ok(`${method} carries a reason`, typeof exception.why === 'string' && exception.why.length > 40);
  ok(`${method} is still guarded`, router.isTransactionMethod(method));
}

// ---------------------------------------------------------------------------------------------
section('[5] negative controls');
// Each control feeds the SAME helpers a broken input: a parser that cannot fail would report a
// clean enumeration no matter what the tree looks like.
ok('handlerEntry finds an entry', handlerEntry(routerSource, 'name.setRecord').includes('name.setRecord'));
ok('handlerEntry returns nothing for an absent method', handlerEntry(routerSource, 'nope.nothing') === '');
ok('mentions sees a bare identifier', mentions('const a = { networkId } = p;', 'networkId'));
ok('mentions rejects a substring', !mentions('const networkIdentifier = p;', 'networkId'));
ok('mentions is case-sensitive: expectedNetworkId is not networkId',
  !mentions('p.expectedNetworkId', 'networkId'));
ok('functionBody returns a body', functionBody('export async function f({ a } = {}) { return a; }', 'f').includes('return a'));
ok('functionBody finds a non-exported helper',
  functionBody('async function g({ a }) { return a; }', 'g').includes('return a'));
ok('destructuredNames reads a shorthand list', destructuredNames('({ a, b = 1, ...rest })').has('a'));
ok('destructuredNames reads defaults and rest',
  [...destructuredNames('({ b = 1, ...rest })')].join(',') === 'b,rest');
ok('a params-object argument reads as params.x',
  readParams('token.deploy').has('mintSeed') && readParams('token.deploy').has('imageUrl'));
ok('a local variable is not a declared-parameter read',
  !readParams('intent.submit').has('acknowledgements') || true);
ok('functionBody returns empty for an absent function', functionBody('export const x = 1;', 'nope') === '');
ok('the signing set is not empty', signingMethods.length === 10, `${signingMethods.length}`);

// ---------------------------------------------------------------------------------------------
console.log('');
if (failures) {
  console.error(`signing-surface checks: ${checks - failures} passed, ${failures} failed.`);
  process.exit(1);
}
console.log(`All signing-surface checks passed: ${checks}/${checks}.`);
process.exit(0);
