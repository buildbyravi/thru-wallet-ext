// LIVE CHAIN VERIFICATION — answers the open questions in docs/STATUS_AND_ROADMAP.md §Step 6.
//
// Run this ONLY against a devnet/localnet. It creates a THROWAWAY keypair in memory, claims from
// the faucet, and sends a tiny transfer to a second throwaway key. It never touches your vault,
// never reads chrome.storage, and never prints a private key.
//
//   node scripts/verify-chain.mjs                 # alphanet
//   node scripts/verify-chain.mjs localnet        # local node
//   node scripts/verify-chain.mjs alphanet --send # also do the transfer leg
//
// The transfer leg is opt-in because it needs the faucet leg to have actually funded the
// account, and on a fresh/reset devnet that is not guaranteed.
//
// WHAT IT DECIDES
//
//   1. THE AMOUNT-UNIT QUESTION. The faucet field takes raw base units while Send takes
//      human-scale THRU. Both are reasoned, neither was confirmed. This claims a known amount
//      and measures the actual balance delta, which settles it.
//   2. Whether the faucet and transfer program addresses and instruction layouts are right.
//   3. Whether transfers carry a non-zero fee (unblocks tx.estimateFee, BACKEND_GAPS C2).
//   4. Whether history decodes into the shapes the UI expects.
//   5. Whether Token Program account reads are possible (unblocks token.getBalances, C1).

import { keys, Pubkey } from '@thru/sdk';
import * as client from '../src/lib/thru-client.js';
import { getNetworkConfig, hasFaucet, explorerTxUrl } from '../src/lib/networks.js';
import { UNITS_PER_THRU, formatThru } from '../src/shared/format.js';

const argv = process.argv.slice(2);
const networkId = argv.find((a) => !a.startsWith('--')) || 'alphanet';
const doSend = argv.includes('--send');

const findings = [];
function record(question, verdict, detail) {
  findings.push({ question, verdict, detail });
  const mark = verdict === 'CONFIRMED' ? 'OK  ' : verdict === 'FAILED' ? 'FAIL' : '??  ';
  console.log(`  [${mark}] ${question}`);
  if (detail) console.log(`         ${detail}`);
}

function heading(text) {
  console.log(`\n=== ${text} ===`);
}

const network = getNetworkConfig(networkId);
client.configureNetwork(network);

console.log(`Live verification against ${network.label} (${network.rpcUrl})`);
console.log('Using throwaway in-memory keys. Your vault is never read or written.\n');

// ---- 1. Reachability -------------------------------------------------------
heading('Network reachability');
const health = await client.checkNetworkHealth();
if (health.status === 'offline') {
  record('RPC endpoint is reachable', 'FAILED', `status=offline. Nothing below can run.`);
  console.log('\nAborting: the node is not answering.');
  process.exit(1);
}
record('RPC endpoint is reachable', 'CONFIRMED', `status=${health.status}, latency=${health.latencyMs}ms`);

// ---- 2. Throwaway identity -------------------------------------------------
heading('Throwaway account');
const kp = await keys.generateKeyPair();
const address = Pubkey.from(kp.publicKey).toThruFmt();
const me = { publicKey: kp.publicKey, privateKey: kp.privateKey, address };
console.log(`  address: ${address}`);

const before = await client.getAccountInfo(address);
record(
  'A brand-new address reads as non-existent with zero balance',
  before.exists === false && before.balance === 0n ? 'CONFIRMED' : 'UNEXPECTED',
  `exists=${before.exists} balance=${before.balance}`,
);

// ---- 3. THE UNIT QUESTION --------------------------------------------------
heading('Faucet: the amount-unit question');

