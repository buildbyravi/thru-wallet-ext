// G3 (2026-10): the REAL DEX swap surface on the Thru AMM — pool reads, exact-in quotes, and
// swap INTENT records that execute through intent.submit — proven in-process with zero
// network (the chain seams are fixtured at dex-service boundaries; parsing/matching, the
// quote math, slippage floor, the intent pipeline and the signing guard are all real code).
//
// Chain anchors this suite rests on (dated evidence, not memory):
//   - AMM program on-node == first-party bootstrap table: q14 PASS, 2026-10-07
//   - derivation/parser/quotes surface verified against the live program surface: q15, same date
//   - zero pools initialized on betanet at that rung → listPools returning an empty page is
//     the honest betanet answer; this suite fixtures an INITIALIZED pool to prove the G3 path.
//
// What this proves:
//   [1] flag OFF keeps the identical M0 gate envelopes for every dex entry point
//       (G0 quarantine intact: env:'result' reads quote/listPools/getPool → supported:false
//        inside data; env:'error' positions/prepareSwap/prepareLiquidity → FEATURE_DISABLED)
//   [2] listPools: derives the candidate pool pair from the wallet's registry mints, reads it,
//       finds it absent on-chain → supported:true with an EMPTY page (honest, not fabricated),
//       and reflects an initialized pool when one exists — parsed for real fields (mints/fee/lp)
//   [3] getPool: full PoolDetail with honest null tiers (no volume/apxe/charts/oracle today)
//   [4] dex.quote: constant-product math via the FIRST-PARTY quote fn, strings only (INT-06),
//       slippage-floored min out, 120s quoteId; honest unsupported envelopes for a pair
//       mismatch, empty vaults, and absent pools; INVALID_INPUT for junk slippage/amounts
//   [5] dex.prepareSwap: unknown/stale quoteId → QUOTE_EXPIRED; a fresh quote becomes a
//       reviewable dex-swap intent bound to the ACTIVE account/network with a bindingHash
//   [6] intent.submit executes the driver's swap: BINDING_MISMATCH refusal upfront, then a
//       chain-acknowledged signature; the intent record carries BOTH signature and status
//   [7] execute-time honesty: stale pool → SWAP_STALE (keepCode), missing output account →
//       TOKEN_ACCOUNT_MISSING, VM revert → SWAP_REVERTED classified via AMM label table; none
//       collapse into PROGRAM_ERROR
//   [8] R2 exit-first: quoteLiquidity(add) and prepareLiquidity stay honestly gated/deferred
//   [9] dex.positions reads LP balances of initialized pools for the active account

import assert from 'node:assert/strict';

// ---- Minimal chrome.storage shim (memory) — same pattern as test-defi-intent.mjs ----------
const storage = new Map();
const session = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') return { [keys]: storage.get(keys) };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, storage.get(k)]));
        return Object.fromEntries(storage.entries());
      },
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) storage.set(k, v); },
      remove: async (key) => { for (const k of Array.isArray(key) ? key : [key]) storage.delete(k); },
      clear: async () => storage.clear(),
    },
    session: {
      get: async (key) => ({ [key]: session.get(key) }),
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) session.set(k, v); },
      remove: async (key) => { for (const k of Array.isArray(key) ? key : [key]) session.delete(k); },
      clear: async () => session.clear(),
    },
  },
};

const { handleApiRequest } = await import('../src/background/api-router.js');
const { FLAGS } = await import('../src/shared/flags.js');
const dexService = await import('../src/background/features/dex/dex-service.js');
const thru = await import('../src/lib/thru-client.js');
const amm = await import('../src/lib/amm.js');

const PASSWORD = 'Password123!';
const PASS = 'ok -';
let checks = 0;
function ok(label, cond = true) {
  checks += 1;
  assert.ok(cond, label);
  console.log(`  ${PASS} ${label}`);
}

const walletRes = await handleApiRequest({ method: 'wallet.create', params: { password: PASSWORD } });
assert.equal(walletRes.ok, true);
const SENDER = walletRes.data.address;

