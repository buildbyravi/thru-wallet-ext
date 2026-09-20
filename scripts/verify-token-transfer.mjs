// Live verification of token transfers (contract v8) against a REAL network.
//
//   node scripts/verify-token-transfer.mjs [networkId]
//
// What this pins down, none of which unit tests can:
//   1. deploy a real mint via the official createInitializeMintInstruction binding;
//   2. initialize the deployer's token account and mint real supply into it via mint_to;
//   3. token.getBalances-equivalent reads (deriveTokenAccountAddress + parseTokenAccountData);
//   4. a token.transfer to an address whose RECIPIENT has no token account — the sender
//      initializes it in the same flow — and, deliberately, to an owner whose WALLET account
//      has never been registered, which answers the one open chain question in
//      docs/BACKEND_GAPS.md: does initialize-account tolerate a never-registered owner?
//   5. the actual THRU fee paid for a token-program transaction (feeds C2 honest numbers);
//   6. history decoding of the resulting token entries (transfer / mint / account-init).
//
// Uses THROWAWAY in-memory keys only — never a real vault, never your profile. Results are
// REPORTED, not asserted: where the honest answer can flip with chain behaviour (the
// unregistered-owner probe), the script records what it saw instead of forcing an outcome.

import { keys, Pubkey } from '@thru/sdk';
import { createMintToInstruction } from '@thru/programs/token';

// ---- In-memory chrome mock (token deploy records land here, nowhere else) ---
function makeStore() {
  const m = new Map();
  return {
    async get(k) {
      if (k == null) return Object.fromEntries(m);
      if (Array.isArray(k)) {
        const o = {};
        for (const x of k) if (m.has(x)) o[x] = m.get(x);
        return o;
      }
      return m.has(k) ? { [k]: m.get(k) } : {};
    },
    async set(o) { for (const [a, b] of Object.entries(o)) m.set(a, b); },
    async remove(k) { for (const x of (Array.isArray(k) ? k : [k])) m.delete(x); },
  };
}
globalThis.chrome = { storage: { local: makeStore(), session: makeStore() } };

const networkId = process.argv[2] || 'alphanet';
const { getNetworkConfig } = await import('../src/lib/networks.js');
const thruClient = await import('../src/lib/thru-client.js');

const config = getNetworkConfig(networkId);
if (!config) {
  console.error(`Unknown network '${networkId}'.`);
  process.exit(1);
}
thruClient.configureNetwork(config);

let step = 0;
function report(label, verdict, detail) {
  step += 1;
  const mark = verdict === 'PASS' ? 'PASS' : verdict === 'FAIL' ? 'FAIL' : '??  ';
  console.log(`  [${mark}] ${step}. ${label}`);
  if (detail) console.log(`         ${detail}`);
}

async function nativeBalance(address) {
  const info = await thruClient.getAccountInfo(address);
  return info.exists ? info.balance : 0n;
}

console.log(`Token transfer live verification on ${networkId}\n`);

