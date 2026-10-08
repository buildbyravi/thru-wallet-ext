// DeFi M0 contract fixtures — the machine-readable contract of record with defi-schema.js.
// See README.md in this directory for the rules. Three fixture kinds:
//   exact  — expect deep-equals the real router dispatch in this build (integrity-pinned)
//   spot   — named paths in the real response must equal these values (large derived payloads)
//   sample — a rendering specimen of the CURRENT wire shape for the frontend; not dispatched
// All reasons come from src/shared/contract/defi-schema.js UNSUPPORTED_REASONS.

export const __defiFixtureVersion = 1;

// A launch draft that passes every offline rule — used by validateDraft probes and specimens.
export const VALID_DRAFT = Object.freeze({
  name: 'Fixture Token',
  symbol: 'FIX',
  decimals: 6,
  supply: '1000000000',
  description: 'Fixture draft for the M0 contract surface.',
  launchModel: 'none',
  image: {
    url: 'thru-img://fixture/9f1c2e',
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
});

// Params that pass schema validation for every DeFi method — used by router probes in
// test/test-defi-m0.mjs so gating (not validation) is what is under test.
export const VALID_PARAMS = Object.freeze({
  'program.capabilities': {},
  'program.list': {},
  'feed.status': {},
  'feed.lookup': { ids: ['feed-alpha'] },
  'market.assetGet': { assetId: 'native' },
  'market.assetSearch': { query: 'thru' },
  'market.snapshot': { assetIds: ['native'] },
  'market.candles': { assetId: 'native', interval: '15m' },
  'market.trades': { assetId: 'native' },
  'market.holders': { assetId: 'native' },
  'risk.assetAssess': { assetId: 'native' },
  'launchpad.list': {},
  'launchpad.get': { launchId: 'lh_fixture1' },
  'launchpad.templates': {},
  'launchpad.listMine': { address: 'taUserFixture1' },
  'launchpad.validateDraft': { networkId: 'betanet', draft: VALID_DRAFT },
  'launchpad.draftList': {},
  'launchpad.draftGet': { draftId: 'dr_fixture1' },
  'launchpad.draftSave': { draft: VALID_DRAFT },
  'launchpad.draftDelete': { draftId: 'dr_fixture1' },
  'market.watchlistGet': {},
  'market.watchlistAdd': { assetId: 'native' },
  'market.watchlistRemove': { assetId: 'native' },
  'desktop.open': { page: 'markets' },
  'dex.listPools': {},
  'dex.getPool': { poolId: 'taPoolFixture1' },
  'dex.positions': { address: 'taUserFixture1' },
  'dex.quote': { poolId: 'taPoolFixture1', inputAssetId: 'native', outputAssetId: 'taAssetFixture1', inputAmountUnits: '1000000' },
  'dex.quoteLiquidity': { poolId: 'taPoolFixture1', mode: 'add', amounts: { native: '1000000', taAssetFixture1: '42000000' } },
  'dex.prepareSwap': { quoteId: 'q_fixture1', clientRequestId: 'crq_fixture1' },
  'dex.prepareLiquidity': { quoteId: 'q_fixture2', clientRequestId: 'crq_fixture2' },
  'intent.prepareSend': { address: 'taUserFixture1', toAddress: 'taUserFixture2', amountUnits: '1000', clientRequestId: 'crq_fixture3' },
  'intent.rePrepare': { intentId: 'in_fixture1' },
  'intent.resume': { intentId: 'in_fixture1' },
  'intent.discard': { intentId: 'in_fixture1' },
  'intent.stopWaiting': { intentId: 'in_fixture1' },
  'intent.submit': { intentId: 'in_fixture1', bindingHash: 'bh_fixture1' },
  'intent.list': {},
  'intent.get': { intentId: 'in_fixture1' },
  'launchpad.uploadImage': { address: 'taUserFixture1', networkId: 'betanet', payload: { bytesBase64: 'QUJD', mime: 'image/png' } },
  'launchpad.prepareCreate': { address: 'taUserFixture1', networkId: 'betanet', draft: VALID_DRAFT, clientRequestId: 'crq_fixture4' },
  'launchpad.prepareMigrate': { address: 'taUserFixture1', launchId: 'lh_fixture1', clientRequestId: 'crq_fixture5' },
  'launchpad.prepareClaim': { address: 'taUserFixture1', launchId: 'lh_fixture1', clientRequestId: 'crq_fixture6' },
});

// ---- Envelope builders -------------------------------------------------------

const ok = (data) => ({ ok: true, data });
const fail = (code, message, retryable = false) => ({ ok: false, error: { code, message, retryable } });
const exact = (payload) => ({ kind: 'exact', expect: payload });
const spot = (expect) => ({ kind: 'spot', expect });
const sample = (payload, note) => ({ kind: 'sample', payload, note });

const FLAG_OFF = () => exact(ok({ supported: false, reason: 'FLAG_OFF' }));
const FLAG_ON_DOSSIER = (reason) => exact(ok({ supported: false, reason }));
const DISABLED = (label) => exact(fail('FEATURE_DISABLED', `${label} is not part of this build.`));
const FLAG_ON_DOSSIER_ERROR = (label, reason) => exact(fail('UNSUPPORTED', `${label} is unavailable: ${reason}.`));

// ---- Current-build fixtures (integrity-pinned via real dispatch) --------------
// These MUST equal what the handler answers today, byte for byte.

export const M0_CURRENT = Object.freeze({
  'program.capabilities': spot({
    networkId: 'betanet',
    registryVersion: 0,
    matrixVersion: 0,
    'programFacts.curve': null,
    'programFacts.amm': 'taAMMx8gG44RcOyRqNYZ55pDaAJoGS0R8kPYxBN96sO8kD',
    'limits.slippageMaxBps': 2000,
    'limits.quoteTtlMs': 15000,
    'featureCapabilities.swap': { supported: false, reason: 'PROGRAM_NOT_VERIFIED' },
    'featureCapabilities.usd': { supported: false, reason: 'DEPENDENCY_UNVERIFIED' },
    'featureCapabilities.balances': true,
    'methodCapabilities[dex.quote]': { supported: false, reason: 'FLAG_OFF' },
    'methodCapabilities[intent.submit]': { supported: false, reason: 'FLAG_OFF' },
    'methodCapabilities[program.list]': true,
    'methodCapabilities[feed.status]': true,
    'methodCapabilities[tx.sendChecked]': true,
  }),
  'program.list': spot({
    networkId: 'betanet',
    // 19 = the 5 historical seed records + the 14 new records completing the package's 0.4.1
    // bootstrap declaration set (2026-10-08; token/amm/curve/multicall/oracle + 14 alphabetical).
    'programs.length': 19,
    'programs[0].role': 'token',
    'programs[2].role': 'curve',
    'programs[2].address': null,
    'programs[5].role': 'abi_manager',
    'programs[18].role': 'wthru',
  }),
  'feed.status': exact(ok({ feeds: [] })),
  'feed.lookup': exact(ok({ feeds: { 'feed-alpha': null } })),

  'market.assetGet': FLAG_OFF(),
  'market.assetSearch': FLAG_OFF(),
  'market.snapshot': FLAG_OFF(),
  'market.candles': FLAG_OFF(),
  'market.trades': FLAG_OFF(),
  'market.holders': FLAG_OFF(),
  'risk.assetAssess': DISABLED('Risk assessment'),

  'launchpad.list': FLAG_OFF(),
  'launchpad.get': FLAG_OFF(),
  'launchpad.templates': FLAG_OFF(),
  'launchpad.listMine': DISABLED('Own-launch reads'),
  'launchpad.validateDraft': DISABLED('Draft validation'),
  'launchpad.draftList': DISABLED('Launch drafts'),
  'launchpad.draftGet': DISABLED('Launch drafts'),
  'launchpad.draftSave': DISABLED('Launch drafts'),
  'launchpad.draftDelete': DISABLED('Launch drafts'),
  'launchpad.uploadImage': DISABLED('Launch image upload'),
  'launchpad.prepareCreate': DISABLED('Launch creation'),
  'launchpad.prepareMigrate': DISABLED('Launch migration'),
  'launchpad.prepareClaim': DISABLED('Creator-fee claim'),

  'dex.listPools': FLAG_OFF(),
  'dex.getPool': FLAG_OFF(),
  'dex.positions': DISABLED('Pool positions'),
  'dex.quote': FLAG_OFF(),
  'dex.quoteLiquidity': FLAG_OFF(),
  'dex.prepareSwap': DISABLED('Swap preparation'),
  'dex.prepareLiquidity': DISABLED('Liquidity preparation'),

  'market.watchlistGet': DISABLED('Market watchlist'),
  'market.watchlistAdd': DISABLED('Market watchlist'),
  'market.watchlistRemove': DISABLED('Market watchlist'),
  'desktop.open': exact(ok({ enabled: false, reason: 'FLAG_OFF' })),

  'intent.list': DISABLED('Intent pipeline'),
  'intent.get': DISABLED('Intent pipeline'),
  'intent.prepareSend': DISABLED('Intent pipeline'),
  'intent.rePrepare': DISABLED('Intent pipeline'),
  'intent.resume': DISABLED('Intent pipeline'),
  'intent.discard': DISABLED('Intent pipeline'),
  'intent.stopWaiting': DISABLED('Intent pipeline'),
  'intent.submit': DISABLED('Intent pipeline'),
});

// ---- Dossier fixtures: flag flipped on (in-memory), evidence still missing ----
// Deterministic for methods whose only proceed-path is offline derivation.

export const M0_FLAG_ON = Object.freeze({
  'dex.listPools': FLAG_ON_DOSSIER('PROGRAM_NOT_VERIFIED'),
  'dex.getPool': FLAG_ON_DOSSIER('PROGRAM_NOT_VERIFIED'),
  'dex.quote': FLAG_ON_DOSSIER('PROGRAM_NOT_VERIFIED'),
  'dex.quoteLiquidity': FLAG_ON_DOSSIER('PROGRAM_NOT_VERIFIED'),
  'market.assetGet': FLAG_ON_DOSSIER('NO_INDEXER'),
  'market.assetSearch': FLAG_ON_DOSSIER('NO_INDEXER'),
  'market.snapshot': FLAG_ON_DOSSIER('NO_INDEXER'),
  'market.candles': FLAG_ON_DOSSIER('NO_INDEXER'),
  'market.trades': FLAG_ON_DOSSIER('NO_INDEXER'),
  'market.holders': FLAG_ON_DOSSIER('NO_INDEXER'),
  'launchpad.list': FLAG_ON_DOSSIER('NO_INDEXER'),
  'launchpad.get': FLAG_ON_DOSSIER('NO_INDEXER'),
  'launchpad.templates': FLAG_ON_DOSSIER('TOKEN_PATH_UNVERIFIED'),
  'dex.positions': FLAG_ON_DOSSIER_ERROR('Pool positions', 'PROGRAM_NOT_VERIFIED'),
  'launchpad.listMine': FLAG_ON_DOSSIER_ERROR('Own-launch reads', 'TOKEN_PATH_UNVERIFIED'),
  'launchpad.uploadImage': FLAG_ON_DOSSIER_ERROR('Launch image upload', 'TOKEN_PATH_UNVERIFIED'),
  'launchpad.prepareCreate': FLAG_ON_DOSSIER_ERROR('Launch creation', 'TOKEN_PATH_UNVERIFIED'),
  'launchpad.prepareMigrate': FLAG_ON_DOSSIER_ERROR('Launch migration', 'LAUNCH_MODEL_UNAVAILABLE'),
  'launchpad.prepareClaim': FLAG_ON_DOSSIER_ERROR('Creator-fee claim', 'LAUNCH_MODEL_UNAVAILABLE'),

  // The two REAL flag-on behaviors at M0 (offline derivations), expected byte for byte.
  'risk.assetAssess': exact(ok({
    facts: {
      assetId: 'native',
      registry: {
        networkId: 'betanet',
        registryVersion: 0,
        programs: {
          token: 'taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE',
          amm: 'taAMMx8gG44RcOyRqNYZ55pDaAJoGS0R8kPYxBN96sO8kD',
          curve: null,
          multicall: 'taMULTIrOL8WpIFr16C1ECsO60qAsuwmwJephZHDOTvSeP',
          oracle: 'taORCLOkTSYq5enR2XOGoSDmzMc0P5NlqjP8nKpfd3vgps',
          abi_manager: 'taABII8WXcPaPIt47cXjOBbyoBUGBDXznAMHorVMeok3mw',
          block_producer: 'taBPUH9m3CXZcBQyCrTmclHtltipiPelIHzdAf8QdIDvnt',
          clob: 'taCLOBcFk1PT8JTHQM1LzsyK6HLv1YkSJKZ2ZyIxo8fiTe',
          compression: 'taRB54_92jNbBdcmt2jus88F-xrOSne1GR9mmyOh4RidAK',
          consensus_validator: 'taCONStGMCE1RJ9ttceyt0FZhYapGJ7zzBuCE5qqYdLhaF',
          eoa: 'taEOAD2uLK1SLzPgtabFLUAx22yDlBs9DE9nZFTOESIGRr',
          faucet: 'taFCTxR0y2eabGGaEdtTwC9pHz7ZY4CYD7FOiBFUJeAW16',
          name_service: 'taNAMEqRNEDeMWp0cDYmMVdZyTZiF5NyGDR9zTwH42rWQG',
          nft: 'taNFTjOaeDBSPHNf0LVRWAkF4raUFQgrz0EQIgJd60ENb5',
          noop: 'taNOOPV4A7S3WTsirr149To2GoGZ9q8zllQaBrbekHfkJT',
          passkey_manager: 'taPASSIvjIgz2kZ1CIIhvbT00XV9Ve5kZ2I9uDLanzIgbA',
          thru_registrar: 'taREGMtyyVIMr27zDpvN0aRiSS2aOVffM9cZCsc0Xomaxw',
          uploader: 'taUPLMH5QYOAT4ktwQeO7DXAEKtqBhYehalNGf5BJFQDYq',
          wthru: 'taWTHRUBelpONhTRjYc7n4OovodUsUtZKTIuREWAi9G9lm',
        },
      },
      feed: { hasVerifiedFeed: false, feedCount: 0 },
      usd: { sourceVerified: false, reason: 'DEPENDENCY_UNVERIFIED' },
      launch: { mintPathVerified: false, curveProgram: null },
    },
    warnings: [
      { code: 'ASSET_UNVERIFIED', severity: 'red', how: 'No verified feed, registry listing, or live verification exists for this asset id. Treat all displayed metadata as unverified user-supplied or attacker-controlled text.' },
      { code: 'USD_UNAVAILABLE', severity: 'grey', how: 'No verified USD source (oracle record unverified, probe pending). USD values must render as a dash, never as a derived guess.' },
      { code: 'LAUNCH_PATH_UNVERIFIED', severity: 'grey', how: 'Token launch path is not verified (TOKEN_PATH_UNVERIFIED); creation flows must stay gated off even if the UI is reachable.' },
      { code: 'MARKET_DATA_ABSENT', severity: 'grey', how: 'No indexer or market-data pipeline is verified; any price/volume/chart display for this asset would be fabricated here and is therefore absent.' },
    ],
    maxSeverity: 'red',
    listStatus: 'unverified',
    freshness: { asOf: '2026-10-05', maxAgeSec: null, stale: false },
  })),

  'launchpad.validateDraft': exact(ok({
    identity: { valid: true, issues: [] },
    curve: null,
    strands: [
      { capability: 'token.create+transfer', blocking: true, how: 'Mint and token-account path unverified (P3/Q13 prerequisite).', reason: 'TOKEN_PATH_UNVERIFIED' },
    ],
    errors: [],
    warnings: [
      'Offline validation only: no chain state, registry freshness, or fee estimate was consulted.',
      'Reviews will ship unsimulated (NO_SIMULATION): cost and effect displays stay declaration-level until simulation exists.',
    ],
  })),
});

// ---- Success specimens per S5 wire shape --------------------------------------
// Rendering samples for the frontend. `sample` fixtures are never dispatched; they exist so
// screens can be built and screenshot-tested against the exact contract payload.

export const SPECIMENS = Object.freeze({
  quote: sample({
    poolId: 'taPoolFixtureAmm1',
    input: { asset: 'native', amount: '1000000' },
    output: { asset: 'taAssetFixtureFoo', expectedOut: '42000000', minReceivedOut: '41790000' },
    rate: '42000000',
    priceImpactBps: 12,
    feeTotal: '5000',
    quoteId: 'q_fixture_quote1',
    expiresAt: '2026-10-05T00:00:15.000Z',
  }, 'Exact-in swap Quote; amounts are base-unit strings, rate is a cost-per-unit string.'),

  poolQuote: sample({
    poolId: 'taPoolFixtureAmm1',
    mode: 'add',
    sharesEst: '6500000',
    minShares: '6467500',
    details: { feeAssets: [{ asset: 'native', amount: '5000' }] },
    quoteId: 'q_fixture_liq1',
    expiresAt: '2026-10-05T00:00:15.000Z',
  }, 'Add-liquidity PoolQuote. feeAssets are ALWAYS explicit (never 0 silently).'),

  review: sample({
    reviewAscii: [
      'Intent    swap 1000000 native -> taAssetFixtureFoo',
      'Min out   41790000 (slippage 50 bps)',
      'Fees      5000 native (declared, capped 1200000 CU)',
      'Simulation unavailable (NO_SIMULATION) — review is declaration-level',
      'Hash      bh_fixture_review1',
    ].join('\n'),
    facts: { slippageBps: 50, simulation: 'unavailable' },
    model: { variant: 'swap.exact-in', sources: ['pool-events'] },
    policy: { requireSimulation: false, maxSlippageBps: 2000 },
    simulation: { available: false, reason: 'NO_SIMULATION' },
    assetChanges: [{ asset: 'native', deltaUnits: '-1005000', reason: 'input+fee' }, { asset: 'taAssetFixtureFoo', deltaUnits: '41790000', reason: 'min-received' }],
    feePlan: { txCount: 1, totalFeeUnits: '5000' },
    bindingHash: 'bh_fixture_review1',
    clientRequestId: 'crq_fixture_r1',
    acknowledgements: ['PRICE_IMPACT_UNDER_WARN', 'UNSAVED_TOKEN_ACCOUNT_MAY_APPEAR'],
  }, 'A Review is the only thing a user signs. prepare* returns this shape.'),

  preparedIntent: sample({
    intentId: 'in_fixture_p1',
    kind: 'swap',
    status: 'prepared',
    plan: { variant: 'swap.exact-in', steps: ['swap.exact-in'], atomic: true, atomicityOpen: false },
    fee: { declaredTotalUnits: '5000', txCount: 1 },
    preparedAt: '2026-10-05T00:00:00.000Z',
    expiresAt: '2026-10-05T00:02:00.000Z',
    unsignedTxs: [{ txId: 'txu_fixture1', role: 'swap', nonce: '41', chainId: 'betanet' }],
    context: { networkId: 'betanet', genesisId: 'gen_fixture1', accountId: 'taUserFixture1' },
  }, 'Prepared Intent (S5): identity-pinned context, unsigned txs, ttl.'),

  intent: sample({
    intentId: 'in_fixture_i1',
    kind: 'swap',
    status: 'settled',
    plan: { variant: 'swap.exact-in', steps: ['swap.exact-in'], atomic: true, atomicityOpen: false },
    fee: { declaredTotalUnits: '5000', txCount: 1 },
    preparedAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:09.000Z',
    expiresAt: '2026-10-05T00:02:00.000Z',
    unsignedTxs: [],
    context: { networkId: 'betanet', genesisId: 'gen_fixture1', accountId: 'taUserFixture1' },
  }, 'Settled Intent; the timeline UI renders status + updatedAt transitions.'),

  submissionResult: sample({
    submitId: 'sub_fixture1',
    state: 'waitingChain',
    waitingReason: 'confirming',
    signature: null,
  }, 'intent.submit returns immediately; state evolves via intentChanged events.'),

  launchDetail: sample({
    header: { launchId: 'lh_fixture1', name: 'Fixture Token', symbol: 'FIX', image: null },
    assets: ['taAssetFixtureFoo'],
    curve: null,
    pool: null,
    trades: { supported: false, reason: 'NO_INDEXER' },
    distribution: { supported: false, reason: 'NO_INDEXER' },
    links: [],
    yourActions: { create: false, migrate: false, claim: false },
    feedState: { state: 'missing', stale: false },
  }, 'Mint-only LaunchDetail (launchModel none): curve/poll sections are null, and every '
    + 'unsupported section carries its reason.'),

  pageOfLaunchCards: sample({
    items: [{ launchId: 'lh_fixture1', name: 'Fixture Token', symbol: 'FIX', progress: null }],
    nextCursor: null,
    updatedAt: null,
    source: 'fixture',
  }, 'UpdatedAt/source stay honest even in specimens (null where unknown).'),

  poolDetail: sample({
    header: { poolId: 'taPoolFixtureAmm1' },
    assets: ['native', 'taAssetFixtureFoo'],
    reserves: { a: '250000000', b: '10500000000' },
    fee: { bps: 30, recipient: null },
    volume: null,
    apxe: null,
    positions: [],
    charts: { supported: false, reason: 'NO_INDEXER' },
    risk: { severity: 'yellow', summary: 'Pool program unverified' },
    oracle: { present: false },
    feedState: { state: 'missing', stale: false },
  }, 'Sections that cannot be fetched are null/unsupported, never invented.'),

  candleSet: sample({
    interval: '15m',
    range: { from: '2026-10-04T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z', count: 2 },
    candles: [
      { ts: '2026-10-04T23:30:00.000Z', open: '40100000', high: '41200000', low: '39800000', close: '40900000', volume: '1256000', source: 'pool-events', fresh: true },
      { ts: '2026-10-04T23:45:00.000Z', open: '40900000', high: '41000000', low: '40500000', close: '42000000', volume: '930000', source: 'pool-events', fresh: true },
    ],
  }, 'Pool-event derived candles stay labelled pool-events — never presented as exchange data.'),

  tradesPage: sample({
    trades: [{ ts: '2026-10-04T23:59:00.000Z', side: 'buy', amountIn: '1000000', amountOut: '42000000', price: '42000000', txSig: 'sig_fixture1' }],
    nextCursor: null,
  }, 'TradeEvent page.'),

  holdersPage: sample({
    rows: [{ address: 'taUserFixture9', amountUnits: '100000000', pctBps: 1000 }],
    nextCursor: null,
  }, 'HolderRow page; pctBps is basis points, never a float.'),

  riskReport: sample({
    facts: { assetId: 'native' },
    warnings: [{ code: 'ASSET_UNVERIFIED', severity: 'red', how: 'Fixture warning text.' }],
    maxSeverity: 'red',
    listStatus: 'unverified',
    freshness: { asOf: '2026-10-05', maxAgeSec: null, stale: false },
  }, 'Shape specimen; the integrity-pinned, byte-exact fixture lives in M0_FLAG_ON.'),

  draftValidation: sample(
    // exact copy of the real flag-on output (M0_FLAG_ON['launchpad.validateDraft'])
    null,
    'See M0_FLAG_ON[launchpad.validateDraft] — that fixture IS the byte-exact specimen.',
  ),

  watchlist: sample({ items: ['native', 'taAssetFixtureFoo'] }, 'Watchlist payload; watchlistAdd/remove return the updated list.'),
  draftList: sample({ drafts: [{ draftId: 'dr_fixture1', name: 'Fixture Token', launchModel: 'none', updatedAt: '2026-10-05T00:00:00.000Z' }] }, 'Drafts, network-scoped local storage.'),
  uploadResult: sample({ status: 'ok', url: 'thru-img://fixture/9f1c2e', sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, 'Only a returned, content-pinned image is valid for a draft.'),
  desktopPageEnabled: sample({ enabled: true, page: { lane: 'token', params: { assetId: 'native' } } }, 'Future enabled answer; today desktop.open answers { enabled:false, reason:FLAG_OFF }.'),
  intentList: sample({ intents: 'array of Intent (see preparedIntent/intent specimens)' }, 'intent.list payload.'),
  positions: sample({ positions: [] }, 'dex.positions payload — honest empty list.'),
  mineLaunches: sample({ launches: [] }, 'launchpad.listMine payload — honest empty list.'),

  assetDetail: sample({
    header: { assetId: 'native', name: 'THRU', symbol: 'THRU', image: null },
    facts: { isNative: true, program: null },
    price: null,
    charts: { supported: false, reason: 'NO_INDEXER' },
    trades: { supported: false, reason: 'NO_INDEXER' },
    holders: { supported: false, reason: 'NO_INDEXER' },
    risk: { severity: 'red', summary: 'Asset unverified' },
    launch: null,
  }, 'AssetDetail renders facts + unsupported sections with reasons.'),

  searchHits: sample({ hits: [{ assetId: 'native', name: 'THRU', symbol: 'THRU', listStatus: 'unverified' }] }, 'assetSearch hits.'),
  snapshots: sample({ snapshots: { native: null } }, 'snapshot: null means "no verified value", never a guess.'),
  templates: sample({ templates: [{ templateId: 'mint-only', launchModel: 'none', requires: ['token-transfer'], description: 'Mint-only launch (no pool at creation)' }] }, 'Template list once the mint path verifies; empty until then.'),
});

// ---- Error-fixture coverage -----------------------------------------------------
// For each error code a method declares in the schema: when it happens and whether the UI
// may retry. The envelopes themselves are mechanical ({ ok:false, error:{ code, retryable } }),
// so the test generates them from the schema and asserts this table covers every code.

export const ERROR_FIXTURE_NOTES = Object.freeze({
  INVALID_INPUT: { retryable: false, when: 'schema rejection at the router seam; fix the call, never retry blindly' },
  FEATURE_DISABLED: { retryable: false, when: 'build-time flag off; UI hides the surface instead of calling' },
  UNSUPPORTED: { retryable: false, when: 'capability dossier refusal; surface the reason, offer no retry' },
  ACCOUNT_MISSING: { retryable: false, when: 'account does not exist on-chain; offer receive/activate first' },
  INSUFFICIENT_BALANCE: { retryable: false, when: 'amount exceeds balance plus fees; user lowers amount' },
  ALREADY_EXISTS: { retryable: true, when: 'clientRequestId reuse after a lost response; retry fetches the existing intent' },
  QUOTE_EXPIRED: { retryable: true, when: 'quote TTL elapsed; re-quote' },
  BINDING_MISMATCH: { retryable: false, when: 'review no longer matches preparation; show fresh review' },
  INTENT_EXPIRED: { retryable: true, when: 'preparation expired; reprepare' },
  INTENT_LOCKED: { retryable: true, when: 'signer/cancel in progress; wait for the in-flight operation' },
  NONCE_CONFLICT: { retryable: true, when: 'another in-flight tx consumed the nonce; resume with a fresh nonce' },
  USER_REJECTED: { retryable: false, when: 'user rejected; never auto-retry' },
  INSUFFICIENT_FEE_RESERVE: { retryable: false, when: 'fee reserve below requirements; top up first' },
  NOT_READY: { retryable: true, when: 'entity in the wrong state for the action; re-check status' },
  NOTHING_TO_CLAIM: { retryable: false, when: 'no claimable amount; never fabricate one' },
  UPLOAD_REJECTED: { retryable: false, when: 'bad type/size/reference; user picks another file' },
  RATE_LIMITED: { retryable: true, when: 'local quota; back off' },
  RPC_UNAVAILABLE: { retryable: true, when: 'RPC unreachable; offline-honest retry with backoff' },
  UPSTREAM_UNAVAILABLE: { retryable: true, when: 'indexer/feed/oracle down; retry with backoff' },
  VERSION_MISMATCH: { retryable: false, when: 'capability matrix too old; refresh capabilities first' },
  INTERNAL: { retryable: false, when: 'unexpected; logged; never silently mapped to success' },
  CONTEXT_CHANGED: { retryable: true, when: 'account/network changed; review current context and retry' },
  NOT_WHITELISTED: { retryable: false, when: 'policy refusal; user edits whitelist first' },
});
