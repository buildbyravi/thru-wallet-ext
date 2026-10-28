#!/usr/bin/env node
// Shared transaction-review system (contract v29) — the wallet-core pipeline.
//
// Proves, in order:
//   [0] the decoder registry is the ONLY operation-type table, and it agrees with the
//       background kind table in both directions (no decoder without a submit path, no
//       submit path without a decoder, no duplicate registrations);
//   [1] every shipped decoder produces a review that passes the wire validator, with exact
//       base-unit amounts, a null post-transaction balance, and warnings that say only what
//       the facts support (proven failure blocks; "could not read" does not);
//   [2] unknown operation types get an explicit unsupported answer and raw/undecodable
//       transactions get a decode:'unknown' review that cannot be signed;
//   [3] tx.prepareReview reads the same chain facts the features read, and the envelope
//       carries network, account, fee provenance, simulation status and submit policy;
//   [4] tx.confirmReview is a real revalidation gate: binding hash, TTL, active account,
//       active network, acknowledgements, then the EXACT submit instructions;
//   [5] the review pipeline never signs: no review method is in the signing allowlist, and
//       confirmation only returns a method name for the existing handler.
//
// Chain access is stubbed at the SDK client boundary exactly like test-api-router.mjs, so no
// network is touched and nothing here claims to be a live-chain result.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---- chrome.storage shim ---------------------------------------------------------------

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
const { Pubkey } = await import('@thru/sdk');
const thruClient = await import('../src/lib/thru-client.js');
const { METHODS, ERROR_CODES } = await import('../src/shared/contract/manifest.js');
const { SCOPED_KEYS } = await import('../src/shared/network-scope.js');
const model = await import('../src/shared/tx-review/model.js');
const registry = await import('../src/shared/tx-review/registry.js');
const kindTable = await import('../src/background/services/review/kinds.js');
const reviewStore = await import('../src/background/services/review/store.js');
const pending = await import('../src/background/services/pending-tx-service.js');
const networksModule = await import('../src/lib/networks.js');

let checks = 0;
function ok(label, condition = true, detail = '') {
  checks += 1;
  assert.ok(condition, `${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ok - ${label}`);
}

const asAddress = (byte) => Pubkey.from(new Uint8Array(32).fill(byte)).toThruFmt();
const SELF = null; // filled after wallet.create

console.log('[0] registry discipline');
{
  const decoderKinds = registry.listDecoderKinds();
  ok('eight operation types ship a decoder', decoderKinds.length === 8, decoderKinds.join(','));
  ok('the registry and the background kind table agree',
    JSON.stringify(decoderKinds) === JSON.stringify(kindTable.listKinds()),
    `${decoderKinds.join(',')} vs ${kindTable.listKinds().join(',')}`);
  ok('kinds are lowercase kebab-case',
    decoderKinds.every((kind) => registry.KIND_PATTERN.test(kind)));
  assert.throws(() => registry.registerDecoder('native-send', () => ({})), /already registered/);
  assert.throws(() => registry.registerDecoder('Not Kebab', () => ({})), /lowercase-kebab-case/);
  assert.throws(() => registry.registerDecoder('good-kind', 'not a function'), /must be a function/);
  ok('a duplicate or malformed registration throws instead of shadowing a decoder');

  let unsupported = null;
  try {
    registry.decodeReview('swap', { network: {}, account: {}, facts: {} });
  } catch (error) {
    unsupported = error;
  }
  ok('an unregistered operation type is unsupported, never guessed',
    unsupported?.code === 'REVIEW_KIND_UNSUPPORTED');
}

// ---- facts fixtures shared by the decoder checks ----------------------------------------

const NETWORK = { id: 'betanet', label: 'Betanet', isTestnet: true, environment: 'testnet' };
const ACCOUNT = { address: asAddress(1), label: 'Main account' };
const SENDER = asAddress(1);
const RECIPIENT = asAddress(2);
const MINT = asAddress(3);

const nativeFacts = (overrides = {}) => ({
  fromAddress: SENDER,
  fromLabel: 'Main account',
  toAddress: RECIPIENT,
  recipientLabel: 'Ada',
  amountUnits: '100000000',
  recipient: { exists: true },
  balanceUnits: '1000000000',
  fee: { supported: true, feeUnits: '1', reserveUnits: '1000', source: 'measured', reason: null },
  duplicate: null,
  selfSend: false,
  transferProgramId: asAddress(4),
  networkId: 'betanet',
  networkLabel: 'Betanet',
  ...overrides,
});

