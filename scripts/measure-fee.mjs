// Measures the actual transfer fee on a live network.
//
// Context: a transfer of 1 base unit from an account holding 10,000 base units reverted with
// vmError=-765. thru-client does not override header.fee for transfers, so the SDK's default fee
// applies and the sender needs amount + fee. If the default fee exceeds ~10,000 base units, that
// revert is simply insufficient balance — which would mean the Send screen's hardcoded 10,000
// unit "gas reserve" is too small and MAX would build a transaction that always fails.
//
// This funds an account with repeated faucet claims, then sends the smallest possible amount and
// measures spent - amount.
//
//   node scripts/measure-fee.mjs [networkId] [claims]

import { keys, Pubkey } from '@thru/sdk';
import * as client from '../src/lib/thru-client.js';
import { getNetworkConfig } from '../src/lib/networks.js';
import { formatThru } from '../src/shared/format.js';

const networkId = process.argv[2] || 'alphanet';
const claims = Number(process.argv[3] || 12);
const network = getNetworkConfig(networkId);
client.configureNetwork(network);

const CAP = network.faucetMaxPerClaim ?? 10_000n;

console.log(`Measuring transfer fee on ${network.label}`);
console.log(`Funding with ${claims} faucet claims of ${CAP} base units each\n`);

const kp = await keys.generateKeyPair();
const address = Pubkey.from(kp.publicKey).toThruFmt();
const me = { publicKey: kp.publicKey, privateKey: kp.privateKey, address };
console.log(`  sender: ${address}`);

let claimed = 0n;
for (let i = 0; i < claims; i += 1) {
  try {
    await client.claimFaucet(me, CAP);
    claimed += CAP;
    process.stdout.write(`\r  claims: ${i + 1}/${claims} (${claimed} units)   `);
  } catch (error) {
    console.log(`\n  claim ${i + 1} failed: ${error.message}`);
    break;
  }
}
console.log('');

await new Promise((r) => setTimeout(r, 3000));
const before = await client.getAccountInfo(address);
console.log(`  funded balance: ${before.balance} base units (${formatThru(before.balance)} THRU)`);

if (before.balance === 0n) {
  console.log('\n  Could not fund the account. Nothing to measure.');
  process.exit(1);
}

const peerKp = await keys.generateKeyPair();
const peer = Pubkey.from(peerKp.publicKey).toThruFmt();
const SEND = 1n;

console.log(`\n  sending ${SEND} base unit to a fresh address...`);
try {
  const sig = await client.sendTransfer(me, peer, SEND);
  console.log(`  accepted: ${sig}`);

  await new Promise((r) => setTimeout(r, 3000));
  const after = await client.getAccountInfo(address);
  const received = (await client.getAccountInfo(peer)).balance;

  const spent = before.balance - after.balance;
  const fee = spent - SEND;

  console.log('');
  console.log(`  sender before : ${before.balance}`);
  console.log(`  sender after  : ${after.balance}`);
  console.log(`  total spent   : ${spent}`);
  console.log(`  amount sent   : ${SEND}`);
  console.log(`  recipient got : ${received}`);
  console.log('');
  console.log(`  >>> FEE = ${fee} base units (${formatThru(fee)} THRU)`);
  console.log('');

  const RESERVE = 10_000n; // what the Send screen's MAX button currently reserves
  if (fee === 0n) {
    console.log('  Transfers are ZERO-FEE. The MAX button needs no reserve and tx.estimateFee');
    console.log('  can honestly report 0 instead of unsupported.');
  } else if (fee > RESERVE) {
    console.log(`  The fee EXCEEDS the ${RESERVE}-unit reserve the Send screen assumes.`);
    console.log('  MAX would build a transaction that always fails. Raise the reserve to at');
    console.log(`  least ${fee} and have tx.estimateFee report it.`);
  } else {
    console.log(`  The fee fits inside the ${RESERVE}-unit reserve the Send screen assumes.`);
    console.log('  tx.estimateFee can now report a real number instead of unsupported.');
  }

  // A second send confirms the fee is a constant rather than size- or state-dependent.
  if (after.balance > fee + 10n) {
    console.log('\n  sending again to check the fee is constant...');
    const b2 = after.balance;
    await client.sendTransfer(me, peer, SEND);
    await new Promise((r) => setTimeout(r, 3000));
    const a2 = (await client.getAccountInfo(address)).balance;
    const fee2 = (b2 - a2) - SEND;
    console.log(`  >>> SECOND FEE = ${fee2} base units`);
    console.log(fee2 === fee
      ? '  Fee is CONSTANT across transfers — safe to hardcode a reserve.'
      : '  Fee VARIES between transfers — a reserve must be derived, not hardcoded.');
  }
} catch (error) {
  console.log(`  send FAILED: ${error.message}`);
  console.log('');
  console.log(`  Balance was ${before.balance} base units, sending ${SEND}.`);
  console.log('  If this still reverts with vmError=-765 at this balance, the revert is NOT');
  console.log('  insufficient funds and the transfer instruction layout should be doubted.');
}
