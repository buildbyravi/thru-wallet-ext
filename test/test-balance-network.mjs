// Read-path network binding and cache isolation, using a fake SDK account reader.
// No real RPC, wallet keys or Chrome browser are required.
import assert from 'node:assert/strict';
import { getNetworkConfig, NETWORKS } from '../src/lib/networks.js';

// The shipped wallet disables Localnet (custom chains come later); this suite needs a second
// selectable network to prove per-network isolation, so re-enable it in-process only.
NETWORKS.localnet.enabled = true;
import * as thruClient from '../src/lib/thru-client.js';
import * as networks from '../src/background/services/network-service.js';
import * as balances from '../src/background/services/balance-service.js';
import * as tx from '../src/background/services/tx-service.js';
import * as tokens from '../src/background/services/token-service.js';
import * as pendingTx from '../src/background/services/pending-tx-service.js';

const data = new Map();
const events = [];
globalThis.chrome = {
  runtime: { sendMessage(message) { events.push(message); return Promise.resolve(); } },
  storage: { local: {
    async get(key) {
      if (key === null) return Object.fromEntries(data);
      if (Array.isArray(key)) return Object.fromEntries(key.map((k) => [k, data.get(k)]));
      return { [key]: data.get(key) };
    },
    async set(next) { for (const [key, value] of Object.entries(next)) data.set(key, value); },
    async remove(key) { for (const k of Array.isArray(key) ? key : [key]) data.delete(k); },
  } },
};

const address = 'taEREREREREREREREREREREREREREREREREREREREREREg';
console.log('[network reads] no chain change may write an answer into the wrong cache');
await networks.setActiveNetwork('betanet');
const alphaClient = thruClient.getClient();
const originalAlphaGet = alphaClient.accounts.get;
let finishRead;
alphaClient.accounts.get = () => new Promise((resolve) => {
  finishRead = () => resolve({ meta: { balance: 1500000n } });
});
const pending = balances.getBalances([address]);
for (let i = 0; i < 25 && !finishRead; i += 1) {
  await new Promise((resolve) => setImmediate(resolve));
}
assert.equal(typeof finishRead, 'function', 'Betanet account RPC started');
await networks.setActiveNetwork('localnet');
finishRead();
await assert.rejects(pending, (error) => error.code === 'NETWORK_CHANGED');
alphaClient.accounts.get = originalAlphaGet;
assert.equal(data.has('thru_balance_cache::betanet'), false);
assert.equal(data.has('thru_balance_cache::localnet'), false);
assert.equal(events.filter((event) => event.event === 'balanceChanged').length, 0);
console.log('  ok - switching while an RPC is pending neither writes nor emits its old-chain result');

console.log('[network reads] a cold worker binds the active chain for token reads');
// Force the SDK to point at Betanet while local storage selects localnet. A token read
// with an empty registry uses no network, but MUST rebind before its first possible RPC.
thruClient.configureNetwork(getNetworkConfig('betanet'));
const noTokens = await tokens.getTokenBalances({ address });
assert.equal(noTokens.networkId, 'localnet');
assert.deepEqual(noTokens.balances, []);
assert.equal(thruClient.getConfiguredNetwork().id, 'localnet');
console.log('  ok - token.getBalances corrects a stale SDK binding before reading mints');

console.log('[network reads] native reads preserve real, stale and absent distinctions');
const localClient = thruClient.getClient();
const originalLocalGet = localClient.accounts.get;
try {
  localClient.accounts.get = async () => ({ meta: { balance: 456789n } });
  const info = await tx.getAccountInfo(address);
  assert.deepEqual(info, { exists: true, balance: '456789' });
  const fresh = await balances.getBalances([address]);
  assert.equal(fresh[address].balance, '456789');
  assert.equal(fresh[address].stale, false);
  assert.equal(data.get('thru_balance_cache::localnet')[address].balance, '456789');
  assert.equal(events.filter((event) => event.event === 'balanceChanged').length, 1);

  localClient.accounts.get = async () => { throw new Error('RPC timeout'); };
  await assert.rejects(tx.getAccountInfo(address), /RPC timeout/);
  const stale = await balances.getBalances([address]);
  assert.equal(stale[address].stale, true);
  assert.equal(stale[address].balance, '456789', 'last-known value can display, but is never live');
  assert.match(stale[address].error, /RPC timeout/);
  assert.equal((await balances.getCachedBalances([address]))[address].balance, '456789');
  const neverFetched = 'taNEVER_FETCHED';
  const unknown = await balances.getBalances([neverFetched]);
  assert.equal(unknown[neverFetched].stale, true);
  assert.equal(unknown[neverFetched].fetchedAt, 0);
  assert.equal((await balances.getCachedBalances([neverFetched]))[neverFetched], undefined,
    'a failed first read must not create a fabricated last-known zero for the picker');
  // An older installed version could already have written such a fallback. Ignore it on
  // read as well, instead of showing it in account.list or Send as a real last-known zero.
  const localCache = data.get('thru_balance_cache::localnet');
  localCache[neverFetched] = { balance: '0', exists: false, fetchedAt: 0 };
  assert.equal((await balances.getCachedBalances([neverFetched]))[neverFetched], undefined);
  delete localCache[neverFetched];

  localClient.accounts.get = async () => { throw Object.assign(new Error('missing'), { code: 5 }); };
  const absent = await tx.getAccountInfo(address);
  assert.deepEqual(absent, { exists: false, balance: '0' });
} finally {
  localClient.accounts.get = originalLocalGet;
}
console.log('  ok - offline is stale/unknown; only an SDK not-found error proves zero');

