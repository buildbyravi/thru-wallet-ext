// The decoder registration point. Importing this module registers every shipped decoder, so
// both the background and the tests get exactly the same set.
//
// Adding an operation type:
//   1. new decoder file returning validated review content from facts;
//   2. `registerDecoder(KIND, decode)` here;
//   3. a kind spec in src/background/services/review/kinds.js (facts + recheck + submit);
//   4. a decoder test proving known, unknown and malformed facts;
//   5. wire the feature's UI through the shared confirm flow — never a bespoke screen.
//
// A kind in the registry without a background spec (or the reverse) fails
// test/test-tx-review.mjs, because a decoder nobody can prepare — or a submit path with no
// decoder — is exactly the drift this registry exists to prevent.

import { registerDecoder } from '../registry.js';
import { NATIVE_SEND_KIND, decodeNativeSend } from './native-send.js';
import { TOKEN_TRANSFER_KIND, decodeTokenTransfer } from './token-transfer.js';
import {
  DOMAIN_REGISTER_KIND, decodeDomainRegister,
  DOMAIN_PURCHASE_KIND, decodeDomainPurchase,
  DOMAIN_RENEW_KIND, decodeDomainRenew,
  DOMAIN_CLAIM_KIND, decodeDomainClaim,
} from './domain.js';
import { FAUCET_CLAIM_KIND, decodeFaucetClaim } from './faucet-claim.js';
import { RAW_KIND, decodeRawTransaction } from './raw.js';

registerDecoder(NATIVE_SEND_KIND, decodeNativeSend);
registerDecoder(TOKEN_TRANSFER_KIND, decodeTokenTransfer);
registerDecoder(DOMAIN_REGISTER_KIND, decodeDomainRegister);
registerDecoder(DOMAIN_PURCHASE_KIND, decodeDomainPurchase);
registerDecoder(DOMAIN_RENEW_KIND, decodeDomainRenew);
registerDecoder(DOMAIN_CLAIM_KIND, decodeDomainClaim);
registerDecoder(FAUCET_CLAIM_KIND, decodeFaucetClaim);
registerDecoder(RAW_KIND, decodeRawTransaction);

export {
  NATIVE_SEND_KIND, TOKEN_TRANSFER_KIND,
  DOMAIN_REGISTER_KIND, DOMAIN_PURCHASE_KIND, DOMAIN_RENEW_KIND, DOMAIN_CLAIM_KIND,
  FAUCET_CLAIM_KIND, RAW_KIND,
};
