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
import { STALE_REVIEW_CODES } from '../../../shared/tx-review/model.js';

// One source of truth for "this review is stale": model.js owns the code list, the background
// throws those codes, and this UI only decides how to present them.
const STALE_CODES = new Set(STALE_REVIEW_CODES);

const SIGNING_FAILURE_CODES = new Set([
  'SERVICE_TIMEOUT',
  'PORT_ERROR',
  'NO_RESPONSE',
  'SIGNING_IN_PROGRESS',
]);

/** Drop a prepared review (cancelled or replaced). Failure here is not user-visible. */
export function discardReview(reviewId) {
  if (!reviewId) return Promise.resolve();
  return bridge.send('tx.discardReview', { reviewId }).catch(() => {});
}

/**
 * Confirm a prepared review, authenticate if required, and submit it.
 *
 * @param {Object} options
 *   review          the envelope rendered to the user
 *   acknowledgements  the acknowledgement ids the user ticked
 *   passwordTitle / passwordBody / confirmLabel  copy for the re-auth prompt
 *   signal          REQUIRED route-lifecycle AbortSignal
 * @returns {Promise<{ status: 'submitted', result: any }
 *   | { status: 'cancelled' }>}
 * @throws the background's coded error (see classifyReviewError)
 *
 * `signal` is required, not optional. A confirmation can sit in the password dialog for as long
 * as the user takes, and the route that opened it can be torn down first (navigate away, popup
 * closed, account switched). Checking `destroyed` after the await is too late: the password has
 * already produced a signature. Two of the three call sites shipped without a signal, so the
 * requirement is enforced here instead of being remembered per route (v31 audit F-3).
 */
export async function submitReviewedReview({
  review,
  acknowledgements = [],
  passwordTitle = 'Confirm transaction',
  passwordBody = 'Re-enter your wallet password to sign and broadcast this transaction.',
  confirmLabel = null,
  signal = null,
} = {}) {
  if (!signal || typeof signal.addEventListener !== 'function') {
    throw Object.assign(
      new Error('A review submission needs a lifecycle signal. This is a programming error.'),
      { code: 'INVALID_REQUEST' },
    );
  }
  if (signal.aborted) return { status: 'cancelled' };
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
  if (signal?.aborted) return { status: 'cancelled' };

  const { submit, submitPolicy, consentToken } = confirmed ?? {};
  if (!submit?.method) {
    throw Object.assign(new Error('This review cannot be signed.'), { code: 'NOT_EXECUTABLE' });
  }
  if (!consentToken) {
    // The background refuses every signing method without one, so this is a contract breach
    // rather than a user condition: the worker that answered did not mint the token this UI
    // requires (a stale build is the usual cause, and nothing was sent). Failing here beats a
    // confusing REVIEW_REQUIRED from the signing call. The user-facing copy states the one thing
    // that can work — a fresh review — and `detail` keeps the diagnostic out of the screen.
    throw Object.assign(new Error('This review cannot be signed. Start the review again.'), {
      code: 'REVIEW_REQUIRED',
      detail: 'tx.confirmReview returned no consentToken',
    });
  }

  // The token is bound to this method and these params. `password` is added after the binding
  // (the consent hash excludes it), so a password-gated submit spends the same token once.
  const send = (password) => bridge.send(
    submit.method,
    password
      ? { ...submit.params, consentToken, password }
      : { ...submit.params, consentToken },
  );

  const guardedSend = async (password) => {
    try {
      return await send(password);
    } catch (error) {
      if (error && typeof error === 'object') error.phase = 'submit';
      throw error;
    }
  };

  // A review is SINGLE-USE once it has produced a signature. Discarding it here (rather than
  // leaving it to expire) means a second confirm of the same reviewId cannot replay the same
  // transaction inside its TTL — the handler's own duplicate guard stays the second line of
  // defence, not the only one. A FAILED submit deliberately keeps the review: retrying a
  // definite failure from the same reviewed facts is safe and saves a re-read.
  const settle = async (result) => {
    await discardReview(review.reviewId);
    return { status: 'submitted', result };
  };

  if (!submitPolicy?.passwordRequired) {
    return settle(await guardedSend());
  }

  const outcome = await requirePassword({
    title: passwordTitle,
    body: passwordBody,
    confirmLabel: confirmLabel || review.operation?.confirmLabel || 'Confirm',
    signal,
    verify: async (password) => {
      try {
        return { result: await guardedSend(password) };
      } catch (error) {
        // Only authentication errors stay in the password dialog. A submitted or stale
        // transaction must return to the route, never become a password retry.
        if (['AUTH_REQUIRED', 'AUTH_FAILED', 'AUTH_LOCKED_OUT', 'INVALID_PASSWORD'].includes(error?.code)) {
          throw error;
        }
        return { error };
      }
    },
  });
  if (outcome == null) return { status: 'cancelled' };
  if (outcome.error) throw outcome.error;
  return settle(outcome.result);
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
  // Not a code the background throws for a changed chain fact, but the same consequence: the
  // wallet answered a confirmed review without the one-time token it mints, so THIS review can
  // never produce a signature. Nothing was sent, so it is not `failed`, and no rule refused it,
  // so it is not `blocked`. The remedy is a fresh review, which is what `stale` means to every
  // caller — and it keeps the raw contract breach off the screen (docs/DEFECT_LOG.md §22).
  if (code === 'REVIEW_REQUIRED') {
    // The background's own refusals carry the specific reason ("These transaction details changed
    // after the review…"); the message above only stands in for a reply with no token at all.
    return {
      kind: 'stale',
      message: error?.message || 'This review cannot be signed. Start the review again.',
    };
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

