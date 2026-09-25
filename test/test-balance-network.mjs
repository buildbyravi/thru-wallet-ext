// Read-path network binding and cache isolation, using a fake SDK account reader.
// No real RPC, wallet keys or Chrome browser are required.
import assert from 'node:assert/strict';
import { getNetworkConfig } from '../src/lib/networks.js';
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
await networks.setActiveNetwork('alphanet');
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
assert.equal(typeof finishRead, 'function', 'Alphanet account RPC started');
await networks.setActiveNetwork('localnet');
finishRead();
await assert.rejects(pending, (error) => error.code === 'NETWORK_CHANGED');
alphaClient.accounts.get = originalAlphaGet;
assert.equal(data.has('thru_balance_cache::alphanet'), false);
assert.equal(data.has('thru_balance_cache::localnet'), false);
assert.equal(events.filter((event) => event.event === 'balanceChanged').length, 0);
console.log('  ok - switching while an RPC is pending neither writes nor emits its old-chain result');

console.log('[network reads] a cold worker binds the active chain for token reads');
// Force the SDK to point at Alphanet while local storage selects localnet. A token read
// with an empty registry uses no network, but MUST rebind before its first possible RPC.
thruClient.configureNetwork(getNetworkConfig('alphanet'));
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
await networks.setActiveNetwork('alphanet');
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
assert.equal(data.has('thru_pending_txs::alphanet'), false);
assert.equal(data.get('thru_pending_txs::localnet')?.[0].signature, 'ts_fixture');
assert.equal(events.filter((message) => message.event === 'pendingTxChanged').length,
  beforePendingEvents, 'do not announce a localnet send on the Alphanet UI');
assert.deepEqual(await pendingTx.list(), []);
await networks.setActiveNetwork('localnet');
assert.equal((await pendingTx.list())[0].signature, 'ts_fixture');
console.log('  ok - a late send tracks/badges only the original network');