// Fixture addresses: decode-valid betanet-shaped pins RE-USED as opaque IDs (real AMM system
// addresses, evidence row pins). They never hit the network in this suite — every read of them
// is fixtured — but every address that ever crosses a codec (sortMints / Pubkey decode at
// sign-time) must be a REAL thrufmt string or the SDK rightly refuses.
const MINT_A = 'taEOAD2uLK1SLzPgtabFLUAx22yDlBs9DE9nZFTOESIGRr';
const MINT_B = 'taTOKENKRgcl3vO0yVhftATDbXuhgWcfaaxv9xpEEdMdUE';
const POOL = 'taAMMx8gG44RcOyRqNYZ55pDaAJoGS0R8kPYxBN96sO8kD';
const VAULT_ONE = 'taFCTxR0y2eabGGaEdtTwC9pHz7ZY4CYD7FOiBFUJeAW16';
const VAULT_TWO = 'taTigKYAf5mNxUNUVXeXq1HQodKc07DBzF4Pl7tCi1iXxt';
const LP_MINT = 'taNOOPV4A7S3WTsirr149To2GoGZ9q8zllQaBrbekHfkJT';
const INPUT_TA = 'taLjMDKiBDra1EGIKoF_7B-tGFJMnf8MejLDu3VVWTRJRQ';
const OUTPUT_TA = 'taLu3d1rxGdQWWHJxUOK6eT9ti4lWeTijNp0Kk_5YKHARg';

// ---- [1] quarantine: flag OFF keeps the M0 envelopes ----------------------------------------
// 2026-10-26 ship decision: the swap slice ships ON in this build, so flag-OFF behaviour is
// probed by forcing the gates off in-memory, then restoring the shipped default below. The
// gate law itself is unchanged.
{
  const shipped = { ...FLAGS };
  FLAGS.DEFI = false;
  FLAGS.DEFI_READ = false;
  FLAGS.DEFI_DEX = false;
  FLAGS.DEFI_INTENT = false;
  try {
    const OFF = [
      ['dex.listPools', {}],
      ['dex.getPool', { poolId: POOL }],
    ];
    for (const [method, params] of OFF) {
      const res = await handleApiRequest({ method, params });
      assert.equal(res.ok, true, `${method} env:'result' arrives inside data`);
      assert.equal(res.data.supported, false, `${method} supported:false`);
      assert.equal(typeof res.data.reason, 'string');
    }
    ok('flag OFF: dex.listPools/getPool answer supported:false inside data (env: result)');

    for (const [method, params] of [
      ['dex.positions', { address: 'taEREREREREREREREREREREREREREREREREREREREREREf' }],
      ['dex.prepareSwap', { quoteId: 'nope', clientRequestId: 'cr-x', password: PASSWORD }],
      ['dex.prepareLiquidity', { quoteId: 'nope', clientRequestId: 'cr-x', password: PASSWORD }],
    ]) {
      const res = await handleApiRequest({ method, params });
      assert.equal(res.ok, false, `${method} env:'error' throws`);
      assert.equal(res.error.code, 'FEATURE_DISABLED', `${method} code`);
    }
    ok('flag OFF: dex.positions/prepareSwap/prepareLiquidity answer FEATURE_DISABLED (env: error)');

    const qOff = await handleApiRequest({ method: 'dex.quote', params: { poolId: POOL, inputAssetId: MINT_A, outputAssetId: MINT_B, inputAmountUnits: '1000' } });
    assert.equal(qOff.ok, true);
    assert.equal(qOff.data.supported, false);
    ok('flag OFF: dex.quote answers supported:false inside data (env: result)');
  } finally {
    Object.assign(FLAGS, shipped);
  }
}

// ---- flag ON (shipped since 2026-10-26 — the assertions below probe the real pipeline) -----
assert.equal(FLAGS.DEFI, true, 'DEFI ships on');
assert.equal(FLAGS.DEFI_READ, true, 'DEFI_READ ships on');
assert.equal(FLAGS.DEFI_DEX, true, 'DEFI_DEX ships on');
assert.equal(FLAGS.DEFI_INTENT, true, 'DEFI_INTENT ships on');

// Dossier rung, honestly: offline there is no runtime fingerprint, so every seed row answers
// NETWORK_RESET against this process; align the seam with the seed fingerprint (the runtime
// fingerprint on live betanet), and teach the swap row its post-G3 probe state — a LIVE swap
// is still unproven on-chain, so in production the dossier keeps dex.quote/prepareSwap at
// EXECUTION_UNVERIFIED until a dated live-swap probe graduates the row. This suite proves the
// code path the dossier will unlock.
const registryService = await import('../src/background/services/registry-service.js');
const { SEED_FINGERPRINT } = await import('../src/background/services/defi/capability-snapshot.js');
registryService._setFingerprintForTests(SEED_FINGERPRINT);
registryService._featureOverrideForTests.swap = { key: 'swap', state: 'enabled', reason: null, evidenceRef: ['test dossier: the future live-swap probe'] };

