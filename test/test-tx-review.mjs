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
import { readFileSync, readdirSync } from 'node:fs';

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
  ok('nine operation types ship a decoder', decoderKinds.length === 9, decoderKinds.join(','));
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
  // The DEPLOYED program runs best-effort: it attempts the charge and ignores a refusal.
  // Facts that describe a strict deployment set this to true explicitly.
  feeEnforced: false,
  feePolicy: 'best effort',
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

const claimFacts = {
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
};

const decode = (kind, facts) => registry.decodeReview(kind, { network: NETWORK, account: ACCOUNT, facts });
const warningIds = (content) => content.warnings.map((warning) => warning.id);

console.log('[1] decoders: exact amounts, honest warnings');
{
  const content = decode('native-send', nativeFacts());
  model.assertReviewContent(content);
  ok('a clean native send decodes with no warnings and a decoded state',
    content.warnings.length === 0 && content.operation.decode === 'decoded');
  ok('the outgoing amount is the exact base-unit string', content.assets.outgoing[0].amountUnits === '100000000');
  // The card shows a shortened address on the counterparty line and the whole one behind it,
  // so the assertion is about the DATA carrying the full address, in the place the card reads
  // it from, plus the account table that always prints it in full.
  ok('the recipient address is carried in full, never only a nickname',
    content.counterparty?.address === RECIPIENT
      && content.execution.accounts.some((account) => account.address === RECIPIENT));
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
  // The money table says "not confirmed (paid in THRU)" on its own. A second warning saying
  // the same thing was pure duplication, so the fee is now stated once, in the row that owns it.
  ok('an unmeasured fee is an explicit unsupported fee, never a zero, and is said once',
    unmeasured.assets.fee.supported === false
      && unmeasured.assets.fee.amountUnits === null
      && !warningIds(unmeasured).includes('fee-unmeasured')
      && Boolean(unmeasured.assets.fee.note));

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
  // The mint is a fact about the token, not about this transfer: it moved from a table row to
  // the outgoing asset (which carries it in Details) and the ticker stays in the title.
  ok('a token transfer carries the mint, ticker and exact amount',
    content.assets.outgoing[0].mintAddress === MINT
      && content.assets.outgoing[0].symbol === 'SMK'
      && content.assets.outgoing[0].amountUnits === '1000000');

  const firstTime = decode('token-transfer', tokenFacts({
    recipientTokenAccount: { address: asAddress(6), exists: false },
  }));
  ok('a first-time recipient exposes the second transaction and requires an acknowledgement',
    warningIds(firstTime).includes('recipient-token-account-created')
      && firstTime.acknowledgements.some((ack) => ack.id === 'recipient-token-account-created'));

  const impersonating = decode('token-transfer', tokenFacts({ symbol: 'THRU', name: 'Thru (fake)' }));
  ok('a token ticker that claims to be native THRU is called out, not rendered as a native send',
    warningIds(impersonating).includes('symbol-impersonation')
      && impersonating.assets.outgoing[0].mintAddress === MINT
      && /not native THRU/i.test(impersonating.warnings
        .find((w) => w.id === 'symbol-impersonation')?.title ?? ''),
    JSON.stringify(warningIds(impersonating)));

  const unverified = decode('token-transfer', tokenFacts({ metadataVerified: false }));
  ok('unverified token metadata is marked, not silently trusted',
    unverified.assets.outgoing[0].verified === false
      && warningIds(unverified).includes('metadata-unverified')
      && model.stateFromWarnings(unverified.warnings) === 'ready');

  const noProgram = decode('native-send', nativeFacts({ transferProgramId: null }));
  ok('no pinned transfer program is not rendered as a verified program',
    noProgram.protocol.verified === false
      && warningIds(noProgram).includes('program-unidentified')
      && model.stateFromWarnings(noProgram.warnings) === 'blocked');

  const absent = decode('token-transfer', tokenFacts({ mintExists: false }));
  ok('a proven-absent mint blocks signing', model.stateFromWarnings(absent.warnings) === 'blocked');

  // Audit F-03: an RPC failure is not proof of absence. The first version said "does not
  // exist" for `mintExists: null`, turning an outage into an authoritative chain statement.
  const unreadMint = decode('token-transfer', tokenFacts({ mintExists: null }));
  ok('an unreadable mint is "could not verify", never "does not exist"',
    warningIds(unreadMint).includes('mint-unverified')
      && !warningIds(unreadMint).includes('mint-absent')
      && model.stateFromWarnings(unreadMint.warnings) === 'ready',
    unreadMint.warnings.map((w) => w.title).join(' | '));

  const noAccount = decode('token-transfer', tokenFacts({
    sourceTokenAccount: { address: asAddress(5), exists: false },
  }));
  ok('a missing source token account blocks signing',
    warningIds(noAccount).includes('source-token-account-missing'));
}