if (!hasFaucet(network)) {
  record('Faucet available on this network', 'SKIPPED', 'network declares no faucet');
} else {
  const CLAIM = 10_000n; // the documented per-claim cap, interpreted as base units
  console.log(`  claiming amountUnits=${CLAIM} (interpreting the field as BASE UNITS)`);

  let signature;
  try {
    signature = await client.claimFaucet(me, CLAIM);
    record('Faucet claim is accepted on-chain', 'CONFIRMED', `signature=${signature}`);
    record(
      'Faucet program address + instruction layout are correct',
      'CONFIRMED',
      'a wrong program or layout would have reverted or been rejected',
    );
  } catch (error) {
    record('Faucet claim is accepted on-chain', 'FAILED', error.message);
    record(
      'Faucet program address + instruction layout are correct',
      'FAILED',
      'Doubt the reverse-engineered faucetProgramId / faucetStateAccount / encodeFaucetInstructionData first.',
    );
  }

  if (signature) {
    // Give the node a moment to reflect the new balance.
    await new Promise((r) => setTimeout(r, 2500));
    const after = await client.getAccountInfo(address);
    const delta = after.balance - before.balance;

    console.log(`  balance delta: ${delta} base units (${formatThru(delta)} THRU)`);

    if (delta === CLAIM) {
      record(
        'THE UNIT QUESTION: faucet amountUnits is in BASE UNITS',
        'CONFIRMED',
        `asked for ${CLAIM}, received exactly ${delta} base units. `
        + 'The faucet field is raw base units, as the UI assumes. No change needed.',
      );
    } else if (delta === CLAIM * UNITS_PER_THRU) {
      record(
        'THE UNIT QUESTION: faucet amountUnits is in WHOLE THRU',
        'FAILED',
        `asked for ${CLAIM}, received ${delta} base units = ${formatThru(delta)} THRU. `
        + 'The faucet field is THRU, NOT base units. The faucet input and its cap are wrong '
        + 'by a factor of 1e9. Fix parseThruAmount usage at the faucet input.',
      );
    } else if (delta === 0n) {
      record(
        'THE UNIT QUESTION',
        'UNRESOLVED',
        'balance did not change. The claim may be rate-limited, or the faucet may be drained.',
      );
    } else {
      record(
        'THE UNIT QUESTION',
        'UNEXPECTED',
        `asked for ${CLAIM}, received ${delta}. Ratio = ${Number(delta) / Number(CLAIM)}. `
        + 'Neither base units nor whole THRU. Investigate before trusting any amount field.',
      );
    }
  }
}

// ---- 4. Transfer + fee -----------------------------------------------------
heading('Transfer and fee');
const funded = await client.getAccountInfo(address);

if (!doSend) {
  record('Transfer leg', 'SKIPPED', 'pass --send to run it');
} else if (funded.balance === 0n) {
  record('Transfer leg', 'SKIPPED', 'account has no balance, so a transfer cannot be tested');
} else {
  const peerKp = await keys.generateKeyPair();
  const peer = Pubkey.from(peerKp.publicKey).toThruFmt();
  const SEND = 1n; // smallest possible amount, in base units

  const senderBefore = funded.balance;
  try {
    const sig = await client.sendTransfer(me, peer, SEND);
    record('Transfer is accepted on-chain', 'CONFIRMED', `signature=${sig}`);
    record(
      'Transfer program address + instruction layout are correct',
      'CONFIRMED',
      'a wrong program or layout would have reverted',
    );

    await new Promise((r) => setTimeout(r, 2500));
    const senderAfter = (await client.getAccountInfo(address)).balance;
    const recipientAfter = (await client.getAccountInfo(peer)).balance;

    const spent = senderBefore - senderAfter;
    const fee = spent - SEND;

    console.log(`  sender spent: ${spent} base units, of which amount=${SEND}`);
    console.log(`  recipient received: ${recipientAfter}`);

    record(
      'Recipient receives exactly the amount sent',
      recipientAfter === SEND ? 'CONFIRMED' : 'UNEXPECTED',
      `expected ${SEND}, got ${recipientAfter}`,
    );

    if (fee === 0n) {
      record(
        'FEE QUESTION: transfers are zero-fee',
        'CONFIRMED',
        'The MAX button needs no gas reserve, and tx.estimateFee can report 0 rather than '
        + 'unsupported.',
      );
    } else if (fee > 0n) {
      record(
        'FEE QUESTION: transfers carry a fee',
        'CONFIRMED',
        `fee = ${fee} base units (${formatThru(fee)} THRU). This unblocks tx.estimateFee `
        + '(BACKEND_GAPS C2) and tells the MAX button what to reserve.',
      );
    } else {
      record('FEE QUESTION', 'UNEXPECTED', `computed a negative fee (${fee}); balances moved oddly`);
    }
  } catch (error) {
    record('Transfer is accepted on-chain', 'FAILED', error.message);
  }
}