// Empty chain: every account absent, no token accounts. Derivation seam returns the fixture
// pool address for the known pair so candidate paging reaches an honest absent read.
const absentState = async () => ({ state: 'absent' });
dexService._patchChainForTests({
  accountExistsData: async () => ({ exists: false, data: null }),
  tokenAccountOf: async () => ({ exists: false }),
  tokenBalanceOf: async () => ({ tokenAccount: null, exists: false, amount: null }),
  derivePoolAddresses: (mintA, mintB) => ({
    poolAddress: POOL,
    poolBytes: new Uint8Array(32),
    mintOneAddress: amm.sortMints(mintA, mintB).mintOneAddress,
    mintTwoAddress: amm.sortMints(mintA, mintB).mintTwoAddress,
    poolSeed: new Uint8Array(32),
    lpMintSeed: new Uint8Array(32),
    vaultOneSeed: new Uint8Array(32),
    vaultTwoSeed: new Uint8Array(32),
    swapFeeBps: amm.AMM_DEFAULT_SWAP_FEE_BPS,
    inputOrder: 'already-sorted',
  }),
  poolStateOf: absentState,
});

// Register two mints with the wallet (metadata-only, does not pretend the mints exist on-chain).
for (const [mintAddress, symbol] of [[MINT_A, 'AAA'], [MINT_B, 'BBB']]) {
  const r = await handleApiRequest({ method: 'token.import', params: { mintAddress, symbol, name: symbol, decimals: 6 } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
}
ok('registry seeded with two known mints');

// ---- [2] listPools: empty chain → honest empty page -----------------------------------------
const emptyPage = await handleApiRequest({ method: 'dex.listPools', params: {} });
assert.equal(emptyPage.ok, true);
assert.equal(emptyPage.data.supported, true);
assert.deepEqual(emptyPage.data.items, []);
assert.equal(emptyPage.data.partial, false);
ok('listPools: zero pools on-chain → supported:true with an EMPTY page (honest, never fabricated)');

// Flip the pool fixture to initialized: one pool with known reserves.
const POOL_META = {
  isInitialized: true,
  lockedLpSupply: 0n,
  swapFeeBps: 30, // 0.30% — set explicitly; the fixture owns its fee
  swapPoolAuthority: POOL,
  mintOne: null, // filled with the SORTED order below
  mintTwo: null,
  vaultOne: VAULT_ONE,
  vaultTwo: VAULT_TWO,
  lpMint: LP_MINT,
};
{
  const sorted = amm.sortMints(MINT_A, MINT_B);
  POOL_META.mintOne = sorted.mintOneAddress;
  POOL_META.mintTwo = sorted.mintTwoAddress;
}
const livePool = { state: 'ok', pool: POOL_META };
const RESERVES = { one: 1_000_000n, two: 4_000_000n };
const partyAccounts = {
  [VAULT_ONE]: { exists: true, mint: POOL_META.mintOne, owner: POOL, amount: RESERVES.one },
  [VAULT_TWO]: { exists: true, mint: POOL_META.mintTwo, owner: POOL, amount: RESERVES.two },
};
dexService._patchChainForTests({
  poolStateOf: async (address) => (address === POOL ? livePool : absentState()),
  tokenAccountOf: async (address) => partyAccounts[address] ?? { exists: false },
});

const page = await handleApiRequest({ method: 'dex.listPools', params: { limit: 10 } });
assert.equal(page.ok, true);
assert.equal(page.data.items.length, 1);
assert.deepEqual(await (async () => {
  const it = page.data.items[0];
  const v = [it.poolId === POOL, it.mintOne === POOL_META.mintOne, it.mintTwo === POOL_META.mintTwo,
    it.swapFeeBps === 30, it.lpMint === LP_MINT, it.state === 'initialized',
    it.reserves?.reserveOne === '1000000', it.reserves?.reserveTwo === '4000000'].every(Boolean);
  return v;
})(), true);
assert.equal(page.data.source, 'chain');
ok('listPools: the one initialized on-chain pool is discovered, parsed, and paged with reserves');

const filtered = await handleApiRequest({ method: 'dex.listPools', params: { assetId: MINT_A } });
assert.equal(filtered.data.items.length, 1);
ok('listPools: assetId filter narrows candidates');

// ---- [3] getPool detail ---------------------------------------------------------------------
const detail = await handleApiRequest({ method: 'dex.getPool', params: { poolId: POOL } });
assert.equal(detail.ok, true);
assert.equal(detail.data.supported, true);
assert.equal(detail.data.header.poolId, POOL);
assert.equal(detail.data.header.state, 'initialized');
assert.equal(detail.data.reserves.reserveOne, '1000000');
assert.equal(detail.data.fee.swapFeeBps, 30);
assert.equal(detail.data.volume, null);
assert.equal(detail.data.apxe, null);
assert.equal(detail.data.oracle.supported, false);
assert.equal(detail.data.feedState.supported, false);
assert.match(detail.data.oracle.reason, /no oracle feed/);
ok('getPool: real PoolDetail — reserves/fee parsed, analytics tiers honest nulls with reasons');

const absentDetail = await handleApiRequest({ method: 'dex.getPool', params: { poolId: VAULT_ONE } });
assert.equal(absentDetail.ok, true);
assert.equal(absentDetail.data.supported, false);
assert.equal(absentDetail.data.reason, 'pool-not-found');
ok('getPool: absent pool → supported:false pool-not-found (a result, not an error)');

// ---- [9] dex.positions: LP balance of the active account -------------------------------------
const userTokens = {
  [POOL_META.mintOne]: { tokenAccount: INPUT_TA, exists: true, amount: 500_000n },
  [POOL_META.mintTwo]: { tokenAccount: OUTPUT_TA, exists: true, amount: 900_000n },
  [LP_MINT]: { tokenAccount: OUTPUT_TA, exists: true, amount: 1_234_567n },
};
dexService._patchChainForTests({
  tokenBalanceOf: async (owner, mint) => userTokens[mint] ?? { tokenAccount: null, exists: false, amount: null },
});
const pos = await handleApiRequest({ method: 'dex.positions', params: { address: SENDER } });
assert.equal(pos.ok, true, JSON.stringify(pos.error));
assert.equal(pos.data.positions.length, 1);
assert.equal(pos.data.positions[0].lpAmountUnits, '1234567');
assert.equal(pos.data.positions[0].poolId, POOL);
assert.equal(pos.data.positions[0].addable.supported, false);
assert.match(pos.data.positions[0].addable.reason, /exit-before-entry/);
ok('dex.positions: LP holding surfaced; add stays disabled (R2 exit-before-entry reason intact)');

// ---- [4] dex.quote: first-party math, strings only, honest unsupported ----------------------
const quoteRes = await handleApiRequest({
  method: 'dex.quote',
  params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '10000' },
});
assert.equal(quoteRes.ok, true, JSON.stringify(quoteRes.error));
const q = quoteRes.data;
// Exact-in CPMM, fee 30bps: factor 9970/10000 · out = x_out·f·A/(r_in·10000 + f·A)
const expectedOut = 4_000_000n * 9_970n * 10_000n / (1_000_000n * 10_000n + 9_970n * 10_000n);
assert.equal(q.output.amountUnits, expectedOut.toString(), `quote output ${q.output.amountUnits} != ${expectedOut}`);
assert.equal(q.input.amountUnits, '10000');
assert.equal(q.feeTotal.lpFeeUnits, '30'); // 10000 * 30 / 10000
assert.equal(typeof q.priceImpactBps, 'number');
assert.ok(q.priceImpactBps >= 0 && q.priceImpactBps <= 10_000);
assert.equal(typeof q.quoteId, 'string');
assert.ok(q.expiresAt > Date.now() && q.expiresAt <= Date.now() + 120_000);
assert.match(q.rate.outPerInScaled1e6, /^\d+$/);
ok('dex.quote: exact constant-product math via the first-party fn, BigInt strings only (INT-06)');

// Reverse direction quotes through the same pool
const reverse = await handleApiRequest({
  method: 'dex.quote',
  params: { poolId: POOL, inputAssetId: POOL_META.mintTwo, outputAssetId: POOL_META.mintOne, inputAmountUnits: '10000' },
});
assert.equal(reverse.ok, true);
const reverseOut = 1_000_000n * 9_970n * 10_000n / (4_000_000n * 10_000n + 9_970n * 10_000n);
assert.equal(reverse.data.output.amountUnits, reverseOut.toString());
ok('dex.quote: the reverse direction quotes against the mirrored reserves honestly');

// Slippage default + explicit; output bound is integer-floored
const slipped = await handleApiRequest({
  method: 'dex.quote',
  params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '10000', slippageBps: 500 },
});
assert.equal(slipped.ok, true);
// (500 bps = 5%) — minOut recomputed in prepare from THIS quote when used; here we validate
// the cached min bound via a dry call to the lib:
assert.equal(amm.applySlippage(slipped.data.output.amountUnits, 500),
  ((BigInt(slipped.data.output.amountUnits) * 9_500n) / 10_000n).toString());
