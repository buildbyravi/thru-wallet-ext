// The native THRU faucet has no per-account rate-limit policy. Keep the legacy API explicit
// and ensure the review decoder does not turn a THRUSD-only policy into a native-faucet warning.
import assert from 'node:assert/strict';
import { getFaucetLimit } from '../src/background/services/tx-service.js';
import { decodeFaucetClaim } from '../src/shared/tx-review/decoders/faucet-claim.js';

const limit = await getFaucetLimit();
assert.deepEqual(limit, {
  supported: false,
  applicable: false,
  reason: 'native-faucet-not-rate-limited',
});

const review = decodeFaucetClaim({
  facts: {
    fromAddress: 'taSender111111111111111111111111111111111111111',
    fromLabel: 'Main account',
    amountUnits: '10000',
    capUnits: '10000',
    accountExists: true,
    fee: { supported: false, reason: 'The faucet claim path does not report a charged fee.' },
    programAddress: 'taFaucet111111111111111111111111111111111111111',
    vaultAddress: 'taVault111111111111111111111111111111111111111',
  },
});
assert.equal(review.warnings.some(({ id }) => id.includes('faucet-') || id.includes('limit')), false);
assert.equal(review.assets.incoming[0].note, 'Paid by the native faucet.');
assert.equal(review.execution.instructions[0].note, 'The network pays the amount shown to your account.');
assert.equal(review.summary.length, 0);

console.log('Native faucet has no per-account rate-limit readout or review warning.');
