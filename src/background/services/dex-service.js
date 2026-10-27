// DEX service — G3 (2026-10): REAL pool reads + exact-in quotes + swap intents on the Thru AMM.
//
// Chain identity today (dated evidence, not memory):
//   - The AMM program is DEPLOYED and matches the first-party bootstrap table: on-node program
//     taAMMx8gG44RcOyRqNYZ55pDaAJoGS0R8kPYxBN96sO8kD, == AMM_PROGRAM_ADDRESS — verified
//     2026-10-07 (scripts/defi-evidence/2026-10-07-live-chain.json: q14 PASS).
//   - The same rung proved the derivation/parser surface (q15) but found NO pools initialized.
//     So the honest READ answer on betanet today is SUPPORTED-with-an-empty-page: discovery
//     queried the chain and found zero pools. Quoting re-reads the pool on demand.
//
// Slices G3 delivers, each faithful to its tier:
//   dex.listPools / dex.getPool — DERIVE pool addresses from the wallet's token registry +
//                                   first-party derivation (q15-verified), read each pool
//                                   account, parse with the first-party parser. Zero pools →
//                                   honest empty page, never a fabricated one.
//   dex.positions               — LP-token balances of the found pools for the active account;
//                                   zero pools → empty list (still a result, not an error).
//   dex.quote                   — reserve reads from pool vault token accounts; first-party
//                                   quoteAmmSwapExactIn (q15-verified math); slippage bounds as
//                                   integer-floor BigInt. Short-lived in-memory quote cache.
//   dex.prepareSwap             — review-first swap INTENT record (v20 pipeline semantics: PIN,
//                                   review, bindingHash, 120s ttl) via intent-service's kind
//                                   drivers. Execution is registered here and dispatched by
//                                   intent.submit — the swap signs at submit, not at prepare.
// Honestly deferred (exit-before-entry, DEFI R2 owner rule):
//   dex.quoteLiquidity / dex.prepareLiquidity — ADD-LIQUIDITY stays disabled until the REMOVE
//     path is verified live. The quote-side math for add/remove is deferred with the flag's
//     own message; positions still shows LP balances honestly.
//
// Gates: env:'result' for pure reads + quotes (unsupported arrives INSIDE data, S13), env:'error'
// for intent-creating prepare positions and LP positions reads. Both build-time flags stay OFF.

import { gateOrThrow } from './defi/gating.js';
import * as intentService from './intent-service.js';
import * as intentStore from './defi/intent-store.js';
import * as accountService from './account-service.js';
import * as tokenService from './token-service.js';
import * as pending from './pending-tx-service.js';
import { getActiveNetworkConfig } from './network-service.js';
import { assertSendContext } from './send-context.js';
import * as vault from '../../lib/vault.js';
import * as thruClient from '../../lib/thru-client.js';
import * as amm from '../../lib/amm.js';
import { autoUnits, noteExecution, UNIT_CLASS } from '../../lib/tx-units.js';
import { LIMITS } from './defi/capability-snapshot.js';

// ---- Gate map (v17/v18 wire, unchanged) -----------------------------------------------
const GATES = Object.freeze({
  listPools: { gate: 'DEFI_READ', feature: 'pools', env: 'result', label: 'DEX pools' },
  getPool: { gate: 'DEFI_READ', feature: 'pools', env: 'result', label: 'DEX pool detail' },
  positions: { gate: 'DEFI_READ', feature: 'pools', env: 'error', label: 'DEX liquidity positions' },
  quote: { gate: 'DEFI_DEX', feature: 'swap', env: 'result', label: 'Swaps' },
  quoteLiquidity: { gate: 'DEFI_DEX', feature: 'pools', env: 'result', label: 'DEX liquidity' },
  prepareSwap: { gate: 'DEFI_DEX', feature: 'swap', env: 'error', label: 'Swaps' },
  prepareLiquidity: { gate: 'DEFI_DEX', feature: 'pools', env: 'error', label: 'DEX liquidity' },
});

function errCode(code, message, retryable = false, extra = {}) {
  const err = new Error(message);
  err.code = code;
  err.retryable = retryable;
  return Object.assign(err, extra);
}

/** Envelope helper for env:'result' methods: an honest supported:false with reason. */
function unsupported(reason, extra = {}) {
  return { supported: false, reason, ...extra };
}

const INTENT_KIND_DEX_SWAP = 'dex-swap';

