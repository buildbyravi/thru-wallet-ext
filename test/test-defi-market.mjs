// DeFi market gate (G1-C): the coalescing read cache and the slice assembly layer.
//
//   1. read-cache: one in-flight read per key, TTL honesty, genesis-bound keys, bounded size
//   2. slice assembly: chain-before-index, per-slice honest fallbacks, cache integration
//   3. wire preservation: the market.* router surface still answers the M0 dossier exactly
//   4. zero storage writes
//
// Run: node test/test-defi-market.mjs

let storageWrites = 0;
globalThis.chrome = {
  runtime: {
    id: 'test',
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    sendMessage: () => Promise.resolve(),
  },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => { storageWrites += 1; },
      remove: async () => { storageWrites += 1; },
    },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
  },
};

const { createReadCache, paramsKey } = await import('../src/background/services/defi/read-cache.js');
const MARKET = await import('../src/background/services/defi/market-reads.js');
const marketService = await import('../src/background/services/market-service.js');
const { handleApiRequest } = await import('../src/background/api-router.js');
const { FLAGS } = await import('../src/shared/flags.js');
const { M0_FLAG_ON, VALID_PARAMS } = await import('./fixtures/defi/fixtures.mjs');

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const FP = 'betanet|genesis-A';
const ENV_BASE = {
  networkId: 'betanet',
  fingerprint: FP,
  now: 1_759_690_000_000,
  dossier: {
    discovery: { key: 'discovery', state: 'unsupported', reason: 'NO_INDEXER' },
    charts: { key: 'charts', state: 'unsupported', reason: 'NO_INDEXER' },
    usd: { key: 'usd', state: 'unsupported', reason: 'DEPENDENCY_UNVERIFIED' },
    launchMint: { key: 'launchMint', state: 'unsupported', reason: 'TOKEN_PATH_UNVERIFIED' },
  },
  facts: { token: 'taTOKEN…', oracle: 'taPRC…' },
  risk: async () => ({ supported: true, data: { overallRisk: 'high', reasons: [] } }),
};

// ---------------------------------------------------------------------------
section('Read cache: one in-flight read per key, TTL honesty, genesis-bound keys');

{
  let now = 1000;
  const cache = createReadCache({ maxEntries: 4, now: () => now });

  // Coalescing: 5 concurrent identical reads -> exactly one upstream call.
  let upstreamCalls = 0;
  const fetcher = async () => { upstreamCalls += 1; await new Promise((r) => setTimeout(r, 5)); return { block: 7 }; };
  const results = await Promise.all([
    cache.getOrFetch('k', 100, fetcher), cache.getOrFetch('k', 100, fetcher),
    cache.getOrFetch('k', 100, fetcher), cache.getOrFetch('k', 100, fetcher),
    cache.getOrFetch('k', 100, fetcher),
  ]);
  ok('5 concurrent identical reads run upstream exactly once (coalescing)',
    upstreamCalls === 1 && results.every((r) => r.block === 7),
    `upstreamCalls=${upstreamCalls}`);
  ok('stats show exactly one miss and four coalesced shares',
    cache.stats().misses === 1 && cache.stats().coalesced === 4, JSON.stringify(cache.stats()));

  // TTL: inside the window the value is served; past it, upstream runs again.
  await cache.getOrFetch('k', 100, fetcher);
  ok('a fresh cached value is served without upstream', upstreamCalls === 1);
  now += 150;
  await cache.getOrFetch('k', 100, fetcher);
  ok('an expired entry triggers a fresh upstream read (staleness never served)',
    upstreamCalls === 2, `upstreamCalls=${upstreamCalls}`);

  // TTL 0: result not stored, but the in-flight call still coalesces.
  let zeroCalls = 0;
  const zeroFetcher = async () => { zeroCalls += 1; return 1; };
  await Promise.all([cache.getOrFetch('z', 0, zeroFetcher), cache.getOrFetch('z', 0, zeroFetcher)]);
  ok('ttl=0 coalesces in-flight but stores nothing', zeroCalls === 1 && cache.size() === 1 /* only k */);
  await cache.getOrFetch('z', 0, zeroFetcher);
  ok('ttl=0 reads again next time (no accidental caching)', zeroCalls === 2);

  // Errors propagate and are NOT cached: retry runs upstream again.
  let errorCalls = 0;
  const errFetcher = async () => { errorCalls += 1; throw new Error('rpc down'); };
  await cache.getOrFetch('e', 100, errFetcher).catch((e) => e.message);
  await cache.getOrFetch('e', 100, errFetcher).catch((e) => e.message);
  ok('upstream errors propagate and are never cached', errorCalls === 2, `errorCalls=${errorCalls}`);

  // Genesis binding: the fingerprint is part of the key — a reset cannot collide.
  const fpCache = createReadCache({ now: () => now });
  let fpCalls = 0;
  const fpFetch = async () => { fpCalls += 1; return { n: fpCalls }; };
  const keyA = MARKET.sliceCacheKey('market.assetGet', { networkId: 'betanet', fingerprint: 'genesis-A' }, 'price|native');
  await fpCache.getOrFetch(keyA, 1000, fpFetch);
  const keyB = MARKET.sliceCacheKey('market.assetGet', { networkId: 'betanet', fingerprint: 'genesis-B' }, 'price|native');
  const rB = await fpCache.getOrFetch(keyB, 1000, fpFetch);
  ok('genesis reset makes old entries unreachable by key construction (no stale-after-reset)',
    fpCalls === 2 && rB.n === 2);

  // Bounded size: oldest evicted at capacity.
  const small = createReadCache({ maxEntries: 2, now: () => now });
  await small.getOrFetch('a', 1000, async () => 'a');
  await small.getOrFetch('b', 1000, async () => 'b');
  await small.getOrFetch('c', 1000, async () => 'c');
  ok('the cache is bounded (oldest evicted at capacity)', small.size() === 2);

  // Invalidation.
  small.invalidate('b');
  ok('granular invalidation drops one key', small.size() === 1);
  small.invalidate();
  ok('full invalidation empties the cache', small.size() === 0);

  // paramsKey canonicalization.
  ok('params keys are canonical (order-independent)',
    paramsKey({ b: [2, { d: 4, c: 3 }], a: 1 }) === paramsKey({ a: 1, b: [2, { c: 3, d: 4 }] }));
}