const tokenFacts = (overrides = {}) => ({
  fromAddress: SENDER,
  fromLabel: 'Main account',
  toAddress: RECIPIENT,
  recipientLabel: null,
  mintAddress: MINT,
  symbol: 'SMK',
  name: 'Smoke token',
  decimals: 8,
  metadataVerified: true,
  metadataSource: 'mint-account',
  mintExists: true,
  amountUnits: '1000000',
  recipient: { exists: true },
  sourceTokenAccount: { address: asAddress(5), exists: true },
  recipientTokenAccount: { address: asAddress(6), exists: true },
  balanceUnits: '5000000',
  fee: { supported: false, reason: 'no measurement', feeUnits: null, reserveUnits: null, source: null },
  duplicate: null,
  tokenProgramId: asAddress(7),
  networkId: 'betanet',
  networkLabel: 'Betanet',
  ...overrides,
});

const registryProgram = { name: 'Thru `.thru` name registrar', address: asAddress(8), verified: true, source: 'pinned' };
const payment = { mintAddress: MINT, symbol: 'USDX', name: 'Usd', decimals: 6, verified: true };

const domainFacts = (overrides = {}) => ({
  fromAddress: SENDER,
  fromLabel: 'Main account',
  name: 'alice',
  tld: 'thru',
  years: 2,
  provider: 'custom',
  pricePerYear: '1000',
  totalPriceUnits: '2000',
  nativeBalanceUnits: '5000000',
  availability: { state: 'available', readError: null },
  root: asAddress(9),
  configAddress: asAddress(10),
  treasury: asAddress(11),
  program: { name: 'Custom `.thru` registrar', address: asAddress(12), verified: true, source: 'pinned' },
  instruction: { name: 'Register domain', opcode: 1 },
  feeReserveUnits: '1000',
  feeNote: null,
  networkId: 'betanet',
  networkLabel: 'Betanet',
  ...overrides,
});

const paidFacts = (overrides = {}) => ({
  ...domainFacts(),
  provider: 'registry',
  pricePerYear: '1000000',
  totalPriceUnits: '2000000',
  paymentBalanceUnits: '9000000',
  payment,
  nativeBalanceUnits: null,
  lease: { owner: SENDER, endTime: '1731536000', expiredHint: false, mine: true },
  leaseExists: true,
  domainExists: true,
  nameServiceProgram: asAddress(13),
  program: registryProgram,
  instruction: { name: 'Purchase domain', opcode: 1 },
  ...overrides,
});

const decode = (kind, facts) => registry.decodeReview(kind, { network: NETWORK, account: ACCOUNT, facts });
const warningIds = (content) => content.warnings.map((warning) => warning.id);

console.log('[1] decoders: exact amounts, honest warnings');
{
  const content = decode('native-send', nativeFacts());
  model.assertReviewContent(content);
  ok('a clean native send decodes with no warnings and a decoded state',
    content.warnings.length === 0 && content.operation.decode === 'decoded');
  ok('the outgoing amount is the exact base-unit string', content.assets.outgoing[0].amountUnits === '100000000');
  ok('the recipient address is shown in full, never only a nickname',
    content.summary.some((row) => row.value === RECIPIENT));
  ok('no post-transaction balance is fabricated', content.assets.balanceAfter === null);
  ok('the fee keeps its provenance', content.assets.fee.source === 'measured');
  ok('the state stays ready', model.stateFromWarnings(content.warnings) === 'ready');

  const unverified = decode('native-send', nativeFacts({ recipient: { exists: null } }));
  ok('an unreadable recipient warns without blocking',
    warningIds(unverified).includes('recipient-unverified')
      && model.stateFromWarnings(unverified.warnings) === 'ready');

  const absent = decode('native-send', nativeFacts({ recipient: { exists: false } }));
  ok('a proven-absent recipient blocks signing',
    warningIds(absent).includes('recipient-not-activated')
      && model.stateFromWarnings(absent.warnings) === 'blocked');

  const self = decode('native-send', nativeFacts({ selfSend: true }));
  ok('a self-transfer blocks signing', model.stateFromWarnings(self.warnings) === 'blocked');

  const poor = decode('native-send', nativeFacts({ balanceUnits: '1' }));
  ok('an amount above the balance blocks signing', warningIds(poor).includes('insufficient-balance'));

  const unmeasured = decode('native-send', nativeFacts({
    fee: { supported: false, feeUnits: null, reserveUnits: null, source: null, reason: 'not measured here' },
  }));
  ok('an unmeasured fee is an explicit unsupported fee, never a zero',
    unmeasured.assets.fee.supported === false
      && unmeasured.assets.fee.amountUnits === null
      && warningIds(unmeasured).includes('fee-unmeasured'));

  const duplicate = decode('native-send', nativeFacts({
    duplicate: { isDuplicate: true, isPending: false, elapsedMs: 12_000 },
  }));
  ok('a repeated transfer requires an explicit acknowledgement',
    duplicate.acknowledgements.length === 1
      && duplicate.acknowledgements[0].id === 'duplicate-transfer'
      && model.stateFromWarnings(duplicate.warnings) === 'ready');
}

