#!/usr/bin/env node
// Primary-name (domain) linking + canonical-root auto-discovery + notification explorer
// click (2026-10-09 UX slice). Zero network: the thru-client is stubbed at getClient().
//
// Proves:
//   [0] canonical-root discovery NEVER trusts a candidate blind: an address that does not
//       parse as a root registrar is skipped, and with no parseable candidate every read
//       answers NAME_ROOT_UNKNOWN (the UI's manual-root fallback trigger)
//   [*] the candidate roots are OFFICIALLY DERIVED from their root names (raw-name seed
//       derivation inverted from the first-party thru CLI 0.4.1, 2026-10-09), never pasted
//       from third parties — 'thru' and 'id' pins hold byte-exact
//   [1] a parseable candidate wins — official .thru root first, community .id root second —
//       and blank rootAddress on lookup/link uses the discovered root; .thru BEATS .id
//       when both parse (canonical namespace preference)
//   [2] name.linkPrimary refuses a name owned by ANOTHER address (NOT_NAME_OWNER)
//   [3] refuses a name absent under the canonical root (NAME_NOT_FOUND)
//   [4] a correctly-owned name links with no root input and persists network-scoped
//   [5] getPrimary re-verifies each call; a proven owner change drops the record honestly,
//       an unreadable node keeps the last verified record
//   [6] unlink clears the record
//   [7] lookupName reads real domain bytes (owner check is real)
//   [8] notification clicks open the SETTLING network's explorer; legacy ids ignored;
//       unknown chains and explorer-less networks refused
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

// ---- synthetic on-chain world -------------------------------------------------
// Pins recovered from the first-party thru CLI 0.4.1 derive-* helpers (offline, 2026-10-09):
const THRU_ROOT = 'taNP1MFOO2shpn6ORofIGSNiQ-qJ9VE2lDkDwvUmgUmaQZ'; // derive-registrar-account thru
const ID_ROOT = 'taLu3d1rxGdQWWHJxUOK6eT9ti4lWeTijNp0Kk_5YKHARg';   // derive-registrar-account id
const REG_CONFIG = 'taLjMDKiBDra1EGIKoF_7B-tGFJMnf8MejLDu3VVWTRJRQ'; // derive-config-account
const NAME = 'alice';
const LEAF_THRU = await ns.domainAccountAddress(THRU_ROOT, NAME); // leaf under the official .thru root
const LEAF_ID = await ns.domainAccountAddress(ID_ROOT, NAME);     // leaf under the community .id root
const SOMEONE_ELSE = Pubkey.from(new Uint8Array(32).fill(7)).toThruFmt();

function buildDomainBytes(ownerAddress, name = NAME, parent = THRU_ROOT) {
  const out = new Uint8Array(ns.NS_DOMAIN_HEADER); // record_count = 0
  out[0] = ns.NS_KIND_DOMAIN;
  out.set(Pubkey.from(parent).toBytes(), 0x01);
  out.set(Pubkey.from(ownerAddress).toBytes(), 0x21);
  const nb = new TextEncoder().encode(name);
  out.set(nb, 0x41);
  const dv = new DataView(out.buffer);
  dv.setUint32(0x81, nb.length, true);
  dv.setBigUint64(0x85, 1_700_000_000n, true);
  dv.setUint32(0x8d, 0, true);
  return out;
}

function buildRootBytes(name, authorityRandom) {
  const out = new Uint8Array(ns.NS_ROOT_SIZE);
  out[0] = ns.NS_KIND_ROOT_REGISTRAR;
  out.set(authorityRandom.toBytes(), 1);
  const nb = new TextEncoder().encode(name);
  out.set(nb, 0x21);
  const dv = new DataView(out.buffer);
  dv.setUint32(0x61, nb.length, true);
  dv.setBigUint64(0x65, 3n, true);
  return out;
}

let leafOwner = SOMEONE_ELSE;
let leafExists = true;
let nodeDown = false;
let thruParses = false;         // candidate #1 (official .thru registry root)
let rootParses = false;         // candidate #2 (community .id root)
const rootAuthority = Pubkey.from(new Uint8Array(32).fill(9));

// [*] the candidates come from the OFFICIAL raw-name derivation, not pasted constants
assert.equal(ns.rootRegistrarAddress('thru'), THRU_ROOT);
assert.equal(ns.rootRegistrarAddress('id'), ID_ROOT);
assert.equal(ns.registrarConfigAddress(), REG_CONFIG);
ok('root/config derivation pins hold: thru→taNP1M…, id→taLu3d…, config→taLjMD… (first-party CLI-derived)');

const thru = await import('../src/lib/thru-client.js');
const client = thru.getClient();
client.accounts.get = async (address) => {
  if (nodeDown) throw new Error('fetch failed');
  if (address === THRU_ROOT) {
    return { meta: { balance: 1n }, data: thruParses ? buildRootBytes('thru', rootAuthority) : new Uint8Array([9, 9, 9, 9]) };
  }
  if (address === ID_ROOT) {
    return { meta: { balance: 1n }, data: rootParses ? buildRootBytes('id', rootAuthority) : new Uint8Array([8, 8, 8, 8]) };
  }
  if (address === LEAF_ID) { // explicit-root .id read: a foreign-owned domain, always present
    return { meta: { balance: 1n }, data: buildDomainBytes(SOMEONE_ELSE, NAME, ID_ROOT) };
  }
  if (address !== LEAF_THRU || !leafExists) return { meta: { balance: null } }; // unparseable → treated absent
  return { meta: { balance: 1n }, data: buildDomainBytes(leafOwner) };
};

