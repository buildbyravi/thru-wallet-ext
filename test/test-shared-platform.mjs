#!/usr/bin/env node
// Shared-platform invariants — the guards behind "one authoritative implementation".
//
// WHY THIS SUITE EXISTS
//
// The Domain notification defect was not a CSS bug: it was a *duplicate-free* layer that had no
// guard around it. `toast()` was the only notification surface, and three call sites still used
// it wrongly; address truncation had six implementations and nobody noticed because each one
// looked locally reasonable. A green suite cannot see duplication, so this file makes the
// duplication itself fail the build.
//
//   [0] the one truncation primitive: behaviour, golden vectors, and the length invariant
//   [1] `truncateAddress` is an alias, not a second implementation
//   [2] no second middle-truncation in the display layer (with a positive control)
//   [3] no second clipboard write, toast host, or toast markup
//   [4] the notification family shares ONE tone vocabulary (toast and Banner)
//   [5] every feature reaches notifications through the kit, never its own copy
//
// Scans are source-level on purpose: they are deterministic, they cannot flake, and they fail on
// the commit that reintroduces the copy rather than on the screen that renders it. Each scanner
// is paired with a positive control so a regex that matches nothing cannot pass as evidence.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { installDom } from './fixtures/dom-shim.mjs';

const DOC = installDom();
globalThis.requestAnimationFrame = (fn) => fn();

const {
  shortenMiddle, shortAddress, truncateAddress,
} = await import('../src/shared/format.js');
const { Banner } = await import('../src/ui/kit/feedback.js');

let checks = 0;
let failures = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) console.log(`  ok - ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}
const eq = (label, actual, expected) => ok(label, Object.is(actual, expected),
  `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
function section(title) { console.log(`\n[${title}]`); }

// ---- file walking ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full.split('\\').join('/'));
  }
  return out;
}
const SRC = walk('src');
const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/**
 * Source lines that shorten a string in the middle. That is the shape every copy had:
 * `slice(0, N)` on one side of an ellipsis and `slice(-N)` on the other.
 */