console.log('[2b] the name a recipient was resolved from reaches the review');
{
  // Audit D-2 (2026-10-28): the Send route learned to resolve `alice.thru` to an address and
  // passed the name into tx.prepareReview, and both send kinds threw it away — so the card
  // showed a bare address the user could not connect to what they typed.
  // The name and the exact address now travel together in `counterparty` (v1.5 card): the card
  // prints the name with the shortened address beside it and the whole address behind a tap.
  const named = decode('native-send', nativeFacts({ recipientLabel: 'alice.thru' }));
  ok('a name-resolved native send carries the name AND the exact address',
    named.counterparty?.label === 'alice.thru' && named.counterparty?.address === RECIPIENT,
    JSON.stringify(named.counterparty));

  const namedToken = decode('token-transfer', tokenFacts({ recipientLabel: 'alice.thru' }));
  ok('a name-resolved token transfer carries the name AND the exact address',
    namedToken.counterparty?.label === 'alice.thru' && namedToken.counterparty?.address === RECIPIENT);

  // Negative control: no label means no invented one.
  const unnamed = decode('native-send', nativeFacts({ recipientLabel: null }));
  ok('without a name the counterparty carries the address alone',
    unnamed.counterparty?.address === RECIPIENT && unnamed.counterparty?.label === undefined);

  // The decoder rendering it is only half the path; the background is what drops a param.
  const kindsSource = readFileSync(new URL('../src/background/services/review/kinds.js', import.meta.url), 'utf8');
  ok('both send kinds read the route-provided recipient name',
    (kindsSource.match(/: resolvedRecipientLabel\(params\)/g) || []).length === 2);
  ok('the recipient name is bounded and display-only (never a resolution source)',
    /trimmed\.length > 120/.test(kindsSource) && !/recipientLabel.*lookupName/.test(kindsSource));
}

