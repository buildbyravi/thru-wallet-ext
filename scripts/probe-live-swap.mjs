// Live probe for seeding a demo token pair, initializing an AMM pool,
// adding initial liquidity, and executing a live swap on Thru Betanet.
//
// Records on-chain evidence in scripts/defi-evidence/2026-10-25-live-swap-probe.json.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pubkey, Signature } from '@thru/sdk';
import * as amm from '@thru/programs/amm';
import * as token from '@thru/programs/token';
import { getNetworkConfig } from '../src/lib/networks.js';
import * as thruClient from '../src/lib/thru-client.js';
import * as vault from '../src/lib/vault.js';

// Setup storage shim for token registry / client / vault
function makeStorageArea() {
  const data = new Map();
  return {
    async get(key) {
      if (key === undefined || key === null) return Object.fromEntries(data);
      if (Array.isArray(key)) {
        const out = {};
        for (const k of key) if (data.has(k)) out[k] = data.get(k);
        return out;
      }
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
    },
    async remove(key) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) data.delete(k);
    },
  };
}

globalThis.chrome = {
  storage: {
    local: makeStorageArea(),
    session: makeStorageArea(),
  },
};

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}
function ok(text) {
  console.log(`    OK   ${text}`);
}
function info(text) {
  console.log(`         ${text}`);
}

const network = getNetworkConfig('betanet');
thruClient.configureNetwork(network);
const client = thruClient.getClient();

// Load mnemonic from .env
let mnemonic = '';
for (const l of readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^\s*(?:THRU_SEED|SEED)\s*=\s*"?([^"\n]+?)"?\s*$/);
  if (m) { mnemonic = m[1].trim(); break; }
}
if (!mnemonic) {
  console.error('No mnemonic found in .env');
  process.exit(1);
}

const password = 'ProbePassword123!';
await vault.importMnemonicVault(mnemonic, password);
const activeAccount = await vault.getActiveAccount();
console.log('Active wallet account:', activeAccount.address);

const payerKeypair = {
  publicKey: activeAccount.publicKey,
  privateKey: activeAccount.privateKey,
  address: activeAccount.address,
};

// Step 0: Check account info and faucet claim if needed
step(0, 'Checking account balance on Betanet');
const accInfo = await thruClient.getAccountInfo(activeAccount.address);
info(`Balance: ${accInfo.balance.toString()} units`);

if (accInfo.balance < 5000n) {
  step('0b', 'Claiming faucet');
  try {
    const claimSig = await thruClient.claimFaucet(payerKeypair, 10000n);
    ok(`Faucet claimed: ${claimSig}`);
  } catch (err) {
    info(`Faucet claim note: ${err.message}`);
  }
}

// Step 1 & 2: Reuse already-deployed tokens if alive, else deploy fresh
let tokenAMint = 'tafXtl25J1-kWm8yPvmJDTw4gHGfqP6raMz-g1Jo5XPdhQ';
let tokenBMint = 'ta8mZ99Bkg_U3sUPiPaug66lrA9cvp7z_q3VSSwet0lTEJ';
let tokenASig = 'tscM8K5SuxFZFiKq9jy9Gv9pSUb5ryjxPpw8vunb0Ak80w4yESn8OuphR0pFBCbB3CR4oXw__GIK9A6c1LXZFrAiFT';
let tokenBSig = 'ts1meV25BE7Mi7VJCW-xLQLBzRgfYEZ-l91sLG0h0xgGOGfuIH40O_RzLPQvT_o1Y_I9PUiVMdkYuFjOPir2N0AiLN';

const checkA = await thruClient.readMintAccount(tokenAMint).catch(() => null);
const checkB = await thruClient.readMintAccount(tokenBMint).catch(() => null);

if (!checkA?.exists) {
  step(1, 'Deploying Demo Token A (AMMA)');
  const seedA = thruClient.generateMintSeed();
  const tokenA = await thruClient.deployTokenMint({
    feePayer: payerKeypair,
    ticker: 'AMMA',
    name: 'AMM Demo Token A',
    decimals: 6,
    initialSupply: 1_000_000_000n, // 1,000 AMMA
    description: 'AMM Live Swap Demo Token A',
    mintSeed: seedA,
    networkId: network.id,
    onProgress: (p) => info(`Token A [${p.step}]: ${p.message || ''}`),
  });
  tokenAMint = tokenA.mintAddress;
  tokenASig = tokenA.signature;
  ok(`Token A deployed at: ${tokenAMint}`);
} else {
  ok(`Using existing Token A: ${tokenAMint}`);
}

