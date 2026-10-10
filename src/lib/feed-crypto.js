// Feed-record crypto adapter (G1-B) — the protocol-package containment seam for signed feed
// records. Layering keeps @thru/sdk imports inside src/lib adapters so services consume a
// stable application interface; this module is the only feed surface that knows how the
// signature primitives are spelled.
//
// Records verify with the same domain-separated Ed25519 the chain uses, over the OFF-CHAIN
// message domain (SignatureDomain.MSG): a feed record can never be replayed as a transaction,
// and verification inherits the SDK's strict canonical checks (non-canonical A/R, small-order
// points, non-canonical S are all rejected before the equation runs).

import { SignatureDomain, verifyWithDomain } from '@thru/sdk';

/**
 * Verify one signed feed record body.
 * @param {Uint8Array} signature 64-byte Ed25519 signature
 * @param {Uint8Array} message   canonical record body bytes (defi/feed-record.encodeRecordBody)
 * @param {Uint8Array} publicKey publisher's 32-byte key
 * @returns {Promise<boolean>}
 */
export function verifyFeedSignature(signature, message, publicKey) {
  return verifyWithDomain(signature, message, publicKey, SignatureDomain.MSG);
}