// ---------------------------------------------------------------------------
section('Slice assembly: chain-before-index, per-slice honest fallbacks, cache integration');

{
  // 1. The honest today: every source absent -> per-slice honest states, facts still real.
  const today = await MARKET.assembleAssetGet('native', { ...ENV_BASE });
  ok('with no verified source, header is honestly absent (not fabricated from the query)',
    deepEqual(today.header, { supported: false, reason: 'NO_INDEXER' }), JSON.stringify(today.header));
  ok('facts slice carries recorded evidence (registry statements + fingerprint)',
    today.facts?.supported === true && today.facts.data.fingerprint === FP && today.facts.data.programs.token === 'taTOKEN…');
  ok('value slices answer their dossier reasons, never numbers',
    deepEqual(today.price, { supported: false, reason: 'DEPENDENCY_UNVERIFIED' })
      && deepEqual(today.charts, { supported: false, reason: 'NO_INDEXER' })
      && deepEqual(today.trades, { supported: false, reason: 'NO_INDEXER' })
      && deepEqual(today.holders, { supported: false, reason: 'NO_INDEXER' }));
  ok('risk slice comes through the risk derivation seam',
    today.risk?.supported === true && today.risk.data?.overallRisk === 'high');
  ok('launch slice mirrors the launchMint dossier row',
    deepEqual(today.launch, { supported: false, reason: 'TOKEN_PATH_UNVERIFIED' }));

  // 2. usd enabled + only an index read -> 'index' source wins (nothing fabricates).
  const indexFirst = await MARKET.assembleAssetGet('native', {
    ...ENV_BASE,
    dossier: { ...ENV_BASE.dossier, usd: { key: 'usd', state: 'enabled', reason: null } },
    indexReads: { price: async () => ({ ok: true, data: { thruUsd: '0.041' } }) },
  });
  ok('with only an index source, the price slice says source=index honestly',
    indexFirst.price?.supported === true && indexFirst.price.source === 'index' && indexFirst.price.data.thruUsd === '0.041');

  // 3. Chain read ordering, PROVEN by call order: chain consulted first, error -> index.
  const order = [];
  const ordered = await MARKET.assembleAssetGet('native', {
    ...ENV_BASE,
    dossier: { ...ENV_BASE.dossier, usd: { key: 'usd', state: 'enabled', reason: null } },
    chainReads: { price: async () => { order.push('chain'); return { ok: false, reason: 'RPC_UNAVAILABLE' }; } },
    indexReads: { price: async () => { order.push('index'); return { ok: true, data: { thruUsd: '0.042' } }; } },
  });
  ok('chain read runs before index read (R16 order), index supplements on failure',
    deepEqual(order, ['chain', 'index']) && ordered.price.source === 'index' && ordered.price.data.thruUsd === '0.042',
    JSON.stringify(order));

  // 4. Both sources fail -> the slice falls back to its honest reason, no number invented.
  const bothFail = await MARKET.assembleAssetGet('native', {
    ...ENV_BASE,
    dossier: { ...ENV_BASE.dossier, usd: { key: 'usd', state: 'enabled', reason: null } },
    chainReads: { price: async () => ({ ok: false, reason: 'RPC_UNAVAILABLE' }) },
    indexReads: { price: async () => ({ ok: false, reason: 'NO_INDEXER' }) },
  });
  ok('when every source fails the slice answers the honest reason (never zero, never 404-dollar)',
    deepEqual(bothFail.price, { supported: false, reason: 'DEPENDENCY_UNVERIFIED' }));

  // 5. Snapshots: per-asset honest entries; unsupported usd -> no fetch calls at all.
  let snapFetches = 0;
  const snapshots = await MARKET.assembleSnapshots(['native', 'taXX'], {
    ...ENV_BASE,
    indexReads: { price: async () => { snapFetches += 1; return { ok: true, data: {} }; } },
  });
  ok('snapshots answer per asset and unsupported dossier rows short-circuit the reads',
    snapFetches === 0
      && deepEqual(snapshots.native.price, { supported: false, reason: 'DEPENDENCY_UNVERIFIED' })
      && snapshots.taXX.assetId === 'taXX', `snapFetches=${snapFetches}`);

  // 6. Cache integration: two assembles inside TTL run the upstream once.
  let pCalls = 0;
  const warmEnv = {
    ...ENV_BASE,
    dossier: { ...ENV_BASE.dossier, usd: { key: 'usd', state: 'enabled', reason: null } },
    chainReads: { price: async () => { pCalls += 1; return { ok: true, data: { thruUsd: '0.040' } }; } },
    cache: createReadCache({ now: () => Date.now() }),
    ttlMs: { price: 60_000, header: 60_000 },
  };
  await MARKET.assembleAssetGet('native', warmEnv);
  await MARKET.assembleAssetGet('native', warmEnv);
  ok('two assembles inside TTL coalesce to one upstream read', pCalls === 1, `pCalls=${pCalls}`);

  // 7. Same cache, different genesis: the fingerprint in the key forces a fresh read.
  const afterReset = { ...warmEnv, fingerprint: 'betanet|genesis-B' };
  await MARKET.assembleAssetGet('native', afterReset);
  ok('a genesis reset makes the cached price unreachable (B3 by key, no sweep needed)',
    pCalls === 2, `pCalls=${pCalls}`);
}