console.log('[2] decoders: token transfers');
{
  const content = decode('token-transfer', tokenFacts());
  model.assertReviewContent(content);
  ok('a token transfer shows the mint, ticker and exact amount',
    content.summary.some((row) => row.value === MINT)
      && content.assets.outgoing[0].symbol === 'SMK');

  const firstTime = decode('token-transfer', tokenFacts({
    recipientTokenAccount: { address: asAddress(6), exists: false },
  }));
  ok('a first-time recipient exposes the second transaction and requires an acknowledgement',
    warningIds(firstTime).includes('recipient-token-account-created')
      && firstTime.acknowledgements.some((ack) => ack.id === 'recipient-token-account-created'));

  const unverified = decode('token-transfer', tokenFacts({ metadataVerified: false }));
  ok('unverified token metadata is marked, not silently trusted',
    unverified.assets.outgoing[0].verified === false
      && warningIds(unverified).includes('metadata-unverified')
      && model.stateFromWarnings(unverified.warnings) === 'ready');

  const absent = decode('token-transfer', tokenFacts({ mintExists: false }));
  ok('an absent mint blocks signing', model.stateFromWarnings(absent.warnings) === 'blocked');

  const noAccount = decode('token-transfer', tokenFacts({
    sourceTokenAccount: { address: asAddress(5), exists: false },
  }));
  ok('a missing source token account blocks signing',
    warningIds(noAccount).includes('source-token-account-missing'));
}

console.log('[3] decoders: domain writes');
{
  const register = decode('domain-register', domainFacts());
  model.assertReviewContent(register);
  ok('registration quotes the chain-read price and totals exactly',
    register.summary.some((row) => row.label === 'Total charge' && row.value === '0.000002 THRU')
      && register.assets.outgoing[0].amountUnits === '2000');

  const taken = decode('domain-register', domainFacts({ availability: { state: 'taken', readError: null } }));
  ok('a taken name blocks signing', model.stateFromWarnings(taken.warnings) === 'blocked');

  const unknown = decode('domain-register', domainFacts({ availability: { state: 'unknown', readError: 'rpc' } }));
  ok('an unverifiable name blocks signing (never defaults to available)',
    model.stateFromWarnings(unknown.warnings) === 'blocked');

  const poor = decode('domain-register', domainFacts({ nativeBalanceUnits: '1' }));
  ok('an unaffordable registration fee blocks signing', warningIds(poor).includes('insufficient-native'));

  const purchase = decode('domain-purchase', paidFacts());
  ok('a purchase pays in the registry token with its own scale',
    purchase.assets.outgoing[0].symbol === 'USDX'
      && purchase.assets.outgoing[0].decimals === 6
      && purchase.assets.fee.amountUnits === '0');

  const renew = decode('domain-renew', paidFacts({ instruction: { name: 'Renew lease', opcode: 2 } }));
  ok('a renewal does not invent the new expiry',
    renew.summary.some((row) => row.label === 'New expiry'
      && /not computed here/.test(row.value)));

  const foreign = decode('domain-renew', paidFacts({
    lease: { owner: RECIPIENT, endTime: '1731536000', expiredHint: false, mine: false },
    availability: { state: 'taken', readError: null },
  }));
  ok('renewing someone else\'s lease blocks signing',
    model.stateFromWarnings(foreign.warnings) === 'blocked');

  const active = decode('domain-claim', paidFacts({
    instruction: { name: 'Claim expired lease', opcode: 3 },
    lease: { owner: RECIPIENT, endTime: '1731536000', expiredHint: false, mine: false },
    availability: { state: 'expired', readError: null },
  }));
  ok('claiming a still-active lease blocks signing', warningIds(active).includes('lease-still-active'));
}

