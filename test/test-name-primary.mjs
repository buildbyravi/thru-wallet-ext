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
//       an unreadable node keeps the last verified record marked stale
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
assert.equal(await ns.rootRegistrarAddress('thru'), THRU_ROOT);
assert.equal(await ns.rootRegistrarAddress('id'), ID_ROOT);
assert.equal(ns.registrarConfigAddress(), REG_CONFIG);
ok('root/config derivation pins hold: thru→taNP1M…, id→taLu3d…, config→taLjMD… (first-party CLI-derived)');
// >32-byte root names hash per the official derive_root_registrar_seed edge (name_service.rs)
{
  const longRoot = await ns.rootRegistrarAddress('x'.repeat(33));
  assert.match(longRoot, /^ta/);
  assert.notEqual(longRoot, THRU_ROOT);
}

const thru = await import('../src/lib/thru-client.js');
const client = thru.getClient();
const notFound = () => { const err = new Error('account not found'); err.code = 5; throw err; };
client.accounts.get = async (address) => {
  if (nodeDown) throw new Error('fetch failed');
  if (address === THRU_ROOT) {
    return { meta: { balance: 1n }, data: thruParses ? buildRootBytes('thru', rootAuthority) : new Uint8Array([9, 9, 9, 9]) };
  }
  if (address === ID_ROOT) {
    return { meta: { balance: 1n }, data: rootParses ? buildRootBytes('id', rootAuthority) : new Uint8Array([8, 8, 8, 8]) };
  }
  if (address === LEAF_ID) { // explicit-root .id read: a foreign-owned domain, always present
    return { meta: { balance: 1n, owner: Pubkey.from(ns.NAME_SERVICE_PROGRAM) }, data: buildDomainBytes(SOMEONE_ELSE, NAME, ID_ROOT) };
  }
  if (address !== LEAF_THRU || !leafExists) return notFound(); // model the SDK's real absence shape
  return { meta: { balance: 1n, owner: Pubkey.from(ns.NAME_SERVICE_PROGRAM) }, data: buildDomainBytes(leafOwner) };
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

// Registration pins the same account/network context that the Review screen displayed.
{
  const staleNetwork = await handleApiRequest({ method: 'name.register', params: {
    name: 'child', parentAddress: THRU_ROOT, expectedNetworkId: 'localnet', expectedAccountAddress: SENDER,
  } });
  assert.equal(staleNetwork.ok, false);
  assert.equal(staleNetwork.error.code, 'REVIEW_NETWORK_CHANGED');
  const staleAccount = await handleApiRequest({ method: 'name.register', params: {
    name: 'child', parentAddress: THRU_ROOT, expectedNetworkId: 'betanet', expectedAccountAddress: SOMEONE_ELSE,
  } });
  assert.equal(staleAccount.ok, false);
  assert.equal(staleAccount.error.code, 'REVIEW_ACCOUNT_CHANGED');
  ok('owner-authorized name registration refuses a stale Review network or account');
}

// [7] the read path really carries domain bytes
{
  const direct = await handleApiRequest({ method: 'name.lookup', params: { name: NAME, rootAddress: ID_ROOT } });
  assert.equal(direct.ok, true);
  assert.equal(direct.data.leaf.exists, true);
  assert.equal(direct.data.leaf.domain.owner, SOMEONE_ELSE);
  assert.equal(direct.data.leaf.decodeError, undefined);
  ok('name.lookup parses the domain account owner from chain bytes (no permanent decodeError)');
  const mintAttempt = await handleApiRequest({ method: 'name.register', params: {
    name: 'child', parentAddress: ID_ROOT, expectedNetworkId: 'betanet', expectedAccountAddress: SENDER,
  } });
  assert.equal(mintAttempt.ok, false);
  assert.equal(mintAttempt.error.code, 'NAME_PARENT_AUTHORITY');
  ok('.id lookup remains available while a non-authority signer cannot mint beneath its root');
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

// A transport failure after submission begins is an unknown outcome, never a verified failure.
{
  const originalProofGenerate = client.proofs.generate;
  const originalBuildAndSign = client.transactions.buildAndSign;
  const originalSendAndTrack = client.transactions.sendAndTrack;
  try {
    client.proofs.generate = async () => ({ proof: new Uint8Array([1]) });
    client.transactions.buildAndSign = async () => ({ rawTransaction: new Uint8Array([1]) });
    client.transactions.sendAndTrack = async function* () { throw new Error('network timeout'); };
    const outcome = await handleApiRequest({ method: 'name.register', params: {
      name: 'child', parentAddress: LEAF_THRU, expectedNetworkId: 'betanet', expectedAccountAddress: SENDER,
    } });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, 'TX_RESULT_MISSING');
    assert.equal(outcome.error.retryable, true);
    ok('registration submission timeout remains an unknown retryable outcome');
    assert(!storage.get('thru_registered_domains::betanet').records.some(r => r.name === 'child'));
    client.transactions.sendAndTrack = async function* () {
      yield { signature: { value: new Uint8Array(64).fill(1) }, executionResult: { vmError: 0 } };
    };
    const confirmed = await handleApiRequest({ method: 'name.register', params: {
      name: 'child', parentAddress: LEAF_THRU, expectedNetworkId: 'betanet', expectedAccountAddress: SENDER,
    } });
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error));
    const saved = storage.get('thru_registered_domains::betanet').records.find(r => r.name === 'child');
    assert.equal(saved.accountAddress, SENDER);
    assert.equal(saved.rootAddress, LEAF_THRU);
    assert.equal(saved.domainAddress, confirmed.data.domainAddress);
    assert.equal(saved.status, 'unknown');
    ok('only confirmed registration is automatically retained by the backend without a UI callback');
    const originalSet = chrome.storage.local.set;
    try {
      chrome.storage.local.set = async values => {
        if ('thru_registered_domains::betanet' in values) throw new Error('quota exceeded');
        return originalSet(values);
      };
      const confirmedUnsaved = await handleApiRequest({ method: 'name.register', params: {
        name: 'otherchild', parentAddress: LEAF_THRU, expectedNetworkId: 'betanet', expectedAccountAddress: SENDER,
      } });
      assert.equal(confirmedUnsaved.ok, true);
      assert.equal(confirmedUnsaved.data.trackingFailed, true);
      assert(confirmedUnsaved.data.signature);
      ok('storage failure after confirmation is separate metadata, never a failed/retryable registration');
    } finally { chrome.storage.local.set = originalSet; }
  } finally {
    client.proofs.generate = originalProofGenerate;
    client.transactions.buildAndSign = originalBuildAndSign;
    client.transactions.sendAndTrack = originalSendAndTrack;
  }
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
  assert.equal(kept.data.stale, true);
  ok('an unreadable node keeps the last verified record and marks it stale');
  const lookup = await handleApiRequest({ method: 'name.lookup', params: { name: NAME, rootAddress: THRU_ROOT } });
  assert.equal(lookup.ok, false);
  const availability = await handleApiRequest({ method: 'name.checkAvailability', params: { name: NAME, parentAddress: THRU_ROOT } });
  assert.equal(availability.ok, false);
  ok('offline lookups and availability checks stay unknown instead of returning an available name');
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

