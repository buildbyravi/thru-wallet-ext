// The ONE confirm → authenticate → submit path for a prepared review.
//
// Every feature calls this instead of talking to a signing method directly. It performs the
// three steps that must never diverge between screens:
//
//   1. `tx.confirmReview` revalidates the prepared review in the background (TTL, binding
//      hash, active account, active network, acknowledgements, cheap chain facts) and returns
//      the EXACT submit instructions. The UI cannot invent its own method or params.
//   2. Authentication follows the existing policy: the background's submitPolicy says whether
//      a password is required (D-003 session-only signing by default), and the existing
//      password prompt collects it. Nothing here stores or logs the password.
//   3. Submission goes to the operation's own signing method with the review's params, so
//      every existing guard (signing guard, duplicate submission, re-reads) still runs.
//
// It deliberately does NOT render success or error UI: each feature owns its own post-submit
// screen, and error copy depends on whether the request was sent (a bridge timeout is not a
// failed signature).

import * as bridge from '../../app/bridge.js';
import { requirePassword } from '../password-prompt.js';

/** Codes that mean "the review you are looking at is no longer the transaction". */
const STALE_CODES = new Set([
  'REVIEW_NOT_FOUND',
  'REVIEW_EXPIRED',
  'BINDING_MISMATCH',
  'REVIEW_CONTEXT_CHANGED',
  'REVIEW_PRICE_CHANGED',
  'REVIEW_EXPIRY_CHANGED',
  'REVIEW_FEE_CHANGED',
  'REVIEW_TOKEN_CHANGED',
  'REVIEW_REGISTRAR_CHANGED',
  'REVIEW_FAUCET_CHANGED',
  'REVIEW_UNAVAILABLE',
  'NAME_TAKEN',
  'LEASE_NOT_FOUND',
  'LEASE_NOT_EXPIRED',
  'NOT_NAME_OWNER',
]);

const SIGNING_FAILURE_CODES = new Set([
  'SERVICE_TIMEOUT',
  'PORT_ERROR',
  'NO_RESPONSE',
  'SIGNING_IN_PROGRESS',
]);

/**
 * Confirm a prepared review, authenticate if required, and submit it.
 *
 * @param {Object} options
 *   review          the envelope rendered to the user
 *   acknowledgements  the acknowledgement ids the user ticked
 *   passwordTitle / passwordBody / confirmLabel  copy for the re-auth prompt
 * @returns {Promise<{ status: 'submitted', result: any }
 *   | { status: 'cancelled' }>}
 * @throws the background's coded error (see classifyReviewError)
 */
export async function submitReviewedReview({
  review,
  acknowledgements = [],
  passwordTitle = 'Confirm transaction',
  passwordBody = 'Re-enter your wallet password to sign and broadcast this transaction.',
  confirmLabel = null,
} = {}) {
  if (!review?.reviewId || !review?.bindingHash) {
    throw Object.assign(new Error('This review is missing its binding. Review the transaction again.'), {
      code: 'REVIEW_NOT_FOUND',
    });
  }

  let confirmed;
  try {
    confirmed = await bridge.send('tx.confirmReview', {
      reviewId: review.reviewId,
      bindingHash: review.bindingHash,
      acknowledgements,
    });
  } catch (error) {
    // Phase matters: a timeout while REVALIDATING is not a submitted transaction.
    if (error && typeof error === 'object') error.phase = 'confirm';
    throw error;
  }
  const { submit, submitPolicy } = confirmed ?? {};
  if (!submit?.method) {
    throw Object.assign(new Error('This review cannot be signed.'), { code: 'NOT_EXECUTABLE' });
  }

  const send = (password) => bridge.send(
    submit.method,
    password ? { ...submit.params, password } : { ...submit.params },
  );

  const guardedSend = async (password) => {
    try {
      return await send(password);
    } catch (error) {
      if (error && typeof error === 'object') error.phase = 'submit';
      throw error;
    }
  };

  if (!submitPolicy?.passwordRequired) {
    return { status: 'submitted', result: await guardedSend() };
  }

  const result = await requirePassword({
    title: passwordTitle,
    body: passwordBody,
    confirmLabel: confirmLabel || review.operation?.confirmLabel || 'Confirm',
    verify: (password) => guardedSend(password),
  });
  if (result == null) return { status: 'cancelled' };
  return { status: 'submitted', result };
}

/**
 * Turn a background/bridge error into the one thing the UI needs to know.
 *
 * @returns {{ kind: 'stale'|'blocked'|'uncertain'|'failed', message: string }}
 *   stale     the review no longer matches; prepare it again before signing
 *   blocked   the handler refused on a rule (duplicate, context, balance); show its message
 *   uncertain the request may have been broadcast; never invite an immediate retry
 *   failed    a definite failure
 */
export function classifyReviewError(error, { submitted = false, uncertainMessage = null } = {}) {
  const code = error?.code ?? '';
  // A timeout while revalidating never reached the chain, so it must not read as "maybe sent".
  const sent = submitted || error?.phase === 'submit';
  if (STALE_CODES.has(code)) {
    return { kind: 'stale', message: error.message || 'This transaction changed. Review it again.' };
  }
  if (sent && (SIGNING_FAILURE_CODES.has(code) || error?.retryable === true)) {
    return {
      kind: 'uncertain',
      message: uncertainMessage
        || 'Could not confirm whether this transaction was submitted. Check Activity and the '
          + 'explorer before trying again.',
    };
  }
  if (code === 'BAD_PASSWORD' || code === 'INVALID_PASSWORD') {
    return { kind: 'blocked', message: error.message || 'Incorrect password.' };
  }
  return { kind: 'failed', message: error?.message || 'The transaction failed.' };
}

/** Drop a prepared review (cancelled or replaced). Failure here is not user-visible. */
export function discardReview(reviewId) {
  if (!reviewId) return Promise.resolve();
  return bridge.send('tx.discardReview', { reviewId }).catch(() => {});
}
