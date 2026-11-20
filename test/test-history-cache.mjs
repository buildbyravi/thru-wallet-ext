// Cache-first history service: no RPC on the early path, network/address isolation and
// refusal to store a late history response under another chain. All RPCs are mocked.
import assert from 'node:assert/strict';
import * as history from '../src/background/services/history-service.js';
import * as networks from '../src/background/services/network-service.js';
import * as thruClient from '../src/lib/thru-client.js';
import { getNetworkConfig, NETWORKS } from '../src/lib/networks.js';

// The shipped wallet disables Localnet (custom chains come later); this suite needs a second
// selectable network to prove per-network isolation, so re-enable it in-process only.
NETWORKS.localnet.enabled = true;

const data = new Map();
let writes = 0;
let onRead = null;
let failWrite = null;
const historyWrites = [];
globalThis.fetch = async () => { throw new Error('Unexpected real RPC'); };
globalThis.chrome = {
  runtime: { sendMessage: () => Promise.resolve() },
  storage: { local: {
    async get(key) {
      const result = structuredClone(key === null ? Object.fromEntries(data) : { [key]: data.get(key) });
      await onRead?.(key);
      return result;
    },
    async set(next) {
      if (failWrite && Object.hasOwn(next, failWrite)) { failWrite = null; throw new Error('Injected write failure'); }
      writes += 1;
      historyWrites.push(structuredClone(next));
      for (const [key, value] of Object.entries(next)) data.set(key, structuredClone(value));
    },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key); },
  } },
};

const A = 'taAA_test_history';
const B = 'taBB_test_history';
const alphaEntry = { signature: 'ts_alpha_cache', kind: 'sent', amount: '123', timestamp: null };
const localEntry = { signature: 'ts_local_cache', kind: 'received', amount: '456', timestamp: null };
const ALPHA_CHAIN = history.chainFingerprint(getNetworkConfig('betanet'));
const LOCAL_CHAIN = history.chainFingerprint(getNetworkConfig('localnet'));
data.set('thru_history_cache::betanet', {
  _chain: ALPHA_CHAIN,
  [A]: { entries: [alphaEntry], nextCursor: 8, updatedAt: 112233 },
  [B]: { entries: [{ signature: 'ts_other_account' }], nextCursor: null, updatedAt: 99 },
});
data.set('thru_history_cache::localnet', {
  _chain: LOCAL_CHAIN,
  [A]: { entries: [localEntry], nextCursor: 4, updatedAt: 223344 },
});

await networks.setActiveNetwork('betanet');
// A storage-only cache read must not even REBIND the SDK client (a read can be used offline).
thruClient.configureNetwork((await import('../src/lib/networks.js')).getNetworkConfig('localnet'));
const before = writes;
const cached = await history.getCachedHistory(A);
assert.deepEqual(cached, {
  address: A, networkId: 'betanet', entries: [alphaEntry], nextCursor: 8, updatedAt: 112233,
});
assert.equal(writes, before, 'storage-only history read does not write');
assert.equal(thruClient.getConfiguredNetwork().id, 'localnet', 'storage-only read does not bind RPC');
const terminal = await history.getCachedHistory(B);
assert.deepEqual(terminal.entries, [{ signature: 'ts_other_account' }]);
assert.equal(terminal.nextCursor, null, 'a cached last page must not lead back to offset zero');
const missing = await history.getCachedHistory('missing');
assert.deepEqual(missing.entries, [], 'missing cache is empty, not fabricated');
assert.equal(missing.nextCursor, null, 'a cache miss has no continuation');
console.log('  ok - history cache reads only the requested network/address and never touches RPC');

// ---- Chain identity: the betanet-reset regression ----
// The chain was replaced under the SAME network id (and the same chainId). A cache
// written against the previous genesis must never surface its rows again — neither
// through the cached path nor through the merge in the feed — and the read itself
// must not write storage.
const writesBeforeDrop = writes;
data.set('thru_history_cache::betanet', {
  _chain: 'betanet|pre|reset|genesis|gone|gone',
  [A]: { entries: [{ signature: 'ts_from_the_dead_chain' }] },
});
assert.deepEqual((await history.getCachedHistory(A)).entries, [],
  'rows from a previous chain under the same network id are not served');
