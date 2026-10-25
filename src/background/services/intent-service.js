// Intent pipeline (G2-S0, 2026-10-09): REAL native-send intents behind the unchanged gate.
//
// Real in this slice:   intent.list / intent.get (READ from a network-scoped store),
//                       intent.prepareSend (reviewable plan + facts + fee quote + bindingHash),
//                       intent.submit (auth:'signing'; executes through txService.sendTransferChecked
//                          — the same guarded path the TX Review uses, so the account/network
//                          binding, recipient-activation, duplicate and signing-guard rules apply),
//                       intent.discard (prepared/expired/failed/rejected → cancelled, terminal),
//                       intent.rePrepare (requote + rotate bindingHash + restart the 120s ttl).
// Honestly deferred:    intent.resume / intent.stopWaiting — waiting-room semantics belong to
//                       the chain-wait/replace slice; they now answer NOT_READY with the flag on
//                       (previously FEATURE_DISABLED with it off — still true).
//
// Gate: gateOrThrow({gate:'DEFI_INTENT', ..., env:'error'}) — FLAGS.DEFI && FLAGS.DEFI_INTENT are
// build-time false in this build, so every entry point answers the same FEATURE_DISABLED envelope
// as the M0 stub did (the quarantine proof in test/test-defi-m0.mjs stays intact). Enabling is a
// reviewed ship decision (DEFI-02), deliberately separate from this code existing.
//
// The pending-tx tracker remains the single CHAIN-lifecycle store: txService records the
// signature there at submission; this module's intents track the pipeline state around that.
import { gateOrThrow } from './defi/gating.js';
import * as store from './defi/intent-store.js';
import * as txService from './tx-service.js';
import * as accountService from './account-service.js';
import { getActiveNetworkConfig } from './network-service.js';
import * as thruClient from '../../lib/thru-client.js';

const GATE = { gate: 'DEFI_INTENT', feature: null, env: 'error', label: 'Intent pipeline' };

function gate() {
  gateOrThrow(GATE); // env:'error' — throws FEATURE_DISABLED in this build
}

function errCode(code, message, retryable = false) {
  const err = new Error(message);
  err.code = code;
  err.retryable = retryable;
  return err;
}

const INTENT_KIND_NATIVE_SEND = 'native-send';

/**
 * A prepare/submit/rePrepare/discard is bound to ONE network: the plan records the networkId it
 * was prepared under and every later handler looks the intent up in exactly that store. A
 * network switch between prepare and submit is rejected (the store is scoped), never replayed.
 */
async function resolveIntentNetwork(intentId) {
  const active = await getActiveNetworkConfig();
  const networkId = typeof active === 'string' ? active : active?.id;
  if (!networkId) throw errCode('NOT_READY', 'no active network');
  const record = await store.getIntent(networkId, intentId);
  if (!record) throw errCode('INTENT_NOT_FOUND', `no intent '${intentId}' on ${networkId}`);
  return { networkId, record };
}

function reviewFor(record) {
  const { plan } = record;
  return {
    reviewAscii: [
      `Kind          ${record.kind}`,
      `From          ${plan.fromAddress}`,
      `To            ${plan.toAddress}`,
      `Amount        ${plan.amountUnits} base units`,
      `Fee (est.)    ${plan.feeQuote?.supported ? `${plan.feeQuote.feeUnits} base units (reserve ${plan.feeQuote.reserveUnits}, ${plan.feeQuote.source})` : 'not measured on this network'}`,
      `Network       ${plan.networkId}`,
      `Binding       ${record.bindingHash}`,
    ].join('\n'),
    facts: {
      fromAddress: plan.fromAddress,
      toAddress: plan.toAddress,
      amountUnits: plan.amountUnits,
      networkId: plan.networkId,
      balanceSufficient: plan.balanceSufficient ?? null,
    },
    model: { kind: record.kind },
    policy: { selfSignedOnly: true, sponsorship: 'never' },
    simulation: plan.balanceSufficient === false
      ? { supported: false, reason: 'insufficient balance for amount + reserve' }
      : { supported: true },
    assetChanges: [{ from: plan.fromAddress, to: plan.toAddress, amountUnits: plan.amountUnits }],
    feePlan: plan.feeQuote ?? { supported: false, reason: 'no fee measurement on this network' },
    bindingHash: record.bindingHash,
    clientRequestId: record.clientRequestId ?? null,
    acknowledgements: [],
  };
}