ok('dex.quote: slippage bound is integer-floored (never promises more than deliverable)');

// Honest unsupported paths (env:'result')
const pairMismatch = await handleApiRequest({
  method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintOne, inputAmountUnits: '1' },
});
assert.equal(pairMismatch.ok, true);
assert.equal(pairMismatch.data.supported, false);
assert.equal(pairMismatch.data.reason, 'pair-mismatch');
const noPool = await handleApiRequest({
  method: 'dex.quote', params: { poolId: VAULT_ONE, inputAssetId: MINT_A, outputAssetId: MINT_B, inputAmountUnits: '1' },
});
assert.equal(noPool.data.supported, false);
assert.equal(noPool.data.reason, 'pool-not-found');
ok('dex.quote: pair-mismatch and pool-not-found arrive as honest supported:false reasons');

// Validation errors
const zeroAmount = await handleApiRequest({ method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '0' } });
assert.equal(zeroAmount.ok, false);
assert.equal(zeroAmount.error.code, 'INVALID_INPUT');
const junkSlip = await handleApiRequest({ method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '1', slippageBps: 9999 } });
assert.equal(junkSlip.ok, false);
assert.equal(junkSlip.error.code, 'INVALID_INPUT');
ok('dex.quote: zero amount and out-of-range slippage refuse with INVALID_INPUT');

