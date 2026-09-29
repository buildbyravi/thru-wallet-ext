// TOKEN LAB — the full "write a token and use it" walkthrough, in one script.
//
// Runs ONLY from a machine that can reach the node (https://rpc.betanet.thru.org). From a
// sandboxed/offline environment every call fails with "fetch failed" — that is the network,
// not the wallet.
//
//   node scripts/token-lab.mjs                  # betanet, throwaway keys
//   node scripts/token-lab.mjs --show-keys      # also print the disposable creator key (hex)
//                                               # so you can Import it into the wallet UI
//   TOKEN_LAB_KEY=<64-hex> node scripts/token-lab.mjs   # reuse a known lab key as creator
//
// WHAT IT DOES (all through the wallet's OWN code paths — src/lib/thru-client.js + the
// official @thru/programs/token bindings; no hand-rolled instructions):
//
//   1. Faucet-funds a fresh creator wallet        claimFaucet
//   2. Deploys a real mint with initial supply    deployTokenMint (InitializeMint + MintTo)
//   3. Reads the mint + creator balance back      readMintAccount / getTokenBalance
//   4. Sends units to a second wallet             sendTokenTransfer (auto-inits the
//      recipient's token account — the "receive" side needs no action from the recipient)
//   5. Reads the recipient balance back           getTokenBalance
//   6. Prints the mint ("contract") address with the exact "Add custom token" steps for
//      the wallet UI (paste mint → chain lookup → import).
//
// It uses THROWAWAY in-memory keys and a local registry shim (chrome.storage.local) purely
// so deployTokenMint can record its mint. It never reads your vault. With --show-keys it
// prints ONE disposable lab key so you can import it into the UI — that key is burn material,
// never reuse it for anything real.

// Local registry shim — deployTokenMint records deployed mints through chrome.storage.local.
// In-memory Map is enough here; nothing is persisted.
const storeMap = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        const out = {};
        for (const k of (Array.isArray(key) ? key : [key])) {
          if (storeMap.has(k)) out[k] = storeMap.get(k);
        }
        return out;
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) storeMap.set(k, v);
      },
    },
  },
};

import { keys, Pubkey } from '@thru/sdk';
import * as client from '../src/lib/thru-client.js';
import { getNetworkConfig, hasFaucet, explorerTxUrl, explorerAddressUrl } from '../src/lib/networks.js';
import { formatRawAmount, bytesToHex } from '@thru/programs/token';

const argv = process.argv.slice(2);
const networkId = argv.find((a) => !a.startsWith('--')) || 'betanet';
const showKeys = argv.includes('--show-keys');

const TICKER = 'LAB';
const TOKEN_NAME = 'Token Lab';
const DECIMALS = 6;
const INITIAL_SUPPLY_UNITS = 1_000_000_000n; // 1,000.000000 LAB at 6 decimals
const SEND_UNITS = 250_500_000n;             //   250.500000 LAB
const CLAIM = 10_000n;

let failures = 0;
function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}
function ok(text) {
  console.log(`    OK   ${text}`);
}
function fail(text) {
  failures += 1;
  console.log(`    FAIL ${text}`);
}
function info(text) {
  console.log(`         ${text}`);
}

const network = getNetworkConfig(networkId);
client.configureNetwork(network);
console.log(`Token Lab — ${network.label} (${network.rpcUrl})`);
console.log('Throwaway in-memory keys. Your vault is never read or written.');

// ---- 0. Reachability ------------------------------------------------------
step(0, 'Reachability');
const health = await client.checkNetworkHealth();
if (health.status === 'offline') {
  fail(`RPC endpoint is offline — run this from a machine that can reach ${network.rpcUrl}`);
  process.exit(1);
}
ok(`node answered (status=${health.status}, latency=${health.latencyMs}ms)`);

// ---- 1. Creator + faucet --------------------------------------------------
step(1, 'Creator wallet + faucet funding');