// Quote ttl + slippage defaults come from the dossier limits table (the project's declared
// starting values), never re-invented here.
const QUOTE_TTL_MS = LIMITS.quoteTtlMs ?? 15_000;
const DEFAULT_SLIPPAGE_BPS = LIMITS.slippageDefaultBps ?? 50;
const MAX_SLIPPAGE_BPS = 1_000;     // 10% — anything looser is a footgun, not a preference
const MAX_POOL_PAGE = 25;

// ---- Chain-read seams (injected in tests) ----------------------------------------------
// The real implementations run through thru-client (the SDK doorway). Tests patch these to
// deterministic fixtures — the derivation/parsing/quote logic itself is NOT faked.
const chain = {
  async accountExistsData(address) {
    const info = await thruClient.getAccountInfo(address);
    if (!info?.exists) return { exists: false, data: null };
    const raw = info.raw ?? null;
    const data = raw?.data?.data instanceof Uint8Array ? raw.data.data : (raw?.data instanceof Uint8Array ? raw.data : null);
    return { exists: true, data };
  },
  async tokenAccountOf(address) {
    return thruClient.readTokenAccount(address);
  },
  async tokenBalanceOf(ownerAddress, mintAddress) {
    return thruClient.getTokenBalance(ownerAddress, mintAddress);
  },
  derivePoolAddresses(mintA, mintB, swapFeeBps) {
    return amm.derivePool(thruClient.getClient(), { mintAAddress: mintA, mintBAddress: mintB, swapFeeBps });
  },
  // Pool fetch+parse as one seam: the first-party metadata builder is not constructible from
  // outside the package, so offline tests fixture the PARSED pool here (parse correctness is
  // covered live by probe-amm.mjs / evidence q15); everything downstream — quote math,
  // slippage, direction, caching, intents — runs on the real code path.
  async poolStateOf(address) {
    return readPoolStateInternal(address);
  },
};
const defaults = Object.freeze({ ...chain });

/** Test-only seam override; undefined keys are ignored. */
export function _patchChainForTests(patch) {
  for (const [k, v] of Object.entries(patch ?? {})) if (k in chain && typeof v === 'function') chain[k] = v;
}
/** Test-only seam reset to the live chain reads. */
export function _resetChainForTests() {
  chain.accountExistsData = defaults.accountExistsData;
  chain.tokenAccountOf = defaults.tokenAccountOf;
  chain.tokenBalanceOf = defaults.tokenBalanceOf;
  chain.derivePoolAddresses = defaults.derivePoolAddresses;
  chain.poolStateOf = defaults.poolStateOf;
}

// ---- Quote cache (in-memory; short-lived; never persisted) ------------------------------
// A quoteId must be reproducible to a fresh chain re-quote at prepare time; the cache entry
// records the full input + output + the reserve snapshot the math ran on, honestly, so the
// review shows exactly what was quoted and the bindingHash binds it into the intent record.
const quoteCache = new Map(); // quoteId -> { quote, expiresAt }
let quoteCounter = 0;

function cacheQuote(entry) {
  quoteCache.set(entry.quoteId, entry);
  for (const [id, q] of quoteCache) if (q.expiresAt <= Date.now()) quoteCache.delete(id);
}

function takeFreshQuote(quoteId) {
  const entry = quoteCache.get(quoteId);
  if (!entry) throw errCode('QUOTE_EXPIRED', `'quote not found or expired — request a fresh quote first (quotes live ${QUOTE_TTL_MS} ms — fresh reserves, fresh math)'`);
  if (entry.expiresAt <= Date.now()) {
    quoteCache.delete(quoteId);
    throw errCode('QUOTE_EXPIRED', `'quote expired — request a fresh quote first (quotes live ${QUOTE_TTL_MS} ms — fresh reserves, fresh math)'`);
  }
  return entry;
}

// ---- Pool discovery + reads -------------------------------------------------------------
// Candidate pairs come from the wallet's own registered-token set (token-service deployment
// registry = the honest source of "which mints this wallet knows about on this network").
// Derive-a-pair-then-read keeps the count = C(n,2) of KNOWN mints — honest, capped, and every
// pair we surface actually parsed. There is no chain-wide "list pools" RPC on betanet today;
// if the registry adds one later this layer is where the better substrate lands.

async function deployedMintCandidates() {
  const tokens = await tokenService.listDeployedTokens().catch(() => []);
  return (tokens ?? []).filter((t) => t?.mintAddress && typeof t.mintAddress === 'string');
}

