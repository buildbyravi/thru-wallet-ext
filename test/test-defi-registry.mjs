// DeFi registry gate (G1-A): proves the registry service owns records + derivation, with the
// B3 stateless genesis binding doing exactly what it claims.
//
//   1. registry == G0 evidence seeds (content pin; the M0 suite already pins the snapshot file)
//   2. behavior-preserving refactor: program.*/feed.* dispatch still matches M0 fixtures
//   3. genesis misalignment: seed fingerprint stale -> everything derived flips to NETWORK_RESET,
//      flags still dominate, capabilitiesChanged fires exactly once per transition
//   4. read path does zero storage writes (stateless-by-design)
//
// Run: node test/test-defi-registry.mjs

import { readFileSync } from 'node:fs';

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

const REGISTRY = await import('../src/background/services/registry-service.js');
const SNAPSHOT = await import('../src/background/services/defi/capability-snapshot.js');
const { handleApiRequest } = await import('../src/background/api-router.js');
const { FLAGS } = await import('../src/shared/flags.js');
const { M0_CURRENT, M0_FLAG_ON, VALID_PARAMS } = await import('./fixtures/defi/fixtures.mjs');

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

function resolvePath(obj, path) {
  const parts = [];
  const re = /([^.[\]]+)|\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(path)) !== null) parts.push(m[1] ?? m[2]);
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return cur;
    cur = cur[part];
  }
  return cur;
}

function spotMatches(spotExpect, data) {
  return Object.entries(spotExpect).every(([path, expected]) => deepEqual(resolvePath(data, path), expected));
}

async function withFlags(map, fn) {
  const before = { ...FLAGS };
  Object.assign(FLAGS, map);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(FLAGS)) FLAGS[key] = before[key];
  }
}

// ---------------------------------------------------------------------------
section('Registry mirrors the G0 evidence seeds');

{
  const record = REGISTRY.getRegistry('betanet');
  const seed = JSON.parse(readFileSync('scripts/defi-evidence/betanet.registry-seed.json', 'utf8'));
  ok('registry exists for betanet and binds to the seed fingerprint',
    record && record.networkId === 'betanet'
      && record.registryVersion === seed.registryVersion
      && record.seedFingerprint === SNAPSHOT.SEED_FINGERPRINT
      && record.genesisAligned === true
      && record.currentFingerprint === SNAPSHOT.SEED_FINGERPRINT,
    JSON.stringify({ aligned: record?.genesisAligned, current: record?.currentFingerprint }));

  const programProblems = seed.programs.flatMap((p) => {
    const live = record.programs.find((r) => r.role === p.role);
    return live && live.address === p.address && live.trust === p.trust
      ? [] : [`${p.role}: mismatch`];
  });
  // 2026-10-08: the seed's program map was completed from the package's own pin — the FULL
  // 0.4.1 bootstrap declaration set (18 system roles; see DECISIONS_G0) plus the registry-only
  // null-address 'curve' row = 19 records. The pinned role set below is the canonical pin a
  // review must re-confirm on any future edit, and the loop above still requires byte-identical
  // address/trust per record vs the seed file.
  const EXPECTED_PROGRAM_ROLES = ['token', 'amm', 'curve', 'multicall', 'oracle',
    'abi_manager', 'block_producer', 'clob', 'compression', 'consensus_validator', 'eoa',
    'faucet', 'name_service', 'nft', 'noop', 'passkey_manager', 'thru_registrar', 'uploader', 'wthru'];
  ok('all seed program records present with identical address/trust (full 0.4.1 bootstrap set + curve)',
    programProblems.length === 0
      && record.programs.length === 19
      && JSON.stringify(record.programs.map((r) => r.role)) === JSON.stringify(seed.programs.map((p) => p.role))
      && EXPECTED_PROGRAM_ROLES.every((role) => record.programs.some((r) => r.role === role)),
    `${seed.programs.length} seed records; problems: ${programProblems.join(', ')}`);

  ok('features are the post-binding view of all 13 seed rows',
    record.features.length === 13
      && record.features.find((f) => f.key === 'swap')?.reason === 'PROGRAM_NOT_VERIFIED'
      && record.features.find((f) => f.key === 'balances')?.state === 'enabled');

  ok('feed registry is the honest empty list', Array.isArray(record.feeds) && record.feeds.length === 0);
  ok('unknown network has no registry binding', REGISTRY.getRegistry('somewhere-else') === null);
}

