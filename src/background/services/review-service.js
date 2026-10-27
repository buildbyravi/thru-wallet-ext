// The ONE transaction-review service (contract v29: tx.prepareReview / tx.confirmReview).
//
// Pipeline, adapted to the wallet's existing lifecycle rather than replacing it:
//
//   intent  (kind + typed params, from any feature)
//     -> validate        (kind spec + the feature's own existing validators)
//     -> prepare         (facts read here, without signing)
//     -> decode/explain  (one registry, src/shared/tx-review/decoders)
//     -> review          (the canonical envelope the shared UI renders)
//     -> authenticate    (the existing router auth: signing + optional password re-auth)
//     -> sign/submit     (the existing handler for that operation — never a new one)
//     -> reconcile       (the existing pending-tx tracker, untouched)
//
// What this service deliberately does NOT do:
//   - it never signs, builds a transaction, or holds key material;
//   - it never invents a fee, a balance change or a "safe" verdict;
//   - it never guesses a decoder for an unknown operation type.
//
// `tx.confirmReview` is the revalidation gate: it re-checks TTL, the binding hash, the active
// account/network and the kind's cheap chain facts, then returns the exact submit instructions
// recorded at prepare time. Because the signing handler re-verifies its own reviewed facts as
// well, a stale or tampered review cannot authorise a different transaction.

import { getActiveNetworkConfig } from './network-service.js';
import * as accountService from './account-service.js';
import * as preferencesService from './preferences-service.js';
import * as txService from './tx-service.js';
import { getMethodSpec } from '../../shared/contract/manifest.js';
import {
  TX_REVIEW_VERSION, TX_REVIEW_TTL_MS, REVIEW_ERROR_CODES,
  assertReview, stateFromWarnings, bindingPayload, acknowledgementsSatisfied,
} from '../../shared/tx-review/model.js';
import '../../shared/tx-review/decoders/index.js';
import { decodeReview, listDecoderKinds } from '../../shared/tx-review/registry.js';
import { getKind, listKinds } from './review/kinds.js';
import * as store from './review/store.js';

function coded(code, message, retryable = false) {
  const err = new Error(message);
  err.code = code;
  err.retryable = retryable;
  return err;
}

/** Public network projection — the review never carries internal BigInt fields. */
function publicNetwork(network) {
  return {
    id: network.id,
    label: network.label,
    environment: network.environment ?? null,
    isTestnet: Boolean(network.isTestnet),
  };
}