// ---- READ -----------------------------------------------------------------------
export async function listIntents({ status } = {}) {
  gate();
  const active = await getActiveNetworkConfig();
  const intents = await store.listIntents(active.id, typeof status === 'string' && status ? { status } : {});
  return { intents };
}

export async function getIntent({ intentId } = {}) {
  gate();
  if (!intentId || typeof intentId !== 'string') throw errCode('INVALID_INPUT', 'intentId is required');
  const { record } = await resolveIntentNetwork(intentId);
  return record;
}

// ---- PREPARE ---------------------------------------------------------------------
export async function prepareSend({ address, toAddress, amountUnits, clientRequestId } = {}) {
  gate();
  const to = String(toAddress ?? '').trim();
  if (!thruClient.isValidThruAddress(to)) {
    throw errCode('INVALID_INPUT', 'a valid recipient ta... address is required');
  }
  let amount;
  try {
    amount = BigInt(String(amountUnits ?? '0'));
  } catch {
    throw errCode('INVALID_INPUT', 'amountUnits must be a whole number of base units');
  }
  if (amount <= 0n) throw errCode('INVALID_INPUT', 'amountUnits must be a positive whole number');

  // Self-signed only: the intent is bound to the ACTIVE account. Submit executes with the
  // keyring's active key, so preparing for any other address would sign with the wrong key.
  const account = await accountService.getActiveAccount();
  if (!account?.address) throw errCode('ACCOUNT_MISSING', 'no active account');
  if (address && String(address) !== account.address) {
    throw errCode('ACCOUNT_MISSING', 'prepare is bound to the active account');
  }

  const network = await getActiveNetworkConfig();

  // Facts for the review, honestly: balance/sufficiency from the chain; fee quote from the
  // network's measured fee, or an explicit "not measured" (a mainnet entry with baseFeeUnits
  // null must never invent a number).
  let balanceSufficient = null;
  try {
    const info = await thruClient.getAccountInfo(account.address);
    const reserve = network.feeReserveUnits ?? 0n;
    balanceSufficient = info.exists ? info.balance >= amount + reserve : false;
  } catch {
    balanceSufficient = null; // chain unreadable right now — unknown, not a guess
  }
  if (balanceSufficient === false) {
    throw errCode('SIMULATION_FAILED', 'insufficient balance for amount + reserve on the active account');
  }
  const feeQuote = network.baseFeeUnits != null
    ? {
        supported: true,
        feeUnits: network.baseFeeUnits.toString(),
        reserveUnits: (network.feeReserveUnits ?? 0n).toString(),
        source: network.feeSource ?? 'unknown',
      }
    : { supported: false, reason: 'no fee measurement on this network' };

  const plan = {
    fromAddress: account.address,
    toAddress: to,
    amountUnits: amount.toString(),
    networkId: network.id,
    feeQuote,
    balanceSufficient,
  };
  const preparedAt = Date.now();
  const intentId = `${network.id}_i_${preparedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const bindingHash = await store.bindingHashOf(plan, preparedAt, intentId);
  const record = {
    intentId,
    kind: INTENT_KIND_NATIVE_SEND,
    status: 'prepared',
    plan,
    bindingHash,
    clientRequestId: clientRequestId ?? null,
    fee: feeQuote,
    unsignedTxs: null, // a native send is built+signed at submit; nothing unsigned is stored
    context: { networkId: network.id },
    signature: null,
    submitId: null,
    errorCode: null,
    errorMessage: null,
    resumable: false,
    ttlMs: store.INTENT_TTL_MS,
    preparedAt,
    updatedAt: preparedAt,
    expiresAt: preparedAt + store.INTENT_TTL_MS,
    reason: null,
  };
  const landed = await store.upsert(network.id, intentId, () => record);
  return reviewFor(landed);
}

// ---- EXECUTE (auth:'signing' — the router enforces unlocked + password before this handler) --
export async function submitIntent({ intentId, bindingHash } = {}) {
  gate();
  if (!intentId) throw errCode('INVALID_INPUT', 'intentId is required');
  const { networkId, record } = await resolveIntentNetwork(intentId);
  if (record.status === 'expired') {
    throw errCode('INTENT_EXPIRED', 'this intent expired — prepare again and review the fresh review');
  }
  if (record.status !== 'prepared') {
    throw errCode('NOT_READY', `intent is '${record.status}' — only a prepared intent can be submitted (a resumable failure resumes via intent.resume)`);
  }
  if (!bindingHash || bindingHash !== record.bindingHash) {
    throw errCode('BINDING_MISMATCH', 'the reviewed bindingHash no longer matches this intent — prepare again and review the fresh review');
  }

  await store.upsert(networkId, intentId, (r) => (r ? { ...r, status: 'waitingChain', updatedAt: Date.now() } : r));
  const submitId = `${intentId}_s1`;
  try {
    // Executing the RECORDED (fromAddress, networkId) pair: sendTransferChecked asserts the
    // active account and network still match the recorded ones (a mid-flight switch is
    // refused, completing on the wrong account or chain is impossible — TX Review semantics).
    const result = await txService.sendTransferChecked({
      toAddress: record.plan.toAddress,
      amountUnits: record.plan.amountUnits,
      fromAddress: record.plan.fromAddress,
      networkId: record.plan.networkId,
      allowDuplicate: false,
    });
    const signature = result?.signature ?? null;
    const landed = await store.upsert(networkId, intentId, (r) => (
      r ? { ...r, status: 'waitingChain', signature: signature ?? r.signature, submitId, updatedAt: Date.now() } : r
    ));
    return { submitId, state: 'waitingChain', waitingReason: null, signature: signature ?? landed?.signature ?? null };
  } catch (e) {
    // The duplicate guard has its own stable code the UI keys on — carry it through unchanged.
    if (e?.code === 'DUPLICATE_SUBMISSION') {
      await store.upsert(networkId, intentId, (r) => (r ? { ...r, status: 'prepared', updatedAt: Date.now(), reason: 'duplicate-refused' } : r));
      throw e;
    }
    const dropped = /fetch|timed?\s?out|network|ECONN|abort|offline/i.test(e?.message ?? '');
    const vm = e?.vmError != null || /vmError|execution reverted|program/i.test(e?.message ?? '');
    const errorCode = dropped ? 'TX_DROPPED' : vm ? 'PROGRAM_ERROR' : 'PROGRAM_ERROR';
    const resumable = errorCode === 'TX_DROPPED'; // a resumable failure resumes via intent.resume
    await store.upsert(networkId, intentId, (r) => (r ? {
      ...r,
      status: 'failed',
      errorCode,
      resumable,
      errorMessage: String(e?.message ?? '').slice(0, 200),
      updatedAt: Date.now(),
    } : r));
    throw errCode(errorCode, e?.message ?? 'the chain rejected this submission', resumable);
  }
}

export async function rePrepareIntent({ intentId } = {}) {
  gate();
  if (!intentId) throw errCode('INVALID_INPUT', 'intentId is required');
  const { networkId, record } = await resolveIntentNetwork(intentId);
  if (record.status !== 'prepared' && record.status !== 'expired' && record.status !== 'failed') {
    throw errCode('NOT_READY', `intent is '${record.status}' — only prepared/expired/failed intents requote`);
  }
  const preparedAt = Date.now();
  const bindingHash = await store.bindingHashOf(record.plan, preparedAt, `${record.intentId}:re:${preparedAt}`);
  const landed = await store.upsert(networkId, intentId, (r) => (r ? {
    ...r,
    status: 'prepared',
    bindingHash,
    preparedAt,
    updatedAt: preparedAt,
    expiresAt: preparedAt + store.INTENT_TTL_MS,
    errorCode: null,
    errorMessage: null,
    resumable: false,
    reason: 'reprepared',
  } : r));
  return reviewFor(landed);
}

export async function discardIntent({ intentId } = {}) {
  gate();
  if (!intentId) throw errCode('INVALID_INPUT', 'intentId is required');
  const { networkId, record } = await resolveIntentNetwork(intentId);
  const discardable = new Set(['prepared', 'expired', 'failed', 'rejected']);
  if (!discardable.has(record.status)) {
    throw errCode('NOT_READY', `intent is '${record.status}' — a waiting or settled intent is not discardable`);
  }
  await store.upsert(networkId, intentId, (r) => (r ? { ...r, status: 'cancelled', reason: 'user-discard', updatedAt: Date.now() } : r));
  return { intentId, status: 'cancelled' };
}

export async function resumeIntent() {
  gate();
  throw errCode('NOT_READY', 'intent.resume belongs to the chain-wait/replace slice (waiting-room semantics) — honest unknown until that slice ships');
}

export async function stopWaitingIntent() {
  gate();
  throw errCode('NOT_READY', 'intent.stopWaiting belongs to the chain-wait/replace slice (waiting-room semantics) — honest unknown until that slice ships');
}
