#!/usr/bin/env node
// Name service text records: wire validation, instruction layout, the review pipeline, and the
// write path itself.
//
// [1]-[3] are pure: encoding, boundaries, and the decoder's rendering of a facts bag.
// [4]-[7] drive the real modules against a stubbed SDK — the three-state domain facts, all four
// recheck outcomes, and name.setRecord through the actual API router (signing guard, review
// binding, and every refusal path with a proof that no signature was produced). These replace a
// header that claimed setRecord coverage the file did not have.
import assert from 'node:assert/strict';
import * as ns from '../src/lib/name-service.js';
import { Pubkey } from '@thru/sdk';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log(`  ok - ${msg}`); }
  else { fail += 1; console.error(`  FAIL - ${msg}`); }
}

const asAddress = (byte) => Pubkey.from(new Uint8Array(32).fill(byte)).toThruFmt();

console.log('[1] Text record wire encoding & instruction layout');
{
  const domainAddr = asAddress(10);
  const inst = ns.buildAppendRecordInstructionData({
    domainAddress: domainAddr,
    key: 'twitter',
    value: '@alice_thru',
    indexOf: (a) => (a === domainAddr ? 3 : 0),
  });

  const dv = new DataView(inst.buffer);
  ok(dv.getUint32(0, true) === ns.NS_OP_APPEND_RECORD, 'opcode is NS_OP_APPEND_RECORD (2)');
  ok(dv.getUint16(4, true) === 3, 'domain account index resolved');
  ok(dv.getUint16(6, true) === 0, 'authority defaults to fee payer (slot 0)');
  ok(dv.getUint32(8, true) === 'twitter'.length, 'key length correctly encoded');
  
  const dec = new TextDecoder();
  const keyBytes = inst.slice(12, 12 + 'twitter'.length);
  ok(dec.decode(keyBytes) === 'twitter', 'key string correctly placed at offset 12');
  
  ok(dv.getUint32(12 + ns.NS_KEY_FIELD, true) === '@alice_thru'.length, 'value length correctly encoded');
  const valBytes = inst.slice(16 + ns.NS_KEY_FIELD, 16 + ns.NS_KEY_FIELD + '@alice_thru'.length);
  ok(dec.decode(valBytes) === '@alice_thru', 'value string correctly placed');
  ok(inst.length === 4 + 2 + 2 + 4 + ns.NS_KEY_FIELD + 4 + ns.NS_VALUE_FIELD, 'fixed record instruction size');
}

console.log('[2] Input boundary enforcement');
{
  const domainAddr = asAddress(10);
  let threw = false;
  try {
    ns.buildAppendRecordInstructionData({ domainAddress: domainAddr, key: '', value: 'val', indexOf: () => 1 });
  } catch { threw = true; }
  ok(threw, 'empty key is rejected');

  threw = false;
  try {
    ns.buildAppendRecordInstructionData({ domainAddress: domainAddr, key: 'x'.repeat(33), value: 'val', indexOf: () => 1 });
  } catch { threw = true; }
  ok(threw, 'key exceeding 32 bytes is rejected');

  threw = false;
  try {
    ns.buildAppendRecordInstructionData({ domainAddress: domainAddr, key: 'k', value: 'v'.repeat(257), indexOf: () => 1 });
  } catch { threw = true; }
  ok(threw, 'value exceeding 256 bytes is rejected');
}

