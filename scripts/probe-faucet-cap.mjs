#!/usr/bin/env node
// Probe to test live Betanet faucet capacity:
// 1. Can a single claim exceed 10,000 units (e.g. 10,001, 20,000, 50,000, 100,000)?
// 2. Can multiple 10,000 unit claims succeed on the same account (or is it rate-limited)?
// 3. Can a fresh account claim > 10,000 units directly?

import { keys, Pubkey, Signature } from '@thru/sdk';
import * as client from '../src/lib/thru-client.js';
import { getNetworkConfig } from '../src/lib/networks.js';
import { autoUnits, UNIT_CLASS } from '../src/lib/tx-units.js';

const network = getNetworkConfig('betanet');
client.configureNetwork(network);

console.log(`=== LIVE FAUCET CAP PROBE ON BETANET ===`);
console.log(`RPC: ${network.rpcUrl}`);
console.log(`Faucet Program: ${network.faucetProgramId}`);
console.log(`Faucet State: ${network.faucetStateAccount}\n`);

async function rawClaimFaucet(feePayer, amountUnits) {
  const net = network;
  const address = feePayer.address || Pubkey.from(feePayer.publicKey).toThruFmt();
  const info = await client.getAccountInfo(address);
  if (!info.exists) {
    console.log(`  [setup] Fee payer ${address} does not exist on-chain. Creating via createOnChainAccount...`);
    await client.createOnChainAccount(feePayer);
    console.log(`  [setup] Created on-chain account for fee payer.`);
  }

  const currentInfo = await client.getAccountInfo(address);
  const units = autoUnits({
    kind: UNIT_CLASS.CLAIM,
    bytes: 16,
    accounts: 1,
    balanceUnits: currentInfo.balance ?? 0n,
  });

  const { rawTransaction } = await client.getClient().transactions.buildAndSign({
    feePayer: { publicKey: feePayer.publicKey, privateKey: feePayer.privateKey },
    program: net.faucetProgramId,
    header: units,
    accounts: { readWrite: [net.faucetStateAccount] },
    instructionData: ({ getAccountIndex }) =>
      client.encodeFaucetInstructionData(getAccountIndex(net.faucetStateAccount), getAccountIndex(address), BigInt(amountUnits)),
  });

  for await (const update of client.getClient().transactions.sendAndTrack(rawTransaction)) {
    if (update.executionResult) {
      const sig = update.signature?.value ? Signature.from(update.signature.value).toThruFmt() : undefined;
      return {
        success: update.executionResult.vmError === 0,
        vmError: update.executionResult.vmError,
        userError: update.executionResult.userError,
        signature: sig,
        executionResult: update.executionResult,
      };
    }
  }
  throw new Error('No execution result returned from sendAndTrack');
}