function parseAmountBig(value, field) {
  try {
    const v = BigInt(String(value));
    if (v < 0n) throw new Error('neg');
    return v;
  } catch {
    throw errCode('INVALID_INPUT', `${field} must be a whole number of base units`);
  }
}

async function readPoolStateInternal(poolAddress) {
  const account = await chain.accountExistsData(poolAddress);
  if (!account.exists) return { state: 'absent' };
  const parsed = amm.parsePool(account.data ?? new Uint8Array());
  if (!parsed.ok) return { state: parsed.reason, data: account.data };
  return { state: 'ok', pool: parsed.pool };
}

async function readPoolState(poolAddress) {
  return chain.poolStateOf(poolAddress);
}

async function readReserves(vaultOne, vaultTwo) {
  const [one, two] = await Promise.all([
    chain.tokenAccountOf(vaultOne),
    chain.tokenAccountOf(vaultTwo),
  ]);
  if (!one?.exists || !two?.exists) return null; // vaults absent/malformed — reserves unknown, honestly
  return { reserveOne: (one.amount ?? 0n).toString(), reserveTwo: (two.amount ?? 0n).toString() };
}

/**
 * List the on-chain pools discoverable from the wallet's known mints. Paging of a *candidate*
 * set (the expensive derive+read happens only for the page).
 */
export async function listPools({ networkId, assetId, cursor, limit } = {}) {
  const gate = gateOrThrow(GATES.listPools);
  if (gate.proceed === false) return gate.data;

  const mints = (await deployedMintCandidates()).map((t) => t.mintAddress);
  const pageSize = Math.min(Math.max(Number(limit) || MAX_POOL_PAGE, 1), 50);
  const offset = Math.max(Number.parseInt(cursor ?? '0', 10) || 0, 0);

  // Deterministic candidate order: sorted pairs of sorted mints (pool identity is symmetric).
  // assetId narrows to pairs TOUCHING that asset — a pool is in scope if either side matches.
  const candidates = [];
  for (let i = 0; i < mints.length; i += 1) {
    for (let j = i + 1; j < mints.length; j += 1) {
      if (assetId && mints[i] !== assetId && mints[j] !== assetId) continue;
      const sorted = amm.sortMints(mints[i], mints[j]);
      candidates.push({ mintOne: sorted.mintOneAddress, mintTwo: sorted.mintTwoAddress, order: sorted.inputOrder });
    }
  }
  const pageCandidates = candidates.slice(offset, offset + pageSize);

  const items = [];
  for (const c of pageCandidates) {
    if (!c.mintOne || !c.mintTwo) continue;
    let derived;
    try {
      derived = chain.derivePoolAddresses(c.mintOne, c.mintTwo, amm.AMM_DEFAULT_SWAP_FEE_BPS);
    } catch { continue; } // derivation failure on a candidate = absent pool, honestly
    let state;
    try {
      state = await readPoolState(derived.poolAddress);
    } catch {
      state = { state: 'absent' }; // RPC wobble on a discovery read = absent for this listing
    }
    if (state.state !== 'ok') continue;
    const reserves = await readReserves(state.pool.vaultOne, state.pool.vaultTwo).catch(() => null);
    items.push({
      poolId: derived.poolAddress,
      networkId: networkId ?? null,
      ammProgramAddress: amm.AMM_PROGRAM_ADDRESS,
      mintOne: c.mintOne,
      mintTwo: c.mintTwo,
      swapFeeBps: state.pool.swapFeeBps,
      lpMint: state.pool.lpMint,
      state: 'initialized',
      reserves: reserves
        ? { reserveOne: reserves.reserveOne, reserveTwo: reserves.reserveTwo, units: 'base' }
        : null,
    });
  }

  const end = offset + pageSize;
  return {
    supported: true,
    source: 'chain',
    items,
    nextCursor: end < candidates.length ? String(end) : null,
    partial: false,
    updatedAt: Date.now(),
  };
}

/**
 * Pool detail, READ tier: everything we know about ONE derived-or-given pool address,
 * honestly. Analytics tiers (volume, APXE, charts, oracle) are declared by the wire but null-
 * delivered until their sources exist (no price feed for any betanet pair today, G1).
 */
