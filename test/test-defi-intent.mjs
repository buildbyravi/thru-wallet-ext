// G2-S0 (2026-10-09): the REAL native-send intent pipeline, proven in-process with zero
// network (the thru-client is stubbed at getClient(), exactly like test-api-router.mjs).
//
// What this proves:
//   [1] flag OFF keeps the identical FEATURE_DISABLED envelope for every entry point
//       (the M0 quarantine contract survives the real implementation existing)
//   [2] intent.prepareSend builds a review bound to the active account/network with
//       honest facts: measured fee quote (betanet), balance sufficiency from the chain,
//       and a SHA-256 bindingHash over the plan
//   [3] validation refusals are stable wire codes (INVALID_PARAMS / SIMULATION_FAILED)
//   [4] intent.submit is signing-gated (AUTH_REQUIRED without a password), refuses a
//       stale/missing bindingHash (BINDING_MISMATCH), and executes through
//       txService.sendTransferChecked — the signature lands in the intent record AND in
//       the pending-tx tracker (the single chain-lifecycle store)
//   [5] a waitingChain intent cannot be discarded
//   [6] terminal/rejection mapping: chain silence = TX_DROPPED + resumable, a VM revert
//       = PROGRAM_ERROR + not resumable
//   [7] rePrepare rotates the bindingHash and restarts the 120s ttl
//   [8] expiry is honest: read-evaluated (INTENT_EXPIRED on submit), not a hidden sweep
//   [9] discard is terminal and idempotent-shaped ({ intentId, status:'cancelled' })
//  [10] resume/stopWaiting stay honestly NOT_READY under the flag (next slice)
//  [11] the store is network-scoped (defi_intents::betanet), listed in SCOPED_KEYS
import assert from 'node:assert/strict';

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
  // chrome.runtime intentionally absent: emit() is best-effort and must swallow that.
};

const { handleApiRequest } = await import('../src/background/api-router.js');
const { FLAGS } = await import('../src/shared/flags.js');
const { SCOPED_KEYS } = await import('../src/shared/network-scope.js');

const PASSWORD = 'Password123!';
const RECIPIENT = 'taEREREREREREREREREREREREREREREREREREREREREREg'; // valid, never the sender in this suite
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
assert.ok(SENDER.startsWith('ta'));
console.log('harness: wallet created (offline), sender', SENDER.slice(0, 12) + '…');