ok('thru_primary_names is declared network-scoped', SCOPED_KEYS.includes('thru_primary_names'));
const none0 = await handleApiRequest({ method: 'name.getPrimary' });
assert.equal(none0.ok, true);
assert.equal(none0.data, null);
ok('name.getPrimary returns null before any link');

// [0] no parseable candidate → honest NAME_ROOT_UNKNOWN (never a blind trust of either pin)
{
  const res = await handleApiRequest({ method: 'name.lookup', params: { name: NAME, rootAddress: '' } });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NAME_ROOT_UNKNOWN');
  const link = await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME, rootAddress: '' } });
  assert.equal(link.ok, false);
  assert.equal(link.error.code, 'NAME_ROOT_UNKNOWN');
  ok('no parseable root candidate → NAME_ROOT_UNKNOWN on both lookup and link (manual-root fallback)');
}

// [1] BOTH candidates parse → the official .thru root WINS over the community .id root;
//     blank root on lookup resolves through it end-to-end
rootParses = true;
thruParses = true;
{
  const res = await handleApiRequest({ method: 'name.lookup', params: { name: NAME, rootAddress: '' } });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.equal(res.data.rootAddress, THRU_ROOT);
  const chain = res.data.chain;
  assert.equal(chain[chain.length - 1], THRU_ROOT);
  assert.equal(chain[0], LEAF_THRU);
  ok('blank root → auto-discovered canonical root; official .thru beats community .id when both parse');
}

// [7] the read path really carries domain bytes
{
  const direct = await handleApiRequest({ method: 'name.lookup', params: { name: NAME, rootAddress: ID_ROOT } });
  assert.equal(direct.ok, true);
  assert.equal(direct.data.leaf.exists, true);
  assert.equal(direct.data.leaf.domain.owner, SOMEONE_ELSE);
  assert.equal(direct.data.leaf.decodeError, undefined);
  ok('name.lookup parses the domain account owner from chain bytes (no permanent decodeError)');
}

// [2] another owner's name is refused
{
  const foreign = await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME, rootAddress: '' } });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.code, 'NOT_NAME_OWNER');
  ok('linkPrimary refuses a name owned by a different address (NOT_NAME_OWNER)');
}

// [3] a name that does not exist is refused
leafExists = false;
{
  const missing = await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME } });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'NAME_NOT_FOUND');
  ok('linkPrimary refuses a name absent under the canonical root (NAME_NOT_FOUND)');
}
leafExists = true;

// [4] own name links with NO root input, stores the discovered root, persists scoped
leafOwner = SENDER;
{
  const linked = await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME } });
  assert.equal(linked.ok, true, JSON.stringify(linked.error));
  assert.equal(linked.data.name, NAME);
  assert.equal(linked.data.rootAddress, THRU_ROOT);
  assert.equal(linked.data.domainAddress, LEAF_THRU);
  const stored = storage.get('thru_primary_names::betanet');
  assert.equal(stored[SENDER].name, NAME);
  assert.equal(stored[SENDER].rootAddress, THRU_ROOT);
  ok('linkPrimary with no root input verifies ownership via the discovered root and stores it');
}
{
  const fetched = await handleApiRequest({ method: 'name.getPrimary' });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.data.name, NAME);
  ok('name.getPrimary returns the verified record (live re-verification passes)');
}

// [5] ownership flips → record drops; node down → last verified record kept
leafOwner = SOMEONE_ELSE;
{
  const gone = await handleApiRequest({ method: 'name.getPrimary' });
  assert.equal(gone.ok, true);
  assert.equal(gone.data, null);
  ok('a name the account no longer owns drops from the record honestly (no stale badge)');
  const storedAfterGone = storage.get('thru_primary_names::betanet');
  assert.equal(storedAfterGone[SENDER], undefined);
  ok('broken primary-name link is purged from scoped storage on positive disproof');
}
leafOwner = SENDER;
await handleApiRequest({ method: 'name.linkPrimary', params: { name: NAME } });
nodeDown = true;
{
  const kept = await handleApiRequest({ method: 'name.getPrimary' });
  assert.equal(kept.ok, true);
  assert.equal(kept.data.name, NAME);
  ok('an unreadable node keeps the last verified record instead of flapping it away');
}
nodeDown = false;

// [6] unlink
{
  const unlinked = await handleApiRequest({ method: 'name.unlinkPrimary' });
  assert.equal(unlinked.ok, true);
  assert.deepEqual(unlinked.data, { unlinked: true });
  const after = await handleApiRequest({ method: 'name.getPrimary' });
  assert.equal(after.data, null);
  ok('unlinkPrimary clears the record');
}

// [8] notification click → explorer of the SETTLING network
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