// ---------------------------------------------------------------------------
section('Wire preservation: market.* via the router still answers the M0 dossier exactly');

{
  const saved = { ...FLAGS };
  FLAGS.DEFI = true;
  FLAGS.DEFI_MARKET = true;
  FLAGS.DEFI_RISK = true;
  const probes = ['market.assetGet', 'market.assetSearch', 'market.snapshot', 'market.candles', 'market.trades', 'market.holders'];
  const results = {};
  for (const m of probes) {
    results[m] = await handleApiRequest({ method: m, params: VALID_PARAMS[m] });
  }
  Object.keys(FLAGS).forEach((k) => { FLAGS[k] = saved[k]; });

  const allMatch = probes.every((m) => {
    const expected = M0_FLAG_ON[m]?.expect?.data;
    return expected && deepEqual(results[m]?.ok === true ? results[m].data : results[m], expected);
  });
  ok('flag-on dossier rung is byte-identical to the M0 fixtures (the gate still resolves first)',
    allMatch, JSON.stringify(results['market.candles']).slice(0, 160));
}

// ---------------------------------------------------------------------------
section('Read path does zero storage writes (stateless by design)');

ok('no chrome.storage writes across every market read above', storageWrites === 0, `writes: ${storageWrites}`);

console.log(`\n${failures === 0 ? 'All' : ''} DeFi market checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(`\n${failures} market check(s) failed.`);
  process.exit(1);
}
console.log('The market layer coalesces reads, binds cache keys to genesis, orders chain before');
console.log('index, and answers every unverified slice with its honest reason — wire unchanged.');
