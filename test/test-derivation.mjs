// GOLDEN DERIVATION VECTORS — the most important test in this repository.
//
// WHY THIS EXISTS
//
// Thru is on devnet and @thru/sdk changes rapidly. Key derivation is the one thing that must
// NEVER change silently. If an SDK upgrade alters how a mnemonic maps to an address, then every
// existing vault starts deriving DIFFERENT addresses. The user's keys are still intact, but the
// wallet looks in the wrong place, so their balance reads zero and their funds appear to have
// vanished. Nothing else in this suite would notice.
//
// So: a fixed phrase must always produce a fixed set of addresses. If it does not, the build
// fails and someone makes a deliberate decision instead of shipping the change.
//
// SDK 0.5.x changed the BIP-44 coin type from 9999 to 8478, so this vector set was regenerated
// on the owner's explicit instruction that no legacy-vault derivation path is needed (D-030).
// Vaults created with 0.4.x will derive new addresses after this upgrade.
//
// The dependency versions are pinned exactly in package.json (no caret) for the same reason —
// an unrelated `npm install` must not be able to move derivation.
//
// IF THIS TEST FAILS
//
//   1. Do NOT update the expected values to make it pass. That is the one forbidden fix.
//   2. Determine whether derivation genuinely changed, or whether an import moved within
//      the SDK's public crypto surface.
//   3. If derivation really changed, confirm how existing installs are handled BEFORE shipping.
//      For the 0.5.1 upgrade the owner declined a legacy/migration path (D-030).
//   4. Only after that, regenerate with `node scripts/gen-derivation-vectors.mjs` and commit
//      the new vectors together with the version bump and the migration.
//
// Run: node test-derivation.mjs

import { readFileSync } from 'node:fs';
import { MnemonicGenerator, ThruHDWallet } from '@thru/sdk/crypto';
import { keys, Pubkey } from '@thru/sdk';

// A deliberately public, well-known test phrase. It must never hold real funds.
const VECTORS = {
  // Regenerated on 0.5.1 (`node scripts/gen-derivation-vectors.mjs`) after the SDK moved
  // from coin type 9999 to 8478. The owner chose not to keep a legacy derivation path (D-030).
  sdkVersion: '0.5.1',
  phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  hd: [
    { index: 0, address: 'taHWXdTRD0-KOS2eF8TYzep8aOKj6tw1mXu7ZzjjnMDm6A' },
    { index: 1, address: 'taVG_bUvICb3ByYM98nI_9rNTDwFYkSHiT9kJhaLWh62N9' },
    { index: 2, address: 'taKaXHUipp-jyANOWGjhvlkH2oCgN_JnJFh8bVyicLojZx' },
    { index: 3, address: 'taUExGMxP28D-mU-Lb38Bw3yC0QnX9xKz9bVW3hc0B6KI8' },
    { index: 4, address: 'taVjAV8SsUIUUIscS5LzbAS9GZ6c-vHajl_8x0BITMX_Y6' },
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

// A range means an unrelated install can move derivation without anyone deciding to. The
// programs package is pinned too because its SDK peer/import path must not silently introduce a
// second SDK copy into the wallet.
for (const name of ['@thru/sdk', '@thru/programs']) {
  ok(
    `${name} is pinned exactly (no ^ or ~)`,
    /^\d+\.\d+\.\d+$/.test(pkg.dependencies[name] || ''),
    `package.json says '${pkg.dependencies[name] || '(missing)'}'`,
  );
}

// A version drift is a warning, not a failure: the derivation checks below are the real verdict.
// A new SDK version that derives identically is fine and only needs the recorded note updated.
if (installedSdk !== VECTORS.sdkVersion) {
  console.warn(
    `  note - @thru/sdk differs from when vectors were generated`
    + `\n         expected ${VECTORS.sdkVersion}, installed ${installedSdk}`
    + `\n         The derivation checks below decide whether this matters.`,
  );
}

section('A fixed mnemonic derives fixed addresses');

const seed = MnemonicGenerator.toSeed(VECTORS.phrase);
ok('the reference phrase is accepted as valid', Boolean(seed));

const derived = [];
for (const expected of VECTORS.hd) {
  const account = await ThruHDWallet.getAccount(seed, expected.index);
  derived.push(account);
  ok(
    `HD index ${expected.index} derives ${expected.address.slice(0, 12)}…`,
    account.address === expected.address,
    `expected ${expected.address}\n         actual   ${account.address}\n`
    + '         DERIVATION HAS CHANGED. Read the header of this file before touching anything.',
  );
}

section('Derivation is deterministic and index-sensitive');

const again = await ThruHDWallet.getAccount(MnemonicGenerator.toSeed(VECTORS.phrase), 0);
ok('re-deriving the same index yields the same address', again.address === derived[0].address);
ok(
  'different indices yield different addresses',
  new Set(derived.map((account) => account.address)).size === derived.length,
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

for (const [i, expected] of VECTORS.hd.entries()) {
  ok(
    `index ${expected.index} address keeps the ta-prefixed base64url shape`,
    /^ta[A-Za-z0-9_-]{40,}$/.test(derived[i].address),
    `got ${derived[i].address}`,
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
console.log('Derivation matches the pinned SDK 0.5.1 vectors (coin type 8478, D-030).');
