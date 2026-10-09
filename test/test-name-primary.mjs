// Primary-name (domain) linking + notification explorer click (2026-10-09 UX slice).
//
// Proves, in-process and zero-network (thru-client stubbed at getClient(), same pattern as
// test-api-router.mjs / test-defi-intent.mjs):
//   [1] name.linkPrimary refuses a name that does not exist under the given root (NAME_NOT_FOUND)
//   [2] refuses a name whose domain account is owned by ANOTHER address (NOT_NAME_OWNER) —
//       the wallet never displays a name the active account does not own
//   [3] a correctly-owned name links, persists network-scoped, and is returned by
//       name.getPrimary (which re-verifies ownership against the chain on every call)
//   [4] if the chain later shows a different owner, the stored record is honestly dropped
//       (no stale badge), while an unreadable node keeps the last verified record
//   [5] unlink clears the record
//   [6] lookupName now actually READS the domain account data (raw bytes present, so the
//       owner check is real — regression guard for the tx-service wrapper that dropped data)
//   [7] notification clicks open the explorer of the SETTLING network (id-encoded), legacy
//       ids are ignored, and a network without an explorer is refused rather than guessed
import assert from 'node:assert/strict';

const storage = new Map();
const session = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: storage.get(keys) };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, storage.get(k)]));
        return Object.fromEntries(storage.entries());
      },
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) storage.set(k, v); },
      remove: async (key) => { for (const k of Array.isArray(key) ? key : [key]) storage.delete(k); },
      clear: async () => storage.clear(),
    },
    session: {
      get: async (key) => ({ [key]: session.get(key) }),
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) session.set(k, v); },
      remove: async (key) => { for (const k of Array.isArray(key) ? key : [key]) session.delete(k); },
      clear: async () => session.clear(),
    },
  },
};

const { handleApiRequest } = await import('../src/background/api-router.js');
const { SCOPED_KEYS } = await import('../src/shared/network-scope.js');
const { Pubkey } = await import('@thru/sdk');
const ns = await import('../src/lib/name-service.js');
const historyService = await import('../src/background/services/history-service.js');

let checks = 0;
function ok(label, cond = true) {
  checks += 1;
  assert.ok(cond, label);
  console.log(`  ok - ${label}`);
}

const walletRes = await handleApiRequest({ method: 'wallet.create', params: { password: 'Password123!' } });
assert.equal(walletRes.ok, true);
const SENDER = walletRes.data.address;
console.log('harness: wallet created (offline), sender', SENDER.slice(0, 12) + '…');

// ---- synthetic on-chain domain account ---------------------------------------
const ROOT_ADDRESS = Pubkey.from(new Uint8Array(32).fill(22)).toThruFmt();
const NAME = 'alice';
const LEAF = await ns.domainAccountAddress(ROOT_ADDRESS, NAME);

function buildDomainBytes(ownerAddress, name = NAME) {
  const out = new Uint8Array(ns.NS_DOMAIN_HEADER); // record_count = 0
  out[0] = ns.NS_KIND_DOMAIN;
  out.set(Pubkey.from(ROOT_ADDRESS).toBytes(), 0x01);
  out.set(Pubkey.from(ownerAddress).toBytes(), 0x21);
  const nb = new TextEncoder().encode(name);
  out.set(nb, 0x41);
  const dv = new DataView(out.buffer);
  dv.setUint32(0x81, nb.length, true);
  dv.setBigUint64(0x85, 1_700_000_000n, true);
  dv.setUint32(0x8d, 0, true);
  return out;
}

const SOMEONE_ELSE = Pubkey.from(new Uint8Array(32).fill(7)).toThruFmt();
let leafOwner = SOMEONE_ELSE;
let leafExists = true;
let nodeDown = false;

const thru = await import('../src/lib/thru-client.js');
const client = thru.getClient();
client.accounts.get = async (address) => {
  if (nodeDown) throw new Error('fetch failed');
  if (address !== LEAF || !leafExists) return { meta: { balance: null } }; // unparseable → treated absent
  return { meta: { balance: 1n }, data: buildDomainBytes(leafOwner) };
};

// ---- baseline ----------------------------------------------------------------
ok('thru_primary_names is declared network-scoped', SCOPED_KEYS.includes('thru_primary_names'));
const none0 = await handleApiRequest({ method: 'name.getPrimary' });
assert.equal(none0.ok, true);
assert.equal(none0.data, null);
ok('name.getPrimary returns null before any link');

