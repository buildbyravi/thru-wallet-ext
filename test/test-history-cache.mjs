// Cache-first history service: no RPC on the early path, network/address isolation and
// refusal to store a late history response under another chain. All RPCs are mocked.
import assert from 'node:assert/strict';
import * as history from '../src/background/services/history-service.js';
import * as networks from '../src/background/services/network-service.js';
import * as thruClient from '../src/lib/thru-client.js';
import { getNetworkConfig } from '../src/lib/networks.js';

const data = new Map();
let writes = 0;
globalThis.chrome = {
  runtime: { sendMessage: () => Promise.resolve() },
  storage: { local: {
    async get(key) { return { [key]: structuredClone(data.get(key)) }; },
    async set(next) {
      writes += 1;
      for (const [key, value] of Object.entries(next)) data.set(key, structuredClone(value));
    },
  } },
};

const A = 'taAA_test_history';
const B = 'taBB_test_history';
const alphaEntry = { signature: 'ts_alpha_cache', kind: 'sent', amount: '123', timestamp: null };
const localEntry = { signature: 'ts_local_cache', kind: 'received', amount: '456', timestamp: null };
const ALPHA_CHAIN = history.chainFingerprint(getNetworkConfig('alphanet'));
const LOCAL_CHAIN = history.chainFingerprint(getNetworkConfig('localnet'));
data.set('thru_history_cache::alphanet', {
  _chain: ALPHA_CHAIN,
  [A]: { entries: [alphaEntry], nextCursor: 8, updatedAt: 112233 },
  [B]: { entries: [{ signature: 'ts_other_account' }], nextCursor: null, updatedAt: 99 },
});
data.set('thru_history_cache::localnet', {
  _chain: LOCAL_CHAIN,
  [A]: { entries: [localEntry], nextCursor: 4, updatedAt: 223344 },
});

await networks.setActiveNetwork('alphanet');
// A storage-only cache read must not even REBIND the SDK client (a read can be used offline).
thruClient.configureNetwork((await import('../src/lib/networks.js')).getNetworkConfig('localnet'));
const before = writes;
const cached = await history.getCachedHistory(A);
assert.deepEqual(cached, {
  address: A, networkId: 'alphanet', entries: [alphaEntry], nextCursor: 8, updatedAt: 112233,
});
assert.equal(writes, before, 'storage-only history read does not write');
assert.equal(thruClient.getConfiguredNetwork().id, 'localnet', 'storage-only read does not bind RPC');
assert.deepEqual((await history.getCachedHistory(B)).entries, [{ signature: 'ts_other_account' }]);
assert.deepEqual((await history.getCachedHistory('missing')).entries, [], 'missing cache is empty, not fabricated');
console.log('  ok - history cache reads only the requested network/address and never touches RPC');

// ---- Chain identity: the alphanet-reset regression ----
// The chain was replaced under the SAME network id (and the same chainId). A cache
// written against the previous genesis must never surface its rows again — neither
// through the cached path nor through the merge in the feed — and the read itself
// must not write storage.
const writesBeforeDrop = writes;
data.set('thru_history_cache::alphanet', {
  _chain: 'alphanet|pre|reset|genesis|gone|gone',
  [A]: { entries: [{ signature: 'ts_from_the_dead_chain' }] },
});
assert.deepEqual((await history.getCachedHistory(A)).entries, [],
  'rows from a previous chain under the same network id are not served');
// A pre-fingerprint cache (written before this check existed) is treated the same.
data.set('thru_history_cache::alphanet', {
  [A]: { entries: [{ signature: 'ts_pre_fingerprint_cache' }] },
});
assert.deepEqual((await history.getCachedHistory(A)).entries, [],
  'a cache without a chain identity is not trusted');
assert.equal(writes, writesBeforeDrop, 'dropping a stale cache is a read, not a write');
// Restore the identity-verified cache the surrounding sections rely on.
data.set('thru_history_cache::alphanet', {
  _chain: ALPHA_CHAIN,
  [A]: { entries: [alphaEntry], nextCursor: 8, updatedAt: 112233 },
  [B]: { entries: [{ signature: 'ts_other_account' }], nextCursor: null, updatedAt: 99 },
});
console.log('  ok - history from a replaced chain is dropped instead of resurfacing');

await networks.setActiveNetwork('localnet');
assert.deepEqual((await history.getCachedHistory(A)).entries, [localEntry]);
assert.deepEqual((await history.getCachedHistory(B)).entries, []);
console.log('  ok - switching networks cannot display another chain\'s history');

const localClient = thruClient.getClient();
const originalList = localClient.transactions.listForAccount;
try {
  localClient.transactions.listForAccount = async () => { throw new Error('RPC offline'); };
  const offline = await history.getHistoryFeed(A);
  assert.equal(offline.synced, false);
  assert.deepEqual(offline.entries, [localEntry]);
  assert.equal(offline.nextCursor, 4);
  console.log('  ok - an offline feed keeps the cached rows and labels them unsynced');

  let finish;
  localClient.transactions.listForAccount = () => new Promise((resolve) => {
    finish = () => resolve({ transactions: [] });
  });
  const late = history.getHistoryFeed(A);
  for (let i = 0; i < 50 && !finish; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(typeof finish, 'function', 'live RPC started');
  await networks.setActiveNetwork('alphanet');
  const writesAfterSwitch = writes; // the network selection itself writes its active ID
  finish();
  await assert.rejects(late, (error) => error.code === 'NETWORK_CHANGED');
  assert.equal(writes, writesAfterSwitch, 'a late old-chain response cannot write history');
  assert.deepEqual((await history.getCachedHistory(A)).entries, [alphaEntry]);
  console.log('  ok - an in-flight feed is invalidated by a network switch');
} finally {
  localClient.transactions.listForAccount = originalList;
}

// Chrome storage returns independent object copies. Overlapping refreshes of different
// accounts must serialize their shared per-network scope write, or one row gets clobbered.
const alphaClient = thruClient.getClient();
const originalAlphaList = alphaClient.transactions.listForAccount;
try {
  alphaClient.transactions.listForAccount = async () => ({ transactions: [] });
  const [feedX, feedY] = await Promise.all([
    history.getHistoryFeed('ta_concurrent_X'),
    history.getHistoryFeed('ta_concurrent_Y'),
  ]);
  assert.equal(feedX.synced, true);
  assert.equal(feedY.synced, true);
  const scope = data.get('thru_history_cache::alphanet');
  assert.ok(Object.hasOwn(scope, 'ta_concurrent_X') && Object.hasOwn(scope, 'ta_concurrent_Y'),
    'concurrent same-network writes keep both address entries');
} finally {
  alphaClient.transactions.listForAccount = originalAlphaList;
}
console.log('  ok - parallel account refreshes cannot clobber one another in the shared cache scope');

await history.clearHistoryCache(A);
assert.deepEqual((await history.getCachedHistory(A)).entries, []);
assert.deepEqual((await history.getCachedHistory(B)).entries, [{ signature: 'ts_other_account' }]);
await networks.setActiveNetwork('localnet');
assert.deepEqual((await history.getCachedHistory(A)).entries, [localEntry]);
console.log('  ok - deleting one address\'s cache leaves other accounts and networks intact');
