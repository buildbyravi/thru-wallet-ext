import { keys as sdkKeys } from '@thru/sdk';
import { createOnChainAccount, claimFaucet, getAccountInfo } from './src/lib/thru-client.js';

async function testSelfSigning() {
  // 1. Generate a new, completely unlinked user key pair
  const userKeyPair = await sdkKeys.generateKeyPair();
  console.log('Testing Zero-Wallet Linking for new address:', userKeyPair.address);

  // 2. Self-Signed Account Registration (0 fee, no sponsor/third-party payer)
  console.log('Registering account via self-signed 0-fee transaction...');
  try {
    const createSig = await createOnChainAccount(userKeyPair);
    console.log('Self-Signed Creation Sig:', createSig);
  } catch (err) {
    console.log('Self-signed creation attempt:', err.message);
  }

  // 3. Self-Signed Faucet Claim (0-balance wallet signs for itself)
  console.log('Claiming faucet via self-signing...');
  try {
    const faucetSig = await claimFaucet(userKeyPair, 100n);
    console.log('Self-Signed Faucet Sig:', faucetSig);
  } catch (err) {
    console.log('Self-signed faucet attempt:', err.message);
  }

  const info = await getAccountInfo(userKeyPair.address);
  console.log('Account Info On-Chain:', info);
}

testSelfSigning().catch(console.error);