section('Seed fingerprint is pinned to the live derivation (B3 anchor)');

// This is the check that fails LOUDLY the day a managed genesis swap lands in networks.js:
// the seed stays pinned until fresh evidence re-seeds it, and every capability reports
// NETWORK_RESET in the meantime instead of silently trusting a new chain.
ok('runtime fingerprint equals the seed fingerprint',
  REGISTRY.currentChainFingerprint('betanet') === SNAPSHOT.SEED_FINGERPRINT,
  REGISTRY.currentChainFingerprint('betanet'));

// ---------------------------------------------------------------------------
section('Registry-backed dispatch matches the M0 fixtures (behavior-preserving refactor)');

{
  const caps = await handleApiRequest({ method: 'program.capabilities', params: {} });
  ok('program.capabilities still matches its M0 spot fixture',
    caps.ok === true && spotMatches(M0_CURRENT['program.capabilities'].expect, caps.data),
    JSON.stringify(caps).slice(0, 300));
  ok('capabilities payload carries the genesis binding block',
    caps.data.genesis?.aligned === true
      && caps.data.genesis?.seedFingerprint === SNAPSHOT.SEED_FINGERPRINT
      && typeof caps.data.genesis?.currentFingerprint === 'string');

  const list = await handleApiRequest({ method: 'program.list', params: {} });
  ok('program.list still matches its M0 spot fixture',
    list.ok === true && spotMatches(M0_CURRENT['program.list'].expect, list.data));

  const feeds = await handleApiRequest({ method: 'feed.status', params: {} });
  ok('feed.status still matches its M0 exact fixture',
    deepEqual(feeds, M0_CURRENT['feed.status'].expect), JSON.stringify(feeds));

  const lookup = await handleApiRequest({ method: 'feed.lookup', params: VALID_PARAMS['feed.lookup'] });
  ok('feed.lookup still matches its M0 exact fixture',
    deepEqual(lookup, M0_CURRENT['feed.lookup'].expect));

  const custom = await handleApiRequest({ method: 'program.capabilities', params: { networkId: 'unknown-net' } });
  ok('unknown network still answers CUSTOM_NETWORK', deepEqual(custom, { ok: true, data: { supported: false, reason: 'CUSTOM_NETWORK' } }));
}

// ---------------------------------------------------------------------------
section('Genesis misalignment flips everything derived to NETWORK_RESET (B3)');