console.log('[3] decoders: domain writes');
{
  const register = decode('domain-register', domainFacts());
  model.assertReviewContent(register);
  // v1.5.0 (owner directive, Part 2.2): the deployed program does NOT collect its fee, so the
  // card promises no charge. With tiered pricing the price is real but unenforced, so the card
  // states the price AND states that it is not enforced — it does not call the registration
  // free (that would be a different lie) and does not put it in the money table.
  ok('an unenforced registrar price is never presented as money that moves',
    register.assets.outgoing.length === 0
      && !register.summary.some((row) => /total/i.test(row.label)),
    JSON.stringify({ rows: register.summary, out: register.assets.outgoing }));
  ok('an unenforced price is disclosed as unenforced, not as free',
    warningIds(register).includes('registrar-fee-unenforced')
      && !/No registration fee/.test(register.operation.summary),
    register.operation.summary);

  // A STRICT deployment is the case the tiered contract exists for: the price is charged.
  const enforced = decode('domain-register', domainFacts({ feeEnforced: true, feePolicy: 'strict' }));
  model.assertReviewContent(enforced);
  ok('a strict registrar puts the term price in the money table',
    enforced.assets.outgoing.length === 1
      && enforced.assets.outgoing[0].amountUnits === '2000'
      && enforced.assets.outgoing[0].symbol === 'THRU',
    JSON.stringify(enforced.assets.outgoing));
  ok('a strict registrar states the price plainly instead of promising it is free',
    /collects/.test(enforced.operation.summary)
      && !warningIds(enforced).includes('registrar-fee-unenforced'),
    enforced.operation.summary);
  const enforcedPoor = decode('domain-register', domainFacts({ feeEnforced: true, nativeBalanceUnits: '1' }));
  ok('a balance that cannot cover an ENFORCED fee blocks signing',
    warningIds(enforcedPoor).includes('registrar-fee-unpayable')
      && model.stateFromWarnings(enforcedPoor.warnings) === 'blocked');

  // A zero price is genuinely free, and says so.
  const free = decode('domain-register', domainFacts({ totalPriceUnits: '0', pricePerYear: '0' }));
  ok('a zero-priced registrar says the registration is free',
    free.assets.outgoing.length === 0 && /No registration fee/.test(free.operation.summary),
    free.operation.summary);
  ok('the title carries the name and the duration', register.operation.name === 'Register alice.thru for 2 years',
    register.operation.name);
  ok('the registrar is named in Details without a repository path',
    /Thru Wallet team/.test(register.protocol.trustNote || '')
      && !/src\/|docs\//.test(JSON.stringify(register)));

  const taken = decode('domain-register', domainFacts({ availability: { state: 'taken', readError: null } }));
  ok('a taken name blocks signing', model.stateFromWarnings(taken.warnings) === 'blocked');

  const unknown = decode('domain-register', domainFacts({ availability: { state: 'unknown', readError: 'rpc' } }));
  ok('an unverifiable name blocks signing (never defaults to available)',
    model.stateFromWarnings(unknown.warnings) === 'blocked');

  // Unenforced: a low balance is disclosed, not treated as a proven blocker — the program
  // would still register the name.
  const poor = decode('domain-register', domainFacts({ nativeBalanceUnits: '1' }));
  ok('a low balance is disclosed without inventing a fee that is not charged',
    warningIds(poor).includes('registrar-balance-check')
      && model.stateFromWarnings(poor.warnings) === 'ready');

  const purchase = decode('domain-purchase', paidFacts({ treasury: asAddress(17) }));
  ok('a purchase pays in the registry token with its own scale',
    purchase.assets.outgoing[0].symbol === 'USDX'
      && purchase.assets.outgoing[0].decimals === 6
      && purchase.assets.fee.amountUnits === '0');
  // Audit F-10: kinds.js emitted `treasurer` while the decoder read `treasury`, so the real
  // config address rendered as "unknown".
  ok('the registry treasurer address reaches the execution accounts',
    purchase.execution.accounts.some((entry) => entry.role === 'Treasury'
      && entry.address === asAddress(17)),
    JSON.stringify(purchase.execution.accounts));

  const renew = decode('domain-renew', paidFacts({ instruction: { name: 'Renew lease', opcode: 2 } }));
  ok('a renewal does not invent the new expiry',
    renew.summary.some((row) => row.label === 'New expiry'
      && /after the network confirms/.test(row.value)), JSON.stringify(renew.summary));

  // Audit D-1 (2026-10-28): the custom-registrar renewal had no decoder branch, so it fell
  // through to the registry rows and printed "2000 TOKEN" for 2,000 base units of THRU; the
  // branch that was supposed to cover it lived in the PURCHASE decoder, crashed with a
  // ReferenceError, and could never be reached by the background anyway.
  const customRenewFacts = {
    ...domainFacts(),
    availability: { state: 'mine', readError: null },
    lease: { owner: SENDER, endTime: '1795000000', expiredHint: false, mine: true },
    instruction: { name: 'Renew domain lease', opcode: 2 },
  };
  const customRenew = decode('domain-renew', customRenewFacts);
  model.assertReviewContent(customRenew);
  // Part 2.2: no price, no "you pay" row, and no "best-effort" hedge for a fee the deployed
  // program never collects. The renewal says the same things a registration does.
  ok('a custom-registrar renewal promises no fee and names no token',
    customRenew.assets.outgoing.length === 0
      && !/TOKEN|THRU fee/.test(JSON.stringify(customRenew.summary))
      && /No registration fee/.test(customRenew.operation.summary),
    JSON.stringify({ out: customRenew.assets.outgoing, rows: customRenew.summary }));
  ok('a custom-registrar renewal names the custom registrar, not the paid registry',
    customRenew.protocol.name === 'Custom `.thru` registrar' && customRenew.protocol.verified === true,
    customRenew.protocol.name);
  ok('a custom-registrar renewal replaces the old best-effort hedge with a plain statement',
    !warningIds(customRenew).includes('quote-not-final'));

  const poorRenew = decode('domain-renew', { ...customRenewFacts, nativeBalanceUnits: '1' });
  ok('a custom-registrar renewal with a low balance informs instead of inventing a debt',
    model.stateFromWarnings(poorRenew.warnings) === 'ready'
      && warningIds(poorRenew).includes('registrar-balance-check'));

  // A decoder must survive facts a different provider would produce: the ReferenceError above
  // was inside a branch no test had ever executed, and it shipped.
  const crossProvider = ['domain-purchase', 'domain-claim', 'domain-renew']
    .map((kind) => decode(kind, { ...paidFacts(), provider: 'custom' }));
  ok('no domain decoder throws, or names a currency it is not charging, for an unexpected provider',
    crossProvider.every((content) => content.assets.outgoing.every((asset) => asset.symbol !== 'TOKEN')
      && !content.summary.some((row) => row.label === 'Payment token')));

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

  const recFacts = (overrides = {}) => ({
    name: 'alice',
    tld: 'thru',
    key: 'twitter',
    value: '@alice',
    domainAddress: asAddress(10),
    domainExists: true,
    isOwner: true,
    ownerAddress: ACCOUNT.address,
    unchanged: false,
    keyProblem: null,
    valueProblem: null,
    program: {
      name: 'Thru Name Service',
      address: asAddress(20),
      verified: true,
      source: 'Pinned system program at BOOTSTRAP_PROGRAM_ADDRESSES.name_service',
    },
    ...overrides,
  });

  const recordReview = decode('domain-record', recFacts());
  model.assertReviewContent(recordReview);
  ok('domain-record decodes with summary and zero fee',
    recordReview.summary.some((row) => row.label === 'Record Key' && row.value === 'twitter')
      && recordReview.assets.fee.amountUnits === '0');

  const notOwnerRec = decode('domain-record', recFacts({ isOwner: false }));
  ok('setting record on someone else domain blocks signing',
    model.stateFromWarnings(notOwnerRec.warnings) === 'blocked'
      && warningIds(notOwnerRec).includes('not-name-owner'));

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

  // Audit F-07: unknown account state was rendered as "will be activated", and a rate-limit
  // policy pointing at another program was silently ignored.
  const unknownAccount = decode('faucet-claim', {
    ...claimFacts, accountExists: null,
  });
  ok('an unreadable account state does not promise an activation step',
    warningIds(unknownAccount).includes('account-state-unverified')
      && !warningIds(unknownAccount).includes('account-activation')
      && model.stateFromWarnings(unknownAccount.warnings) === 'ready');
  const mismatch = decode('faucet-claim', {
    ...claimFacts,
    limit: { ...claimFacts.limit, targetMatchesFaucet: false, reason: 'the policy targets a different faucet program' },
  });
  ok('a faucet policy that targets another program blocks the claim',
    warningIds(mismatch).includes('faucet-target-mismatch')
      && model.stateFromWarnings(mismatch.warnings) === 'blocked');

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
      && raw.operation.name === 'Unrecognised transaction'
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

  // Audit F-11: "verified" is a claim about an address, so the pair is enforced structurally.
  assert.throws(() => model.assertReviewContent({
    ...content,
    protocol: { ...content.protocol, address: null, verified: true },
  }), /must be present when protocol\.verified is true/);
  assert.throws(() => model.assertReviewContent({
    ...content,
    execution: { ...content.execution, program: { ...content.execution.program, address: null, verified: true } },
  }), /must be present when execution\.program\.verified is true/);

  // State and warnings must agree: "blocked" is only ever a proven fact, and a ready review
  // cannot quietly carry a blocking warning (audit F-04's invariant).
  const readyWithBlocking = {
    ...envelope,
    state: 'ready',
    submitPolicy: { method: 'tx.sendChecked', auth: 'signing', passwordRequired: true },
    warnings: [{ id: 'x', severity: 'danger', title: 'x', detail: '', blocking: true }],
  };
  assert.throws(() => model.assertReview(readyWithBlocking), /may not carry a blocking warning/);
  assert.throws(() => model.assertReview({ ...envelope, state: 'blocked', warnings: [] }), /must carry at least one blocking warning/);

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

  // Audit F-02/F-04: the disabled button is UI. The background gate must refuse a blocked
  // review too, including one blocked by a failed simulation.
  const blockedConfirm = await handleApiRequest({
    method: 'tx.confirmReview',
    params: { reviewId: blocked.data.reviewId, bindingHash: blocked.data.bindingHash },
  });
  ok('a blocked review cannot be confirmed even if the UI is bypassed',
    blockedConfirm.error?.code === 'NOT_EXECUTABLE', JSON.stringify(blockedConfirm.error));

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
      && unsupported.data.knownKinds.length === 9);

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
    'NAME_TAKEN', 'NAME_NOT_FOUND', 'LEASE_NOT_FOUND', 'LEASE_NOT_EXPIRED', 'NOT_NAME_OWNER',
    'REVIEW_NOT_FOUND', 'REVIEW_EXPIRED', 'BINDING_MISMATCH', 'REVIEW_CONTEXT_CHANGED']) {
    ok(`'${code}' forces a re-read before signing`, stale.has(code));
  }
  ok('a plain failure is not classified as stale',
    !stale.has('INVALID_INPUT') && !stale.has('INTERNAL') && !stale.has('UNSUPPORTED'));
}

