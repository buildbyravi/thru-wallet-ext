// DeFi M0 contract gate (S13): proves the contract-first drop is exactly what it claims.
//
//   1. schema <-> manifest coherence (names, params, since fences, groups)
//   2. capability snapshot <-> G0 evidence seeds pin (no silent drift from evidence)
//   3. fixture <-> handler integrity via REAL router dispatch (current build)
//   4. dossier-run probes with flags flipped in-memory (the post-flag behavior is pinned too)
//   5. capability presets validate and everythingOff deep-equals the live dispatch
//   6. DeFi preferences: defaults, validators, security-field gating
//   7. transaction/sync-read registrations and intent lifecycle scripts
//
// Run: node test/test-defi-m0.mjs

import { readFileSync, readdirSync } from 'node:fs';

// Persistent in-memory chrome stub so the preferences service can be exercised for real.
const store = new Map();
globalThis.chrome = {
  runtime: { id: 'test', onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
  alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
  storage: {
    local: {
      get: async (key) => (key ? { [key]: store.get(key) } : Object.fromEntries(store)),
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
      remove: async (key) => { store.delete(key); },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
};

const { METHODS, CONTRACT_VERSION } = await import('../src/shared/contract/manifest.js');
const {
  DEFI_METHODS, DEFI_GROUPS, UNSUPPORTED_REASONS, isDefiMethod, getDefiSpec, validateDefiParams,
} = await import('../src/shared/contract/defi-schema.js');
const { handleApiRequest, isTransactionMethod, isSyncReadMethod } = await import('../src/background/api-router.js');
const FLAGS_MODULE = await import('../src/shared/flags.js');
const { FLAGS, isDefiFeatureEnabled } = FLAGS_MODULE;
const SNAPSHOT = await import('../src/background/services/defi/capability-snapshot.js');
const PREFS = await import('../src/background/services/preferences-service.js');
const FIXTURES = await import('./fixtures/defi/fixtures.mjs');
const PRESETS = await import('./fixtures/defi/capability-presets.mjs');
const SCRIPTS = await import('./fixtures/defi/intent-scripts.mjs');

const { M0_CURRENT, M0_FLAG_ON, VALID_PARAMS, SPECIMENS, ERROR_FIXTURE_NOTES } = FIXTURES;

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

/** Resolve dotted paths with bracket segments: 'programs[2].address', 'methodCapabilities[dex.quote]'. */
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

/** Assert a fixture envelope ({ kind:'exact'| 'spot' }) against a real response. */
function fixtureMatches(fixture, response) {
  if (fixture.kind === 'exact') return deepEqual(fixture.expect, response);
  if (fixture.kind === 'spot') {
    for (const [path, expected] of Object.entries(fixture.expect)) {
      if (!deepEqual(resolvePath(response.data ?? response, path), expected)) return false;
    }
    return true;
  }
  return false;
}

const DeFiNames = Object.keys(DEFI_METHODS);

// ---------------------------------------------------------------------------
section('Schema <-> manifest coherence');

ok('the schema declares exactly 43 DeFi methods', DeFiNames.length === 43, `got ${DeFiNames.length}`);

{
  const groups = { R: 0, L: 0, P: 0, X: 0 };
  for (const spec of Object.values(DEFI_METHODS)) groups[spec.group] += 1;
  ok('group split is 21 READ / 8 LOCAL / 13 PREPARE / 1 EXECUTE',
    groups.R === 21 && groups.L === 8 && groups.P === 13 && groups.X === 1,
    JSON.stringify(groups));
}

{
  const problems = [];
  for (const [name, spec] of Object.entries(DEFI_METHODS)) {
    const entry = METHODS[name];
    if (!entry) { problems.push(`${name}: missing from manifest`); continue; }
    const schemaParams = Object.keys(spec.params).sort().join(',');
    const manifestParams = [...entry.params].sort().join(',');
    if (schemaParams !== manifestParams) problems.push(`${name}: params schema(${schemaParams}) != manifest(${manifestParams})`);
    const expectedSince = (spec.group === 'R' || spec.group === 'L') ? 17 : 18;
    if (entry.since !== expectedSince) problems.push(`${name}: since ${entry.since}, expected ${expectedSince} for group ${spec.group}`);
    if (!Object.values(DEFI_GROUPS).includes(spec.group)) problems.push(`${name}: unknown group`);
    if (spec.gate !== 'always' && !(spec.gate in FLAGS)) problems.push(`${name}: unknown gate flag '${spec.gate}'`);
    if (spec.feature !== null && !SNAPSHOT.getFeature(spec.feature)) problems.push(`${name}: unknown feature '${spec.feature}'`);
    if (!['result', 'error'].includes(spec.env)) problems.push(`${name}: unknown env '${spec.env}'`);
  }
  ok('every schema entry matches the manifest (name, params, since fence, gate, feature)',
    problems.length === 0, problems.join('\n         '));
}

{
  const manifestDefi = Object.keys(METHODS).filter((m) => /^program\.|^feed\.|^market\.|^risk\.|^dex\.|^launchpad\.|^intent\.|^desktop\./.test(m));
  const missing = manifestDefi.filter((m) => !isDefiMethod(m));
  ok('every manifest method in a DeFi namespace has a schema entry (canonical casing)', missing.length === 0, missing.join(', '));
}

{
  const badReasons = SNAPSHOT.FEATURES.map((f) => f.reason).filter(Boolean)
    .filter((r) => !UNSUPPORTED_REASONS.includes(r));
  ok('every dossier reason in the snapshot is an S10 enum value', badReasons.length === 0, badReasons.join(', '));
}

// ---------------------------------------------------------------------------
section('Capability snapshot is pinned to the G0 evidence seeds');

{
  const matrix = JSON.parse(readFileSync('scripts/defi-evidence/betanet.capability-matrix.json', 'utf8'));
  const seed = JSON.parse(readFileSync('scripts/defi-evidence/betanet.registry-seed.json', 'utf8'));

  ok('meta versions match the seeds',
    SNAPSHOT.SNAPSHOT_META.matrixVersion === matrix.matrixVersion
      && SNAPSHOT.SNAPSHOT_META.registryVersion === seed.registryVersion
      && SNAPSHOT.SNAPSHOT_META.networkId === seed.networkId,
    JSON.stringify(SNAPSHOT.SNAPSHOT_META));

  const featureProblems = [];
  for (const row of matrix.features) {
    const live = SNAPSHOT.getFeature(row.key);
    if (!live) featureProblems.push(`${row.key}: missing from runtime snapshot`);
    else if (live.state !== row.state || live.reason !== row.reason) {
      featureProblems.push(`${row.key}: seed(${row.state}/${row.reason}) != runtime(${live.state}/${live.reason})`);
    }
  }
  ok('all 13 seed feature rows exist in the runtime snapshot with identical state/reason',
    featureProblems.length === 0 && SNAPSHOT.FEATURES.length === matrix.features.length,
    featureProblems.join('\n         '));

  const limitProblems = Object.entries(SNAPSHOT.LIMITS)
    .filter(([k, v]) => !deepEqual(matrix.limits[k], v))
    .map(([k, v]) => `${k}: seed ${JSON.stringify(matrix.limits[k])} != runtime ${JSON.stringify(v)}`);
  ok('runtime limits equal the seed limits', limitProblems.length === 0, limitProblems.join('\n         '));

  const programProblems = [];
  for (const record of seed.programs) {
    const live = SNAPSHOT.PROGRAMS.find((p) => p.role === record.role);
    for (const key of ['address', 'trust', 'verification', 'changeStatus', 'managementState', 'updatedAt']) {
      if (!live || !deepEqual(live[key], record[key])) {
        programProblems.push(`${record.role}.${key}: seed ${JSON.stringify(record[key])} != runtime ${JSON.stringify(live?.[key])}`);
      }
    }
  }
  ok('all 5 seed program records exist in the runtime snapshot with identical fields',
    programProblems.length === 0 && SNAPSHOT.PROGRAMS.length === seed.programs.length,
    programProblems.join('\n         '));
}

// ---------------------------------------------------------------------------
section('Fixture <-> handler integrity (current build, real dispatch)');
// The wallet is locked in this environment: auth-none methods reach their handler; everything
// unlocked/signing must refuse with WALLET_LOCKED before touching any DeFi code.

for (const name of DeFiNames) {
  const spec = DEFI_METHODS[name];
  const auth = METHODS[name].auth;
  const response = await handleApiRequest({ method: name, params: { ...(VALID_PARAMS[name] ?? {}) } });

  if (auth !== 'none') {
    ok(`${name} refuses WALLET_LOCKED while locked`, response.ok === false && response.error?.code === 'WALLET_LOCKED',
      JSON.stringify(response));
    continue;
  }
  const fixture = M0_CURRENT[name];
  if (!fixture) {
    ok(`${name} has a current-build fixture`, false, 'add it to M0_CURRENT');
    continue;
  }
  ok(`${name} dispatch matches its current-build fixture (${fixture.kind})`, fixtureMatches(fixture, response),
    JSON.stringify(response));
}

ok('every gated read stays a sync read (no activity stamp)', (() => {
  const expected = ['program.capabilities', 'program.list', 'feed.status', 'feed.lookup',
    'market.assetGet', 'market.assetSearch', 'market.snapshot', 'market.candles', 'market.trades',
    'market.holders', 'risk.assetAssess', 'launchpad.list', 'launchpad.get', 'launchpad.templates',
    'launchpad.listMine', 'dex.listPools', 'dex.getPool', 'dex.positions', 'intent.list', 'intent.get'];
  return expected.every(isSyncReadMethod);
})());
ok('prepare/execute methods are never sync reads',
  ['dex.quote', 'dex.quoteLiquidity', 'intent.prepareSend', 'intent.submit', 'desktop.open'].every((m) => !isSyncReadMethod(m)));
ok('intent.submit is the only DeFi signing-guard transaction',
  isTransactionMethod('intent.submit') && !isTransactionMethod('dex.quote') && !isTransactionMethod('dex.prepareSwap'));

// ---------------------------------------------------------------------------
section('Dossier-rung probes (flags flipped in-memory, evidence still missing)');

async function withFlags(map, fn) {
  const before = { ...FLAGS };
  Object.assign(FLAGS, map);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(FLAGS)) FLAGS[key] = before[key];
  }
}

// env:'result' methods switch to their dossier reason once their flag is on.
const DOSSIER_RESULT_PROBES = [
  ['dex.listPools', 'DEFI_READ'],
  ['dex.getPool', 'DEFI_READ'],
  ['dex.quote', 'DEFI_DEX'],
  ['dex.quoteLiquidity', 'DEFI_DEX'],
  ['market.assetGet', 'DEFI_MARKET'],
  ['market.snapshot', 'DEFI_MARKET'],
  ['market.candles', 'DEFI_MARKET'],
  ['market.trades', 'DEFI_MARKET'],
  ['market.holders', 'DEFI_MARKET'],
  ['market.assetSearch', 'DEFI_MARKET'],
  ['launchpad.list', 'DEFI_READ'],
  ['launchpad.get', 'DEFI_READ'],
  ['launchpad.templates', 'DEFI_READ'],
];
for (const [name, flag] of DOSSIER_RESULT_PROBES) {
  const response = await withFlags({ DEFI: true, [flag]: true },
    () => handleApiRequest({ method: name, params: { ...(VALID_PARAMS[name] ?? {}) } }));
  const fixture = M0_FLAG_ON[name];
  ok(`${name} with ${flag} on answers its dossier fixture`, fixture && fixtureMatches(fixture, response),
    JSON.stringify(response));
}

{
  // The two REAL flag-on behaviors at M0.
  const risk = await withFlags({ DEFI: true, DEFI_RISK: true },
    () => handleApiRequest({ method: 'risk.assetAssess', params: { assetId: 'native' } }));
  ok('risk.assetAssess with DEFI_RISK on derives the pinned RiskReport',
    fixtureMatches(M0_FLAG_ON['risk.assetAssess'], risk), JSON.stringify(risk));

  const draft = await withFlags({ DEFI: true, DEFI_READ: true },
    () => handleApiRequest({ method: 'launchpad.validateDraft', params: { networkId: 'betanet', draft: VALID_PARAMS['launchpad.validateDraft'].draft } }));
  ok('launchpad.validateDraft with DEFI_READ on returns the pinned DraftValidation',
    fixtureMatches(M0_FLAG_ON['launchpad.validateDraft'], draft), JSON.stringify(draft));

  // After every probe the flags are back to all-off.
  ok('flag state fully restored after probes',
    Object.entries(FLAGS).every(([k, v]) => (k === 'DEBUG_ROUTING' ? true : v === false)),
    JSON.stringify(FLAGS));
}

{
  // Validate INVALID_INPUT before auth: bad input fails as INVALID_INPUT even from a locked wallet.
  const bad = await handleApiRequest({
    method: 'intent.prepareSend',
    params: { address: 'taA', toAddress: 'taB', amountUnits: '1.5', clientRequestId: 'crq_x' },
  });
  ok('router rejects a float amount with INVALID_INPUT before auth/gating', bad.ok === false && bad.error?.code === 'INVALID_INPUT',
    JSON.stringify(bad));
}

// ---------------------------------------------------------------------------
section('Capability presets');

{
  const live = await handleApiRequest({ method: 'program.capabilities', params: {} });
  const everythingOff = PRESETS.getPreset('everythingOff');
  ok('everythingOff preset deep-equals the live capabilities dispatch',
    live.ok === true && deepEqual(live.data, everythingOff.capabilities),
    'live dispatch and preset diverged — update the preset builder and the handler together');
  ok('everythingOff is the only non-simulated preset',
    PRESETS.CAPABILITY_PRESETS.filter((p) => !p.simulated).length === 1
      && everythingOff.simulated === false);

  const capsSpec = DEFI_METHODS['program.capabilities'];
  for (const preset of PRESETS.CAPABILITY_PRESETS) {
    const caps = preset.capabilities;
    const hasKeys = capsSpec.resultKeys.every((k) => k in caps);
    const reasonOk = Object.values(caps.featureCapabilities).every((v) => v === true
      || (v && v.supported === false && UNSUPPORTED_REASONS.includes(v.reason)));
    const methodOk = Object.values(caps.methodCapabilities).every((v) => v === true
      || (v && v.supported === false && UNSUPPORTED_REASONS.includes(v.reason)));
    ok(`preset ${preset.name}: full Capabilities shape, enum-clean reasons`,
      hasKeys && reasonOk && methodOk && typeof preset.note === 'string' && preset.note.length > 20);
    // full preset invariants: no FLAG_OFF anywhere; validateDraft + risk work; dossier shows.
    if (preset.name === 'full') {
      ok('preset full: nothing is FLAG_OFF (flags are not evidence; dossier reasons remain)',
        Object.values(caps.methodCapabilities).every((v) => v === true || v.reason !== 'FLAG_OFF'));
      ok('preset full: risk.assetAssess and launchpad.validateDraft answer true',
        caps.methodCapabilities['risk.assetAssess'] === true
          && caps.methodCapabilities['launchpad.validateDraft'] === true);
    }
  }
}

// ---------------------------------------------------------------------------
section('Specimens validate against the schema');

{
  // Map shape specimens to the methods whose success payload they represent.
  const SPECIMEN_METHODS = {
    quote: 'dex.quote',
    poolQuote: 'dex.quoteLiquidity',
    review: 'intent.prepareSend',
    preparedIntent: 'dex.prepareSwap',
    intent: 'intent.get',
    submissionResult: 'intent.submit',
    launchDetail: 'launchpad.get',
    pageOfLaunchCards: 'launchpad.list',
    poolDetail: 'dex.getPool',
    candleSet: 'market.candles',
    tradesPage: 'market.trades',
    holdersPage: 'market.holders',
    riskReport: 'risk.assetAssess',
    desktopPageEnabled: 'desktop.open',
    assetDetail: 'market.assetGet',
    searchHits: 'market.assetSearch',
    snapshots: 'market.snapshot',
    templates: 'launchpad.templates',
    positions: 'dex.positions',
    mineLaunches: 'launchpad.listMine',
    uploadResult: 'launchpad.uploadImage',
    draftList: 'launchpad.draftList',
    watchlist: 'market.watchlistGet',
    intentList: 'intent.list',
  };
  const problems = [];
  for (const [key, method] of Object.entries(SPECIMEN_METHODS)) {
    const specimen = SPECIMENS[key];
    if (!specimen || specimen.kind !== 'sample') { problems.push(`${key}: missing sample`); continue; }
    if (specimen.payload === null) continue; // pointer specimens (documented in note)
    for (const resultKey of DEFI_METHODS[method].resultKeys) {
      if (!(resultKey in specimen.payload)) problems.push(`${key} (${method}): missing resultKey '${resultKey}'`);
    }
    // No floats anywhere: every numeric leaf must be an integer or a base-unit string.
    const floats = [];
    JSON.stringify(specimen.payload, (path, value) => {
      if (typeof value === 'number' && !Number.isInteger(value)) floats.push(`${path}=${value}`);
      return value;
    });
    if (floats.length) problems.push(`${key}: float leaves ${floats.join(', ')}`);
    if (typeof specimen.note !== 'string' || specimen.note.length < 10) problems.push(`${key}: missing note`);
  }
  ok('every specimen carries its declared result keys, integer-or-string money, and a note',
    problems.length === 0, problems.join('\n         '));
}

section('Declared error codes are all covered by fixtures');

{
  const declared = new Set();
  for (const spec of Object.values(DEFI_METHODS)) for (const code of spec.errors) declared.add(code);
  const missing = [...declared].filter((code) => !ERROR_FIXTURE_NOTES[code]);
  const malformed = [...declared].filter((code) => ERROR_FIXTURE_NOTES[code]
    && (typeof ERROR_FIXTURE_NOTES[code].retryable !== 'boolean'
      || typeof ERROR_FIXTURE_NOTES[code].when !== 'string'
      || ERROR_FIXTURE_NOTES[code].when.length < 10));
  ok('every declared DeFi error code has a fixture note (retry class + when it happens)',
    missing.length === 0 && malformed.length === 0,
    `missing: ${missing.join(', ') || 'none'}; malformed: ${malformed.join(', ') || 'none'}`);
}

// ---------------------------------------------------------------------------
section('DeFi preferences');

{
  const prefs = await PREFS.getPreferences();
  ok('DeFi defaults ship in the preference record',
    prefs.defiSlippageBps === 50
      && prefs.defiLoadImages === false
      && prefs.defiShowUnverified === false
      && prefs.defiNotifications === true
      && prefs.defiTosAcceptedVersion === null
      && prefs.defiRiskAckVersion === null
      && prefs.defiAlwaysRequirePassword === false,
    JSON.stringify({
      defiSlippageBps: prefs.defiSlippageBps,
      defiLoadImages: prefs.defiLoadImages,
      defiShowUnverified: prefs.defiShowUnverified,
      defiNotifications: prefs.defiNotifications,
      defiTosAcceptedVersion: prefs.defiTosAcceptedVersion,
      defiRiskAckVersion: prefs.defiRiskAckVersion,
      defiAlwaysRequirePassword: prefs.defiAlwaysRequirePassword,
    }));

  const expectThrow = async (label, fn, part) => {
    try {
      await fn();
      ok(label, false, 'should have thrown');
    } catch (error) {
      ok(label, typeof error?.message === 'string' && error.message.includes(part), error?.message);
    }
  };

  const ok300 = await PREFS.setPreferences({ defiSlippageBps: 300 });
  ok('defiSlippageBps accepts 300 (unverified-asset tier)', ok300.defiSlippageBps === 300);
  await expectThrow("defiSlippageBps rejects 2001 (above cap)",
    () => PREFS.setPreferences({ defiSlippageBps: 2001 }), 'between 0 and 2000');
  await expectThrow('defiSlippageBps rejects a non-integer',
    () => PREFS.setPreferences({ defiSlippageBps: 50.5 }), 'between 0 and 2000');
  const okToS = await PREFS.setPreferences({ defiTosAcceptedVersion: '1.0.0', defiRiskAckVersion: '2026-10-05' });
  ok('ToS/risk version strings persist', okToS.defiTosAcceptedVersion === '1.0.0' && okToS.defiRiskAckVersion === '2026-10-05');
  await expectThrow('a 65-char ToS version is rejected',
    () => PREFS.setPreferences({ defiTosAcceptedVersion: 'x'.repeat(65) }), 'version string');

  await expectThrow('defiAlwaysRequirePassword cannot be set via settings.set (security field)',
    () => PREFS.setPreferences({ defiAlwaysRequirePassword: true }), 'Unknown preference key(s)');
  const secured = await PREFS.setSecurityPreferences({ defiAlwaysRequirePassword: true });
  ok('defiAlwaysRequirePassword sets through the password-gated security channel',
    secured.defiAlwaysRequirePassword === true);
  const prefsAgain = await PREFS.getPreferences();
  ok('the security change persisted', prefsAgain.defiAlwaysRequirePassword === true);
}

// ---------------------------------------------------------------------------
section('Intent lifecycle scripts');

{
  const scripts = SCRIPTS.INTENT_SCRIPTS;
  ok('exactly five lifecycle scripts ship', scripts.length === 5, `got ${scripts.length}`);
  const TERMINAL = new Set(['settled', 'failed', 'expired', 'rejected', 'cancelled']);
  const problems = [];
  for (const script of scripts) {
    if (!script.name || !script.kind || !script.note) problems.push(`${script.name ?? '?'}: needs name/kind/note`);
    const events = script.events;
    if (!Array.isArray(events) || events.length < 2) { problems.push(`${script.name}: needs at least two events`); continue; }
    events.forEach((event, i) => {
      if (!SCRIPTS.INTENT_STATES.includes(event.status)) problems.push(`${script.name}[${i}]: unknown status '${event.status}'`);
      if (!Number.isInteger(event.atMs) || event.atMs < 0) problems.push(`${script.name}[${i}]: bad atMs`);
      if (i > 0 && event.atMs <= events[i - 1].atMs) problems.push(`${script.name}[${i}]: non-monotonic time`);
      if (event.status === 'failed' && !SCRIPTS.INTENT_ERROR_CODES.includes(event.meta?.errorCode)) {
        problems.push(`${script.name}[${i}]: failed without a recognized errorCode`);
      }
    });
    if (events[0].status !== 'prepared') problems.push(`${script.name}: must start at prepared`);
    if (!TERMINAL.has(events[events.length - 1].status)) problems.push(`${script.name}: must end terminal`);
  }
  ok('scripts are monotonic, start at prepared, end terminal, and use declared states/codes',
    problems.length === 0, problems.join('\n         '));
  const names = scripts.map((s) => s.name).sort();
  ok('the five mandated scenarios are covered',
    deepEqual(names, ['dropped-resume', 'expired-discard', 'replaced-failed', 'settled-after-reprepare', 'settled-fresh'].sort()),
    names.join(', '));
}

// ---------------------------------------------------------------------------
section('Fixture corpus hygiene');

{
  const srcWalk = (dir) => {
    const out = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...srcWalk(full));
        else out.push(full);
      }
    } catch { /* missing dir */ }
    return out;
  };
  ok('no fixture file lives under src/ (fixtures can never ship)',
    srcWalk('src').every((f) => !/fixtures/.test(f)));
  ok('the corpus self-marks for the dist leak scan', typeof FIXTURES.__defiFixtureVersion === 'number');
  ok('VALID_PARAMS covers every DeFi method',
    DeFiNames.every((name) => VALID_PARAMS[name] && typeof VALID_PARAMS[name] === 'object'),
    DeFiNames.filter((n) => !VALID_PARAMS[n]).join(', '));

  // The validator under test: a syntactically valid param set yields zero issues for probes.
  const allValid = DeFiNames.every((name) => validateDefiParams(name, VALID_PARAMS[name]).length === 0);
  ok('every VALID_PARAMS entry passes its own schema validation', allValid,
    DeFiNames.filter((n) => validateDefiParams(n, VALID_PARAMS[n]).length > 0)
      .map((n) => `${n}: ${validateDefiParams(n, VALID_PARAMS[n]).join(' | ')}`).join('\n         '));
}

console.log(`\n${failures === 0 ? 'All' : ''} DeFi M0 checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(`\n${failures} DeFi M0 check(s) failed.`);
  process.exit(1);
}
console.log('The M0 contract drop is coherent: schema == manifest, snapshot == evidence seeds,');
console.log('fixtures == live dispatch (current and flag-on dossier rungs), presets validated,');
console.log('preferences gated, lifecycle scripts deterministic.');