async function run() {
  const results = [];

  // --- TEST 1: Baseline 10,000 units on a fresh account ---
  console.log(`\n--- TEST 1: Baseline claim of 10,000 units on fresh account ---`);
  const kp1 = await keys.generateKeyPair();
  const addr1 = Pubkey.from(kp1.publicKey).toThruFmt();
  const acct1 = { publicKey: kp1.publicKey, privateKey: kp1.privateKey, address: addr1 };
  console.log(`Account 1: ${addr1}`);

  try {
    const res1 = await rawClaimFaucet(acct1, 10_000n);
    console.log(`Test 1 Result: success=${res1.success}, vmError=${res1.vmError}, sig=${res1.signature}`);
    const post1 = await client.getAccountInfo(addr1);
    console.log(`Account 1 balance: ${post1.balance}`);
    results.push({ test: 'baseline_10k', amount: 10_000, ...res1, balance: post1.balance });
  } catch (err) {
    console.log(`Test 1 Failed: ${err.message}`);
    results.push({ test: 'baseline_10k', amount: 10_000, error: err.message });
  }

  // --- TEST 2: Claim 10,001 units on a fresh account ---
  console.log(`\n--- TEST 2: Claim of 10,001 units (1 unit above 10k) on fresh account ---`);
  const kp2 = await keys.generateKeyPair();
  const addr2 = Pubkey.from(kp2.publicKey).toThruFmt();
  const acct2 = { publicKey: kp2.publicKey, privateKey: kp2.privateKey, address: addr2 };
  console.log(`Account 2: ${addr2}`);

  try {
    const res2 = await rawClaimFaucet(acct2, 10_001n);
    console.log(`Test 2 Result: success=${res2.success}, vmError=${res2.vmError}, userError=${res2.userError}, sig=${res2.signature}`);
    const post2 = await client.getAccountInfo(addr2);
    console.log(`Account 2 balance: ${post2.balance}`);
    results.push({ test: 'over_cap_10001', amount: 10_001, ...res2, balance: post2.balance });
  } catch (err) {
    console.log(`Test 2 Failed: ${err.message}`);
    results.push({ test: 'over_cap_10001', amount: 10_001, error: err.message });
  }

  // --- TEST 3: Claim 20,000 units on a fresh account ---
  console.log(`\n--- TEST 3: Claim of 20,000 units (2x cap) on fresh account ---`);
  const kp3 = await keys.generateKeyPair();
  const addr3 = Pubkey.from(kp3.publicKey).toThruFmt();
  const acct3 = { publicKey: kp3.publicKey, privateKey: kp3.privateKey, address: addr3 };
  console.log(`Account 3: ${addr3}`);

  try {
    const res3 = await rawClaimFaucet(acct3, 20_000n);
    console.log(`Test 3 Result: success=${res3.success}, vmError=${res3.vmError}, userError=${res3.userError}, sig=${res3.signature}`);
    const post3 = await client.getAccountInfo(addr3);
    console.log(`Account 3 balance: ${post3.balance}`);
    results.push({ test: 'over_cap_20k', amount: 20_000, ...res3, balance: post3.balance });
  } catch (err) {
    console.log(`Test 3 Failed: ${err.message}`);
    results.push({ test: 'over_cap_20k', amount: 20_000, error: err.message });
  }

  // --- TEST 4: Claim 100,000 units on a fresh account ---
  console.log(`\n--- TEST 4: Claim of 100,000 units (10x cap) on fresh account ---`);
  const kp4 = await keys.generateKeyPair();
  const addr4 = Pubkey.from(kp4.publicKey).toThruFmt();
  const acct4 = { publicKey: kp4.publicKey, privateKey: kp4.privateKey, address: addr4 };
  console.log(`Account 4: ${addr4}`);

  try {
    const res4 = await rawClaimFaucet(acct4, 100_000n);
    console.log(`Test 4 Result: success=${res4.success}, vmError=${res4.vmError}, userError=${res4.userError}, sig=${res4.signature}`);
    const post4 = await client.getAccountInfo(addr4);
    console.log(`Account 4 balance: ${post4.balance}`);
    results.push({ test: 'over_cap_100k', amount: 100_000, ...res4, balance: post4.balance });
  } catch (err) {
    console.log(`Test 4 Failed: ${err.message}`);
    results.push({ test: 'over_cap_100k', amount: 100_000, error: err.message });
  }

  // --- TEST 5: Repeated claims on Account 1 (multi-claim testing) ---
  console.log(`\n--- TEST 5: Second claim of 10,000 units on Account 1 (cumulative claim test) ---`);
  try {
    const res5 = await rawClaimFaucet(acct1, 10_000n);
    console.log(`Test 5 Result: success=${res5.success}, vmError=${res5.vmError}, userError=${res5.userError}, sig=${res5.signature}`);
    const post5 = await client.getAccountInfo(addr1);
    console.log(`Account 1 balance after 2nd claim: ${post5.balance}`);
    results.push({ test: 'repeat_claim_10k', amount: 10_000, ...res5, balance: post5.balance });
  } catch (err) {
    console.log(`Test 5 Failed: ${err.message}`);
    results.push({ test: 'repeat_claim_10k', amount: 10_000, error: err.message });
  }

  console.log(`\n=== SUMMARY OF LIVE FAUCET FINDINGS ===`);
  console.log(JSON.stringify(results, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

run().catch(err => {
  console.error('Fatal probe error:', err);
  process.exit(1);
});