{
  REGISTRY._resetAlignmentBaselineForTests();
  // Baseline: first derive under alignment sets the baseline without emitting.
  REGISTRY.deriveCapabilities('betanet');
  const baselineEvents = sentEvents.length;

  REGISTRY._setFingerprintForTests('betanet|STALE-FINGERPRINT-FIXTURE');

  ok('alignment reports false under a stale fingerprint', REGISTRY.isGenesisAligned('betanet') === false);
  ok('dossier rows downgrade to NETWORK_RESET',
    REGISTRY.getFeature('swap')?.reason === 'NETWORK_RESET'
      && REGISTRY.getFeature('launchMint')?.reason === 'NETWORK_RESET');
  ok('wallet-core enabled rows downgrade too (fail closed, never trust a new chain silently)',
    REGISTRY.getFeature('balances')?.reason === 'NETWORK_RESET'
      && REGISTRY.getFeature('balances')?.state === 'unsupported');

  const caps = REGISTRY.deriveCapabilities('betanet');
  ok('featureCapabilities flip to NETWORK_RESET wholesale',
    Object.values(caps.featureCapabilities).every((v) => v && v.supported === false && v.reason === 'NETWORK_RESET'));
  ok('flags still dominate method derivation (flag-off methods keep FLAG_OFF)',
    deepEqual(caps.methodCapabilities['dex.quote'], { supported: false, reason: 'FLAG_OFF' }));
  ok('always-on discovery reads stay true under misalignment',
    caps.methodCapabilities['program.list'] === true && caps.methodCapabilities['feed.status'] === true);
  ok('the genesis block exposes the drift',
    caps.genesis.aligned === false && caps.genesis.currentFingerprint === 'betanet|STALE-FINGERPRINT-FIXTURE'
      && caps.genesis.seedFingerprint === SNAPSHOT.SEED_FINGERPRINT);

  const transitionEvents = sentEvents.slice(baselineEvents).filter((e) => e?.event === 'capabilitiesChanged');
  ok('capabilitiesChanged fired exactly once on the reset transition',
    transitionEvents.length === 1
      && transitionEvents[0].data?.genesisAligned === false
      && transitionEvents[0].data?.reason === 'NETWORK_RESET',
    JSON.stringify(sentEvents.slice(baselineEvents)));

  REGISTRY.deriveCapabilities('betanet');
  REGISTRY.deriveCapabilities('betanet');
  ok('no duplicate event while the state is unchanged',
    sentEvents.filter((e) => e?.event === 'capabilitiesChanged').length === 1);

  // End-to-end through the router: flag on, dossier rung now says NETWORK_RESET.
  const candles = await withFlags({ DEFI: true, DEFI_MARKET: true },
    () => handleApiRequest({ method: 'market.candles', params: VALID_PARAMS['market.candles'] }));
  ok('market.candles with flag on answers NETWORK_RESET (not the stale dossier reason)',
    deepEqual(candles, { ok: true, data: { supported: false, reason: 'NETWORK_RESET' } }), JSON.stringify(candles));

  const risk = await withFlags({ DEFI: true, DEFI_RISK: true },
    () => handleApiRequest({ method: 'risk.assetAssess', params: VALID_PARAMS['risk.assetAssess'] }));
  ok('risk report derives from the post-binding view (usd reason is NETWORK_RESET now)',
    risk.ok === true && risk.data?.facts?.usd?.reason === 'NETWORK_RESET', JSON.stringify(risk).slice(0, 200));

  // Re-align: the seed chain is back; one emission announces recovery.
  REGISTRY._setFingerprintForTests(null);
  ok('alignment restored after clearing the override', REGISTRY.isGenesisAligned('betanet') === true);
  const beforeRecovery = sentEvents.filter((e) => e?.event === 'capabilitiesChanged').length;
  REGISTRY.deriveCapabilities('betanet');
  const recoveryEvents = sentEvents.filter((e) => e?.event === 'capabilitiesChanged');
  ok('capabilitiesChanged fires once on recovery with the aligned payload',
    recoveryEvents.length === beforeRecovery + 1
      && recoveryEvents[recoveryEvents.length - 1].data?.genesisAligned === true
      && recoveryEvents[recoveryEvents.length - 1].data?.reason === null,
    JSON.stringify(recoveryEvents));
  ok('dossier reasons return to the seed values',
    REGISTRY.getFeature('swap')?.reason === 'PROGRAM_NOT_VERIFIED'
      && REGISTRY.getFeature('balances')?.state === 'enabled');
}

// ---------------------------------------------------------------------------
section('Read path does zero storage writes (stateless by design)');

ok('no chrome.storage writes happened across every read above', storageWrites === 0, `writes: ${storageWrites}`);

console.log(`\n${failures === 0 ? 'All' : ''} DeFi registry checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(`\n${failures} registry check(s) failed.`);
  process.exit(1);
}
console.log('The registry owns records + derivation: seed-pinned, behavior-preserving, and the');
console.log('B3 genesis binding fails closed to NETWORK_RESET with a single capabilitiesChanged.');