// Versioned tracked registry: migration, preservation, isolation, live truth and races.
{
  const registryKey = 'thru_registered_domains::betanet';
  const primaryKey = 'thru_primary_names::betanet';
  const primaryService = await import('../src/background/services/primary-name-service.js');
  storage.delete(registryKey);
  storage.set(primaryKey, { [SENDER]: { name: NAME, rootAddress: THRU_ROOT, domainAddress: LEAF_THRU, verifiedAt: 123 } });
  const cachedLegacy = await primaryService.getCachedDomains();
  assert.equal(cachedLegacy.items[0].name, NAME);
  assert.equal(cachedLegacy.items[0].stale, true);
  assert.equal(storage.has(registryKey), false);
  await primaryService.unlinkPrimaryName();
  assert.equal(storage.get(registryKey).version, 1);
  assert.equal(storage.get(registryKey).records[0].name, NAME);
  assert.equal(storage.get(primaryKey)[SENDER], undefined);
  ok('storage-only cache projects v0 aliases; unlink persists v1 before removing the primary alias');

  const extra = new Map();
  const realGet = client.accounts.get;
  const bobAddress = await ns.domainAccountAddress(THRU_ROOT, 'bob');
  const mixedAddress = await ns.domainAccountAddress(THRU_ROOT, 'MiX_9');
  extra.set(bobAddress, { meta: { balance: 1n, owner: Pubkey.from(ns.NAME_SERVICE_PROGRAM) }, data: buildDomainBytes(SENDER, 'bob') });
  extra.set(mixedAddress, { meta: { balance: 1n, owner: Pubkey.from(ns.NAME_SERVICE_PROGRAM) }, data: buildDomainBytes(SENDER, 'MiX_9') });
  client.accounts.get = async address => {
    if (nodeDown) throw new Error('offline');
    return extra.get(address) ?? realGet(address);
  };
  try {
    await Promise.all([primaryService.trackDomain({ name: 'bob.thru' }), primaryService.trackDomain({ name: 'MiX_9' })]);
    await primaryService.trackDomain({ name: 'bob' });
    assert.equal((await primaryService.getCachedDomains()).items.length, 3);
    assert(storage.get(registryKey).records.some(r => r.name === 'MiX_9'));
    ok('concurrent imports preserve all names, deduplicate identity and retain paid-registry case/alphabet');
    await primaryService.setPrimaryDomain({ domainAddress: bobAddress });
    let live = await primaryService.listDomains();
    assert.equal(live.source, 'tracked');
    assert.equal(live.items.length, 3);
    assert(live.items.every(r => r.status === 'owned' && !r.stale));
    assert.equal(live.items.find(r => r.isPrimary).name, 'bob');
    await primaryService.unlinkPrimaryName({ domainAddress: bobAddress });
    assert.equal((await primaryService.getCachedDomains()).items.length, 3);
    ok('changing and unlinking primary never removes other tracked domains');
    const cached = await primaryService.getCachedDomains();
    assert(cached.items.every(r => r.stale));
    nodeDown = true;
    live = await primaryService.listDomains();
    assert.equal(live.items.length, 3);
    assert(live.items.every(r => r.stale && r.status === 'unknown'));
    await assert.rejects(primaryService.setPrimaryDomain({ domainAddress: bobAddress }), e => e.code === 'NAME_UNREADABLE');
    nodeDown = false;
    ok('offline reads retain all records as unknown; cached ownership cannot authorize primary selection');

    await primaryService.setPrimaryDomain({ domainAddress: bobAddress });
    extra.get(bobAddress).data = buildDomainBytes(SOMEONE_ELSE, 'bob');
    live = await primaryService.listDomains();
    assert.equal(live.items.find(r => r.name === 'bob').status, 'not-owned');
    assert.equal(live.items.some(r => r.isPrimary), false);
    await assert.rejects(primaryService.trackDomain({ name: 'bob' }), e => e.code === 'NOT_NAME_OWNER');
    await assert.rejects(primaryService.setPrimaryDomain({ domainAddress: bobAddress }), e => e.code === 'NOT_NAME_OWNER');
    await assert.rejects(primaryService.trackDomain({ name: 'missing' }), e => e.code === 'NAME_NOT_FOUND');
    ok('transferred/missing domains cannot import or become primary; disproven primary alias is cleared');
    extra.get(bobAddress).data = buildDomainBytes(SENDER, 'bob');
    extra.get(bobAddress).meta.owner = Pubkey.from(SOMEONE_ELSE);
    await assert.rejects(primaryService.trackDomain({ name: 'bob' }), e => e.code === 'NAME_UNREADABLE');
    extra.get(bobAddress).meta.owner = Pubkey.from(ns.NAME_SERVICE_PROGRAM);
    extra.get(bobAddress).data = new Uint8Array([2]);
    await assert.rejects(primaryService.trackDomain({ name: 'bob' }), e => e.code === 'NAME_UNREADABLE');
    extra.get(bobAddress).data = buildDomainBytes(SENDER, 'bob');
    ok('wrong owning program and malformed domain bytes never pass ownership verification');

    await assert.rejects(primaryService.trackDomain({ name: 'bob', expectedNetworkId: 'localnet' }), e => e.code === 'DOMAIN_CONTEXT_CHANGED');
    await assert.rejects(primaryService.trackDomain({ name: 'bob', expectedAccountAddress: SOMEONE_ELSE }), e => e.code === 'DOMAIN_CONTEXT_CHANGED');
    storage.set('thru_registered_domains::localnet', { version: 1, revision: 0, records: [] });
    storage.get(registryKey).records.push({ ...storage.get(registryKey).records[0], accountAddress: SOMEONE_ELSE, name: 'foreign' });
    assert.equal((await primaryService.getCachedDomains()).items.length, 3);
    assert.deepEqual(storage.get('thru_registered_domains::localnet').records, []);
    ok('expected context rejects stale actions; other accounts and networks never leak into the list');

    const getBeforeRace = client.accounts.get;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let requested;
    const started = new Promise(resolve => { requested = resolve; });
    client.accounts.get = async address => {
      if (address === bobAddress) { requested(); await held; }
      return getBeforeRace(address);
    };
    const pendingList = primaryService.listDomains();
    await started;
    await primaryService.untrackDomain({ domainAddress: bobAddress });
    release();
    const raceResult = await pendingList;
    assert(!raceResult.items.some(r => r.name === 'bob'));
    assert(raceResult.items.every(r => r.stale));
    client.accounts.get = getBeforeRace;
    ok('a late ownership refresh cannot resurrect an untracked domain');
    await primaryService.setPrimaryDomain({ domainAddress: LEAF_THRU });
    await assert.rejects(primaryService.untrackDomain({ domainAddress: LEAF_THRU }), e => e.code === 'DOMAIN_IS_PRIMARY');
    await assert.rejects(primaryService.unlinkPrimaryName({ domainAddress: bobAddress }), e => e.code === 'DOMAIN_CONTEXT_CHANGED');
    ok('untracking requires unlinking primary first; stale unlink cannot clear a different primary');
    const beforeFuture = storage.get(registryKey);
    storage.set(registryKey, { version: 99, records: [] });
    await assert.rejects(primaryService.getCachedDomains(), e => e.code === 'STORAGE_VERSION');
    await assert.rejects(primaryService.trackDomain({ name: NAME }), e => e.code === 'STORAGE_VERSION');
    assert.equal(storage.get(registryKey).version, 99);
    storage.set(registryKey, beforeFuture);
    ok('future registry schemas fail closed and are never overwritten');

    const lateSave = primaryService.registrationRecorder({ networkId: 'betanet', accountAddress: SENDER });
    let resetRelease;
    let resetRequested;
    const resetHeld = new Promise(resolve => { resetRelease = resolve; });
    const resetStarted = new Promise(resolve => { resetRequested = resolve; });
    client.accounts.get = async address => {
      if (address === LEAF_THRU) { resetRequested(); await resetHeld; }
      return getBeforeRace(address);
    };
    const lateList = primaryService.listDomains().then(() => 'unexpected success', error => error.code);
    await resetStarted;
    const reset = await handleApiRequest({ method: 'wallet.reset', params: { confirmation: 'RESET', password: 'Password123!' } });
    assert.equal(reset.ok, true, JSON.stringify(reset.error));
    resetRelease();
    assert.equal(await lateList, 'DOMAIN_CONTEXT_CHANGED');
    await assert.rejects(lateSave({ name: NAME, rootAddress: THRU_ROOT, domainAddress: LEAF_THRU }), e => e.code === 'DOMAIN_CONTEXT_CHANGED');
    assert(![...storage.keys()].some(key => key.startsWith('thru_registered_domains::') || key.startsWith('thru_primary_names::')));
    ok('wallet reset clears both stores on every network; late refresh/confirmed-save callbacks cannot repopulate them');
    for (const method of ['name.getCachedDomains', 'name.listDomains', 'name.trackDomain', 'name.setPrimaryDomain', 'name.untrackDomain']) {
      const locked = await handleApiRequest({ method });
      assert.equal(locked.error.code, 'WALLET_LOCKED');
    }
    ok('all five tracked-domain methods are unavailable when locked');
  } finally {
    client.accounts.get = realGet;
    nodeDown = false;
  }
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
