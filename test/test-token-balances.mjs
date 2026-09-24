// Service-level send/ledger checks without a public RPC or a signing key.
// The port shape stays the same: absent token account = proven zero; a failed balance OR
// unverified mint denomination = unknown and unsendable. Several registered mints must not
// be fetched serially, nor may a long registry open an unbounded number of RPC sockets.
import assert from 'node:assert/strict';
import { readRegisteredTokenBalances } from '../src/background/services/token-service.js';
import { formatTokenAmount } from '../src/shared/format.js';

const registry = (ids) => ids.map((id) => ({
  mintAddress: id, symbol: `LOCAL-${id}`, name: `Token ${id}`,
  decimals: 9, imageUrl: '', hidden: false, source: 'imported',
}));

console.log('[token balances] distinguish verified value, proven zero and unknown');
const mintReads = [];
const mixed = await readRegisteredTokenBalances('owner', registry([
  'funded', 'absent', 'empty', 'offline', 'mint-offline', 'mint-missing', 'mint-invalid', 'bad-units',
]), {
  readBalance: async (_owner, mintAddress) => {
    if (mintAddress === 'offline') throw new Error('RPC unavailable');
    if (mintAddress === 'absent') return { tokenAccount: mintAddress, exists: false, amount: null };
    if (mintAddress === 'empty') return { tokenAccount: mintAddress, exists: true, amount: 0n };
    if (mintAddress === 'bad-units') return { tokenAccount: mintAddress, exists: true, amount: -1n };
    return { tokenAccount: mintAddress, exists: true, amount: 123456789n };
  },
  readMint: async (mintAddress) => {
    mintReads.push(mintAddress);
    if (mintAddress === 'mint-offline') throw new Error('mint node timed out');
    if (mintAddress === 'mint-missing') return { exists: false };
    if (mintAddress === 'mint-invalid') return { exists: true, decimals: 19 };
    return { exists: true, decimals: 6, ticker: 'CHAIN' };
  },
});
const byMint = new Map(mixed.balances.map((row) => [row.mintAddress, row]));
assert.equal(mixed.balances.length, 8);
assert.equal(mixed.anyError, true);
assert.deepEqual(mixed.balances.map((row) => row.mintAddress), [
  'funded', 'absent', 'empty', 'offline', 'mint-offline', 'mint-missing', 'mint-invalid', 'bad-units',
]);
assert.equal(byMint.get('funded').amountUnits, '123456789');
assert.equal(byMint.get('funded').decimals, 6, 'chain decimals override imported metadata');
assert.equal(byMint.get('funded').symbol, 'CHAIN', 'chain ticker overrides imported metadata');
assert.equal(formatTokenAmount(BigInt(byMint.get('funded').amountUnits), byMint.get('funded').decimals),
  '123.456789', 'the user sees the correctly denominated amount before entering Send');
assert.equal(byMint.get('absent').tokenAccountExists, false);
assert.equal(byMint.get('absent').amountUnits, null);
assert.equal(byMint.get('absent').error, false, 'absent is a proven zero, not an error');
assert.equal(byMint.get('empty').tokenAccountExists, true);
assert.equal(byMint.get('empty').amountUnits, '0');
assert.equal(byMint.get('empty').error, false);
for (const id of ['offline', 'mint-offline', 'mint-missing', 'mint-invalid', 'bad-units']) {
  assert.equal(byMint.get(id).amountUnits, null, `${id} must not pretend to know the raw balance`);
  assert.equal(byMint.get(id).error, true, `${id} must not be sendable`);
}
assert.equal(byMint.get('mint-offline').tokenAccountExists, true,
  'a verified token account still exists, but the denomination is unknown');
assert.deepEqual(mintReads.sort(), ['funded', 'mint-invalid', 'mint-missing', 'mint-offline'].sort(),
  'zero balances and failed account reads require no mint RPC');
console.log('  ok - no registry decimals are used for a positive balance without a live mint');

console.log('[token balances] bounded concurrent RPC, stable list order under out-of-order replies');
let inFlight = 0;
let peak = 0;
const started = [];
const gates = new Map();
const running = readRegisteredTokenBalances('owner', registry(Array.from({ length: 11 }, (_, i) => `mint-${i}`)), {
  readBalance: async (_owner, mintAddress) => {
    started.push(mintAddress);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    return new Promise((resolve) => {
      gates.set(mintAddress, () => {
        inFlight -= 1;
        resolve({ tokenAccount: mintAddress, exists: true, amount: 0n });
      });
    });
  },
  readMint: async () => { throw new Error('Zero requires no mint read'); },
});
assert.equal(started.length, 4, 'four RPC reads may start before any finishes');
for (let i = 0; i < 11; i += 1) {
  const id = started[i] || `mint-${i}`;
  assert.equal(gates.has(id), true, `mint ${id} should have started`);
  gates.get(id)();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(inFlight <= 4, 'concurrency must stay bounded');
}
const bounded = await running;
assert.equal(started.length, 11);
assert.equal(peak, 4, 'a slow first read must not serialize other mints');
assert.deepEqual(bounded.balances.map((row) => row.mintAddress),
  Array.from({ length: 11 }, (_, i) => `mint-${i}`));
assert.equal(bounded.anyError, false);
assert.ok(bounded.balances.every((row) => row.amountUnits === '0' && row.error === false));
assert.deepEqual(await readRegisteredTokenBalances('owner', []), { balances: [], anyError: false });
console.log('  ok - eleven mints were checked with at most four concurrent reads');

console.log('[send intent] in-flight guard includes chain and mint, releases after failure');
const { beginTransfer } = await import('../src/background/services/pending-tx-service.js');
const intent = { networkId: 'alphanet', from: 'sender', to: 'recipient', amountUnits: '100' };
const releaseNative = beginTransfer(intent);
assert.throws(() => beginTransfer(intent), (error) => error.code === 'DUPLICATE_SUBMISSION');
const releaseMintA = beginTransfer({ ...intent, mint: 'mint-a' });
const releaseMintB = beginTransfer({ ...intent, mint: 'mint-b' });
const releaseOtherNetwork = beginTransfer({ ...intent, networkId: 'localnet' });
assert.throws(() => beginTransfer({ ...intent, mint: 'mint-a' }),
  (error) => error.code === 'DUPLICATE_SUBMISSION');
releaseMintA();
releaseMintB();
releaseOtherNetwork();
releaseNative();
const releaseRetry = beginTransfer(intent);
releaseRetry();
console.log('  ok - the same intent cannot run twice, while distinct mints/networks remain independent');
