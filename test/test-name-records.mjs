#!/usr/bin/env node
// Name service text records tests: pure wire validation, instruction layout, review pipeline,
// and setRecord authorization / error conditions.
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

console.log(`\nname-records test summary: ${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