console.log('[3] Review decoder integration');
{
  await import('../src/shared/tx-review/decoders/index.js');
  const { decodeReview } = await import('../src/shared/tx-review/registry.js');
  const { assertReviewContent } = await import('../src/shared/tx-review/model.js');
  
  const content = decodeReview('domain-record', {
    network: { id: 'betanet', label: 'Betanet', environment: 'testnet', isTestnet: true },
    account: { address: asAddress(1), label: 'Main' },
    facts: {
      name: 'alice',
      tld: 'thru',
      key: 'github',
      value: 'alice-dev',
      rootAddress: asAddress(2),
      domainAddress: asAddress(3),
      domainExists: true,
      isOwner: true,
      ownerAddress: asAddress(1),
      unchanged: false,
      keyProblem: null,
      valueProblem: null,
      program: {
        name: 'Thru Name Service',
        address: ns.NAME_SERVICE_PROGRAM,
        verified: true,
      },
    },
  });

  assertReviewContent(content);
  ok(content.operation.id === 'domain-record', 'operation kind matches');
  ok(content.summary.some(r => r.label === 'Record Key' && r.value === 'github'), 'record key rendered in summary');
  ok(content.summary.some(r => r.label === 'Record Value' && r.value === 'alice-dev'), 'record value rendered in summary');
  ok(content.assets.fee.amountUnits === '0', 'fee is zero base units');
  ok(content.warnings.length === 0, 'no warnings for valid owned record update');

  const unowned = decodeReview('domain-record', {
    network: { id: 'betanet', label: 'Betanet', environment: 'testnet', isTestnet: true },
    account: { address: asAddress(1), label: 'Main' },
    facts: {
      name: 'alice',
      tld: 'thru',
      key: 'github',
      value: 'alice-dev',
      rootAddress: asAddress(2),
      domainAddress: asAddress(3),
      domainExists: true,
      isOwner: false,
      ownerAddress: asAddress(99),
      unchanged: false,
      keyProblem: null,
      valueProblem: null,
      program: {
        name: 'Thru Name Service',
        address: ns.NAME_SERVICE_PROGRAM,
        verified: true,
      },
    },
  });

  ok(unowned.warnings.some(w => w.id === 'not-name-owner' && w.blocking === true), 'unowned domain creates blocking warning');
}

// ---------------------------------------------------------------------------------------
// [4]-[7] drive the REAL code: background/services/review/kinds.js (facts + recheck) and
// background/services/name-service.js (setRecord), through the real API router. Until
// 2026-10-29 this file's header claimed setRecord authorization coverage while nothing here
// called setRecord, domainRecordFacts or domainRecordRecheck — so every v31 defect in them
// (the swapped account row, the recheck TypeError, the RPC-outage-as-absence collapse, the
// auth:'unlocked' declaration on a signing write) shipped with the suite green.
// ---------------------------------------------------------------------------------------

function memStore() {
  const data = new Map();
  return {
    async get(key) {
      if (key == null) return Object.fromEntries(data);
      if (Array.isArray(key)) return Object.fromEntries(key.map((k) => [k, data.get(k)]));
      return { [key]: data.get(key) };
    },
    async set(next) { for (const [k, v] of Object.entries(next)) data.set(k, v); },
    async remove(key) { for (const k of Array.isArray(key) ? key : [key]) data.delete(k); },
    async clear() { data.clear(); },
  };
}
globalThis.chrome = {
  runtime: { id: 'test', sendMessage: () => Promise.resolve(), onMessage: { addListener() {} } },
  storage: { local: memStore(), session: memStore() },
};

const { handleApiRequest } = await import('../src/background/api-router.js');
const thruClient = await import('../src/lib/thru-client.js');
const kinds = await import('../src/background/services/review/kinds.js');
const prefsService = await import('../src/background/services/preferences-service.js');
await import('../src/shared/tx-review/decoders/index.js');
const { decodeReview } = await import('../src/shared/tx-review/registry.js');
const model = await import('../src/shared/tx-review/model.js');

async function call(method, params = {}) {
  const res = await handleApiRequest({ method, params });
  if (!res.ok) throw new Error(`${method}: ${res.error.code} ${res.error.message}`);
  return res.data;
}
async function denied(method, params = {}) {
  const res = await handleApiRequest({ method, params });
  return res.ok ? null : res.error;
}

const created = await call('wallet.create', { password: 'Records123!' });
const active = await call('account.getActive');
const ME = active.address;
ok(ME === created.address, 'test wallet owns the active account it signs with');

const ROOT = asAddress(2);
const DOMAIN = await ns.domainAccountAddress(ROOT, 'alice');