console.log('[4] decoders: faucet claims and raw transactions');
{
  const claim = decode('faucet-claim', {
    fromAddress: SENDER,
    fromLabel: 'Main account',
    amountUnits: '10000',
    capUnits: '10000',
    accountExists: true,
    limit: {
      supported: true, paused: false, exhausted: false, remainingAmount: '10000',
      window: '3600', resetAtUnixSec: null,
    },
    fee: { supported: false, reason: 'not reported' },
    programAddress: asAddress(14),
    vaultAddress: asAddress(15),
    networkId: 'betanet',
    networkLabel: 'Betanet',
  });
  ok('a faucet claim is an incoming movement with no invented fee',
    claim.assets.incoming.length === 1 && claim.assets.outgoing.length === 0
      && claim.assets.fee.supported === false);

  const exhausted = decode('faucet-claim', {
    ...claim.fee, fromAddress: SENDER, amountUnits: '10000', capUnits: '10000', accountExists: true,
    limit: { supported: true, paused: false, exhausted: true, remainingAmount: '0', window: '3600', resetAtUnixSec: '1790000000' },
    fee: { supported: false, reason: 'not reported' }, programAddress: asAddress(14), networkId: 'betanet', networkLabel: 'Betanet',
  });
  ok('an exhausted faucet allowance blocks signing', warningIds(exhausted).includes('faucet-exhausted'));

  const raw = decode('raw', {
    programAddress: asAddress(16),
    programName: null,
    programVerified: false,
    programNote: null,
    dataHex: 'deadbeef',
    note: null,
    accounts: [{ role: 'Payer', address: SENDER }],
    networkId: 'betanet',
    networkLabel: 'Betanet',
  });
  ok('an undecodable transaction is labelled unknown, not given a friendly name',
    raw.operation.decode === 'unknown'
      && raw.operation.name === 'Unrecognized transaction'
      && raw.operation.confirmLabel === null);
  ok('an undecodable transaction blocks and cannot claim safety',
    model.stateFromWarnings(raw.warnings) === 'blocked'
      && warningIds(raw).includes('undecoded-transaction'));
  ok('raw instruction data is shown, not interpreted', raw.execution.raw?.format === 'hex');
}

console.log('[5] the wire validator rejects malformed reviews');
{
  const content = decode('native-send', nativeFacts());
  assert.throws(() => model.assertReviewContent({
    ...content, assets: { ...content.assets, balanceAfter: '5' },
  }), /must be null/);
  assert.throws(() => model.assertReviewContent({
    ...content, assets: { ...content.assets, outgoing: [{ ...content.assets.outgoing[0], amountUnits: '1.5' }] },
  }), /unsigned base-unit/);
  assert.throws(() => model.assertReviewContent({
    ...content, operation: { ...content.operation, decode: 'guessed' },
  }), /must be one of/);
  const envelope = {
    reviewVersion: model.TX_REVIEW_VERSION,
    reviewId: 'r1',
    kind: 'native-send',
    state: 'ready',
    bindingHash: 'h',
    createdAt: 1,
    expiresAt: 2,
    network: NETWORK,
    account: ACCOUNT,
    simulation: { status: 'unavailable', reason: 'none', provenance: 'test', checkedAt: 1 },
    submitPolicy: null,
    ...content,
  };
  assert.throws(() => model.assertReview(envelope), /may only be null for a blocked review/);
  ok('a malformed review is a programming error, not something the UI must survive');
}

console.log('[6] review methods are not signing methods');
{
  ok('tx.prepareReview / confirmReview / discardReview are declared',
    ['tx.prepareReview', 'tx.confirmReview', 'tx.discardReview']
      .every((name) => METHODS[name]?.since === 29));
  ok('no review method signs',
    ['tx.prepareReview', 'tx.confirmReview', 'tx.discardReview']
      .every((name) => METHODS[name].auth === 'unlocked'));
  ok('no review method claims signing or password auth',
    ['tx.prepareReview', 'tx.confirmReview', 'tx.discardReview']
      .every((name) => METHODS[name].auth === 'unlocked'));
  ok('prepared reviews are network-scoped', SCOPED_KEYS.includes('tx_reviews'));
}