console.log('[network reads] a direct tx.getAccountInfo is invalidated by a mid-read switch');
const localBeforeSwitch = thruClient.getClient();
const localRead = localBeforeSwitch.accounts.get;
let finishAccountRead;
localBeforeSwitch.accounts.get = () => new Promise((resolve) => {
  finishAccountRead = () => resolve({ meta: { balance: 999999n } });
});
const oldAccountInfo = tx.getAccountInfo(address);
for (let i = 0; i < 25 && !finishAccountRead; i += 1) {
  await new Promise((resolve) => setImmediate(resolve));
}
assert.equal(typeof finishAccountRead, 'function');
await networks.setActiveNetwork('betanet');
finishAccountRead();
await assert.rejects(oldAccountInfo, (error) => error.code === 'NETWORK_CHANGED');
localBeforeSwitch.accounts.get = localRead;
console.log('  ok - a late account RPC response cannot be presented on another chain');
assert.deepEqual(await balances.getCachedBalances([address]), {},
  'switching back cannot see a value cached on localnet');
console.log('  ok - cached balances remain isolated per network');

console.log('[network reads] a late signature is stored against its signing chain');
const beforePendingEvents = events.filter((message) => message.event === 'pendingTxChanged').length;
const recorded = await pendingTx.track({ signature: 'ts_fixture', kind: 'transfer',
  from: address, to: 'recipient', amountUnits: '1', networkId: 'localnet' });
assert.equal(recorded.networkId, 'localnet');
assert.equal(data.has('thru_pending_txs::betanet'), false);
assert.equal(data.get('thru_pending_txs::localnet')?.records?.[0].signature, 'ts_fixture');
assert.equal(events.filter((message) => message.event === 'pendingTxChanged').length,
  beforePendingEvents, 'do not announce a localnet send on the Betanet UI');
assert.deepEqual(await pendingTx.list(), []);
await networks.setActiveNetwork('localnet');
assert.equal((await pendingTx.list())[0].signature, 'ts_fixture');
console.log('  ok - a late send tracks/badges only the original network');

console.log('[tx sync] reconcile settles confirmed tx and triggers balance refresh');
const client = thruClient.getClient();
const origList = client.transactions?.listForAccount;
if (!client.transactions) client.transactions = {};
client.transactions.listForAccount = async () => ({
  transactions: [{
    getSignature: () => ({ toThruFmt: () => 'ts_fixture' }),
    program: { toThruFmt: () => 'taPROGRAM' },
    executionResult: { vmError: 0 },
    slot: 12345n,
  }],
});
const reconcileResult = await pendingTx.reconcile();
assert.equal(reconcileResult.settled, 1);
const pendingAfter = await pendingTx.listPending();
assert.equal(pendingAfter.length, 0);
client.transactions.listForAccount = origList;
console.log('  ok - reconcile settles confirmed tx in the sync passes and refreshes balances');

console.log('[pending storage] concurrent mutations are serialized and migrate the v0 array');
// Seed the old bare-array format, then race two distinct submissions. The first mutation migrates
// to the versioned envelope and the per-network queue must preserve both signatures.
data.set('thru_pending_txs::localnet', []);
await Promise.all([
  pendingTx.track({ signature: 'ts_concurrent_a', kind: 'transfer', from: address,
    to: 'recipient-a', amountUnits: '2', networkId: 'localnet' }),
  pendingTx.track({ signature: 'ts_concurrent_b', kind: 'transfer', from: address,
    to: 'recipient-b', amountUnits: '3', networkId: 'localnet' }),
]);
const pendingEnvelope = data.get('thru_pending_txs::localnet');
assert.equal(pendingEnvelope.version, 1);
assert.deepEqual(new Set(pendingEnvelope.records.map((row) => row.signature)),
  new Set(['ts_concurrent_a', 'ts_concurrent_b']));
console.log('  ok - v0 migrates to v1 and simultaneous tracks cannot overwrite each other');