function domainBytes({ owner, name = 'alice', records = [] }) {
  const enc = new TextEncoder();
  const nb = enc.encode(name);
  const out = new Uint8Array(ns.NS_DOMAIN_HEADER + records.length * ns.NS_RECORD_SIZE);
  out[0] = ns.NS_KIND_DOMAIN;
  out.set(Pubkey.from(ROOT).toBytes(), 0x01);
  out.set(Pubkey.from(owner).toBytes(), 0x21);
  out.set(nb, 0x41);
  const dv = new DataView(out.buffer);
  dv.setUint32(0x81, nb.length, true);
  dv.setBigUint64(0x85, 1_700_000_000n, true);
  dv.setUint32(0x8d, records.length, true);
  records.forEach((r, i) => {
    const base = ns.NS_DOMAIN_HEADER + i * ns.NS_RECORD_SIZE;
    const kb = enc.encode(r.key);
    const vb = enc.encode(r.value);
    dv.setUint32(base, kb.length, true);
    out.set(kb, base + 4);
    dv.setUint32(base + 0x24, vb.length, true);
    out.set(vb, base + 0x28);
  });
  return out;
}

const client = thruClient.getClient();
const signed = [];
let broadcasts = 0;
let mode = 'owned';
client.accounts.get = async (address) => {
  if (address !== DOMAIN) throw Object.assign(new Error('Account not found'), { code: 5 });
  if (mode === 'missing') throw Object.assign(new Error('Account not found'), { code: 5 });
  if (mode === 'unreadable') throw new Error('503 backend unavailable');
  const owner = mode === 'foreign' ? asAddress(99) : ME;
  const records = mode === 'different' ? [{ key: 'twitter', value: '@old' }]
    : mode === 'same' ? [{ key: 'twitter', value: '@alice' }] : [];
  const bytes = mode === 'garbage' ? new Uint8Array(9).fill(1) : domainBytes({ owner, records });
  return { meta: { balance: 5_000_000n }, data: bytes };
};
client.transactions.buildAndSign = async (request) => {
  signed.push(request);
  return { rawTransaction: { marker: signed.length } };
};
client.transactions.sendAndTrack = async function* () {
  broadcasts += 1;
  yield { signature: { value: new Uint8Array(64).fill(7) }, executionResult: { vmError: 0 } };
};

const NET = (await call('network.getActive')).id;

