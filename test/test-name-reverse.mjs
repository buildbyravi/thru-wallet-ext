#!/usr/bin/env node
// Reverse domain resolution tests: primary mapping, bidirectional verification,
// and on-chain ownership checks.
import assert from 'node:assert/strict';
import { Pubkey } from '@thru/sdk';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log(`  ok - ${msg}`); }
  else { fail += 1; console.error(`  FAIL - ${msg}`); }
}

const asAddress = (byte) => Pubkey.from(new Uint8Array(32).fill(byte)).toThruFmt();

// Storage shim
const storage = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: storage.get(keys) };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, storage.get(k)]));
        return Object.fromEntries(storage.entries());
      },
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) storage.set(k, v); },
      remove: async (key) => { for (const k of Array.isArray(key) ? key : [key]) storage.delete(k); },
      clear: async () => storage.clear(),
    },
  },
};

const thruClient = await import('../src/lib/thru-client.js');
const primaryNameService = await import('../src/background/services/primary-name-service.js');
const { scopedKey } = await import('../src/shared/network-scope.js');
const ns = await import('../src/lib/name-service.js');

const ALICE = asAddress(1);
const BOB = asAddress(2);
const THRU_ROOT = await ns.rootRegistrarAddress('thru');
const DOMAIN_ALICE = await ns.domainAccountAddress(THRU_ROOT, 'alice');

function buildDomainBytes({ owner, name, records = [], parent = THRU_ROOT }) {
  const enc = new TextEncoder();
  const nb = enc.encode(name);
  const out = new Uint8Array(ns.NS_DOMAIN_HEADER + records.length * ns.NS_RECORD_SIZE);
  out[0] = ns.NS_KIND_DOMAIN;
  out.set(Pubkey.from(parent).toBytes(), 0x01);
  out.set(Pubkey.from(owner).toBytes(), 0x21);
  out.set(nb, 0x41);
  const dv = new DataView(out.buffer);
  dv.setUint32(0x81, nb.length, true);
  dv.setBigUint64(0x85, 1_700_000_000n, true);
  dv.setUint32(0x8d, records.length, true);

  records.forEach((rec, idx) => {
    const base = ns.NS_DOMAIN_HEADER + idx * ns.NS_RECORD_SIZE;
    const kb = enc.encode(rec.key);
    const vb = enc.encode(rec.value);
    dv.setUint32(base, kb.length, true);
    out.set(kb, base + 0x04);
    dv.setUint32(base + 0x24, vb.length, true);
    out.set(vb, base + 0x28);
  });
  return out;
}

const ID_ROOT = await ns.rootRegistrarAddress('id');
const DOMAIN_BOB_ID = await ns.domainAccountAddress(ID_ROOT, 'bob-id');

let currentDomainData = null;
let idDomainData = null;
const client = thruClient.getClient();
client.accounts.get = async (address) => {
  if (address === DOMAIN_BOB_ID && idDomainData) {
    return {
      meta: { balance: 1n, owner: Pubkey.from(ns.NAME_SERVICE_PROGRAM) },
      data: idDomainData,
    };
  }
  if (address === DOMAIN_ALICE && currentDomainData) {
    return {
      meta: { balance: 1n, owner: Pubkey.from(ns.NAME_SERVICE_PROGRAM) },
      data: currentDomainData,
    };
  }
  const err = new Error('account not found');
  err.code = 5;
  throw err;
};

console.log('[1] Invalid or unknown address inputs');
{
  const res1 = await primaryNameService.reverseLookup({ address: 'not-an-address' });
  ok(res1.resolved === false && res1.reason === 'INVALID_ADDRESS', 'invalid address format is safely rejected');

  const res2 = await primaryNameService.reverseLookup({ address: BOB, networkId: 'betanet' });
  ok(res2.resolved === false && res2.reason === 'NO_CANDIDATE', 'address with no registered or primary domain returns no candidate');
}

