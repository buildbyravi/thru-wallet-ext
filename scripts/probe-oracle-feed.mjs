// Read an Oracle feed account on-chain via the repo's normal RPC path and parse it with the
// @thru/programs/oracle bindings we already ship (0.3.16). Dev-only spike tooling: never
// imported by the extension, never shipped in dist/.
//
// This is the CSP-clean price-feed read path: the oracle is an ON-CHAIN program, so reading a
// feed is an RPC read against the origin the manifest already pins. No new host, no new
// dependency. See docs/EXPLORER_SPIKE.md §5.
//
// Feed discovery: feed addresses appear in `priceUpdate`/`booleanUpdate` events (field
// `feedAddress`) on transactions against the oracle program — enumerate them with
// `scripts/probe-explorer-mcp.mjs get_transaction '{"signature":"ts..."}'` for any signature
// listed on https://scan.thru.org/address/$ORACLE_PROGRAM_ADDRESS, then read the feed here.
//
//   node scripts/probe-oracle-feed.mjs --seed 'thru-usd'            # derive + read by seed
//   node scripts/probe-oracle-feed.mjs --address taQlm...           # read a known feed address
//   node scripts/probe-oracle-feed.mjs --seed 0x68656c6c6f          # explicit 32-byte hex seed
//   node scripts/probe-oracle-feed.mjs --address ta... --network alphanet
//
// All output is raw wire/parse evidence. A missing feed prints exists:false — that is a result,
// not an error. Do not invent feed values.

import { parseOracleFeedAccount, deriveOracleFeedAddress, normalizeOracleFeedSeed, ORACLE_PROGRAM_ADDRESS } from '@thru/programs/oracle';
import { getNetworkConfig } from '../src/lib/networks.js';
import { configureNetwork, getClient } from '../src/lib/thru-client.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const networkId = flag('--network') || 'alphanet';
const seed = flag('--seed');
const address = flag('--address');

if (!seed && !address) {
  console.error('pass --seed <string|0xhex> or --address <ta...>  (see header for usage)');
  process.exit(2);
}

configureNetwork(getNetworkConfig(networkId));

function seedBytes(s) {
  if (s.startsWith('0x')) return Uint8Array.from(s.slice(2).match(/.{2}/g).map((h) => parseInt(h, 16)));
  return normalizeOracleFeedSeed(s);
}

try {
  let feedAddress = address;
  if (seed) {
    const bytes = seedBytes(seed);
    console.log(`seed (${bytes.length} bytes): ${Buffer.from(bytes).toString('hex')}`);
    const derived = deriveOracleFeedAddress(getClient(), ORACLE_PROGRAM_ADDRESS, bytes);
    feedAddress = derived.address;
    console.log(`oracle program:  ${ORACLE_PROGRAM_ADDRESS}`);
    console.log(`derived feed:    ${feedAddress}`);
  } else {
    console.log(`oracle program:  ${ORACLE_PROGRAM_ADDRESS}`);
    console.log(`feed address:    ${feedAddress}`);
  }

  const account = await getClient().accounts.get(feedAddress);
  const parsed = parseOracleFeedAccount(account?.data ?? account);
  console.log('\n=== parsed feed (bigint-safe) ===');
  console.log(JSON.stringify(parsed, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
} catch (err) {
  if (/exists/i.test(err.message) || err.exists === false) {
    console.log('\nno feed account at this address (exists:false) — a result, not an error.');
    process.exit(0);
  }
  console.error(`\nUNREACHABLE or unreadable from this environment: ${err.name}: ${err.message}`);
  console.error('Record the step as BLOCKED in docs/EXPLORER_SPIKE.md — do not fabricate feed values.');
  process.exit(1);
}