console.log('[4] domainRecordFacts: existence and ownership are three-state');
{
  const spec = kinds.getKind('domain-record');
  ok(Boolean(spec), 'domain-record is a registered review kind');

  mode = 'owned';
  const facts = await spec.facts({ name: 'alice', rootAddress: ROOT, key: 'twitter', value: '@alice' },
    { account: { address: ME }, network: { id: NET } });
  ok(facts.domainExists === true && facts.isOwner === true, 'a readable owned domain reads true/true');
  // Reviewer #28: an unreadable, unrecognised root is not labelled `.thru` any more. The
  // fake root here parses as nothing and is not a derived known root, so the label is null and
  // the decoder says the namespace is unverified instead of guessing one.
  ok(facts.tld === null, 'an unverifiable root is left unlabelled instead of being called .thru');

  mode = 'unreadable';
  const down = await spec.facts({ name: 'alice', rootAddress: ROOT, key: 'twitter', value: '@alice' },
    { account: { address: ME }, network: { id: NET } });
  ok(down.domainExists === null && down.isOwner === null,
    'an RPC failure leaves exists/owner UNKNOWN (null), not false');

  mode = 'foreign';
  const foreign = await spec.facts({ name: 'alice', rootAddress: ROOT, key: 'twitter', value: '@alice' },
    { account: { address: ME }, network: { id: NET } });
  ok(foreign.domainExists === true && foreign.isOwner === false, 'a foreign owner is a proven false');

  mode = 'garbage';
  const junk = await spec.facts({ name: 'alice', rootAddress: ROOT, key: 'twitter', value: '@alice' },
    { account: { address: ME }, network: { id: NET } });
  ok(junk.domainExists === true && junk.isOwner === null,
    'an account that exists but does not parse proves existence, not non-ownership');

  mode = 'different';
  const diff = await spec.facts({ name: 'alice', rootAddress: ROOT, key: 'twitter', value: '@alice' },
    { account: { address: ME }, network: { id: NET } });
  ok(diff.unchanged === false && diff.existingValue === '@old',
    'a key holding another value is reported as existing, not as unchanged');

  // The card must not present APPEND opcode 2 as a replace, and must block on unknown.
  const card = decodeReview('domain-record', { network: { id: NET, label: 'Betanet', environment: 'testnet' },
    account: { address: ME, label: 'Main' }, facts: diff });
  ok(/^Add a .* record to /.test(card.operation.name), 'the operation says ADD, not SET',
    card.operation.name);
  ok(card.warnings.some((w) => w.id === 'record-appends' && !w.blocking),
    'an existing key raises the append notice without blocking');

  const unknownCard = decodeReview('domain-record', { network: { id: NET, label: 'Betanet', environment: 'testnet' },
    account: { address: ME, label: 'Main' }, facts: down });
  ok(unknownCard.warnings.some((w) => w.id === 'domain-unverified' && w.blocking === true),
    'an unreadable domain blocks with "could not be read", not "does not exist"');
  ok(!unknownCard.warnings.some((w) => w.id === 'domain-absent'),
    'an RPC outage never renders as a proven absence');
  ok(model.stateFromWarnings(unknownCard.warnings) === 'blocked', 'the unknown state is not signable');

  const foreignCard = decodeReview('domain-record', { network: { id: NET, label: 'Betanet', environment: 'testnet' },
    account: { address: ME, label: 'Main' }, facts: foreign });
  ok(foreignCard.warnings.some((w) => w.id === 'not-name-owner' && w.blocking === true),
    'a real foreign owner still raises the ownership warning');
  const row = foreignCard.execution.accounts[0];
  ok(row?.role === 'Domain account (written)' && row?.address === DOMAIN,
    'the account row carries a role label and an address, in that order');
}

console.log('[5] domainRecordRecheck: four outcomes, and no signature on any refusal');
{
  const spec = kinds.getKind('domain-record');
  mode = 'owned';
  const facts = await spec.facts({ name: 'alice', rootAddress: ROOT, key: 'twitter', value: '@alice' },
    { account: { address: ME }, network: { id: NET } });
  const record = { reviewId: 'r1', kind: 'domain-record', networkId: NET, accountAddress: ME, facts };

  const before = signed.length;
  const okRes = await spec.recheck(record).then(() => 'ok', (e) => e.code);
  ok(okRes === 'ok', 'the recheck passes on a stored record (it read record.binding before)');
  ok(signed.length === before, 'the recheck itself never signs');

  mode = 'unreadable';
  const downErr = await spec.recheck(record).then(() => null, (e) => e);
  ok(downErr?.code === 'REVIEW_UNAVAILABLE' && downErr?.retryable === true,
    'an unreadable domain is REVIEW_UNAVAILABLE + retryable, not NAME_TAKEN');

  mode = 'missing';
  const goneErr = await spec.recheck(record).then(() => null, (e) => e);
  // `name.setRecord` answers NAME_NOT_FOUND for the same state; the review gate must not use
  // NAME_TAKEN ("already registered") to describe an absent domain (reviewer #33).
  ok(goneErr?.code === 'NAME_NOT_FOUND', 'a domain that is genuinely gone is NAME_NOT_FOUND');

  mode = 'foreign';
  const stolenErr = await spec.recheck(record).then(() => null, (e) => e);
  ok(stolenErr?.code === 'NOT_NAME_OWNER', 'a domain that changed hands is NOT_NAME_OWNER');

  mode = 'garbage';
  const junkErr = await spec.recheck(record).then(() => null, (e) => e);
  ok(junkErr?.code === 'REVIEW_UNAVAILABLE', 'an unparseable domain is UNAVAILABLE, not NAME_TAKEN');
}