// Empty-vault honesty
dexService._patchChainForTests({ tokenAccountOf: async () => ({ exists: false }) });
const noReserves = await handleApiRequest({ method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '100' } });
assert.equal(noReserves.ok, true);
assert.equal(noReserves.data.supported, false);
assert.equal(noReserves.data.reason, 'vault-read-failed-or-missing');
dexService._patchChainForTests({ tokenAccountOf: async (address) => partyAccounts[address] ?? { exists: false } });
ok('dex.quote: unreadable vaults → supported:false vault-read-failed-or-missing (never a guessed rate)');

// ---- [5] prepare → intent record ------------------------------------------------------------
const stalePrepare = await handleApiRequest({
  method: 'dex.prepareSwap', params: { quoteId: 'dq_fabricated', clientRequestId: 'cr-stale', password: PASSWORD },
});
assert.equal(stalePrepare.ok, false);
assert.equal(stalePrepare.error.code, 'QUOTE_EXPIRED');
ok('dex.prepareSwap: unknown quoteId refuses with QUOTE_EXPIRED (no fabricated plans)');

const freshQuote = await handleApiRequest({
  method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '10000', slippageBps: 100 },
});
assert.equal(freshQuote.ok, true);
const freshQ = freshQuote.data;
const prepare = await handleApiRequest({
  method: 'dex.prepareSwap', params: { quoteId: freshQ.quoteId, clientRequestId: 'cr-swap-1', password: PASSWORD },
});
assert.equal(prepare.ok, true, JSON.stringify(prepare.error));
const review = prepare.data;
assert.match(review.bindingHash, /^[0-9a-f]{24}$/);
assert.equal(review.facts.inputAmountUnits, '10000');
assert.equal(review.facts.quotedOutputUnits, freshQ.output.amountUnits);
assert.match(review.reviewAscii, /dex-swap/);
assert.match(review.reviewAscii, /Receive ≥/);
const intentsKey = 'defi_intents::betanet';
const stored = (storage.get(intentsKey) ?? []).find((r) => r.kind === 'dex-swap');
assert.ok(stored, 'the dex-swap intent is in the network-scoped store');
assert.equal(stored.status, 'prepared');
const intentId = stored.intentId;
assert.equal(stored.plan.networkId, 'betanet');
assert.equal(stored.plan.fromAddress, SENDER);
ok('dex.prepareSwap: reviewable dex-swap intent bound to the active account/network, bindingHash over the plan');