/** Deterministic hash over the facts the user is approving. */
async function bindingHashOf(payload) {
  const canonical = JSON.stringify(payload);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Simulation status with provenance. Today the wallet answers `{ supported:false }` from the
 * one capability stub (tx.simulate) because Thru has no verified dry-run RPC; that answer flows
 * through unchanged so the review can never imply a simulation happened.
 */
async function simulationBlock() {
  const checkedAt = Date.now();
  try {
    const result = await txService.simulate();
    if (result?.supported === true && result.changes != null) {
      return {
        status: 'supported',
        reason: '',
        provenance: 'tx.simulate',
        checkedAt,
        changes: result.changes,
      };
    }
    return {
      status: 'unavailable',
      reason: result?.reason || 'Simulation is not supported on this network.',
      provenance: 'tx.simulate (capability stub)',
      checkedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error?.message || 'Simulation failed.',
      provenance: 'tx.simulate',
      checkedAt,
    };
  }
}

function submitPolicyFor(submit, prefs) {
  if (!submit?.method) return null;
  const spec = getMethodSpec(submit.method);
  if (!spec) {
    // A kind naming a method the contract does not declare is a programming error; refuse
    // rather than produce a review whose confirm button cannot work.
    throw coded('INTERNAL', `review submit method '${submit.method}' is not in the contract`);
  }
  const auth = spec.auth === 'signing' ? 'signing' : 'unlocked';
  return {
    method: submit.method,
    auth,
    // Same policy the router will enforce: a signing call needs the password only when the
    // user enabled per-signature re-authentication (D-003 keeps session signing as default).
    passwordRequired: auth === 'signing' && prefs.requirePasswordForSigning !== false,
  };
}

function reviewIdFor(networkId) {
  return `${networkId}_r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * tx.prepareReview — build the canonical review for a typed intent.
 *
 * Returns `{ supported:false, reason }` for an operation type with no decoder; every other
 * failure is a coded error the feature surfaces verbatim.
 */
export async function prepareReview({ kind, params = {} } = {}) {
  const kindId = typeof kind === 'string' ? kind : '';
  if (!kindId) throw coded('INVALID_INPUT', 'kind is required');
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    throw coded('INVALID_INPUT', 'params must be an object');
  }

  const spec = getKind(kindId);
  if (!spec) {
    return {
      supported: false,
      kind: kindId,
      reason: REVIEW_ERROR_CODES.KIND_UNSUPPORTED,
      detail: `No transaction-review decoder is registered for '${kindId}'.`,
      knownKinds: listKinds(),
    };
  }

  const account = await accountService.getActiveAccount();
  if (!account?.address) throw coded('ACCOUNT_MISSING', 'No active account — unlock the wallet first.');
  const network = await getActiveNetworkConfig();
  const prefs = await preferencesService.getPreferences();

  // Facts are read through the operation's own existing reads (no new protocol code).
  const rawFacts = await spec.facts(params, { account, network });
  const facts = {
    ...rawFacts,
    networkId: network.id,
    networkLabel: network.label,
  };
  if (!facts.fromAddress) facts.fromAddress = account.address;
  if (facts.fromLabel === undefined) facts.fromLabel = account.label ?? null;

  const publicNet = publicNetwork(network);
  const content = decodeReview(kindId, {
    network: publicNet,
    account: { address: account.address, label: account.label ?? null },
    facts,
  });

  // The method/auth are fixed now; the exact params are rebuilt at confirm time so an
  // accepted acknowledgement (e.g. "send the duplicate anyway") reaches the handler.
  const submit = typeof spec.submit === 'function'
    ? spec.submit(facts, { acknowledgements: content.acknowledgements.map((ack) => ack.id) })
    : null;
  const submitPolicy = submitPolicyFor(submit, prefs);
  const state = submitPolicy ? stateFromWarnings(content.warnings) : 'blocked';

  const preparedAt = Date.now();
  const reviewId = reviewIdFor(network.id);
  const assets = content.assets;
  const bindingHash = await bindingHashOf(bindingPayload({
    kind: kindId,
    facts,
    accountAddress: account.address,
    networkId: network.id,
  }));

  const review = {
    reviewVersion: TX_REVIEW_VERSION,
    reviewId,
    kind: kindId,
    state,
    createdAt: preparedAt,
    expiresAt: preparedAt + TX_REVIEW_TTL_MS,
    bindingHash,
    network: publicNet,
    account: { address: account.address, label: account.label ?? null },
    protocol: content.protocol ?? null,
    operation: content.operation,
    summary: content.summary,
    assets: {
      outgoing: assets.outgoing,
      incoming: assets.incoming,
      fee: assets.fee,
      balanceAfter: null,
      balanceAfterNote: assets.balanceAfterNote,
    },
    execution: content.execution,
    warnings: content.warnings,
    acknowledgements: content.acknowledgements,
    simulation: await simulationBlock(),
    submitPolicy,
  };

  assertReview(review);

  await store.put(network.id, {
    reviewId,
    kind: kindId,
    networkId: network.id,
    accountAddress: account.address,
    bindingHash,
    facts,
    params,
    method: submit?.method ?? null,
    acknowledgements: review.acknowledgements,
    preparedAt,
    expiresAt: review.expiresAt,
  });

  return {
    supported: true,
    reviewId,
    bindingHash,
    expiresAt: review.expiresAt,
    review,
  };
}

/**
 * tx.confirmReview — revalidate a prepared review and hand back the exact submit instructions.
 *
 * It does not sign and it does not consume the review (a wrong password or a cancelled password
 * dialog must not force the user to re-review), but every call re-checks freshness. The actual
 * duplicate/context guards live in the signing handler, which this cannot bypass.
 */
export async function confirmReview({ reviewId, bindingHash, acknowledgements = [] } = {}) {
  if (typeof reviewId !== 'string' || !reviewId) throw coded('INVALID_INPUT', 'reviewId is required');
  if (typeof bindingHash !== 'string' || !bindingHash) throw coded('INVALID_INPUT', 'bindingHash is required');

  const network = await getActiveNetworkConfig();
  const record = await store.get(network.id, reviewId);
  if (!record) {
    throw coded(REVIEW_ERROR_CODES.REVIEW_NOT_FOUND,
      'This review is no longer available on the active network. Review the transaction again.');
  }
  if (record.expired) {
    throw coded(REVIEW_ERROR_CODES.REVIEW_EXPIRED,
      'This review expired before it was signed. Review the transaction again.', true);
  }
  if (record.bindingHash !== bindingHash) {
    throw coded(REVIEW_ERROR_CODES.BINDING_MISMATCH,
      'These transaction details do not match the review that was prepared.');
  }

  const account = await accountService.getActiveAccount();
  if (!account?.address || account.address !== record.accountAddress) {
    throw coded(REVIEW_ERROR_CODES.REVIEW_CONTEXT_CHANGED,
      'The active account changed after this review. Review the transaction again.');
  }
  if (record.networkId !== network.id) {
    throw coded(REVIEW_ERROR_CODES.REVIEW_CONTEXT_CHANGED,
      'The active network changed after this review. Review the transaction again.');
  }

  const spec = getKind(record.kind);
  if (!spec || !record.method || typeof spec.submit !== 'function') {
    throw coded(REVIEW_ERROR_CODES.NOT_EXECUTABLE,
      'This review is display-only and cannot be signed.');
  }

  // The required acknowledgements are the ones the prepared review actually displayed.
  const requiredAcks = Array.isArray(record.acknowledgements) ? record.acknowledgements : [];
  if (requiredAcks.length && !acknowledgementsSatisfied({ acknowledgements: requiredAcks }, acknowledgements)) {
    throw coded(REVIEW_ERROR_CODES.ACKNOWLEDGEMENT_REQUIRED,
      'This review requires an explicit acknowledgement before signing.');
  }

  // Cheap, kind-specific freshness re-verification (price / lease / fee / faucet budget).
  if (typeof spec.recheck === 'function') {
    await spec.recheck(record);
  }

  const prefs = await preferencesService.getPreferences();
  const submit = spec.submit(record.facts, { acknowledgements });
  if (!submit?.method || submit.method !== record.method) {
    throw coded(REVIEW_ERROR_CODES.NOT_EXECUTABLE,
      'This review can no longer produce its submit instructions. Review the transaction again.');
  }
  const submitPolicy = submitPolicyFor(submit, prefs);

  return {
    reviewId,
    kind: record.kind,
    submit,
    submitPolicy,
    revalidatedAt: Date.now(),
    expiresAt: record.expiresAt,
  };
}

/** Drop a review (a cancelled confirmation, or one the feature replaced). */
export async function discardReview({ reviewId } = {}) {
  if (typeof reviewId !== 'string' || !reviewId) throw coded('INVALID_INPUT', 'reviewId is required');
  const network = await getActiveNetworkConfig();
  await store.remove(network.id, reviewId);
  return { reviewId, discarded: true };
}

/** Diagnostics for the platform: the decoder registry and the kind table must agree. */
export function reviewCapabilities() {
  const decoders = listDecoderKinds();
  const kinds = listKinds();
  return {
    version: TX_REVIEW_VERSION,
    kinds,
    decoders,
    consistent: kinds.length === decoders.length
      && kinds.every((kind) => decoders.includes(kind)),
    ttlMs: TX_REVIEW_TTL_MS,
  };
}
