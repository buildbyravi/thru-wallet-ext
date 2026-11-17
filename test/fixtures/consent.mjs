// Test-side consent minting.
//
// The router refuses every value-moving method without a token that `tx.confirmReview` minted
// (src/background/services/review/consent.js). Most suites here exercise what happens AFTER that
// gate — duplicate submission, registrar re-reads, race handling — and preparing a real review
// would mean stubbing a whole chain read they do not otherwise touch. So they mint directly.
//
// Why this is not a hole in the product: a page cannot do this. Minting is not a bridge method,
// it is a module import inside the worker's own graph, and test-review-consent.mjs asserts that
// no contract method can reach it. The gate itself is tested there against a fresh router with no
// helper at all, so the protection is measured without this file in the loop.

import { mintConsent } from '../../src/background/services/review/consent.js';
import * as accountService from '../../src/background/services/account-service.js';
import { getActiveNetworkConfig } from '../../src/background/services/network-service.js';

/**
 * Mint a consent token for a call a test is about to make through `handleApiRequest`.
 * @param {string} method
 * @param {object} params the exact params that will be sent (minus consentToken)
 * @param {{ accountAddress?: string, networkId?: string }} [context] override the binding
 */
export async function consentFor(method, params, context = {}) {
  const accountAddress = context.accountAddress
    ?? (await accountService.getActiveAccount())?.address
    ?? null;
  const networkId = context.networkId ?? (await getActiveNetworkConfig())?.id ?? null;
  return mintConsent({ method, params, accountAddress, networkId, reviewId: 'test-minted' });
}

/** Send a value-moving method with a freshly minted token bound to these exact params. */
export async function sendWithConsent(handleApiRequest, method, params = {}, context = {}) {
  const consentToken = await consentFor(method, params, context);
  return handleApiRequest({ method, params: { ...params, consentToken } });
}
