// Diagnostic for the faucet 'account not found' failure. Read-mostly.
//   node scripts/diagnose-faucet.mjs [networkId]

import { keys, Pubkey } from '@thru/sdk';
import * as client from '../src/lib/thru-client.js';
import { getNetworkConfig } from '../src/lib/networks.js';

const networkId = process.argv[2] || 'alphanet';
const network = getNetworkConfig(networkId);
client.configureNetwork(network);

console.log(`Diagnosing faucet on ${network.label} (${network.rpcUrl})\n`);

// 1. Does the faucet STATE account exist on-chain? If not, the address is wrong.
console.log('--- faucet state account ---');
console.log(`  configured: ${network.faucetStateAccount}`);
const state = await client.getAccountInfo(network.faucetStateAccount);
console.log(`  exists: ${state.exists}`);
if (state.exists) console.log(`  balance: ${state.balance}`);
else console.log(`  error: ${state.error?.message || 'n/a'}`);

// 2. Does the faucet PROGRAM account exist?
console.log('\n--- faucet program account ---');
console.log(`  configured: ${network.faucetProgramId}`);
const prog = await client.getAccountInfo(network.faucetProgramId);
console.log(`  exists: ${prog.exists}`);

// 3. Also check the OLD (invalid-length) value, in case the chain uses a different one entirely.
console.log('\n--- transfer program account ---');
const xfer = await client.getAccountInfo(network.transferProgramId);
console.log(`  ${network.transferProgramId}`);
console.log(`  exists: ${xfer.exists}`);

// 4. Now the decisive test: does creating the fee-payer account first make the claim work?
//    claimFaucet does NOT call createOnChainAccount, while sendTransfer DOES. If this works,
//    that asymmetry is the bug.
console.log('\n--- claim after explicitly creating the fee payer ---');
const kp = await keys.generateKeyPair();
const address = Pubkey.from(kp.publicKey).toThruFmt();
const me = { publicKey: kp.publicKey, privateKey: kp.privateKey, address };
console.log(`  throwaway: ${address}`);

try {
  console.log('  calling createOnChainAccount...');
  await client.createOnChainAccount(me);
  console.log('  created.');
} catch (error) {
  console.log(`  createOnChainAccount FAILED: ${error.message}`);
}

await new Promise((r) => setTimeout(r, 2000));
const afterCreate = await client.getAccountInfo(address);
console.log(`  account exists now: ${afterCreate.exists}, balance=${afterCreate.balance}`);

try {
  const sig = await client.claimFaucet(me, 10_000n);
  console.log(`  CLAIM SUCCEEDED: ${sig}`);
  await new Promise((r) => setTimeout(r, 2500));
  const post = await client.getAccountInfo(address);
  const delta = post.balance - afterCreate.balance;
  console.log(`  balance delta: ${delta} base units`);
  console.log('');
  console.log('  VERDICT: claimFaucet needs the account to exist first. sendTransfer already');
  console.log('           calls createOnChainAccount; claimFaucet does not. That asymmetry is');
  console.log('           the bug, and it hits any brand-new wallet that taps Faucet first.');
  if (delta === 10_000n) {
    console.log('  UNITS:   asked 10000, received 10000 base units -> the field IS base units.');
  } else if (delta === 10_000n * 1_000_000_000n) {
    console.log('  UNITS:   asked 10000, received 1e13 base units -> the field is WHOLE THRU.');
  } else {
    console.log(`  UNITS:   asked 10000, received ${delta} -> inconclusive, investigate.`);
  }
} catch (error) {
  console.log(`  CLAIM STILL FAILED: ${error.message}`);
  console.log('');
  console.log('  VERDICT: account existence was not the cause. Suspect the faucet state');
  console.log('           account address or the instruction layout.');
}