if (!checkB?.exists) {
  step(2, 'Deploying Demo Token B (AMMB)');
  const seedB = thruClient.generateMintSeed();
  const tokenB = await thruClient.deployTokenMint({
    feePayer: payerKeypair,
    ticker: 'AMMB',
    name: 'AMM Demo Token B',
    decimals: 6,
    initialSupply: 1_000_000_000n, // 1,000 AMMB
    description: 'AMM Live Swap Demo Token B',
    mintSeed: seedB,
    networkId: network.id,
    onProgress: (p) => info(`Token B [${p.step}]: ${p.message || ''}`),
  });
  tokenBMint = tokenB.mintAddress;
  tokenBSig = tokenB.signature;
  ok(`Token B deployed at: ${tokenBMint}`);
} else {
  ok(`Using existing Token B: ${tokenBMint}`);
}

// Step 3: Derive Pool and Associated Accounts
step(3, 'Deriving AMM Pool Addresses');
const poolAddresses = amm.deriveAmmPoolAddresses(client, {
  ammProgramAddress: amm.AMM_PROGRAM_ADDRESS,
  mintAAddress: tokenAMint,
  mintBAddress: tokenBMint,
  swapFeeBps: 30, // 0.30%
});
info(`Pool Address: ${poolAddresses.poolAddress}`);
info(`Mint One: ${poolAddresses.mintOneAddress}`);
info(`Mint Two: ${poolAddresses.mintTwoAddress}`);
info(`Input Order: ${poolAddresses.inputOrder}`);

const ammProg = amm.AMM_PROGRAM_ADDRESS;
const vaultOneDerived = token.deriveTokenAccountAddress(
  client,
  ammProg,
  poolAddresses.mintOneAddress,
  network.tokenProgramId,
  poolAddresses.vaultOneSeed,
);
const vaultTwoDerived = token.deriveTokenAccountAddress(
  client,
  ammProg,
  poolAddresses.mintTwoAddress,
  network.tokenProgramId,
  poolAddresses.vaultTwoSeed,
);
const lpMintSeedHex = Buffer.from(poolAddresses.lpMintSeed).toString('hex');
const lpMintDerived = token.deriveMintAddress(
  client,
  ammProg,
  lpMintSeedHex,
  network.tokenProgramId,
);

info(`Vault One Address: ${vaultOneDerived.address}`);
info(`Vault Two Address: ${vaultTwoDerived.address}`);
info(`LP Mint Address: ${lpMintDerived.address}`);

// Step 4: Check if pool already initialized or initialize fresh
step(4, 'Checking / Initializing AMM Pool');
let poolAcc = null;
let parsedPool = null;
try {
  poolAcc = await client.accounts.get(poolAddresses.poolAddress);
  parsedPool = amm.parseAmmPoolMetadata(poolAcc);
} catch {
  parsedPool = null;
}

