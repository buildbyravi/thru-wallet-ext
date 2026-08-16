// Mock chrome.storage.local / .session with simple in-memory maps, matching the
// promise-based (no-callback) API shape MV3 extensions use.
function makeStorageArea() {
  const data = new Map();
  return {
    async get(key) {
      if (key === undefined || key === null) {
        return Object.fromEntries(data);
      }
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
    _dump: () => Object.fromEntries(data),
  };
}

globalThis.chrome = {
  storage: {
    local: makeStorageArea(),
    session: makeStorageArea(),
  },
};

const assert = (cond, msg) => {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok -', msg);
};

const vault = await import('./src/lib/vault.js');

console.log('\n[1] Create a seed-based wallet');
const mnemonic = await vault.createVault('correct horse battery staple');
assert(mnemonic.split(' ').length === 12, 'mnemonic has 12 words');
assert(await vault.hasVault(), 'hasVault() true after create');
assert(await vault.isUnlocked(), 'isUnlocked() true immediately after create (this was the reported bug)');

const acc0 = await vault.getActiveAccount();
console.log('    account 0 address:', acc0.address);
assert(acc0.address.startsWith('ta'), 'address has ta prefix');
assert(acc0.label === 'Account 1', 'label is Account 1');

console.log('\n[2] Add a second HD account and switch to it');
const ref1 = await vault.addHdAccount();
assert(ref1.kind === 'hd' && ref1.index === 1, 'second account is hd index 1');
const acc1 = await vault.getActiveAccount();
assert(acc1.address !== acc0.address, 'account 1 has a different address than account 0');
console.log('    account 1 address:', acc1.address);

let accounts = await vault.listAccounts();
assert(accounts.length === 2, 'listAccounts returns 2 accounts');

console.log('\n[3] Import an extra private key into the SAME vault');
const { keys } = await import('@thru/sdk');
const generated = await keys.generateKeyPair();
const importedHex = Buffer.from(generated.privateKey).toString('hex');
const refImported = await vault.addImportedKey(importedHex);
assert(refImported.kind === 'imported' && refImported.keyIndex === 0, 'imported key gets keyIndex 0');
const accImported = await vault.getActiveAccount();
assert(accImported.address === generated.address, 'resolved imported account address matches the generated one');
console.log('    imported account address:', accImported.address);

accounts = await vault.listAccounts();
assert(accounts.length === 3, 'listAccounts now returns 3 accounts (2 hd + 1 imported)');

console.log('\n[4] Switch back to account 0 and confirm it resolves correctly');
await vault.switchActiveAccount({ kind: 'hd', index: 0 });
const backTo0 = await vault.getActiveAccount();
assert(backTo0.address === acc0.address, 'switching back to hd/0 resolves the same address as before');

console.log('\n[5] Export: wrong password must fail, right password must reveal the mnemonic');
let threw = false;
try {
  await vault.exportAccountSecret({ kind: 'hd', index: 0 }, 'totally wrong password');
} catch {
  threw = true;
}
assert(threw, 'export with wrong password throws');
const exported = await vault.exportAccountSecret({ kind: 'hd', index: 0 }, 'correct horse battery staple');
assert(exported.mnemonic === mnemonic, 'export with correct password returns the original mnemonic');

console.log('\n[6] Export the imported key specifically (should be the private key, not the mnemonic)');
const exportedImported = await vault.exportAccountSecret({ kind: 'imported', keyIndex: 0 }, 'correct horse battery staple');
assert(exportedImported.privateKeyHex === importedHex, 'exported private key matches what was imported');

console.log('\n[7] Lock, confirm locked state blocks account resolution, then unlock and confirm data persisted');
await vault.lock();
assert(!(await vault.isUnlocked()), 'isUnlocked() false after lock()');
let lockedThrew = false;
try {
  await vault.getActiveAccount();
} catch {
  lockedThrew = true;
}
assert(lockedThrew, 'getActiveAccount() throws while locked');

await vault.unlock('correct horse battery staple');
assert(await vault.isUnlocked(), 'isUnlocked() true after unlock()');
const afterUnlock = await vault.listAccounts();
assert(afterUnlock.length === 3, 'all 3 accounts still present after lock/unlock cycle');
const activeAfterUnlock = await vault.getActiveAccount();
assert(activeAfterUnlock.address === acc0.address, 'active account pointer survived the lock/unlock cycle');

console.log('\n[8] A private-key-only vault cannot add HD accounts');
await chrome.storage.local.remove(['vault', 'active_account_ref']);
await chrome.storage.session.remove('unlocked_session');
const pkOnlyGenerated = await keys.generateKeyPair();
const pkOnlyHex = Buffer.from(pkOnlyGenerated.privateKey).toString('hex');
await vault.importPrivateKeyVault(pkOnlyHex, 'another password 123');
assert(!(await vault.hasSeed()), 'hasSeed() is false for a private-key-only vault');
let noSeedThrew = false;
try {
  await vault.addHdAccount();
} catch (err) {
  noSeedThrew = true;
  console.log('    correctly refused with:', err.message);
}
assert(noSeedThrew, 'addHdAccount() throws on a private-key-only vault');
console.log('\n[9] Custom account labels/nicknames persist and resolve correctly');
await vault.setAccountLabel(pkOnlyGenerated.address, 'Trading Bot Primary');
const labels = await vault.getAccountLabels();
assert(labels[pkOnlyGenerated.address] === 'Trading Bot Primary', 'setAccountLabel saved custom label');
const activeLabeled = await vault.getActiveAccount();
assert(activeLabeled.label === 'Trading Bot Primary', 'resolveAccount returned the custom nickname');
await vault.setAccountLabel(pkOnlyGenerated.address, ''); // clearing label
const labelsAfterClear = await vault.getAccountLabels();
assert(!labelsAfterClear[pkOnlyGenerated.address], 'clearing label removes entry');
const activeDefault = await vault.getActiveAccount();
assert(activeDefault.label === 'Imported 1', 'cleared label falls back to default name');

console.log('\n[10] Vault V2 keeps multiple seed and private-key keyrings isolated under one password');
await vault.resetWallet();
await vault.createVault('keyring migration password');
const { MnemonicGenerator } = await import('@thru/crypto');
const secondMnemonic = MnemonicGenerator.generate();
const addedSeed = await vault.addSeedKeyring(secondMnemonic, 'keyring migration password', 'Trading seed');
let keyrings = await vault.listKeyrings();
assert(keyrings.length === 2, 'two seed keyrings are listed');
assert(keyrings.some((ring) => ring.id === addedSeed.id && ring.label === 'Trading seed'), 'new seed keyring keeps its label');
const secondSeedAccount = await vault.getActiveAccount();
assert(secondSeedAccount.keyring.id === addedSeed.id, 'new seed keyring becomes active');
const derivedSecondSeedRef = await vault.addHdAccount(addedSeed.id);
const derivedSecondSeed = await vault.resolveAccount(derivedSecondSeedRef);
assert(derivedSecondSeed.address !== secondSeedAccount.address, 'each seed keyring derives its own account tree');
let duplicateSeedRejected = false;
try {
  await vault.addSeedKeyring(secondMnemonic, 'keyring migration password');
} catch {
  duplicateSeedRejected = true;
}
assert(duplicateSeedRejected, 'duplicate recovery phrase is rejected');

const secondPrivate = await keys.generateKeyPair();
const privateKeyring = await vault.addPrivateKeyKeyring(Buffer.from(secondPrivate.privateKey).toString('hex'), 'keyring migration password', 'Cold import');
keyrings = await vault.listKeyrings();
assert(keyrings.length === 3 && keyrings.some((ring) => ring.id === privateKeyring.id && ring.type === 'privateKey'), 'private key is a separate keyring');
const importedV2 = await vault.getActiveAccount();
assert(importedV2.address === secondPrivate.address, 'separate private-key keyring resolves its own address');
await vault.lock();
assert(!(await vault.isUnlocked()), 'locking clears every V2 keyring session');
await vault.unlock('keyring migration password');
assert((await vault.listKeyrings()).length === 3, 'all V2 keyrings survive lock and unlock');
await vault.setAccountLabelAuthenticated(secondPrivate.address, 'Cold import primary', 'keyring migration password');
assert((await vault.getActiveAccount()).label === 'Cold import primary', 'authenticated account rename persists');

console.log('\nAll vault.js integration checks passed.');