console.log('[14] no UI file can reach a signing method on its own');
{
  // The pipeline is the only sanctioned route from a screen to a signature. That is a claim
  // about source text, so assert it against source text: every literal `bridge.send('X')`
  // under `src/ui/` must name a method whose declared auth is NOT 'signing'.
  //
  // The v12 activation exception is allowed to stay: `tx.registerAccount` is 'unlocked' by
  // design (it proves vault ownership and self-signs a zero-fee activation), so it does not
  // appear here. `tx.autoCreateAccount` IS 'signing' and must have zero UI callers — Dashboard
  // used to call it and was moved onto the owned-address path.
  //
  // Dynamic dispatch (`bridge.send(submit.method, …)` in confirm.js) is the intended path and
  // is invisible to this pattern on purpose; confirm.js is covered by [4] above.
  const root = new URL('../src/ui/', import.meta.url);
  const files = readdirSync(root, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.js'));
  ok('the UI source was actually scanned', files.length > 40, `${files.length} files`);

  // Strip comments before scanning: this repository documents its own history in comments,
  // including the literal text `bridge.send('tx.send', …)` that describes a deleted bug. A
  // guard that cannot tell code from commentary would fail on its own documentation.
  const withoutComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');

  const literals = new Map();
  for (const file of files) {
    const source = withoutComments(readFileSync(new URL(file, root), 'utf8'));
    // Single, double or static template quotes: a guard that only sees one quote style is a
    // guard a future route can walk around by accident.
    for (const match of source.matchAll(/bridge\.send\(\s*(['"`])([^'"`$]+)\1/g)) {
      const method = match[2];
      // A template placeholder inside bridge.js's own error message is not a method name.
      if (/[${}]/.test(method)) continue;
      if (!literals.has(method)) literals.set(method, []);
      literals.get(method).push(file);
    }
  }
  ok('the scan found the UI method literals it expects', literals.size >= 3,
    `${literals.size} distinct methods`);

  const unknown = [...literals.keys()].filter((method) => !METHODS[method]);
  ok('every method literal the UI sends is in the contract manifest', unknown.length === 0,
    unknown.join(','));

  const signing = [...literals.entries()]
    .filter(([method]) => METHODS[method]?.auth === 'signing')
    .map(([method, where]) => `${method} (${where.join(',')})`);
  ok('no UI file calls a signing-gated method by name', signing.length === 0, signing.join(' | '));
  ok("the legacy 'tx.autoCreateAccount' signing method has no UI caller",
    !literals.has('tx.autoCreateAccount'));

  // Positive control: the review trio and the v12 activation path ARE what the UI is allowed
  // to name. If this ever empties out, the scan above would be passing vacuously.
  const expected = ['tx.prepareReview', 'tx.confirmReview', 'tx.discardReview', 'tx.registerAccount'];
  ok('the sanctioned literals are present in the UI', expected.every((m) => literals.has(m)),
    expected.filter((m) => !literals.has(m)).join(','));
}

console.log('[15] the review fits one screen (owner review, 2026-10-28)');
{
  // The first shipped card stacked eleven sections: header, summary paragraph, protocol box,
  // "what you are doing", "balance change" boxes, a balance-after row, a four-row fee block,
  // a simulation notice, "execution details", warnings and acknowledgements. The owner asked
  // for the previous-mainsend shape back, and for Rabby's before-sign order: header, the value
  // moving, ONE table, warnings, and everything technical behind a single disclosure.
  //
  // These are the structural guards for that shape. They are source and decoder assertions,
  // not screenshots — this repository has no browser engine in CI.
  const cardSource = readFileSync(new URL('../src/ui/domain/tx-review/review-card.js', import.meta.url), 'utf8');
  const callCount = (source, name) => (source.match(new RegExp(`\\b${name}\\(`, 'g')) || []).length;
  // v1.5.0 split the single table in two on purpose: money (at most three rows: you pay, the
  // network fee, the total) and the operation's own non-money facts (expiry, previous owner).
  // Mixing a date between "you pay" and "network fee" was what made the domain card unreadable.
  ok('the card renders exactly two label/value tables — money, then non-money facts',
    callCount(cardSource, 'detailTable') === 3,
    `${callCount(cardSource, 'detailTable')} sites (definition + two calls expected)`);
  // Two disclosure buttons exist by construction: the advanced panel and, inside it, the raw
  // bytes. Never a third top-level section.
  ok('the card keeps exactly one details disclosure plus the raw toggle',
    (cardSource.match(/class: 'tx-review-disclosure-toggle'/g) || []).length === 2
      && cardSource.includes("'Details'")
      && cardSource.includes("'Hide details'"));
  ok('the stacked section wrappers are gone', !cardSource.includes('tx-review-section')
    && !cardSource.includes('tx-review-protocol') && !cardSource.includes("'Balance after'"));
  // The value boxes the first card drew (and their uppercase eyebrow) were replaced by the money
  // table's rows. Their CSS went with them; a rule no markup can reach is the same dead weight the
  // migration audit removed from `screens.css`.
  const reviewCss = readFileSync(new URL('../src/popup/styles/components.css', import.meta.url), 'utf8');
  ok('the money table did not bring the value boxes back',
    !cardSource.includes('balance-change-box') && !cardSource.includes('tx-review-eyebrow')
      && !reviewCss.includes('.balance-change-box') && !reviewCss.includes('.change-amount')
      && !reviewCss.includes('.tx-review-eyebrow'));
  // Part 1 copy rules: the hedge is the word "about", never a "(estimated)" suffix (and never
  // the word "estimate" in the label position the directive called out).
  ok('a quoted fee is hedged with "about", never "(estimated)"',
    cardSource.includes('`about ${amountText') && !cardSource.includes('(estimated)'));
  // `.detail-address` ellipsizes; a review address must wrap so the user can read all of it.
  ok('no review address is rendered with the ellipsizing class',
    cardSource.includes("'mono tx-review-address'") && !cardSource.includes("'mono detail-address'"));
  ok('an unknown transaction opens its details instead of folding them',
    /const openByDefault = !known/.test(cardSource)
      && /openByDefault \? null : 'hidden'/.test(cardSource));

  // One table per operation, with a budget chosen from what the operation actually needs.
  // A decoder that starts appending "Network", "Program", "Registrar"… rows again fails here.
  const rawFacts = {
    programAddress: asAddress(16),
    programName: null,
    programVerified: false,
    programNote: null,
    dataHex: 'deadbeef',
    note: null,
    accounts: [{ role: 'Payer', address: SENDER }],
    networkId: 'betanet',
    networkLabel: 'Betanet',
  };
  const shapes = [
    ['native-send', decode('native-send', nativeFacts()), 3],
    ['token-transfer', decode('token-transfer', tokenFacts()), 5],
    ['domain-register', decode('domain-register', domainFacts()), 4],
    ['domain-purchase', decode('domain-purchase', paidFacts()), 5],
    ['domain-renew', decode('domain-renew', paidFacts()), 6],
    ['domain-claim', decode('domain-claim', paidFacts()), 5],
    ['faucet-claim', decode('faucet-claim', claimFacts), 4],
    ['raw', decode('raw', rawFacts), 3],
  ];
  for (const [kind, review, max] of shapes) {
    ok(`${kind} keeps its fact table within ${max} rows`, review.summary.length <= max,
      `${review.summary.length} rows: ${review.summary.map((row) => row.label).join(', ')}`);
    ok(`${kind} does not repeat the network (the header badge states it)`,
      !review.summary.some((row) => row.label === 'Network'));
  }

  // Simplification must not become deletion: every technical fact the first version showed
  // still exists in the envelope, because the card moves it behind the disclosure rather than
  // dropping it (no balance-after is predicted, by design).
  for (const [kind, review] of shapes.filter(([kind]) => kind !== 'raw')) {
    ok(`${kind} still carries its program, instruction and fee provenance`,
      Boolean(review.execution.program?.name)
        && review.execution.instructions.length >= 1
        && review.execution.program.verified === true
        && Boolean(review.assets.fee.note),
      kind);
    ok(`${kind} still refuses to predict a post-transaction balance`,
      review.assets.balanceAfter === null && Boolean(review.assets.balanceAfterNote));
  }
  // The harness is part of the evidence, so its wiring is guarded too: TxReviewCard reports its
  // initial confirmability from the constructor, and the version of this page that bound the
  // confirm control afterwards threw on the first callback and drew nothing (d45a085).
  const harness = readFileSync(new URL('../scripts/preview-tx-review.html', import.meta.url), 'utf8');
  const loopAt = harness.indexOf('for (const fixture of previewFixtures())');
  ok('the harness binds the confirm control before it constructs the card',
    loopAt > 0
      && harness.indexOf('const confirmBtn', loopAt) < harness.indexOf('TxReviewCard({', loopAt));
  // ...and it must compute a fixture's state the way the service does, or it can show a card the
  // wallet can never emit (a failed simulation that still offers a confirm button).
  const fixturesSource = readFileSync(new URL('../scripts/preview-tx-review.fixtures.js', import.meta.url), 'utf8');
  ok('the harness folds the simulation verdict into state like review-service',
    fixturesSource.includes('simulationWarning(sim)')
      && fixturesSource.includes('stateFromWarnings(warnings)'));

  const rawReview = shapes.find(([kind]) => kind === 'raw')[1];
  ok('raw still exposes the bytes and stays unsignable',
    rawReview.execution.raw?.format === 'hex'
      && rawReview.execution.raw?.data === 'deadbeef'
      && rawReview.operation.confirmLabel === null
      && model.stateFromWarnings(rawReview.warnings) === 'blocked');
}

console.log('[16] concurrency and the simulation verdict');
{
  // Audit F-06: put/put could read the same list and erase each other. The store now serializes
  // every read-modify-write per network; these interleavings are the regression.
  const net = 'storetest';
  await reviewStore.clear(net);
  const rec = (id, ttl = 60_000) => ({ reviewId: id, expiresAt: Date.now() + ttl });

  await Promise.all([reviewStore.put(net, rec('a')), reviewStore.put(net, rec('b'))]);
  const two = (await reviewStore.get(net, 'a')) && (await reviewStore.get(net, 'b'));
  ok('two concurrent prepares both survive', Boolean(two),
    JSON.stringify([await reviewStore.get(net, 'a'), await reviewStore.get(net, 'b')]).slice(0, 160));

  await Promise.all([reviewStore.put(net, rec('c')), reviewStore.remove(net, 'a')]);
  ok('a concurrent put and remove both apply',
    Boolean(await reviewStore.get(net, 'c')) && (await reviewStore.get(net, 'a')) === null);

  await reviewStore.clear(net);
  await Promise.all(Array.from({ length: 45 }, (_, i) => reviewStore.put(net, rec(`r${i}`))));
  const capped = [];
  for (let i = 0; i < 45; i += 1) if (await reviewStore.get(net, `r${i}`)) capped.push(i);
  ok('the cap keeps the 40 newest records under concurrent writes',
    capped.length === 40 && capped.includes(44) && !capped.includes(0), capped.join(','));

  await reviewStore.put(net, rec('expired', -1_000));
  await reviewStore.put(net, rec('fresh'));
  ok('expired records are pruned on the next write, not returned',
    (await reviewStore.get(net, 'expired')) === null && Boolean(await reviewStore.get(net, 'fresh')));
  await reviewStore.clear(net);

  // Audit F-04: a simulation that RAN and failed must block, and must read differently from
  // one the wallet could not run. Both halves are pure; the service folds them before state.
  const { simulationWarning } = await import('../src/shared/tx-review/decoders/common.js');
  const failed = simulationWarning({ status: 'failed', reason: 'node rejected the dry run' });
  ok('a failed simulation is a blocking fact with the node reason',
    failed?.blocking === true && /node rejected/.test(failed.detail) && failed.severity === 'danger');
  const base = decode('native-send', nativeFacts());
  ok('a failed simulation turns an otherwise ready review into blocked',
    model.stateFromWarnings(base.warnings) === 'ready'
      && model.stateFromWarnings([...base.warnings, failed]) === 'blocked');
  ok('unavailable and pending simulations add no warning',
    simulationWarning({ status: 'unavailable' }) === null
      && simulationWarning({ status: 'pending' }) === null
      && simulationWarning(null) === null);

  const serviceSource = readFileSync(new URL('../src/background/services/review-service.js', import.meta.url), 'utf8');
  ok('the service folds the simulation verdict in before computing and storing the state',
    /simulationWarning\(simulation\)[\s\S]{0,300}const state =/.test(serviceSource)
      && /\bstate,\s*\n\s*facts,/.test(serviceSource));
  const cardSource = readFileSync(new URL('../src/ui/domain/tx-review/review-card.js', import.meta.url), 'utf8');
  ok('the card words "failed" differently from "unavailable"',
    /failed: 'Failed/.test(cardSource) && /unavailable: 'Not available'/.test(cardSource));
}

console.log('[17] the shared submit path is mandatory, and the batch bypass is gone');
{
  // ---- (a) every call site passes a lifecycle signal ------------------------------
  // A confirmation can wait in the password dialog indefinitely while the route that opened it
  // is destroyed. `signal` was optional and two of the three call sites shipped without one, so
  // it is required in confirm.js and asserted here against the source of every caller
  // (docs/DEFECT_LOG.md §15.3).
  const uiRoot = new URL('../src/ui/', import.meta.url);
  const uiFiles = readdirSync(uiRoot, { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
  const callSites = [];
  for (const file of uiFiles) {
    const source = readFileSync(new URL(file, uiRoot), 'utf8');
    for (const match of source.matchAll(/(?<!function )submitReviewedReview\(\{/g)) {
      const window = source.slice(match.index, match.index + 800);
      callSites.push({ file, hasSignal: /\bsignal:\s*\S/.test(window) });
    }
  }
  ok('the scan found every submitReviewedReview call site', callSites.length >= 3,
    `${callSites.length} sites`);
  const missing = callSites.filter((c) => !c.hasSignal).map((c) => c.file);
  ok('every submitReviewedReview call passes a lifecycle signal', missing.length === 0,
    missing.join(','));

  // ---- (b) confirm.js refuses to run without one, and aborts before any signing ----
  const sent = [];
  globalThis.chrome.runtime = {
    ...(globalThis.chrome.runtime || {}),
    sendMessage: (message, callback) => {
      sent.push(message.method);
      callback({ ok: true, data: {} });
    },
  };
  const { submitReviewedReview } = await import('../src/ui/domain/tx-review/confirm.js');
  const review = { reviewId: 'r1', bindingHash: 'h1', operation: { confirmLabel: 'Sign' } };

  let noSignal = null;
  try {
    await submitReviewedReview({ review });
  } catch (error) {
    noSignal = error;
  }
  ok('a submission without a lifecycle signal is refused, not silently allowed',
    noSignal?.code === 'INVALID_REQUEST', noSignal?.message);
  ok('the refusal happened before anything was sent to the background', sent.length === 0,
    sent.join(','));

  const controller = new AbortController();
  controller.abort();
  const abandoned = await submitReviewedReview({ review, signal: controller.signal });
  ok('an already-aborted route returns cancelled without confirming',
    abandoned.status === 'cancelled' && !sent.includes('tx.confirmReview'), sent.join(','));

  // Positive control: with a live signal it does reach the background, so (b) is not vacuous.
  let reached = null;
  try {
    await submitReviewedReview({ review, signal: new AbortController().signal });
  } catch (error) {
    reached = error;
  }
  ok('control: a live signal proceeds to tx.confirmReview',
    sent.includes('tx.confirmReview'), `${sent.join(',')} ${reached?.message || ''}`);

  // ---- (c) the batch registration bypass is deleted -------------------------------
  // It called tx.prepareReview then submitReviewedReview in a loop without ever rendering the
  // card (audit F-1). Its control was hidden and never revealed, so it was dead code with a
  // signing loop in it. The removal is asserted so it cannot come back quietly.
  const nameRoute = readFileSync(new URL('../src/ui/app/routes/name.js', import.meta.url), 'utf8');
  ok('the registration queue is gone from the Domain route',
    !/queuedRegistrations|renderQueue|queueBtn|registerAllBtn/.test(nameRoute));
  ok('the Domain route no longer batches prepared reviews without a card',
    !/Register \$\{[^}]*\} names/.test(nameRoute));
  const css = readFileSync(new URL('../src/popup/styles/screens.css', import.meta.url), 'utf8');
  ok('the batch queue CSS is gone too', !/\.name-queue-/.test(css));

  // ---- (d) the faucet claim carries the reviewed account and network ---------------
  const faucetKind = kindTable.getKind('faucet-claim');
  const faucetSubmit = faucetKind.submit({
    amountUnits: '500000', fromAddress: 'taAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEg',
    networkId: 'betanet',
  });
  ok('the faucet review submits the account and network it displayed',
    faucetSubmit.params.fromAddress === 'taAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEg'
      && faucetSubmit.params.networkId === 'betanet', JSON.stringify(faucetSubmit.params));
  ok('the contract declares the faucet binding params',
    ['fromAddress', 'networkId'].every((p) => METHODS['tx.claimFaucet'].params.includes(p)));
}

console.log('[18] the faucet handler refuses a context that changed after review');
{
  // Audit F-2: the faucet claim re-read the active account and network at submit time and used
  // whatever they were, so a switch made from another window during password re-auth could
  // claim into a context the user never reviewed. Send and the name writes already bound;
  // the claim now binds too and these are the refusals.
  const { getActiveNetworkConfig } = await import('../src/background/services/network-service.js');
  const active = await getActiveNetworkConfig();
  const account = await handleApiRequest({ method: 'account.getActive' });
  const me = account.data?.address;
  ok('the suite has an unlocked active account to claim with', typeof me === 'string' && me.length > 0);

  const wrongAccount = await handleApiRequest({
    method: 'tx.claimFaucet',
    params: { amountUnits: '500000', fromAddress: Pubkey.from(new Uint8Array(32).fill(77)).toThruFmt(), networkId: active.id },
  });
  ok('a changed active account is refused with REVIEW_ACCOUNT_CHANGED',
    wrongAccount.ok === false && wrongAccount.error.code === 'REVIEW_ACCOUNT_CHANGED',
    JSON.stringify(wrongAccount).slice(0, 160));

  const wrongNetwork = await handleApiRequest({
    method: 'tx.claimFaucet',
    params: { amountUnits: '500000', fromAddress: me, networkId: `${active.id}-other` },
  });
  ok('a changed active network is refused with REVIEW_NETWORK_CHANGED',
    wrongNetwork.ok === false && wrongNetwork.error.code === 'REVIEW_NETWORK_CHANGED',
    JSON.stringify(wrongNetwork).slice(0, 160));

  // Neither refusal may have produced a signature or a pending record.
  const pendingList = await handleApiRequest({ method: 'tx.getPending' }).catch(() => ({ data: [] }));
  const faucetPending = (pendingList.data?.items || pendingList.data || [])
    .filter?.((entry) => entry?.kind === 'faucet') || [];
  ok('neither refusal tracked a faucet submission', faucetPending.length === 0,
    JSON.stringify(faucetPending).slice(0, 120));
}

console.log(`\nAll tx-review checks passed: ${checks}/${checks}.`);
console.log('No network was contacted: the SDK account read was stubbed at the client boundary.');