export async function getPool({ poolId } = {}) {
  const gate = gateOrThrow(GATES.getPool);
  if (gate.proceed === false) return gate.data;
  if (!poolId || typeof poolId !== 'string') throw errCode('INVALID_INPUT', 'poolId is required');

  let state;
  try {
    state = await readPoolState(poolId);
  } catch {
    return unsupported('rpc-error', { header: { poolId } });
  }
  if (state.state !== 'ok') {
    return unsupported(state.state === 'absent' ? 'pool-not-found' : `pool-${state.state}`, { header: { poolId } });
  }
  const pool = state.pool;
  const reserves = await readReserves(pool.vaultOne, pool.vaultTwo).catch(() => null);
  return {
    supported: true,
    header: {
      poolId,
      ammProgramAddress: amm.AMM_PROGRAM_ADDRESS,
      programVersion: 1,
      mintOne: pool.mintOne,
      mintTwo: pool.mintTwo,
      swapFeeBps: pool.swapFeeBps,
      lpMint: pool.lpMint,
      vaultOne: pool.vaultOne,
      vaultTwo: pool.vaultTwo,
      state: 'initialized',
    },
    assets: [
      { mint: pool.mintOne, side: 'one' },
      { mint: pool.mintTwo, side: 'two' },
    ],
    reserves: reserves
      ? { reserveOne: reserves.reserveOne, reserveTwo: reserves.reserveTwo, units: 'base', cpmm: true }
      : { unknown: true, reason: 'vault-read-failed-or-missing' },
    fee: { swapFeeBps: pool.swapFeeBps },
    volume: null,   // no volume source on betanet yet — wire-declared, honestly null
    apxe: null,     // APXE requires price feeds (G1 found none for betanet pairs)
    positions: null,
    charts: null,
    risk: {
      program: { ammProgramAddress: amm.AMM_PROGRAM_ADDRESS, evidence: 'q14-program-onnode-2026-10-07' },
      unaudited: true,
    },
    oracle: { supported: false, reason: 'no oracle feed for this pair today (G1 live probe, 2026-10-07 rung)' },
    feedState: { supported: false, reason: 'no feed supporting this pair today' },
    updatedAt: Date.now(),
  };
}

/**
 * LP positions (auth:'unlocked'): LP token balances the ACTIVE account holds in the pools this
 * node actually has. Exit-before-entry (R2) means removal flow lands first; reading holdings
 * is honest regardless.
 */
export async function listPositions({ address, networkId } = {}) {
  gateOrThrow(GATES.positions); // env:'error' — gate-off throws FEATURE_DISABLED
  const account = await accountService.getActiveAccount();
  if (!account?.address) throw errCode('ACCOUNT_MISSING', 'no active account');
  if (address && address !== account.address) {
    throw errCode('INVALID_INPUT', 'positions read is bound to the active account');
  }
  const listing = await listPools({ networkId });
  if (listing.supported !== true) {
    // listPools with flag on returns supported:true or throws; unreachable today, honest fallthrough
    return { positions: [] };
  }
  const out = [];
  for (const item of listing.items) {
    let lp;
    try {
      lp = await chain.tokenBalanceOf(account.address, item.lpMint);
    } catch {
      continue; // unreadable LP account today is not a position we know about
    }
    if (!lp?.exists) continue;
    out.push({
      poolId: item.poolId,
      mintOne: item.mintOne,
      mintTwo: item.mintTwo,
      lpMint: item.lpMint,
      lpAmountUnits: (lp.amount ?? 0n).toString(),
      withdrawable: true, // exit-first: the remove path is what verifies this live
      removable: { supported: true, reason: null },
      addable: { supported: false, reason: 'Disabled until remove-liquidity verifies live (exit-before-entry, R2).' },
    });
  }
  return { positions: out };
}

// ---- Swaps: quote → intent → execute ------------------------------------------------------