// ---- the real service, with the SDK client stubbed (no network) -------------------------

const wallet = await handleApiRequest({ method: 'wallet.create', params: { password: 'Password123!' } });
assert.equal(wallet.ok, true, wallet.error?.message);
const ACTIVE = wallet.data.address;

let chain = new Map();
function setChain(entries) {
  chain = new Map(entries);
}
// Switching network drops the memoized SDK client, so the stub is re-installed on whatever
// client is current rather than captured once.
function installChainStub() {
  thruClient.getClient().accounts.get = async (address) => {
    if (!chain.has(address)) {
      const err = new Error('account not found');
      err.code = 5;
      throw err;
    }
    return { meta: { balance: chain.get(address) } };
  };
}
installChainStub();

// A second account so an account switch mid-review is testable.
const second = await handleApiRequest({ method: 'account.addHd' });
assert.equal(second.ok, true, second.error?.message);
// addHd may switch the active account; the review tests start from the original one.
const accountList = await handleApiRequest({ method: 'account.list', params: { includeHidden: true } });
const FIRST_REF = accountList.data[0].ref;
const SECOND_REF = accountList.data[1].ref;
const backToFirst = await handleApiRequest({ method: 'account.switch', params: { ref: FIRST_REF } });
assert.equal(backToFirst.ok, true, backToFirst.error?.message);

console.log('[7] tx.prepareReview builds the canonical review');
let prepared;
{
  setChain([[ACTIVE, 5_000_000_000n], [RECIPIENT, 0n]]);
  const res = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'native-send', params: { toAddress: RECIPIENT, amountUnits: '100000000' } },
  });
  assert.equal(res.ok, true, res.error?.message);
  prepared = res.data;
  ok('prepare returns a review, binding and expiry',
    res.data.supported === true && Boolean(res.data.reviewId)
      && Boolean(res.data.bindingHash) && res.data.expiresAt > Date.now());
  const review = res.data.review;
  model.assertReview(review);
  ok('the review names its network and signing account',
    review.network.id === 'betanet' && review.account.address === ACTIVE);
  ok('the fee comes from the one fee source with provenance',
    review.assets.fee.supported === true
      && review.assets.fee.source === 'measured'
      && review.assets.fee.amountUnits === '1');
  ok('simulation is reported unavailable with its provenance, not faked',
    review.simulation.status === 'unavailable'
      && /tx\.simulate/.test(review.simulation.provenance)
      && review.assets.balanceAfter === null);
  ok('the submit policy names the existing signing method',
    review.submitPolicy.method === 'tx.sendChecked'
      && review.submitPolicy.auth === 'signing');
  ok('session-only signing stays the default (no password prompt required)',
    review.submitPolicy.passwordRequired === false);
}

console.log('[8] tx.confirmReview is a revalidation gate');
{
  const wrongBinding = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: prepared.reviewId, bindingHash: 'not-the-hash' },
  });
  ok('a mismatched binding is refused',
    wrongBinding.error?.code === 'BINDING_MISMATCH');

  const missing = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: 'betanet_r_nope', bindingHash: prepared.bindingHash },
  });
  ok('an unknown review id is refused', missing.error?.code === 'REVIEW_NOT_FOUND');

  const confirmed = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: prepared.reviewId, bindingHash: prepared.bindingHash },
  });
  assert.equal(confirmed.ok, true, confirmed.error?.message);
  ok('a fresh review returns the exact submit instructions',
    confirmed.data.submit.method === 'tx.sendChecked'
      && confirmed.data.submit.params.toAddress === RECIPIENT
      && confirmed.data.submit.params.amountUnits === '100000000'
      && confirmed.data.submit.params.fromAddress === ACTIVE
      && confirmed.data.submit.params.networkId === 'betanet');
  ok('confirming does not sign and does not consume the review',
    !('signature' in confirmed.data.submit.params)
      && (await handleApiRequest({
        method: 'tx.confirmReview',
        params: { reviewId: prepared.reviewId, bindingHash: prepared.bindingHash },
      })).ok === true);
}

