// DeFi feed gate (G1-B): the SignedFeedRecord verification machine and its narrowing wiring.
//
//   1. record type: canonical bytes + structural parse (reject before crypto)
//   2. per-record verification: every dishonest variant lands in its honest state
//   3. aggregation: one publisher = one vote; quorum gates liveness and kill coverage
//   4. registry narrowing: KILL_SWITCH / FEED_MISSING fire on ENABLED rows only, flags and
//      genesis dominate, feeds narrow-never-widen, feedChanged fires once per real transition
//   5. zero storage writes on the read path
//
// Run: node test/test-defi-feed.mjs

// chrome stub with an event spy + write counter.
const sentEvents = [];
let storageWrites = 0;
globalThis.chrome = {
  runtime: {
    id: 'test',
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    sendMessage: (msg) => { sentEvents.push(msg); return Promise.resolve(); },
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

const { keys, signWithDomain, SignatureDomain } = await import('@thru/sdk');
const FEED = await import('../src/background/services/defi/feed-record.js');
const { SEED_FINGERPRINT, FEED_POLICY, FEATURES } = await import('../src/background/services/defi/capability-snapshot.js');
const REGISTRY = await import('../src/background/services/registry-service.js');
const { resolveGate } = await import('../src/background/services/defi/gating.js');
const { FLAGS } = await import('../src/shared/flags.js');

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

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const KNOWN_FEATURES = FEATURES.map((f) => f.key);

// Throwaway test publishers — never real keys, never reused anywhere.
const p1 = await keys.generateKeyPair();
const p2 = await keys.generateKeyPair();
const p3 = await keys.generateKeyPair(); // never pinned

async function makeRecord(kp, overrides = {}) {
  const record = {
    recordVersion: 1,
    feedId: 'thru-ops',
    networkId: 'betanet',
    fingerprint: SEED_FINGERPRINT,
    publisher: hex(kp.publicKey),
    issuedAt: Date.now() - 60_000,
    expiresAt: Date.now() + 600_000,
    ops: { kill: [] },
    ...overrides,
  };
  // Same domain the lib/feed-crypto adapter verifies against (SignatureDomain.MSG).
  const signature = hex(await signWithDomain(FEED.encodeRecordBody(record), kp.privateKey, kp.publicKey, SignatureDomain.MSG));
  return { ...record, signature };
}

const envFor = ({
  networkId = 'betanet',
  fingerprint = SEED_FINGERPRINT,
  pinnedPublishers = [hex(p1.publicKey), hex(p2.publicKey)],
  now = Date.now(),
} = {}) => ({
  networkId, fingerprint, pinnedPublishers, now, clockSkewMs: 300_000, knownFeatures: KNOWN_FEATURES,
});

// ---------------------------------------------------------------------------
section('Record type: canonical bytes and structural parse');

{
  const record = await makeRecord(p1, { ops: { kill: ['balances'] } });
  ok('a well-formed signed record parses', FEED.parseFeedRecord(record, { knownFeatures: KNOWN_FEATURES }).ok === true);
  ok('canonical encoding is key-order independent',
    deepEqual(
      FEED.encodeRecordBody(record).toString(),
      FEED.encodeRecordBody({ ops: record.ops, feedId: record.feedId, fingerprint: record.fingerprint, networkId: record.networkId, recordVersion: 1, publisher: record.publisher, issuedAt: record.issuedAt, expiresAt: record.expiresAt, signature: record.signature }).toString(),
    ));

  const cases = {
    'wrong version': { ...record, recordVersion: 2 },
    'short publisher': { ...record, publisher: 'abcd' },
    'bad window': { ...record, issuedAt: record.expiresAt + 1 },
    'duplicate kill': { ...record, ops: { kill: ['balances', 'balances'] } },
    'unknown kill feature': { ...record, ops: { kill: ['teleport'] } },
    'short signature': { ...record, signature: 'deff' },
  };
  const allMalformed = Object.entries(cases).every(([, value]) => {
    const r = FEED.parseFeedRecord(value, { knownFeatures: KNOWN_FEATURES });
    return r.ok === false;
  });
  ok('every dishonest shape is MALFORMED before crypto runs', allMalformed,
    JSON.stringify(Object.entries(cases).filter(([, v]) => FEED.parseFeedRecord(v, { knownFeatures: KNOWN_FEATURES }).ok).map(([k]) => k)));
}

section('Per-record verification: every dishonest variant gets its honest state');

{
  const good = await makeRecord(p1);
  ok('a genuine record verifies VALID',
    (await FEED.verifyFeedRecord(good, envFor())).state === FEED.VERIFY_STATES.VALID);

  ok('wrong network claims NETWORK_MISMATCH',
    (await FEED.verifyFeedRecord(await makeRecord(p1, { networkId: 'mainnet-alpha' }), envFor())).state === FEED.VERIFY_STATES.NETWORK_MISMATCH);

  ok('a record signed for an old genesis is GENESIS_MISMATCH (B3 applies to feeds too)',
    (await FEED.verifyFeedRecord(await makeRecord(p1, { fingerprint: 'betanet|dead-genesis' }), envFor())).state === FEED.VERIFY_STATES.GENESIS_MISMATCH);

  ok('an unpinned publisher is PUBLISHER_UNPINNED (signature never consulted)',
    (await FEED.verifyFeedRecord(await makeRecord(p3), envFor())).state === FEED.VERIFY_STATES.PUBLISHER_UNPINNED);

  const tampered = await makeRecord(p1);
  tampered.ops = { kill: ['balances'] }; // edited after signing
  ok('a body edited after signing is SIGNATURE_INVALID',
    (await FEED.verifyFeedRecord(tampered, envFor())).state === FEED.VERIFY_STATES.SIGNATURE_INVALID);

  ok('an expired record is RECORD_STALE',
    (await FEED.verifyFeedRecord(await makeRecord(p1, { issuedAt: Date.now() - 3_600_000, expiresAt: Date.now() - 1_000 }), envFor())).state === FEED.VERIFY_STATES.RECORD_STALE);

  ok('a record dated too far in the future is RECORD_STALE (clock games buy nothing)',
    (await FEED.verifyFeedRecord(
      await makeRecord(p1, { issuedAt: Date.now() + 1_800_000, expiresAt: Date.now() + 3_600_000 }),
      envFor(),
    )).state === FEED.VERIFY_STATES.RECORD_STALE);
}

section('Aggregation: one publisher, one vote; quorum gates everything');

{
  const policy2 = { ...FEED_POLICY, quorum: 2, publishers: [hex(p1.publicKey), hex(p2.publicKey)] };

  ok('the shipped policy is INERT (quorum 0, no publishers) and matches the shipped registry cache',
    deepEqual(FEED.defaultAggregate(FEED_POLICY), await FEED.aggregateFeedState([], FEED_POLICY, envFor()))
      && deepEqual(REGISTRY.getFeedState(), FEED.defaultAggregate(FEED_POLICY)));

  const noFeeds = await FEED.aggregateFeedState([], policy2, envFor());
  ok('configured policy with no records is NO_FEEDS', noFeeds.state === FEED.AGGREGATE_STATES.NO_FEEDS);

  const oneValid = await FEED.aggregateFeedState([await makeRecord(p1)], policy2, envFor());
  ok('1-of-2 quorum is QUORUM_NOT_MET', oneValid.state === FEED.AGGREGATE_STATES.QUORUM_NOT_MET && oneValid.validPublishers === 1);

  const sameTwice = await FEED.aggregateFeedState([await makeRecord(p1), await makeRecord(p1)], policy2, envFor());
  ok('one publisher spamming records still counts once', sameTwice.validPublishers === 1 && sameTwice.state === FEED.AGGREGATE_STATES.QUORUM_NOT_MET);

  const twoValid = await FEED.aggregateFeedState([await makeRecord(p1), await makeRecord(p2)], policy2, envFor());
  ok('2 distinct pinned publishers make the feed LIVE',
    twoValid.state === FEED.AGGREGATE_STATES.LIVE && deepEqual(twoValid.liveFeedIds, ['thru-ops']));

  const kill = await FEED.aggregateFeedState(
    [await makeRecord(p1, { ops: { kill: ['balances'] } }), await makeRecord(p2, { ops: { kill: ['balances'] } })],
    policy2, envFor(),
  );
  ok('a quorum of kill votes covers the feature', deepEqual(kill.killFeatures, ['balances']));

  const killHalf = await FEED.aggregateFeedState(
    [await makeRecord(p1, { ops: { kill: ['balances'] } }), await makeRecord(p3, { ops: { kill: ['balances'] } })],
    policy2, { ...envFor(), pinnedPublishers: policy2.publishers },
  );
  ok('an unpinned co-signer cannot reach quorum', killHalf.killFeatures.length === 0 && killHalf.state === FEED.AGGREGATE_STATES.QUORUM_NOT_MET);
}

// ---------------------------------------------------------------------------
section('Registry narrowing: ENABLED rows only, flags and genesis dominate, narrow never widens');

const policy2 = { policyVersion: 1, publishers: [hex(p1.publicKey), hex(p2.publicKey)], quorum: 2, requireFeed: { balances: 'thru-ops' }, clockSkewMs: 300_000 };
const feedEvents = () => sentEvents.filter((e) => e?.event === 'feedChanged');

{
  REGISTRY._resetFeedBaselineForTests();
  REGISTRY._resetAlignmentBaselineForTests();
  ok('the shipped default is a no-op: balances stays enabled',
    REGISTRY.getFeature('balances')?.state === 'enabled');

  // Configured policy, no records: the required feed is not LIVE -> FEED_MISSING.
  await REGISTRY._setFeedStateForTests({ records: [], policy: policy2 });
  ok('enabled feature whose required feed is missing narrows to FEED_MISSING',
    REGISTRY.getFeature('balances')?.state === 'unsupported' && REGISTRY.getFeature('balances')?.reason === 'FEED_MISSING');
  ok('the same row is visible through capability derivation (single source of truth)',
    deepEqual(REGISTRY.deriveCapabilities('betanet').featureCapabilities.balances, { supported: false, reason: 'FEED_MISSING' }));

  // Two valid records make the feed LIVE: the narrowing lifts.
  const liveRecords = [await makeRecord(p1), await makeRecord(p2)];
  await REGISTRY._setFeedStateForTests({ records: liveRecords, policy: policy2 });
  ok('a LIVE required feed releases the narrowing (balances enabled again)',
    REGISTRY.getFeature('balances')?.state === 'enabled');

  // A quorum kill vote: KILL_SWITCH binds the feature, above its dossier state.
  const killRecords = [
    await makeRecord(p1, { ops: { kill: ['balances'] } }),
    await makeRecord(p2, { ops: { kill: ['balances'] } }),
  ];
  await REGISTRY._setFeedStateForTests({ records: killRecords, policy: policy2 });
  ok('a quorum kill vote narrows to KILL_SWITCH',
    REGISTRY.getFeature('balances')?.state === 'unsupported' && REGISTRY.getFeature('balances')?.reason === 'KILL_SWITCH');

  // Ladder position, proven via the shared resolver: flags dominate kill; kill would dominate
  // the dossier but enabled rows are all it can touch.
  ok('flags dominate the kill switch (FLAG_OFF first rung)',
    resolveGate({ gate: 'DEFI_MARKET', feature: 'balances', env: 'result', label: 'balances probe' })?.reason === 'FLAG_OFF');
  const savedFlags = { ...FLAGS };
  FLAGS.DEFI = true;
  FLAGS.DEFI_MARKET = true;
  const gated = resolveGate({ gate: 'DEFI_MARKET', feature: 'balances', env: 'result', label: 'balances probe' });
  Object.assign(FLAGS, savedFlags);
  FLAGS.DEFI = savedFlags.DEFI;
  FLAGS.DEFI_MARKET = savedFlags.DEFI_MARKET;
  ok('with the flag on, the gate resolves KILL_SWITCH above the dossier',
    gated?.reason === 'KILL_SWITCH', JSON.stringify(gated));

  ok('a kill vote never changes an unsupported dossier row (narrow, never widen)',
    REGISTRY.getFeature('swap')?.reason === 'PROGRAM_NOT_VERIFIED'
      && REGISTRY.getFeature('discovery')?.reason === 'NO_INDEXER');

  // Genesis dominates kill: records signed for the old chain die with the binding.
  REGISTRY._setFingerprintForTests('betanet|STALE-FINGERPRINT-FIXTURE');
  await REGISTRY.refreshFeedVerdicts();
  ok('genesis drift dominates the kill switch (NETWORK_RESET first)',
    REGISTRY.getFeature('balances')?.state === 'unsupported' && REGISTRY.getFeature('balances')?.reason === 'NETWORK_RESET');
  ok('the aggregate drops the old-chain records honestly',
    REGISTRY.getFeedState().state === FEED.AGGREGATE_STATES.QUORUM_NOT_MET
      && REGISTRY.getFeedState().verdicts.every((v) => v.state === FEED.VERIFY_STATES.GENESIS_MISMATCH));

  REGISTRY._setFingerprintForTests(null);
  await REGISTRY.refreshFeedVerdicts();
  ok('realignment restores the verified aggregate (kill back in force)',
    REGISTRY.getFeature('balances')?.reason === 'KILL_SWITCH');

  // feedChanged: exactly once per REAL transition; boot baseline silent.
  REGISTRY._resetFeedBaselineForTests();
  const baseline = feedEvents().length; // events emitted by the flow above; assertions are deltas
  await REGISTRY._setFeedStateForTests({ records: [], policy: policy2 });
  await REGISTRY._setFeedStateForTests({ records: [], policy: policy2 });
  ok('boot re-baseline and repeat refreshes of an unchanged state emit nothing',
    feedEvents().length === baseline, JSON.stringify(feedEvents().slice(baseline)));

  await REGISTRY._setFeedStateForTests({ records: liveRecords, policy: policy2 });
  const afterLive = feedEvents();
  ok('NO_FEEDS -> LIVE emits feedChanged exactly once',
    afterLive.length === baseline + 1 && afterLive[baseline].data?.state === 'LIVE'
      && deepEqual(afterLive[baseline].data?.liveFeedIds, ['thru-ops']), JSON.stringify(afterLive.slice(baseline)));

  await REGISTRY._setFeedStateForTests({ records: killRecords, policy: policy2 });
  ok('activation of a kill vote emits once with the killed feature',
    feedEvents().length === baseline + 2 && deepEqual(feedEvents()[baseline + 1].data?.killFeatures, ['balances']));

  await REGISTRY._setFeedStateForTests({ records: killRecords, policy: policy2 });
  ok('re-presenting the same records emits nothing', feedEvents().length === baseline + 2);

  await REGISTRY._setFeedStateForTests(null);
  ok('clearing the feed state emits once, back to INERT',
    feedEvents().length === baseline + 3 && feedEvents()[baseline + 2].data?.state === 'INERT');
  ok('cleared state restores the dossier view (balances enabled)',
    REGISTRY.getFeature('balances')?.state === 'enabled');
}

REGISTRY._resetFeedBaselineForTests();

// ---------------------------------------------------------------------------
section('Read path does zero storage writes (stateless by design)');

ok('no chrome.storage writes happened across every feed read above', storageWrites === 0, `writes: ${storageWrites}`);

console.log(`\n${failures === 0 ? 'All' : ''} DeFi feed checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(`\n${failures} feed check(s) failed.`);
  process.exit(1);
}
console.log('Signed feed records verify domain-separated, pin-gated, quorum-aggregated; narrowing');
console.log('fires on enabled rows only, flags and genesis dominate, and feedChanged fires once per transition.');
