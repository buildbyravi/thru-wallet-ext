// History timestamps: use the block's time (not the local clock), keep slots isolated
// across chains, and never hold the per-network storage writer while waiting for RPC.
// No real network or browser is needed: the official SDK client methods are stubbed.
import assert from 'node:assert/strict';
import { BlockView } from '@thru/sdk';
import * as history from '../src/background/services/history-service.js';
import * as txService from '../src/background/services/tx-service.js';
import * as networks from '../src/background/services/network-service.js';
import * as thruClient from '../src/lib/thru-client.js';
import { relTime } from '../src/ui/domain/tx-card.js';

const data = new Map();
const alphaScope = 'thru_history_cache::alphanet';
const localScope = 'thru_history_cache::localnet';
globalThis.chrome = {
  runtime: { sendMessage: () => Promise.resolve() },
  storage: { local: {
    async get(key) { return { [key]: structuredClone(data.get(key)) }; },
    async set(update) {
      for (const [key, value] of Object.entries(update)) data.set(key, structuredClone(value));
    },
  } },
};

const NS_A = 1_700_000_000_000_000_000n;
const NS_B = 1_800_000_000_000_000_000n;
const MS_A = Number(NS_A / 1_000_000n);
const MS_B = Number(NS_B / 1_000_000n);
const slot = 427;
const format = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`
    + `/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}`
    + `:${String(d.getMinutes()).padStart(2, '0')}`;
};
function fakeTransaction(signature, blockSlot) {
  return {
    slot: BigInt(blockSlot),
    getSignature: () => ({ toThruFmt: () => signature }),
    program: { toThruFmt: () => 'ta_unknown_program' },
    executionResult: { vmError: 0 },
    instructionData: new Uint8Array(0),
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
async function waitFor(predicate) {
  for (let i = 0; i < 200 && !predicate(); i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(predicate(), 'the mocked block-header RPC was reached');
}

const savedClients = new Map();
function trackClient() {
  const bound = thruClient.getClient();
  if (!savedClients.has(bound)) savedClients.set(bound, {
    block: bound.blocks.get,
    list: bound.transactions.listForAccount,
  });
  return bound;
}
await networks.setActiveNetwork('alphanet');
let alphaClient = trackClient();
let alphaCalls = 0;
let localClient;
try {
  alphaClient.blocks.get = async ({ slot: requested }, options) => {
    alphaCalls += 1;
    assert.equal(requested, slot);
    assert.equal(options?.view, BlockView.HEADER_ONLY, 'History only requests block headers');
    return { blockTimeNs: NS_A };
  };
  assert.equal(await thruClient.getBlockTimeMs(slot, 'alphanet'), MS_A);
  assert.equal(await thruClient.getBlockTimeMs(slot, 'alphanet'), MS_A);
  assert.equal(alphaCalls, 1, 'successful lookups are cached within a network');
  assert.equal(relTime(MS_A, slot), format(MS_A));
  assert.equal(relTime(null, slot), `Block ${slot}`);
  assert.equal(relTime(Number.MAX_VALUE, slot), `Block ${slot}`, 'invalid dates do not render NaN');

  await networks.setActiveNetwork('localnet');
  localClient = trackClient();
  const originalLocalBlock = localClient.blocks.get;
  try {
    let localCalls = 0;
    localClient.blocks.get = async ({ slot: requested }, options) => {
      localCalls += 1;
      assert.equal(requested, slot);
      assert.equal(options?.view, BlockView.HEADER_ONLY);
      return { blockTimeNs: NS_B };
    };
    assert.equal(await thruClient.getBlockTimeMs(slot, 'localnet'), MS_B,
      'the same slot on another chain has its own block time');
    assert.equal(localCalls, 1, 'the second chain did not reuse an Alphanet cache entry');
  } finally {
    localClient.blocks.get = originalLocalBlock;
  }
  await networks.setActiveNetwork('alphanet');
  alphaClient = trackClient();
  assert.equal(await thruClient.getBlockTimeMs(slot, 'alphanet'), MS_A);
  assert.equal(alphaCalls, 1, 'switching back can reuse only the correct chain\'s entry');
  console.log('  ok - header-only block times are valid, bounded-date, cached and network-scoped');

  // A late Alphanet lookup must not overwrite a Localnet result even when their slots match.
  const late = deferred();
  let started = false;
  alphaClient.blocks.get = ({ slot: requested }) => {
    assert.equal(requested, 428);
    started = true;
    return late.promise;
  };
  const oldChain = thruClient.getBlockTimeMs(428, 'alphanet');
  await waitFor(() => started);
  await networks.setActiveNetwork('localnet');
  const local = trackClient();
  const originalLocalBlock2 = local.blocks.get;
  try {
    local.blocks.get = async () => ({ blockTimeNs: NS_B });
    assert.equal(await thruClient.getBlockTimeMs(428, 'localnet'), MS_B);
  } finally {
    local.blocks.get = originalLocalBlock2;
  }
  late.resolve({ blockTimeNs: NS_A });
  assert.equal(await oldChain, null, 'an in-flight result for an unselected chain is discarded');
  await networks.setActiveNetwork('alphanet');
  alphaClient = trackClient();
  alphaClient.blocks.get = async () => ({ blockTimeNs: NS_A });
  assert.equal(await thruClient.getBlockTimeMs(428, 'alphanet'), MS_A);

  alphaClient.blocks.get = async () => { throw new Error('offline'); };
  assert.equal(await thruClient.getBlockTimeMs(429, 'alphanet'), null);
  alphaClient.blocks.get = async () => ({ blockTimeNs: NS_A });
  assert.equal(await thruClient.getBlockTimeMs(429, 'alphanet'), MS_A,
    'an unavailable block is retried, not cached as an invented time');
  assert.equal(await thruClient.getBlockTimeMs('not a slot', 'alphanet'), null);
  assert.equal(await thruClient.getBlockTimeMs('429.5', 'alphanet'), null);
  assert.equal(await thruClient.getBlockTimeMs('9007199254740993', 'alphanet'), null);

  const sharedHeader = deferred();
  let sharedCalls = 0;
  alphaClient.blocks.get = ({ slot: requested }) => {
    assert.equal(requested, 435);
    sharedCalls += 1;
    return sharedHeader.promise;
  };
  const sharedA = thruClient.getBlockTimeMs(435, 'alphanet');
  const sharedB = thruClient.getBlockTimeMs('435', 'alphanet');
  try {
    await waitFor(() => sharedCalls > 0);
    assert.equal(sharedCalls, 1, 'concurrent requests for one chain/slot share one RPC');
  } finally {
    sharedHeader.resolve({ blockTimeNs: NS_A });
  }
  assert.deepEqual(await Promise.all([sharedA, sharedB]), [MS_A, MS_A]);
  console.log('  ok - late RPCs, duplicate lookups, invalid slots and outages cannot poison timestamps');

  // The own submittedAt timestamp is real, but it is not the chain's block time. Where the
  // block header is available it must win, even when a pending record already has a date.
  data.set('thru_pending_txs::alphanet', [
    { signature: 'ts_chain_time', submittedAt: 1_600_000_000_000 },
  ]);
  alphaClient.transactions.listForAccount = async () => ({ transactions: [
    fakeTransaction('ts_chain_time', 430),
    fakeTransaction('ts_same_block', 430),
  ] });
  let blockCalls = 0;
  alphaClient.blocks.get = async ({ slot: requested }) => {
    assert.equal(requested, 430);
    blockCalls += 1;
    return { blockTimeNs: NS_A };
  };
  const firstFeed = await history.getHistoryFeed('ta_time_feed');
  assert.equal(firstFeed.synced, true);
  assert.equal(firstFeed.entries.length, 2);
  assert.ok(firstFeed.entries.every((e) => e.timestamp === MS_A && e.timestampSource === 'block'));
  assert.equal(blockCalls, 1, 'transactions sharing a block request its header once');
  assert.equal(data.get(alphaScope).ta_time_feed.entries[0].timestamp, MS_A,
    'the persisted cache records the verified on-chain time');
  assert.equal(typeof firstFeed.entries[0].timestamp, 'number',
    'timestamps cross the API seam as numbers, not BigInts or invented strings');
  console.log('  ok - chain time wins over local submission time and is cached per block');

  // A block-sourced timestamp persists across service-worker restarts; do not re-fetch it
  // just because the list response itself does not contain wall-clock time.
  data.set(alphaScope, {
    ...data.get(alphaScope),
    ta_known_block: { entries: [{ signature: 'ts_known', slot: '431', timestamp: MS_A,
      timestampSource: 'block' }], nextCursor: null, updatedAt: 1 },
  });
  alphaClient.transactions.listForAccount = async () => ({ transactions: [fakeTransaction('ts_known', 431)] });
  let redundantCalls = 0;
  alphaClient.blocks.get = async () => { redundantCalls += 1; throw new Error('offline'); };
  const knownFeed = await history.getHistoryFeed('ta_known_block');
  assert.equal(knownFeed.entries[0].timestamp, MS_A);
  assert.equal(knownFeed.entries[0].timestampSource, 'block');
  assert.equal(redundantCalls, 0, 'a verified cached block timestamp needs no new RPC');

  alphaClient.transactions.listForAccount = async () => ({ transactions: [fakeTransaction('ts_no_header', 432)] });
  alphaClient.blocks.get = async () => ({ blockTimeNs: 0n });
  const absent = await history.getHistoryFeed('ta_no_header');
  assert.equal(absent.entries[0].timestamp, null, 'zero or missing block time is not a date');
  assert.equal(relTime(absent.entries[0].timestamp, absent.entries[0].slot), 'Block 432');

  data.set('thru_pending_txs::alphanet', [
    { signature: 'ts_submitted', submittedAt: 1_600_000_000_000 },
  ]);
  alphaClient.transactions.listForAccount = async () => ({ transactions: [fakeTransaction('ts_submitted', 436)] });
  alphaClient.blocks.get = async () => { throw new Error('block RPC unavailable'); };
  const submitted = await history.getHistoryFeed('ta_submitted');
  assert.equal(submitted.entries[0].timestamp, 1_600_000_000_000);
  assert.equal(submitted.entries[0].timestampSource, 'submitted',
    'a local submission timestamp is marked as such, not mistaken for a block time');
  console.log('  ok - verified timestamps survive refresh; missing times retain honest fallbacks');

  // Load more uses tx.listHistory directly rather than the cache-merged first-page feed.
  // Only the requested page's slots should be enriched, not all cursor + limit entries.
  alphaClient.transactions.listForAccount = async () => ({ transactions: Array.from(
    { length: 18 }, (_, i) => fakeTransaction(`ts_page_${i}`, 440 + Math.floor(i / 2)),
  ) });
  const pagedSlots = [];
  alphaClient.blocks.get = async ({ slot: requested }) => {
    pagedSlots.push(requested);
    return { blockTimeNs: NS_B };
  };
  const page = await txService.listHistory('ta_paginated', { limit: 3, cursor: 15 });
  assert.deepEqual(page.entries.map((e) => e.signature), ['ts_page_15', 'ts_page_16', 'ts_page_17']);
  assert.ok(page.entries.every((e) => e.timestamp === MS_B && e.timestampSource === 'block'));
  assert.deepEqual(pagedSlots.sort((a, b) => a - b), [447, 448],
    'only unique slots from the displayed page need block-header RPCs');
  console.log('  ok - Load more pages show real dates without fetching pre-cursor blocks');

  // Slow block RPC must not monopolize the storage writer shared by all accounts on the
  // selected network. We can clear account B while account A awaits a block header.
  data.set(alphaScope, {
    ...data.get(alphaScope),
    ta_other: { entries: [{ signature: 'ts_other' }], nextCursor: null, updatedAt: 1 },
  });
  alphaClient.transactions.listForAccount = async () => ({ transactions: [fakeTransaction('ts_delayed', 433)] });
  const pendingHeader = deferred();
  let headerStarted = false;
  alphaClient.blocks.get = ({ slot: requested }) => {
    assert.equal(requested, 433);
    headerStarted = true;
    return pendingHeader.promise;
  };
  const delayedFeed = history.getHistoryFeed('ta_slow_header');
  try {
    await waitFor(() => headerStarted);
    const clear = history.clearHistoryCache('ta_other');
    const unlocked = await Promise.race([
      clear.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    assert.equal(unlocked, true, 'one slow block RPC does not block another address\'s write');
  } finally {
    pendingHeader.resolve({ blockTimeNs: NS_A });
  }
  const delayedResult = await delayedFeed;
  assert.equal(delayedResult.entries[0].timestamp, MS_A);
  assert.equal(Object.hasOwn(data.get(alphaScope), 'ta_other'), false);
  console.log('  ok - header RPCs run outside the serialized storage-write section');

  // Switching chains while the header RPC is outstanding must fail the feed rather than
  // labeling old-chain history as a successful sync or writing to either network cache.
  alphaClient.transactions.listForAccount = async () => ({ transactions: [fakeTransaction('ts_stale', 434)] });
  const staleHeader = deferred();
  let staleStarted = false;
  alphaClient.blocks.get = () => { staleStarted = true; return staleHeader.promise; };
  const staleFeed = history.getHistoryFeed('ta_stale_header');
  try {
    await waitFor(() => staleStarted);
    await networks.setActiveNetwork('localnet');
  } finally {
    staleHeader.resolve({ blockTimeNs: NS_A });
  }
  await assert.rejects(staleFeed, (e) => e.code === 'NETWORK_CHANGED');
  assert.equal(Object.hasOwn(data.get(alphaScope), 'ta_stale_header'), false);
  assert.equal(Object.hasOwn(data.get(localScope) || {}, 'ta_stale_header'), false);
  console.log('  ok - a chain switch during timestamp resolution invalidates the feed');

  await networks.setActiveNetwork('alphanet');
  alphaClient = trackClient();
  alphaClient.transactions.listForAccount = async () => ({ transactions: [fakeTransaction('ts_page_stale', 451)] });
  const latePageHeader = deferred();
  let latePageStarted = false;
  alphaClient.blocks.get = () => { latePageStarted = true; return latePageHeader.promise; };
  const stalePage = txService.listHistory('ta_stale_page', { limit: 1, cursor: 0 });
  try {
    await waitFor(() => latePageStarted);
    await networks.setActiveNetwork('localnet');
  } finally {
    latePageHeader.resolve({ blockTimeNs: NS_A });
  }
  await assert.rejects(stalePage, (e) => e.code === 'NETWORK_CHANGED');
  console.log('  ok - paged reads also refuse an old-network timestamp after a chain switch');
} finally {
  for (const [bound, original] of savedClients) {
    bound.blocks.get = original.block;
    bound.transactions.listForAccount = original.list;
  }
  await networks.setActiveNetwork('alphanet');
}

console.log('History block-time tests passed.');