async function resolveSwapQuote({ poolId, inputAssetId, outputAssetId, inputAmountUnits, slippageBps }) {
  if (!poolId || typeof poolId !== 'string') throw new Error('poolId-required');
  const inputAmount = parseAmountBig(inputAmountUnits, 'inputAmountUnits');
  if (inputAmount <= 0n) throw errCode('INVALID_INPUT', 'inputAmountUnits must be a positive whole number');
  const slip = slippageBps == null ? DEFAULT_SLIPPAGE_BPS : Number(slippageBps);
  if (!Number.isInteger(slip) || slip < 0 || slip > MAX_SLIPPAGE_BPS) {
    throw errCode('INVALID_INPUT', `slippageBps must be an integer 0..${MAX_SLIPPAGE_BPS} (100 bps = 1%)`);
  }

  let state;
  try {
    state = await readPoolState(poolId);
  } catch {
    return { error: unsupported('rpc-error') };
  }
  if (state.state !== 'ok') {
    return { error: unsupported(state.state === 'absent' ? 'pool-not-found' : `pool-${state.state}`) };
  }

  // Input/output assets = mint addresses on this chain today. (Betanet pairs are token↔token;
  // native-THRU legs need the native wrap path which this slice does not ship.)
  const inputMint = String(inputAssetId ?? '');
  const outputMint = String(outputAssetId ?? '');
  const dir = amm.resolveDirection(state.pool, inputMint, outputMint);
  if (!dir) {
    return { error: unsupported('pair-mismatch', { poolId, inputAssetId: inputMint, outputAssetId: outputMint }) };
  }

  const reserves = await readReserves(state.pool.vaultOne, state.pool.vaultTwo).catch(() => null);
  if (!reserves) return { error: unsupported('vault-read-failed-or-missing') };
  const [reserveIn, reserveOut] = dir.inputIndex === 1
    ? [reserves.reserveOne, reserves.reserveTwo]
    : [reserves.reserveTwo, reserves.reserveOne];
  if (BigInt(reserveIn) <= 0n || BigInt(reserveOut) <= 0n) {
    return { error: unsupported('insufficient-liquidity', { reserveIn, reserveOut }) };
  }

  let quoted;
  try {
    quoted = amm.quoteSwapExactIn({
      amountIn: inputAmount.toString(),
      reserveIn,
      reserveOut,
      swapFeeBps: state.pool.swapFeeBps,
    });
  } catch (e) {
    return { error: unsupported('quote-math-failed', { detail: String(e?.message ?? '').slice(0, 120) }) };
  }
  if (BigInt(quoted.amountOut) <= 0n) {
    return { error: unsupported('quote-zero-output') };
  }
  return {
    pool: state.pool,
    dir,
    reserves,
    inputAmountUnits: inputAmount.toString(),
    inputMint,
    outputMint,
    amountOutUnits: quoted.amountOut,
    feeAmountUnits: quoted.feeAmount,
    slippageBps: slip,
    minOutputUnits: amm.applySlippage(quoted.amountOut, slip),
    priceImpactBps: amm.priceImpactBps({
      amountInUnits: inputAmount.toString(), amountOutUnits: quoted.amountOut, reserveInUnits: reserveIn, reserveOutUnits: reserveOut,
    }),
  };
}

/** dex.quote — read-tier, env:'result'. */
export async function quoteSwap({ address, poolId, inputAssetId, outputAssetId, inputAmountUnits, slippageBps } = {}) {
  const gate = gateOrThrow(GATES.quote);
  if (gate.proceed === false) return gate.data;
  const resolved = await resolveSwapQuote({ poolId, inputAssetId, outputAssetId, inputAmountUnits, slippageBps });
  if (resolved.error) return resolved.error;

  const now = Date.now();
  const quoteId = `${poolId.slice(0, 12)}_q_${(quoteCounter += 1).toString(36)}_${now.toString(36)}`;
  const quote = {
    poolId,
    input: { assetId: resolved.inputMint, amountUnits: resolved.inputAmountUnits, mint: resolved.inputMint },
    output: { assetId: resolved.outputMint, amountUnits: resolved.amountOutUnits, mint: resolved.outputMint },
    rate: {
      // Honestly-rational rate: out-per-in scaled by 1e6, integer-floored BigInt math (INT-06:
      // no float minting). I.e. rate = outputAmountUnits * 1_000_000 / inputAmountUnits.
      inputAmountUnits: resolved.inputAmountUnits,
      outputAmountUnits: resolved.amountOutUnits,
      outPerInScaled1e6: ((BigInt(resolved.amountOutUnits) * 1_000_000n) / BigInt(resolved.inputAmountUnits)).toString(),
    },
    priceImpactBps: resolved.priceImpactBps,
    feeTotal: { lpFeeUnits: resolved.feeAmountUnits },
    quoteId,
    expiresAt: now + QUOTE_TTL_MS,
    address: address ?? null,
  };
  cacheQuote({
    quoteId,
    expiresAt: now + QUOTE_TTL_MS,
    quote,
    pool: resolved.pool,
    dir: resolved.dir,
    reserves: resolved.reserves,
    slippageBps: resolved.slippageBps,
    minOutputUnits: resolved.minOutputUnits,
  });
  return quote;
}

