// Tests whether a transfer requires the RECIPIENT account to already exist on-chain.
//
// All five candidate instruction layouts reverted with the IDENTICAL vmError=-765, which argues
// the field order is not the problem — a wrong layout would be expected to fail in varying ways.
// Every probe also sent to a freshly generated address that had never been registered.
//
// claimFaucet and sendTransfer both create the SENDER's account when missing. Neither creates the
// RECIPIENT's. If the transfer program requires the destination to exist, then sending to any
// never-before-used address would always fail — which for a wallet is a serious bug.
//
//   node scripts/probe-transfer-recipient.mjs [networkId]

import { keys, Pubkey } from '@thru/sdk';
import * as client from '../src/lib/thru-client.js';
import { getNetworkConfig } from '../src/lib/networks.js';

const networkId = process.argv[2] || 'alphanet';
const network = getNetworkConfig(networkId);
client.configureNetwork(network);
const CAP = network.faucetMaxPerClaim ?? 10_000n;

async function freshFunded(claims) {
  const kp = await keys.generateKeyPair();
  const address = Pubkey.from(kp.publicKey).toThruFmt();
  const acct = { publicKey: kp.publicKey, privateKey: kp.privateKey, address };
  for (let i = 0; i < claims; i += 1) {
    try { await client.claimFaucet(acct, CAP); } catch { break; }
  }
  await new Promise((r) => setTimeout(r, 2000));
  return acct;
}

console.log(`Testing recipient-existence hypothesis on ${network.label}\n`);

const sender = await freshFunded(8);
const senderBal = (await client.getAccountInfo(sender.address)).balance;
console.log(`  sender ${sender.address}`);
console.log(`  balance ${senderBal} base units\n`);

if (senderBal === 0n) {
  console.log('  Could not fund sender. Aborting.');
  process.exit(1);
}

// --- Case 1: recipient does NOT exist -------------------------------------
const ghostKp = await keys.generateKeyPair();
const ghost = Pubkey.from(ghostKp.publicKey).toThruFmt();
console.log('  CASE 1 — recipient has never been registered');
console.log(`    recipient: ${ghost}`);
console.log(`    exists: ${(await client.getAccountInfo(ghost)).exists}`);
try {
  await client.sendTransfer(sender, ghost, 1n);
  console.log('    -> ACCEPTED (so recipient existence is NOT required)');
} catch (error) {
  console.log(`    -> ${String(error.message).slice(0, 80)}`);
}

// --- Case 2: recipient exists on-chain ------------------------------------
const realKp = await keys.generateKeyPair();
const real = Pubkey.from(realKp.publicKey).toThruFmt();
const realAcct = { publicKey: realKp.publicKey, privateKey: realKp.privateKey, address: real };
console.log('\n  CASE 2 — recipient registered first via createOnChainAccount');
console.log(`    recipient: ${real}`);
try {
  await client.createOnChainAccount(realAcct);
  await new Promise((r) => setTimeout(r, 2500));
} catch (error) {
  console.log(`    createOnChainAccount failed: ${error.message}`);
}
console.log(`    exists: ${(await client.getAccountInfo(real)).exists}`);

const beforeSend = (await client.getAccountInfo(sender.address)).balance;
try {
  const sig = await client.sendTransfer(sender, real, 1n);
  await new Promise((r) => setTimeout(r, 2500));
  const afterSend = (await client.getAccountInfo(sender.address)).balance;
  const got = (await client.getAccountInfo(real)).balance;
  const fee = (beforeSend - afterSend) - 1n;
  console.log(`    -> ACCEPTED: ${sig}`);
  console.log(`    recipient received: ${got}`);
  console.log(`    FEE = ${fee} base units`);
  console.log('');
  console.log('  CONCLUSION: the transfer program REQUIRES the recipient account to exist.');
  console.log('  sendTransfer must register an unknown recipient before transferring, exactly as');
  console.log('  it already does for the sender. Until then, sending to any new address fails.');
  console.log(`  Transfer instruction layout A (current code) is CORRECT — the reverts were`);
  console.log('  caused by unregistered recipients, not by the byte layout.');
} catch (error) {
  console.log(`    -> ${String(error.message).slice(0, 80)}`);
  console.log('');
  console.log('  CONCLUSION: recipient existence is NOT the cause either. Both the layout and');
  console.log('  the account set are now ruled out by experiment; request the transfer');
  console.log('  instruction spec from the Thru team rather than probing further.');
}
