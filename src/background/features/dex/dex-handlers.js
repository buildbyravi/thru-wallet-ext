// Dex router registrations (M0). One file maps contract methods to the feature service, which
// is all api-router.js imports from the feature — thin seam, no logic here.
//
// Note the quarantine history: the legacy fake-swap UI was deleted, not flagged off
// (test/test-launchpad-quarantine.mjs). These handlers exist only as part of the reviewed M0
// contract drop, answer unsupported in this build, and can never fabricate a quote — there is
// no price math in the feature at all.

import * as dexService from './dex-service.js';

export const dexHandlers = Object.freeze({
  'dex.listPools': ({ networkId, assetId, cursor, limit } = {}) => dexService.listPools({ networkId, assetId, cursor, limit }),
  'dex.getPool': ({ poolId } = {}) => dexService.getPool({ poolId }),
  'dex.positions': ({ address, networkId } = {}) => dexService.listPositions({ address, networkId }),
  'dex.quote': (params = {}) => dexService.quoteSwap(params),
  'dex.quoteLiquidity': (params = {}) => dexService.quoteLiquidity(params),
  'dex.prepareSwap': ({ quoteId, clientRequestId } = {}) => dexService.prepareSwap({ quoteId, clientRequestId }),
  'dex.prepareLiquidity': ({ quoteId, clientRequestId } = {}) => dexService.prepareLiquidity({ quoteId, clientRequestId }),
});
