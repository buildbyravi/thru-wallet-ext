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
import assert from 'node:assert/strict';
import { Pubkey } from '@thru/sdk';
import { TokenMintAccount, TokenAccount } from '@thru/programs/token';

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

// ---- tiered schedule: the three Betanet tiers, priced by label LENGTH ---------------------
// Owner directive 2026-10-30: 3 chars = 0.0001 THRU/yr, 4 = 0.00001, 5+ = 0.000001
// (base units below). These numbers come from the release plan, NOT from a live read — the
// live read is what `getCustomRegistrar` does at runtime, and this test only pins the mapping
// from a config of that shape to a price. A deployment that sets different values changes
// what the wallet shows without changing this file.
console.log('tiered pricing');
{
  const tiers = {
    fee3PerYear: 100_000n, fee4PerYear: 10_000n, fee5PlusPerYear: 1_000n,
    feePerYear: 1_000n, layout: 2, feeEnforced: true, feePolicy: 1,
  };
  eq(tcr.tcrPricePerYear(tiers, 'abc'), 100_000n, '3-char label → 0.0001 THRU/yr');
  eq(tcr.tcrPricePerYear(tiers, 'abcd'), 10_000n, '4-char label → 0.00001 THRU/yr');
  eq(tcr.tcrPricePerYear(tiers, 'abcde'), 1_000n, '5-char label → 0.000001 THRU/yr');
  eq(tcr.tcrPricePerYear(tiers, 'a'.repeat(32)), 1_000n, '32-char label → 5+ tier');
  eq(tcr.tcrTotalForTerm(tiers, 'abc', 3), 300_000n, '3-char × 3 years = 0.0003 THRU');
  eq(tcr.tcrTotalForTerm(tiers, 'abcde', 10), 10_000n, '5-char × 10 years = 0.00001 THRU');

  // A layout-1 config (what the deployed program wrote) prices flat, and must keep doing so.
  const flat = { fee3PerYear: 1_000n, fee4PerYear: 1_000n, fee5PlusPerYear: 1_000n, feePerYear: 1_000n };
  eq(tcr.tcrPricePerYear(flat, 'abc'), 1_000n, 'a layout-1 config prices a 3-char name at its flat fee');
  eq(tcr.tcrPricePerYear(flat, 'abcdef'), 1_000n, 'and a 6-char name at the same flat fee');
}

// ---- the fee is only money when the program enforces it ----------------------------------
console.log('fee enforcement vocabulary');
{
  eq(tcr.feePolicyName(tcr.TCR_FEE_POLICY.bestEffort), 'best effort', 'policy 0 is best effort');
  eq(tcr.feePolicyName(tcr.TCR_FEE_POLICY.strict), 'strict', 'policy 1 is strict');
  eq(tcr.TCR_ERRORS[0xd206], 'the registrar fee could not be collected', 'strict refusal has its own code');
  eq(tcr.TCR_ERRORS[0xd207], 'not enough balance to pay the registrar fee', 'insufficient fee is distinguished');
  // The two new codes must not collide with the VM-composite decoding space (0xD2xx | syscall).
  ok(!(0xd206 in { 0xd226: 1 }) && 0xd206 !== 0xd20a, 'new codes do not shadow the live 0xD20A failure');
}