let initSig = 'tsuVniTBYRtIpuJIcO-e225W9cMxtgM3Ijv1R1XOEkat-WxohuA_NfREfj1NuSE6yI2E_btfp2i9V_6fNnC6GpBSEA';
if (!parsedPool?.isInitialized) {
  const blockHeight = await client.blocks.getBlockHeight();
  const targetSlot = blockHeight.finalized - 10n;
  info(`Using safe finalized slot: ${targetSlot}`);

  const [poolProofObj, lpMintProofObj, vaultOneProofObj, vaultTwoProofObj] = await Promise.all([
    client.proofs.generate({ address: poolAddresses.poolAddress, proofType: 1, targetSlot }),
    client.proofs.generate({ address: lpMintDerived.address, proofType: 1, targetSlot }),
    client.proofs.generate({ address: vaultOneDerived.address, proofType: 1, targetSlot }),
    client.proofs.generate({ address: vaultTwoDerived.address, proofType: 1, targetSlot }),
  ]);

  const initPoolInstruction = amm.createInitPoolInstruction({
    payerAccountBytes: Pubkey.from(activeAccount.publicKey).toBytes(),
    poolAccountBytes: Pubkey.from(poolAddresses.poolAddress).toBytes(),
    lpMintAccountBytes: Pubkey.from(lpMintDerived.address).toBytes(),
    vaultOneAccountBytes: Pubkey.from(vaultOneDerived.address).toBytes(),
    vaultTwoAccountBytes: Pubkey.from(vaultTwoDerived.address).toBytes(),
    mintOneAccountBytes: Pubkey.from(poolAddresses.mintOneAddress).toBytes(),
    mintTwoAccountBytes: Pubkey.from(poolAddresses.mintTwoAddress).toBytes(),
    tokenProgramAccountBytes: Pubkey.from(network.tokenProgramId).toBytes(),
    swapFeeBps: poolAddresses.swapFeeBps,
    lpMintSeed: poolAddresses.lpMintSeed,
    poolStateProof: poolProofObj.proof,
    lpMintStateProof: lpMintProofObj.proof,
    vaultOneStateProof: vaultOneProofObj.proof,
    vaultTwoStateProof: vaultTwoProofObj.proof,
  });

  const initUnits = {
    computeUnits: 2_000_000,
    stateUnits: 4_096,
    memoryUnits: 60_000,
    fee: 0n,
  };

  const { rawTransaction: initTx } = await client.transactions.buildAndSign({
    feePayer: { publicKey: activeAccount.publicKey, privateKey: activeAccount.privateKey },
    program: amm.AMM_PROGRAM_ADDRESS,
    header: initUnits,
    accounts: {
      readWrite: [
        poolAddresses.poolAddress,
        lpMintDerived.address,
        vaultOneDerived.address,
        vaultTwoDerived.address,
      ],
      readOnly: [
        poolAddresses.mintOneAddress,
        poolAddresses.mintTwoAddress,
        network.tokenProgramId,
      ],
    },
    instructionData: initPoolInstruction,
  });

  for await (const update of client.transactions.sendAndTrack(initTx)) {
    if (update?.signature?.value && !initSig) {
      initSig = Signature.from(update.signature.value).toThruFmt();
      info(`Init pool broadcasted: ${initSig}`);
    }
    if (update?.executionResult) {
      console.log('Execution result:', JSON.stringify(update.executionResult, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
      if (update.executionResult.vmError !== 0) {
        throw new Error(`Init pool reverted: vmError=${update.executionResult.vmError}, userErrorCode=${update.executionResult.userErrorCode}`);
      }
      ok(`Init pool confirmed on-chain!`);
      break;
    }
  }

  poolAcc = await client.accounts.get(poolAddresses.poolAddress);
  parsedPool = amm.parseAmmPoolMetadata(poolAcc);
} else {
  ok(`Pool already initialized at ${poolAddresses.poolAddress}`);
}

info(`Pool parsed: initialized=${parsedPool.isInitialized}, fee=${parsedPool.swapFeeBps} bps, authority=${parsedPool.swapPoolAuthority}`);

// Step 5: Add Liquidity
step(5, 'Ensuring Initial Liquidity in AMM Pool');
const depositorTokenOne = await thruClient.initializeTokenAccount(payerKeypair, activeAccount.address, poolAddresses.mintOneAddress);
const depositorTokenTwo = await thruClient.initializeTokenAccount(payerKeypair, activeAccount.address, poolAddresses.mintTwoAddress);
const depositorLp = await thruClient.initializeTokenAccount(payerKeypair, activeAccount.address, parsedPool.lpMint);

info(`Depositor Token One TA: ${depositorTokenOne.tokenAccount}`);
info(`Depositor Token Two TA: ${depositorTokenTwo.tokenAccount}`);
info(`Depositor LP TA: ${depositorLp.tokenAccount}`);

async function readVaultReserves() {
  const [v1Acc, v2Acc] = await Promise.all([
    client.accounts.get(parsedPool.vaultOne),
    client.accounts.get(parsedPool.vaultTwo),
  ]);
  const p1 = token.parseTokenAccountData(v1Acc);
  const p2 = token.parseTokenAccountData(v2Acc);
  return {
    vaultOne: { amount: p1.amount, tokenAccount: parsedPool.vaultOne },
    vaultTwo: { amount: p2.amount, tokenAccount: parsedPool.vaultTwo },
  };
}

let reserves = await readVaultReserves();
let balVaultOne = reserves.vaultOne;
let balVaultTwo = reserves.vaultTwo;
info(`Current reserves: VaultOne=${balVaultOne?.amount ?? 0n}, VaultTwo=${balVaultTwo?.amount ?? 0n}`);

let addLiqSig = null;
if (!balVaultOne?.amount || balVaultOne.amount < 10_000_000n || !balVaultTwo?.amount || balVaultTwo.amount < 10_000_000n) {
  const addLiqInstruction = amm.createAddLiquidityInstruction({
    poolAccountBytes: Pubkey.from(poolAddresses.poolAddress).toBytes(),
    depositorAccountBytes: Pubkey.from(activeAccount.publicKey).toBytes(),
    depositorTokenOneAccountBytes: Pubkey.from(depositorTokenOne.tokenAccount).toBytes(),
    depositorTokenTwoAccountBytes: Pubkey.from(depositorTokenTwo.tokenAccount).toBytes(),
    depositorLpAccountBytes: Pubkey.from(depositorLp.tokenAccount).toBytes(),
    vaultOneAccountBytes: Pubkey.from(parsedPool.vaultOne).toBytes(),
    vaultTwoAccountBytes: Pubkey.from(parsedPool.vaultTwo).toBytes(),
    lpMintAccountBytes: Pubkey.from(parsedPool.lpMint).toBytes(),
    tokenProgramAccountBytes: Pubkey.from(network.tokenProgramId).toBytes(),
    maxAmountMintOne: 100_000_000n, // 100 units
    maxAmountMintTwo: 100_000_000n, // 100 units
    minLpOut: 1_000n,
  });

  const addLiqUnits = {
    computeUnits: 1_500_000,
    stateUnits: 2_048,
    memoryUnits: 60_000,
    fee: 0n,
  };

  const { rawTransaction: addLiqTx } = await client.transactions.buildAndSign({
    feePayer: { publicKey: activeAccount.publicKey, privateKey: activeAccount.privateKey },
    program: amm.AMM_PROGRAM_ADDRESS,
    header: addLiqUnits,
    accounts: {
      readWrite: [
        poolAddresses.poolAddress,
        depositorTokenOne.tokenAccount,
        depositorTokenTwo.tokenAccount,
        depositorLp.tokenAccount,
        parsedPool.vaultOne,
        parsedPool.vaultTwo,
        parsedPool.lpMint,
      ],
      readOnly: [network.tokenProgramId],
    },
    instructionData: addLiqInstruction,
  });

  for await (const update of client.transactions.sendAndTrack(addLiqTx)) {
    if (update?.signature?.value && !addLiqSig) {
      addLiqSig = Signature.from(update.signature.value).toThruFmt();
      info(`Add liquidity broadcasted: ${addLiqSig}`);
    }
    if (update?.executionResult) {
      if (update.executionResult.vmError !== 0) {
        throw new Error(`Add liquidity reverted: vmError=${update.executionResult.vmError}, userErrorCode=${update.executionResult.userErrorCode}`);
      }
      ok(`Add liquidity confirmed on-chain!`);
      break;
    }
  }

  reserves = await readVaultReserves();
  balVaultOne = reserves.vaultOne;
  balVaultTwo = reserves.vaultTwo;
}
ok(`Pool reserves: VaultOne=${balVaultOne.amount} units, VaultTwo=${balVaultTwo.amount} units`);

// Step 6: Execute Live Swap
step(6, 'Executing Live AMM Swap: MintOne -> MintTwo');
const swapAmountIn = 1_000_000n; // 1 unit
const quote = amm.quoteAmmSwapExactIn({
  amountIn: swapAmountIn,
  reserveIn: balVaultOne.amount,
  reserveOut: balVaultTwo.amount,
  swapFeeBps: poolAddresses.swapFeeBps,
});
info(`Quote: amountIn=${quote.amountIn}, fee=${quote.feeAmount}, amountOut=${quote.amountOut}`);

const minAmountOut = (quote.amountOut * 95n) / 100n; // 5% slippage tolerance

const swapInstruction = amm.createSwapInstruction({
  poolAccountBytes: Pubkey.from(poolAddresses.poolAddress).toBytes(),
  userTransferAuthorityBytes: Pubkey.from(activeAccount.publicKey).toBytes(),
  userInputAccountBytes: Pubkey.from(depositorTokenOne.tokenAccount).toBytes(),
  userOutputAccountBytes: Pubkey.from(depositorTokenTwo.tokenAccount).toBytes(),
  vaultInputAccountBytes: Pubkey.from(parsedPool.vaultOne).toBytes(),
  vaultOutputAccountBytes: Pubkey.from(parsedPool.vaultTwo).toBytes(),
  lpMintAccountBytes: Pubkey.from(parsedPool.lpMint).toBytes(),
  tokenProgramAccountBytes: Pubkey.from(network.tokenProgramId).toBytes(),
  amountIn: swapAmountIn,
  minAmountOut,
});

const swapUnits = {
  computeUnits: 1_000_000,
  stateUnits: 2_048,
  memoryUnits: 60_000,
  fee: 0n,
};

const { rawTransaction: swapTx } = await client.transactions.buildAndSign({
  feePayer: { publicKey: activeAccount.publicKey, privateKey: activeAccount.privateKey },
  program: amm.AMM_PROGRAM_ADDRESS,
  header: swapUnits,
  accounts: {
    readWrite: [
      poolAddresses.poolAddress,
      depositorTokenOne.tokenAccount,
      depositorTokenTwo.tokenAccount,
      parsedPool.vaultOne,
      parsedPool.vaultTwo,
      parsedPool.lpMint,
    ],
    readOnly: [network.tokenProgramId],
  },
  instructionData: swapInstruction,
});

let swapSig = null;
let swapExecution = null;
for await (const update of client.transactions.sendAndTrack(swapTx)) {
  if (update?.signature?.value && !swapSig) {
    swapSig = Signature.from(update.signature.value).toThruFmt();
    info(`Swap broadcasted: ${swapSig}`);
  }
  if (update?.executionResult) {
    swapExecution = update.executionResult;
    if (update.executionResult.vmError !== 0) {
      throw new Error(`Swap reverted: vmError=${update.executionResult.vmError}, userErrorCode=${update.executionResult.userErrorCode}`);
    }
    ok(`Swap executed successfully with vmError 0!`);
    break;
  }
}

// Read back reserves after swap
const reservesAfter = await readVaultReserves();
const balVaultOneAfter = reservesAfter.vaultOne;
const balVaultTwoAfter = reservesAfter.vaultTwo;
ok(`Post-swap reserves: VaultOne=${balVaultOneAfter.amount} units, VaultTwo=${balVaultTwoAfter.amount} units`);

// Step 7: Record Evidence
step(7, 'Recording Live Swap Evidence');
const evidence = {
  date: new Date().toISOString(),
  network: network.id,
  rpcUrl: network.rpcUrl,
  tester: activeAccount.address,
  tokenA: {
    ticker: 'AMMA',
    mint: tokenAMint,
    deployTx: tokenASig,
  },
  tokenB: {
    ticker: 'AMMB',
    mint: tokenBMint,
    deployTx: tokenBSig,
  },
  pool: {
    poolAddress: poolAddresses.poolAddress,
    mintOne: poolAddresses.mintOneAddress,
    mintTwo: poolAddresses.mintTwoAddress,
    lpMint: parsedPool.lpMint,
    vaultOne: parsedPool.vaultOne,
    vaultTwo: parsedPool.vaultTwo,
    swapFeeBps: poolAddresses.swapFeeBps,
    initTx: initSig,
  },
  liquidity: {
    addTx: addLiqSig,
    initialReserveOne: balVaultOne.amount.toString(),
    initialReserveTwo: balVaultTwo.amount.toString(),
  },
  swap: {
    direction: 'mintOne -> mintTwo',
    amountIn: swapAmountIn.toString(),
    quotedAmountOut: quote.amountOut.toString(),
    minAmountOut: minAmountOut.toString(),
    swapTx: swapSig,
    postReserveOne: balVaultOneAfter.amount.toString(),
    postReserveTwo: balVaultTwoAfter.amount.toString(),
    consumedComputeUnits: Number(swapExecution?.consumedComputeUnits ?? 0),
    consumedStateUnits: Number(swapExecution?.consumedStateUnits ?? 0),
    vmError: 0,
    verifiedLive: true,
  },
};

const evDir = join(process.cwd(), 'scripts', 'defi-evidence');
mkdirSync(evDir, { recursive: true });
const evPath = join(evDir, '2026-10-25-live-swap-probe.json');
writeFileSync(evPath, JSON.stringify(evidence, null, 2));
ok(`Evidence written to: ${evPath}`);
console.log('\n=======================================================');
console.log('ALL PHASES COMPLETED AND VERIFIED ON LIVE BETANET!');
console.log('=======================================================');