function reviewDexSwap(record) {
  const plan = record.plan;
  return {
    // intentId is required by intent.submit; without it in the review payload a UI cannot
    // complete prepare→submit without digging into storage. Additive per contract v18.
    intentId: record.intentId,
    kind: record.kind,
    reviewAscii: [
      `Kind          ${record.kind}`,
      `From          ${plan.fromAddress}`,
      `Pool          ${plan.poolId}`,
      `Pay           ${plan.inputAmountUnits} base units of ${plan.inputMint.slice(0, 12)}…`,
      `Receive ≥     ${plan.minOutputUnits} base units of ${plan.outputMint.slice(0, 12)}…`,
      `Quoted out    ${plan.quotedOutputUnits} base units (slippage ${plan.slippageBps/100}%)`,
      `Network       ${plan.networkId}`,
      `Binding       ${record.bindingHash}`,
    ].join('\n'),
    facts: {
      fromAddress: plan.fromAddress,
      poolId: plan.poolId,
      inputMint: plan.inputMint,
      outputMint: plan.outputMint,
      inputAmountUnits: plan.inputAmountUnits,
      quotedOutputUnits: plan.quotedOutputUnits,
      minOutputUnits: plan.minOutputUnits,
      slippageBps: plan.slippageBps,
      networkId: plan.networkId,
    },
    model: { kind: record.kind },
    policy: { selfSignedOnly: true, sponsorship: 'never', exitFirst: true },
    simulation: { supported: false, reason: 'swap simulation is not wired on this network today; bounds are carried on-chain via minAmountOut' },
    assetChanges: [
      { from: plan.fromAddress, to: plan.poolId, amountUnits: plan.inputAmountUnits, mint: plan.inputMint },
      { from: plan.poolId, to: plan.fromAddress, amountUnits: plan.minOutputUnits, mint: plan.outputMint, min: true },
    ],
    feePlan: { supported: true, note: 'decode: LP fee is included in the quoted output; the chain fee is the network estimate', lpFeeUnits: plan.lpFeeUnits },
    bindingHash: record.bindingHash,
    clientRequestId: record.clientRequestId ?? null,
    acknowledgements: ['swap-price-moves'],
  };
}