// [1] flag OFF: the quarantine envelope is unchanged even though real code now sits behind it.
for (const [method, params] of [
  ['intent.list', {}],
  ['intent.get', { intentId: 'nope' }],
  ['intent.prepareSend', { address: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKqq', toAddress: RECIPIENT, amountUnits: '1', clientRequestId: 'cr-off' }],
  ['intent.submit', { intentId: 'nope', bindingHash: 'x', password: PASSWORD }],
  ['intent.discard', { intentId: 'nope' }],
  ['intent.rePrepare', { intentId: 'nope' }],
  ['intent.resume', { intentId: 'nope' }],
  ['intent.stopWaiting', { intentId: 'nope' }],
]) {
  const res = await handleApiRequest({ method, params });
  assert.equal(res.ok, false, `${method} must be gated off`);
  assert.equal(res.error.code, 'FEATURE_DISABLED', `${method} code`);
}
ok('flag OFF: all 8 intent entry points answer the identical FEATURE_DISABLED envelope');

// Flip the build-time flags in-process (the FLAGS object is const; its properties are the
// reviewed ship switch — here only to prove the real pipeline behind the gate).
FLAGS.DEFI = true;
FLAGS.DEFI_INTENT = true;

// Zero-network client stub: big balance for any account, a signed "raw" tx, and a finished
// sendAndTrack stream with a 64-byte signature. Behavioural overrides per-test below.
const thru = await import('../src/lib/thru-client.js');
const client = thru.getClient();
client.accounts.get = async () => ({ meta: { balance: 10_000_000_000n } });
client.transactions.buildAndSign = async () => ({ rawTransaction: new Uint8Array([1, 2, 3, 4]) });
const settledTrack = async function* () {
  yield {
    executionResult: { vmError: 0, consumedComputeUnits: 32_527n, consumedMemoryUnits: 0n, consumedStateUnits: 0n },
    signature: { value: new Uint8Array(64).fill(6) },
  };
};
client.transactions.sendAndTrack = settledTrack;

const intentRecord = async (intentId) => {
  const list = storage.get('defi_intents::betanet') ?? [];
  return list.find((r) => r.intentId === intentId) ?? null;
};

// [11] scoping (asserted early: a regression here is the cross-chain leak MAINNET_READINESS warms of)
const emptyList = await handleApiRequest({ method: 'intent.list' });
assert.equal(emptyList.ok, true);
assert.deepEqual(emptyList.data.intents, []);
ok('flag ON: intent.list reads an empty network-scoped store');
ok('defi_intents is declared network-scoped', SCOPED_KEYS.includes('defi_intents'));

// [3] validation refusals before any record exists
const badAddress = await handleApiRequest({ method: 'intent.prepareSend', params: { address: SENDER, toAddress: 'junk', amountUnits: '1', clientRequestId: 'cr-v1' } });
assert.equal(badAddress.ok, false);
assert.equal(badAddress.error.code, 'INVALID_INPUT');
const badAmount = await handleApiRequest({ method: 'intent.prepareSend', params: { address: SENDER, toAddress: RECIPIENT, amountUnits: '0', clientRequestId: 'cr-v2' } });
assert.equal(badAmount.ok, false);
assert.equal(badAmount.error.code, 'INVALID_INPUT');
const otherAccount = await handleApiRequest({ method: 'intent.prepareSend', params: { address: RECIPIENT, toAddress: RECIPIENT, amountUnits: '1', clientRequestId: 'cr-v3' } });
assert.equal(otherAccount.ok, false);
assert.equal(otherAccount.error.code, 'ACCOUNT_MISSING'); // prepare binds to the ACTIVE account only
ok('prepareSend refuses malformed recipient / non-positive amount with INVALID_INPUT and a non-active address with ACCOUNT_MISSING');

// [3] honest insufficiency: the chain says the balance cannot cover amount + reserve
client.accounts.get = async () => ({ meta: { balance: 5n } });
const broke = await handleApiRequest({ method: 'intent.prepareSend', params: { address: SENDER, toAddress: RECIPIENT, amountUnits: '1000', clientRequestId: 'cr-v4' } });
assert.equal(broke.ok, false);
assert.equal(broke.error.code, 'SIMULATION_FAILED');
assert.equal(broke.error.retryable, false);
client.accounts.get = async () => ({ meta: { balance: 10_000_000_000n } });
ok('prepareSend reports SIMULATION_FAILED (not a fake plan) when balance < amount + reserve');

// [2] a real review
const prep = await handleApiRequest({
  method: 'intent.prepareSend',
  params: { address: SENDER, toAddress: RECIPIENT, amountUnits: '1234', clientRequestId: 'cr-1' },
});
assert.equal(prep.ok, true, JSON.stringify(prep.error));
const review = prep.data;
assert.match(review.bindingHash, /^[0-9a-f]{24}$/);
assert.equal(review.facts.fromAddress, SENDER);
assert.equal(review.facts.toAddress, RECIPIENT);
assert.equal(review.facts.amountUnits, '1234');
assert.equal(review.facts.networkId, 'betanet');
assert.equal(review.facts.balanceSufficient, true);
assert.equal(review.feePlan.supported, true); // betanet ships a measured baseFeeUnits = 1n
assert.equal(review.feePlan.feeUnits, '1');
assert.equal(review.clientRequestId, 'cr-1');
assert.deepEqual(review.assetChanges, [{ from: SENDER, to: RECIPIENT, amountUnits: '1234' }]);
assert.ok(typeof review.reviewAscii === 'string' && review.reviewAscii.includes('native-send'));
ok('prepareSend returns a reviewable intent (facts + measured fee + bindingHash + reviewAscii)');

const listed = await handleApiRequest({ method: 'intent.list' });
const record = listed.data.intents[0];
assert.equal(listed.data.intents.length, 1);
assert.equal(record.status, 'prepared');
assert.equal(record.plan.networkId, 'betanet');
assert.equal(record.bindingHash, review.bindingHash);
assert.ok(storage.has('defi_intents::betanet'));
ok('the prepared intent is persisted under defi_intents::betanet and listed');
const INTENT_ID = record.intentId;

// [4] submit: signing auth, binding pin, real execution through the checked send path.
// Signing re-auth is an opt-in (preferences requirePasswordForSigning, default false =
// session-only). Opt in to prove the password gate on the contract's only DeFi signing method.
const optIn = await handleApiRequest({ method: 'settings.setSecurity', params: { patch: { requirePasswordForSigning: true }, password: PASSWORD } });
assert.equal(optIn.ok, true, JSON.stringify(optIn.error));
const noPassword = await handleApiRequest({ method: 'intent.submit', params: { intentId: INTENT_ID, bindingHash: review.bindingHash } });
assert.equal(noPassword.ok, false);
assert.equal(noPassword.error.code, 'AUTH_REQUIRED');
ok('intent.submit demands the password once signing re-auth is opted in (auth:signing)');

const stale = await handleApiRequest({ method: 'intent.submit', params: { intentId: INTENT_ID, bindingHash: '0'.repeat(24), password: PASSWORD } });
assert.equal(stale.ok, false);
assert.equal(stale.error.code, "BINDING_MISMATCH", JSON.stringify(stale.error));
assert.equal((await intentRecord(INTENT_ID)).status, 'prepared');
ok('a stale/missing bindingHash is refused as BINDING_MISMATCH and leaves the intent prepared');

const submitted = await handleApiRequest({ method: 'intent.submit', params: { intentId: INTENT_ID, bindingHash: review.bindingHash, password: PASSWORD } });
assert.equal(submitted.ok, true, JSON.stringify(submitted.error));
assert.equal(submitted.data.state, 'waitingChain');
assert.equal(submitted.data.submitId, `${INTENT_ID}_s1`);
assert.ok(typeof submitted.data.signature === 'string' && submitted.data.signature.length > 0);
const landed = await intentRecord(INTENT_ID);
assert.equal(landed.status, 'waitingChain');
assert.equal(landed.signature, submitted.data.signature);
const pending = storage.get('thru_pending_txs::betanet')?.records ?? [];
assert.ok(pending.some((tx) => tx.signature === submitted.data.signature && tx.kind === 'transfer'),
  'the signature must be tracked by the pending-tx tracker (single chain-lifecycle store)');
ok('submit executes via sendTransferChecked: intent + pending-tx tracker both carry the signature');

// [5] a waitingChain intent is not discardable
const premature = await handleApiRequest({ method: 'intent.discard', params: { intentId: INTENT_ID } });
assert.equal(premature.ok, false);
assert.equal(premature.error.code, 'NOT_READY');
ok('discard refuses a waitingChain intent');

// [6] chain silence -> TX_DROPPED + resumable
const prep2 = await handleApiRequest({ method: 'intent.prepareSend', params: { address: SENDER, toAddress: RECIPIENT, amountUnits: '7', clientRequestId: 'cr-2' } });
const id2 = prep2.data.bindingHash ? (await handleApiRequest({ method: 'intent.list' })).data.intents.find((r) => r.bindingHash === prep2.data.bindingHash).intentId : null;
assert.ok(id2);
client.transactions.sendAndTrack = async function* () { /* silence: no update ever arrives */ };
const dropped = await handleApiRequest({ method: 'intent.submit', params: { intentId: id2, bindingHash: prep2.data.bindingHash, password: PASSWORD } });
assert.equal(dropped.ok, false);
assert.equal(dropped.error.code, 'TX_DROPPED');
assert.equal(dropped.error.retryable, true);
const failedRecord = await intentRecord(id2);
assert.equal(failedRecord.status, 'failed');
assert.equal(failedRecord.errorCode, 'TX_DROPPED');
assert.equal(failedRecord.resumable, true);
ok('a submission that never hears back is recorded failed/TX_DROPPED/resumable');

// [7] rePrepare rotates the binding and restarts the ttl
const rep = await handleApiRequest({ method: 'intent.rePrepare', params: { intentId: id2 } });
assert.equal(rep.ok, true);
assert.notEqual(rep.data.bindingHash, prep2.data.bindingHash);
const reLanded = await intentRecord(id2);
assert.equal(reLanded.status, 'prepared');
assert.ok(reLanded.expiresAt > Date.now());
ok('rePrepare rotates the bindingHash and returns the intent to prepared with a fresh ttl');

// [6] VM revert -> PROGRAM_ERROR + not resumable
client.transactions.sendAndTrack = async function* () {
  yield { executionResult: { vmError: -765 }, signature: { value: new Uint8Array(64).fill(7) } };
};
const vmFail = await handleApiRequest({ method: 'intent.submit', params: { intentId: id2, bindingHash: rep.data.bindingHash, password: PASSWORD } });
assert.equal(vmFail.ok, false);
assert.equal(vmFail.error.code, 'PROGRAM_ERROR');
assert.equal(vmFail.error.retryable, false);
const vmRecord = await intentRecord(id2);
assert.equal(vmRecord.status, 'failed');
assert.equal(vmRecord.resumable, false);
client.transactions.sendAndTrack = settledTrack;
ok('a VM revert is recorded failed/PROGRAM_ERROR/not-resumable');

// [8] expiry is read-evaluated (no hidden sweep): age the record past its 120s ttl
const prep3 = await handleApiRequest({ method: 'intent.prepareSend', params: { address: SENDER, toAddress: RECIPIENT, amountUnits: '9', clientRequestId: 'cr-3' } });
const id3 = (await handleApiRequest({ method: 'intent.list' })).data.intents.find((r) => r.bindingHash === prep3.data.bindingHash).intentId;
const all = storage.get('defi_intents::betanet');
const rec3 = all.find((r) => r.intentId === id3);
rec3.expiresAt = Date.now() - 1;
storage.set('defi_intents::betanet', all);
const agedGet = await handleApiRequest({ method: 'intent.get', params: { intentId: id3 } });
assert.equal(agedGet.ok, true);
assert.equal(agedGet.data.status, 'expired');
const expiredSubmit = await handleApiRequest({ method: 'intent.submit', params: { intentId: id3, bindingHash: prep3.data.bindingHash, password: PASSWORD } });
assert.equal(expiredSubmit.ok, false);
assert.equal(expiredSubmit.error.code, 'INTENT_EXPIRED');
ok('an aged intent reads as expired and refuses submit as INTENT_EXPIRED');

// [9] discard is terminal
const discarded = await handleApiRequest({ method: 'intent.discard', params: { intentId: id3 } });
assert.equal(discarded.ok, true);
assert.deepEqual(discarded.data, { intentId: id3, status: 'cancelled' });
const submitCancelled = await handleApiRequest({ method: 'intent.submit', params: { intentId: id3, bindingHash: prep3.data.bindingHash, password: PASSWORD } });
assert.equal(submitCancelled.ok, false);
assert.equal(submitCancelled.error.code, 'NOT_READY');
ok('discard cancels expired intents terminally (submit of a cancelled intent refuses)');

// [10] the next slice stays honest: resume/stopWaiting answer NOT_READY, not a guess
const resume = await handleApiRequest({ method: 'intent.resume', params: { intentId: id2 } });
assert.equal(resume.ok, false);
assert.equal(resume.error.code, 'NOT_READY');
const stopWaiting = await handleApiRequest({ method: 'intent.stopWaiting', params: { intentId: INTENT_ID } });
assert.equal(stopWaiting.ok, false);
assert.equal(stopWaiting.error.code, 'NOT_READY');
ok('resume/stopWaiting remain NOT_READY flag-on (waiting-room slice is not inferred)');

console.log(`\ntest-defi-intent: ${checks} checks passed`);