console.log('[6] name.setRecord: signing guard, review binding, refusals before signing');
{
  const params = { name: 'alice', rootAddress: ROOT, key: 'twitter', value: '@alice',
    expectedNetworkId: NET, expectedAccountAddress: ME };
  mode = 'owned';

  // D-003 default is session-only signing; the opt-in re-auth must actually gate this method.
  await prefsService.setSecurityPreferences({ requirePasswordForSigning: true });
  const before = signed.length;
  const needPw = await denied('name.setRecord', params);
  ok(needPw?.code === 'AUTH_REQUIRED', 'with per-signature re-auth on, setRecord demands a password');
  ok(signed.length === before, 'a refused password never reaches buildAndSign');

  const withPw = await call('name.setRecord', { ...params, password: 'Records123!' });
  ok(typeof withPw?.signature === 'string' && signed.length === before + 1,
    'control: the same call WITH the password signs once');
  ok(broadcasts === 1, 'the record write is broadcast once');

  await prefsService.setSecurityPreferences({ requirePasswordForSigning: false });
  const sessionSign = await call('name.setRecord', params);
  ok(typeof sessionSign?.signature === 'string', 'session-only signing still works by default (D-003)');

  const built = signed[signed.length - 1];
  ok(built.program === ns.NAME_SERVICE_PROGRAM, 'the write targets the name-service program');
  ok(built.header?.fee === 0n, 'the protocol fee is 0n by construction');
  ok(built.accounts?.readWrite?.includes(DOMAIN), 'the domain account is the writable account');

  const calls = signed.length;
  const netErr = await denied('name.setRecord', { ...params, expectedNetworkId: 'othernet' });
  ok(netErr?.code === 'REVIEW_NETWORK_CHANGED', 'a network change after review refuses the write');
  const acctErr = await denied('name.setRecord', { ...params, expectedAccountAddress: asAddress(77) });
  ok(acctErr?.code === 'REVIEW_ACCOUNT_CHANGED', 'an account change after review refuses the write');
  mode = 'missing';
  const notFoundErr = await denied('name.setRecord', params);
  ok(notFoundErr?.code === 'NAME_NOT_FOUND', 'a domain that does not exist refuses the write');
  ok(signed.length === calls, 'control: none of the three refusals built or signed anything');
  mode = 'garbage';
  const unreadableErr = await denied('name.setRecord', params);
  ok(unreadableErr?.code === 'DOMAIN_UNREADABLE', 'an unparseable domain refuses with DOMAIN_UNREADABLE');
  mode = 'foreign';
  const foreignErr = await denied('name.setRecord', params);
  ok(foreignErr?.code === 'NOT_NAME_OWNER', 'a domain owned by someone else refuses the write');
  ok(signed.length === calls, 'no refusal produced a signature');
}

console.log('[7] the contract declares what the handler actually does');
{
  const { METHODS, ERROR_CODES } = await import('../src/shared/contract/manifest.js');
  const { isTransactionMethod } = await import('../src/background/api-router.js');
  ok(METHODS['name.setRecord']?.auth === 'signing',
    'setRecord declares auth:signing (it was auth:unlocked while it built and signed)');
  ok(METHODS['name.setRecord']?.params.includes('password')
    && METHODS['name.setRecord']?.params.includes('expectedAccountAddress'),
    'the declared params are the ones the handler and router read');
  ok(isTransactionMethod('name.setRecord'), 'setRecord is registered as a signing operation');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/background/services/name-service.js', import.meta.url), 'utf8');
  const thrown = new Set([...source.matchAll(/coded\(\s*'([A-Z_]+)'/g)].map((m) => m[1]));
  const undeclared = [...thrown].filter((code) => typeof ERROR_CODES[code] !== 'string');
  ok(undeclared.length === 0, `every code setRecord can throw is declared (${undeclared.join(',') || 'none'})`);
}

console.log(`\nname-records test summary: ${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