console.log('custom registrar write boundaries (stubbed builder and RPC)');
{
  globalThis.fetch = async () => { throw new Error('No network allowed in this suite'); };
  const storage = new Map();
  const session = new Map();
  const area = map => ({
    async get(key) { return structuredClone(key == null ? Object.fromEntries(map) : { [key]: map.get(key) }); },
    async set(values) { for (const [k, v] of Object.entries(values)) map.set(k, structuredClone(v)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); },
  });
  globalThis.chrome = { storage: { local: area(storage), session: area(session) },
    runtime: { async sendMessage() {} } };
  const vault = await import('../src/lib/vault.js');
  const thru = await import('../src/lib/thru-client.js');
  const registrar = await import('../src/background/services/registrar-service.js');
  const network = await import('../src/background/services/network-service.js');
  const pending = await import('../src/background/services/pending-tx-service.js');
  await vault.createVault('OfflineTest123!');
  await network.getActiveNetworkConfig();
  const payer = await vault.getActiveAccount();
  const client = thru.getClient();
  const label = 'repair';
  const domain = await domainAccountAddress(rootAddress, label);
  const lease = tcr.tcrLeaseAddress(program, label);
  let policy = tcr.TCR_FEE_POLICY.strict;
  let treasury = payer.address;
  let price = 1000n;
  let leaseOwner = payer.address;
  let leaseExists = false;
  let domainExists = false;
  let payerExists = true;
  let payerReads = 0;
  let mutatePayerRead = null;
  let mutateProof = null;
  let builds = 0;
  let sends = 0;
  let activationBuilds = 0;
  let activationMutation = null;
  const missing = () => { throw Object.assign(new Error('absent'), { code: 5 }); };
  function configBytes() {
    const bytes = new Uint8Array(tcr.TCR_CONFIG_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint32(tcr.TCR_CFG.magic, tcr.TCR_CONFIG_MAGIC, true);
    bytes[tcr.TCR_CFG.version] = tcr.TCR_CONFIG_LAYOUT_V2;
    bytes[tcr.TCR_CFG.rootNameLen] = 4;
    bytes.set(new TextEncoder().encode('thru'), tcr.TCR_CFG.rootName);
    bytes.set(Pubkey.from(payer.address).toBytes(), tcr.TCR_CFG.admin);
    bytes.set(Pubkey.from(treasury).toBytes(), tcr.TCR_CFG.treasury);
    bytes.set(Pubkey.from(rootAddress).toBytes(), tcr.TCR_CFG.rootAddress);
    for (const field of ['feePerYear', 'fee3Char', 'fee4Char', 'fee5PlusChar']) view.setBigUint64(tcr.TCR_CFG[field], price, true);
    bytes[tcr.TCR_CFG.feePolicy] = policy;
    return bytes;
  }
  function leaseBytes() {
    const bytes = new Uint8Array(tcr.TCR_LEASE_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint32(tcr.TCR_LSE.magic, tcr.TCR_LEASE_MAGIC, true);
    bytes[tcr.TCR_LSE.version] = tcr.TCR_LAYOUT_VERSION;
    bytes[tcr.TCR_LSE.labelLen] = label.length;
    bytes.set(new TextEncoder().encode(label), tcr.TCR_LSE.label);
    bytes.set(Pubkey.from(leaseOwner).toBytes(), tcr.TCR_LSE.owner);
    view.setBigUint64(tcr.TCR_LSE.expiresAt, 2000000000n, true);
    return bytes;
  }
  client.accounts.get = async address => {
    if (address === configAddress) return { meta: { balance: 1n, owner: Pubkey.from(program) }, data: { data: configBytes() } };
    if (address === lease) return leaseExists ? { meta: { balance: 1n }, data: { data: leaseBytes() } } : missing();
    if (address === domain) return domainExists ? { meta: { balance: 1n } } : missing();
    if (address === payer.address) {
      payerReads++;
      if (mutatePayerRead) await mutatePayerRead(payerReads);
      return payerExists ? { meta: { balance: 1000000n } } : missing();
    }
    return missing();
  };
  client.proofs.generate = async () => {
    if (mutateProof) await mutateProof();
    const proof = new Uint8Array(8);
    new DataView(proof.buffer).setBigUint64(0, 123n, true);
    return { proof };
  };
  client.transactions.buildAndSign = async options => {
    if (options.program === program) {
      builds++;
      assert.equal(options.header.fee, payerExists ? 1n : 0n);
    } else {
      assert.equal(options.program, NETWORKS.betanet.accountCreateProgramId);
      activationBuilds++;
    }
    return { rawTransaction: options.program, transaction: { startSlot: 123n, expiryAfter: 10000 } };
  };
  client.transactions.sendAndTrack = async function* (raw) {
    if (raw === NETWORKS.betanet.accountCreateProgramId) {
      payerExists = true;
      activationMutation?.();
    } else sends++;
    yield { executionResult: { vmError: 0 } };
  };
  client.transactions.listForAccount = async () => ({ transactions: [] });
  const expected = async () => ({ name: label, years: 1, expectedNetworkId: 'betanet',
    expectedAccountAddress: payer.address, expectedPricePerYear: '1000',
    expectedRegistrarFacts: registrar.registrarFacts(await registrar.getCustomRegistrar({ skipCache: true })) });

  leaseExists = true;
  const renewed = await registrar.renewCustom(await expected());
  assert.equal(renewed.domainAddress, domain);
  assert.equal(renewed.rootAddress, rootAddress);
  assert.equal(sends, 1);
  ok(true, 'custom renewal reaches submission and returns its derived domain address');
  leaseExists = false;
  await registrar.registerCustom(await expected());
  assert.equal(sends, 2);
  ok(true, 'unchanged custom registration reaches submission');

  const other = Pubkey.from(new Uint8Array(32).fill(77)).toThruFmt();
  for (const [mutate, code] of [
    [() => { treasury = other; }, 'REVIEW_REGISTRAR_CHANGED'],
    [() => { price = 2000n; }, 'REVIEW_PRICE_CHANGED'],
    [() => { policy = tcr.TCR_FEE_POLICY.bestEffort; }, 'REVIEW_PRICE_CHANGED'],
    [() => { domainExists = true; }, 'NAME_TAKEN'],
  ]) {
    const params = await expected();
    const before = builds;
    mutateProof = mutate;
    await assert.rejects(registrar.registerCustom(params), e => e.code === code);
    assert.equal(builds, before, 'facts changed during proof generation must refuse before signing');
    mutateProof = null;
    treasury = payer.address; price = 1000n; policy = tcr.TCR_FEE_POLICY.strict; domainExists = false;
  }
  ok(true, 'proof-time treasury, price, policy and availability changes refuse before build');

  leaseExists = true;
  payerReads = 0;
  mutatePayerRead = count => { if (count === 2) leaseOwner = other; };
  const beforeRenew = builds;
  await assert.rejects(registrar.renewCustom(await expected()), e => e.code === 'NOT_NAME_OWNER');
  assert.equal(builds, beforeRenew);
  mutatePayerRead = null; leaseOwner = payer.address;
  ok(true, 'renewal rechecks lease owner after its awaited payer read');

  // Best-effort allows activation; the subsequent registrar write still needs fresh facts.
  policy = tcr.TCR_FEE_POLICY.bestEffort;
  payerExists = false;
  const staleBeforeActivation = await expected();
  staleBeforeActivation.expectedRegistrarFacts.treasuryAddress = other;
  await assert.rejects(registrar.renewCustom(staleBeforeActivation), e => e.code === 'REVIEW_REGISTRAR_CHANGED');
  assert.equal(activationBuilds, 0, 'stale review refuses before account activation');
  activationMutation = () => { treasury = other; };
  await assert.rejects(registrar.renewCustom(await expected()), e => e.code === 'REVIEW_REGISTRAR_CHANGED');
  assert.equal(activationBuilds, 1);
  assert.equal(builds, beforeRenew);
  ok(true, 'activation completes but changed registrar facts prevent the renewal build');
  activationMutation = null; treasury = payer.address;

  leaseExists = false;
  const beforeNetworkChange = builds;
  const boundParams = await expected();
  mutateProof = () => thru.configureNetwork({ ...NETWORKS.betanet, id: 'localnet' });
  await assert.rejects(registrar.registerCustom(boundParams), e => e.code === 'REVIEW_NETWORK_CHANGED');
  assert.equal(builds, beforeNetworkChange);
  mutateProof = null;
  thru.configureNetwork(NETWORKS.betanet);
  const lockedParams = await expected();
  mutateProof = () => vault.lock();
  await assert.rejects(registrar.registerCustom(lockedParams), /locked/i);
  assert.equal(builds, beforeNetworkChange);
  mutateProof = null;
  await vault.unlock('OfflineTest123!');
  ok(true, 'proof-time network changes and wallet locking refuse before the registrar build');

  // Exercise the official payment fallback with deployed and imported symbols disagreeing.
  const reg = await import('../src/lib/registrar.js');
  const ns = await import('../src/lib/name-service.js');
  const tokens = await import('../src/background/services/token-service.js');
  const mint = Pubkey.from(new Uint8Array(32).fill(88)).toThruFmt();
  await thru.saveDeployedToken({ mint, ticker: 'DEPLOYED', decimals: 6 }, 'betanet');
  storage.set('thru_prefs', { version: 1, customTokens: [{ mintAddress: mint, symbol: 'IMPORTED', networkId: 'betanet' }] });
  const officialConfig = new Uint8Array(reg.REG_CONFIG_SIZE);
  for (const [address, offset] of [[reg.NAME_SERVICE_PROGRAM, 0], [rootAddress, 32], [treasury, 64], [mint, 96], [NETWORKS.betanet.tokenProgramId, 128]]) {
    officialConfig.set(Pubkey.from(address).toBytes(), offset);
  }
  officialConfig.set(new TextEncoder().encode('thru'), 160);
  new DataView(officialConfig.buffer).setUint32(224, 4, true);
  new DataView(officialConfig.buffer).setBigUint64(228, 1n, true);
  const tokenAddress = await thru.deriveTokenAccountAddress(payer.address, mint);
  client.accounts.get = async address => {
    if (address === ns.registrarConfigAddress()) return { meta: { balance: 1n, owner: Pubkey.from(reg.THRU_REGISTRAR_PROGRAM) }, data: { data: officialConfig } };
    if (address === mint) return { meta: { balance: 1n, owner: Pubkey.from(NETWORKS.betanet.tokenProgramId) },
      data: { data: TokenMintAccount.builder().set_decimals(6).set_supply(100n).build() } };
    if (address === tokenAddress) return { meta: { balance: 1n }, data: { data: TokenAccount.builder().set_amount(100n).build() } };
    if (address === payer.address) return { meta: { balance: 1000000n } };
    return missing();
  };
  const registry = await registrar.getRegistry();
  const row = (await tokens.listDeployedTokens()).find(t => t.mintAddress === mint);
  assert.equal(row.symbol, 'DEPLOYED');
  const stopAtBuild = new Error('Payment facts accepted; no signing');
  client.transactions.buildAndSign = async () => { throw stopAtBuild; };
  await assert.rejects(registrar.purchaseDomain({ name: label, years: 1,
    expectedNetworkId: 'betanet', expectedAccountAddress: payer.address, expectedPricePerYear: '1',
    expectedRegistrarFacts: registrar.registrarFacts(registry, { symbol: row.symbol, decimals: 6, verified: true }) }),
  error => error === stopAtBuild);
  ok(true, 'official payment symbol matches review deployed-token precedence without an import cycle');
  await pending.clearAll();
}

if (failures) {
  console.error(`\n${failures} failure(s) in test-name-custom-registrar`);
  process.exit(1);
}
console.log('\nAll custom-registrar evidence and tiered pricing tests passed');