let me;
if (process.env.TOKEN_LAB_KEY) {
  const raw = process.env.TOKEN_LAB_KEY.trim();
  const bytes = Uint8Array.from(Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64'));
  const publicKey = await keys.fromPrivateKey(bytes);
  me = { publicKey, privateKey: bytes, address: Pubkey.from(publicKey).toThruFmt() };
  info(`using provided lab key for ${me.address}`);
} else {
  const kp = await keys.generateKeyPair();
  me = { publicKey: kp.publicKey, privateKey: kp.privateKey, address: Pubkey.from(kp.publicKey).toThruFmt() };
  info(`fresh creator: ${me.address}`);
}

if (showKeys) {
  console.log('');
  console.log('    Creator private key (DISPOSABLE LAB KEY — import this in the wallet UI, never reuse):');
  console.log(`    ${bytesToHex(me.privateKey)}`);
}

if (!hasFaucet(network)) {
  fail('network declares no faucet — cannot fund the creator');
  process.exit(1);
}
const claimSig = await client.claimFaucet(me, CLAIM);
ok(`faucet claimed amountUnits=${CLAIM}`);
info(`signature: ${claimSig}`);
info(explorerTxUrl(network, claimSig));

// ---- 2. Deploy the token (InitializeMint + MintTo) ------------------------
step(2, `Deploy ${TICKER} (${TOKEN_NAME}, ${DECIMALS} decimals, supply 1,000.000000)`);

const mintSeed = client.generateMintSeed();
const tokenRecord = await client.deployTokenMint({
  feePayer: me,
  ticker: TICKER,
  name: TOKEN_NAME,
  decimals: DECIMALS,
  initialSupply: INITIAL_SUPPLY_UNITS,
  description: 'Token Lab end-to-end demo mint.',
  mintSeed,
  networkId: network.id,
  onProgress: (p) => info(`${p.step}: ${p.message || ''}`),
});
const mintAddress = tokenRecord.mintAddress;
ok(`mint (contract address): ${mintAddress}`);
info(`deploy signature: ${tokenRecord.signature}`);
info(explorerTxUrl(network, tokenRecord.signature));
if (tokenRecord.initialSupplyTx) {
  ok(`initial supply minted in its own MintTo transaction: ${tokenRecord.initialSupplyTx}`);
  info(explorerTxUrl(network, tokenRecord.initialSupplyTx));
}

// ---- 3. Read the mint + creator balance back -----------------------------
step(3, 'Read-back: mint account + creator balance');

const mintInfo = await client.readMintAccount(mintAddress);
if (mintInfo.exists
  && BigInt(mintInfo.supply) === INITIAL_SUPPLY_UNITS
  && mintInfo.decimals === DECIMALS
  && (mintInfo.ticker || '') === TICKER) {
  ok(`mint reads back: supply=${mintInfo.supply} decimals=${mintInfo.decimals} ticker=${mintInfo.ticker}`);
} else {
  fail(`mint read-back mismatch: ${JSON.stringify(mintInfo, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
}
info(`creator: ${mintInfo.creator} | mintAuthority: ${mintInfo.mintAuthority} | freezeAuthority: ${mintInfo.freezeAuthority}`);
info(`mint page: ${explorerAddressUrl(network, mintAddress)}`);

const creatorBal = await client.getTokenBalance(me.address, mintAddress);
if (creatorBal.exists && creatorBal.amount === INITIAL_SUPPLY_UNITS) {
  ok(`creator token account holds ${formatRawAmount(creatorBal.amount, DECIMALS)} ${TICKER}`);
} else {
  fail(`creator balance mismatch: exists=${creatorBal.exists} amount=${creatorBal.amount}`);
}

// ---- 4. Send to a second wallet (their receive needs no action) ----------
step(4, `Send 250.500000 ${TICKER} to a second wallet`);

const peerKp = await keys.generateKeyPair();
const peer = {
  publicKey: peerKp.publicKey,
  privateKey: peerKp.privateKey,
  address: Pubkey.from(peerKp.publicKey).toThruFmt(),
};
info(`recipient: ${peer.address}`);

const sendResult = await client.sendTokenTransfer({
  feePayer: me,
  mintAddress,
  recipientAddress: peer.address,
  amountUnits: SEND_UNITS,
});
ok(`transfer confirmed: ${sendResult.signature}`);
info(explorerTxUrl(network, sendResult.signature));
if (sendResult.recipientTokenAccountCreated) {
  ok(`recipient token account was auto-initialized first (init tx: ${sendResult.initSignature})`);
} else {
  info('recipient token account already existed');
}

// ---- 5. Receive side read-back ------------------------------------------
step(5, 'Read-back: recipient balance (the "receive")');

const peerBal = await client.getTokenBalance(peer.address, mintAddress);
if (peerBal.exists && peerBal.amount === SEND_UNITS) {
  ok(`recipient holds ${formatRawAmount(peerBal.amount, DECIMALS)} ${TICKER}`);
} else {
  fail(`recipient balance mismatch: exists=${peerBal.exists} amount=${peerBal.amount}`);
}
const creatorBal2 = await client.getTokenBalance(me.address, mintAddress);
if (creatorBal2.exists && creatorBal2.amount === INITIAL_SUPPLY_UNITS - SEND_UNITS) {
  ok(`creator debited to ${formatRawAmount(creatorBal2.amount, DECIMALS)} ${TICKER}`);
} else {
  fail(`creator balance after send mismatch: exists=${creatorBal2.exists} amount=${creatorBal2.amount}`);
}

// ---- 6. Custom token add by contract address ----------------------------
step(6, 'Custom token add by contract address (wallet UI)');

console.log(`
    The mint address IS the contract address to paste into the wallet:

        ${mintAddress}

    In the wallet (with the creator key${showKeys ? ' printed above' : ' — re-run with --show-keys to print it'}):
      1. Import a private key  →  Add account  →  Import  (hex key of the creator)
      2. Dashboard  →  Tokens  →  "Add token"
      3. Paste the mint address  →  "Check on chain"
         (this is token.readMint — symbol/decimals come from the chain: ${TICKER}/${DECIMALS})
      4. "Add token"  →  the row joins the ledger with the real on-chain balance
      5. Send from the UI to the recipient's address:
         ${peer.address}

    The wallet-side lookup shape (what "Check on chain" returns):
`);

const lookup = await client.readMintAccount(mintAddress);
console.log(JSON.stringify({
  exists: lookup.exists,
  ticker: lookup.ticker,
  decimals: lookup.decimals,
  supply: lookup.supply?.toString?.() ?? lookup.supply,
  creator: lookup.creator,
  mintAuthority: lookup.mintAuthority,
  hasFreezeAuthority: lookup.hasFreezeAuthority,
}, null, 2).replace(/^/gm, '    '));

// ---- Summary --------------------------------------------------------------
console.log('\n=== Summary ===');
console.log(`  network:            ${network.id}`);
console.log(`  creator:            ${me.address}`);
console.log(`  recipient:          ${peer.address}`);
console.log(`  mint (contract):    ${mintAddress}`);
console.log(`  deploy tx:          ${tokenRecord.signature}`);
console.log(`  supply mint tx:     ${tokenRecord.initialSupplyTx || '(none)'}`);
console.log(`  transfer tx:        ${sendResult.signature}`);
console.log(`  deployed registry:  local shim only (nothing written to your wallet storage)`);

if (failures === 0) {
  console.log('\nALL STEPS PASSED — deploy, add, send, and receive are proven on-chain.');
} else {
  console.log(`\n${failures} step(s) FAILED — read the log above.`);
  process.exit(1);
}