/** dex.prepareSwap — INTENT tier, env:'error'. */
export async function prepareSwap({ quoteId, clientRequestId } = {}) {
  gateOrThrow(GATES.prepareSwap); // env:'error' — gate-off throws FEATURE_DISABLED
  if (!clientRequestId) throw errCode('INVALID_INPUT', 'clientRequestId is required');
  if (!quoteId) throw errCode('INVALID_INPUT', 'quoteId is required');
  const entry = takeFreshQuote(String(quoteId));

  const account = await accountService.getActiveAccount();
  if (!account?.address) throw errCode('ACCOUNT_MISSING', 'no active account');
  const network = await getActiveNetworkConfig();

  const plan = {
    fromAddress: account.address,
    networkId: network.id,
    poolId: entry.quote.poolId,
    ammProgramAddress: amm.AMM_PROGRAM_ADDRESS,
    inputMint: entry.quote.input.mint,
    outputMint: entry.quote.output.mint,
    inputAssetId: entry.quote.input.assetId,
    outputAssetId: entry.quote.output.assetId,
    inputAmountUnits: entry.quote.input.amountUnits,
    quotedOutputUnits: entry.quote.output.amountUnits,
    minOutputUnits: entry.minOutputUnits,
    slippageBps: entry.slippageBps,
    priceImpactBps: entry.quote.priceImpactBps,
    lpFeeUnits: entry.quote.feeTotal.lpFeeUnits,
    quoteId: String(quoteId),
  };
  const preparedAt = Date.now();
  const intentId = `${network.id}_i_${preparedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const bindingHash = await intentStore.bindingHashOf(plan, preparedAt, intentId);
  const record = {
    intentId,
    kind: INTENT_KIND_DEX_SWAP,
    status: 'prepared',
    plan,
    bindingHash,
    clientRequestId: clientRequestId ?? null,
    fee: { supported: true, note: 'swap LP fee included in quote', lpFeeUnits: plan.lpFeeUnits },
    unsignedTxs: null, // a swap is built+signed at submit; nothing unsigned is stored
    context: { networkId: network.id },
    signature: null,
    submitId: null,
    errorCode: null,
    errorMessage: null,
    resumable: false,
    ttlMs: intentStore.INTENT_TTL_MS,
    preparedAt,
    updatedAt: preparedAt,
    expiresAt: preparedAt + intentStore.INTENT_TTL_MS,
    reason: null,
  };
  const landed = await intentStore.upsert(network.id, intentId, () => record);
  return reviewDexSwap(landed);
}

// ---- Swap execution (registered into the intent pipeline) --------------------------------
// Signed at submit (auth:'signing' on dex.prepareSwap per the wire), executed against the
// RECORDED plan. All bounds re-verified against the FRESH chain state at execution: reserves
// may have moved; minAmountOut is re-asserted on-chain by the program too.

async function executeDexSwap(record) {
  gateOrThrow(GATES.prepareSwap); // env:'error' — defense-in-depth: submit re-checks the flag gate

  const plan = record.plan;
  const payer = await vault.getActiveAccount();
  if (!payer?.address) throw errCode('ACCOUNT_MISSING', 'no active account', false, { keepCode: true });
  try {
    await assertSendContext({ fromAddress: plan.fromAddress, networkId: plan.networkId }, payer);
  } catch (e) {
    e.keepCode = true;
    throw e;
  }

  // Fresh pool state + reserves at execute time — the reviewed quote's reserve snapshot is a
  // review fact, not an execution assumption.
  let state;
  try {
    state = await readPoolState(plan.poolId);
  } catch {
    throw errCode('RPC_UNAVAILABLE', 'chain unreadable — try again', true, { keepCode: true });
  }
  if (state.state !== 'ok') {
    throw errCode('POOL_UNAVAILABLE', `pool ${plan.poolId.slice(0, 12)}… is not readable/initialized on-chain right now`, false, { keepCode: true });
  }
  const dir = amm.resolveDirection(state.pool, plan.inputMint, plan.outputMint);
  if (!dir) {
    throw errCode('PAIR_MISMATCH', 'the pool no longer matches the reviewed asset pair', false, { keepCode: true });
  }
  const reserves = await readReserves(state.pool.vaultOne, state.pool.vaultTwo).catch(() => null);
  if (reserves) {
    const [reserveIn, reserveOut] = dir.inputIndex === 1
      ? [reserves.reserveOne, reserves.reserveTwo]
      : [reserves.reserveTwo, reserves.reserveOne];
    let freshOut = 0n;
    try {
      freshOut = BigInt(amm.quoteSwapExactIn({
        amountIn: plan.inputAmountUnits, reserveIn, reserveOut, swapFeeBps: state.pool.swapFeeBps,
      }).amountOut);
    } catch { freshOut = 0n; }
    if (freshOut < BigInt(plan.minOutputUnits)) {
      throw errCode('SWAP_STALE',
        'the pool moved beyond your slippage bound since the review — re-quote and prepare again',
        false, { keepCode: true });
    }
  } // reserves unreadable: proceed — the program's own minAmountOut bound is the honest backstop

  // User token accounts: input must hold ≥ amountIn; output must EXIST (this slice does not
  // auto-create token accounts — JIT account creation is flagged honest-future work).
  const inputBal = await chain.tokenBalanceOf(payer.address, plan.inputMint).catch(() => null);
  if (!inputBal?.exists) {
    throw errCode('TOKEN_ACCOUNT_MISSING', `no token account for ${plan.inputMint.slice(0, 12)}… on the active account`, false, { keepCode: true });
  }
  if (inputBal.amount == null || BigInt(inputBal.amount) < BigInt(plan.inputAmountUnits)) {
    throw errCode('INSUFFICIENT_BALANCE', 'input token balance is below the reviewed input amount', false, { keepCode: true });
  }
  const outputBal = await chain.tokenBalanceOf(payer.address, plan.outputMint).catch(() => null);
  if (!outputBal?.exists) {
    throw errCode('TOKEN_ACCOUNT_MISSING',
      `no output token account for ${plan.outputMint.slice(0, 12)}… — this slice does not auto-create token accounts; receive path unavailable`,
      false, { keepCode: true });
  }

  const network = await getActiveNetworkConfig();
  const headerFields = autoUnits({
    kind: UNIT_CLASS.SWAP,
    bytes: 320,
    accounts: 6,
    balanceUnits: inputBal.amount != null ? BigInt(inputBal.amount) : 0n,
    maxStateUnitsPerBlock: network?.maxStateUnitsPerBlock ?? undefined,
  });

  const client = thruClient.getClient();
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: { publicKey: payer.publicKey, privateKey: payer.privateKey },
    program: amm.AMM_PROGRAM_ADDRESS,
    header: { ...headerFields },
    accounts: {
      readWrite: [plan.poolId, inputBal.tokenAccount, outputBal.tokenAccount, dir.vaultIn, dir.vaultOut, state.pool.lpMint],
      readOnly: [network.tokenProgramId],
    },
    instructionData: amm.createSwapInstruction({
      poolAccountBytes: amm.addressToBytes(plan.poolId),
      userTransferAuthorityBytes: amm.addressToBytes(payer.address),
      userInputAccountBytes: amm.addressToBytes(inputBal.tokenAccount),
      userOutputAccountBytes: amm.addressToBytes(outputBal.tokenAccount),
      vaultInputAccountBytes: amm.addressToBytes(dir.vaultIn),
      vaultOutputAccountBytes: amm.addressToBytes(dir.vaultOut),
      lpMintAccountBytes: amm.addressToBytes(state.pool.lpMint),
      tokenProgramAccountBytes: amm.addressToBytes(network.tokenProgramId),
      amountIn: BigInt(plan.inputAmountUnits),
      minAmountOut: BigInt(plan.minOutputUnits),
    }),
  });

  // Track + await honestly (same sendAndTrack lineage as tx-service's proven flows).
  let sent = null;
  let result = null;
  for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
    if (update?.signature?.value && sent === null) {
      sent = update.signature.value;
      await pending.track({
        signature: sent,
        kind: 'dex-swap',
        from: payer.address,
        to: plan.poolId,
        amountUnits: plan.inputAmountUnits,
        displayAmount: `${plan.inputAmountUnits} → ≥${plan.minOutputUnits} base units`,
        networkId: plan.networkId,
      }).catch(() => null);
    }
    if (update?.executionResult) {
      noteExecution(UNIT_CLASS.SWAP, update.executionResult);
      if (update.executionResult.vmError === 0) {
        result = { signature: sent };
        break;
      }
      const userCode = Number(update.executionResult.userErrorCode ?? 0);
      const label = userCode ? amm.describeAmmError(userCode) : null;
      throw errCode('SWAP_REVERTED',
        `Swap reverted on-chain (vmError=${update.executionResult.vmError}${userCode ? `, AMM error ${userCode}${label ? ` — ${label}` : ''}` : ''}).`,
        false, { keepCode: true });
    }
  }
  if (!result) {
    throw errCode('TX_RESULT_MISSING', 'swap never returned an execution result (timed out?)', true, { keepCode: true });
  }
  return result;
}

// Register the kind driver at module load — the api-router imports this module, making the
// registration happen exactly when the wire handlers land.
intentService.registerKindDriver(INTENT_KIND_DEX_SWAP, {
  review: reviewDexSwap,
  execute: executeDexSwap,
});

// ---- Liquidity (R2: exit-before-entry) ------------------------------------------------------
/**
 * Quote for add/remove liquidity. ADD stays disabled until REMOVE verifies live; the wire
 * shape is kept but the honest reason says WHICH side is gated and why.
 */
export async function quoteLiquidity({ address, poolId, mode, amounts, slippageBps } = {}) {
  const gate = gateOrThrow(GATES.quoteLiquidity);
  if (gate.proceed === false) return gate.data;
  const m = String(mode ?? '').toLowerCase();
  if (m === 'add' || m === 'deposit') {
    return unsupported('Disabled until remove-liquidity verifies live (exit-before-entry, R2).');
  }
  return unsupported('Removing liquidity is not yet service-verified on betanet — the LP position view is the honest surface today.');
}

/** dex.prepareLiquidity — INTENT tier; both sides stay NOT_READY until R2's exit rung lands. */
export async function prepareLiquidity({ quoteId, clientRequestId } = {}) {
  gateOrThrow(GATES.prepareLiquidity); // env:'error' — gate-off throws FEATURE_DISABLED
  throw errCode('NOT_READY', 'Liquidity intents are exit-first: removing liquidity is verified before adding is enabled (R2).');
}

// ---- Readiness (no contract bump; same test-status vocabulary as the stub) -----------------
export async function readiness() {
  const base = { testedAt: new Date().toISOString(), testBasis: 'service-tests' };
  return {
    swap: { status: 'coming', ...base },
    pools: { status: 'coming', ...base },
  };
}

// Intent identity (used by the api-router's pipeline copy rows)
export const DEX_INTENT_KINDS = Object.freeze({ SWAP: INTENT_KIND_DEX_SWAP });