// ---- [6] submit: guard + execution -----------------------------------------------------------
const mismatch = await handleApiRequest({ method: 'intent.submit', params: { intentId, bindingHash: 'deadbeef', password: PASSWORD } });
assert.equal(mismatch.ok, false);
assert.equal(mismatch.error.code, 'BINDING_MISMATCH');
ok('intent.submit: tx-review semantics — the wrong bindingHash refuses before any chain call');

// Zero-network client stubs for the driver's sign+track
const client = thru.getClient();
let built = null;
client.transactions.buildAndSign = async (args) => { built = args; return { rawTransaction: new Uint8Array([9, 9, 9]) }; };
client.transactions.sendAndTrack = async function* () {
  yield { signature: { value: new Uint8Array(64).fill(4) } };
  yield { executionResult: { vmError: 0, consumedComputeUnits: 88_000n, consumedMemoryUnits: 0n, consumedStateUnits: 0n } };
};

const submitted = await handleApiRequest({ method: 'intent.submit', params: { intentId, bindingHash: review.bindingHash, password: PASSWORD } });
assert.equal(submitted.ok, true, JSON.stringify(submitted.error));
assert.ok(submitted.data.signature, 'a chain-acknowledged signature returned');
assert.ok(built, 'buildAndSign ran');
assert.deepEqual(built.accounts.readWrite, [POOL, INPUT_TA, OUTPUT_TA, VAULT_ONE, VAULT_TWO, LP_MINT]);
assert.equal(built.accounts.readOnly.length, 1);
assert.ok(built.header.computeUnits > 0 && built.header.stateUnits > 0 && built.header.memoryUnits > 0);
const after = (storage.get(intentsKey) ?? []).find((r) => r.intentId === intentId);
assert.equal(after.status, 'waitingChain');
assert.ok(after.signature, 'signature recorded on the intent');
assert.equal(after.kind, 'dex-swap');
ok('intent.submit: dex-swap driver signs at submit and the intent records the chain state + signature');

// ---- [7] execute-time honesty ----------------------------------------------------------------
// 7a: stale pool — reserves moved far enough that min-out is no longer achievable
dexService._patchChainForTests({
  tokenAccountOf: async (address) => {
    if (address === VAULT_ONE) return { exists: true, mint: POOL_META.mintOne, owner: POOL, amount: 1_000_000n };
    if (address === VAULT_TWO) return { exists: true, mint: POOL_META.mintTwo, owner: POOL, amount: 100n }; // drained
    return { exists: false };
  },
});
const staleQuote = await handleApiRequest({
  method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '10000' },
});
// (the quote above quotes against the DRAINED vaults faithfully — but for the stale-run we want a
// review bound when pools were balanced, then move reserves before submit → re-prepare honestly)
dexService._patchChainForTests({ tokenAccountOf: async (a) => partyAccounts[a] ?? { exists: false } });
const balancedQuote = await handleApiRequest({
  method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '10000' },
});
assert.equal(balancedQuote.ok, true);
const balancedPrep = await handleApiRequest({
  method: 'dex.prepareSwap', params: { quoteId: balancedQuote.data.quoteId, clientRequestId: 'cr-swap-stale', password: PASSWORD },
});
assert.equal(balancedPrep.ok, true);
dexService._patchChainForTests({ // pool moved AFTER the review
  tokenAccountOf: async (a) => {
    if (a === VAULT_ONE) return { exists: true, mint: POOL_META.mintOne, owner: POOL, amount: 1_000_000n };
    if (a === VAULT_TWO) return { exists: true, mint: POOL_META.mintTwo, owner: POOL, amount: 100n };
    return { exists: false };
  },
});
const staleSubmit = await handleApiRequest({ method: 'intent.submit', params: { intentId: (storage.get(intentsKey) ?? []).find((r) => r.clientRequestId === 'cr-swap-stale').intentId, bindingHash: balancedPrep.data.bindingHash, password: PASSWORD } });
assert.equal(staleSubmit.ok, false);
assert.equal(staleSubmit.error.code, 'SWAP_STALE');
assert.match(staleSubmit.error.message, /re-quote/);
const staleRec = (storage.get(intentsKey) ?? []).find((r) => r.clientRequestId === 'cr-swap-stale');
assert.equal(staleRec.errorCode, 'SWAP_STALE');
assert.equal(staleRec.status, 'failed');
ok('execute: pool moved past the reviewed bound → SWAP_STALE with its own code (keepCode), never PROGRAM_ERROR');