console.log('[9] account, network and expiry changes invalidate a review');
{
  const switchAccount = await handleApiRequest({ method: 'account.switch', params: { ref: SECOND_REF } });
  assert.equal(switchAccount.ok, true, switchAccount.error?.message);
  const afterSwitch = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: prepared.reviewId, bindingHash: prepared.bindingHash },
  });
  assert.equal(afterSwitch.ok, false);
  ok('an account switch after review is refused',
    afterSwitch.error?.code === 'REVIEW_CONTEXT_CHANGED', afterSwitch.error?.code);
  await handleApiRequest({ method: 'account.switch', params: { ref: FIRST_REF } });

  const fresh = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'native-send', params: { toAddress: RECIPIENT, amountUnits: '100000000' } },
  });
  assert.equal(fresh.ok, true, fresh.error?.message);

  networksModule.NETWORKS.localnet.enabled = true;
  const switchedNetwork = await handleApiRequest({
    method: 'network.setActive', params: { networkId: 'localnet' },
  });
  assert.equal(switchedNetwork.ok, true, switchedNetwork.error?.message);
  const onOtherChain = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: fresh.data.reviewId, bindingHash: fresh.data.bindingHash },
  });
  ok('a review prepared on one network cannot be confirmed on another',
    onOtherChain.error?.code === 'REVIEW_NOT_FOUND', onOtherChain.error?.code);
  await handleApiRequest({ method: 'network.setActive', params: { networkId: 'betanet' } });
  networksModule.NETWORKS.localnet.enabled = false;
  installChainStub();

  const expiring = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'native-send', params: { toAddress: RECIPIENT, amountUnits: '100000000' } },
  });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + model.TX_REVIEW_TTL_MS + 1_000;
    const expired = await handleApiRequest({
      method: 'tx.confirmReview',
      params: { reviewId: expiring.data.reviewId, bindingHash: expiring.data.bindingHash },
    });
    ok('an expired review is refused with a retryable reason',
      expired.error?.code === 'REVIEW_EXPIRED' && expired.error?.retryable === true);
  } finally {
    Date.now = realNow;
  }
}

console.log('[10] acknowledgements are enforced and reach the handler');
{
  await pending.track({
    signature: 'sig_review_duplicate_fixture',
    kind: 'transfer',
    from: ACTIVE,
    to: RECIPIENT,
    amountUnits: '100000000',
    networkId: 'betanet',
  });

  const dup = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'native-send', params: { toAddress: RECIPIENT, amountUnits: '100000000' } },
  });
  assert.equal(dup.ok, true, dup.error?.message);
  ok('a repeat of a pending transfer surfaces the acknowledgement',
    dup.data.review.acknowledgements.some((ack) => ack.id === 'duplicate-transfer'));

  const blockedConfirm = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: dup.data.reviewId, bindingHash: dup.data.bindingHash },
  });
  ok('confirming without the acknowledgement is refused',
    blockedConfirm.error?.code === 'ACKNOWLEDGEMENT_REQUIRED');

  const acked = await handleApiRequest({
    method: 'tx.confirmReview',
    params: {
      reviewId: dup.data.reviewId,
      bindingHash: dup.data.bindingHash,
      acknowledgements: ['duplicate-transfer'],
    },
  });
  assert.equal(acked.ok, true, acked.error?.message);
  ok('an accepted acknowledgement reaches the signing method as allowDuplicate',
    acked.data.submit.params.allowDuplicate === true);

  storage.delete('thru_pending_txs::betanet');
}

console.log('[11] blocking facts block, and unexplained transactions cannot be signed');
{
  setChain([[ACTIVE, 5_000_000_000n]]); // recipient absent
  const blocked = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'native-send', params: { toAddress: RECIPIENT, amountUnits: '100000000' } },
  });
  assert.equal(blocked.ok, true, blocked.error?.message);
  ok('a proven-absent recipient produces a blocked review',
    blocked.data.review.state === 'blocked',
    `${blocked.data.review.state} warnings=${blocked.data.review.warnings.map((w) => `${w.id}:${w.blocking}`).join(',')} active=${blocked.data.review.account.address === ACTIVE}`);
  ok('a blocked review still names the signing method it would use',
    blocked.data.review.submitPolicy.method === 'tx.sendChecked');

  setChain([[ACTIVE, 5_000_000_000n], [RECIPIENT, 0n]]);
  const raw = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'raw', params: { programAddress: asAddress(20), dataHex: 'aabbcc' } },
  });
  assert.equal(raw.ok, true, raw.error?.message);
  ok('an undecodable transaction is blocked and has NO submit policy',
    raw.data.review.state === 'blocked' && raw.data.review.submitPolicy === null);
  const refused = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: raw.data.reviewId, bindingHash: raw.data.bindingHash },
  });
  ok('a display-only review can never be confirmed', refused.error?.code === 'NOT_EXECUTABLE');

  const unsupported = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'dex-swap', params: {} },
  });
  ok('an operation type with no decoder answers unsupported plus the known kinds',
    unsupported.ok === true
      && unsupported.data.supported === false
      && unsupported.data.reason === 'KIND_UNSUPPORTED'
      && unsupported.data.knownKinds.length === 8);

  const invented = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'native-send', params: { toAddress: 'not-an-address', amountUnits: '1' } },
  });
  ok('malformed intent input is refused before any read',
    invented.error?.code === 'INVALID_INPUT');

  const malformedRaw = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'raw', params: { programAddress: asAddress(21), dataHex: 'zz-not-hex' } },
  });
  ok('malformed raw instruction data is refused',
    malformedRaw.error?.code === 'INVALID_INPUT');

  const noKind = await handleApiRequest({ method: 'tx.prepareReview', params: {} });
  ok('a missing kind is refused', noKind.error?.code === 'INVALID_INPUT');
}