console.log('[2] Reverse resolution with on-chain verification');
{
  // Set up storage with a primary link for ALICE -> alice
  const primaryKey = scopedKey('thru_primary_names', 'betanet');
  storage.set(primaryKey, {
    [ALICE]: {
      name: 'alice',
      rootAddress: THRU_ROOT,
      domainAddress: DOMAIN_ALICE,
      verifiedAt: Date.now(),
    },
  });

  // Mock domain account where ALICE is the on-chain owner and has an 'addr' text record
  currentDomainData = buildDomainBytes({
    owner: ALICE,
    name: 'alice',
    records: [
      { key: 'addr', value: ALICE },
      { key: 'twitter', value: '@alice' },
    ],
  });

  const res = await primaryNameService.reverseLookup({ address: ALICE, networkId: 'betanet' });
  ok(res.resolved === true, 'resolves successfully');
  ok(res.name === 'alice.thru', 'returns canonical .thru name');
  ok(res.verified === true, 'verified against live on-chain owner');
  ok(res.hasReverseRecord === true, 'detects explicit addr text record for bidirectional proof');

  // Test ownership mismatch
  currentDomainData = buildDomainBytes({
    owner: BOB, // Bob acquired the name on-chain
    name: 'alice',
    records: [],
  });

  const resMismatch = await primaryNameService.reverseLookup({ address: ALICE, networkId: 'betanet' });
  ok(resMismatch.resolved === false && resMismatch.reason === 'NOT_NAME_OWNER', 'detects owner mismatch and refuses to reverse-resolve');
}

console.log('[3] The read is bound to the active network, and NO_CANDIDATE stays honest');
{
  const { getActiveNetworkConfig } = await import('../src/background/services/network-service.js');
  const active = await getActiveNetworkConfig();
  const other = active.id === 'betanet' ? 'localnet' : 'betanet';

  // Candidates come from THIS wallet's tracked domains, which are stored per network. A caller
  // that names another network would otherwise read a registry the active screen never shows.
  const crossNet = await primaryNameService.reverseLookup({ address: ALICE, networkId: other });
  ok(crossNet.resolved === false && crossNet.reason === 'NETWORK_MISMATCH',
    'a request for a non-active network is refused, not answered from the wrong registry');

  const sameNet = await primaryNameService.reverseLookup({ address: ALICE, networkId: active.id });
  ok(sameNet.reason !== 'NETWORK_MISMATCH', 'control: the active network id is accepted');

  const unknown = await primaryNameService.reverseLookup({ address: asAddress(88) });
  ok(unknown.resolved === false && unknown.reason === 'NO_CANDIDATE' && unknown.name === null,
    'an address this wallet knows nothing about returns NO_CANDIDATE and no name');
  ok(!JSON.stringify(unknown).includes('owns no'), 'the reason never claims the address owns no name');
}

console.log('[4] The reported TLD is the record\'s own root, never a hardcoded .thru');
{
  // The first version appended '.thru' to every unqualified label, so a `.id` domain was
  // reported to the Send screen as `<name>.thru` — a wrong name on the one line the user reads
  // before sending. The suffix now comes from the tracked record's root.
  const primaryKey = scopedKey('thru_primary_names', 'betanet');
  const existing = storage.get(primaryKey) || {};
  storage.set(primaryKey, {
    ...existing,
    [BOB]: { name: 'bob-id', rootAddress: ID_ROOT, domainAddress: DOMAIN_BOB_ID, verifiedAt: Date.now() },
  });
  idDomainData = buildDomainBytes({ owner: BOB, name: 'bob-id', parent: ID_ROOT, records: [] });

  const res = await primaryNameService.reverseLookup({ address: BOB });
  ok(res.resolved === true && res.name === 'bob-id.id', `a .id record reports .id (got ${res.name})`);
  ok(res.tld === 'id', 'the response names the root rather than implying one');
  ok(!res.name.endsWith('.thru'), 'no .thru suffix is invented for another root');
}

console.log(`\nname-reverse test summary: ${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
