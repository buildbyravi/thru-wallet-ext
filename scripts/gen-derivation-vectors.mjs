// Generates the golden derivation vectors for test-derivation.mjs.
// Run manually ONLY when intentionally adopting a new SDK whose derivation you have verified:
//   node scripts/gen-derivation-vectors.mjs
// Then paste the output into test-derivation.mjs and commit both together.

// Note the split: mnemonic and HD derivation live in @thru/crypto, while key/pubkey
// conversion lives in @thru/sdk. vault.js imports from both, so BOTH packages can change
// derivation and both versions are recorded in the vectors below.
import { MnemonicGenerator, ThruHDWallet } from '@thru/crypto';
import { keys, Pubkey } from '@thru/sdk';
import { readFileSync } from 'node:fs';

// Deterministic, well-known test phrase. NEVER hold funds on this.
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PRIVATE_KEY_HEX = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';

const sdkVersion = JSON.parse(readFileSync('node_modules/@thru/sdk/package.json', 'utf8')).version;
const cryptoVersion = JSON.parse(readFileSync('node_modules/@thru/crypto/package.json', 'utf8')).version;

const seed = MnemonicGenerator.toSeed(PHRASE);
const hd = [];
for (let i = 0; i < 5; i += 1) {
  const account = await ThruHDWallet.getAccount(seed, i);
  hd.push({ index: i, address: account.address });
}

const pub = await keys.fromPrivateKey(Buffer.from(PRIVATE_KEY_HEX, 'hex'));
const importedAddress = Pubkey.from(pub).toThruFmt();

console.log(JSON.stringify({
  sdkVersion,
  cryptoVersion,
  phrase: PHRASE,
  hd,
  privateKeyHex: PRIVATE_KEY_HEX,
  importedAddress,
}, null, 2));
