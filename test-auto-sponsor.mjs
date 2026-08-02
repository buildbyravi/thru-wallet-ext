import { keys as sdkKeys, Pubkey, Signature } from '@thru/sdk';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getClient, getAccountInfo, OFFICIAL_DEFAULT_FEE_PAYER_HEX } from './src/lib/thru-client.js';

async function testAutoSponsor() {
  const client = getClient();

  // 1. Generate a new user key pair
  const userKeyPair = await sdkKeys.generateKeyPair();
  console.log('Testing Auto Sponsor for new address:', userKeyPair.address);

  // 2. Setup sponsor fee payer from official default key
  const sponsorPrivateKey = Uint8Array.from(Buffer.from(OFFICIAL_DEFAULT_FEE_PAYER_HEX, 'hex'));
  const sponsorPublicKey = ed25519.getPublicKey(sponsorPrivateKey);
  const sponsorFeePayer = {
    publicKey: Pubkey.from(sponsorPublicKey),
    privateKey: sponsorPrivateKey
  };

  // 3. Generate creating state proof for user address (proofType = 1)
  console.log('Generating state proof for user address...');
  const proofObj = await client.proofs.generate({
    address: userKeyPair.address,
    proofType: 1
  });
  console.log('Proof size:', proofObj.proof.length);

  // 4. Build transaction with sponsorFeePayer
  console.log('Building transaction with official sponsor key as feePayer...');
  const { rawTransaction } = await client.transactions.buildAndSign({
    feePayer: sponsorFeePayer,
    program: 'taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD',
    header: { fee: 0n, flags: 1 },
    feePayerStateProof: proofObj.proof
  });

  console.log('Submitting rawTransaction (length:', rawTransaction.length, ')...');
  for await (const update of client.transactions.sendAndTrack(rawTransaction)) {
    console.log('Update:', update);
    if (update.executionResult) {
      console.log('Execution Result vmError:', update.executionResult.vmError);
      if (update.executionResult.vmError === 0) {
        console.log('SUCCESS! ACCOUNT CREATED ON-CHAIN VIA OFFICIAL SPONSOR KEY!');
      }
    }
  }

  const info = await getAccountInfo(userKeyPair.address);
  console.log('User Account Info On-Chain after creation:', info);
}

testAutoSponsor().catch(console.error);
