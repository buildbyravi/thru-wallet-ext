// Probes candidate byte layouts for the native transfer instruction.
//
// WHY: a 1-base-unit transfer from an account holding 120,000 base units reverts with
// vmError=-765, so it is NOT insufficient funds. The faucet instruction, which DOES work against
// the live chain, uses a different field order from the transfer encoder:
//
//   faucet   (verified): tag u32 @0 | idxA u16 @4 | idxB u16 @6 | amount u64 @8
//   transfer (failing):  tag u32 @0 | amount u64 @4 | idxA u16 @12 | idxB u16 @14
//
// Rather than guess, this tries each candidate on-chain and reports which the node accepts.
// Nothing here is committed to src/ until a layout actually succeeds.
//
//   node scripts/probe-transfer-layout.mjs [networkId]

import { keys, Pubkey } from '@thru/sdk';
import * as client from '../src/lib/thru-client.js';
import { getNetworkConfig } from '../src/lib/networks.js';

const networkId = process.argv[2] || 'alphanet';
const network = getNetworkConfig(networkId);
client.configureNetwork(network);

const CAP = network.faucetMaxPerClaim ?? 10_000n;

/** Each candidate writes a 16-byte instruction payload. */
const CANDIDATES = [
  {
    name: 'A: current code — tag, amount@4, src@12, dst@14',
    encode: (src, dst, amt) => {
      const d = new Uint8Array(16); const v = new DataView(d.buffer);
      v.setUint32(0, 1, true); v.setBigUint64(4, amt, true);
      v.setUint16(12, src, true); v.setUint16(14, dst, true);
      return d;
    },
  },
  {
    name: 'B: faucet-style — tag, src@4, dst@6, amount@8',
    encode: (src, dst, amt) => {
      const d = new Uint8Array(16); const v = new DataView(d.buffer);
      v.setUint32(0, 1, true); v.setUint16(4, src, true);
      v.setUint16(6, dst, true); v.setBigUint64(8, amt, true);
      return d;
    },
  },
  {
    name: 'C: faucet-style, indices swapped — tag, dst@4, src@6, amount@8',
    encode: (src, dst, amt) => {
      const d = new Uint8Array(16); const v = new DataView(d.buffer);
      v.setUint32(0, 1, true); v.setUint16(4, dst, true);
      v.setUint16(6, src, true); v.setBigUint64(8, amt, true);
      return d;
    },
  },
  {
    name: 'D: tag 0 instead of 1, faucet-style fields',
    encode: (src, dst, amt) => {
      const d = new Uint8Array(16); const v = new DataView(d.buffer);
      v.setUint32(0, 0, true); v.setUint16(4, src, true);
      v.setUint16(6, dst, true); v.setBigUint64(8, amt, true);
      return d;
    },
  },
  {
    name: 'E: dst only + amount — tag, dst@4, amount@8 (sender implied by feePayer)',
    encode: (src, dst, amt) => {
      const d = new Uint8Array(16); const v = new DataView(d.buffer);
      v.setUint32(0, 1, true); v.setUint16(4, dst, true);
      v.setBigUint64(8, amt, true);
      return d;
    },
  },
];

console.log(`Probing transfer layouts on ${network.label}\n`);

// Fund one sender well enough for several attempts.
const kp = await keys.generateKeyPair();
const address = Pubkey.from(kp.publicKey).toThruFmt();
const me = { publicKey: kp.publicKey, privateKey: kp.privateKey, address };
console.log(`  sender: ${address}`);
process.stdout.write('  funding');
for (let i = 0; i < 10; i += 1) {
  try {
    await client.claimFaucet(me, CAP);
    process.stdout.write('.');
  } catch {
    break;
  }
}
console.log('');
await new Promise((r) => setTimeout(r, 2500));
let balance = (await client.getAccountInfo(address)).balance;
console.log(`  balance: ${balance} base units\n`);

if (balance === 0n) {
  console.log('  Could not fund. Aborting.');
  process.exit(1);
}

const SEND = 1n;
const results = [];

for (const candidate of CANDIDATES) {
  const peerKp = await keys.generateKeyPair();
  const peer = Pubkey.from(peerKp.publicKey).toThruFmt();

  process.stdout.write(`  ${candidate.name}\n    -> `);
  try {
    const { rawTransaction } = await client.getClient().transactions.buildAndSign({
      feePayer: { publicKey: me.publicKey, privateKey: me.privateKey },
      program: network.transferProgramId,
      accounts: { readWrite: [peer] },
      instructionData: ({ getAccountIndex }) =>
        candidate.encode(getAccountIndex(address), getAccountIndex(peer), SEND),
    });

    let settled = false;
    for await (const update of client.getClient().transactions.sendAndTrack(rawTransaction)) {
      if (update.executionResult) {
        settled = true;
        const vmError = update.executionResult.vmError;
        if (vmError === 0) {
          await new Promise((r) => setTimeout(r, 2500));
          const got = (await client.getAccountInfo(peer)).balance;
          console.log(`ACCEPTED. recipient balance = ${got}`);
          results.push({ name: candidate.name, ok: true, detail: `recipient got ${got}` });
        } else {
          console.log(`reverted vmError=${vmError}`);
          results.push({ name: candidate.name, ok: false, detail: `vmError=${vmError}` });
        }
        break;
      }
    }
    if (!settled) {
      console.log('no execution result (timeout)');
      results.push({ name: candidate.name, ok: false, detail: 'timeout' });
    }
  } catch (error) {
    const msg = String(error.message || error).slice(0, 90);
    console.log(`rejected: ${msg}`);
    results.push({ name: candidate.name, ok: false, detail: msg });
  }
}

console.log('\n=== Results ===');
const winners = results.filter((r) => r.ok);
for (const r of results) {
  console.log(`  ${r.ok ? 'ACCEPTED' : 'rejected'}  ${r.name}`);
  if (r.detail) console.log(`            ${r.detail}`);
}

console.log('');
if (winners.length === 1) {
  console.log(`  CONCLUSIVE: ${winners[0].name}`);
  console.log('  Update encodeTransferInstructionData AND the transfer branch of');
  console.log('  decodeHistoryEntry to match, then re-run test-thru-client.mjs.');
} else if (winners.length > 1) {
  console.log('  MULTIPLE layouts accepted — verify which moved the right amount to the right');
  console.log('  address before choosing.');
} else {
  console.log('  NONE accepted. The problem is not the field order:');
  console.log('   - the program address may be wrong for transfers');
  console.log('   - the instruction may not be 16 bytes');
  console.log('   - a required account may be missing from accounts.readWrite');
  console.log('  Ask the Thru team for the transfer instruction spec rather than guessing further.');
}
