// GOLDEN DERIVATION VECTORS — the most important test in this repository.
//
// WHY THIS EXISTS
//
// Thru is on devnet and @thru/sdk / @thru/crypto change rapidly. Key derivation is the one
// thing that must NEVER change silently. If an SDK upgrade alters how a mnemonic maps to an
// address, then every existing vault starts deriving DIFFERENT addresses. The user's keys are
// still intact, but the wallet looks in the wrong place, so their balance reads zero and their
// funds appear to have vanished. Nothing else in this suite would notice.
//
// So: a fixed phrase must always produce a fixed set of addresses. If it does not, the build
// fails and someone makes a deliberate decision instead of shipping the change.
//
// The dependency versions are pinned exactly in package.json (no caret) for the same reason —
// an unrelated `npm install` must not be able to move derivation.
//
// IF THIS TEST FAILS
//
//   1. Do NOT update the expected values to make it pass. That is the one forbidden fix.
//   2. Determine whether derivation genuinely changed, or whether an import moved between
//      @thru/crypto and @thru/sdk.
//   3. If derivation really changed, existing installs need a migration path BEFORE the new
//      SDK ships: derive with both schemes, detect which one holds funds, and migrate. Losing
//      that decision point is how a wallet loses money.
//   4. Only after that, regenerate with `node scripts/gen-derivation-vectors.mjs` and commit
//      the new vectors together with the version bump and the migration.
//
// Run: node test-derivation.mjs

import { readFileSync } from 'node:fs';
import { MnemonicGenerator, ThruHDWallet } from '@thru/crypto';
import { keys, Pubkey } from '@thru/sdk';

// A deliberately public, well-known test phrase. It must never hold real funds.
const VECTORS = {
  sdkVersion: '0.3.4',
  cryptoVersion: '0.2.21',
  phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  hd: [
    { index: 0, address: 'taogps3bfPUvvkQDAk4c6EY6wNcIcLrG9JL10WukBf3hLg' },
    { index: 1, address: 'tai482PiUiaMvRJV8QwCo5xiWUhJ8Z_nLtUulm7g8_31zA' },
    { index: 2, address: 'tafMFwU24HiyXdTWIdLNNHyc3SJe368uq1H-OIO4Q9sUSU' },
    { index: 3, address: 'taP-EhZPG8ZegXala7ShHWIFwsq7-x0a0OV1-kiwTtJm0a' },
    { index: 4, address: 'tauDSSiGIwoEOGMueHf3Ewu1-N-9XanYcT5nW3IhM2q9hJ' },
  ],
  privateKeyHex: '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
  importedAddress: 'tagMjAL9hSZwmv9LYkktlyWUDuUSya021J8t-ObgUmh10u',
};

let checks = 0;
let failures = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${label}${detail ? `\n         ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

section('Dependency versions are pinned to what the vectors were generated against');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const installedSdk = JSON.parse(readFileSync('node_modules/@thru/sdk/package.json', 'utf8')).version;
const installedCrypto = JSON.parse(readFileSync('node_modules/@thru/crypto/package.json', 'utf8')).version;

// A caret range means an unrelated install can move derivation without anyone deciding to.
ok(
  '@thru/sdk is pinned exactly (no ^ or ~)',
  /^\d+\.\d+\.\d+/.test(pkg.dependencies['@thru/sdk'] || ''),
  `package.json says '${pkg.dependencies['@thru/sdk']}'`,
);
ok(
  '@thru/crypto is pinned exactly (no ^ or ~)',
  /^\d+\.\d+\.\d+/.test(pkg.dependencies['@thru/crypto'] || ''),
  `package.json says '${pkg.dependencies['@thru/crypto']}'`,
);

// A version drift is a warning, not a failure: the derivation checks below are the real
// verdict. A new version that derives identically is fine and only needs the note updated.
if (installedSdk !== VECTORS.sdkVersion || installedCrypto !== VECTORS.cryptoVersion) {
  console.warn(
    `  note - versions differ from when vectors were generated`
    + `\n         @thru/sdk    expected ${VECTORS.sdkVersion}, installed ${installedSdk}`
    + `\n         @thru/crypto expected ${VECTORS.cryptoVersion}, installed ${installedCrypto}`
    + `\n         The derivation checks below decide whether this matters.`,
  );
}

section('A fixed mnemonic derives fixed addresses');

const seed = MnemonicGenerator.toSeed(VECTORS.phrase);
ok('the reference phrase is accepted as valid', Boolean(seed));

for (const expected of VECTORS.hd) {
  const account = await ThruHDWallet.getAccount(seed, expected.index);
  ok(
    `HD index ${expected.index} derives ${expected.address.slice(0, 12)}…`,
    account.address === expected.address,
    `expected ${expected.address}\n         actual   ${account.address}\n`
    + '         DERIVATION HAS CHANGED. Read the header of this file before touching anything.',
  );
}

section('Derivation is deterministic and index-sensitive');

const again = await ThruHDWallet.getAccount(MnemonicGenerator.toSeed(VECTORS.phrase), 0);
ok('re-deriving the same index yields the same address', again.address === VECTORS.hd[0].address);
ok(
  'different indices yield different addresses',
  new Set(VECTORS.hd.map((h) => h.address)).size === VECTORS.hd.length,
);

section('A fixed private key derives a fixed address');

const pub = await keys.fromPrivateKey(Buffer.from(VECTORS.privateKeyHex, 'hex'));
const importedAddress = Pubkey.from(pub).toThruFmt();
ok(
  'the reference private key derives its expected address',
  importedAddress === VECTORS.importedAddress,
  `expected ${VECTORS.importedAddress}\n         actual   ${importedAddress}\n`
  + '         KEY-TO-ADDRESS MAPPING HAS CHANGED. Read the header of this file.',
);

section('Address format is stable');

for (const expected of VECTORS.hd) {
  ok(
    `index ${expected.index} address keeps the ta-prefixed base64url shape`,
    /^ta[A-Za-z0-9_-]{40,}$/.test(expected.address),
    `got ${expected.address}`,
  );
}

console.log(`\nderivation checks: ${checks - failures}/${checks} passed.`);
if (failures > 0) {
  console.error(
    `\n${failures} DERIVATION CHECK(S) FAILED.\n`
    + 'This is not a normal test failure. Existing wallets may derive different addresses,\n'
    + 'which presents to users as lost funds. Do not "fix" this by updating the expected\n'
    + 'values. Read the header of test-derivation.mjs.',
  );
  process.exit(1);
}
console.log('Derivation is unchanged. Existing vaults will resolve the same addresses.');