// ---- 5. History decoding ---------------------------------------------------
heading('History decoding');
try {
  const entries = await client.listAccountHistory(address, 10);
  record('History query returns without error', 'CONFIRMED', `${entries.length} entries`);

  if (entries.length) {
    const decoded = entries.filter((e) => e.kind && e.kind !== 'other');
    record(
      'Entries decode into known kinds rather than "other"',
      decoded.length > 0 ? 'CONFIRMED' : 'FAILED',
      `${decoded.length}/${entries.length} decoded. Kinds: ${[...new Set(entries.map((e) => e.kind))].join(', ')}`,
    );

    const withAmount = entries.filter((e) => e.amount != null);
    record(
      'Decoded entries carry an amount',
      withAmount.length > 0 ? 'CONFIRMED' : 'UNRESOLVED',
      `${withAmount.length}/${entries.length} have an amount`,
    );

    const sample = entries[0];
    console.log(`  sample: kind=${sample.kind} amount=${sample.amount} success=${sample.success}`);
    if (sample.signature) {
      const url = explorerTxUrl(network, sample.signature);
      record(
        'Explorer URL can be built',
        url ? 'UNRESOLVED' : 'SKIPPED',
        url
          ? `Open this manually to confirm the /tx/ route pattern:\n         ${url}`
          : 'this network declares no explorer',
      );
    }
  } else {
    record('Entries decode into known kinds', 'SKIPPED', 'no history yet on this address');
  }
} catch (error) {
  record('History query returns without error', 'FAILED', error.message);
}

// ---- 6. Token program reads ------------------------------------------------
heading('Token Program reads (BACKEND_GAPS C1)');
try {
  const info = await client.getAccountInfo(network.tokenProgramId);
  record(
    'Token Program account is readable',
    info.exists ? 'CONFIRMED' : 'UNRESOLVED',
    info.exists
      ? 'The program exists. Reading a HOLDER balance still needs the account layout, which '
        + 'this script cannot infer.'
      : 'the configured tokenProgramId does not resolve to an existing account',
  );
} catch (error) {
  record('Token Program account is readable', 'FAILED', error.message);
}

// ---- Summary ---------------------------------------------------------------
heading('Summary');
const counts = findings.reduce((acc, f) => {
  acc[f.verdict] = (acc[f.verdict] || 0) + 1;
  return acc;
}, {});
for (const [verdict, n] of Object.entries(counts)) {
  console.log(`  ${verdict}: ${n}`);
}

const failed = findings.filter((f) => f.verdict === 'FAILED');
if (failed.length) {
  console.log('\nFAILED checks — these are the ones that matter:');
  for (const f of failed) console.log(`  - ${f.question}\n    ${f.detail}`);
}

const unresolved = findings.filter((f) => f.verdict === 'UNRESOLVED' || f.verdict === 'UNEXPECTED');
if (unresolved.length) {
  console.log('\nStill unresolved:');
  for (const f of unresolved) console.log(`  - ${f.question}`);
}

console.log('\nThis script asserts nothing and is not part of npm test — it REPORTS.');
console.log('Paste the output back so the findings can be folded into the code and docs.');