console.log('[12] discard drops a prepared review');
{
  setChain([[ACTIVE, 5_000_000_000n], [RECIPIENT, 0n]]);
  const res = await handleApiRequest({
    method: 'tx.prepareReview',
    params: { kind: 'native-send', params: { toAddress: RECIPIENT, amountUnits: '7' } },
  });
  assert.equal(res.ok, true, res.error?.message);
  const discarded = await handleApiRequest({
    method: 'tx.discardReview', params: { reviewId: res.data.reviewId },
  });
  ok('discard answers without touching the chain', discarded.ok === true);
  const after = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: res.data.reviewId, bindingHash: res.data.bindingHash },
  });
  ok('a discarded review can no longer be confirmed', after.error?.code === 'REVIEW_NOT_FOUND');
  await reviewStore.clear('betanet');
}

console.log('[13] the review error surface is declared in exactly one place');
{
  // Codes the review layer may throw: model.js owns the review-specific ones, the contract owns
  // the generic ones. This scan is the ratchet — a new `coded('X', …)` anywhere in the review
  // background must be registered, so `classifyReviewError` can never miss a stale case.
  const files = [
    '../src/background/services/review/kinds.js',
    '../src/background/services/review-service.js',
  ];
  const known = new Set([
    ...Object.keys(model.REVIEW_CODE),
    ...Object.keys(model.REVIEW_ERROR_CODES),
    ...Object.keys(ERROR_CODES),
  ]);
  const coined = new Set();
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const match of source.matchAll(/coded\(\s*'([A-Z_]+)'/g)) coined.add(match[1]);
    for (const match of source.matchAll(/coded\(\s*REVIEW_ERROR_CODES\.([A-Z_]+)/g)) coined.add(match[1]);
  }
  ok('the review layer coins codes and the scan finds them', coined.size >= 10, `${coined.size} codes`);
  const unregistered = [...coined].filter((code) => !known.has(code)).sort();
  ok('every code the review layer throws is registered in model.js or the contract',
    unregistered.length === 0, unregistered.join(','));

  // The stale set must cover every "the thing you reviewed moved" code, and nothing else.
  const stale = new Set(model.STALE_REVIEW_CODES);
  for (const code of ['REVIEW_FEE_CHANGED', 'REVIEW_TOKEN_CHANGED', 'REVIEW_PRICE_CHANGED',
    'REVIEW_EXPIRY_CHANGED', 'REVIEW_REGISTRAR_CHANGED', 'REVIEW_FAUCET_CHANGED',
    'NAME_TAKEN', 'LEASE_NOT_FOUND', 'LEASE_NOT_EXPIRED', 'NOT_NAME_OWNER',
    'REVIEW_NOT_FOUND', 'REVIEW_EXPIRED', 'BINDING_MISMATCH', 'REVIEW_CONTEXT_CHANGED']) {
    ok(`'${code}' forces a re-read before signing`, stale.has(code));
  }
  ok('a plain failure is not classified as stale',
    !stale.has('INVALID_INPUT') && !stale.has('INTERNAL') && !stale.has('UNSUPPORTED'));
}

console.log(`\nAll tx-review checks passed: ${checks}/${checks}.`);
console.log('No network was contacted: the SDK account read was stubbed at the client boundary.');
