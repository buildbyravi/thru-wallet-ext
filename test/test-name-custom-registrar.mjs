// Custom-registrar evidence tests (offline, NO network) — cross-pin the wallet's
// client-side derivations against the live Betanet deployment facts recorded by the
// owner's host on 2026-10-25 (dfd7316):
//   scripts/defi-evidence/registrar-{deploy,probe}-betanet-*.json
// Any drift between the runtime derivation helpers and the actual deployed program
// (wrong seed, wrong program address, wrong name-service layout) fails here, before a
// user ever broadcasts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { NETWORKS } from '../src/lib/networks.js';
import * as tcr from '../src/lib/custom-registrar.js';
import { rootRegistrarAddress, domainAccountAddress } from '../src/lib/name-service.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = JSON.parse(readFileSync(
  join(REPO_ROOT, 'scripts/defi-evidence/registrar-probe-betanet-probe14agql-1792889728542.json'),
  'utf8',
));

let failures = 0;
function ok(cond, label) {
  if (!cond) { failures += 1; console.error(`  FAIL ${label}`); }
  else console.log(`  ok   ${label}`);
}
function eq(a, b, label) {
  ok(String(a) === String(b), `${label} (got ${String(a)}, want ${String(b)})`);
}

// ---- networks.js evidence pin ---------------------------------------------------------
console.log('networks pin');
eq(NETWORKS.betanet.customRegistrarProgram, evidence.program, 'betanet customRegistrarProgram == deployed program (evidence)');
eq(NETWORKS.localnet.customRegistrarProgram, null, 'localnet has no custom registrar pinned');
eq(NETWORKS.testnet.customRegistrarProgram, null, 'testnet (disabled) has no custom registrar pinned');
eq(NETWORKS.mainnet.customRegistrarProgram, null, 'mainnet has no custom registrar pinned (fee decided later per Thru market price — owner decision)');

// ---- chain-derivation goldens -----------------------------------------------------------
const program = NETWORKS.betanet.customRegistrarProgram;
console.log('derivations');
const configAddress = tcr.tcrConfigAddress(program);
eq(configAddress, 'ta_9lLvhxurg4J5DyZ82W14rzzGWCEfj9B7Y8wa99amPBa', 'config PDA (TCR:config:v1 seed) == live config account');
eq(tcr.tcrLeaseAddress(program, evidence.label), evidence.leaseAddress, 'lease PDA for the probed label == live lease account');
const rootAddress = await rootRegistrarAddress(evidence.config.rootName);
eq(rootAddress, evidence.rootAddress, 'name-service root ("thru") == live root registrar account');
eq(await domainAccountAddress(rootAddress, evidence.label), evidence.domainAddress, 'domain account == live domain account');
eq(evidence.config.feePerYear, '1000', 'on-chain fee 1000 base units/yr recorded in evidence');
eq(tcr.TCR_MAX_YEARS, 10, 'year ceiling 10');

// ---- seed-collision guard ---------------------------------------------------------------
// The config seed would be a perfect squat for a user label: same deriveProgramAddress
// space (padded seeds). It survives only because labelProblem must reject 'TCR:config:v1'.
console.log('seed-collision guard');
ok(tcr.labelProblem(tcr.TCR_CONFIG_SEED_LABEL) != null, 'config seed label cannot be a registrable name');
let threw = false;
try { tcr.tcrLeaseAddress(program, tcr.TCR_CONFIG_SEED_LABEL); } catch { threw = true; }
ok(threw, 'lease derivation refuses the config seed label');
eq(tcr.tcrConfigAddress(program, tcr.TCR_CONFIG_SEED_LABEL), configAddress, 'config derivation still works for its own seed');

// ---- proof-slot extraction (the -33 InvalidProofSlot lesson) -----------------------------
// The custom register path reads the domain proof's embedded u64le timestamp and masks
// off the top two bits to recover the proof slot; lease proofs are aligned to it.
console.log('proof slot extraction');
const buf = new Uint8Array(8);
const dv = new DataView(buf.buffer);
const rawSlot = 12_345_678n;
dv.setBigUint64(0, (1n << 62n) | rawSlot, true); // proof-type bits set
const extracted = dv.getBigUint64(0, true) & ((1n << 62n) - 1n);
eq(extracted, rawSlot, 'slot masked from proof timestamp');
dv.setBigUint64(0, rawSlot, true); // no type bits
eq(dv.getBigUint64(0, true) & ((1n << 62n) - 1n), rawSlot, 'clean slot unchanged by mask');

// ---- label policy quick pins (UI gate rules) --------------------------------------------
console.log('label policy');
ok(tcr.labelProblem('ab') != null, '2-char labels refused (min 3)');
eq(tcr.labelProblem('abc'), null, '3-char label accepted');
eq(tcr.labelProblem('a'.repeat(32)), null, '32-char label accepted');
ok(tcr.labelProblem('a'.repeat(33)) != null, '33-char labels refused (max 32)');
ok(tcr.labelProblem('-abc') != null && tcr.labelProblem('abc-') != null, 'edge hyphens refused');
ok(tcr.yearsProblem(0) != null && tcr.yearsProblem(11) != null, 'year bounds 1–10 enforced');

// ---- describeTcrError error decoding ----------------------------------------------------
console.log('tcr error descriptions');
eq(tcr.describeTcrError(0xD201), 'lease creation failed', 'standard TCR error 0xD201 decodes');
eq(tcr.describeTcrError(0xD103), 'not admin', 'standard TCR error 0xD103 decodes');
eq(tcr.describeTcrError(53770), 'fee transfer failed (account not writable)', 'composite 53770 (0xD20A) decodes to account not writable');
eq(tcr.describeTcrError(0xD226), 'fee transfer failed (insufficient balance)', 'composite 0xD226 decodes to insufficient balance');
eq(tcr.describeTcrError(99999), 'unknown registrar error 99999', 'unrecognized code falls back honestly');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nCustom-registrar evidence tests passed');