function findMiddleTruncation(source) {
  const hits = [];
  source.split('\n').forEach((line, i) => {
    if (!line.includes('…') && !line.includes('\\u2026')) return;
    if (!/slice\(\s*-?\d+\s*\)|slice\(\s*0\s*,/.test(line)) return;
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
    hits.push(`line ${i + 1}: ${line.trim()}`);
  });
  return hits;
}

// =============================================================================================
section('0] one truncation primitive');
{
  const addr = `ta1${'abcdefghij'.repeat(4)}`; // 43 chars, the shape of a real address
  eq('an address shortens to 8…6', shortAddress(addr), `${addr.slice(0, 8)}…${addr.slice(-6)}`);
  eq('the default is the same as truncateAddress', shortAddress(addr), truncateAddress(addr));
  eq('a signature-width shortening is available', shortenMiddle(addr, { head: 4, tail: 4 }),
    `${addr.slice(0, 4)}…${addr.slice(-4)}`);
  eq('a head-only shortening is available', shortenMiddle(addr, { head: 12, tail: 0 }),
    `${addr.slice(0, 12)}…`);
  eq('custom widths are honoured', shortenMiddle(addr, { head: 6, tail: 4 }), `${addr.slice(0, 6)}…${addr.slice(-4)}`);

  // The invariant that the six copies disagreed about: truncation must NEVER make a value longer.
  const subject = 'Ta1abc';
  eq('a short value is returned whole', shortAddress(subject), subject);
  eq('an empty value is empty, not a bare ellipsis', shortAddress(''), '');
  eq('null is empty', shortAddress(null), '');
  eq('undefined is empty', shortenMiddle(undefined), '');
  // A 16-digit literal, not an 18-digit one: past 2^53 JavaScript itself loses the digits, and a
  // test that "fails" because of float precision would be testing the language, not the helper.
  eq('a number is stringified, not thrown on', shortenMiddle(1234567890123456, { head: 4, tail: 2 }), '1234…56');

  let longestViolation = null;
  for (let len = 0; len <= 40; len += 1) {
    const probe = 'x'.repeat(len);
    const out = shortenMiddle(probe);
    if (out.length > probe.length) longestViolation = { len, out };
  }
  ok('truncation is never longer than its input, at every length 0…40', longestViolation === null,
    JSON.stringify(longestViolation));

  eq('a nonsense head is clamped rather than producing NaN in the UI', shortenMiddle(addr, { head: -5, tail: 4 }), `…${addr.slice(-4)}`);
  eq('a fractional head is truncated', shortenMiddle(addr, { head: 5.9, tail: 0 }), `${addr.slice(0, 5)}…`);

  // The ellipsis is the one the whole codebase uses (U+2026), not three periods: a "." chain
  // wrapped differently in the narrow popup and read as part of the address.
  ok('the separator is a single ellipsis character', shortAddress(addr).includes('\u2026')
    && !shortAddress(addr).includes('...'));
}

// =============================================================================================
section('1] truncateAddress is an alias, not a second implementation');
{
  const source = readFileSync('src/shared/format.js', 'utf8');
  const bodies = [...source.matchAll(/export function truncateAddress\([^)]*\)\s*\{([^}]*)\}/g)];
  eq('truncateAddress exists once', bodies.length, 1);
  ok('it delegates instead of slicing', /shortAddress\(|shortenMiddle\(/.test(bodies[0][1]),
    bodies[0][1].trim());
  ok('it does not contain its own slice()', !/slice\(/.test(bodies[0][1]), bodies[0][1].trim());
}

// =============================================================================================
section('2] no second middle-truncation in the display layer');
{
  const DISPLAY_LAYER = SRC.filter((f) => f.startsWith('src/ui/') || f.startsWith('src/shared/'));
  const offenders = [];
  for (const file of DISPLAY_LAYER) {
    if (file === 'src/shared/format.js') continue; // the owner
    const hits = findMiddleTruncation(readFileSync(file, 'utf8'));
    for (const hit of hits) offenders.push(`${file} ${hit}`);
  }
  eq('no file in src/ui or src/shared shortens a string by hand', offenders.length, 0);
  if (offenders.length) console.error(`         ${offenders.join('\n         ')}`);

  // Positive control: the scanner must see a real copy when one is present. Without this, an
  // empty result above could mean "no duplicates" or "the regex never matches".
  const sample = "const s = `${mint.slice(0, 6)}…${mint.slice(-6)}`;";
  eq('control: the scanner detects a hand-rolled truncation', findMiddleTruncation(sample).length, 1);

  // And it must NOT flag a comment that merely documents the convention.
  eq('control: documentation about truncation is not a violation',
    findMiddleTruncation('// shows ta1234…abcdef via slice(0, 8)').length, 0);

  // Background services are deliberately out of scope for this pass: their `slice(0, 12)…`
  // strings are diagnostic text inside thrown errors, not rendered rows. Recorded so the
  // boundary is a decision rather than an oversight — see the audit record §3.
  const backgroundHits = SRC.filter((f) => f.startsWith('src/background/'))
    .flatMap((f) => findMiddleTruncation(readFileSync(f, 'utf8')).map((h) => `${f} ${h}`));
  ok('the background diagnostic strings are still present (this scan is scoped to display only)',
    backgroundHits.length > 0, 'if this becomes 0, widen the guard and delete this assertion');
}

// =============================================================================================
section('3] no second clipboard write, toast host, or toast markup');
{
  const writers = SRC.filter((f) => /navigator\.clipboard\.writeText/.test(readFileSync(f, 'utf8')));
  // Two by design: the shared CopyButton, and the Receive address box that swaps its own label to
  // "Copied" (an affordance, not a button). Both surface failure to the user.
  eq('clipboard writes live in exactly the two documented places', writers.length, 2);
  ok('they are the copy button and the receive box',
    writers.includes('src/ui/kit/button.js') && writers.includes('src/ui/app/routes/receive.js'),
    writers.join(', '));

  const hosts = SRC.filter((f) => /'toast-host'|"toast-host"/.test(readFileSync(f, 'utf8')));
  eq('there is exactly one toast host', hosts.length, 1);
  eq('and it is the shared kit', hosts[0], 'src/ui/kit/toast.js');

  const markups = SRC.filter((f) => /class: 'toast\b|class: \['toast|class: `toast/.test(readFileSync(f, 'utf8')));
  eq('no feature builds its own toast element', markups.length, 1);
  eq('only the kit constructs a toast', markups[0], 'src/ui/kit/toast.js');
}

// =============================================================================================
section('4] one tone vocabulary across the notification family');
{
  const banner = (tone) => {
    const b = Banner({ tone, message: 'message' });
    return b.el;
  };
  const classes = (el) => [...el.classList.set].sort().join(' ');

  eq('error is the alert tone', classes(banner('error')), 'error');
  eq('warning keeps the notice base', classes(banner('warning')), 'notice warning');
  eq('success is a real state now', classes(banner('success')), 'notice success');
  eq("the route's legacy 'ok' resolves to success", classes(banner('ok')), 'notice success');
  eq('info stays neutral', classes(banner('info')), 'notice');

  const b = Banner({ tone: 'error' });
  eq('an empty banner renders nothing', b.el.classList.contains('hidden'), true);
  b.set('Saved', 'ok');
  ok('a tone change repaints the classes', b.el.classList.contains('success')
    && !b.el.classList.contains('error'), classes(b.el));
  b.set('Still saved', 'warning');
  ok('and repaints again', b.el.classList.contains('warning') && !b.el.classList.contains('success'),
    classes(b.el));
  b.set('');
  eq('clearing hides it again', b.el.classList.contains('hidden'), true);

  // The toast's vocabulary is the document; this asserts the two components agree on the states a
  // feature may ask for. `pending` is toast-only by design (a banner cannot be resolved in place).
  const toastSource = readFileSync('src/ui/kit/toast.js', 'utf8');
  const bannerSource = readFileSync('src/ui/kit/feedback.js', 'utf8');
  for (const tone of ['success', 'info', 'warning', 'error']) {
    ok(`${tone} exists in both notification components`,
      new RegExp(`\\b${tone}\\b`).test(toastSource) && new RegExp(`\\b${tone}\\b`).test(bannerSource));
  }
  ok('pending exists in the toast', /pending/.test(toastSource));
}

// =============================================================================================
section('5] features go through the kit, never a copy');
{
  const routes = SRC.filter((f) => f.startsWith('src/ui/app/routes/') || f.startsWith('src/ui/domain/'));
  const badImports = [];
  for (const file of routes) {
    const source = readFileSync(file, 'utf8');
    if (/(?<![\w.])toast\(/.test(source)) {
      if (!/from '[^']*kit\/toast\.js'/.test(source)) badImports.push(`${file} calls toast() without importing kit/toast.js`);
    }
    if (/\bBanner\(/.test(source) && !/from '[^']*kit\/feedback\.js'/.test(source)) {
      badImports.push(`${file} uses Banner without importing kit/feedback.js`);
    }
  }
  eq('every feature imports the shared notification components', badImports.length, 0);
  if (badImports.length) console.error(`         ${badImports.join('\n         ')}`);

  eq('control: the import scan inspects the routes it claims to',
    routes.some((f) => f.endsWith('routes/name.js')), true);

  // The Domain feature is the one migrated in this pass: it must be a plain consumer.
  const nameSource = readFileSync('src/ui/app/routes/name.js', 'utf8');
  ok('Domain passes a tone and a message to every toast it raises',
    !/(?<![\w.])toast\(\s*'/.test(nameSource));
  ok('Domain shortens through the shared helper',
    /shortAddress/.test(nameSource) && !/slice\(0, *\d+\)/.test(nameSource));
}

// =============================================================================================
console.log('');
if (failures) {
  console.error(`shared-platform checks: ${checks - failures} passed, ${failures} failed.`);
  process.exit(1);
}
console.log(`All shared-platform checks passed: ${checks}/${checks}.`);
process.exit(0);