// [6] the read path really carries domain bytes (owner check non-trivially real)
const direct = await handleApiRequest({ method: 'name.lookup', params: { name: NAME, rootAddress: ROOT_ADDRESS } });
assert.equal(direct.ok, true, JSON.stringify(direct.error));
assert.equal(direct.data.leaf.exists, true);
assert.equal(direct.data.leaf.domain.owner, SOMEONE_ELSE);
assert.equal(direct.data.leaf.decodeError, undefined);
ok('name.lookup parses the domain account owner from chain bytes (no permanent decodeError)');

// [2] another owner's name is refused
const foreign = await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME, rootAddress: ROOT_ADDRESS } });
assert.equal(foreign.ok, false);
assert.equal(foreign.error.code, 'NOT_NAME_OWNER');
ok('linkPrimary refuses a name owned by a different address (NOT_NAME_OWNER)');

// [1] a name that does not exist is refused
leafExists = false;
const missing = await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME, rootAddress: ROOT_ADDRESS } });
assert.equal(missing.ok, false);
assert.equal(missing.error.code, 'NAME_NOT_FOUND');
leafExists = true;
ok('linkPrimary refuses a name absent under the given root (NAME_NOT_FOUND)');

// [3] own name links + persists scoped
leafOwner = SENDER;
const linked = await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME, rootAddress: ROOT_ADDRESS } });
assert.equal(linked.ok, true, JSON.stringify(linked.error));
assert.equal(linked.data.name, NAME);
assert.equal(linked.data.domainAddress, LEAF);
const stored = storage.get('thru_primary_names::betanet');
assert.equal(stored[SENDER].name, NAME);
ok('linkPrimary verifies on-chain ownership and stores the record under thru_primary_names::betanet');

const fetched = await handleApiRequest({ method: 'name.getPrimary' });
assert.equal(fetched.ok, true);
assert.equal(fetched.data.name, NAME);
ok('name.getPrimary returns the verified record (live re-verification passes)');

// [4] ownership broken on-chain → record drops; node down → last verified record kept
leafOwner = SOMEONE_ELSE;
const gone = await handleApiRequest({ method: 'name.getPrimary' });
assert.equal(gone.ok, true);
assert.equal(gone.data, null);
ok('a name the account no longer owns drops from the record honestly (no stale badge)');

leafOwner = SENDER;
await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME, rootAddress: ROOT_ADDRESS } });
nodeDown = true;
const kept = await handleApiRequest({ method: 'name.getPrimary' });
assert.equal(kept.ok, true);
assert.equal(kept.data.name, NAME);
nodeDown = false;
ok('an unreadable node keeps the last verified record instead of flapping it away');

// [5] unlink
const unlinked = await handleApiRequest({ method: 'name.unlinkPrimary' });
assert.equal(unlinked.ok, true);
assert.deepEqual(unlinked.data, { unlinked: true });
const after = await handleApiRequest({ method: 'name.getPrimary' });
assert.equal(after.data, null);
ok('unlinkPrimary clears the record');

// [7] notification click → explorer of the SETTLING network
{
  const opened = [];
  const fakeOpen = async (url) => opened.push(url);
  const okOpen = await historyService.openNotificationTx('thru-tx-betanet-sigABC123', { openTab: fakeOpen });
  assert.equal(okOpen, true);
  assert.equal(opened[0], 'https://scan.thru.org/tx/sigABC123?network=betanet');
  ok('notification click builds the explorer tx URL for the encoded network');

  const opened2 = [];
  const legacy = await historyService.openNotificationTx('thru-tx-sigWithoutNetwork', { openTab: async (u) => opened2.push(u) });
  assert.equal(legacy, false);
  assert.equal(opened2.length, 0);
  ok('legacy notification ids without a network segment are ignored, never guessed');

  const opened3 = [];
  const unknown = await historyService.openNotificationTx('thru-tx-nosuchnet-sig1', { openTab: async (u) => opened3.push(u) });
  assert.equal(unknown, false);
  assert.equal(opened3.length, 0);
  ok('an unknown/explorer-less network refuses instead of opening a fabricated URL');
}

console.log(`\ntest-name-primary: ${checks} checks passed`);
