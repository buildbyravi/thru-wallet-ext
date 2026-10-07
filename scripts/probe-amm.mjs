// Read-only AMM evidence probe (G1 verified-matrix track, Q14/Q15/Q18). Same discipline as
// probe-oracle-feed.mjs: pure accounts.get + official parser, NO signing, NO transactions,
// CSP-clean (the single pinned RPC origin). Never imported by the extension, never in dist/.
//
//   node scripts/probe-amm.mjs --network betanet                 # program-level evidence
//   node scripts/probe-amm.mjs --mints taA...,taB... [--fee-bps 30]   # derive + read the pool
//   node scripts/probe-amm.mjs --pool ta...                       # parse a known pool account
//
// Modes:
//   (default)   read the AMM program account (deployment evidence: exists, data size).
//   --mints     derivation evidence for the (sorted) pair at AMM_DEFAULT_SWAP_FEE_BPS
//               (Q18: pools are re-derivable from sorted pair + fee), then read the derived
//               pool account. exists:false is a RESULT, not an error (Q14 honest absence).
//   --pool      parse a known pool account with the official parser — the parsed fields ARE
//               the Q15 pool-model evidence (reserves, mints, lp mint, fee…).
//
// All output is raw wire/parse evidence. Do not invent pool values: no pool parsed = the
// honest state of pool-model evidence today (no mints exist on betanet — P3 is the blocker,
// and the faucet program currently rejects claims: 2026-10-06-live-chain).

import { Pubkey } from '@thru/sdk';
import {
  AMM_PROGRAM_ADDRESS,
  AMM_DEFAULT_SWAP_FEE_BPS,
  deriveAmmPoolAddresses,
  parseAmmPoolMetadata,
  sortAmmMints,
} from '@thru/programs/amm';
import { getNetworkConfig } from '../src/lib/networks.js';
import { configureNetwork, getClient } from '../src/lib/thru-client.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const networkId = flag('--network') || 'betanet';
const mintsArg = flag('--mints');
const poolArg = flag('--pool');
const feeBps = flag('--fee-bps') ? Number(flag('--fee-bps')) : undefined;

const network = getNetworkConfig(networkId);
configureNetwork(network);
const client = getClient();

const JSON_SAFE = (k, v) => (typeof v === 'bigint' ? v.toString() : (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v));

function isAbsence(err) {
  // The RPC spells a missing account several ways — every one of them is a RESULT.
  return /exists|not[_ ]found|account not found/i.test(err?.message ?? '') || err?.exists === false;
}

async function readAccount(address, label) {
  try {
    return { ok: true, account: await client.accounts.get(address) };
  } catch (err) {
    if (isAbsence(err)) return { ok: false, absent: true };
    console.error(`\nUNREACHABLE or unreadable from this environment reading ${label}: ${err.name}: ${err.message}`);
    console.error('Record as BLOCKED — do not fabricate pool values.');
    process.exit(1);
  }
}

// ---- 1. Program-level evidence ----------------------------------------------
console.log(`AMM evidence probe on ${networkId} (${network.rpcUrl})`);
console.log(`amm program: ${AMM_PROGRAM_ADDRESS}\n`);

{
  const r = await readAccount(AMM_PROGRAM_ADDRESS, 'amm program');
  if (!r.ok) {
    console.log('amm program account: exists:false — a result, not an error.');
    console.log('(This would contradict the 2026-10-06 presence probe; record drift loudly.)');
  } else {
    const dataLen = r.account?.data?.length ?? (r.account ? 0 : null);
    console.log(`amm program account: EXISTS (data ${dataLen} bytes)`);
  }
}

// ---- 2. Derivation evidence for a mint pair ---------------------------------
if (mintsArg) {
  const [mintA, mintB] = mintsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (!mintA || !mintB) {
    console.error('pass --mints <ta...>,<ta...>');
    process.exit(2);
  }
  const sorted = sortAmmMints(mintA, mintB);
  console.log(`\nmint pair (sorted canonical order, inputOrder=${sorted.inputOrder}):`);
  console.log(`  one: ${sorted.mintOneAddress}`);
  console.log(`  two: ${sorted.mintTwoAddress}`);
  const derived = deriveAmmPoolAddresses(client, {
    ammProgramAddress: AMM_PROGRAM_ADDRESS,
    mintAAddress: mintA,
    mintBAddress: mintB,
    swapFeeBps: feeBps,
  });
  console.log(`derived pool addresses (fee ${feeBps ?? AMM_DEFAULT_SWAP_FEE_BPS} bps) — Q18 re-derivation:`);
  console.log(JSON.stringify(derived, JSON_SAFE, 2));

  const poolAddress = derived.pool ?? derived.poolAccount ?? derived.poolAddress;
  const r = await readAccount(poolAddress, 'derived pool');
  if (!r.ok) {
    console.log('\nderived pool account: exists:false — Q14/Q15 honest absence (no pool for this pair).');
    process.exit(0);
  }
  console.log('\nderived pool account EXISTS — parsed with the official parser (Q15 model evidence):');
  console.log(JSON.stringify(parseAmmPoolMetadata(r.account), JSON_SAFE, 2));
  process.exit(0);
}

if (poolArg) {
  const r = await readAccount(poolArg, 'pool');
  if (!r.ok) {
    console.log('\npool account: exists:false — a result, not an error.');
    process.exit(0);
  }
  console.log('\npool parsed (Q15 model evidence):');
  console.log(JSON.stringify(parseAmmPoolMetadata(r.account), JSON_SAFE, 2));
  process.exit(0);
}

if (!mintsArg && !poolArg) {
  console.log('\n(program-level only. Pool derivation/parsing needs a mint pair or pool address —');
  console.log('none exists on-chain today: no mints are deployed (P3 blocked at the faucet rung).');
}