// A pre-fingerprint cache (written before this check existed) is treated the same.
data.set('thru_history_cache::betanet', {
  [A]: { entries: [{ signature: 'ts_pre_fingerprint_cache' }] },
});
assert.deepEqual((await history.getCachedHistory(A)).entries, [],
  'a cache without a chain identity is not trusted');
assert.equal(writes, writesBeforeDrop, 'dropping a stale cache is a read, not a write');
// Restore the identity-verified cache the surrounding sections rely on.
data.set('thru_history_cache::betanet', {
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
// The feed's chain-reality probe (getBlockHeight) is stubbed unavailable through most of
// this suite: these sections exercise cache behavior, and the probe is try/catch-tolerant
// (the fallback bounds cached rows by the newest page's own slots). The same-address
// reset section below stubs a real height to prove the stronger evidence works.
const originalHeight = localClient.blocks.getBlockHeight;
localClient.blocks.getBlockHeight = async () => { throw new Error('RPC offline'); };
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
  await networks.setActiveNetwork('betanet');
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
const originalAlphaHeight = alphaClient.blocks.getBlockHeight;
alphaClient.blocks.getBlockHeight = async () => { throw new Error('RPC offline'); };
try {
  alphaClient.transactions.listForAccount = async () => ({ transactions: [] });
  const endAddress = 'ta_history_end';
  const endFeed = await history.getHistoryFeed(endAddress);
  assert.equal(endFeed.synced, true);
  assert.equal(endFeed.nextCursor, null);
  assert.equal(data.get('thru_history_cache::betanet')[endAddress].nextCursor, null);
  assert.equal((await history.getCachedHistory(endAddress)).nextCursor, null);

  // A previous worker could persist zero when adding local submissions to a last page.
  const legacyAddress = 'ta_history_legacy_zero';
  const scopeWithLegacy = data.get('thru_history_cache::betanet');
  scopeWithLegacy[legacyAddress] = { entries: [alphaEntry], nextCursor: 0, updatedAt: 123 };
  assert.equal((await history.getCachedHistory(legacyAddress)).nextCursor, null);
  alphaClient.transactions.listForAccount = async () => { throw new Error('RPC offline'); };
  for (const [address, entries] of [[B, terminal.entries], [endAddress, []], [legacyAddress, [alphaEntry]], ['missing', []]]) {
    assert.deepEqual(await history.getHistoryFeed(address), { entries, nextCursor: null, synced: false });
  }
  console.log('  ok - terminal, legacy zero and missing cursors never restart pagination from cache or offline');

  alphaClient.transactions.listForAccount = async () => ({ transactions: [] });
  const [feedX, feedY] = await Promise.all([
    history.getHistoryFeed('ta_concurrent_X'),
    history.getHistoryFeed('ta_concurrent_Y'),
  ]);
  assert.equal(feedX.synced, true);
  assert.equal(feedY.synced, true);
  const scope = data.get('thru_history_cache::betanet');
  assert.ok(Object.hasOwn(scope, 'ta_concurrent_X') && Object.hasOwn(scope, 'ta_concurrent_Y'),
    'concurrent same-network writes keep both address entries');
} finally {
  alphaClient.transactions.listForAccount = originalAlphaList;
  alphaClient.blocks.getBlockHeight = originalAlphaHeight;
}
console.log('  ok - parallel account refreshes cannot clobber one another in the shared cache scope');

// ---- Same-address genesis swap (the 2026-09-27 chain reset) ----
// This reset reused the SAME managed program addresses, so the offline _chain fingerprint
// did not change. Only chain-reality evidence — a cached row's slot above the live chain's
// height — can see that the old rows' slots never happened on THIS chain.
data.set('thru_history_cache::betanet', {
  _chain: ALPHA_CHAIN,
  [A]: { entries: [alphaEntry], nextCursor: 8, updatedAt: 112233 },
  [B]: { entries: [{ signature: 'ts_other_account' }], nextCursor: null, updatedAt: 99 },
  ta_orphan_full: {
    entries: [{ signature: 'ts_pre_reset_row', slot: 9_999_999 }],
    nextCursor: 3, updatedAt: 1,
  },
  ta_orphan_empty: {
    entries: [{ signature: 'ts_pre_reset_empty', slot: 8_888_888 }],
    nextCursor: 2, updatedAt: 1,
  },
});
// Probe and RPC mocks go on the CURRENT bound client: configureNetwork re-creates the
// memoized client object on every network switch, so a patch aimed at an earlier capture
// would silently miss (and the calls would go to the real SDK).
const resetClient = thruClient.getClient();
const originalResetHeight = resetClient.blocks.getBlockHeight;
const originalResetBlockGet = resetClient.blocks.get;
const originalResetList = resetClient.transactions.listForAccount;
resetClient.blocks.getBlockHeight = async () => ({
  finalized: 100n, locallyExecuted: 100n, clusterExecuted: 100n,
});
resetClient.blocks.get = async () => ({ blockTimeNs: 0n });
resetClient.transactions.listForAccount = async (address) => ({
  transactions: address === 'ta_orphan_full'
    ? [{
      slot: 7n,
      getSignature: () => ({ toThruFmt: () => 'ts_fresh_row' }),
      program: { toThruFmt: () => 'ta_unknown_program' },
      executionResult: { vmError: 0 },
      instructionData: new Uint8Array(0),
    }]
    : [],
});
const fullFeed = await history.getHistoryFeed('ta_orphan_full');
assert.ok(fullFeed.entries.some((e) => e.signature === 'ts_fresh_row'), 'fresh row is served');
assert.ok(!fullFeed.entries.some((e) => e.signature === 'ts_pre_reset_row'),
  'a cached row beyond the chain height is not merged beside fresh rows');
const emptyFeed = await history.getHistoryFeed('ta_orphan_empty');
assert.deepEqual(emptyFeed.entries.map((e) => e.signature), [],
  'a cached row beyond the chain height is dropped even with no fresh rows');
const scopeAfter = data.get('thru_history_cache::betanet');
assert.ok(!scopeAfter.ta_orphan_full.entries.some((e) => e.signature === 'ts_pre_reset_row'),
  'the persisted scope drops the orphan row');
assert.deepEqual(scopeAfter.ta_orphan_empty.entries, [],
  'the persisted scope drops orphans on the empty-history path too');
resetClient.blocks.getBlockHeight = originalResetHeight;
resetClient.blocks.get = originalResetBlockGet;
resetClient.transactions.listForAccount = originalResetList;
console.log('  ok - rows beyond the live chain height cannot resurface after a same-address reset');

await history.clearHistoryCache(A);
assert.deepEqual((await history.getCachedHistory(A)).entries, []);
assert.deepEqual((await history.getCachedHistory(B)).entries, [{ signature: 'ts_other_account' }]);
await networks.setActiveNetwork('localnet');
assert.deepEqual((await history.getCachedHistory(A)).entries, [localEntry]);
console.log('  ok - deleting one address\'s cache leaves other accounts and networks intact');

// ---- Rabby pattern: newly submitted transactions appear in local history cache immediately ----
await networks.setActiveNetwork('betanet');
await history.recordSubmittedTransaction({
  signature: 'ts_submitted_rabby_style',
  kind: 'transfer',
  from: A,
  to: B,
  amountUnits: '777000',
  networkId: 'betanet',
});
const immediate = await history.getCachedHistory(A);
assert.equal(immediate.entries[0]?.signature, 'ts_submitted_rabby_style');
assert.equal(immediate.entries[0]?.status, 'submitted');
assert.equal(immediate.nextCursor, null, 'a local submission on a cache miss does not invent a page');
assert.equal(data.get('thru_history_cache::betanet')[A].nextCursor, null, 'local writes must not persist offset zero');
assert.equal(immediate.entries[0]?.kind, 'sent');
assert.equal(immediate.entries[0]?.counterparty, B);

// Recipient cache also receives incoming entry if it exists in scope
const recipientCache = await history.getCachedHistory(B);
assert.equal(recipientCache.entries[0]?.signature, 'ts_submitted_rabby_style');
assert.equal(recipientCache.entries[0]?.kind, 'received');
assert.equal(recipientCache.nextCursor, null, 'writing an incoming row preserves the recipient last page');
assert.equal(recipientCache.entries[0]?.counterparty, A);

// Settle transaction updates status to confirmed
await history.settleTransaction('ts_submitted_rabby_style', 'confirmed', null, 'betanet');
const settled = await history.getCachedHistory(A);
assert.equal(settled.entries[0]?.signature, 'ts_submitted_rabby_style');
assert.equal(settled.entries[0]?.status, 'confirmed');
assert.equal(settled.entries[0]?.success, true);
console.log('  ok - freshly submitted transactions persist immediately to local history cache and settle cleanly');

await history.recordSubmittedTransaction({ signature: 'ts_submitted_rabby_style',
  kind: 'transfer', from: A, to: B, amountUnits: '777000', networkId: 'betanet' });
await history.settleTransaction('ts_submitted_rabby_style', 'unknown', null, 'betanet');
assert.equal((await history.getCachedHistory(A)).entries[0]?.success, true,
  'late local submission and timeout cannot downgrade a confirmed transaction');
await history.recordSubmittedTransaction({ signature: 'ts_domain', kind: 'name-register',
  from: A, to: A, amountUnits: '0', submittedAt: 1_700_000_000_000, networkId: 'betanet' });
const domain = (await history.getCachedHistory(A)).entries[0];
assert.equal(domain.kind, 'other', 'non-transfer metadata never fabricates a THRU send');
assert.equal(domain.amount, null);
assert.equal(domain.timestamp, 1_700_000_000_000, 'reuse the original pending submission time');

localClient.blocks.getBlockHeight = originalHeight;

// Hold the active-ID read AFTER the authoritative queued scope read, not the earlier RPC.
// An alias roundtrip restores ID/config/client; only the generation distinguishes it.
const originalAliasRpc = NETWORKS.localnet.rpcUrl;
NETWORKS.localnet.rpcUrl = NETWORKS.betanet.rpcUrl;
await networks.setActiveNetwork('betanet');
const aliasClient = thruClient.getClient();
const aliasList = aliasClient.transactions.listForAccount;
const aliasHeight = aliasClient.blocks.getBlockHeight;
try {
  aliasClient.transactions.listForAccount = async () => ({ transactions: [] });
  aliasClient.blocks.getBlockHeight = async () => ({ finalized: 100n });
  for (const roundtrip of [false, true]) {
    const key = 'thru_history_cache::betanet';
    const beforeScope = structuredClone(data.get(key));
    const beforeOther = structuredClone(data.get('thru_history_cache::localnet'));
    const beforeGeneration = networks.getNetworkGeneration();
    let release;
    let entered;
    const held = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { entered = resolve; });
    let scopeReads = 0;
    onRead = async readKey => {
      if (readKey === key) scopeReads++;
      if (readKey === 'thru_active_network' && scopeReads === 2) {
        onRead = null;
        entered();
        await held;
      }
    };
    const feed = history.getHistoryFeed('ta_final_queue');
    const outcome = feed.then(value => ({ value }), error => ({ error }));
    await Promise.race([ready, outcome.then(() => { throw new Error('Final queued ID barrier not reached'); })]);
    assert.equal(scopeReads, 2, 'barrier is inside the queued persistence section');
    if (roundtrip) {
      await networks.setActiveNetwork('localnet');
      await networks.setActiveNetwork('betanet');
    } else {
      failWrite = 'thru_active_network';
      await assert.rejects(networks.setActiveNetwork('localnet'), /Injected write failure/);
    }
    assert.equal(thruClient.getClient(), aliasClient, 'same-RPC control retains the SDK client');
    assert.equal(thruClient.getConfiguredNetwork().id, 'betanet');
    assert.equal(await networks.getActiveNetworkId(), 'betanet');
    assert.equal(networks.getNetworkGeneration(), beforeGeneration + (roundtrip ? 2 : 0));
    const beforeWrites = historyWrites.length;
    release();
    const result = await outcome;
    if (roundtrip) {
      assert.equal(result.error?.code, 'NETWORK_CHANGED');
      assert.equal(historyWrites.length, beforeWrites, 'stale queued feed must not call storage.set');
      assert.deepEqual(data.get(key), beforeScope);
    } else {
      assert.equal(result.value?.synced, true, 'unchanged context is allowed to persist');
      assert.equal(historyWrites.length, beforeWrites + 1);
      assert.ok(data.get(key).ta_final_queue);
    }
    assert.deepEqual(data.get('thru_history_cache::localnet'), beforeOther);
  }
} finally {
  onRead = null;
  NETWORKS.localnet.rpcUrl = originalAliasRpc;
  aliasClient.transactions.listForAccount = aliasList;
  aliasClient.blocks.getBlockHeight = aliasHeight;
}
console.log('  ok - final queued persistence rejects a same-client roundtrip; failed switch still permits a fresh write');

const recoveryKey = 'thru_history_cache::betanet';
const recoveryClient = thruClient.getClient();
const recoveryList = recoveryClient.transactions.listForAccount;
const recoveryHeight = recoveryClient.blocks.getBlockHeight;
try {
  recoveryClient.transactions.listForAccount = async () => ({ transactions: [] });
  recoveryClient.blocks.getBlockHeight = async () => ({ finalized: 100n });
  const beforeScope = structuredClone(data.get(recoveryKey));
  const beforeWrites = historyWrites.length;
  let scopeReads = 0;
  onRead = key => {
    if (key === recoveryKey && ++scopeReads === 2) { onRead = null; throw new Error('Injected read failure'); }
  };
  const unavailable = await history.getHistoryFeed(A);
  assert.equal(unavailable.synced, false);
  assert.deepEqual(unavailable.entries, beforeScope[A].entries);
  assert.equal(historyWrites.length, beforeWrites);
  assert.deepEqual(data.get(recoveryKey), beforeScope, 'failed queued read cannot overwrite with an empty scope');
  failWrite = recoveryKey;
  const queued = await Promise.allSettled([
    history.recordSubmittedTransaction({ signature: 'ts_failed_write', from: A, networkId: 'betanet' }),
    history.recordSubmittedTransaction({ signature: 'ts_recovered_write', from: B, networkId: 'betanet' }),
  ]);
  assert.deepEqual(queued.map(r => r.status), ['rejected', 'fulfilled']);
  assert.match(queued[0].reason.message, /Injected write failure/);
  assert.deepEqual(data.get(recoveryKey)[A], beforeScope[A]);
  assert.equal(data.get(recoveryKey)[B].entries[0].signature, 'ts_recovered_write');
  console.log('  ok - failed queued history reads preserve cache and write failures allow later account recovery');

  let release;
  let entered;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  scopeReads = 0;
  onRead = async key => {
    if (key === recoveryKey) scopeReads++;
    if (key === 'thru_active_network' && scopeReads === 2) {
      onRead = null; entered(); await held;
    }
  };
  const late = history.getHistoryFeed(A).then(value => ({ value }), error => ({ error }));
  await Promise.race([ready, late.then(() => { throw new Error('Reset barrier not reached'); })]);
  const reset = history.clearAllHistory();
  const beforeReset = historyWrites.length;
  release();
  assert.equal((await late).error?.code, 'NETWORK_CHANGED');
  await reset;
  assert.equal(historyWrites.length, beforeReset);
  assert.equal([...data.keys()].some(key => key.startsWith('thru_history_cache::')), false);
  console.log('  ok - history reset drains a final queued write without resurrection');
} finally {
  onRead = null;
  recoveryClient.transactions.listForAccount = recoveryList;
  recoveryClient.blocks.getBlockHeight = recoveryHeight;
}