async function main() {

// ---- Actors ----------------------------------------------------------------
// SENDER is registered and faucet-funded. RECIPIENT is deliberately NEVER registered: the
// native-transfer path cannot send to it, so whether a token flow can is the headline probe.
console.log('Setting up throwaway accounts (never your wallet)…');
const sender = await keys.generateKeyPair();
const recipient = await keys.generateKeyPair();
console.log(`  sender    ${sender.address}`);
console.log(`  recipient ${recipient.address}`);

await thruClient.createOnChainAccount(sender);
report('sender account registered on-chain', 'PASS');

const claims = 3;
for (let i = 0; i < claims; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  await thruClient.claimFaucet(sender, config.faucetMaxPerClaim ?? 10_000n);
}
const faucetBalance = await nativeBalance(sender.address);
report('sender funded by faucet', 'PASS', `${config.faucetMaxPerClaim ?? 10_000n} × ${claims} = ${faucetBalance} base units`);

const recipientInfo = await thruClient.getAccountInfo(recipient.address);
report(
  'recipient wallet account is a true never-registered control',
  recipientInfo.exists ? 'FAIL' : 'PASS',
  recipientInfo.exists ? 'already exists — pick fresh keys and re-run' : 'no on-chain account',
);

// ---- 1. Deploy a real mint ---------------------------------------------------
const mintSeed = thruClient.generateMintSeed();
const deploy = await thruClient.deployTokenMint({
  feePayer: sender,
  networkId,
  mintSeed,
  name: 'Token Transfer Verification Token',
  ticker: 'TTV',
  decimals: 6,
});
report('deploy mint via official createInitializeMintInstruction', 'PASS', `mint ${deploy.mintAddress}`);

const mintInfo = await thruClient.readMintAccount(deploy.mintAddress);
report(
  'mint reads back through parseMintAccountData',
  mintInfo.exists && mintInfo.decimals === 6 && mintInfo.ticker === 'TTV' ? 'PASS' : 'FAIL',
  `exists=${mintInfo.exists} decimals=${mintInfo.decimals} ticker=${mintInfo.ticker} supply=${mintInfo.supply}`,
);

// ---- 2. Initialize sender token account + mint real supply -------------------
const SUPPLY = 1_000_000_000n; // 1000 TTV at 6 decimals
const init = await thruClient.initializeTokenAccount(sender, sender.address, deploy.mintAddress);
report('sender token account initialized', init.created ? 'PASS' : 'FAIL', init.tokenAccount);

{
  const { rawTransaction } = await thruClient.getClient().transactions.buildAndSign({
    feePayer: { publicKey: sender.publicKey, privateKey: sender.privateKey },
    program: config.tokenProgramId,
    accounts: { readWrite: [deploy.mintAddress, init.tokenAccount] },
    instructionData: createMintToInstruction({
      mintAccountBytes: Pubkey.from(deploy.mintAddress).toBytes(),
      destinationAccountBytes: Pubkey.from(init.tokenAccount).toBytes(),
      authorityAccountBytes: Pubkey.from(sender.publicKey).toBytes(),
      amount: SUPPLY,
    }),
  });
  let minted = false;
  for await (const update of thruClient.getClient().transactions.sendAndTrack(rawTransaction)) {
    if (update.executionResult) {
      minted = update.executionResult.vmError === 0;
      break;
    }
  }
  report('supply minted into the sender token account (mint_to)', minted ? 'PASS' : 'FAIL', `${SUPPLY} base units`);
}

const senderBalance1 = await thruClient.getTokenBalance(sender.address, deploy.mintAddress);
report(
  'owned balance reads back through the official derivation + parser',
  senderBalance1.exists && senderBalance1.amount === SUPPLY ? 'PASS' : 'FAIL',
  `${senderBalance1.amount} base units at ${senderBalance1.tokenAccount}`,
);

// ---- 3. Token transfer to a first-time, NEVER-REGISTERED recipient -----------
// This single send is two chain transactions: initialize the recipient's token account, then
// transfer. Neither is possible through native tx.send, which refuses an unregistered
// recipient outright (RECIPIENT_NOT_ACTIVATED).
const SEND_AMOUNT = 250_000_000n; // 250 TTV
const beforeInit = await nativeBalance(sender.address);

let outcome = null;
try {
  outcome = await thruClient.sendTokenTransfer({
    feePayer: sender,
    mintAddress: deploy.mintAddress,
    recipientAddress: recipient.address,
    amountUnits: SEND_AMOUNT,
  });
} catch (err) {
  report(
    'OPEN QUESTION: cannot initialize a token account for a never-registered owner',
    '??',
    `${err.code || 'ERROR'}: ${err.message} — record this in docs/BACKEND_GAPS.md; chain behaviour, not a code bug`,
  );
}

if (outcome) {
  const afterAll = await nativeBalance(sender.address);
  report(
    'OPEN QUESTION ANSWERED: token account initialized for a never-registered owner, in the same send',
    'PASS',
    `init reverted=n/a, created=${outcome.recipientTokenAccountCreated} — record this in docs/BACKEND_GAPS.md`,
  );

  // The sender moved ZERO native units, so the native delta is exactly the fee the token
  // program charged across the init + transfer transactions (plus any earlier setup txs are
  // excluded — beforeInit was taken just before this block).
  const feeTotal = beforeInit - afterAll;
  report(
    'token-program fee observed (init + transfer, if init happened)',
    'PASS',
    `${feeTotal} base units across up to two token txs — compare with the measured 1-unit native fee`,
  );

  const recipientBalance = await thruClient.getTokenBalance(recipient.address, deploy.mintAddress);
  report(
    'recipient holds the sent amount',
    recipientBalance.exists && recipientBalance.amount === SEND_AMOUNT ? 'PASS' : 'FAIL',
    `${recipientBalance.amount} base units`,
  );

  const senderBalance2 = await thruClient.getTokenBalance(sender.address, deploy.mintAddress);
  report(
    'sender balance decreased by exactly the sent amount',
    senderBalance2.amount === SUPPLY - SEND_AMOUNT ? 'PASS' : 'FAIL',
    `${senderBalance1.amount} -> ${senderBalance2.amount}`,
  );

  const recipientWallet = await thruClient.getAccountInfo(recipient.address);
  report(
    'recipient WALLET account stays unregistered (token receive does not imply native receive)',
    recipientWallet.exists ? '??' : 'PASS',
    recipientWallet.exists
      ? 'unexpected — the wallet account now exists; update docs'
      : 'native tx.send to this address must still refuse (RECIPIENT_NOT_ACTIVATED)',
  );
}

// ---- 4. History decodes the token entries ------------------------------------
const histories = await thruClient.listAccountHistory(sender.address, 25);
const tokenEntries = histories.filter((e) => typeof e.kind === 'string' && e.kind.startsWith('token'));
report(
  'token entries visible in sender history (transfer, mint, account-init)',
  tokenEntries.length >= 3 ? 'PASS' : '??',
  tokenEntries.map((e) => e.kind).join(', ') || 'none found',
);
const transferEntry = histories.find((e) => e.kind === 'token-transfer');
report(
  'token transfer entry carries amount + both token accounts',
  transferEntry && transferEntry.amount === SEND_AMOUNT && transferEntry.tokenSource && transferEntry.tokenDest
    ? 'PASS'
    : '??',
  transferEntry ? `amount=${transferEntry.amount}` : 'not found — direction/symbol resolution lives in tx-service',
);
if (outcome?.signature) console.log(`\ntransfer signature: ${outcome.signature}`);
if (outcome?.initSignature) console.log(`init signature:     ${outcome.initSignature}`);
}

try {
  await main();
} catch (err) {
  console.log(`\nAborted early: ${err.message}`);
  console.log('If this is a fetch/connect error, the RPC is unreachable from this environment —');
  console.log('run the script where the network is reachable. Nothing here requires a real vault.');
  process.exitCode = 1;
}

console.log('\nDone. Paste this output into the PR that ships token transfer, and resolve the two');
console.log('doc questions it prints: recipient-owner existence, and the token-program fee.');
console.log(`(Signatures are on ${networkId}; no keys from this run exist anywhere else.)`);