dexService._patchChainForTests({ tokenAccountOf: async (a) => partyAccounts[a] ?? { exists: false } });

// 7b: missing output token account → TOKEN_ACCOUNT_MISSING
dexService._patchChainForTests({
  tokenBalanceOf: async (owner, mint) => (mint === POOL_META.mintTwo ? { tokenAccount: null, exists: false, amount: null } : (userTokens[mint] ?? { exists: false })),
});
const missingQuote = await handleApiRequest({
  method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '10000' },
});
const missingPrep = await handleApiRequest({
  method: 'dex.prepareSwap', params: { quoteId: missingQuote.data.quoteId, clientRequestId: 'cr-swap-noout', password: PASSWORD },
});
const missingSubmit = await handleApiRequest({
  method: 'intent.submit', params: { intentId: (storage.get(intentsKey) ?? []).find((r) => r.clientRequestId === 'cr-swap-noout').intentId, bindingHash: missingPrep.data.bindingHash, password: PASSWORD },
});
assert.equal(missingSubmit.ok, false);
assert.equal(missingSubmit.error.code, 'TOKEN_ACCOUNT_MISSING');
assert.match(missingSubmit.error.message, /does not auto-create/);
ok('execute: missing output token account → TOKEN_ACCOUNT_MISSING with the honest JIT-creation rationale');

// restore balances
dexService._patchChainForTests({
  tokenBalanceOf: async (owner, mint) => userTokens[mint] ?? { tokenAccount: null, exists: false, amount: null },
});

// 7c: VM revert → SWAP_REVERTED classified through the AMM label table
client.transactions.sendAndTrack = async function* () {
  yield { signature: { value: new Uint8Array(64).fill(7) } };
  yield { executionResult: { vmError: 2, userErrorCode: 1 } };
};
const revertQuote = await handleApiRequest({
  method: 'dex.quote', params: { poolId: POOL, inputAssetId: POOL_META.mintOne, outputAssetId: POOL_META.mintTwo, inputAmountUnits: '10000' },
});
const revertPrep = await handleApiRequest({
  method: 'dex.prepareSwap', params: { quoteId: revertQuote.data.quoteId, clientRequestId: 'cr-swap-revert', password: PASSWORD },
});
const revertSubmit = await handleApiRequest({
  method: 'intent.submit', params: { intentId: (storage.get(intentsKey) ?? []).find((r) => r.clientRequestId === 'cr-swap-revert').intentId, bindingHash: revertPrep.data.bindingHash, password: PASSWORD },
});
assert.equal(revertSubmit.ok, false);
assert.equal(revertSubmit.error.code, 'SWAP_REVERTED');
assert.match(revertSubmit.error.message, /AMM error 1/);
ok('execute: chain revert → SWAP_REVERTED with the AMM error code carried in the message');

// ---- [8] R2 exit-first liquidity honesty ------------------------------------------------------
const addQuote = await handleApiRequest({
  method: 'dex.quoteLiquidity', params: { poolId: POOL, mode: 'add', amounts: { one: '1', two: '1' } },
});
assert.equal(addQuote.ok, true);
assert.equal(addQuote.data.supported, false);
assert.match(addQuote.data.reason, /remove-liquidity verifies live/);
const prepLiq = await handleApiRequest({
  method: 'dex.prepareLiquidity', params: { quoteId: 'lq_any', clientRequestId: 'cr-liq', password: PASSWORD },
});
assert.equal(prepLiq.ok, false);
assert.equal(prepLiq.error.code, 'NOT_READY');
assert.match(prepLiq.error.message, /exit-first/);
ok('R2 exit-first: add-liquidity quote unsupported + liquidity prepare NOT_READY with the owner-rule reason');

// Intent pipeline quarantine intact for the other kind: native-send still routes via its driver
const nativePrepCount = (storage.get(intentsKey) ?? []).filter((r) => r.kind === 'native-send').length;
assert.equal(nativePrepCount, 0);
ok('kind-driver dispatch: this suite created only dex-swap records; native-send remains its own driver');

console.log(`\ntest-dex-swap: ${checks} checks OK`);
dexService._resetChainForTests();
